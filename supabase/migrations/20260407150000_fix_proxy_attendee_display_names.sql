CREATE OR REPLACE FUNCTION public.host_list_attendees_for_dashboard(
    p_event_id UUID
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    resolved_user_id UUID,
    attendee_profile_id UUID,
    added_by_type TEXT,
    added_by_attendee_profile_id UUID,
    guest_name TEXT,
    resolved_display_name TEXT,
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
            COALESCE(
                NULLIF(trim(ap.full_name), ''),
                NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                CASE
                    WHEN nullif(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), '') IS NOT NULL
                        THEN concat('WhatsApp user ', right(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), 4))
                    ELSE NULL
                END
            ) AS display_name,
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
            COALESCE(
                NULLIF(trim(ap.full_name), ''),
                NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                CASE
                    WHEN nullif(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), '') IS NOT NULL
                        THEN concat('WhatsApp user ', right(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), 4))
                    ELSE NULL
                END
            ) AS display_name,
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
        ar.resolved_user_id,
        ar.attendee_profile_id,
        ar.added_by_type::TEXT,
        ar.added_by_attendee_profile_id,
        ar.guest_name,
        CASE
            WHEN ar.added_by_type = 'proxy'
                THEN COALESCE(NULLIF(trim(ar.guest_name), ''), pb.display_name, pid.display_name, 'Guest')
            ELSE COALESCE(pb.display_name, pid.display_name, NULLIF(trim(ar.guest_name), ''), 'Guest')
        END AS resolved_display_name,
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

CREATE OR REPLACE FUNCTION public.list_event_attendees_for_view(
    p_event_id UUID,
    p_access_code TEXT DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    resolved_user_id UUID,
    attendee_profile_id UUID,
    added_by_type TEXT,
    added_by_attendee_profile_id UUID,
    guest_name TEXT,
    resolved_display_name TEXT,
    guest_email TEXT,
    status TEXT,
    joined_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    whatsapp_number TEXT
) AS $$
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
            COALESCE(
                NULLIF(trim(ap.full_name), ''),
                NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                CASE
                    WHEN nullif(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), '') IS NOT NULL
                        THEN concat('WhatsApp user ', right(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), 4))
                    ELSE NULL
                END
            ) AS display_name,
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
            COALESCE(
                NULLIF(trim(ap.full_name), ''),
                NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                CASE
                    WHEN nullif(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), '') IS NOT NULL
                        THEN concat('WhatsApp user ', right(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), 4))
                    ELSE NULL
                END
            ) AS display_name,
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
        ar.resolved_user_id,
        ar.attendee_profile_id,
        ar.added_by_type::TEXT,
        ar.added_by_attendee_profile_id,
        ar.guest_name,
        CASE
            WHEN ar.added_by_type = 'proxy'
                THEN COALESCE(NULLIF(trim(ar.guest_name), ''), pb.display_name, pid.display_name, 'Guest')
            ELSE COALESCE(pb.display_name, pid.display_name, NULLIF(trim(ar.guest_name), ''), 'Guest')
        END AS resolved_display_name,
        ar.guest_email,
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

GRANT EXECUTE ON FUNCTION public.list_event_attendees_for_view(UUID, TEXT) TO anon, authenticated;
