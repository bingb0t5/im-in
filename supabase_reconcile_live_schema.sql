-- Supabase reconciliation script for an already-live schema.
--
-- Safe goals:
-- 1) Add indexes that match current app query patterns.
-- 2) Keep event_waitlist_positions integrity tight (if no duplicate data exists).
-- 3) Add updated_at maintenance for attendee_profiles.
--
-- This script intentionally avoids:
-- - changing RSVP uniqueness semantics on event_attendees
-- - altering existing RLS policies
-- - dropping columns/constraints

-- -------------------------------------------------------------------
-- 1) Performance indexes used by frontend queries
-- -------------------------------------------------------------------

-- Events listing and calendar queries
CREATE INDEX IF NOT EXISTS events_status_starts_at_idx
    ON public.events (status, starts_at);

CREATE INDEX IF NOT EXISTS events_is_public_status_starts_at_idx
    ON public.events (is_public, status, starts_at);

CREATE INDEX IF NOT EXISTS events_host_user_id_idx
    ON public.events (host_user_id);

-- Event attendees query patterns
CREATE INDEX IF NOT EXISTS event_attendees_event_id_status_joined_at_idx
    ON public.event_attendees (event_id, status, joined_at);

CREATE INDEX IF NOT EXISTS event_attendees_event_id_user_id_status_idx
    ON public.event_attendees (event_id, user_id, status);

CREATE INDEX IF NOT EXISTS event_attendees_event_id_attendee_profile_id_status_idx
    ON public.event_attendees (event_id, attendee_profile_id, status);

CREATE INDEX IF NOT EXISTS event_attendees_event_id_guest_email_idx
    ON public.event_attendees (event_id, guest_email);

CREATE INDEX IF NOT EXISTS event_attendees_guest_email_lower_idx
    ON public.event_attendees (lower(guest_email));

CREATE INDEX IF NOT EXISTS event_attendees_attendee_profile_id_idx
    ON public.event_attendees (attendee_profile_id);

-- Guest session/profile patterns
CREATE INDEX IF NOT EXISTS attendee_sessions_expires_at_idx
    ON public.attendee_sessions (expires_at);

CREATE INDEX IF NOT EXISTS attendee_sessions_profile_id_idx
    ON public.attendee_sessions (attendee_profile_id);

CREATE INDEX IF NOT EXISTS attendee_profiles_user_id_idx
    ON public.attendee_profiles (user_id);

CREATE INDEX IF NOT EXISTS attendee_profiles_email_lower_idx
    ON public.attendee_profiles (lower(email));

-- Waitlist traversal
CREATE INDEX IF NOT EXISTS event_waitlist_positions_event_id_position_idx
    ON public.event_waitlist_positions (event_id, position);

CREATE INDEX IF NOT EXISTS event_waitlist_positions_attendee_id_idx
    ON public.event_waitlist_positions (attendee_id);

-- -------------------------------------------------------------------
-- 2) Optional integrity constraints for waitlist table
--    Only added if existing data has no duplicates.
-- -------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, attendee_id, count(*) AS c
            FROM public.event_waitlist_positions
            GROUP BY event_id, attendee_id
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_waitlist_positions_event_attendee_uidx
            ON public.event_waitlist_positions (event_id, attendee_id);
    ELSE
        RAISE NOTICE 'Skipped unique index on (event_id, attendee_id): duplicate rows exist.';
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 6) Reliable cancellation RPC (bypasses fragile RLS query paths)
-- -------------------------------------------------------------------
-- Why:
-- - Some environments/policies can fail with "permission denied for table users"
--   during direct UPDATE flows.
-- - This function keeps one secure, auditable cancel path with explicit auth checks.

