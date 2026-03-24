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
-- 2b) Attendee provenance fields ("added by ...")
-- -------------------------------------------------------------------

ALTER TABLE public.event_attendees
    ADD COLUMN IF NOT EXISTS added_by_type TEXT;

ALTER TABLE public.event_attendees
    ADD COLUMN IF NOT EXISTS added_by_attendee_profile_id UUID REFERENCES public.attendee_profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'event_attendees_added_by_type_check'
    ) THEN
        ALTER TABLE public.event_attendees
            ADD CONSTRAINT event_attendees_added_by_type_check
            CHECK (
                added_by_type IS NULL
                OR added_by_type IN ('self', 'proxy', 'host')
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_attendees_added_by_attendee_profile_id_idx
    ON public.event_attendees (added_by_attendee_profile_id);

-- -------------------------------------------------------------------
-- 2c) Event visibility + semi-public fields
-- -------------------------------------------------------------------

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS visibility TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS public_summary TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS public_location_text TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS google_maps_url TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS timezone TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS show_host_publicly BOOLEAN DEFAULT false;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS access_code TEXT;

UPDATE public.events
SET visibility = CASE WHEN is_public THEN 'public' ELSE 'private' END
WHERE visibility IS NULL;

UPDATE public.events
SET access_code = gen_random_uuid()::text
WHERE access_code IS NULL OR btrim(access_code) = '';

UPDATE public.events
SET show_host_publicly = false
WHERE show_host_publicly IS NULL;

UPDATE public.events
SET timezone = 'Asia/Ho_Chi_Minh'
WHERE timezone IS NULL OR btrim(timezone) = '';

UPDATE public.events
SET duration_minutes = LEAST(
    360,
    GREATEST(
        15,
        (
            ROUND(
                CASE
                    WHEN ends_at IS NOT NULL AND ends_at > starts_at
                        THEN EXTRACT(EPOCH FROM (ends_at - starts_at)) / 900.0
                    ELSE 4
                END
            ) * 15
        )::INTEGER
    )
)
WHERE duration_minutes IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_visibility_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_visibility_check
            CHECK (visibility IN ('public', 'semi_public', 'private'));
    END IF;
END $$;

ALTER TABLE public.events
    ALTER COLUMN visibility SET DEFAULT 'semi_public';

ALTER TABLE public.events
    ALTER COLUMN timezone SET DEFAULT 'Asia/Ho_Chi_Minh';

ALTER TABLE public.events
    ALTER COLUMN timezone SET NOT NULL;

ALTER TABLE public.events
    ALTER COLUMN duration_minutes SET DEFAULT 60;

