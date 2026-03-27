# Supabase SQL Migration

-- 1. Tables

CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    public_summary TEXT,
    location_text TEXT,
    public_location_text TEXT,
    google_maps_url TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes >= 15 AND duration_minutes <= 360 AND duration_minutes % 15 = 0),
    ends_at TIMESTAMPTZ,
    capacity INTEGER NOT NULL,
    host_user_id UUID REFERENCES auth.users(id),
    host_name TEXT,
    host_contact_text TEXT,
    show_host_publicly BOOLEAN DEFAULT false,
    access_code TEXT DEFAULT gen_random_uuid()::text,
    visibility TEXT CHECK (visibility IN ('public', 'semi_public', 'private')) DEFAULT 'semi_public',
    allow_waitlist BOOLEAN DEFAULT true,
    is_public BOOLEAN DEFAULT false,
    public_discovery_enabled BOOLEAN NOT NULL DEFAULT false,
    moderation_status TEXT NOT NULL DEFAULT 'not_required' CHECK (moderation_status IN ('not_required', 'pending', 'approved', 'limited', 'review', 'blocked', 'error')),
    moderation_risk_level TEXT CHECK (moderation_risk_level IS NULL OR moderation_risk_level IN ('low', 'medium', 'high')),
    moderation_action TEXT CHECK (moderation_action IS NULL OR moderation_action IN ('allow', 'limit_visibility', 'require_review', 'block')),
    moderation_confidence NUMERIC(4,3),
    moderation_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    moderation_input_hash TEXT,
    moderated_at TIMESTAMPTZ,
    moderation_archived_at TIMESTAMPTZ,
    moderation_override TEXT CHECK (moderation_override IS NULL OR moderation_override IN ('force_visible', 'force_limited', 'hide', 'mark_safe', 'mark_spam')),
    status TEXT CHECK (status IN ('scheduled', 'cancelled', 'completed')) DEFAULT 'scheduled',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_attendees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    status TEXT CHECK (status IN ('confirmed', 'waitlist', 'cancelled')) NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT now(),
    promoted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    UNIQUE(event_id, guest_email)
);

CREATE TABLE IF NOT EXISTS public.event_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    added_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.event_waitlist_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    attendee_id UUID REFERENCES public.event_attendees(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, attendee_id),
    UNIQUE(event_id, position)
);

