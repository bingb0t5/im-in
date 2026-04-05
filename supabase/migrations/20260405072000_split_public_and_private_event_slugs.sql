ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS public_slug TEXT,
    ADD COLUMN IF NOT EXISTS private_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS events_public_slug_uidx
    ON public.events (public_slug)
    WHERE public_slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS events_private_slug_uidx
    ON public.events (private_slug)
    WHERE private_slug IS NOT NULL;

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
               OR e.public_slug = v_candidate
               OR e.private_slug = v_candidate
        );
    END LOOP;

    RETURN v_candidate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

UPDATE public.events
SET private_slug = coalesce(nullif(trim(private_slug), ''), nullif(trim(join_code), ''), nullif(trim(slug), ''), public.generate_event_public_id())
WHERE private_slug IS NULL OR btrim(private_slug) = '';

UPDATE public.events
SET join_code = private_slug
WHERE join_code IS NULL OR join_code <> private_slug;

CREATE OR REPLACE FUNCTION public.generate_distinct_public_slug(p_private_slug TEXT)
RETURNS TEXT AS $$
DECLARE
    v_slug TEXT;
BEGIN
    LOOP
        v_slug := public.generate_event_public_id();
        EXIT WHEN v_slug <> p_private_slug;
    END LOOP;
    RETURN v_slug;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

UPDATE public.events
SET public_slug = coalesce(nullif(trim(public_slug), ''), public.generate_distinct_public_slug(private_slug))
WHERE public_slug IS NULL OR btrim(public_slug) = '';

UPDATE public.events
SET public_slug = public.generate_distinct_public_slug(private_slug)
WHERE public_slug = private_slug;

UPDATE public.events
SET slug = public_slug
WHERE slug IS DISTINCT FROM public_slug;

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
BEGIN
    NEW.public_slug := nullif(trim(coalesce(NEW.public_slug, NEW.slug, '')), '');
    NEW.private_slug := nullif(trim(coalesce(NEW.private_slug, NEW.join_code, '')), '');

    IF NEW.private_slug IS NULL THEN
        NEW.private_slug := public.generate_event_public_id();
    END IF;

    IF NEW.public_slug IS NULL THEN
        NEW.public_slug := public.generate_distinct_public_slug(NEW.private_slug);
    END IF;

    IF NEW.public_slug = NEW.private_slug THEN
        NEW.public_slug := public.generate_distinct_public_slug(NEW.private_slug);
    END IF;

    NEW.join_code := NEW.private_slug;
    NEW.slug := NEW.public_slug;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sync_event_slug_and_join_code_on_events ON public.events;

CREATE TRIGGER sync_event_slug_and_join_code_on_events
BEFORE INSERT OR UPDATE OF slug, join_code, public_slug, private_slug
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.sync_event_slug_and_join_code();

DROP FUNCTION IF EXISTS public.share_event_by_join_code(TEXT);

CREATE OR REPLACE FUNCTION public.share_event_by_join_code(
    p_join_code TEXT
) RETURNS TABLE (
    id UUID,
    slug TEXT,
    public_slug TEXT,
    private_slug TEXT,
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
        v_event.public_slug,
        v_event.private_slug,
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

DROP FUNCTION IF EXISTS public.get_event_for_view(TEXT, TEXT);

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
    v_visibility TEXT;
    v_is_host BOOLEAN := false;
    v_has_access_code BOOLEAN := false;
    v_is_shared BOOLEAN := false;
    v_is_private_slug BOOLEAN := false;
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

    v_is_private_slug := v_requested_slug = coalesce(v_event.private_slug, '');
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
        OR (
            v_visibility = 'semi_public'
            AND (v_is_host OR v_has_access_code OR v_is_shared OR v_is_private_slug)
        );

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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

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
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code,
        e.private_slug
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

    v_can_view := v_visibility = 'public'
        OR v_visibility = 'private'
        OR (
            v_visibility = 'semi_public'
            AND (
                (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
                OR v_is_shared
                OR (
                    nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
                    AND (
                        p_access_code = v_event_access_code
                        OR p_access_code = coalesce(v_private_slug, '')
                    )
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
    v_private_slug TEXT;
    v_can_view_named BOOLEAN := false;
    v_is_shared BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code,
        e.private_slug
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

    v_can_view_named := v_visibility = 'private'
        OR (
            v_visibility = 'semi_public'
            AND (
                (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
                OR v_is_shared
                OR (
                    nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
                    AND (
                        p_access_code = v_event_access_code
                        OR p_access_code = coalesce(v_private_slug, '')
                    )
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