CREATE OR REPLACE FUNCTION public.cancel_attendee_with_promotion(
    p_attendee_id UUID,
    p_session_token TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_actor_uid UUID;
    v_actor_email TEXT;
    v_event_id UUID;
    v_status TEXT;
    v_user_id UUID;
    v_attendee_profile_id UUID;
    v_guest_email TEXT;
    v_host_user_id UUID;
    v_next_waitlist_id UUID;
    v_session_profile_id UUID;
BEGIN
    v_actor_uid := auth.uid();
    v_actor_email := lower(coalesce(auth.jwt() ->> 'email', ''));

    -- Load target attendee row
    SELECT
        ea.event_id,
        ea.status,
        ea.user_id,
        ea.attendee_profile_id,
        lower(ea.guest_email)
    INTO
        v_event_id,
        v_status,
        v_user_id,
        v_attendee_profile_id,
        v_guest_email
    FROM public.event_attendees ea
    WHERE ea.id = p_attendee_id;

    IF v_event_id IS NULL THEN
        RETURN json_build_object('error', 'Attendee not found');
    END IF;

    -- Load event host
    SELECT e.host_user_id
    INTO v_host_user_id
    FROM public.events e
    WHERE e.id = v_event_id;

    -- Optional guest-session authorization path
    IF p_session_token IS NOT NULL THEN
        SELECT s.attendee_profile_id
        INTO v_session_profile_id
        FROM public.attendee_sessions s
        WHERE s.token = p_session_token
          AND s.expires_at > now()
        LIMIT 1;
    END IF;

    -- Authorization checks
    IF NOT (
        (v_actor_uid IS NOT NULL AND v_actor_uid = v_host_user_id) OR
        (v_actor_uid IS NOT NULL AND v_actor_uid = v_user_id) OR
        (v_actor_uid IS NOT NULL AND EXISTS (
            SELECT 1
            FROM public.attendee_profiles ap
            WHERE ap.id = v_attendee_profile_id
              AND ap.user_id = v_actor_uid
        )) OR
        (v_actor_email <> '' AND v_actor_email = v_guest_email) OR
        (v_session_profile_id IS NOT NULL AND v_session_profile_id = v_attendee_profile_id)
    ) THEN
        RETURN json_build_object('error', 'Not authorized to cancel this RSVP');
    END IF;

    -- Cancel target row
    UPDATE public.event_attendees
    SET
        status = 'cancelled',
        cancelled_at = now()
    WHERE id = p_attendee_id;

    -- Promote next waitlist person when a confirmed attendee cancels
    IF v_status = 'confirmed' THEN
        SELECT ea.id
        INTO v_next_waitlist_id
        FROM public.event_attendees ea
        WHERE ea.event_id = v_event_id
          AND ea.status = 'waitlist'
          AND ea.id <> p_attendee_id
        ORDER BY ea.joined_at ASC
        LIMIT 1;

        IF v_next_waitlist_id IS NOT NULL THEN
            UPDATE public.event_attendees
            SET
                status = 'confirmed',
                promoted_at = now()
            WHERE id = v_next_waitlist_id;
        END IF;
    END IF;

    RETURN json_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.cancel_attendee_with_promotion(UUID, TEXT) TO anon, authenticated;

-- -------------------------------------------------------------------
-- 6b) Reliable RSVP RPC (avoids fragile direct INSERT/UPDATE policy paths)
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_rsvp(
    p_event_id UUID,
    p_guest_name TEXT,
    p_guest_email TEXT,
    p_attendee_profile_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_capacity INTEGER;
    v_allow_waitlist BOOLEAN;
    v_confirmed_count INTEGER;
    v_status TEXT;
    v_existing_id UUID;
    v_existing_status TEXT;
    v_attendee_id UUID;
    v_guest_name TEXT;
    v_guest_email TEXT;
BEGIN
    v_guest_name := trim(coalesce(p_guest_name, ''));
    v_guest_email := lower(trim(coalesce(p_guest_email, '')));

    IF p_event_id IS NULL OR v_guest_name = '' OR v_guest_email = '' THEN
        RETURN json_build_object('error', 'Missing RSVP details');
    END IF;

    SELECT e.capacity, e.allow_waitlist
    INTO v_capacity, v_allow_waitlist
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.status = 'scheduled';

    IF v_capacity IS NULL THEN
        RETURN json_build_object('error', 'Event not found');
    END IF;

    SELECT ea.id, ea.status
    INTO v_existing_id, v_existing_status
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND (
        lower(ea.guest_email) = v_guest_email
        OR (p_attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = p_attendee_profile_id)
      )
    ORDER BY
      CASE WHEN ea.status = 'cancelled' THEN 1 ELSE 0 END,
      ea.joined_at DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL AND v_existing_status <> 'cancelled' THEN
        RETURN json_build_object('error', 'You have already said you''re in!');
    END IF;

    SELECT count(*) INTO v_confirmed_count
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.status = 'confirmed';

    IF v_confirmed_count < v_capacity THEN
        v_status := 'confirmed';
    ELSIF v_allow_waitlist THEN
        v_status := 'waitlist';
    ELSE
        RETURN json_build_object('error', 'Event is full and waitlist is disabled');
    END IF;

    IF v_existing_id IS NOT NULL THEN
        UPDATE public.event_attendees
        SET
            status = v_status,
            guest_name = v_guest_name,
            guest_email = v_guest_email,
            attendee_profile_id = p_attendee_profile_id,
            user_id = NULL,
            joined_at = now(),
            promoted_at = null,
            cancelled_at = null
        WHERE id = v_existing_id
        RETURNING id INTO v_attendee_id;
    ELSE
        INSERT INTO public.event_attendees (
            event_id,
            user_id,
            attendee_profile_id,
            guest_name,
            guest_email,
            status
        )
        VALUES (
            p_event_id,
            NULL,
            p_attendee_profile_id,
            v_guest_name,
            v_guest_email,
            v_status
        )
        RETURNING id INTO v_attendee_id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'status', v_status,
        'attendee_id', v_attendee_id
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.submit_rsvp(UUID, TEXT, TEXT, UUID) TO anon, authenticated;

-- -------------------------------------------------------------------
-- 7) Reliable proxy-add RPC (avoids fragile direct INSERT policy paths)
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_proxy_attendee(
    p_event_id UUID,
    p_proxy_name TEXT,
    p_attendee_profile_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_owner_email TEXT DEFAULT NULL,
    p_session_token TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_actor_uid UUID;
    v_actor_email TEXT;
    v_profile_user_id UUID;
    v_host_user_id UUID;
    v_allow_waitlist BOOLEAN;
    v_capacity INTEGER;
    v_confirmed_count INTEGER;
    v_status TEXT;
    v_existing_cancelled_id UUID;
    v_attendee_id UUID;
    v_session_profile_id UUID;
    v_guest_email TEXT;
BEGIN
    IF p_event_id IS NULL OR p_proxy_name IS NULL OR trim(p_proxy_name) = '' OR p_attendee_profile_id IS NULL THEN
        RETURN json_build_object('error', 'Missing required proxy RSVP input');
    END IF;

    v_actor_uid := auth.uid();
    v_actor_email := lower(coalesce(auth.jwt() ->> 'email', ''));

    -- Load event and profile ownership
    SELECT e.host_user_id, e.allow_waitlist, e.capacity
    INTO v_host_user_id, v_allow_waitlist, v_capacity
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_capacity IS NULL THEN
        RETURN json_build_object('error', 'Event not found');
    END IF;

    SELECT ap.user_id
    INTO v_profile_user_id
    FROM public.attendee_profiles ap
    WHERE ap.id = p_attendee_profile_id;

    IF p_session_token IS NOT NULL THEN
        SELECT s.attendee_profile_id
        INTO v_session_profile_id
        FROM public.attendee_sessions s
        WHERE s.token = p_session_token
          AND s.expires_at > now()
        LIMIT 1;
    END IF;

    -- Authorization: host OR profile owner OR owner email OR valid guest session
    IF NOT (
        (v_actor_uid IS NOT NULL AND v_actor_uid = v_host_user_id) OR
        (v_actor_uid IS NOT NULL AND v_actor_uid = v_profile_user_id) OR
        (v_actor_email <> '' AND v_actor_email = lower(coalesce(p_owner_email, ''))) OR
        (v_session_profile_id IS NOT NULL AND v_session_profile_id = p_attendee_profile_id)
    ) THEN
        RETURN json_build_object('error', 'Not authorized to add someone for this RSVP');
    END IF;

    -- Capacity decision
    SELECT count(*) INTO v_confirmed_count
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.status = 'confirmed';

    IF v_confirmed_count < v_capacity THEN
        v_status := 'confirmed';
    ELSIF v_allow_waitlist THEN
        v_status := 'waitlist';
    ELSE
        RETURN json_build_object('error', 'Event is full and waitlist is disabled');
    END IF;

    -- Try revive cancelled row by profile+name (case-insensitive)
    SELECT ea.id
    INTO v_existing_cancelled_id
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.attendee_profile_id = p_attendee_profile_id
      AND lower(ea.guest_name) = lower(trim(p_proxy_name))
      AND ea.status = 'cancelled'
    ORDER BY ea.cancelled_at DESC NULLS LAST
    LIMIT 1;

    IF v_existing_cancelled_id IS NOT NULL THEN
        UPDATE public.event_attendees
        SET
            status = v_status,
            user_id = p_user_id,
            attendee_profile_id = p_attendee_profile_id,
            guest_name = trim(p_proxy_name),
            joined_at = now(),
            promoted_at = null,
            cancelled_at = null
        WHERE id = v_existing_cancelled_id
        RETURNING id INTO v_attendee_id;
    ELSE
        v_guest_email := lower(trim(coalesce(p_owner_email, '')));
        IF v_guest_email = '' THEN
            v_guest_email := concat(
                'proxy+',
                substr(p_attendee_profile_id::text, 1, 8),
                '-',
                substr(md5(clock_timestamp()::text || random()::text), 1, 10),
                '@proxy.im-in.local'
            );
        END IF;

        BEGIN
            INSERT INTO public.event_attendees (
                event_id,
                user_id,
                attendee_profile_id,
                guest_name,
                guest_email,
                status
            )
            VALUES (
                p_event_id,
                p_user_id,
                p_attendee_profile_id,
                trim(p_proxy_name),
                v_guest_email,
                v_status
            )
            RETURNING id INTO v_attendee_id;
        EXCEPTION
            WHEN unique_violation THEN
                v_guest_email := concat(
                    'proxy+',
                    substr(p_attendee_profile_id::text, 1, 8),
                    '-',
                    substr(md5(clock_timestamp()::text || random()::text), 1, 12),
                    '@proxy.im-in.local'
                );

                INSERT INTO public.event_attendees (
                    event_id,
                    user_id,
                    attendee_profile_id,
                    guest_name,
                    guest_email,
                    status
                )
                VALUES (
                    p_event_id,
                    p_user_id,
                    p_attendee_profile_id,
                    trim(p_proxy_name),
                    v_guest_email,
                    v_status
                )
                RETURNING id INTO v_attendee_id;
        END;
    END IF;

    RETURN json_build_object(
        'success', true,
        'status', v_status,
        'attendee_id', v_attendee_id
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.add_proxy_attendee(UUID, TEXT, UUID, UUID, TEXT, TEXT) TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_attendees'
          AND policyname = 'Email owners can update attendee rows'
    ) THEN
        CREATE POLICY "Email owners can update attendee rows"
            ON public.event_attendees
            FOR UPDATE
            USING (
                auth.uid() IS NOT NULL
                AND nullif(lower(guest_email), '') IS NOT NULL
                AND lower(guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, position, count(*) AS c
            FROM public.event_waitlist_positions
            GROUP BY event_id, position
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_waitlist_positions_event_position_uidx
            ON public.event_waitlist_positions (event_id, position);
    ELSE
        RAISE NOTICE 'Skipped unique index on (event_id, position): duplicate rows exist.';
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 3) Keep attendee_profiles.updated_at current
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'attendee_profiles_touch_updated_at'
          AND tgrelid = 'public.attendee_profiles'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER attendee_profiles_touch_updated_at
            BEFORE UPDATE ON public.attendee_profiles
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 4) Post-run manual checks (run separately if desired)
-- -------------------------------------------------------------------
-- SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;
-- SELECT * FROM pg_trigger WHERE tgrelid = 'public.attendee_profiles'::regclass;

-- -------------------------------------------------------------------
-- 5) RSVP cancellation reliability policy
-- -------------------------------------------------------------------
-- Some attendee rows are linked to users through attendee_profiles.user_id
-- while event_attendees.user_id may be null (legacy/guest-origin rows).
-- This policy allows authenticated profile owners to update their own attendee rows.

ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_attendees'
          AND policyname = 'Profile owners can update attendee rows'
    ) THEN
        CREATE POLICY "Profile owners can update attendee rows"
            ON public.event_attendees
            FOR UPDATE
            USING (
                auth.uid() IN (
                    SELECT ap.user_id
                    FROM public.attendee_profiles ap
                    WHERE ap.id = attendee_profile_id
                )
            );
    END IF;
END $$;
