CREATE OR REPLACE FUNCTION public.host_add_attendee_with_custom_answer(
  p_event_id UUID,
  p_guest_name TEXT,
  p_whatsapp TEXT DEFAULT NULL,
  p_custom_join_answer TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_actor_uid UUID;
  v_event_status TEXT;
  v_require_approval BOOLEAN := false;
  v_allow_waitlist BOOLEAN := false;
  v_capacity INTEGER;
  v_confirmed_count INTEGER := 0;
  v_status TEXT;
  v_guest_name TEXT;
  v_whatsapp_normalized TEXT;
  v_name_slug TEXT;
  v_guest_email TEXT;
  v_linked_profile_id UUID;
  v_linked_user_id UUID;
  v_existing_active_id UUID;
  v_existing_cancelled_id UUID;
  v_attendee_id UUID;
  v_custom_field_config JSONB;
  v_field_enabled BOOLEAN := false;
  v_field_required BOOLEAN := false;
  v_field_type TEXT := 'text';
  v_field_label TEXT;
  v_answer TEXT;
  v_result TEXT := 'created';
BEGIN
  v_actor_uid := auth.uid();
  IF p_event_id IS NULL THEN
    RETURN json_build_object('error', 'Missing event id');
  END IF;

  IF v_actor_uid IS NULL OR NOT public.is_event_host(p_event_id, v_actor_uid) THEN
    RETURN json_build_object('error', 'Not authorized to add attendees');
  END IF;

  v_guest_name := nullif(trim(coalesce(p_guest_name, '')), '');
  IF v_guest_name IS NULL THEN
    RETURN json_build_object('error', 'Guest name is required');
  END IF;

  SELECT
    e.status,
    coalesce(e.require_host_approval_for_join, false),
    coalesce(e.allow_waitlist, false),
    e.capacity,
    e.custom_join_field_config
  INTO
    v_event_status,
    v_require_approval,
    v_allow_waitlist,
    v_capacity,
    v_custom_field_config
  FROM public.events e
  WHERE e.id = p_event_id;

  IF v_event_status IS NULL OR v_capacity IS NULL THEN
    RETURN json_build_object('error', 'Event not found');
  END IF;

  IF v_event_status <> 'scheduled' THEN
    RETURN json_build_object('error', 'Event is not open for attendee changes');
  END IF;

  v_whatsapp_normalized := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), '');
  IF v_whatsapp_normalized IS NOT NULL THEN
    SELECT
      ap.id,
      ap.user_id
    INTO
      v_linked_profile_id,
      v_linked_user_id
    FROM public.attendee_profiles ap
    WHERE nullif(regexp_replace(coalesce(ap.whatsapp_number, ''), '\D', '', 'g'), '') = v_whatsapp_normalized
    ORDER BY ap.whatsapp_verified_at DESC NULLS LAST, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  v_name_slug := regexp_replace(lower(v_guest_name), '[^a-z0-9]+', '-', 'g');
  v_name_slug := regexp_replace(v_name_slug, '(^-+|-+$)', '', 'g');
  IF nullif(v_name_slug, '') IS NULL THEN
    v_name_slug := 'guest';
  END IF;

  IF v_whatsapp_normalized IS NOT NULL THEN
    v_guest_email := concat('host-wa+', v_whatsapp_normalized, '-', v_name_slug, '@proxy.im-in.local');
  ELSE
    v_guest_email := concat('host-guest+', v_name_slug, '@proxy.im-in.local');
  END IF;

  SELECT ea.id
  INTO v_existing_active_id
  FROM public.event_attendees ea
  WHERE ea.event_id = p_event_id
    AND lower(coalesce(ea.guest_email, '')) = lower(v_guest_email)
    AND ea.status <> 'cancelled'
  LIMIT 1;

  IF v_existing_active_id IS NOT NULL THEN
    RETURN json_build_object('error', 'This attendee is already on the activity');
  END IF;

  IF v_require_approval THEN
    v_status := 'pending_approval';
  ELSE
    SELECT count(*)
    INTO v_confirmed_count
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.status = 'confirmed';

    IF v_confirmed_count < v_capacity THEN
      v_status := 'confirmed';
    ELSIF v_allow_waitlist THEN
      v_status := 'waitlist';
    ELSE
      RETURN json_build_object('error', 'Activity is full and waitlist is disabled');
    END IF;
  END IF;

  v_answer := nullif(trim(coalesce(p_custom_join_answer, '')), '');
  IF jsonb_typeof(v_custom_field_config) = 'object' THEN
    v_field_enabled := coalesce((v_custom_field_config ->> 'enabled')::boolean, false);
    v_field_required := coalesce((v_custom_field_config ->> 'required')::boolean, false);
    v_field_type := lower(coalesce(v_custom_field_config ->> 'type', 'text'));
    v_field_label := nullif(trim(coalesce(v_custom_field_config ->> 'label', '')), '');
  END IF;

  IF v_field_enabled THEN
    IF v_field_required AND v_answer IS NULL THEN
      RETURN json_build_object('error', coalesce(v_field_label, 'This field') || ' is required');
    END IF;
    IF v_answer IS NOT NULL AND v_field_type = 'number' AND v_answer !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN json_build_object('error', 'Please enter a valid number');
    END IF;
    IF v_answer IS NOT NULL AND v_field_type = 'select' AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(v_custom_field_config -> 'options', '[]'::jsonb)) AS option_value(value)
      WHERE lower(trim(option_value.value)) = lower(v_answer)
    ) THEN
      RETURN json_build_object('error', 'Please choose one of the provided options');
    END IF;
  ELSE
    v_answer := NULL;
  END IF;

  SELECT ea.id
  INTO v_existing_cancelled_id
  FROM public.event_attendees ea
  WHERE ea.event_id = p_event_id
    AND lower(coalesce(ea.guest_email, '')) = lower(v_guest_email)
    AND ea.status = 'cancelled'
  ORDER BY ea.cancelled_at DESC NULLS LAST
  LIMIT 1;

  IF v_existing_cancelled_id IS NOT NULL THEN
    UPDATE public.event_attendees
    SET
      status = v_status,
      guest_name = v_guest_name,
      guest_email = v_guest_email,
      user_id = v_linked_user_id,
      attendee_profile_id = v_linked_profile_id,
      added_by_type = 'host',
      added_by_attendee_profile_id = NULL,
      joined_at = now(),
      promoted_at = NULL,
      cancelled_at = NULL
    WHERE id = v_existing_cancelled_id
    RETURNING id INTO v_attendee_id;
    v_result := 'revived';
  ELSE
    INSERT INTO public.event_attendees (
      event_id,
      user_id,
      attendee_profile_id,
      guest_name,
      guest_email,
      status,
      added_by_type,
      added_by_attendee_profile_id
    )
    VALUES (
      p_event_id,
      v_linked_user_id,
      v_linked_profile_id,
      v_guest_name,
      v_guest_email,
      v_status,
      'host',
      NULL
    )
    RETURNING id INTO v_attendee_id;
  END IF;

  IF v_attendee_id IS NOT NULL THEN
    IF v_answer IS NULL THEN
      DELETE FROM public.event_signup_field_answers
      WHERE event_attendee_id = v_attendee_id;
    ELSE
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
  END IF;

  RETURN json_build_object(
    'result', v_result,
    'attendee_id', v_attendee_id,
    'status', v_status,
    'linked_attendee_profile_id', v_linked_profile_id,
    'linked_user_id', v_linked_user_id,
    'whatsapp_matched', v_linked_profile_id IS NOT NULL
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_add_attendee_with_custom_answer(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE TABLE IF NOT EXISTS public.contact_identity_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_lookup_hash TEXT UNIQUE,
  whatsapp_encrypted TEXT,
  whatsapp_last4 TEXT,
  created_by_host_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_attendee_profile_id UUID REFERENCES public.attendee_profiles(id) ON DELETE SET NULL,
  linked_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contact_identity_reservations IS
  'Reserved for future encrypted WhatsApp-backed lite identity claims. Current app flows do not read or write this table yet.';

ALTER TABLE public.contact_identity_reservations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.event_access_requests
  ADD COLUMN IF NOT EXISTS requester_contact_identity_id UUID REFERENCES public.contact_identity_reservations(id) ON DELETE SET NULL;

ALTER TABLE public.event_shared_with_users
  ADD COLUMN IF NOT EXISTS contact_identity_id UUID REFERENCES public.contact_identity_reservations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_access_requests_requester_contact_identity_idx
  ON public.event_access_requests (requester_contact_identity_id);

CREATE INDEX IF NOT EXISTS event_shared_with_users_contact_identity_idx
  ON public.event_shared_with_users (contact_identity_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'touch_updated_at'
      AND n.nspname = 'public'
  ) THEN
    DROP TRIGGER IF EXISTS contact_identity_reservations_touch_updated_at ON public.contact_identity_reservations;
    CREATE TRIGGER contact_identity_reservations_touch_updated_at
      BEFORE UPDATE ON public.contact_identity_reservations
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END;
$$;
