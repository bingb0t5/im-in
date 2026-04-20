DROP FUNCTION IF EXISTS public.get_guest_merge_eligibility(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_guest_merge_eligibility(
  p_guest_profile_id UUID,
  p_target_profile_id UUID,
  p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_guest_attendee_count INTEGER := 0;
  v_guest_interest_count INTEGER := 0;
  v_guest_join_request_count INTEGER := 0;
  v_target_attendee_count INTEGER := 0;
  v_target_interest_count INTEGER := 0;
  v_target_join_request_count INTEGER := 0;
  v_attendee_overlap BOOLEAN := false;
BEGIN
  IF v_uid IS NULL OR p_user_id IS NULL OR v_uid <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized to evaluate merge eligibility';
  END IF;

  IF p_guest_profile_id IS NULL OR p_target_profile_id IS NULL THEN
    RAISE EXCEPTION 'Guest and target profile ids are required';
  END IF;

  IF p_guest_profile_id = p_target_profile_id THEN
    RETURN jsonb_build_object(
      'guest_attendee_count', 0,
      'guest_interest_count', 0,
      'guest_join_request_count', 0,
      'target_attendee_count', 0,
      'target_interest_count', 0,
      'target_join_request_count', 0,
      'attendee_overlap', false
    );
  END IF;

  SELECT count(*)::INTEGER
  INTO v_guest_attendee_count
  FROM public.event_attendees ea
  WHERE ea.attendee_profile_id = p_guest_profile_id
    AND ea.status <> 'cancelled';

  SELECT count(*)::INTEGER
  INTO v_guest_interest_count
  FROM public.event_interests ei
  WHERE ei.attendee_profile_id = p_guest_profile_id;

  SELECT count(*)::INTEGER
  INTO v_guest_join_request_count
  FROM public.event_join_requests jr
  WHERE jr.attendee_profile_id = p_guest_profile_id
    AND jr.status <> 'cancelled';

  SELECT count(*)::INTEGER
  INTO v_target_attendee_count
  FROM public.event_attendees ea
  WHERE ea.status <> 'cancelled'
    AND (ea.attendee_profile_id = p_target_profile_id OR ea.user_id = p_user_id);

  SELECT count(*)::INTEGER
  INTO v_target_interest_count
  FROM public.event_interests ei
  WHERE ei.attendee_profile_id = p_target_profile_id
     OR ei.user_id = p_user_id;

  SELECT count(*)::INTEGER
  INTO v_target_join_request_count
  FROM public.event_join_requests jr
  WHERE jr.status <> 'cancelled'
    AND (jr.attendee_profile_id = p_target_profile_id OR jr.user_id = p_user_id);

  SELECT EXISTS (
    SELECT 1
    FROM public.event_attendees src
    INNER JOIN public.event_attendees tgt
      ON tgt.event_id = src.event_id
    WHERE src.attendee_profile_id = p_guest_profile_id
      AND src.status <> 'cancelled'
      AND tgt.status <> 'cancelled'
      AND (tgt.attendee_profile_id = p_target_profile_id OR tgt.user_id = p_user_id)
  )
  INTO v_attendee_overlap;

  RETURN jsonb_build_object(
    'guest_attendee_count', v_guest_attendee_count,
    'guest_interest_count', v_guest_interest_count,
    'guest_join_request_count', v_guest_join_request_count,
    'target_attendee_count', v_target_attendee_count,
    'target_interest_count', v_target_interest_count,
    'target_join_request_count', v_target_join_request_count,
    'attendee_overlap', v_attendee_overlap
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guest_merge_eligibility(UUID, UUID, UUID) TO authenticated;
