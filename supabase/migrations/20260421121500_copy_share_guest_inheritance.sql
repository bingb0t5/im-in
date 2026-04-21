ALTER TABLE public.event_access_requests
    ADD COLUMN IF NOT EXISTS grant_source TEXT NOT NULL DEFAULT 'request';

UPDATE public.event_access_requests
SET grant_source = 'request'
WHERE grant_source IS NULL;

ALTER TABLE public.event_access_requests
    DROP CONSTRAINT IF EXISTS event_access_requests_grant_source_check;

ALTER TABLE public.event_access_requests
    ADD CONSTRAINT event_access_requests_grant_source_check
    CHECK (grant_source IN ('request', 'copy_inheritance'));

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
    auth_sources AS (
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
    auth_candidates AS (
        SELECT
            a.user_id,
            bool_or(a.attended_flag) AS attended_previous,
            bool_or(a.shared_flag) AS shared_previous,
            bool_or(a.approved_flag) AS approved_previous
        FROM auth_sources a
        WHERE a.user_id IS NOT NULL
        GROUP BY a.user_id
    ),
    guest_sources AS (
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
    guest_candidates AS (
        SELECT
            gs.attendee_profile_id,
            bool_or(gs.attended_flag) AS attended_previous,
            bool_or(gs.approved_flag) AS approved_previous
        FROM guest_sources gs
        GROUP BY gs.attendee_profile_id
    ),
    auth_profiles AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.whatsapp_number,
            ap.updated_at,
            ap.created_at
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (SELECT ac.user_id FROM auth_candidates ac)
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    ),
    guest_profiles AS (
        SELECT
            ap.id AS attendee_profile_id,
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.whatsapp_number
        FROM public.attendee_profiles ap
        WHERE ap.id IN (SELECT gc.attendee_profile_id FROM guest_candidates gc)
    ),
    auth_results AS (
        SELECT
            concat('user:', ac.user_id::TEXT) AS recipient_key,
            'user'::TEXT AS recipient_type,
            ac.user_id,
            NULL::UUID AS attendee_profile_id,
            COALESCE(
                NULLIF(trim(ap.full_name), ''),
                NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                'Community member'
            ) AS display_name,
            ap.whatsapp_number,
            ac.attended_previous,
            FALSE AS viewed_previous,
            CASE
                WHEN ac.attended_previous THEN 'attended'
                WHEN ac.approved_previous THEN 'approved_access'
                WHEN ac.shared_previous THEN 'shared_before'
                ELSE 'shared_before'
            END AS engagement_tag,
            public.is_event_shared_with_user_active(p_event_id, ac.user_id) AS already_shared,
            (ac.attended_previous OR ac.shared_previous OR ac.approved_previous)
                AND NOT public.is_event_shared_with_user_active(p_event_id, ac.user_id) AS selected_by_default
        FROM auth_candidates ac
        LEFT JOIN auth_profiles ap ON ap.user_id = ac.user_id
        WHERE ac.user_id <> auth.uid()
          AND NOT public.is_event_host(p_event_id, ac.user_id)
    ),
    guest_results AS (
        SELECT
            concat('guest:', gc.attendee_profile_id::TEXT) AS recipient_key,
            'guest_profile'::TEXT AS recipient_type,
            NULL::UUID AS user_id,
            gc.attendee_profile_id,
            COALESCE(
                NULLIF(trim(gp.full_name), ''),
                NULLIF(trim(concat_ws(' ', gp.first_name, gp.last_name)), ''),
                'Guest attendee'
            ) AS display_name,
            gp.whatsapp_number,
            gc.attended_previous,
            FALSE AS viewed_previous,
            CASE
                WHEN gc.attended_previous THEN 'attended'
                WHEN gc.approved_previous THEN 'approved_access'
                ELSE 'approved_access'
            END AS engagement_tag,
            EXISTS (
                SELECT 1
                FROM public.event_access_requests ear
                WHERE ear.event_id = p_event_id
                  AND ear.status = 'approved'
                  AND ear.requester_attendee_profile_id = gc.attendee_profile_id
            ) AS already_shared,
            NOT EXISTS (
                SELECT 1
                FROM public.event_access_requests ear
                WHERE ear.event_id = p_event_id
                  AND ear.status = 'approved'
                  AND ear.requester_attendee_profile_id = gc.attendee_profile_id
            ) AS selected_by_default
        FROM guest_candidates gc
        LEFT JOIN guest_profiles gp ON gp.attendee_profile_id = gc.attendee_profile_id
        WHERE COALESCE(gp.user_id, NULL) IS NULL
    )
    SELECT
        r.recipient_key,
        r.recipient_type,
        r.user_id,
        r.attendee_profile_id,
        r.display_name,
        r.whatsapp_number,
        r.attended_previous,
        r.viewed_previous,
        r.engagement_tag,
        r.already_shared,
        r.selected_by_default
    FROM (
        SELECT * FROM auth_results
        UNION ALL
        SELECT * FROM guest_results
    ) r
    ORDER BY
        r.attended_previous DESC,
        r.display_name ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_share_suggestions_secure(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.host_share_event_with_users(UUID, UUID[], TEXT);

CREATE OR REPLACE FUNCTION public.host_share_event_with_users(
    p_event_id UUID,
    p_user_ids UUID[],
    p_source TEXT DEFAULT 'link',
    p_attendee_profile_ids UUID[] DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_source TEXT := CASE
        WHEN lower(trim(coalesce(p_source, ''))) = 'code' THEN 'code'
        WHEN lower(trim(coalesce(p_source, ''))) = 'host_share' THEN 'host_share'
        ELSE 'host_share'
    END;
    v_requested_count INTEGER := 0;
    v_shared_count INTEGER := 0;
    v_auth_requested_count INTEGER := 0;
    v_auth_shared_count INTEGER := 0;
    v_guest_requested_count INTEGER := 0;
    v_guest_granted_count INTEGER := 0;
BEGIN
    IF p_event_id IS NULL THEN
        RETURN json_build_object('error', 'Missing event');
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RETURN json_build_object('error', 'Not authorized to share this activity');
    END IF;

    WITH requested_users AS (
        SELECT DISTINCT user_id
        FROM unnest(COALESCE(p_user_ids, ARRAY[]::UUID[])) AS user_id
        WHERE user_id IS NOT NULL
          AND user_id <> auth.uid()
          AND NOT public.is_event_host(p_event_id, user_id)
    ),
    requested_profiles AS (
        SELECT DISTINCT attendee_profile_id
        FROM unnest(COALESCE(p_attendee_profile_ids, ARRAY[]::UUID[])) AS attendee_profile_id
        WHERE attendee_profile_id IS NOT NULL
    ),
    resolved_profiles AS (
        SELECT
            rp.attendee_profile_id,
            ap.user_id AS mapped_user_id
        FROM requested_profiles rp
        JOIN public.attendee_profiles ap ON ap.id = rp.attendee_profile_id
    ),
    promoted_users AS (
        SELECT DISTINCT rp.mapped_user_id AS user_id
        FROM resolved_profiles rp
        WHERE rp.mapped_user_id IS NOT NULL
          AND rp.mapped_user_id <> auth.uid()
          AND NOT public.is_event_host(p_event_id, rp.mapped_user_id)
    ),
    all_requested_users AS (
        SELECT ru.user_id
        FROM requested_users ru
        UNION
        SELECT pu.user_id
        FROM promoted_users pu
    ),
    inserted_auth AS (
        INSERT INTO public.event_shared_with_users (
            event_id,
            user_id,
            source,
            unlock_private_slug,
            unlock_join_code
        )
        SELECT
            p_event_id,
            aru.user_id,
            v_source,
            NULL,
            NULL
        FROM all_requested_users aru
        ON CONFLICT (event_id, user_id)
        DO UPDATE SET
            source = 'host_share',
            unlock_private_slug = NULL,
            unlock_join_code = NULL
        RETURNING user_id
    ),
    unresolved_profiles AS (
        SELECT rp.attendee_profile_id
        FROM resolved_profiles rp
        WHERE rp.mapped_user_id IS NULL
    ),
    guest_profile_status AS (
        SELECT
            up.attendee_profile_id,
            (
                SELECT ear.status
                FROM public.event_access_requests ear
                WHERE ear.event_id = p_event_id
                  AND ear.requester_attendee_profile_id = up.attendee_profile_id
                ORDER BY
                    CASE ear.status
                        WHEN 'approved' THEN 1
                        WHEN 'pending' THEN 2
                        WHEN 'contacted' THEN 3
                        WHEN 'declined' THEN 4
                        ELSE 5
                    END,
                    ear.created_at DESC
                LIMIT 1
            ) AS existing_status
        FROM unresolved_profiles up
    ),
    updated_pending AS (
        UPDATE public.event_access_requests ear
        SET
            status = 'approved',
            updated_at = now(),
            grant_source = 'copy_inheritance'
        FROM guest_profile_status gps
        WHERE ear.event_id = p_event_id
          AND ear.requester_attendee_profile_id = gps.attendee_profile_id
          AND gps.existing_status = 'pending'
          AND ear.status = 'pending'
        RETURNING ear.requester_attendee_profile_id
    ),
    inserted_guest_access AS (
        INSERT INTO public.event_access_requests (
            event_id,
            requester_user_id,
            requester_attendee_profile_id,
            requester_name,
            requester_whatsapp,
            requester_note,
            status,
            grant_source
        )
        SELECT
            p_event_id,
            NULL,
            gps.attendee_profile_id,
            COALESCE(
                NULLIF(trim(ap.full_name), ''),
                NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                'Guest attendee'
            ),
            COALESCE(NULLIF(trim(COALESCE(ap.whatsapp_number, '')), ''), ''),
            NULL,
            'approved',
            'copy_inheritance'
        FROM guest_profile_status gps
        JOIN public.attendee_profiles ap ON ap.id = gps.attendee_profile_id
        WHERE gps.existing_status IS NULL
        RETURNING requester_attendee_profile_id
    )
    SELECT
        (SELECT count(*) FROM all_requested_users),
        (SELECT count(*) FROM inserted_auth),
        (SELECT count(*) FROM unresolved_profiles),
        (SELECT count(*) FROM updated_pending) + (SELECT count(*) FROM inserted_guest_access)
    INTO
        v_auth_requested_count,
        v_auth_shared_count,
        v_guest_requested_count,
        v_guest_granted_count;

    v_requested_count := v_auth_requested_count + v_guest_requested_count;
    v_shared_count := v_auth_shared_count + v_guest_granted_count;

    RETURN json_build_object(
        'success', true,
        'submitted_count', v_requested_count,
        'shared_count', v_shared_count,
        'auth_submitted_count', v_auth_requested_count,
        'auth_shared_count', v_auth_shared_count,
        'guest_submitted_count', v_guest_requested_count,
        'guest_shared_count', v_guest_granted_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_share_event_with_users(UUID, UUID[], TEXT, UUID[]) TO authenticated;
