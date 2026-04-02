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
            to_jsonb(e) AS events
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
            to_jsonb(e) AS events
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
