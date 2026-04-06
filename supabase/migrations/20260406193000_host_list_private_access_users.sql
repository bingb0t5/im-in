CREATE OR REPLACE FUNCTION public.host_list_private_access_users(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    email TEXT,
    whatsapp_number TEXT,
    source TEXT,
    granted_at TIMESTAMPTZ
) AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to view shared private access';
    END IF;

    RETURN QUERY
    WITH profile_rows AS (
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
            SELECT es.user_id
            FROM public.event_shared_with_users es
            WHERE es.event_id = p_event_id
        )
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    )
    SELECT
        es.user_id,
        COALESCE(
            NULLIF(trim(pr.full_name), ''),
            NULLIF(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
            NULLIF(trim(regexp_replace(split_part(COALESCE(pr.email, ''), '@', 1), '[._-]+', ' ', 'g')), ''),
            'Community member'
        ) AS display_name,
        pr.email,
        pr.whatsapp_number,
        es.source,
        es.created_at AS granted_at
    FROM public.event_shared_with_users es
    LEFT JOIN profile_rows pr ON pr.user_id = es.user_id
    WHERE es.event_id = p_event_id
      AND public.is_event_shared_with_user_active(es.event_id, es.user_id)
    ORDER BY es.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_private_access_users(UUID) TO authenticated;
