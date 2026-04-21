DROP FUNCTION IF EXISTS public.host_list_share_suggestions_secure(UUID);

CREATE OR REPLACE FUNCTION public.host_list_share_suggestions_secure(
    p_event_id UUID
) RETURNS TABLE (
    recipient_key TEXT,
    recipient_type TEXT,
    user_id UUID,
    attendee_profile_id UUID,
    display_name TEXT,
    whatsapp_number TEXT,
    attended_previous BOOLEAN,
    viewed_previous BOOLEAN,
    engagement_tag TEXT,
    suggestion_group TEXT,
    already_shared BOOLEAN,
    selected_by_default BOOLEAN
) AS $$
DECLARE
    v_source_event_id UUID;
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to list share suggestions';
    END IF;

    SELECT e.copied_from_event_id
    INTO v_source_event_id
    FROM public.events e
    WHERE e.id = p_event_id;

    -- Keep non-copied behavior aligned with existing host-history suggestions.
    IF v_source_event_id IS NULL THEN
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
            concat('user:', c.user_id::TEXT) AS recipient_key,
            'user'::TEXT AS recipient_type,
            c.user_id,
            NULL::UUID AS attendee_profile_id,
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
            'other_people'::TEXT AS suggestion_group,
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
        RETURN;
    END IF;

    RETURN QUERY
    WITH source_attendee_rows AS (
        SELECT
            ea.attendee_profile_id,
            COALESCE(ea.user_id, ap.user_id) AS resolved_user_id
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = v_source_event_id
          AND ea.status <> 'cancelled'
          AND (
              COALESCE(ea.user_id, ap.user_id) IS NOT NULL
              OR ea.attendee_profile_id IS NOT NULL
          )
    ),
    source_shared_users AS (
        SELECT DISTINCT es.user_id
        FROM public.event_shared_with_users es
        WHERE es.event_id = v_source_event_id
          AND public.is_event_shared_with_user_active(es.event_id, es.user_id)
    ),
    source_approved_profiles AS (
        SELECT
            ear.requester_attendee_profile_id AS attendee_profile_id,
            ap.user_id AS resolved_user_id
        FROM public.event_access_requests ear
        LEFT JOIN public.attendee_profiles ap ON ap.id = ear.requester_attendee_profile_id
        WHERE ear.event_id = v_source_event_id
          AND ear.status = 'approved'
          AND ear.requester_attendee_profile_id IS NOT NULL
    ),
    previous_auth_sources AS (
        SELECT
            sar.resolved_user_id AS user_id,
            TRUE AS attended_flag,
            FALSE AS shared_flag,
            FALSE AS approved_flag
        FROM source_attendee_rows sar
        WHERE sar.resolved_user_id IS NOT NULL

        UNION ALL

        SELECT
            ssu.user_id,
            FALSE AS attended_flag,
            TRUE AS shared_flag,
            FALSE AS approved_flag
        FROM source_shared_users ssu

        UNION ALL

        SELECT
            sap.resolved_user_id AS user_id,
            FALSE AS attended_flag,
            FALSE AS shared_flag,
            TRUE AS approved_flag
        FROM source_approved_profiles sap
        WHERE sap.resolved_user_id IS NOT NULL
    ),
    previous_auth_candidates AS (
        SELECT
            pas.user_id,
            bool_or(pas.attended_flag) AS attended_previous,
            bool_or(pas.shared_flag) AS shared_previous,
            bool_or(pas.approved_flag) AS approved_previous
        FROM previous_auth_sources pas
        WHERE pas.user_id IS NOT NULL
        GROUP BY pas.user_id
    ),
    previous_guest_sources AS (
        SELECT
            sar.attendee_profile_id,
            TRUE AS attended_flag,
            FALSE AS approved_flag
        FROM source_attendee_rows sar
        WHERE sar.attendee_profile_id IS NOT NULL
          AND sar.resolved_user_id IS NULL

        UNION ALL

        SELECT
            sap.attendee_profile_id,
            FALSE AS attended_flag,
            TRUE AS approved_flag
        FROM source_approved_profiles sap
        WHERE sap.attendee_profile_id IS NOT NULL
          AND sap.resolved_user_id IS NULL
    ),
    previous_guest_candidates AS (
        SELECT
            pgs.attendee_profile_id,
            bool_or(pgs.attended_flag) AS attended_previous,
            bool_or(pgs.approved_flag) AS approved_previous
        FROM previous_guest_sources pgs
        GROUP BY pgs.attendee_profile_id
    ),
    previous_auth_profiles AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.whatsapp_number,
            ap.updated_at,
            ap.created_at
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (SELECT pac.user_id FROM previous_auth_candidates pac)
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    ),
    previous_guest_profiles AS (
        SELECT
            ap.id AS attendee_profile_id,
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.whatsapp_number
        FROM public.attendee_profiles ap
        WHERE ap.id IN (SELECT pgc.attendee_profile_id FROM previous_guest_candidates pgc)
    ),
    previous_results AS (
        SELECT
            concat('user:', pac.user_id::TEXT) AS recipient_key,
            'user'::TEXT AS recipient_type,
            pac.user_id,
            NULL::UUID AS attendee_profile_id,
            COALESCE(
                NULLIF(trim(pap.full_name), ''),
                NULLIF(trim(concat_ws(' ', pap.first_name, pap.last_name)), ''),
                'Community member'
            ) AS display_name,
            pap.whatsapp_number,
            pac.attended_previous,
            FALSE AS viewed_previous,
            CASE
                WHEN pac.attended_previous THEN 'attended'
                WHEN pac.approved_previous THEN 'approved_access'
                WHEN pac.shared_previous THEN 'shared_before'
                ELSE 'shared_before'
            END AS engagement_tag,
            'previous_activity'::TEXT AS suggestion_group,
            public.is_event_shared_with_user_active(p_event_id, pac.user_id) AS already_shared,
            (pac.attended_previous OR pac.shared_previous OR pac.approved_previous)
                AND NOT public.is_event_shared_with_user_active(p_event_id, pac.user_id) AS selected_by_default
        FROM previous_auth_candidates pac
        LEFT JOIN previous_auth_profiles pap ON pap.user_id = pac.user_id
        WHERE pac.user_id <> auth.uid()
          AND NOT public.is_event_host(p_event_id, pac.user_id)

        UNION ALL

        SELECT
            concat('guest:', pgc.attendee_profile_id::TEXT) AS recipient_key,
            'guest_profile'::TEXT AS recipient_type,
            NULL::UUID AS user_id,
            pgc.attendee_profile_id,
            COALESCE(
                NULLIF(trim(pgp.full_name), ''),
                NULLIF(trim(concat_ws(' ', pgp.first_name, pgp.last_name)), ''),
                'Guest attendee'
            ) AS display_name,
            pgp.whatsapp_number,
            pgc.attended_previous,
            FALSE AS viewed_previous,
            CASE
                WHEN pgc.attended_previous THEN 'attended'
                WHEN pgc.approved_previous THEN 'approved_access'
                ELSE 'approved_access'
            END AS engagement_tag,
            'previous_activity'::TEXT AS suggestion_group,
            EXISTS (
                SELECT 1
                FROM public.event_access_requests ear
                WHERE ear.event_id = p_event_id
                  AND ear.status = 'approved'
                  AND ear.requester_attendee_profile_id = pgc.attendee_profile_id
            ) AS already_shared,
            NOT EXISTS (
                SELECT 1
                FROM public.event_access_requests ear
                WHERE ear.event_id = p_event_id
                  AND ear.status = 'approved'
                  AND ear.requester_attendee_profile_id = pgc.attendee_profile_id
            ) AS selected_by_default
        FROM previous_guest_candidates pgc
        LEFT JOIN previous_guest_profiles pgp ON pgp.attendee_profile_id = pgc.attendee_profile_id
        WHERE COALESCE(pgp.user_id, NULL) IS NULL
    ),
    recent_hosted_events AS (
        SELECT e.id AS event_id
        FROM public.events e
        WHERE e.host_user_id = auth.uid()
          AND e.id <> p_event_id
          AND e.id <> v_source_event_id
          AND COALESCE(e.starts_at, e.created_at) >= (now() - interval '30 days')
        UNION
        SELECT eh.event_id
        FROM public.event_hosts eh
        JOIN public.events e ON e.id = eh.event_id
        WHERE eh.user_id = auth.uid()
          AND eh.event_id <> p_event_id
          AND eh.event_id <> v_source_event_id
          AND COALESCE(e.starts_at, e.created_at) >= (now() - interval '30 days')
    ),
    other_attended_users AS (
        SELECT DISTINCT COALESCE(ea.user_id, ap.user_id) AS user_id
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id IN (SELECT rhe.event_id FROM recent_hosted_events rhe)
          AND ea.status <> 'cancelled'
          AND COALESCE(ea.user_id, ap.user_id) IS NOT NULL
    ),
    other_shared_users AS (
        SELECT DISTINCT es.user_id
        FROM public.event_shared_with_users es
        WHERE es.event_id IN (SELECT rhe.event_id FROM recent_hosted_events rhe)
          AND public.is_event_shared_with_user_active(es.event_id, es.user_id)
    ),
    other_approved_users AS (
        SELECT DISTINCT ap.user_id
        FROM public.event_access_requests ear
        JOIN public.attendee_profiles ap ON ap.id = ear.requester_attendee_profile_id
        WHERE ear.event_id IN (SELECT rhe.event_id FROM recent_hosted_events rhe)
          AND ear.status = 'approved'
          AND ap.user_id IS NOT NULL
    ),
    other_sources AS (
        SELECT oau.user_id, TRUE AS attended_flag, FALSE AS shared_flag, FALSE AS approved_flag
        FROM other_attended_users oau

        UNION ALL

        SELECT osu.user_id, FALSE AS attended_flag, TRUE AS shared_flag, FALSE AS approved_flag
        FROM other_shared_users osu

        UNION ALL

        SELECT oapu.user_id, FALSE AS attended_flag, FALSE AS shared_flag, TRUE AS approved_flag
        FROM other_approved_users oapu
    ),
    other_auth_candidates AS (
        SELECT
            os.user_id,
            bool_or(os.attended_flag) AS attended_previous,
            bool_or(os.shared_flag) AS shared_previous,
            bool_or(os.approved_flag) AS approved_previous
        FROM other_sources os
        WHERE os.user_id IS NOT NULL
        GROUP BY os.user_id
    ),
    other_auth_profiles AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.whatsapp_number,
            ap.updated_at,
            ap.created_at
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (SELECT oac.user_id FROM other_auth_candidates oac)
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    ),
    other_results AS (
        SELECT
            concat('user:', oac.user_id::TEXT) AS recipient_key,
            'user'::TEXT AS recipient_type,
            oac.user_id,
            NULL::UUID AS attendee_profile_id,
            COALESCE(
                NULLIF(trim(oap.full_name), ''),
                NULLIF(trim(concat_ws(' ', oap.first_name, oap.last_name)), ''),
                'Community member'
            ) AS display_name,
            oap.whatsapp_number,
            oac.attended_previous,
            FALSE AS viewed_previous,
            CASE
                WHEN oac.attended_previous THEN 'attended'
                WHEN oac.approved_previous THEN 'approved_access'
                WHEN oac.shared_previous THEN 'shared_before'
                ELSE 'shared_before'
            END AS engagement_tag,
            'other_people'::TEXT AS suggestion_group,
            public.is_event_shared_with_user_active(p_event_id, oac.user_id) AS already_shared,
            FALSE AS selected_by_default
        FROM other_auth_candidates oac
        LEFT JOIN other_auth_profiles oap ON oap.user_id = oac.user_id
        WHERE oac.user_id <> auth.uid()
          AND NOT public.is_event_host(p_event_id, oac.user_id)
    ),
    ranked_results AS (
        SELECT
            r.*,
            row_number() OVER (
                PARTITION BY r.recipient_key
                ORDER BY
                    CASE r.suggestion_group
                        WHEN 'previous_activity' THEN 0
                        ELSE 1
                    END,
                    r.attended_previous DESC,
                    r.display_name ASC
            ) AS rn
        FROM (
            SELECT * FROM previous_results
            UNION ALL
            SELECT * FROM other_results
        ) r
    )
    SELECT
        rr.recipient_key,
        rr.recipient_type,
        rr.user_id,
        rr.attendee_profile_id,
        rr.display_name,
        rr.whatsapp_number,
        rr.attended_previous,
        rr.viewed_previous,
        rr.engagement_tag,
        rr.suggestion_group,
        rr.already_shared,
        rr.selected_by_default
    FROM ranked_results rr
    WHERE rr.rn = 1
    ORDER BY
        CASE rr.suggestion_group
            WHEN 'previous_activity' THEN 0
            ELSE 1
        END,
        rr.attended_previous DESC,
        rr.display_name ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_share_suggestions_secure(UUID) TO authenticated;
