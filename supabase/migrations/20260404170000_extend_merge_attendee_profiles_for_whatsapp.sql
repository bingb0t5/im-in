CREATE OR REPLACE FUNCTION public.merge_attendee_profiles(
    p_source_profile_id UUID,
    p_target_profile_id UUID,
    p_session_token TEXT DEFAULT NULL
) RETURNS public.attendee_profiles AS $$
DECLARE
    v_source public.attendee_profiles%ROWTYPE;
    v_target public.attendee_profiles%ROWTYPE;
    v_is_authorized BOOLEAN := false;
    v_source_name TEXT;
    v_target_name TEXT;
BEGIN
    IF p_source_profile_id IS NULL OR p_target_profile_id IS NULL THEN
        RAISE EXCEPTION 'Missing profile ids';
    END IF;

    IF p_source_profile_id = p_target_profile_id THEN
        SELECT *
        INTO v_target
        FROM public.attendee_profiles
        WHERE id = p_target_profile_id;

        IF v_target.id IS NULL THEN
            RAISE EXCEPTION 'Profile not found';
        END IF;

        RETURN v_target;
    END IF;

    SELECT *
    INTO v_source
    FROM public.attendee_profiles
    WHERE id = p_source_profile_id
    FOR UPDATE;

    SELECT *
    INTO v_target
    FROM public.attendee_profiles
    WHERE id = p_target_profile_id
    FOR UPDATE;

    IF v_source.id IS NULL OR v_target.id IS NULL THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF auth.uid() IS NOT NULL THEN
        v_is_authorized := auth.uid() = v_source.user_id OR auth.uid() = v_target.user_id;
    ELSIF nullif(trim(coalesce(p_session_token, '')), '') IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.attendee_sessions s
            WHERE s.token = trim(p_session_token)
              AND s.expires_at > now()
              AND s.attendee_profile_id IN (p_source_profile_id, p_target_profile_id)
        )
        INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Not authorized to merge these profiles';
    END IF;

    v_source_name := trim(concat_ws(' ', v_source.first_name, v_source.last_name));
    v_target_name := trim(concat_ws(' ', v_target.first_name, v_target.last_name));

    DELETE FROM public.event_interests src
    WHERE src.attendee_profile_id = p_source_profile_id
      AND EXISTS (
        SELECT 1
        FROM public.event_interests tgt
        WHERE tgt.attendee_profile_id = p_target_profile_id
          AND tgt.event_id = src.event_id
      );

    DELETE FROM public.event_join_requests src
    WHERE src.attendee_profile_id = p_source_profile_id
      AND src.status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM public.event_join_requests tgt
        WHERE tgt.attendee_profile_id = p_target_profile_id
          AND tgt.event_id = src.event_id
          AND tgt.status = 'pending'
      );

    UPDATE public.event_attendees
    SET attendee_profile_id = p_target_profile_id
    WHERE attendee_profile_id = p_source_profile_id;

    UPDATE public.event_attendees
    SET added_by_attendee_profile_id = p_target_profile_id
    WHERE added_by_attendee_profile_id = p_source_profile_id;

    UPDATE public.event_interests
    SET attendee_profile_id = p_target_profile_id
    WHERE attendee_profile_id = p_source_profile_id;

    UPDATE public.event_join_requests
    SET attendee_profile_id = p_target_profile_id
    WHERE attendee_profile_id = p_source_profile_id;

    UPDATE public.attendee_sessions
    SET attendee_profile_id = p_target_profile_id
    WHERE attendee_profile_id = p_source_profile_id;

    UPDATE public.attendee_profiles
    SET
        user_id = COALESCE(v_target.user_id, v_source.user_id),
        email = COALESCE(nullif(trim(coalesce(v_target.email, '')), ''), nullif(trim(coalesce(v_source.email, '')), '')),
        first_name = CASE
            WHEN v_target_name = '' AND v_source_name <> '' THEN v_source.first_name
            ELSE v_target.first_name
        END,
        last_name = CASE
            WHEN v_target_name = '' AND v_source_name <> '' THEN v_source.last_name
            ELSE v_target.last_name
        END,
        auth_provider = COALESCE(nullif(trim(coalesce(v_target.auth_provider, '')), ''), nullif(trim(coalesce(v_source.auth_provider, '')), '')),
        lalo_user_id = COALESCE(v_target.lalo_user_id, v_source.lalo_user_id),
        whatsapp_number = COALESCE(nullif(trim(coalesce(v_target.whatsapp_number, '')), ''), nullif(trim(coalesce(v_source.whatsapp_number, '')), '')),
        whatsapp_verified_at = COALESCE(v_target.whatsapp_verified_at, v_source.whatsapp_verified_at),
        updated_at = now()
    WHERE id = p_target_profile_id
    RETURNING * INTO v_target;

    DELETE FROM public.attendee_profiles
    WHERE id = p_source_profile_id;

    RETURN v_target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.merge_attendee_profiles(UUID, UUID, TEXT) TO anon, authenticated;
