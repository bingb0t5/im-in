-- Phase 1 + Phase 2 foundation:
-- - Non-signup activity behavior via participation_mode / interest_visibility.
-- - Imported listing provenance on events.
-- - Import source/snapshot/draft pipeline tables.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS participation_mode TEXT NOT NULL DEFAULT 'rsvp',
  ADD COLUMN IF NOT EXISTS interest_visibility TEXT NOT NULL DEFAULT 'count_only',
  ADD COLUMN IF NOT EXISTS origin_type TEXT NOT NULL DEFAULT 'host_created',
  ADD COLUMN IF NOT EXISTS event_source_id UUID,
  ADD COLUMN IF NOT EXISTS external_event_draft_id UUID,
  ADD COLUMN IF NOT EXISTS source_attribution_label TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trust_badge TEXT,
  ADD COLUMN IF NOT EXISTS is_claimable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_by_host_id UUID,
  ADD COLUMN IF NOT EXISTS external_contact_mode TEXT,
  ADD COLUMN IF NOT EXISTS external_contact_value TEXT;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_participation_mode_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_participation_mode_check
  CHECK (participation_mode IN ('rsvp', 'interest_only', 'external_contact', 'view_only'));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_interest_visibility_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_interest_visibility_check
  CHECK (interest_visibility IN ('count_only', 'named', 'hidden'));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_origin_type_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_origin_type_check
  CHECK (origin_type IN ('host_created', 'imported_community_source', 'imported_verified_partner', 'curated_manual'));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_trust_badge_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_trust_badge_check
  CHECK (trust_badge IS NULL OR trust_badge IN ('hosted_in_im_in', 'community_listing', 'verified_partner', 'curated'));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_external_contact_mode_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_external_contact_mode_check
  CHECK (external_contact_mode IS NULL OR external_contact_mode IN ('none', 'whatsapp', 'website', 'email', 'manual'));