CREATE TABLE IF NOT EXISTS public.event_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    requester_name TEXT NOT NULL,
    requester_whatsapp TEXT NOT NULL,
    requester_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'contacted')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.moderator_public_identities (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    public_handle TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.moderator_public_identities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.public_moderation_log_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type TEXT NOT NULL DEFAULT 'activity' CHECK (target_type IN ('activity')),
    target_id UUID NOT NULL,
    target_visibility_snapshot TEXT NOT NULL CHECK (target_visibility_snapshot IN ('public', 'semi_public')),
    public_title_snapshot TEXT,
    public_slug_snapshot TEXT,
    action TEXT NOT NULL CHECK (action IN ('approved', 'denied', 'flagged', 'marked_spam', 'restored', 'removed')),
    reason_code TEXT,
    public_explanation TEXT,
    moderator_public_handle TEXT NOT NULL,
    moderator_internal_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.public_moderation_log_entries ENABLE ROW LEVEL SECURITY;

CREATE SEQUENCE IF NOT EXISTS public.moderator_public_handle_seq START 1;

CREATE INDEX IF NOT EXISTS idx_public_moderation_log_entries_target_id
    ON public.public_moderation_log_entries(target_id);

CREATE INDEX IF NOT EXISTS idx_public_moderation_log_entries_created_at
    ON public.public_moderation_log_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_moderation_log_entries_action
    ON public.public_moderation_log_entries(action);

REVOKE ALL ON public.moderator_public_identities FROM anon, authenticated;
REVOKE ALL ON public.public_moderation_log_entries FROM anon, authenticated;

UPDATE public.events
SET public_discovery_enabled = CASE
    WHEN COALESCE(visibility, CASE WHEN is_public THEN 'public' ELSE 'private' END) IN ('public', 'semi_public')
        THEN true
    ELSE false
END
WHERE moderation_override IS NULL
  AND moderated_at IS NULL
  AND moderation_input_hash IS NULL;

UPDATE public.events
SET moderation_status = CASE
    WHEN COALESCE(visibility, CASE WHEN is_public THEN 'public' ELSE 'private' END) = 'private'
        THEN 'not_required'
    ELSE 'approved'
END
WHERE moderation_override IS NULL
  AND moderated_at IS NULL
  AND moderation_input_hash IS NULL;

-- 2. RLS Policies

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_waitlist_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_access_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_event_host(
    p_event_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.id = p_event_id
          AND e.host_user_id = p_user_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.event_hosts eh
        WHERE eh.event_id = p_event_id
          AND eh.user_id = p_user_id
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_event_host(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_host_count(
    p_event_id UUID
) RETURNS INTEGER AS $$
    SELECT count(*)::INTEGER
    FROM public.event_hosts eh
    WHERE eh.event_id = p_event_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.event_host_count(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_or_create_public_moderator_handle(
    p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
    existing_handle TEXT;
    next_number BIGINT;
    new_handle TEXT;
BEGIN
    SELECT mpi.public_handle
    INTO existing_handle
    FROM public.moderator_public_identities mpi
    WHERE mpi.user_id = p_user_id;

    IF existing_handle IS NOT NULL THEN
        RETURN existing_handle;
    END IF;

    next_number := nextval('public.moderator_public_handle_seq');
    new_handle := 'Moderator ' || lpad(next_number::TEXT, 2, '0');

    INSERT INTO public.moderator_public_identities (user_id, public_handle)
    VALUES (p_user_id, new_handle)
    ON CONFLICT (user_id) DO UPDATE
    SET public_handle = public.moderator_public_identities.public_handle;

    RETURN (
        SELECT mpi.public_handle
        FROM public.moderator_public_identities mpi
        WHERE mpi.user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_or_create_public_moderator_handle(UUID) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_public_moderation_log(
    p_action TEXT DEFAULT NULL,
    p_target_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 30,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    id UUID,
    target_type TEXT,
    target_id UUID,
    target_visibility_snapshot TEXT,
    public_title_snapshot TEXT,
    public_slug_snapshot TEXT,
    action TEXT,
    reason_code TEXT,
    public_explanation TEXT,
    moderator_public_handle TEXT,
    created_at TIMESTAMPTZ
) AS $$
    SELECT
        entry.id,
        entry.target_type,
        entry.target_id,
        entry.target_visibility_snapshot,
        entry.public_title_snapshot,
        entry.public_slug_snapshot,
        entry.action,
        entry.reason_code,
        entry.public_explanation,
        entry.moderator_public_handle,
        entry.created_at
    FROM public.public_moderation_log_entries entry
    WHERE (p_action IS NULL OR entry.action = p_action)
      AND (p_target_id IS NULL OR entry.target_id = p_target_id)
      AND entry.target_visibility_snapshot IN ('public', 'semi_public')
    ORDER BY entry.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_public_moderation_log(TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_read_event_row(
    p_event_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.id = p_event_id
          AND COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'public'
    ) THEN
        RETURN true;
    END IF;

    IF v_user_id IS NULL AND v_email = '' THEN
        RETURN false;
    END IF;

    IF v_user_id IS NOT NULL AND public.is_event_host(p_event_id, v_user_id) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap
          ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status <> 'cancelled'
          AND (
              (v_user_id IS NOT NULL AND ea.user_id = v_user_id)
              OR (v_user_id IS NOT NULL AND ap.user_id = v_user_id)
              OR (v_email <> '' AND lower(coalesce(ea.guest_email, '')) = v_email)
          )
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.event_interests ei
        LEFT JOIN public.attendee_profiles ap
          ON ap.id = ei.attendee_profile_id
        WHERE ei.event_id = p_event_id
          AND (
              (v_user_id IS NOT NULL AND ei.user_id = v_user_id)
              OR (v_user_id IS NOT NULL AND ap.user_id = v_user_id)
              OR (v_email <> '' AND lower(coalesce(ei.guest_email, '')) = v_email)
          )
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.can_read_event_row(UUID) TO anon, authenticated;

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

    v_can_view_full := v_visibility = 'public'
        OR v_visibility = 'private'
        OR (v_visibility = 'semi_public' AND (v_is_host OR v_has_access_code));

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
        e.slug,
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
        CASE
            WHEN COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'semi_public'
                AND public.can_read_event_row(e.id)
                THEN e.access_code
            ELSE NULL
        END AS access_code,
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

CREATE OR REPLACE FUNCTION public.count_hidden_upcoming_activities(
    p_now TIMESTAMPTZ DEFAULT now(),
    p_week_ahead TIMESTAMPTZ DEFAULT now() + interval '7 days'
) RETURNS INTEGER AS $$
    SELECT count(*)::INTEGER
    FROM public.events e
    WHERE e.status = 'scheduled'
      AND e.starts_at >= COALESCE(p_now, now())
      AND e.starts_at < COALESCE(p_week_ahead, now() + interval '7 days')
      AND COALESCE(e.moderation_override, '') <> 'mark_spam'
      AND NOT (e.is_public = true AND coalesce(e.public_discovery_enabled, false) = true);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.count_hidden_upcoming_activities(TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_event_attendees_for_view(
    p_event_id UUID,
    p_access_code TEXT DEFAULT NULL
) RETURNS SETOF public.event_attendees AS $$
DECLARE
    v_visibility TEXT;
    v_event_access_code TEXT;
    v_can_view BOOLEAN := false;
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

    v_can_view := v_visibility = 'public'
        OR v_visibility = 'private'
        OR (
            v_visibility = 'semi_public'
            AND (
                (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
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

    v_can_view_named := v_visibility = 'private'
        OR (
            v_visibility = 'semi_public'
            AND (
                (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
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

CREATE OR REPLACE FUNCTION public.get_guest_bookings(
    p_session_token TEXT
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    guest_name TEXT,
    guest_email TEXT,
    status TEXT,
    joined_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    events JSONB
) AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    SELECT s.attendee_profile_id
    INTO v_profile_id
    FROM public.attendee_sessions s
    WHERE s.token = p_session_token
      AND s.expires_at > now()
    LIMIT 1;

    IF v_profile_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        ea.id,
        ea.event_id,
        ea.user_id,
        ea.attendee_profile_id,
        ea.guest_name,
        ea.guest_email,
        ea.status,
        ea.joined_at,
        ea.promoted_at,
        ea.cancelled_at,
        to_jsonb(e) AS events
    FROM public.event_attendees ea
    JOIN public.events e
      ON e.id = ea.event_id
    WHERE ea.attendee_profile_id = v_profile_id
      AND ea.status <> 'cancelled'
    ORDER BY ea.joined_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_guest_bookings(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_guest_interests(
    p_session_token TEXT
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    guest_name TEXT,
    guest_email TEXT,
    visibility_mode TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    status TEXT,
    events JSONB
) AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    SELECT s.attendee_profile_id
    INTO v_profile_id
    FROM public.attendee_sessions s
    WHERE s.token = p_session_token
      AND s.expires_at > now()
    LIMIT 1;

    IF v_profile_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        ei.id,
        ei.event_id,
        ei.user_id,
        ei.attendee_profile_id,
        ei.guest_name,
        ei.guest_email,
        ei.visibility_mode,
        ei.created_at,
        ei.updated_at,
        'thinking'::TEXT AS status,
        to_jsonb(e) AS events
    FROM public.event_interests ei
    JOIN public.events e
      ON e.id = ei.event_id
    WHERE ei.attendee_profile_id = v_profile_id
    ORDER BY ei.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_guest_interests(TEXT) TO anon, authenticated;

-- Events: public rows are readable broadly, everything else needs explicit membership/host access
CREATE POLICY "Viewable events are readable" ON public.events
    FOR SELECT USING (
        COALESCE(events.visibility, CASE WHEN events.is_public THEN 'public' ELSE 'private' END) = 'public'
        OR (
            auth.uid() IS NOT NULL
            AND auth.uid() = events.host_user_id
        )
        OR public.can_read_event_row(events.id)
    );

CREATE POLICY "Hosts can create events" ON public.events
    FOR INSERT WITH CHECK (auth.uid() = host_user_id);

CREATE POLICY "Hosts can update their own events" ON public.events
    FOR UPDATE USING (
        auth.uid() = host_user_id
        OR auth.uid() IN (
            SELECT eh.user_id
            FROM public.event_hosts eh
            WHERE eh.event_id = events.id
        )
    );

-- Attendees: public attendee previews stay public for public activities; private/semi-private rows need membership
CREATE POLICY "Public attendees are viewable for public activities" ON public.event_attendees
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.events e
            WHERE e.id = event_attendees.event_id
              AND COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'public'
        )
    );

CREATE POLICY "Hosts and members can view attendee rows" ON public.event_attendees
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND (
            public.is_event_host(event_id, auth.uid())
            OR user_id = auth.uid()
            OR attendee_profile_id IN (
                SELECT ap.id
                FROM public.attendee_profiles ap
                WHERE ap.user_id = auth.uid()
            )
            OR lower(coalesce(guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );

CREATE POLICY "Anyone can RSVP" ON public.event_attendees
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Hosts or owners can update attendee status" ON public.event_attendees
    FOR UPDATE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        ) OR auth.uid() IN (
            SELECT eh.user_id FROM public.event_hosts eh WHERE eh.event_id = event_id
        ) OR auth.uid() = user_id
    );

CREATE POLICY "Hosts can delete their own events" ON public.events
    FOR DELETE USING (
        auth.uid() = host_user_id
        OR auth.uid() IN (
            SELECT eh.user_id
            FROM public.event_hosts eh
            WHERE eh.event_id = events.id
        )
    );

CREATE POLICY "Hosts can delete attendees" ON public.event_attendees
    FOR DELETE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        )
        OR auth.uid() IN (
            SELECT eh.user_id FROM public.event_hosts eh WHERE eh.event_id = event_id
        )
    );

CREATE POLICY "Hosts can view event host rows" ON public.event_hosts
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND public.is_event_host(event_id, auth.uid())
    );

CREATE POLICY "Hosts can add co-host rows" ON public.event_hosts
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND public.is_event_host(event_id, auth.uid())
    );

CREATE POLICY "Hosts can leave their own host row" ON public.event_hosts
    FOR DELETE USING (
        auth.uid() = user_id
        AND public.event_host_count(event_id) > 1
    );

-- Waitlist positions follow the same boundary as attendee access
CREATE POLICY "Viewable waitlist positions" ON public.event_waitlist_positions
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.events e
            WHERE e.id = event_waitlist_positions.event_id
              AND (
                  COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'public'
                  OR public.can_read_event_row(e.id)
              )
        )
    );

CREATE POLICY "Anyone can create event access requests" ON public.event_access_requests
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Hosts can view event access requests" ON public.event_access_requests
    FOR SELECT USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        )
        OR auth.uid() IN (
            SELECT eh.user_id FROM public.event_hosts eh WHERE eh.event_id = event_id
        )
    );

CREATE POLICY "Hosts can update event access requests" ON public.event_access_requests
    FOR UPDATE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        )
        OR auth.uid() IN (
            SELECT eh.user_id FROM public.event_hosts eh WHERE eh.event_id = event_id
        )
    );

-- 3. Functions & Triggers

-- Function to handle waitlist promotion when someone cancels
CREATE OR REPLACE FUNCTION public.handle_attendee_cancellation()
RETURNS TRIGGER AS $$
DECLARE
    next_waitlist_id UUID;
    event_capacity INTEGER;
    current_confirmed_count INTEGER;
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status = 'confirmed' THEN
        -- Get event capacity
        SELECT capacity INTO event_capacity FROM public.events WHERE id = NEW.event_id;
        
        -- Count current confirmed (excluding the one just cancelled)
        SELECT count(*) INTO current_confirmed_count FROM public.event_attendees 
        WHERE event_id = NEW.event_id AND status = 'confirmed';

        -- If we have space, promote the first person from waitlist
        IF current_confirmed_count < event_capacity THEN
            SELECT attendee_id INTO next_waitlist_id 
            FROM public.event_waitlist_positions 
            WHERE event_id = NEW.event_id 
            ORDER BY position ASC 
            LIMIT 1;

            IF next_waitlist_id IS NOT NULL THEN
                -- Promote attendee
                UPDATE public.event_attendees 
                SET status = 'confirmed', promoted_at = now() 
                WHERE id = next_waitlist_id;

                -- Remove from waitlist positions
                DELETE FROM public.event_waitlist_positions WHERE attendee_id = next_waitlist_id;

                -- Reorder remaining waitlist positions
                UPDATE public.event_waitlist_positions
                SET position = position - 1
                WHERE event_id = NEW.event_id;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Thinking-about-it rows
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

CREATE INDEX IF NOT EXISTS events_public_discovery_status_starts_at_idx
    ON public.events (public_discovery_enabled, status, starts_at);

CREATE INDEX IF NOT EXISTS events_moderation_status_idx
    ON public.events (moderation_status);

CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_user_uidx
    ON public.event_interests (event_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_profile_uidx
    ON public.event_interests (event_id, attendee_profile_id)
    WHERE attendee_profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_email_uidx
    ON public.event_interests (event_id, lower(guest_email));

ALTER TABLE public.event_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view count-only interest rows" ON public.event_interests
    FOR SELECT USING (visibility_mode = 'count_only');

CREATE POLICY "Hosts and members can view named interest rows" ON public.event_interests
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND (
            auth.uid() IN (
                SELECT e.host_user_id
                FROM public.events e
                WHERE e.id = event_id
            )
            OR auth.uid() IN (
                SELECT eh.user_id
                FROM public.event_hosts eh
                WHERE eh.event_id = event_id
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

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.apply_event_moderation_defaults()
RETURNS TRIGGER AS $$
DECLARE
    next_visibility TEXT := COALESCE(NEW.visibility, CASE WHEN COALESCE(NEW.is_public, false) THEN 'public' ELSE 'private' END);
    should_reset BOOLEAN := false;
BEGIN
    IF NEW.moderation_reasons IS NULL THEN
        NEW.moderation_reasons := ARRAY[]::TEXT[];
    END IF;

    IF TG_OP = 'INSERT' THEN
        should_reset := next_visibility IN ('public', 'semi_public');
    ELSE
        should_reset := NEW.visibility IS DISTINCT FROM OLD.visibility;

        IF NOT should_reset THEN
            IF next_visibility = 'semi_public' THEN
                should_reset := NEW.title IS DISTINCT FROM OLD.title
                    OR NEW.public_summary IS DISTINCT FROM OLD.public_summary
                    OR NEW.public_location_text IS DISTINCT FROM OLD.public_location_text
                    OR NEW.show_host_publicly IS DISTINCT FROM OLD.show_host_publicly;
            ELSE
                should_reset := NEW.title IS DISTINCT FROM OLD.title
                    OR NEW.description IS DISTINCT FROM OLD.description
                    OR NEW.public_summary IS DISTINCT FROM OLD.public_summary
                    OR NEW.location_text IS DISTINCT FROM OLD.location_text
                    OR NEW.public_location_text IS DISTINCT FROM OLD.public_location_text
                    OR NEW.show_host_publicly IS DISTINCT FROM OLD.show_host_publicly;
            END IF;
        END IF;
    END IF;

    IF next_visibility = 'private' THEN
        NEW.public_discovery_enabled := false;
        NEW.moderation_status := 'not_required';
        NEW.moderation_risk_level := NULL;
        NEW.moderation_action := NULL;
        NEW.moderation_confidence := NULL;
        NEW.moderation_reasons := ARRAY[]::TEXT[];
        NEW.moderation_input_hash := NULL;
        NEW.moderated_at := NULL;
        NEW.moderation_archived_at := NULL;
        NEW.moderation_override := NULL;
        RETURN NEW;
    END IF;

    IF NEW.moderation_override IS NOT NULL THEN
        CASE NEW.moderation_override
            WHEN 'force_visible', 'mark_safe' THEN
                NEW.public_discovery_enabled := true;
                NEW.moderation_status := 'approved';
                NEW.moderation_action := 'allow';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'force_limited' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'limited';
                NEW.moderation_action := 'limit_visibility';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'hide' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'review';
                NEW.moderation_action := 'require_review';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'mark_spam' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'blocked';
                NEW.moderation_risk_level := 'high';
                NEW.moderation_action := 'block';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
        END CASE;
        RETURN NEW;
    END IF;

    IF should_reset THEN
        NEW.public_discovery_enabled := false;
        NEW.moderation_status := 'pending';
        NEW.moderation_risk_level := NULL;
        NEW.moderation_action := NULL;
        NEW.moderation_confidence := NULL;
        NEW.moderation_reasons := ARRAY[]::TEXT[];
        NEW.moderation_input_hash := NULL;
        NEW.moderated_at := NULL;
        NEW.moderation_archived_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_interests_touch_updated_at
    BEFORE UPDATE ON public.event_interests
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER events_apply_moderation_defaults
    BEFORE INSERT OR UPDATE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_event_moderation_defaults();

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

CREATE TRIGGER on_attendee_cancelled
    AFTER UPDATE ON public.event_attendees
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_attendee_cancellation();

-- Function to handle waitlist promotion when someone is deleted
CREATE OR REPLACE FUNCTION public.handle_attendee_deletion()
RETURNS TRIGGER AS $$
DECLARE
    next_waitlist_id UUID;
    event_capacity INTEGER;
    current_confirmed_count INTEGER;
BEGIN
    IF OLD.status = 'confirmed' THEN
        -- Get event capacity
        SELECT capacity INTO event_capacity FROM public.events WHERE id = OLD.event_id;
        
        -- Count current confirmed
        SELECT count(*) INTO current_confirmed_count FROM public.event_attendees 
        WHERE event_id = OLD.event_id AND status = 'confirmed';

        -- If we have space, promote the first person from waitlist
        IF current_confirmed_count < event_capacity THEN
            SELECT attendee_id INTO next_waitlist_id 
            FROM public.event_waitlist_positions 
            WHERE event_id = OLD.event_id 
            ORDER BY position ASC 
            LIMIT 1;

            IF next_waitlist_id IS NOT NULL THEN
                -- Promote attendee
                UPDATE public.event_attendees 
                SET status = 'confirmed', promoted_at = now() 
                WHERE id = next_waitlist_id;

                -- Remove from waitlist positions
                DELETE FROM public.event_waitlist_positions WHERE attendee_id = next_waitlist_id;

                -- Reorder remaining waitlist positions
                UPDATE public.event_waitlist_positions
                SET position = position - 1
                WHERE event_id = OLD.event_id;
            END IF;
        END IF;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_attendee_deleted
    AFTER DELETE ON public.event_attendees
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_attendee_deletion();

-- Function to handle RSVP logic (Atomic)
CREATE OR REPLACE FUNCTION public.rsvp_to_event(
    p_event_id UUID,
    p_user_id UUID,
    p_guest_name TEXT,
    p_guest_email TEXT
) RETURNS JSON AS $$
DECLARE
    v_capacity INTEGER;
    v_confirmed_count INTEGER;
    v_waitlist_enabled BOOLEAN;
    v_status TEXT;
    v_attendee_id UUID;
    v_waitlist_pos INTEGER;
    v_existing_id UUID;
    v_existing_status TEXT;
BEGIN
    -- Check event exists and get capacity
    SELECT capacity, allow_waitlist INTO v_capacity, v_waitlist_enabled 
    FROM public.events WHERE id = p_event_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Event not found');
    END IF;

    -- Check for existing RSVP
    SELECT id, status INTO v_existing_id, v_existing_status
    FROM public.event_attendees
    WHERE event_id = p_event_id AND guest_email = p_guest_email;

    IF v_existing_id IS NOT NULL AND v_existing_status != 'cancelled' THEN
        RETURN json_build_object('error', 'You have already RSVPed to this event');
    END IF;

    -- Count current confirmed
    SELECT count(*) INTO v_confirmed_count 
    FROM public.event_attendees 
    WHERE event_id = p_event_id AND status = 'confirmed';

    -- Determine status
    IF v_confirmed_count < v_capacity THEN
        v_status := 'confirmed';
    ELSIF v_waitlist_enabled THEN
        v_status := 'waitlist';
    ELSE
        RETURN json_build_object('error', 'Event is full and waitlist is disabled');
    END IF;

    -- If existing cancelled RSVP, update it, otherwise insert
    IF v_existing_id IS NOT NULL THEN
        UPDATE public.event_attendees
        SET status = v_status, guest_name = p_guest_name, user_id = p_user_id, joined_at = now(), cancelled_at = null
        WHERE id = v_existing_id
        RETURNING id INTO v_attendee_id;
    ELSE
        INSERT INTO public.event_attendees (event_id, user_id, guest_name, guest_email, status)
        VALUES (p_event_id, p_user_id, p_guest_name, p_guest_email, v_status)
        RETURNING id INTO v_attendee_id;
    END IF;

    -- If waitlist, add to positions
    IF v_status = 'waitlist' THEN
        SELECT COALESCE(max(position), 0) + 1 INTO v_waitlist_pos 
        FROM public.event_waitlist_positions WHERE event_id = p_event_id;
        
        INSERT INTO public.event_waitlist_positions (event_id, attendee_id, position)
        VALUES (p_event_id, v_attendee_id, v_waitlist_pos);
    END IF;

    RETURN json_build_object('success', true, 'status', v_status, 'attendee_id', v_attendee_id);
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
