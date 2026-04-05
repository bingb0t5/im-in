ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS copied_from_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_copied_from_event_id_idx
    ON public.events (copied_from_event_id);

ALTER TABLE public.event_access_requests
    ADD COLUMN IF NOT EXISTS requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_access_requests_requester_user_id_idx
    ON public.event_access_requests (requester_user_id);

CREATE OR REPLACE FUNCTION public.host_list_copy_share_candidates(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    email TEXT,
    whatsapp_number TEXT,
    attended_previous BOOLEAN,
    viewed_previous BOOLEAN,
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
        RAISE EXCEPTION 'Not authorized to list share candidates';
    END IF;

    SELECT e.copied_from_event_id
    INTO v_source_event_id
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_source_event_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH source_candidates AS (
        SELECT
            COALESCE(ea.user_id, ap.user_id) AS source_user_id,
            TRUE AS attended_flag,
            FALSE AS viewed_flag
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap
            ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = v_source_event_id
          AND ea.status <> 'cancelled'
          AND COALESCE(ea.user_id, ap.user_id) IS NOT NULL

        UNION ALL

        SELECT
            es.user_id AS source_user_id,
            FALSE AS attended_flag,
            TRUE AS viewed_flag
        FROM public.event_shared_with_users es
        WHERE es.event_id = v_source_event_id
    ),
    deduped AS (
        SELECT
            sc.source_user_id AS user_id,
            bool_or(sc.attended_flag) AS attended_previous,
            bool_or(sc.viewed_flag) AS viewed_previous
        FROM source_candidates sc
        WHERE sc.source_user_id IS NOT NULL
        GROUP BY sc.source_user_id
    ),
    profiles AS (
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
        WHERE ap.user_id IN (SELECT d.user_id FROM deduped d)
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    )
    SELECT
        d.user_id,
        COALESCE(
            NULLIF(trim(p.full_name), ''),
            NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
            NULLIF(trim(regexp_replace(split_part(COALESCE(p.email, ''), '@', 1), '[._-]+', ' ', 'g')), ''),
            'Community member'
        ) AS display_name,
        p.email,
        p.whatsapp_number,
        d.attended_previous,
        d.viewed_previous,
        EXISTS (
            SELECT 1
            FROM public.event_shared_with_users es
            WHERE es.event_id = p_event_id
              AND es.user_id = d.user_id
        ) AS already_shared,
        TRUE AS selected_by_default
    FROM deduped d
    LEFT JOIN profiles p
      ON p.user_id = d.user_id
    WHERE d.user_id <> auth.uid()
      AND NOT public.is_event_host(p_event_id, d.user_id)
    ORDER BY
        d.attended_previous DESC,
        d.viewed_previous DESC,
        COALESCE(NULLIF(trim(p.full_name), ''), NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'zzz') ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_copy_share_candidates(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_lookup_user_by_whatsapp(
    p_event_id UUID,
    p_whatsapp TEXT
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    email TEXT,
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
            NULLIF(trim(regexp_replace(split_part(COALESCE(ap.email, ''), '@', 1), '[._-]+', ' ', 'g')), ''),
            'Community member'
        ) AS display_name,
        ap.email,
        ap.whatsapp_number
    FROM public.attendee_profiles ap
    WHERE ap.user_id IS NOT NULL
      AND nullif(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), '') = v_normalized_input
    ORDER BY ap.whatsapp_verified_at DESC NULLS LAST, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_lookup_user_by_whatsapp(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_share_event_with_users(
    p_event_id UUID,
    p_user_ids UUID[],
    p_source TEXT DEFAULT 'link'
) RETURNS JSON AS $$
DECLARE
    v_source TEXT := CASE
        WHEN lower(trim(coalesce(p_source, ''))) = 'code' THEN 'code'
        ELSE 'link'
    END;
    v_requested_count INTEGER := 0;
    v_shared_count INTEGER := 0;
BEGIN
    IF p_event_id IS NULL THEN
        RETURN json_build_object('error', 'Missing event');
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RETURN json_build_object('error', 'Not authorized to share this activity');
    END IF;

    WITH requested AS (
        SELECT DISTINCT user_id
        FROM unnest(COALESCE(p_user_ids, ARRAY[]::UUID[])) AS user_id
        WHERE user_id IS NOT NULL
          AND user_id <> auth.uid()
          AND NOT public.is_event_host(p_event_id, user_id)
    ),
    inserted AS (
        INSERT INTO public.event_shared_with_users (
            event_id,
            user_id,
            source
        )
        SELECT
            p_event_id,
            r.user_id,
            v_source
        FROM requested r
        ON CONFLICT (event_id, user_id) DO NOTHING
        RETURNING user_id
    )
    SELECT
        (SELECT count(*) FROM requested),
        (SELECT count(*) FROM inserted)
    INTO
        v_requested_count,
        v_shared_count;

    RETURN json_build_object(
        'success', true,
        'submitted_count', v_requested_count,
        'shared_count', v_shared_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_share_event_with_users(UUID, UUID[], TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_review_access_request(
    p_request_id UUID,
    p_action TEXT
) RETURNS JSON AS $$
DECLARE
    v_request public.event_access_requests%ROWTYPE;
    v_action TEXT := lower(trim(coalesce(p_action, '')));
    v_shared_inserted_count INTEGER := 0;
BEGIN
    IF p_request_id IS NULL THEN
        RETURN json_build_object('error', 'Missing request');
    END IF;

    IF v_action NOT IN ('approved', 'declined', 'contacted') THEN
        RETURN json_build_object('error', 'Invalid action');
    END IF;

    SELECT *
    INTO v_request
    FROM public.event_access_requests ear
    WHERE ear.id = p_request_id;

    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Access request not found');
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(v_request.event_id, auth.uid()) THEN
        RETURN json_build_object('error', 'Not authorized to review this request');
    END IF;

    UPDATE public.event_access_requests
    SET
        status = v_action,
        updated_at = now()
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    IF v_action = 'approved' AND v_request.requester_user_id IS NOT NULL THEN
        INSERT INTO public.event_shared_with_users (
            event_id,
            user_id,
            source
        )
        VALUES (
            v_request.event_id,
            v_request.requester_user_id,
            'link'
        )
        ON CONFLICT (event_id, user_id) DO NOTHING;

        GET DIAGNOSTICS v_shared_inserted_count = ROW_COUNT;
    END IF;

    RETURN json_build_object(
        'success', true,
        'status', v_request.status,
        'shared_to_user', v_shared_inserted_count > 0,
        'requester_user_id', v_request.requester_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_review_access_request(UUID, TEXT) TO authenticated;
