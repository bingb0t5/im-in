DROP FUNCTION IF EXISTS public.list_my_hosted_events();

CREATE FUNCTION public.list_my_hosted_events()
RETURNS TABLE (
    id UUID,
    slug TEXT,
    public_slug TEXT,
    private_slug TEXT,
    copied_from_event_id UUID,
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
    updated_at TIMESTAMPTZ,
    confirmed_count INTEGER,
    thinking_count INTEGER
) AS $$
    SELECT DISTINCT
        e.id,
        e.slug,
        e.public_slug,
        e.private_slug,
        e.copied_from_event_id,
        e.title,
        e.description,
        e.public_summary,
        e.location_text,
        e.public_location_text,
        e.google_maps_url,
        e.starts_at,
        e.timezone,
        e.duration_minutes,
        e.ends_at,
        e.capacity,
        e.host_user_id,
        e.host_name,
        e.host_contact_text,
        e.show_host_publicly,
        e.access_code,
        e.join_code,
        e.visibility,
        e.allow_waitlist,
        e.require_host_approval_for_join,
        e.require_guest_email_for_join,
        e.is_public,
        e.public_discovery_enabled,
        e.moderation_status,
        e.moderation_risk_level,
        e.moderation_action,
        e.moderation_confidence,
        e.moderation_reasons,
        e.moderation_input_hash,
        e.moderated_at,
        e.moderation_archived_at,
        e.moderation_override,
        e.status,
        e.created_at,
        e.updated_at,
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
    LEFT JOIN public.event_hosts eh
      ON eh.event_id = e.id
    WHERE auth.uid() IS NOT NULL
      AND (
          e.host_user_id = auth.uid()
          OR eh.user_id = auth.uid()
      )
    ORDER BY e.starts_at ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_my_hosted_events() TO authenticated;

DROP FUNCTION IF EXISTS public.list_my_shared_activities();

CREATE FUNCTION public.list_my_shared_activities()
RETURNS TABLE (
    id UUID,
    slug TEXT,
    public_slug TEXT,
    private_slug TEXT,
    copied_from_event_id UUID,
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
    updated_at TIMESTAMPTZ,
    confirmed_count INTEGER,
    thinking_count INTEGER
) AS $$
    SELECT DISTINCT
        e.id,
        e.slug,
        e.public_slug,
        e.private_slug,
        e.copied_from_event_id,
        e.title,
        e.description,
        e.public_summary,
        e.location_text,
        e.public_location_text,
        e.google_maps_url,
        e.starts_at,
        e.timezone,
        e.duration_minutes,
        e.ends_at,
        e.capacity,
        e.host_user_id,
        e.host_name,
        e.host_contact_text,
        e.show_host_publicly,
        e.access_code,
        e.join_code,
        e.visibility,
        e.allow_waitlist,
        e.require_host_approval_for_join,
        e.require_guest_email_for_join,
        e.is_public,
        e.public_discovery_enabled,
        e.moderation_status,
        e.moderation_risk_level,
        e.moderation_action,
        e.moderation_confidence,
        e.moderation_reasons,
        e.moderation_input_hash,
        e.moderated_at,
        e.moderation_archived_at,
        e.moderation_override,
        e.status,
        e.created_at,
        e.updated_at,
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
    FROM public.event_shared_with_users es
    JOIN public.events e
      ON e.id = es.event_id
    WHERE auth.uid() IS NOT NULL
      AND es.user_id = auth.uid()
      AND public.is_event_shared_with_user_active(es.event_id, es.user_id)
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

CREATE OR REPLACE FUNCTION public.list_my_joined_activities()
RETURNS TABLE (
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
    SELECT *
    FROM (
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
            to_jsonb(e) || jsonb_build_object(
                'confirmed_count',
                (
                    SELECT count(*)::INTEGER
                    FROM public.event_attendees confirmed_ea
                    WHERE confirmed_ea.event_id = e.id
                      AND confirmed_ea.status = 'confirmed'
                ),
                'thinking_count',
                (
                    SELECT count(*)::INTEGER
                    FROM public.event_interests ei
                    WHERE ei.event_id = e.id
                )
            ) AS events
        FROM public.event_attendees ea
        JOIN public.events e
          ON e.id = ea.event_id
        LEFT JOIN public.attendee_profiles ap
          ON ap.id = ea.attendee_profile_id
        LEFT JOIN public.attendee_profiles added_by_ap
          ON added_by_ap.id = ea.added_by_attendee_profile_id
        WHERE auth.uid() IS NOT NULL
          AND ea.status <> 'cancelled'
          AND (
              ea.user_id = auth.uid()
              OR ap.user_id = auth.uid()
              OR lower(coalesce(ap.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
              OR lower(coalesce(ea.guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
              OR added_by_ap.user_id = auth.uid()
              OR lower(coalesce(added_by_ap.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )

        UNION ALL

        SELECT
            jr.id,
            jr.event_id,
            jr.user_id,
            jr.attendee_profile_id,
            jr.guest_name,
            jr.guest_email,
            'pending_approval'::TEXT AS status,
            jr.created_at AS joined_at,
            NULL::TIMESTAMPTZ AS promoted_at,
            NULL::TIMESTAMPTZ AS cancelled_at,
            to_jsonb(e) || jsonb_build_object(
                'confirmed_count',
                (
                    SELECT count(*)::INTEGER
                    FROM public.event_attendees confirmed_ea
                    WHERE confirmed_ea.event_id = e.id
                      AND confirmed_ea.status = 'confirmed'
                ),
                'thinking_count',
                (
                    SELECT count(*)::INTEGER
                    FROM public.event_interests ei
                    WHERE ei.event_id = e.id
                )
            ) AS events
        FROM public.event_join_requests jr
        JOIN public.events e
          ON e.id = jr.event_id
        LEFT JOIN public.attendee_profiles ap
          ON ap.id = jr.attendee_profile_id
        WHERE auth.uid() IS NOT NULL
          AND jr.status = 'pending'
          AND (
              jr.user_id = auth.uid()
              OR ap.user_id = auth.uid()
              OR lower(coalesce(ap.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
              OR lower(coalesce(jr.guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.event_attendees ea
              LEFT JOIN public.attendee_profiles attendee_ap
                ON attendee_ap.id = ea.attendee_profile_id
              LEFT JOIN public.attendee_profiles added_by_ap
                ON added_by_ap.id = ea.added_by_attendee_profile_id
              WHERE ea.event_id = jr.event_id
                AND ea.status <> 'cancelled'
                AND (
                    ea.user_id = auth.uid()
                    OR attendee_ap.user_id = auth.uid()
                    OR lower(coalesce(attendee_ap.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
                    OR lower(coalesce(ea.guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
                    OR added_by_ap.user_id = auth.uid()
                    OR lower(coalesce(added_by_ap.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
                )
          )
    ) joined_activity_rows
    ORDER BY joined_at DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_my_joined_activities() TO authenticated;
