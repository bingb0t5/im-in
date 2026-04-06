CREATE OR REPLACE FUNCTION public.generate_event_public_id()
RETURNS TEXT AS $$
DECLARE
    v_alphabet CONSTANT TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    v_alphabet_len CONSTANT INTEGER := length(v_alphabet);
    v_candidate TEXT;
    v_idx INTEGER;
    i INTEGER;
BEGIN
    LOOP
        v_candidate := '';
        FOR i IN 1..8 LOOP
            v_idx := floor(random() * v_alphabet_len)::INTEGER + 1;
            v_candidate := v_candidate || substr(v_alphabet, v_idx, 1);
        END LOOP;

        EXIT WHEN NOT EXISTS (
            SELECT 1
            FROM public.events e
            WHERE e.slug = v_candidate
               OR e.join_code = v_candidate
               OR e.legacy_slug = v_candidate
        );
    END LOOP;

    RETURN v_candidate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.generate_event_join_code()
RETURNS TEXT AS $$
BEGIN
    RETURN public.generate_event_public_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

ALTER TABLE public.events
    ALTER COLUMN join_code SET DEFAULT public.generate_event_join_code();

CREATE OR REPLACE FUNCTION public.sync_event_slug_and_join_code()
RETURNS trigger AS $$
DECLARE
    v_public_id TEXT;
BEGIN
    IF nullif(trim(coalesce(NEW.join_code, '')), '') IS NULL
       AND nullif(trim(coalesce(NEW.slug, '')), '') IS NULL THEN
        v_public_id := public.generate_event_public_id();
        NEW.slug := v_public_id;
        NEW.join_code := v_public_id;
        RETURN NEW;
    END IF;

    IF nullif(trim(coalesce(NEW.join_code, '')), '') IS NULL THEN
        NEW.slug := trim(coalesce(NEW.slug, ''));
        NEW.join_code := NEW.slug;
        RETURN NEW;
    END IF;

    NEW.join_code := trim(coalesce(NEW.join_code, ''));
    NEW.slug := NEW.join_code;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sync_event_slug_and_join_code_on_events ON public.events;

CREATE TRIGGER sync_event_slug_and_join_code_on_events
BEFORE INSERT OR UPDATE OF slug, join_code
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.sync_event_slug_and_join_code();

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
    WHERE e.join_code = trim(coalesce(p_join_code, ''))
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
    v_requested_slug TEXT := trim(coalesce(p_slug, ''));
    v_visibility TEXT;
    v_is_host BOOLEAN := false;
    v_has_access_code BOOLEAN := false;
    v_is_shared BOOLEAN := false;
    v_can_view_full BOOLEAN := false;
BEGIN
    SELECT *
    INTO v_event
    FROM public.events e
    WHERE e.slug = v_requested_slug
       OR e.legacy_slug = v_requested_slug
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