ALTER TABLE public.events
    ALTER COLUMN duration_minutes SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_duration_minutes_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_duration_minutes_check
            CHECK (duration_minutes >= 15 AND duration_minutes <= 360 AND duration_minutes % 15 = 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_visibility_status_starts_at_idx
    ON public.events (visibility, status, starts_at);

CREATE INDEX IF NOT EXISTS events_access_code_idx
    ON public.events (access_code);

-- -------------------------------------------------------------------
-- 2d) Access request queue for semi-public events
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    requester_name TEXT NOT NULL,
    requester_whatsapp TEXT NOT NULL,
    requester_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'contacted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_access_requests_event_id_created_at_idx
    ON public.event_access_requests (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_access_requests_event_id_status_idx
    ON public.event_access_requests (event_id, status);

ALTER TABLE public.event_access_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_access_requests'
          AND policyname = 'Anyone can create event access requests'
    ) THEN
        CREATE POLICY "Anyone can create event access requests"
            ON public.event_access_requests
            FOR INSERT
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_access_requests'
          AND policyname = 'Hosts can view event access requests'
    ) THEN
        CREATE POLICY "Hosts can view event access requests"
            ON public.event_access_requests
            FOR SELECT
            USING (
                auth.uid() IN (
                    SELECT e.host_user_id
                    FROM public.events e
                    WHERE e.id = event_id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_access_requests'
          AND policyname = 'Hosts can update event access requests'
    ) THEN
        CREATE POLICY "Hosts can update event access requests"
            ON public.event_access_requests
            FOR UPDATE
            USING (
                auth.uid() IN (
                    SELECT e.host_user_id
                    FROM public.events e
                    WHERE e.id = event_id
                )
            );
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 2e) Thinking-about-it interest rows
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_interests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    attendee_profile_id UUID REFERENCES public.attendee_profiles(id) ON DELETE SET NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    visibility_mode TEXT NOT NULL DEFAULT 'named' CHECK (visibility_mode IN ('count_only', 'named')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_interests_event_id_created_at_idx
    ON public.event_interests (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_interests_event_id_visibility_mode_idx
    ON public.event_interests (event_id, visibility_mode);

CREATE INDEX IF NOT EXISTS event_interests_event_id_user_id_idx
    ON public.event_interests (event_id, user_id);

CREATE INDEX IF NOT EXISTS event_interests_event_id_attendee_profile_id_idx
    ON public.event_interests (event_id, attendee_profile_id);

CREATE INDEX IF NOT EXISTS event_interests_event_id_guest_email_lower_idx
    ON public.event_interests (event_id, lower(guest_email));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, user_id, count(*) AS c
            FROM public.event_interests
            WHERE user_id IS NOT NULL
            GROUP BY event_id, user_id
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_user_uidx
            ON public.event_interests (event_id, user_id)
            WHERE user_id IS NOT NULL;
    ELSE
        RAISE NOTICE 'Skipped unique index on event_interests(event_id, user_id): duplicate rows exist.';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, attendee_profile_id, count(*) AS c
            FROM public.event_interests
            WHERE attendee_profile_id IS NOT NULL
            GROUP BY event_id, attendee_profile_id
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_profile_uidx
            ON public.event_interests (event_id, attendee_profile_id)
            WHERE attendee_profile_id IS NOT NULL;
    ELSE
        RAISE NOTICE 'Skipped unique index on event_interests(event_id, attendee_profile_id): duplicate rows exist.';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, lower(guest_email) AS normalized_email, count(*) AS c
            FROM public.event_interests
            GROUP BY event_id, lower(guest_email)
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_email_uidx
            ON public.event_interests (event_id, lower(guest_email));
    ELSE
        RAISE NOTICE 'Skipped unique index on event_interests(event_id, lower(guest_email)): duplicate rows exist.';
    END IF;
END $$;

ALTER TABLE public.event_interests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_interests'
          AND policyname = 'Public can view count-only interest rows'
    ) THEN
        CREATE POLICY "Public can view count-only interest rows"
            ON public.event_interests
            FOR SELECT
            USING (visibility_mode = 'count_only');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_interests'
          AND policyname = 'Hosts and members can view named interest rows'
    ) THEN
        CREATE POLICY "Hosts and members can view named interest rows"
            ON public.event_interests
            FOR SELECT
            USING (
                auth.uid() IS NOT NULL
                AND (
                    auth.uid() IN (
                        SELECT e.host_user_id
                        FROM public.events e
                        WHERE e.id = event_id
                    )
                    OR auth.uid() IN (
                        SELECT ea.user_id
                        FROM public.event_attendees ea
                        WHERE ea.event_id = event_id
                          AND ea.status <> 'cancelled'
                          AND ea.user_id IS NOT NULL
                    )
                    OR auth.uid() IN (
                        SELECT ap.user_id
                        FROM public.attendee_profiles ap
                        WHERE ap.id = attendee_profile_id
                    )
                )
            );
    END IF;
