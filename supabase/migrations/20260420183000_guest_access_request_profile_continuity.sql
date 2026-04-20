ALTER TABLE public.event_access_requests
    ADD COLUMN IF NOT EXISTS requester_attendee_profile_id UUID REFERENCES public.attendee_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_access_requests_requester_attendee_profile_id_idx
    ON public.event_access_requests (requester_attendee_profile_id);

DROP FUNCTION IF EXISTS public.get_event_for_view(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_event_for_view(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_event_for_view(
    p_slug TEXT,
    p_access_code TEXT DEFAULT NULL,
    p_session_token TEXT DEFAULT NULL
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
    participation_mode TEXT,
    interest_visibility TEXT,
    origin_type TEXT,
    source_attribution_label TEXT,
    source_url TEXT,
    source_last_checked_at TIMESTAMPTZ,
    trust_badge TEXT,
    external_contact_mode TEXT,
    external_contact_value TEXT,
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
    v_guest_profile_id UUID := NULL;
    v_has_profile_approved_access BOOLEAN := false;
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

    IF nullif(trim(coalesce(p_session_token, '')), '') IS NOT NULL THEN
        SELECT s.attendee_profile_id
        INTO v_guest_profile_id
        FROM public.attendee_sessions s
        WHERE s.token = trim(p_session_token)
          AND s.expires_at > now()
        LIMIT 1;
    END IF;

    v_private_slug := COALESCE(nullif(trim(v_event.private_slug), ''), nullif(trim(v_event.join_code), ''));
    v_is_private_slug := v_private_slug IS NOT NULL AND v_requested_slug = v_private_slug;
    v_has_legacy_private_token := nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
        AND p_access_code = v_private_slug;
    v_visibility := COALESCE(v_event.visibility, CASE WHEN v_event.is_public THEN 'public' ELSE 'private' END);
    v_is_host := auth.uid() IS NOT NULL AND public.is_event_host(v_event.id, auth.uid());
    v_has_access_code := nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
        AND p_access_code = v_event.access_code;
    v_is_shared := auth.uid() IS NOT NULL AND public.is_event_shared_with_user_active(v_event.id, auth.uid());
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
    v_has_profile_approved_access := v_guest_profile_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_access_requests ear
        WHERE ear.event_id = v_event.id
          AND ear.status = 'approved'
          AND ear.requester_attendee_profile_id = v_guest_profile_id
    );

    v_can_view_full := (
        v_visibility = 'public'
        OR v_is_host
        OR v_is_shared
        OR v_is_attendee
        OR v_has_profile_approved_access
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
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.private_slug
        END,
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.join_code
        END,
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
        coalesce(v_event.participation_mode, 'rsvp'),
        coalesce(v_event.interest_visibility, 'count_only'),
        coalesce(v_event.origin_type, 'host_created'),
        v_event.source_attribution_label,
        v_event.source_url,
        v_event.source_last_checked_at,
        v_event.trust_badge,
        v_event.external_contact_mode,
        v_event.external_contact_value,
        v_event.is_public,
        v_event.public_discovery_enabled,
        CASE
            WHEN v_is_host THEN v_event.moderation_status
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_risk_level
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_action
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_confidence
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_reasons
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_input_hash
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderated_at
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_archived_at
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_override
            ELSE NULL
        END,
        v_event.status,
        v_event.created_at,
        v_event.updated_at,
        v_can_view_full;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_event_for_view(TEXT, TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.list_event_attendees_for_view(UUID, TEXT);
DROP FUNCTION IF EXISTS public.list_event_attendees_for_view(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.list_event_attendees_for_view(
    p_event_id UUID,
    p_access_code TEXT DEFAULT NULL,
    p_session_token TEXT DEFAULT NULL
) RETURNS SETOF public.event_attendees AS $$
DECLARE
    v_visibility TEXT;
    v_event_access_code TEXT;
    v_private_slug TEXT;
    v_guest_profile_id UUID := NULL;
    v_has_profile_approved_access BOOLEAN := false;
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

    IF nullif(trim(coalesce(p_session_token, '')), '') IS NOT NULL THEN
        SELECT s.attendee_profile_id
        INTO v_guest_profile_id
        FROM public.attendee_sessions s
        WHERE s.token = trim(p_session_token)
          AND s.expires_at > now()
        LIMIT 1;
    END IF;

    v_is_shared := auth.uid() IS NOT NULL AND public.is_event_shared_with_user_active(p_event_id, auth.uid());

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

    v_has_profile_approved_access := v_guest_profile_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_access_requests ear
        WHERE ear.event_id = p_event_id
          AND ear.status = 'approved'
          AND ear.requester_attendee_profile_id = v_guest_profile_id
    );

    v_can_view := v_visibility = 'public'
        OR (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
        OR v_is_shared
        OR v_is_attendee
        OR v_has_profile_approved_access
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

GRANT EXECUTE ON FUNCTION public.list_event_attendees_for_view(UUID, TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.list_event_interests_for_view(UUID, TEXT);
DROP FUNCTION IF EXISTS public.list_event_interests_for_view(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.list_event_interests_for_view(
    p_event_id UUID,
    p_access_code TEXT DEFAULT NULL,
    p_session_token TEXT DEFAULT NULL
) RETURNS SETOF public.event_interests AS $$
DECLARE
    v_visibility TEXT;
    v_event_access_code TEXT;
    v_private_slug TEXT;
    v_guest_profile_id UUID := NULL;
    v_has_profile_approved_access BOOLEAN := false;
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

    IF nullif(trim(coalesce(p_session_token, '')), '') IS NOT NULL THEN
        SELECT s.attendee_profile_id
        INTO v_guest_profile_id
        FROM public.attendee_sessions s
        WHERE s.token = trim(p_session_token)
          AND s.expires_at > now()
        LIMIT 1;
    END IF;

    v_is_shared := auth.uid() IS NOT NULL AND public.is_event_shared_with_user_active(p_event_id, auth.uid());

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

    v_has_profile_approved_access := v_guest_profile_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_access_requests ear
        WHERE ear.event_id = p_event_id
          AND ear.status = 'approved'
          AND ear.requester_attendee_profile_id = v_guest_profile_id
    );

    v_can_view_named := (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
        OR v_is_shared
        OR v_is_attendee
        OR v_has_profile_approved_access
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

GRANT EXECUTE ON FUNCTION public.list_event_interests_for_view(UUID, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.merge_attendee_profiles(
    p_source_profile_id UUID,
    p_target_profile_id UUID,
    p_session_token TEXT DEFAULT NULL
) RETURNS public.attendee_profiles AS $$
DECLARE
    v_source public.attendee_profiles%ROWTYPE;
    v_target public.attendee_profiles%ROWTYPE;
    v_is_authorized BOOLEAN := false;
    v_source_name TEXT;
    v_target_name TEXT;
BEGIN
    IF p_source_profile_id IS NULL OR p_target_profile_id IS NULL THEN
        RAISE EXCEPTION 'Missing profile ids';
    END IF;

    IF p_source_profile_id = p_target_profile_id THEN
        SELECT *
        INTO v_target
        FROM public.attendee_profiles
        WHERE id = p_target_profile_id;

        IF v_target.id IS NULL THEN
            RAISE EXCEPTION 'Profile not found';
        END IF;

        RETURN v_target;
    END IF;

    SELECT *
    INTO v_source
    FROM public.attendee_profiles
    WHERE id = p_source_profile_id
    FOR UPDATE;

    SELECT *
    INTO v_target
    FROM public.attendee_profiles
    WHERE id = p_target_profile_id
    FOR UPDATE;

    IF v_source.id IS NULL OR v_target.id IS NULL THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF auth.uid() IS NOT NULL THEN
        v_is_authorized := auth.uid() = v_source.user_id OR auth.uid() = v_target.user_id;
    ELSIF nullif(trim(coalesce(p_session_token, '')), '') IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.attendee_sessions s
            WHERE s.token = trim(p_session_token)
              AND s.expires_at > now()
              AND s.attendee_profile_id IN (p_source_profile_id, p_target_profile_id)
        )
        INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Not authorized to merge these profiles';
    END IF;

    v_source_name := trim(concat_ws(' ', v_source.first_name, v_source.last_name));
    v_target_name := trim(concat_ws(' ', v_target.first_name, v_target.last_name));

    DELETE FROM public.event_interests src
    WHERE src.attendee_profile_id = p_source_profile_id
      AND EXISTS (
        SELECT 1
        FROM public.event_interests tgt
        WHERE tgt.attendee_profile_id = p_target_profile_id
          AND tgt.event_id = src.event_id
      );

    DELETE FROM public.event_join_requests src
    WHERE src.attendee_profile_id = p_source_profile_id
      AND src.status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM public.event_join_requests tgt
        WHERE tgt.attendee_profile_id = p_target_profile_id
          AND tgt.event_id = src.event_id
          AND tgt.status = 'pending'
      );

    UPDATE public.event_attendees
    SET attendee_profile_id = p_target_profile_id
    WHERE attendee_profile_id = p_source_profile_id;

    UPDATE public.event_attendees
    SET added_by_attendee_profile_id = p_target_profile_id
    WHERE added_by_attendee_profile_id = p_source_profile_id;

    UPDATE public.event_interests
    SET attendee_profile_id = p_target_profile_id
    WHERE attendee_profile_id = p_source_profile_id;

    UPDATE public.event_join_requests
    SET attendee_profile_id = p_target_profile_id
    WHERE attendee_profile_id = p_source_profile_id;

    UPDATE public.event_access_requests
    SET requester_attendee_profile_id = p_target_profile_id
    WHERE requester_attendee_profile_id = p_source_profile_id;

    UPDATE public.attendee_sessions
    SET attendee_profile_id = p_target_profile_id
    WHERE attendee_profile_id = p_source_profile_id;

    UPDATE public.attendee_profiles
    SET
        user_id = COALESCE(v_target.user_id, v_source.user_id),
        email = COALESCE(nullif(trim(coalesce(v_target.email, '')), ''), nullif(trim(coalesce(v_source.email, '')), '')),
        first_name = CASE
            WHEN v_target_name = '' AND v_source_name <> '' THEN v_source.first_name
            ELSE v_target.first_name
        END,
        last_name = CASE
            WHEN v_target_name = '' AND v_source_name <> '' THEN v_source.last_name
            ELSE v_target.last_name
        END,
        auth_provider = COALESCE(nullif(trim(coalesce(v_target.auth_provider, '')), ''), nullif(trim(coalesce(v_source.auth_provider, '')), '')),
        lalo_user_id = COALESCE(v_target.lalo_user_id, v_source.lalo_user_id),
        whatsapp_number = COALESCE(nullif(trim(coalesce(v_target.whatsapp_number, '')), ''), nullif(trim(coalesce(v_source.whatsapp_number, '')), '')),
        whatsapp_verified_at = COALESCE(v_target.whatsapp_verified_at, v_source.whatsapp_verified_at),
        updated_at = now()
    WHERE id = p_target_profile_id
    RETURNING * INTO v_target;

    DELETE FROM public.attendee_profiles
    WHERE id = p_source_profile_id;

    RETURN v_target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
