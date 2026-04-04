ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS join_code TEXT;

CREATE OR REPLACE FUNCTION public.generate_event_join_code()
RETURNS TEXT AS $$
DECLARE
    v_code TEXT;
BEGIN
    LOOP
        v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
        EXIT WHEN NOT EXISTS (
            SELECT 1
            FROM public.events e
            WHERE e.join_code = v_code
        );
    END LOOP;

    RETURN v_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

ALTER TABLE public.events
    ALTER COLUMN join_code SET DEFAULT public.generate_event_join_code();

UPDATE public.events
SET join_code = public.generate_event_join_code()
WHERE join_code IS NULL OR btrim(join_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS events_join_code_uidx
    ON public.events (join_code);

CREATE TABLE IF NOT EXISTS public.event_shared_with_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'link' CHECK (source IN ('link', 'code')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS event_shared_with_users_user_id_created_at_idx
    ON public.event_shared_with_users (user_id, created_at DESC);

ALTER TABLE public.event_shared_with_users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_shared_with_users'
          AND policyname = 'Users can read their own shared activities'
    ) THEN
        CREATE POLICY "Users can read their own shared activities"
            ON public.event_shared_with_users
            FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_shared_with_users'
          AND policyname = 'Users can insert their own shared activities'
    ) THEN
        CREATE POLICY "Users can insert their own shared activities"
            ON public.event_shared_with_users
            FOR INSERT
            TO authenticated
            WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_shared_with_users'
          AND policyname = 'Users can delete their own shared activities'
    ) THEN
        CREATE POLICY "Users can delete their own shared activities"
            ON public.event_shared_with_users
            FOR DELETE
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_event_shared_with_me(
    p_event_id UUID,
    p_source TEXT DEFAULT 'link'
) RETURNS public.event_shared_with_users AS $$
DECLARE
    v_row public.event_shared_with_users%ROWTYPE;
    v_source TEXT := CASE
        WHEN lower(trim(coalesce(p_source, ''))) = 'code' THEN 'code'
        ELSE 'link'
    END;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    INSERT INTO public.event_shared_with_users (
        event_id,
        user_id,
        source
    )
    VALUES (
        p_event_id,
        auth.uid(),
        v_source
    )
    ON CONFLICT (event_id, user_id)
    DO UPDATE
    SET source = EXCLUDED.source
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.mark_event_shared_with_me(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.share_event_by_join_code(
    p_join_code TEXT
) RETURNS TABLE (
    id UUID,
    slug TEXT,
    title TEXT,
    description TEXT,
    public_summary TEXT,
    location_text TEXT,
    public_location_text TEXT,
    google_maps_url TEXT,
    starts_at TIMESTAMPTZ,
    timezone TEXT,
    duration_minutes INTEGER,
    ends_at TIMESTAMPTZ,
    capacity INTEGER,
    host_user_id UUID,
    host_name TEXT,
    host_contact_text TEXT,
    show_host_publicly BOOLEAN,
    access_code TEXT,
    join_code TEXT,
    visibility TEXT,
    allow_waitlist BOOLEAN,
    require_host_approval_for_join BOOLEAN,
    require_guest_email_for_join BOOLEAN,
    is_public BOOLEAN,
    public_discovery_enabled BOOLEAN,
    moderation_status TEXT,
    moderation_risk_level TEXT,
    moderation_action TEXT,
    moderation_confidence NUMERIC,
    moderation_reasons TEXT[],
    moderation_input_hash TEXT,
    moderated_at TIMESTAMPTZ,
    moderation_archived_at TIMESTAMPTZ,
    moderation_override TEXT,
    status TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    v_event public.events%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT *
    INTO v_event
    FROM public.events e
    WHERE upper(coalesce(e.join_code, '')) = upper(trim(coalesce(p_join_code, '')))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    PERFORM public.mark_event_shared_with_me(v_event.id, 'code');

    RETURN QUERY
    SELECT
        v_event.id,
        v_event.slug,
        v_event.title,
        v_event.description,
        v_event.public_summary,
        v_event.location_text,
        v_event.public_location_text,
        v_event.google_maps_url,
        v_event.starts_at,
        v_event.timezone,
        v_event.duration_minutes,
        v_event.ends_at,
        v_event.capacity,
        v_event.host_user_id,
        v_event.host_name,
        v_event.host_contact_text,
        v_event.show_host_publicly,
        v_event.access_code,
        v_event.join_code,
        v_event.visibility,
        v_event.allow_waitlist,
        v_event.require_host_approval_for_join,
        v_event.require_guest_email_for_join,
        v_event.is_public,
        v_event.public_discovery_enabled,
        v_event.moderation_status,
        v_event.moderation_risk_level,
        v_event.moderation_action,
        v_event.moderation_confidence,
        v_event.moderation_reasons,
        v_event.moderation_input_hash,
        v_event.moderated_at,
        v_event.moderation_archived_at,
        v_event.moderation_override,
        v_event.status,
        v_event.created_at,
        v_event.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.share_event_by_join_code(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_shared_activities()
RETURNS SETOF public.events AS $$
    SELECT DISTINCT e.*
    FROM public.event_shared_with_users es
    JOIN public.events e
      ON e.id = es.event_id
    WHERE auth.uid() IS NOT NULL
      AND es.user_id = auth.uid()
      AND NOT public.is_event_host(e.id, auth.uid())
      AND NOT EXISTS (
          SELECT 1
          FROM public.event_attendees ea
          LEFT JOIN public.attendee_profiles ap
            ON ap.id = ea.attendee_profile_id
          LEFT JOIN public.attendee_profiles added_by_ap
            ON added_by_ap.id = ea.added_by_attendee_profile_id
          WHERE ea.event_id = e.id
            AND ea.status <> 'cancelled'
            AND (
                ea.user_id = auth.uid()
                OR ap.user_id = auth.uid()
                OR lower(coalesce(ap.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
                OR lower(coalesce(ea.guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
                OR added_by_ap.user_id = auth.uid()
                OR lower(coalesce(added_by_ap.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
            )
      )
      AND NOT EXISTS (
          SELECT 1
          FROM public.event_join_requests jr
          LEFT JOIN public.attendee_profiles ap
            ON ap.id = jr.attendee_profile_id
          WHERE jr.event_id = e.id
            AND jr.status = 'pending'
            AND (
                jr.user_id = auth.uid()
                OR ap.user_id = auth.uid()
                OR lower(coalesce(ap.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
                OR lower(coalesce(jr.guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
            )
      )
    ORDER BY e.starts_at ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_my_shared_activities() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_event_for_view(
    p_slug TEXT,
    p_access_code TEXT DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    slug TEXT,
    title TEXT,
    description TEXT,
    public_summary TEXT,
    location_text TEXT,
    public_location_text TEXT,
    google_maps_url TEXT,
    starts_at TIMESTAMPTZ,
    timezone TEXT,
    duration_minutes INTEGER,
    ends_at TIMESTAMPTZ,
    capacity INTEGER,
    host_user_id UUID,
    host_name TEXT,
    host_contact_text TEXT,
    show_host_publicly BOOLEAN,
    access_code TEXT,
    visibility TEXT,
    allow_waitlist BOOLEAN,
    require_host_approval_for_join BOOLEAN,
    require_guest_email_for_join BOOLEAN,
    is_public BOOLEAN,
    public_discovery_enabled BOOLEAN,
    moderation_status TEXT,
    moderation_risk_level TEXT,
    moderation_action TEXT,
    moderation_confidence NUMERIC,
    moderation_reasons TEXT[],
    moderation_input_hash TEXT,
    moderated_at TIMESTAMPTZ,
    moderation_archived_at TIMESTAMPTZ,
    moderation_override TEXT,
    status TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    can_view_full_details BOOLEAN
) AS $$
DECLARE
    v_event public.events%ROWTYPE;
    v_visibility TEXT;
    v_is_host BOOLEAN := false;
    v_has_access_code BOOLEAN := false;
    v_is_shared BOOLEAN := false;
    v_can_view_full BOOLEAN := false;
BEGIN
    SELECT *
    INTO v_event
    FROM public.events e
    WHERE e.slug = p_slug
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_visibility := COALESCE(v_event.visibility, CASE WHEN v_event.is_public THEN 'public' ELSE 'private' END);
    v_is_host := auth.uid() IS NOT NULL AND public.is_event_host(v_event.id, auth.uid());
    v_has_access_code := nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
        AND p_access_code = v_event.access_code;
    v_is_shared := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_shared_with_users es
        WHERE es.event_id = v_event.id
          AND es.user_id = auth.uid()
    );

    v_can_view_full := v_visibility = 'public'
        OR v_visibility = 'private'
        OR (v_visibility = 'semi_public' AND (v_is_host OR v_has_access_code OR v_is_shared));

    RETURN QUERY
    SELECT
        v_event.id,
        v_event.slug,
        v_event.title,
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.description
        END,
        v_event.public_summary,
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.location_text
        END,
        v_event.public_location_text,
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.google_maps_url
        END,
        v_event.starts_at,
        v_event.timezone,
        v_event.duration_minutes,
        v_event.ends_at,
        v_event.capacity,
        v_event.host_user_id,
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full AND NOT coalesce(v_event.show_host_publicly, false) THEN NULL
            ELSE v_event.host_name
        END,
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.host_contact_text
        END,
        v_event.show_host_publicly,
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.access_code
        END,
        v_event.visibility,
        v_event.allow_waitlist,
        coalesce(v_event.require_host_approval_for_join, false),
        coalesce(v_event.require_guest_email_for_join, false),
        v_event.is_public,
        v_event.public_discovery_enabled,
        v_event.moderation_status,
        v_event.moderation_risk_level,
        v_event.moderation_action,
        v_event.moderation_confidence,
        v_event.moderation_reasons,
        v_event.moderation_input_hash,
        v_event.moderated_at,
        v_event.moderation_archived_at,
        v_event.moderation_override,
        v_event.status,
        v_event.created_at,
        v_event.updated_at,
        v_can_view_full;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_event_for_view(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_event_attendees_for_view(
    p_event_id UUID,
    p_access_code TEXT DEFAULT NULL
) RETURNS SETOF public.event_attendees AS $$
DECLARE
    v_visibility TEXT;
    v_event_access_code TEXT;
    v_can_view BOOLEAN := false;
    v_is_shared BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code
    INTO
        v_visibility,
        v_event_access_code
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_visibility IS NULL THEN
        RETURN;
    END IF;

    v_is_shared := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_shared_with_users es
        WHERE es.event_id = p_event_id
          AND es.user_id = auth.uid()
    );

    v_can_view := v_visibility = 'public'
        OR v_visibility = 'private'
        OR (
            v_visibility = 'semi_public'
            AND (
                (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
                OR v_is_shared
                OR (
                    nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
                    AND p_access_code = v_event_access_code
                )
            )
        );

    IF NOT v_can_view THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT ea.*
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.status <> 'cancelled'
    ORDER BY ea.joined_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_event_attendees_for_view(UUID, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_event_interests_for_view(
    p_event_id UUID,
    p_access_code TEXT DEFAULT NULL
) RETURNS SETOF public.event_interests AS $$
DECLARE
    v_visibility TEXT;
    v_event_access_code TEXT;
    v_can_view_named BOOLEAN := false;
    v_is_shared BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code
    INTO
        v_visibility,
        v_event_access_code
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_visibility IS NULL THEN
        RETURN;
    END IF;

    IF v_visibility = 'public' THEN
        RETURN QUERY
        SELECT ei.*
        FROM public.event_interests ei
        WHERE ei.event_id = p_event_id
          AND ei.visibility_mode = 'count_only'
        ORDER BY ei.created_at ASC;
        RETURN;
    END IF;

    v_is_shared := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_shared_with_users es
        WHERE es.event_id = p_event_id
          AND es.user_id = auth.uid()
    );

    v_can_view_named := v_visibility = 'private'
        OR (
            v_visibility = 'semi_public'
            AND (
                (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
                OR v_is_shared
                OR (
                    nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
                    AND p_access_code = v_event_access_code
                )
            )
        );

    IF NOT v_can_view_named THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT ei.*
    FROM public.event_interests ei
    WHERE ei.event_id = p_event_id
    ORDER BY ei.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_event_interests_for_view(UUID, TEXT) TO anon, authenticated;