END $$;

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
    v_exact_id UUID;
    v_exact_status TEXT;
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
      AND coalesce(ea.added_by_type, 'self') <> 'proxy'
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
        BEGIN
            UPDATE public.event_attendees
            SET
                status = v_status,
                guest_name = v_guest_name,
                guest_email = v_guest_email,
                attendee_profile_id = p_attendee_profile_id,
                added_by_type = 'self',
                added_by_attendee_profile_id = p_attendee_profile_id,
                user_id = NULL,
                joined_at = now(),
                promoted_at = null,
                cancelled_at = null
            WHERE id = v_existing_id
            RETURNING id INTO v_attendee_id;
        EXCEPTION
            WHEN unique_violation THEN
                -- If renaming/reviving conflicts, resolve to exact email+name row.
                SELECT ea.id, ea.status
                INTO v_exact_id, v_exact_status
                FROM public.event_attendees ea
                WHERE ea.event_id = p_event_id
                  AND lower(ea.guest_email) = v_guest_email
                  AND lower(ea.guest_name) = lower(v_guest_name)
                ORDER BY ea.joined_at DESC
                LIMIT 1;

                IF v_exact_id IS NULL THEN
                    RETURN json_build_object('error', 'RSVP conflict detected, please retry');
                END IF;

                IF v_exact_status <> 'cancelled' THEN
                    RETURN json_build_object('error', 'You have already said you''re in!');
                END IF;

                UPDATE public.event_attendees
                SET
                    status = v_status,
                    guest_name = v_guest_name,
                    guest_email = v_guest_email,
                    attendee_profile_id = p_attendee_profile_id,
                    added_by_type = 'self',
                    added_by_attendee_profile_id = p_attendee_profile_id,
                    user_id = NULL,
                    joined_at = now(),
                    promoted_at = null,
                    cancelled_at = null
                WHERE id = v_exact_id
                RETURNING id INTO v_attendee_id;
        END;
    ELSE
        BEGIN
            INSERT INTO public.event_attendees (
                event_id,
                user_id,
                attendee_profile_id,
                guest_name,
                guest_email,
                status,
                added_by_type,
                added_by_attendee_profile_id
            )
            VALUES (
                p_event_id,
                NULL,
                p_attendee_profile_id,
                v_guest_name,
                v_guest_email,
                v_status,
                'self',
                p_attendee_profile_id
            )
            RETURNING id INTO v_attendee_id;
        EXCEPTION
            WHEN unique_violation THEN
                -- Compatibility fallback for schemas with uniqueness including name/email.
                -- Revive/update the latest matching row instead of failing RSVP.
                UPDATE public.event_attendees
                SET
                    status = v_status,
                    guest_name = v_guest_name,
                    guest_email = v_guest_email,
                    attendee_profile_id = p_attendee_profile_id,
                    added_by_type = 'self',
                    added_by_attendee_profile_id = p_attendee_profile_id,
                    user_id = NULL,
                    joined_at = now(),
                    promoted_at = null,
                    cancelled_at = null
                WHERE id = (
                    SELECT ea.id
                    FROM public.event_attendees ea
                    WHERE ea.event_id = p_event_id
                      AND lower(ea.guest_email) = v_guest_email
                      AND lower(ea.guest_name) = lower(v_guest_name)
                    ORDER BY ea.joined_at DESC
                    LIMIT 1
                )
                RETURNING id INTO v_attendee_id;

                IF v_attendee_id IS NULL THEN
                    RETURN json_build_object('error', 'RSVP conflict detected, please retry');
                END IF;
        END;
    END IF;

    -- If the user formally RSVPs, remove any previous "thinking about it" row.
    DELETE FROM public.event_interests
    WHERE event_id = p_event_id
      AND (
        lower(guest_email) = v_guest_email
        OR (p_attendee_profile_id IS NOT NULL AND attendee_profile_id = p_attendee_profile_id)
      );

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
            added_by_type = 'proxy',
            added_by_attendee_profile_id = p_attendee_profile_id,
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
                status,
                added_by_type,
                added_by_attendee_profile_id
            )
            VALUES (
                p_event_id,
                p_user_id,
                p_attendee_profile_id,
                trim(p_proxy_name),
                v_guest_email,
                v_status,
                'proxy',
                p_attendee_profile_id
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
                    status,
                    added_by_type,
                    added_by_attendee_profile_id
                )
                VALUES (
                    p_event_id,
                    p_user_id,
                    p_attendee_profile_id,
                    trim(p_proxy_name),
                    v_guest_email,
                    v_status,
                    'proxy',
                    p_attendee_profile_id
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

-- -------------------------------------------------------------------
-- 8) Thinking-about-it toggle RPC
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.toggle_event_interest(
    p_event_id UUID,
    p_guest_name TEXT,
    p_guest_email TEXT,
    p_visibility_mode TEXT DEFAULT 'named',
    p_user_id UUID DEFAULT NULL,
    p_attendee_profile_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_name TEXT;
    v_email TEXT;
    v_existing_id UUID;
    v_existing_visibility_mode TEXT;
    v_active_rsvp_id UUID;
    v_interest_id UUID;
BEGIN
    v_name := trim(coalesce(p_guest_name, ''));
    v_email := lower(trim(coalesce(p_guest_email, '')));

    IF p_event_id IS NULL OR v_name = '' OR v_email = '' THEN
        RETURN json_build_object('error', 'Missing interest details');
    END IF;

    IF p_visibility_mode NOT IN ('count_only', 'named') THEN
        RETURN json_build_object('error', 'Invalid visibility mode');
    END IF;

    SELECT ea.id
    INTO v_active_rsvp_id
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.status <> 'cancelled'
      AND coalesce(ea.added_by_type, 'self') <> 'proxy'
      AND (
        lower(ea.guest_email) = v_email
        OR (p_attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = p_attendee_profile_id)
        OR (p_user_id IS NOT NULL AND ea.user_id = p_user_id)
      )
    LIMIT 1;

    IF v_active_rsvp_id IS NOT NULL THEN
        RETURN json_build_object('error', 'You are already in this activity');
    END IF;

    SELECT ei.id, ei.visibility_mode
    INTO v_existing_id, v_existing_visibility_mode
    FROM public.event_interests ei
    WHERE ei.event_id = p_event_id
      AND (
        (p_user_id IS NOT NULL AND ei.user_id = p_user_id)
        OR (p_attendee_profile_id IS NOT NULL AND ei.attendee_profile_id = p_attendee_profile_id)
        OR lower(ei.guest_email) = v_email
      )
    ORDER BY ei.created_at DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        IF v_existing_visibility_mode = p_visibility_mode THEN
            DELETE FROM public.event_interests
            WHERE id = v_existing_id;
            RETURN json_build_object('success', true, 'removed', true);
        END IF;

        UPDATE public.event_interests
        SET
            guest_name = v_name,
            guest_email = v_email,
            user_id = p_user_id,
            attendee_profile_id = p_attendee_profile_id,
            visibility_mode = p_visibility_mode,
            updated_at = now()
        WHERE id = v_existing_id;

        RETURN json_build_object('success', true, 'removed', false);
    END IF;

    INSERT INTO public.event_interests (
        event_id,
        user_id,
        attendee_profile_id,
        guest_name,
        guest_email,
        visibility_mode
    )
    VALUES (
        p_event_id,
        p_user_id,
        p_attendee_profile_id,
        v_name,
        v_email,
        p_visibility_mode
    )
    RETURNING id INTO v_interest_id;

    RETURN json_build_object('success', true, 'removed', false, 'interest_id', v_interest_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('error', 'Interest already exists for this activity');
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.toggle_event_interest(UUID, TEXT, TEXT, TEXT, UUID, UUID) TO anon, authenticated;

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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'event_interests_touch_updated_at'
          AND tgrelid = 'public.event_interests'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER event_interests_touch_updated_at
            BEFORE UPDATE ON public.event_interests
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'event_access_requests_touch_updated_at'
          AND tgrelid = 'public.event_access_requests'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER event_access_requests_touch_updated_at
            BEFORE UPDATE ON public.event_access_requests
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