CREATE TABLE IF NOT EXISTS public.event_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('google_doc', 'google_sheet', 'pdf', 'web_page', 'manual_text')),
  source_url TEXT,
  community_name TEXT,
  description TEXT,
  default_location_area TEXT,
  default_community_tags TEXT[] NOT NULL DEFAULT '{}',
  default_age_tags TEXT[] NOT NULL DEFAULT '{}',
  owner_name TEXT,
  owner_contact TEXT,
  trust_level TEXT NOT NULL DEFAULT 'community_source'
    CHECK (trust_level IN ('community_source', 'known_organiser', 'verified_partner', 'internal_curated')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_imported_at TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  last_published_at TIMESTAMPTZ,
  sync_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (sync_mode IN ('manual', 'semi_manual', 'automatic')),
  notes TEXT,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_source_id UUID NOT NULL REFERENCES public.event_sources(id) ON DELETE CASCADE,
  raw_content_text TEXT NOT NULL,
  raw_content_hash TEXT NOT NULL,
  raw_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  capture_method TEXT NOT NULL DEFAULT 'manual_paste'
    CHECK (capture_method IN ('manual_paste', 'fetched', 'uploaded_file')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.external_event_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_source_id UUID NOT NULL REFERENCES public.event_sources(id) ON DELETE CASCADE,
  source_snapshot_id UUID NOT NULL REFERENCES public.source_snapshots(id) ON DELETE CASCADE,
  review_status TEXT NOT NULL DEFAULT 'new'
    CHECK (review_status IN ('new', 'needs_review', 'approved', 'rejected', 'published', 'superseded')),
  raw_title TEXT,
  raw_text_block TEXT,
  parsed_title TEXT,
  parsed_summary TEXT,
  parsed_description TEXT,
  parsed_location_name TEXT,
  parsed_location_area TEXT,
  parsed_google_maps_url TEXT,
  parsed_contact_name TEXT,
  parsed_contact_method TEXT,
  parsed_contact_value TEXT,
  parsed_activity_type TEXT,
  parsed_community_tags TEXT[] NOT NULL DEFAULT '{}',
  parsed_age_min INTEGER,
  parsed_age_max INTEGER,
  parsed_age_band_labels TEXT[] NOT NULL DEFAULT '{}',
  parsed_visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (parsed_visibility IN ('public', 'semi_public', 'private')),
  parsed_is_recurring BOOLEAN NOT NULL DEFAULT false,
  parsed_recurrence_text TEXT,
  parsed_rrule TEXT,
  parsed_start_datetime TIMESTAMPTZ,
  parsed_end_datetime TIMESTAMPTZ,
  parsed_timezone TEXT DEFAULT 'Asia/Ho_Chi_Minh',
  parsed_day_of_week TEXT,
  parsed_confidence_score NUMERIC,
  normalization_warnings TEXT[] NOT NULL DEFAULT '{}',
  duplicate_candidate_event_ids UUID[] NOT NULL DEFAULT '{}',
  linked_published_event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  import_notes TEXT,
  review_notes TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.events
  ADD CONSTRAINT events_event_source_id_fkey
  FOREIGN KEY (event_source_id) REFERENCES public.event_sources(id) ON DELETE SET NULL;

ALTER TABLE public.events
  ADD CONSTRAINT events_external_event_draft_id_fkey
  FOREIGN KEY (external_event_draft_id) REFERENCES public.external_event_drafts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_sources_trust_level_idx ON public.event_sources(trust_level);
CREATE INDEX IF NOT EXISTS source_snapshots_event_source_id_idx ON public.source_snapshots(event_source_id);
CREATE INDEX IF NOT EXISTS source_snapshots_raw_content_hash_idx ON public.source_snapshots(raw_content_hash);
CREATE INDEX IF NOT EXISTS external_event_drafts_source_snapshot_id_idx ON public.external_event_drafts(source_snapshot_id);
CREATE INDEX IF NOT EXISTS external_event_drafts_event_source_id_idx ON public.external_event_drafts(event_source_id);
CREATE INDEX IF NOT EXISTS external_event_drafts_review_status_idx ON public.external_event_drafts(review_status);
CREATE INDEX IF NOT EXISTS events_participation_mode_idx ON public.events(participation_mode);
CREATE INDEX IF NOT EXISTS events_origin_type_idx ON public.events(origin_type);
CREATE INDEX IF NOT EXISTS events_event_source_id_idx ON public.events(event_source_id);

DROP TRIGGER IF EXISTS event_sources_touch_updated_at ON public.event_sources;
CREATE TRIGGER event_sources_touch_updated_at
  BEFORE UPDATE ON public.event_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS external_event_drafts_touch_updated_at ON public.external_event_drafts;
CREATE TRIGGER external_event_drafts_touch_updated_at
  BEFORE UPDATE ON public.external_event_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_event_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read event sources" ON public.event_sources;
CREATE POLICY "Authenticated users can read event sources"
  ON public.event_sources
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can write event sources" ON public.event_sources;
CREATE POLICY "Authenticated users can write event sources"
  ON public.event_sources
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read source snapshots" ON public.source_snapshots;
CREATE POLICY "Authenticated users can read source snapshots"
  ON public.source_snapshots
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can write source snapshots" ON public.source_snapshots;
CREATE POLICY "Authenticated users can write source snapshots"
  ON public.source_snapshots
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can read external event drafts" ON public.external_event_drafts;
CREATE POLICY "Authenticated users can read external event drafts"
  ON public.external_event_drafts
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can write external event drafts" ON public.external_event_drafts;
CREATE POLICY "Authenticated users can write external event drafts"
  ON public.external_event_drafts
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_event_drafts TO authenticated;

DROP FUNCTION IF EXISTS public.get_event_for_view(TEXT, TEXT);

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
    participation_mode TEXT,
    interest_visibility TEXT,
    origin_type TEXT,
    source_attribution_label TEXT,
    source_url TEXT,
    source_last_checked_at TIMESTAMPTZ,
    trust_badge TEXT,
    external_contact_mode TEXT,
    external_contact_value TEXT,
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
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.private_slug
        END,
        CASE
            WHEN v_visibility = 'semi_public' AND NOT v_can_view_full THEN NULL
            ELSE v_event.join_code
        END,
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
        coalesce(v_event.participation_mode, 'rsvp'),
        coalesce(v_event.interest_visibility, 'count_only'),
        coalesce(v_event.origin_type, 'host_created'),
        v_event.source_attribution_label,
        v_event.source_url,
        v_event.source_last_checked_at,
        v_event.trust_badge,
        v_event.external_contact_mode,
        v_event.external_contact_value,
        v_event.is_public,
        v_event.public_discovery_enabled,
        CASE
            WHEN v_is_host THEN v_event.moderation_status
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_risk_level
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_action
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_confidence
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_reasons
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_input_hash
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderated_at
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_archived_at
            ELSE NULL
        END,
        CASE
            WHEN v_is_host THEN v_event.moderation_override
            ELSE NULL
        END,
        v_event.status,
        v_event.created_at,
        v_event.updated_at,
        v_can_view_full;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_event_for_view(TEXT, TEXT) TO anon, authenticated;

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
  v_participation_mode TEXT;
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
    coalesce(e.participation_mode, 'rsvp'),
    e.custom_join_field_config
  INTO v_event_status, v_participation_mode, v_field_config
  FROM public.events e
  WHERE e.id = p_event_id;

  IF v_event_status IS NULL OR v_event_status <> 'scheduled' THEN
    RETURN json_build_object('error', 'Event not found');
  END IF;

  IF v_participation_mode <> 'rsvp' THEN
    RETURN json_build_object('error', 'RSVP is disabled for this activity');
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
  v_participation_mode TEXT;
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
    coalesce(e.participation_mode, 'rsvp'),
    e.custom_join_field_config
  INTO v_event_status, v_participation_mode, v_field_config
  FROM public.events e
  WHERE e.id = p_event_id;

  IF v_event_status IS NULL OR v_event_status <> 'scheduled' THEN
    RETURN json_build_object('error', 'Event not found');
  END IF;

  IF v_participation_mode <> 'rsvp' THEN
    RETURN json_build_object('error', 'RSVP is disabled for this activity');
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

