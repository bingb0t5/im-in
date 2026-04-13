-- Add one host-configurable custom join field per activity.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS custom_join_field_config JSONB;

-- Store custom field answers in a host-only table (not on event_attendees).
CREATE TABLE IF NOT EXISTS public.event_signup_field_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_attendee_id UUID REFERENCES public.event_attendees(id) ON DELETE CASCADE,
  event_join_request_id UUID REFERENCES public.event_join_requests(id) ON DELETE CASCADE,
  answer_value TEXT NOT NULL,
  field_label_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_signup_field_answers_target_check
    CHECK ((event_attendee_id IS NOT NULL) <> (event_join_request_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS event_signup_field_answers_attendee_uidx
  ON public.event_signup_field_answers (event_attendee_id);

CREATE UNIQUE INDEX IF NOT EXISTS event_signup_field_answers_join_request_uidx
  ON public.event_signup_field_answers (event_join_request_id);

CREATE INDEX IF NOT EXISTS event_signup_field_answers_event_id_idx
  ON public.event_signup_field_answers (event_id);

DROP TRIGGER IF EXISTS event_signup_field_answers_touch_updated_at ON public.event_signup_field_answers;
CREATE TRIGGER event_signup_field_answers_touch_updated_at
  BEFORE UPDATE ON public.event_signup_field_answers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.event_signup_field_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts can view custom signup answers" ON public.event_signup_field_answers;
CREATE POLICY "Hosts can view custom signup answers"
  ON public.event_signup_field_answers
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND public.is_event_host(event_id, auth.uid())
  );

GRANT SELECT ON public.event_signup_field_answers TO authenticated;

CREATE OR REPLACE FUNCTION public.request_or_submit_rsvp_with_custom_answer(
  p_event_id UUID,
  p_guest_name TEXT,
  p_guest_email TEXT,
  p_attendee_profile_id UUID DEFAULT NULL,
  p_custom_join_answer TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_result JSON;
  v_event_status TEXT;
  v_field_config JSONB;
  v_field_enabled BOOLEAN := false;
  v_field_required BOOLEAN := false;
  v_field_type TEXT := 'text';
  v_field_label TEXT;
  v_answer TEXT;
  v_attendee_id UUID;
  v_request_id UUID;
BEGIN
  v_answer := nullif(trim(coalesce(p_custom_join_answer, '')), '');

  SELECT
    e.status,
    e.custom_join_field_config
  INTO v_event_status, v_field_config
  FROM public.events e
  WHERE e.id = p_event_id;

  IF v_event_status IS NULL OR v_event_status <> 'scheduled' THEN
    RETURN json_build_object('error', 'Event not found');
  END IF;

  IF jsonb_typeof(v_field_config) = 'object' THEN
    v_field_enabled := coalesce((v_field_config ->> 'enabled')::boolean, false);
    v_field_required := coalesce((v_field_config ->> 'required')::boolean, false);
    v_field_type := lower(coalesce(v_field_config ->> 'type', 'text'));
    v_field_label := nullif(trim(coalesce(v_field_config ->> 'label', '')), '');
  END IF;

  IF v_field_enabled THEN
    IF v_field_required AND v_answer IS NULL THEN
      RETURN json_build_object('error', coalesce(v_field_label, 'This field') || ' is required');
    END IF;

    IF v_answer IS NOT NULL AND v_field_type = 'number' THEN
      IF v_answer !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
        RETURN json_build_object('error', 'Please enter a valid number');
      END IF;
    END IF;

    IF v_answer IS NOT NULL AND v_field_type = 'select' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(v_field_config -> 'options', '[]'::jsonb)) AS option_value(value)
        WHERE lower(trim(option_value.value)) = lower(v_answer)
      ) THEN
        RETURN json_build_object('error', 'Please choose one of the provided options');
      END IF;
    END IF;
  ELSE
    v_answer := NULL;
  END IF;

  v_result := public.request_or_submit_rsvp(
    p_event_id,
    p_guest_name,
    p_guest_email,
    p_attendee_profile_id
  );

  IF coalesce(v_result ->> 'error', '') <> '' OR v_answer IS NULL THEN
    RETURN v_result;
  END IF;

  BEGIN
    v_attendee_id := nullif(v_result ->> 'attendee_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_attendee_id := NULL;
  END;

  BEGIN
    v_request_id := nullif(v_result ->> 'request_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_request_id := NULL;
  END;

  IF v_attendee_id IS NOT NULL THEN
    INSERT INTO public.event_signup_field_answers (
      event_id,
      event_attendee_id,
      answer_value,
      field_label_snapshot
    )
    VALUES (
      p_event_id,
      v_attendee_id,
      v_answer,
      v_field_label
    )
    ON CONFLICT (event_attendee_id) DO UPDATE
    SET
      answer_value = EXCLUDED.answer_value,
      field_label_snapshot = EXCLUDED.field_label_snapshot,
      updated_at = now();
  END IF;

  IF v_request_id IS NOT NULL THEN
    INSERT INTO public.event_signup_field_answers (
      event_id,
      event_join_request_id,
      answer_value,
      field_label_snapshot
    )
    VALUES (
      p_event_id,
      v_request_id,
      v_answer,
      v_field_label
    )
    ON CONFLICT (event_join_request_id) DO UPDATE
    SET
      answer_value = EXCLUDED.answer_value,
      field_label_snapshot = EXCLUDED.field_label_snapshot,
      updated_at = now();
  END IF;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.request_or_submit_rsvp_with_custom_answer(UUID, TEXT, TEXT, UUID, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_proxy_attendee_with_custom_answer(
  p_event_id UUID,
  p_proxy_name TEXT,
  p_attendee_profile_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_owner_email TEXT DEFAULT NULL,
  p_session_token TEXT DEFAULT NULL,
  p_custom_join_answer TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_result JSON;
  v_event_status TEXT;
  v_field_config JSONB;
  v_field_enabled BOOLEAN := false;
  v_field_required BOOLEAN := false;
  v_field_type TEXT := 'text';
  v_field_label TEXT;
  v_answer TEXT;
  v_attendee_id UUID;
  v_request_id UUID;
BEGIN
  v_answer := nullif(trim(coalesce(p_custom_join_answer, '')), '');

  SELECT
    e.status,
    e.custom_join_field_config
  INTO v_event_status, v_field_config
  FROM public.events e
  WHERE e.id = p_event_id;

  IF v_event_status IS NULL OR v_event_status <> 'scheduled' THEN
    RETURN json_build_object('error', 'Event not found');
  END IF;

  IF jsonb_typeof(v_field_config) = 'object' THEN
    v_field_enabled := coalesce((v_field_config ->> 'enabled')::boolean, false);
    v_field_required := coalesce((v_field_config ->> 'required')::boolean, false);
    v_field_type := lower(coalesce(v_field_config ->> 'type', 'text'));
    v_field_label := nullif(trim(coalesce(v_field_config ->> 'label', '')), '');
  END IF;

  IF v_field_enabled THEN
    IF v_field_required AND v_answer IS NULL THEN
      RETURN json_build_object('error', coalesce(v_field_label, 'This field') || ' is required');
    END IF;

    IF v_answer IS NOT NULL AND v_field_type = 'number' THEN
      IF v_answer !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
        RETURN json_build_object('error', 'Please enter a valid number');
      END IF;
    END IF;

    IF v_answer IS NOT NULL AND v_field_type = 'select' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(v_field_config -> 'options', '[]'::jsonb)) AS option_value(value)
        WHERE lower(trim(option_value.value)) = lower(v_answer)
      ) THEN
        RETURN json_build_object('error', 'Please choose one of the provided options');
      END IF;
    END IF;
  ELSE
    v_answer := NULL;
  END IF;

  v_result := public.add_proxy_attendee(
    p_event_id,
    p_proxy_name,
    p_attendee_profile_id,
    p_user_id,
    p_owner_email,
    p_session_token
  );

  IF coalesce(v_result ->> 'error', '') <> '' OR v_answer IS NULL THEN
    RETURN v_result;
  END IF;

  BEGIN
    v_attendee_id := nullif(v_result ->> 'attendee_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_attendee_id := NULL;
  END;

  BEGIN
    v_request_id := nullif(v_result ->> 'request_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_request_id := NULL;
  END;

  IF v_attendee_id IS NOT NULL THEN
    INSERT INTO public.event_signup_field_answers (
      event_id,
      event_attendee_id,
      answer_value,
      field_label_snapshot
    )
    VALUES (
      p_event_id,
      v_attendee_id,
      v_answer,
      v_field_label
    )
    ON CONFLICT (event_attendee_id) DO UPDATE
    SET
      answer_value = EXCLUDED.answer_value,
      field_label_snapshot = EXCLUDED.field_label_snapshot,
      updated_at = now();
  END IF;

  IF v_request_id IS NOT NULL THEN
    INSERT INTO public.event_signup_field_answers (
      event_id,
      event_join_request_id,
      answer_value,
      field_label_snapshot
    )
    VALUES (
      p_event_id,
      v_request_id,
      v_answer,
      v_field_label
    )
    ON CONFLICT (event_join_request_id) DO UPDATE
    SET
      answer_value = EXCLUDED.answer_value,
      field_label_snapshot = EXCLUDED.field_label_snapshot,
      updated_at = now();
  END IF;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.add_proxy_attendee_with_custom_answer(UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
