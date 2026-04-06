-- Privacy contract for get_event_for_view:
-- 1) Public moderation/transparency preview callers must never receive private-share secrets.
-- 2) Semi-public callers without full access must only receive public-facing preview fields.
-- 3) Moderation internals are host-only and should not be exposed to public/transparency clients.
-- 4) Any future edits must preserve these redaction guarantees at the SQL layer (not UI-only).
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

GRANT EXECUTE ON FUNCTION public.get_event_for_view(TEXT, TEXT) TO anon, authenticated;
