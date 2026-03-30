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
    WHERE ea.status <> 'cancelled'
      AND (
        (
          ea.attendee_profile_id = v_profile_id
          AND coalesce(ea.added_by_type, 'self') <> 'proxy'
        )
        OR (
          coalesce(ea.added_by_type, 'self') = 'proxy'
          AND ea.added_by_attendee_profile_id = v_profile_id
        )
      )
    ORDER BY ea.joined_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_guest_bookings(TEXT) TO anon, authenticated;