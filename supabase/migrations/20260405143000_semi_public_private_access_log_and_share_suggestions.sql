CREATE TABLE IF NOT EXISTS public.event_private_audience_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    viewer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    view_count INTEGER NOT NULL DEFAULT 1 CHECK (view_count > 0),
    UNIQUE(event_id, viewer_user_id)
);

CREATE INDEX IF NOT EXISTS event_private_audience_log_event_last_seen_idx
    ON public.event_private_audience_log (event_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS event_private_audience_log_viewer_last_seen_idx
    ON public.event_private_audience_log (viewer_user_id, last_seen_at DESC);

ALTER TABLE public.event_private_audience_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_event_private_view(
    p_event_id UUID,
    p_viewer_user_id UUID DEFAULT auth.uid()
) RETURNS VOID AS $$
DECLARE
    v_viewer_user_id UUID := COALESCE(p_viewer_user_id, auth.uid());
BEGIN
    IF p_event_id IS NULL OR v_viewer_user_id IS NULL THEN
        RETURN;
    END IF;

    IF public.is_event_host(p_event_id, v_viewer_user_id) THEN
        RETURN;
    END IF;

    INSERT INTO public.event_private_audience_log (
        event_id,
        viewer_user_id,
        first_seen_at,
        last_seen_at,
        view_count
    )
    VALUES (
        p_event_id,
        v_viewer_user_id,
        now(),
        now(),
        1
    )
    ON CONFLICT (event_id, viewer_user_id)
    DO UPDATE
    SET
        last_seen_at = now(),
        view_count = public.event_private_audience_log.view_count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.record_event_private_view(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_event_for_view(
    p_slug TEXT,
    p_access_code TEXT DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    slug TEXT,
    public_slug TEXT,
    private_slug TEXT,
    join_code TEXT,
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
    v_requested_slug TEXT := trim(coalesce(p_slug, ''));
    v_private_slug TEXT;
    v_visibility TEXT;
    v_is_host BOOLEAN := false;
    v_has_access_code BOOLEAN := false;
    v_is_shared BOOLEAN := false;
    v_is_attendee BOOLEAN := false;
    v_is_private_slug BOOLEAN := false;
    v_has_legacy_private_token BOOLEAN := false;
    v_can_view_full BOOLEAN := false;
BEGIN
    SELECT *
    INTO v_event
    FROM public.events e
    WHERE e.slug = v_requested_slug
       OR e.public_slug = v_requested_slug
       OR e.private_slug = v_requested_slug
       OR e.legacy_slug = v_requested_slug
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_private_slug := COALESCE(nullif(trim(v_event.private_slug), ''), nullif(trim(v_event.join_code), ''));
    v_is_private_slug := v_private_slug IS NOT NULL AND v_requested_slug = v_private_slug;
    v_has_legacy_private_token := nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
        AND p_access_code = v_private_slug;
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
    v_is_attendee := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = v_event.id
          AND ea.status IN ('confirmed', 'waitlist', 'pending_approval')
          AND (
              ea.user_id = auth.uid()
              OR ap.user_id = auth.uid()
          )
    );

    v_can_view_full := (
        v_visibility = 'public'
        OR v_is_host
        OR v_is_shared
        OR v_is_attendee
        OR v_is_private_slug
        OR v_has_legacy_private_token
        OR v_has_access_code
    );

    IF v_can_view_full
       AND auth.uid() IS NOT NULL
       AND NOT v_is_host
       AND (v_is_private_slug OR v_has_legacy_private_token) THEN
        BEGIN
            PERFORM public.mark_event_shared_with_me(v_event.id, 'link');
        EXCEPTION
            WHEN OTHERS THEN
                NULL;
        END;

        BEGIN
            PERFORM public.record_event_private_view(v_event.id, auth.uid());
        EXCEPTION
            WHEN OTHERS THEN
                NULL;
        END;
    END IF;

    RETURN QUERY
    SELECT
        coalesce(v_event.id, NULL),
        coalesce(v_event.public_slug, v_event.slug),
        coalesce(v_event.public_slug, v_event.slug),
        v_event.private_slug,
        v_event.join_code,
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
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_event_for_view(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_event_attendees_for_view(
    p_event_id UUID,
    p_access_code TEXT DEFAULT NULL
) RETURNS SETOF public.event_attendees AS $$
DECLARE
    v_visibility TEXT;
    v_event_access_code TEXT;
    v_private_slug TEXT;
    v_can_view BOOLEAN := false;
    v_is_shared BOOLEAN := false;
    v_is_attendee BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code,
        COALESCE(nullif(trim(e.private_slug), ''), nullif(trim(e.join_code), ''))
    INTO
        v_visibility,
        v_event_access_code,
        v_private_slug
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

    v_is_attendee := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status IN ('confirmed', 'waitlist', 'pending_approval')
          AND (
              ea.user_id = auth.uid()
              OR ap.user_id = auth.uid()
          )
    );

    v_can_view := v_visibility = 'public'
        OR (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
        OR v_is_shared
        OR v_is_attendee
        OR (
            nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
            AND (
                p_access_code = v_event_access_code
                OR p_access_code = coalesce(v_private_slug, '')
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
    v_private_slug TEXT;
    v_can_view_named BOOLEAN := false;
    v_is_shared BOOLEAN := false;
    v_is_attendee BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code,
        COALESCE(nullif(trim(e.private_slug), ''), nullif(trim(e.join_code), ''))
    INTO
        v_visibility,
        v_event_access_code,
        v_private_slug
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

    v_is_attendee := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status IN ('confirmed', 'waitlist', 'pending_approval')
          AND (
              ea.user_id = auth.uid()
              OR ap.user_id = auth.uid()
          )
    );

    v_can_view_named := (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
        OR v_is_shared
        OR v_is_attendee
        OR (
            nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
            AND (
                p_access_code = v_event_access_code
                OR p_access_code = coalesce(v_private_slug, '')
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

CREATE OR REPLACE FUNCTION public.host_list_event_access_log(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    email TEXT,
    whatsapp_number TEXT,
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    view_count INTEGER
) AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to view event access log';
    END IF;

    RETURN QUERY
    WITH profiles AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.email,
            ap.whatsapp_number,
            ap.updated_at,
            ap.created_at
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (
            SELECT l.viewer_user_id
            FROM public.event_private_audience_log l
            WHERE l.event_id = p_event_id
        )
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    )
    SELECT
        l.viewer_user_id AS user_id,
        COALESCE(
            NULLIF(trim(p.full_name), ''),
            NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
            NULLIF(trim(regexp_replace(split_part(COALESCE(p.email, ''), '@', 1), '[._-]+', ' ', 'g')), ''),
            'Community member'
        ) AS display_name,
        p.email,
        p.whatsapp_number,
        l.first_seen_at,
        l.last_seen_at,
        l.view_count
    FROM public.event_private_audience_log l
    LEFT JOIN profiles p ON p.user_id = l.viewer_user_id
    WHERE l.event_id = p_event_id
    ORDER BY l.last_seen_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_event_access_log(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_list_share_suggestions(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    email TEXT,
    whatsapp_number TEXT,
    attended_previous BOOLEAN,
    viewed_previous BOOLEAN,
    engagement_tag TEXT,
    already_shared BOOLEAN,
    selected_by_default BOOLEAN
) AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to list share suggestions';
    END IF;

    RETURN QUERY
    WITH hosted_events AS (
        SELECT e.id AS event_id
        FROM public.events e
        WHERE e.host_user_id = auth.uid()
        UNION
        SELECT eh.event_id
        FROM public.event_hosts eh
        WHERE eh.user_id = auth.uid()
    ),
    attended_users AS (
        SELECT DISTINCT COALESCE(ea.user_id, ap.user_id) AS user_id
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id IN (SELECT he.event_id FROM hosted_events he)
          AND ea.status <> 'cancelled'
          AND COALESCE(ea.user_id, ap.user_id) IS NOT NULL
    ),
    viewed_users AS (
        SELECT DISTINCT l.viewer_user_id AS user_id
        FROM public.event_private_audience_log l
        WHERE l.event_id IN (SELECT he.event_id FROM hosted_events he)
    ),
    combined AS (
        SELECT
            u.user_id,
            bool_or(u.attended_flag) AS attended_previous,
            bool_or(u.viewed_flag) AS viewed_previous
        FROM (
            SELECT au.user_id, TRUE AS attended_flag, FALSE AS viewed_flag
            FROM attended_users au
            UNION ALL
            SELECT vu.user_id, FALSE AS attended_flag, TRUE AS viewed_flag
            FROM viewed_users vu
        ) u
        GROUP BY u.user_id
    ),
    profiles AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.email,
            ap.whatsapp_number,
            ap.updated_at,
            ap.created_at
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (SELECT c.user_id FROM combined c)
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    )
    SELECT
        c.user_id,
        COALESCE(
            NULLIF(trim(p.full_name), ''),
            NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
            NULLIF(trim(regexp_replace(split_part(COALESCE(p.email, ''), '@', 1), '[._-]+', ' ', 'g')), ''),
            'Community member'
        ) AS display_name,
        p.email,
        p.whatsapp_number,
        c.attended_previous,
        c.viewed_previous,
        CASE
            WHEN c.attended_previous THEN 'attended'
            WHEN c.viewed_previous THEN 'viewed_private'
            ELSE 'viewed_private'
        END AS engagement_tag,
        EXISTS (
            SELECT 1
            FROM public.event_shared_with_users es
            WHERE es.event_id = p_event_id
              AND es.user_id = c.user_id
        ) AS already_shared,
        c.attended_previous AND NOT EXISTS (
            SELECT 1
            FROM public.event_shared_with_users es
            WHERE es.event_id = p_event_id
              AND es.user_id = c.user_id
        ) AS selected_by_default
    FROM combined c
    LEFT JOIN profiles p ON p.user_id = c.user_id
    WHERE c.user_id <> auth.uid()
      AND NOT public.is_event_host(p_event_id, c.user_id)
    ORDER BY
        c.attended_previous DESC,
        c.viewed_previous DESC,
        COALESCE(
            NULLIF(trim(p.full_name), ''),
            NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
            p.email,
            c.user_id::TEXT
        ) ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_share_suggestions(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_public_calendar_events(
    p_now TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE (
    id UUID,
    slug TEXT,
    title TEXT,
    location_text TEXT,
    public_location_text TEXT,
    starts_at TIMESTAMPTZ,
    timezone TEXT,
    duration_minutes INTEGER,
    capacity INTEGER,
    visibility TEXT,
    is_public BOOLEAN,
    public_discovery_enabled BOOLEAN,
    status TEXT,
    access_code TEXT,
    confirmed_count INTEGER,
    thinking_count INTEGER
) AS $$
    SELECT
        e.id,
        COALESCE(e.public_slug, e.slug) AS slug,
        e.title,
        CASE
            WHEN COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'semi_public' THEN NULL
            ELSE e.location_text
        END AS location_text,
        e.public_location_text,
        e.starts_at,
        e.timezone,
        e.duration_minutes,
        e.capacity,
        e.visibility,
        e.is_public,
        e.public_discovery_enabled,
        e.status,
        NULL::TEXT AS access_code,
        (
            SELECT count(*)::INTEGER
            FROM public.event_attendees ea
            WHERE ea.event_id = e.id
              AND ea.status = 'confirmed'
        ) AS confirmed_count,
        (
            SELECT count(*)::INTEGER
            FROM public.event_interests ei
            WHERE ei.event_id = e.id
        ) AS thinking_count
    FROM public.events e
    WHERE e.status = 'scheduled'
      AND e.is_public = true
      AND e.public_discovery_enabled = true
      AND e.starts_at >= COALESCE(p_now, now())
    ORDER BY e.starts_at ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_public_calendar_events(TIMESTAMPTZ) TO anon, authenticated;
