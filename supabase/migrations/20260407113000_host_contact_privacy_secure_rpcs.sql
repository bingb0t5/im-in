CREATE OR REPLACE FUNCTION public.host_lookup_user_by_whatsapp_secure(
    p_event_id UUID,
    p_whatsapp TEXT
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    whatsapp_number TEXT
) AS $$
DECLARE
    v_normalized_input TEXT;
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to look up users';
    END IF;

    v_normalized_input := regexp_replace(COALESCE(p_whatsapp, ''), '\D', '', 'g');
    IF nullif(v_normalized_input, '') IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        ap.user_id,
        COALESCE(
            NULLIF(trim(ap.full_name), ''),
            NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
            'Community member'
        ) AS display_name,
        ap.whatsapp_number
    FROM public.attendee_profiles ap
    WHERE ap.user_id IS NOT NULL
      AND nullif(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), '') = v_normalized_input
    ORDER BY ap.whatsapp_verified_at DESC NULLS LAST, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_lookup_user_by_whatsapp_secure(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_list_share_suggestions_secure(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
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
            'Community member'
        ) AS display_name,
        p.whatsapp_number,
        c.attended_previous,
        c.viewed_previous,
        CASE
            WHEN c.attended_previous THEN 'attended'
            WHEN c.viewed_previous THEN 'viewed_private'
            ELSE 'viewed_private'
        END AS engagement_tag,
        public.is_event_shared_with_user_active(p_event_id, c.user_id) AS already_shared,
        c.attended_previous AND NOT public.is_event_shared_with_user_active(p_event_id, c.user_id) AS selected_by_default
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
            c.user_id::TEXT
        ) ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_share_suggestions_secure(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_list_event_access_log_secure(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
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
            'Community member'
        ) AS display_name,
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

GRANT EXECUTE ON FUNCTION public.host_list_event_access_log_secure(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_list_private_access_users_secure(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
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
            'Community member'
        ) AS display_name,
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

GRANT EXECUTE ON FUNCTION public.host_list_private_access_users_secure(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_list_notification_recipients_secure(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    whatsapp_number TEXT,
    source TEXT,
    attendee_status TEXT
) AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to list notification recipients';
    END IF;

    RETURN QUERY
    WITH attendees AS (
        SELECT
            COALESCE(ea.user_id, ap.user_id) AS user_id,
            ea.guest_name,
            ea.status,
            'attendee'::TEXT AS source
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status <> 'cancelled'
          AND COALESCE(ea.user_id, ap.user_id) IS NOT NULL
    ),
    shared AS (
        SELECT
            es.user_id,
            NULL::TEXT AS guest_name,
            NULL::TEXT AS status,
            'shared'::TEXT AS source
        FROM public.event_shared_with_users es
        WHERE es.event_id = p_event_id
    ),
    combined AS (
        SELECT * FROM attendees
        UNION ALL
        SELECT * FROM shared
    ),
    deduped AS (
        SELECT
            c.user_id,
            min(c.guest_name) FILTER (WHERE nullif(trim(coalesce(c.guest_name, '')), '') IS NOT NULL) AS guest_name,
            string_agg(DISTINCT c.source, ', ' ORDER BY c.source) AS source,
            min(c.status) FILTER (WHERE c.status IS NOT NULL) AS attendee_status
        FROM combined c
        GROUP BY c.user_id
    ),
    profile_best AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.whatsapp_number
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (SELECT d.user_id FROM deduped d)
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    )
    SELECT
        d.user_id,
        COALESCE(
            NULLIF(trim(p.full_name), ''),
            NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
            NULLIF(trim(d.guest_name), ''),
            'Community member'
        ) AS display_name,
        p.whatsapp_number,
        d.source,
        d.attendee_status
    FROM deduped d
    LEFT JOIN profile_best p ON p.user_id = d.user_id
    WHERE d.user_id <> auth.uid()
      AND NOT public.is_event_host(p_event_id, d.user_id)
    ORDER BY
        CASE WHEN d.attendee_status = 'confirmed' THEN 0 WHEN d.attendee_status = 'waitlist' THEN 1 ELSE 2 END,
        display_name ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_notification_recipients_secure(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_list_attendees_for_dashboard(
    p_event_id UUID
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    added_by_type TEXT,
    added_by_attendee_profile_id UUID,
    guest_name TEXT,
    status TEXT,
    joined_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    whatsapp_number TEXT
) AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to view attendees';
    END IF;

    RETURN QUERY
    WITH attendee_rows AS (
        SELECT
            ea.*,
            COALESCE(ea.user_id, ap.user_id) AS resolved_user_id
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status <> 'cancelled'
    ),
    profile_best AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.whatsapp_number
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (
            SELECT ar.resolved_user_id
            FROM attendee_rows ar
            WHERE ar.resolved_user_id IS NOT NULL
        )
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    ),
    profile_by_id AS (
        SELECT
            ap.id,
            ap.whatsapp_number
        FROM public.attendee_profiles ap
        WHERE ap.id IN (
            SELECT ar.attendee_profile_id
            FROM attendee_rows ar
            WHERE ar.attendee_profile_id IS NOT NULL
        )
    )
    SELECT
        ar.id,
        ar.event_id,
        ar.user_id,
        ar.attendee_profile_id,
        ar.added_by_type::TEXT,
        ar.added_by_attendee_profile_id,
        ar.guest_name,
        ar.status::TEXT,
        ar.joined_at,
        ar.promoted_at,
        ar.cancelled_at,
        COALESCE(pb.whatsapp_number, pid.whatsapp_number) AS whatsapp_number
    FROM attendee_rows ar
    LEFT JOIN profile_best pb ON pb.user_id = ar.resolved_user_id
    LEFT JOIN profile_by_id pid ON pid.id = ar.attendee_profile_id
    ORDER BY ar.joined_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_attendees_for_dashboard(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_list_join_requests_for_dashboard(
    p_event_id UUID,
    p_status TEXT DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    guest_name TEXT,
    request_note TEXT,
    status TEXT,
    reviewed_by_user_id UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    whatsapp_number TEXT
) AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to review join requests';
    END IF;

    RETURN QUERY
    WITH request_rows AS (
        SELECT
            jr.*,
            ap.user_id AS profile_user_id,
            ap.whatsapp_number AS profile_whatsapp_number,
            COALESCE(jr.user_id, ap.user_id) AS resolved_user_id
        FROM public.event_join_requests jr
        LEFT JOIN public.attendee_profiles ap ON ap.id = jr.attendee_profile_id
        WHERE jr.event_id = p_event_id
          AND (p_status IS NULL OR jr.status = p_status)
    ),
    profile_best AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.whatsapp_number
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (
            SELECT rr.resolved_user_id
            FROM request_rows rr
            WHERE rr.resolved_user_id IS NOT NULL
        )
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    )
    SELECT
        rr.id,
        rr.event_id,
        rr.user_id,
        rr.attendee_profile_id,
        rr.guest_name,
        rr.request_note,
        rr.status::TEXT,
        rr.reviewed_by_user_id,
        rr.reviewed_at,
        rr.created_at,
        rr.updated_at,
        COALESCE(pb.whatsapp_number, rr.profile_whatsapp_number) AS whatsapp_number
    FROM request_rows rr
    LEFT JOIN profile_best pb ON pb.user_id = rr.resolved_user_id
    ORDER BY rr.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_join_requests_for_dashboard(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_list_interests_for_dashboard(
    p_event_id UUID
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    guest_name TEXT,
    visibility_mode TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    whatsapp_number TEXT
) AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to view interests';
    END IF;

    RETURN QUERY
    WITH interest_rows AS (
        SELECT
            ei.*,
            ap.user_id AS profile_user_id,
            ap.whatsapp_number AS profile_whatsapp_number,
            COALESCE(ei.user_id, ap.user_id) AS resolved_user_id
        FROM public.event_interests ei
        LEFT JOIN public.attendee_profiles ap ON ap.id = ei.attendee_profile_id
        WHERE ei.event_id = p_event_id
    ),
    profile_best AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.whatsapp_number
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (
            SELECT ir.resolved_user_id
            FROM interest_rows ir
            WHERE ir.resolved_user_id IS NOT NULL
        )
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    )
    SELECT
        ir.id,
        ir.event_id,
        ir.user_id,
        ir.attendee_profile_id,
        ir.guest_name,
        ir.visibility_mode::TEXT,
        ir.created_at,
        ir.updated_at,
        COALESCE(pb.whatsapp_number, ir.profile_whatsapp_number) AS whatsapp_number
    FROM interest_rows ir
    LEFT JOIN profile_best pb ON pb.user_id = ir.resolved_user_id
    ORDER BY ir.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_interests_for_dashboard(UUID) TO authenticated;
