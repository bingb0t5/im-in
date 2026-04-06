ALTER TABLE public.event_shared_with_users
    ADD COLUMN IF NOT EXISTS unlock_private_slug TEXT,
    ADD COLUMN IF NOT EXISTS unlock_join_code TEXT;

ALTER TABLE public.event_shared_with_users
    DROP CONSTRAINT IF EXISTS event_shared_with_users_source_check;

ALTER TABLE public.event_shared_with_users
    ADD CONSTRAINT event_shared_with_users_source_check
    CHECK (source IN ('link', 'code', 'host_share'));

CREATE OR REPLACE FUNCTION public.is_event_shared_with_user_active(
    p_event_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_private_slug TEXT;
    v_join_code TEXT;
BEGIN
    IF p_event_id IS NULL OR p_user_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT
        nullif(trim(coalesce(e.private_slug, '')), ''),
        nullif(trim(coalesce(e.join_code, '')), '')
    INTO
        v_private_slug,
        v_join_code
    FROM public.events e
    WHERE e.id = p_event_id;

    RETURN EXISTS (
        SELECT 1
        FROM public.event_shared_with_users es
        WHERE es.event_id = p_event_id
          AND es.user_id = p_user_id
          AND (
              -- Durable host-granted share that should survive secret rotation.
              (es.unlock_private_slug IS NULL AND es.unlock_join_code IS NULL)
              OR (
                  -- Secret-derived unlocks only stay valid while both current secrets match.
                  COALESCE(es.unlock_private_slug, '') = COALESCE(v_private_slug, '')
                  AND COALESCE(es.unlock_join_code, '') = COALESCE(v_join_code, '')
              )
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_event_shared_with_user_active(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_event_shared_with_me(
    p_event_id UUID,
    p_source TEXT DEFAULT 'link'
) RETURNS public.event_shared_with_users AS $$
DECLARE
    v_row public.event_shared_with_users%ROWTYPE;
    v_source TEXT := CASE
        WHEN lower(trim(coalesce(p_source, ''))) = 'code' THEN 'code'
        ELSE 'link'
    END;
    v_private_slug TEXT;
    v_join_code TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT
        nullif(trim(coalesce(e.private_slug, '')), ''),
        nullif(trim(coalesce(e.join_code, '')), '')
    INTO
        v_private_slug,
        v_join_code
    FROM public.events e
    WHERE e.id = p_event_id;

    INSERT INTO public.event_shared_with_users (
        event_id,
        user_id,
        source,
        unlock_private_slug,
        unlock_join_code
    )
    VALUES (
        p_event_id,
        auth.uid(),
        v_source,
        v_private_slug,
        v_join_code
    )
    ON CONFLICT (event_id, user_id)
    DO UPDATE
    SET
        source = CASE
            WHEN event_shared_with_users.source = 'host_share' THEN event_shared_with_users.source
            ELSE EXCLUDED.source
        END,
        unlock_private_slug = CASE
            WHEN event_shared_with_users.source = 'host_share' THEN NULL
            ELSE EXCLUDED.unlock_private_slug
        END,
        unlock_join_code = CASE
            WHEN event_shared_with_users.source = 'host_share' THEN NULL
            ELSE EXCLUDED.unlock_join_code
        END
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.mark_event_shared_with_me(UUID, TEXT) TO authenticated;

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
    v_private_slug TEXT;
    v_visibility TEXT;
    v_is_host BOOLEAN := false;
    v_has_access_code BOOLEAN := false;
    v_is_shared BOOLEAN := false;
    v_is_attendee BOOLEAN := false;
    v_is_private_slug BOOLEAN := false;
    v_has_legacy_private_token BOOLEAN := false;
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

    v_private_slug := COALESCE(nullif(trim(v_event.private_slug), ''), nullif(trim(v_event.join_code), ''));
    v_is_private_slug := v_private_slug IS NOT NULL AND v_requested_slug = v_private_slug;
    v_has_legacy_private_token := nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
        AND p_access_code = v_private_slug;
    v_visibility := COALESCE(v_event.visibility, CASE WHEN v_event.is_public THEN 'public' ELSE 'private' END);
    v_is_host := auth.uid() IS NOT NULL AND public.is_event_host(v_event.id, auth.uid());
    v_has_access_code := nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
        AND p_access_code = v_event.access_code;
    v_is_shared := auth.uid() IS NOT NULL AND public.is_event_shared_with_user_active(v_event.id, auth.uid());
    v_is_attendee := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = v_event.id
          AND ea.status IN ('confirmed', 'waitlist', 'pending_approval')
          AND (
              ea.user_id = auth.uid()
              OR ap.user_id = auth.uid()
          )
    );

    v_can_view_full := (
        v_visibility = 'public'
        OR v_is_host
        OR v_is_shared
        OR v_is_attendee
        OR v_is_private_slug
        OR v_has_legacy_private_token
        OR v_has_access_code
    );

    IF v_can_view_full
       AND auth.uid() IS NOT NULL
       AND NOT v_is_host
       AND (v_is_private_slug OR v_has_legacy_private_token) THEN
        BEGIN
            PERFORM public.mark_event_shared_with_me(v_event.id, 'link');
        EXCEPTION
            WHEN OTHERS THEN
                NULL;
        END;

        BEGIN
            PERFORM public.record_event_private_view(v_event.id, auth.uid());
        EXCEPTION
            WHEN OTHERS THEN
                NULL;
        END;
    END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

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
    v_is_attendee BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code,
        COALESCE(nullif(trim(e.private_slug), ''), nullif(trim(e.join_code), ''))
    INTO
        v_visibility,
        v_event_access_code,
        v_private_slug
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_visibility IS NULL THEN
        RETURN;
    END IF;

    v_is_shared := auth.uid() IS NOT NULL AND public.is_event_shared_with_user_active(p_event_id, auth.uid());

    v_is_attendee := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status IN ('confirmed', 'waitlist', 'pending_approval')
          AND (
              ea.user_id = auth.uid()
              OR ap.user_id = auth.uid()
          )
    );

    v_can_view := v_visibility = 'public'
        OR (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
        OR v_is_shared
        OR v_is_attendee
        OR (
            nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
            AND (
                p_access_code = v_event_access_code
                OR p_access_code = coalesce(v_private_slug, '')
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
    v_is_attendee BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code,
        COALESCE(nullif(trim(e.private_slug), ''), nullif(trim(e.join_code), ''))
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

    v_is_shared := auth.uid() IS NOT NULL AND public.is_event_shared_with_user_active(p_event_id, auth.uid());

    v_is_attendee := auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status IN ('confirmed', 'waitlist', 'pending_approval')
          AND (
              ea.user_id = auth.uid()
              OR ap.user_id = auth.uid()
          )
    );

    v_can_view_named := (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
        OR v_is_shared
        OR v_is_attendee
        OR (
            nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
            AND (
                p_access_code = v_event_access_code
                OR p_access_code = coalesce(v_private_slug, '')
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

CREATE OR REPLACE FUNCTION public.list_my_shared_activities()
RETURNS SETOF public.events AS $$
    SELECT DISTINCT e.*
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

CREATE OR REPLACE FUNCTION public.host_list_share_suggestions(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    email TEXT,
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
            ap.email,
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
            NULLIF(trim(regexp_replace(split_part(COALESCE(p.email, ''), '@', 1), '[._-]+', ' ', 'g')), ''),
            'Community member'
        ) AS display_name,
        p.email,
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
            p.email,
            c.user_id::TEXT
        ) ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_share_suggestions(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_share_event_with_users(
    p_event_id UUID,
    p_user_ids UUID[],
    p_source TEXT DEFAULT 'link'
) RETURNS JSON AS $$
DECLARE
    v_source TEXT := CASE
        WHEN lower(trim(coalesce(p_source, ''))) = 'code' THEN 'code'
        WHEN lower(trim(coalesce(p_source, ''))) = 'host_share' THEN 'host_share'
        ELSE 'host_share'
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
            source,
            unlock_private_slug,
            unlock_join_code
        )
        SELECT
            p_event_id,
            r.user_id,
            v_source,
            NULL,
            NULL
        FROM requested r
        ON CONFLICT (event_id, user_id)
        DO UPDATE SET
            source = 'host_share',
            unlock_private_slug = NULL,
            unlock_join_code = NULL
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
            source,
            unlock_private_slug,
            unlock_join_code
        )
        VALUES (
            v_request.event_id,
            v_request.requester_user_id,
            'host_share',
            NULL,
            NULL
        )
        ON CONFLICT (event_id, user_id)
        DO UPDATE SET
            source = 'host_share',
            unlock_private_slug = NULL,
            unlock_join_code = NULL;

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
