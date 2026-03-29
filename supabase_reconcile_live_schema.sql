-- Supabase reconciliation script for an already-live schema.
--
-- Safe goals:
-- 1) Add indexes that match current app query patterns.
-- 2) Keep event_waitlist_positions integrity tight (if no duplicate data exists).
-- 3) Add updated_at maintenance for attendee_profiles.
--
-- This script intentionally avoids:
-- - changing RSVP uniqueness semantics on event_attendees
-- - altering existing RLS policies
-- - dropping columns/constraints

-- -------------------------------------------------------------------
-- 1) Performance indexes used by frontend queries
-- -------------------------------------------------------------------

-- Events listing and calendar queries
CREATE INDEX IF NOT EXISTS events_status_starts_at_idx
    ON public.events (status, starts_at);

CREATE INDEX IF NOT EXISTS events_is_public_status_starts_at_idx
    ON public.events (is_public, status, starts_at);

CREATE INDEX IF NOT EXISTS events_host_user_id_idx
    ON public.events (host_user_id);

-- Event attendees query patterns
CREATE INDEX IF NOT EXISTS event_attendees_event_id_status_joined_at_idx
    ON public.event_attendees (event_id, status, joined_at);

CREATE INDEX IF NOT EXISTS event_attendees_event_id_user_id_status_idx
    ON public.event_attendees (event_id, user_id, status);

CREATE INDEX IF NOT EXISTS event_attendees_event_id_attendee_profile_id_status_idx
    ON public.event_attendees (event_id, attendee_profile_id, status);

CREATE INDEX IF NOT EXISTS event_attendees_event_id_guest_email_idx
    ON public.event_attendees (event_id, guest_email);

CREATE INDEX IF NOT EXISTS event_attendees_guest_email_lower_idx
    ON public.event_attendees (lower(guest_email));

CREATE INDEX IF NOT EXISTS event_attendees_attendee_profile_id_idx
    ON public.event_attendees (attendee_profile_id);

-- Guest session/profile patterns
CREATE INDEX IF NOT EXISTS attendee_sessions_expires_at_idx
    ON public.attendee_sessions (expires_at);

CREATE INDEX IF NOT EXISTS attendee_sessions_profile_id_idx
    ON public.attendee_sessions (attendee_profile_id);

CREATE INDEX IF NOT EXISTS attendee_profiles_user_id_idx
    ON public.attendee_profiles (user_id);

CREATE INDEX IF NOT EXISTS attendee_profiles_email_lower_idx
    ON public.attendee_profiles (lower(email));

-- Waitlist traversal
CREATE INDEX IF NOT EXISTS event_waitlist_positions_event_id_position_idx
    ON public.event_waitlist_positions (event_id, position);

CREATE INDEX IF NOT EXISTS event_waitlist_positions_attendee_id_idx
    ON public.event_waitlist_positions (attendee_id);

-- -------------------------------------------------------------------
-- 2) Optional integrity constraints for waitlist table
--    Only added if existing data has no duplicates.
-- -------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, attendee_id, count(*) AS c
            FROM public.event_waitlist_positions
            GROUP BY event_id, attendee_id
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_waitlist_positions_event_attendee_uidx
            ON public.event_waitlist_positions (event_id, attendee_id);
    ELSE
        RAISE NOTICE 'Skipped unique index on (event_id, attendee_id): duplicate rows exist.';
    END IF;
END $$;

DO $$
DECLARE
    status_constraint RECORD;
BEGIN
    -- First remove the canonical constraint by name if present.
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.event_attendees'::regclass
          AND conname = 'event_attendees_status_check'
    ) THEN
        ALTER TABLE public.event_attendees
            DROP CONSTRAINT event_attendees_status_check;
    END IF;

    -- Remove any legacy status check constraints (expression may be IN(...) or ANY(...)).
    FOR status_constraint IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.event_attendees'::regclass
          AND c.contype = 'c'
          AND c.conname <> 'event_attendees_status_check'
          AND pg_get_constraintdef(c.oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE public.event_attendees DROP CONSTRAINT %I', status_constraint.conname);
    END LOOP;

    ALTER TABLE public.event_attendees
        ADD CONSTRAINT event_attendees_status_check
        CHECK (status IN ('confirmed', 'waitlist', 'pending_approval', 'cancelled'));
END $$;

-- Shared helper used by multiple updated_at triggers later in the file.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------
-- 6) Feedback intake + Trello prompt pipeline
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.feedback_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_type TEXT NOT NULL CHECK (submission_type IN ('bug', 'feature', 'feedback')),
    title TEXT NOT NULL,
    details TEXT NOT NULL,
    reporter_name TEXT,
    reporter_email TEXT,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    page_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'queued_to_trello', 'blocked_abuse', 'approved', 'rejected', 'archived')),
    abuse_risk_level TEXT,
    abuse_confidence NUMERIC,
    abuse_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    abuse_blocked BOOLEAN NOT NULL DEFAULT false,
    codex_prompt_draft TEXT,
    codex_prompt_generated_at TIMESTAMPTZ,
    trello_card_id TEXT,
    trello_card_url TEXT,
    trello_list_id TEXT,
    trello_sync_status TEXT NOT NULL DEFAULT 'not_sent'
        CHECK (trello_sync_status IN ('not_sent', 'queued', 'synced', 'skipped', 'failed')),
    screenshot_storage_path TEXT,
    public_sanitized_summary TEXT,
    raw_source TEXT NOT NULL DEFAULT 'home_modal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback_submissions
    ADD COLUMN IF NOT EXISTS submission_type TEXT,
    ADD COLUMN IF NOT EXISTS title TEXT,
    ADD COLUMN IF NOT EXISTS details TEXT,
    ADD COLUMN IF NOT EXISTS reporter_name TEXT,
    ADD COLUMN IF NOT EXISTS reporter_email TEXT,
    ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS page_url TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS abuse_risk_level TEXT,
    ADD COLUMN IF NOT EXISTS abuse_confidence NUMERIC,
    ADD COLUMN IF NOT EXISTS abuse_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS abuse_blocked BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS codex_prompt_draft TEXT,
    ADD COLUMN IF NOT EXISTS codex_prompt_generated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trello_card_id TEXT,
    ADD COLUMN IF NOT EXISTS trello_card_url TEXT,
    ADD COLUMN IF NOT EXISTS trello_list_id TEXT,
    ADD COLUMN IF NOT EXISTS trello_sync_status TEXT,
    ADD COLUMN IF NOT EXISTS screenshot_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS public_sanitized_summary TEXT,
    ADD COLUMN IF NOT EXISTS raw_source TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS feedback_submissions_created_at_idx
    ON public.feedback_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_submissions_status_idx
    ON public.feedback_submissions (status);
CREATE INDEX IF NOT EXISTS feedback_submissions_trello_card_id_idx
    ON public.feedback_submissions (trello_card_id);

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.feedback_submissions FROM anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'feedback_submissions_touch_updated_at'
          AND tgrelid = 'public.feedback_submissions'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER feedback_submissions_touch_updated_at
            BEFORE UPDATE ON public.feedback_submissions
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.event_join_requests') IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'event_join_requests_touch_updated_at'
          AND tgrelid = to_regclass('public.event_join_requests')
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER event_join_requests_touch_updated_at
            BEFORE UPDATE ON public.event_join_requests
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.trello_prompt_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_submission_id UUID REFERENCES public.feedback_submissions(id) ON DELETE SET NULL,
    trello_card_id TEXT NOT NULL,
    trello_action_id TEXT,
    trigger_list_id TEXT NOT NULL,
    trigger_snapshot TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processed', 'skipped', 'failed')),
    error_message TEXT,
    generated_prompt TEXT,
    card_name_snapshot TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trello_prompt_jobs
    ADD COLUMN IF NOT EXISTS feedback_submission_id UUID REFERENCES public.feedback_submissions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS trello_card_id TEXT,
    ADD COLUMN IF NOT EXISTS trello_action_id TEXT,
    ADD COLUMN IF NOT EXISTS trigger_list_id TEXT,
    ADD COLUMN IF NOT EXISTS trigger_snapshot TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS status TEXT,
    ADD COLUMN IF NOT EXISTS error_message TEXT,
    ADD COLUMN IF NOT EXISTS generated_prompt TEXT,
    ADD COLUMN IF NOT EXISTS card_name_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS trello_prompt_jobs_action_uidx
    ON public.trello_prompt_jobs (trello_action_id)
    WHERE trello_action_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trello_prompt_jobs_card_snapshot_uidx
    ON public.trello_prompt_jobs (trello_card_id, trigger_snapshot);
CREATE INDEX IF NOT EXISTS trello_prompt_jobs_status_idx
    ON public.trello_prompt_jobs (status, created_at DESC);

ALTER TABLE public.trello_prompt_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trello_prompt_jobs FROM anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trello_prompt_jobs_touch_updated_at'
          AND tgrelid = 'public.trello_prompt_jobs'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trello_prompt_jobs_touch_updated_at
            BEFORE UPDATE ON public.trello_prompt_jobs
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
            'feedback-screenshots',
            'feedback-screenshots',
            false,
            5242880,
            ARRAY['image/png', 'image/jpeg', 'image/webp']::TEXT[]
        )
        ON CONFLICT (id) DO UPDATE
        SET
            public = false,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 2b) Attendee provenance fields ("added by ...")
-- -------------------------------------------------------------------

ALTER TABLE public.event_attendees
    ADD COLUMN IF NOT EXISTS added_by_type TEXT;

ALTER TABLE public.event_attendees
    ADD COLUMN IF NOT EXISTS added_by_attendee_profile_id UUID REFERENCES public.attendee_profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'event_attendees_added_by_type_check'
    ) THEN
        ALTER TABLE public.event_attendees
            ADD CONSTRAINT event_attendees_added_by_type_check
            CHECK (
                added_by_type IS NULL
                OR added_by_type IN ('self', 'proxy', 'host')
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_attendees_added_by_attendee_profile_id_idx
    ON public.event_attendees (added_by_attendee_profile_id);

-- -------------------------------------------------------------------
-- 2c) Event visibility + semi-public fields
-- -------------------------------------------------------------------

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS visibility TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS public_summary TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS public_location_text TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS google_maps_url TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS timezone TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS show_host_publicly BOOLEAN DEFAULT false;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS access_code TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS public_discovery_enabled BOOLEAN DEFAULT false;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'not_required';

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderation_risk_level TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderation_action TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderation_confidence NUMERIC(4,3);

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderation_reasons TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderation_input_hash TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderation_archived_at TIMESTAMPTZ;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS moderation_override TEXT;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS require_host_approval_for_join BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS public.moderator_public_identities (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    public_handle TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.moderator_public_identities ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.public_moderation_log_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type TEXT NOT NULL DEFAULT 'activity' CHECK (target_type IN ('activity')),
    target_id UUID NOT NULL,
    target_visibility_snapshot TEXT NOT NULL CHECK (target_visibility_snapshot IN ('public', 'semi_public')),
    public_title_snapshot TEXT,
    public_slug_snapshot TEXT,
    action TEXT NOT NULL CHECK (action IN ('approved', 'denied', 'flagged', 'marked_spam', 'restored', 'removed')),
    reason_code TEXT,
    public_explanation TEXT,
    moderator_public_handle TEXT NOT NULL,
    moderator_internal_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.public_moderation_log_entries ENABLE ROW LEVEL SECURITY;

CREATE SEQUENCE IF NOT EXISTS public.moderator_public_handle_seq START 1;

CREATE INDEX IF NOT EXISTS idx_public_moderation_log_entries_target_id
    ON public.public_moderation_log_entries(target_id);

CREATE INDEX IF NOT EXISTS idx_public_moderation_log_entries_created_at
    ON public.public_moderation_log_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_moderation_log_entries_action
    ON public.public_moderation_log_entries(action);

REVOKE ALL ON public.moderator_public_identities FROM anon, authenticated;
REVOKE ALL ON public.public_moderation_log_entries FROM anon, authenticated;

UPDATE public.events
SET visibility = CASE WHEN is_public THEN 'public' ELSE 'private' END
WHERE visibility IS NULL;

UPDATE public.events
SET access_code = gen_random_uuid()::text
WHERE access_code IS NULL OR btrim(access_code) = '';

UPDATE public.events
SET show_host_publicly = false
WHERE show_host_publicly IS NULL;

UPDATE public.events
SET public_discovery_enabled = CASE
    WHEN COALESCE(visibility, CASE WHEN is_public THEN 'public' ELSE 'private' END) IN ('public', 'semi_public')
        THEN true
    ELSE false
END
WHERE moderation_override IS NULL
  AND moderated_at IS NULL
  AND moderation_input_hash IS NULL;

UPDATE public.events
SET moderation_status = CASE
    WHEN COALESCE(visibility, CASE WHEN is_public THEN 'public' ELSE 'private' END) = 'private'
        THEN 'not_required'
    ELSE 'approved'
END
WHERE moderation_override IS NULL
  AND moderated_at IS NULL
  AND moderation_input_hash IS NULL;

UPDATE public.events
SET moderation_reasons = ARRAY[]::TEXT[]
WHERE moderation_reasons IS NULL;

UPDATE public.events
SET timezone = 'Asia/Ho_Chi_Minh'
WHERE timezone IS NULL OR btrim(timezone) = '';

UPDATE public.events
SET duration_minutes = LEAST(
    360,
    GREATEST(
        15,
        (
            ROUND(
                CASE
                    WHEN ends_at IS NOT NULL AND ends_at > starts_at
                        THEN EXTRACT(EPOCH FROM (ends_at - starts_at)) / 900.0
                    ELSE 4
                END
            ) * 15
        )::INTEGER
    )
)
WHERE duration_minutes IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_visibility_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_visibility_check
            CHECK (visibility IN ('public', 'semi_public', 'private'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_moderation_status_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_moderation_status_check
            CHECK (moderation_status IN ('not_required', 'pending', 'approved', 'limited', 'review', 'blocked', 'error'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_moderation_risk_level_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_moderation_risk_level_check
            CHECK (moderation_risk_level IS NULL OR moderation_risk_level IN ('low', 'medium', 'high'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_moderation_action_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_moderation_action_check
            CHECK (moderation_action IS NULL OR moderation_action IN ('allow', 'limit_visibility', 'require_review', 'block'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_moderation_override_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_moderation_override_check
            CHECK (moderation_override IS NULL OR moderation_override IN ('force_visible', 'force_limited', 'hide', 'mark_safe', 'mark_spam'));
    END IF;
END $$;

ALTER TABLE public.events
    ALTER COLUMN visibility SET DEFAULT 'semi_public';

ALTER TABLE public.events
    ALTER COLUMN timezone SET DEFAULT 'Asia/Ho_Chi_Minh';

ALTER TABLE public.events
    ALTER COLUMN timezone SET NOT NULL;

ALTER TABLE public.events
    ALTER COLUMN duration_minutes SET DEFAULT 60;

ALTER TABLE public.events
    ALTER COLUMN duration_minutes SET NOT NULL;

UPDATE public.events
SET require_host_approval_for_join = false
WHERE require_host_approval_for_join IS NULL;

ALTER TABLE public.events
    ALTER COLUMN require_host_approval_for_join SET DEFAULT false;

ALTER TABLE public.events
    ALTER COLUMN require_host_approval_for_join SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_duration_minutes_check'
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_duration_minutes_check
            CHECK (duration_minutes >= 15 AND duration_minutes <= 360 AND duration_minutes % 15 = 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_visibility_status_starts_at_idx
    ON public.events (visibility, status, starts_at);

CREATE INDEX IF NOT EXISTS events_public_discovery_status_starts_at_idx
    ON public.events (public_discovery_enabled, status, starts_at);

CREATE INDEX IF NOT EXISTS events_moderation_status_idx
    ON public.events (moderation_status);

CREATE INDEX IF NOT EXISTS events_access_code_idx
    ON public.events (access_code);

-- -------------------------------------------------------------------
-- 2d) Access request queue for semi-public events
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    requester_name TEXT NOT NULL,
    requester_whatsapp TEXT NOT NULL,
    requester_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'contacted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_access_requests_event_id_created_at_idx
    ON public.event_access_requests (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_access_requests_event_id_status_idx
    ON public.event_access_requests (event_id, status);

-- -------------------------------------------------------------------
-- 2d.1) Join request queue for host-approved membership
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_join_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    attendee_profile_id UUID REFERENCES public.attendee_profiles(id) ON DELETE SET NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    request_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_join_requests_event_id_created_at_idx
    ON public.event_join_requests (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_join_requests_event_id_status_idx
    ON public.event_join_requests (event_id, status);

CREATE INDEX IF NOT EXISTS event_join_requests_event_id_profile_idx
    ON public.event_join_requests (event_id, attendee_profile_id);

CREATE INDEX IF NOT EXISTS event_join_requests_event_id_guest_email_lower_idx
    ON public.event_join_requests (event_id, lower(guest_email));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, attendee_profile_id, count(*) AS c
            FROM public.event_join_requests
            WHERE attendee_profile_id IS NOT NULL
              AND status = 'pending'
            GROUP BY event_id, attendee_profile_id
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_join_requests_pending_profile_uidx
            ON public.event_join_requests (event_id, attendee_profile_id)
            WHERE attendee_profile_id IS NOT NULL
              AND status = 'pending';
    ELSE
        RAISE NOTICE 'Skipped unique pending-profile join-request index: duplicate rows exist.';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, lower(guest_email), count(*) AS c
            FROM public.event_join_requests
            WHERE attendee_profile_id IS NULL
              AND status = 'pending'
            GROUP BY event_id, lower(guest_email)
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_join_requests_pending_guest_email_uidx
            ON public.event_join_requests (event_id, lower(guest_email))
            WHERE attendee_profile_id IS NULL
              AND status = 'pending';
    ELSE
        RAISE NOTICE 'Skipped unique pending-email join-request index: duplicate rows exist.';
    END IF;
END $$;

-- Backfill attendee rows for existing pending join requests so they appear in "Going" with pending approval state.
WITH pending_requests AS (
    SELECT DISTINCT ON (jr.event_id, coalesce(jr.attendee_profile_id::text, lower(jr.guest_email)))
        jr.event_id,
        jr.user_id,
        jr.attendee_profile_id,
        jr.guest_name,
        lower(jr.guest_email) AS guest_email,
        jr.created_at
    FROM public.event_join_requests jr
    WHERE jr.status = 'pending'
    ORDER BY jr.event_id, coalesce(jr.attendee_profile_id::text, lower(jr.guest_email)), jr.created_at DESC
)
INSERT INTO public.event_attendees (
    event_id,
    user_id,
    attendee_profile_id,
    guest_name,
    guest_email,
    status,
    joined_at,
    added_by_type
)
SELECT
    pr.event_id,
    pr.user_id,
    pr.attendee_profile_id,
    pr.guest_name,
    pr.guest_email,
    'pending_approval',
    pr.created_at,
    'self'
FROM pending_requests pr
WHERE NOT EXISTS (
    SELECT 1
    FROM public.event_attendees ea
    WHERE ea.event_id = pr.event_id
      AND ea.status <> 'cancelled'
      AND (
        (pr.attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = pr.attendee_profile_id)
        OR lower(ea.guest_email) = pr.guest_email
      )
)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.event_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    added_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_hosts_event_user_uidx
    ON public.event_hosts (event_id, user_id);

CREATE INDEX IF NOT EXISTS event_hosts_user_id_idx
    ON public.event_hosts (user_id);

ALTER TABLE public.event_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_join_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_access_requests'
          AND policyname = 'Anyone can create event access requests'
    ) THEN
        CREATE POLICY "Anyone can create event access requests"
            ON public.event_access_requests
            FOR INSERT
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_join_requests'
          AND policyname = 'Anyone can create event join requests'
    ) THEN
        CREATE POLICY "Anyone can create event join requests"
            ON public.event_join_requests
            FOR INSERT
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_join_requests'
          AND policyname = 'Hosts can view event join requests'
    ) THEN
        CREATE POLICY "Hosts can view event join requests"
            ON public.event_join_requests
            FOR SELECT
            USING (
                auth.uid() IN (
                    SELECT e.host_user_id
                    FROM public.events e
                    WHERE e.id = event_id
                )
                OR auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = event_id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_join_requests'
          AND policyname = 'Hosts can update event join requests'
    ) THEN
        CREATE POLICY "Hosts can update event join requests"
            ON public.event_join_requests
            FOR UPDATE
            USING (
                auth.uid() IN (
                    SELECT e.host_user_id
                    FROM public.events e
                    WHERE e.id = event_id
                )
                OR auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = event_id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_join_requests'
          AND policyname = 'Requesters can view own join requests'
    ) THEN
        CREATE POLICY "Requesters can view own join requests"
            ON public.event_join_requests
            FOR SELECT
            USING (
                (
                    auth.uid() IS NOT NULL
                    AND user_id IS NOT NULL
                    AND auth.uid() = user_id
                )
                OR (
                    auth.uid() IS NOT NULL
                    AND attendee_profile_id IS NOT NULL
                    AND auth.uid() IN (
                        SELECT ap.user_id
                        FROM public.attendee_profiles ap
                        WHERE ap.id = attendee_profile_id
                    )
                )
                OR (
                    lower(coalesce(auth.jwt() ->> 'email', '')) <> ''
                    AND lower(guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_access_requests'
          AND policyname = 'Hosts can view event access requests'
    ) THEN
        CREATE POLICY "Hosts can view event access requests"
            ON public.event_access_requests
            FOR SELECT
            USING (
                auth.uid() IN (
                    SELECT e.host_user_id
                    FROM public.events e
                    WHERE e.id = event_id
                )
                OR auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = event_id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_access_requests'
          AND policyname = 'Hosts can update event access requests'
    ) THEN
        CREATE POLICY "Hosts can update event access requests"
            ON public.event_access_requests
            FOR UPDATE
            USING (
                auth.uid() IN (
                    SELECT e.host_user_id
                    FROM public.events e
                    WHERE e.id = event_id
                )
                OR auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = event_id
                )
            );
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 2e) Thinking-about-it interest rows
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_interests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    attendee_profile_id UUID REFERENCES public.attendee_profiles(id) ON DELETE SET NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    visibility_mode TEXT NOT NULL DEFAULT 'named' CHECK (visibility_mode IN ('count_only', 'named')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_interests_event_id_created_at_idx
    ON public.event_interests (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_interests_event_id_visibility_mode_idx
    ON public.event_interests (event_id, visibility_mode);

CREATE INDEX IF NOT EXISTS event_interests_event_id_user_id_idx
    ON public.event_interests (event_id, user_id);

CREATE INDEX IF NOT EXISTS event_interests_event_id_attendee_profile_id_idx
    ON public.event_interests (event_id, attendee_profile_id);

CREATE INDEX IF NOT EXISTS event_interests_event_id_guest_email_lower_idx
    ON public.event_interests (event_id, lower(guest_email));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, user_id, count(*) AS c
            FROM public.event_interests
            WHERE user_id IS NOT NULL
            GROUP BY event_id, user_id
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_user_uidx
            ON public.event_interests (event_id, user_id)
            WHERE user_id IS NOT NULL;
    ELSE
        RAISE NOTICE 'Skipped unique index on event_interests(event_id, user_id): duplicate rows exist.';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, attendee_profile_id, count(*) AS c
            FROM public.event_interests
            WHERE attendee_profile_id IS NOT NULL
            GROUP BY event_id, attendee_profile_id
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_profile_uidx
            ON public.event_interests (event_id, attendee_profile_id)
            WHERE attendee_profile_id IS NOT NULL;
    ELSE
        RAISE NOTICE 'Skipped unique index on event_interests(event_id, attendee_profile_id): duplicate rows exist.';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, lower(guest_email) AS normalized_email, count(*) AS c
            FROM public.event_interests
            GROUP BY event_id, lower(guest_email)
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_email_uidx
            ON public.event_interests (event_id, lower(guest_email));
    ELSE
        RAISE NOTICE 'Skipped unique index on event_interests(event_id, lower(guest_email)): duplicate rows exist.';
    END IF;
END $$;

ALTER TABLE public.event_interests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_interests'
          AND policyname = 'Public can view count-only interest rows'
    ) THEN
        CREATE POLICY "Public can view count-only interest rows"
            ON public.event_interests
            FOR SELECT
            USING (visibility_mode = 'count_only');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_interests'
          AND policyname = 'Hosts and members can view named interest rows'
    ) THEN
        CREATE POLICY "Hosts and members can view named interest rows"
            ON public.event_interests
            FOR SELECT
            USING (
                auth.uid() IS NOT NULL
                AND (
                    auth.uid() IN (
                        SELECT e.host_user_id
                        FROM public.events e
                        WHERE e.id = event_id
                    )
                    OR auth.uid() IN (
                        SELECT eh.user_id
                        FROM public.event_hosts eh
                        WHERE eh.event_id = event_id
                    )
                    OR auth.uid() IN (
                        SELECT ea.user_id
                        FROM public.event_attendees ea
                        WHERE ea.event_id = event_id
                          AND ea.status <> 'cancelled'
                          AND ea.user_id IS NOT NULL
                    )
                    OR auth.uid() IN (
                        SELECT ap.user_id
                        FROM public.attendee_profiles ap
                        WHERE ap.id = attendee_profile_id
                    )
                )
            );
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 2f) Additional hosts for equal co-host permissions
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    added_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_hosts_event_user_uidx
    ON public.event_hosts (event_id, user_id);

CREATE INDEX IF NOT EXISTS event_hosts_user_id_idx
    ON public.event_hosts (user_id);

INSERT INTO public.event_hosts (event_id, user_id, added_by_user_id)
SELECT e.id, e.host_user_id, e.host_user_id
FROM public.events e
WHERE e.host_user_id IS NOT NULL
ON CONFLICT (event_id, user_id) DO NOTHING;

ALTER TABLE public.event_hosts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_event_host(
    p_event_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.id = p_event_id
          AND e.host_user_id = p_user_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.event_hosts eh
        WHERE eh.event_id = p_event_id
          AND eh.user_id = p_user_id
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_event_host(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_host_count(
    p_event_id UUID
) RETURNS INTEGER AS $$
    SELECT count(*)::INTEGER
    FROM public.event_hosts eh
    WHERE eh.event_id = p_event_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.event_host_count(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_or_create_public_moderator_handle(
    p_user_id UUID
) RETURNS TEXT AS $$
DECLARE
    existing_handle TEXT;
    next_number BIGINT;
    new_handle TEXT;
BEGIN
    SELECT mpi.public_handle
    INTO existing_handle
    FROM public.moderator_public_identities mpi
    WHERE mpi.user_id = p_user_id;

    IF existing_handle IS NOT NULL THEN
        RETURN existing_handle;
    END IF;

    next_number := nextval('public.moderator_public_handle_seq');
    new_handle := 'Moderator ' || lpad(next_number::TEXT, 2, '0');

    INSERT INTO public.moderator_public_identities (user_id, public_handle)
    VALUES (p_user_id, new_handle)
    ON CONFLICT (user_id) DO UPDATE
    SET public_handle = public.moderator_public_identities.public_handle;

    RETURN (
        SELECT mpi.public_handle
        FROM public.moderator_public_identities mpi
        WHERE mpi.user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_or_create_public_moderator_handle(UUID) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_public_moderation_log(
    p_action TEXT DEFAULT NULL,
    p_target_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 30,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    id UUID,
    target_type TEXT,
    target_id UUID,
    target_visibility_snapshot TEXT,
    public_title_snapshot TEXT,
    public_slug_snapshot TEXT,
    action TEXT,
    reason_code TEXT,
    public_explanation TEXT,
    moderator_public_handle TEXT,
    created_at TIMESTAMPTZ
) AS $$
    SELECT
        entry.id,
        entry.target_type,
        entry.target_id,
        entry.target_visibility_snapshot,
        entry.public_title_snapshot,
        entry.public_slug_snapshot,
        entry.action,
        entry.reason_code,
        entry.public_explanation,
        entry.moderator_public_handle,
        entry.created_at
    FROM public.public_moderation_log_entries entry
    WHERE (p_action IS NULL OR entry.action = p_action)
      AND (p_target_id IS NULL OR entry.target_id = p_target_id)
      AND entry.target_visibility_snapshot IN ('public', 'semi_public')
    ORDER BY entry.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_public_moderation_log(TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_read_event_row(
    p_event_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.id = p_event_id
          AND COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'public'
    ) THEN
        RETURN true;
    END IF;

    IF v_user_id IS NULL AND v_email = '' THEN
        RETURN false;
    END IF;

    IF v_user_id IS NOT NULL AND public.is_event_host(p_event_id, v_user_id) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap
          ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status <> 'cancelled'
          AND (
              (v_user_id IS NOT NULL AND ea.user_id = v_user_id)
              OR (v_user_id IS NOT NULL AND ap.user_id = v_user_id)
              OR (v_email <> '' AND lower(coalesce(ea.guest_email, '')) = v_email)
          )
    ) THEN
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.event_interests ei
        LEFT JOIN public.attendee_profiles ap
          ON ap.id = ei.attendee_profile_id
        WHERE ei.event_id = p_event_id
          AND (
              (v_user_id IS NOT NULL AND ei.user_id = v_user_id)
              OR (v_user_id IS NOT NULL AND ap.user_id = v_user_id)
              OR (v_email <> '' AND lower(coalesce(ei.guest_email, '')) = v_email)
          )
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.can_read_event_row(UUID) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_event_for_view(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_event_for_view(
    p_slug TEXT,
    p_access_code TEXT DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    slug TEXT,
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
    v_visibility TEXT;
    v_is_host BOOLEAN := false;
    v_has_access_code BOOLEAN := false;
    v_can_view_full BOOLEAN := false;
BEGIN
    SELECT *
    INTO v_event
    FROM public.events e
    WHERE e.slug = p_slug
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_visibility := COALESCE(v_event.visibility, CASE WHEN v_event.is_public THEN 'public' ELSE 'private' END);
    v_is_host := auth.uid() IS NOT NULL AND public.is_event_host(v_event.id, auth.uid());
    v_has_access_code := nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
        AND p_access_code = v_event.access_code;

    v_can_view_full := v_visibility = 'public'
        OR v_visibility = 'private'
        OR (v_visibility = 'semi_public' AND (v_is_host OR v_has_access_code));

    RETURN QUERY
    SELECT
        v_event.id,
        v_event.slug,
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_event_for_view(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_public_calendar_events(
    p_now TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE (
    id UUID,
    slug TEXT,
    title TEXT,
    location_text TEXT,
    public_location_text TEXT,
    starts_at TIMESTAMPTZ,
    timezone TEXT,
    duration_minutes INTEGER,
    capacity INTEGER,
    visibility TEXT,
    is_public BOOLEAN,
    public_discovery_enabled BOOLEAN,
    status TEXT,
    access_code TEXT,
    confirmed_count INTEGER,
    thinking_count INTEGER
) AS $$
    SELECT
        e.id,
        e.slug,
        e.title,
        CASE
            WHEN COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'semi_public' THEN NULL
            ELSE e.location_text
        END AS location_text,
        e.public_location_text,
        e.starts_at,
        e.timezone,
        e.duration_minutes,
        e.capacity,
        e.visibility,
        e.is_public,
        e.public_discovery_enabled,
        e.status,
        CASE
            WHEN COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'semi_public'
                AND public.can_read_event_row(e.id)
                THEN e.access_code
            ELSE NULL
        END AS access_code,
        (
            SELECT count(*)::INTEGER
            FROM public.event_attendees ea
            WHERE ea.event_id = e.id
              AND ea.status = 'confirmed'
        ) AS confirmed_count,
        (
            SELECT count(*)::INTEGER
            FROM public.event_interests ei
            WHERE ei.event_id = e.id
        ) AS thinking_count
    FROM public.events e
    WHERE e.status = 'scheduled'
      AND e.is_public = true
      AND e.public_discovery_enabled = true
      AND e.starts_at >= COALESCE(p_now, now())
    ORDER BY e.starts_at ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_public_calendar_events(TIMESTAMPTZ) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.count_hidden_upcoming_activities(
    p_now TIMESTAMPTZ DEFAULT now(),
    p_week_ahead TIMESTAMPTZ DEFAULT now() + interval '7 days'
) RETURNS INTEGER AS $$
    SELECT count(*)::INTEGER
    FROM public.events e
    WHERE e.status = 'scheduled'
      AND e.starts_at >= COALESCE(p_now, now())
      AND e.starts_at < COALESCE(p_week_ahead, now() + interval '7 days')
      AND COALESCE(e.moderation_override, '') <> 'mark_spam'
      AND NOT (e.is_public = true AND coalesce(e.public_discovery_enabled, false) = true);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.count_hidden_upcoming_activities(TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_event_attendees_for_view(
    p_event_id UUID,
    p_access_code TEXT DEFAULT NULL
) RETURNS SETOF public.event_attendees AS $$
DECLARE
    v_visibility TEXT;
    v_event_access_code TEXT;
    v_can_view BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code
    INTO
        v_visibility,
        v_event_access_code
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_visibility IS NULL THEN
        RETURN;
    END IF;

    v_can_view := v_visibility = 'public'
        OR v_visibility = 'private'
        OR (
            v_visibility = 'semi_public'
            AND (
                (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
                OR (
                    nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
                    AND p_access_code = v_event_access_code
                )
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
    v_can_view_named BOOLEAN := false;
BEGIN
    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        e.access_code
    INTO
        v_visibility,
        v_event_access_code
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

    v_can_view_named := v_visibility = 'private'
        OR (
            v_visibility = 'semi_public'
            AND (
                (auth.uid() IS NOT NULL AND public.is_event_host(p_event_id, auth.uid()))
                OR (
                    nullif(trim(coalesce(p_access_code, '')), '') IS NOT NULL
                    AND p_access_code = v_event_access_code
                )
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

CREATE OR REPLACE FUNCTION public.get_guest_bookings(
    p_session_token TEXT
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    guest_name TEXT,
    guest_email TEXT,
    status TEXT,
    joined_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    events JSONB
) AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    SELECT s.attendee_profile_id
    INTO v_profile_id
    FROM public.attendee_sessions s
    WHERE s.token = p_session_token
      AND s.expires_at > now()
    LIMIT 1;

    IF v_profile_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        ea.id,
        ea.event_id,
        ea.user_id,
        ea.attendee_profile_id,
        ea.guest_name,
        ea.guest_email,
        ea.status,
        ea.joined_at,
        ea.promoted_at,
        ea.cancelled_at,
        to_jsonb(e) AS events
    FROM public.event_attendees ea
    JOIN public.events e
      ON e.id = ea.event_id
    WHERE ea.attendee_profile_id = v_profile_id
      AND ea.status <> 'cancelled'
      AND coalesce(ea.added_by_type, 'self') <> 'proxy'
    ORDER BY ea.joined_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_guest_bookings(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_guest_interests(
    p_session_token TEXT
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    guest_name TEXT,
    guest_email TEXT,
    visibility_mode TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    status TEXT,
    events JSONB
) AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    SELECT s.attendee_profile_id
    INTO v_profile_id
    FROM public.attendee_sessions s
    WHERE s.token = p_session_token
      AND s.expires_at > now()
    LIMIT 1;

    IF v_profile_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        ei.id,
        ei.event_id,
        ei.user_id,
        ei.attendee_profile_id,
        ei.guest_name,
        ei.guest_email,
        ei.visibility_mode,
        ei.created_at,
        ei.updated_at,
        'thinking'::TEXT AS status,
        to_jsonb(e) AS events
    FROM public.event_interests ei
    JOIN public.events e
      ON e.id = ei.event_id
    WHERE ei.attendee_profile_id = v_profile_id
    ORDER BY ei.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_guest_interests(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_my_hosted_events()
RETURNS SETOF public.events AS $$
    SELECT DISTINCT e.*
    FROM public.events e
    LEFT JOIN public.event_hosts eh
      ON eh.event_id = e.id
    WHERE auth.uid() IS NOT NULL
      AND (
          e.host_user_id = auth.uid()
          OR eh.user_id = auth.uid()
      )
    ORDER BY e.starts_at ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_my_hosted_events() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_joined_activities()
RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    guest_name TEXT,
    guest_email TEXT,
    status TEXT,
    joined_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    events JSONB
) AS $$
    SELECT
        ea.id,
        ea.event_id,
        ea.user_id,
        ea.attendee_profile_id,
        ea.guest_name,
        ea.guest_email,
        ea.status,
        ea.joined_at,
        ea.promoted_at,
        ea.cancelled_at,
        to_jsonb(e) AS events
    FROM public.event_attendees ea
    JOIN public.events e
      ON e.id = ea.event_id
    LEFT JOIN public.attendee_profiles ap
      ON ap.id = ea.attendee_profile_id
    WHERE auth.uid() IS NOT NULL
      AND ea.status <> 'cancelled'
      AND coalesce(ea.added_by_type, 'self') <> 'proxy'
      AND (
          ea.user_id = auth.uid()
          OR ap.user_id = auth.uid()
          OR lower(coalesce(ea.guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    ORDER BY ea.joined_at DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_my_joined_activities() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_interested_activities()
RETURNS TABLE (
    id UUID,
    event_id UUID,
    user_id UUID,
    attendee_profile_id UUID,
    guest_name TEXT,
    guest_email TEXT,
    visibility_mode TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    status TEXT,
    events JSONB
) AS $$
    SELECT
        ei.id,
        ei.event_id,
        ei.user_id,
        ei.attendee_profile_id,
        ei.guest_name,
        ei.guest_email,
        ei.visibility_mode,
        ei.created_at,
        ei.updated_at,
        'thinking'::TEXT AS status,
        to_jsonb(e) AS events
    FROM public.event_interests ei
    JOIN public.events e
      ON e.id = ei.event_id
    LEFT JOIN public.attendee_profiles ap
      ON ap.id = ei.attendee_profile_id
    WHERE auth.uid() IS NOT NULL
      AND (
          ei.user_id = auth.uid()
          OR ap.user_id = auth.uid()
          OR lower(coalesce(ei.guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    ORDER BY ei.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_my_interested_activities() TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'events'
          AND policyname = 'Hosts can create events'
    ) THEN
        CREATE POLICY "Hosts can create events"
            ON public.events
            FOR INSERT
            WITH CHECK (
                auth.uid() IS NOT NULL
                AND auth.uid() = host_user_id
            );
    END IF;
END $$;

DROP POLICY IF EXISTS "Public events are viewable by everyone" ON public.events;
DROP POLICY IF EXISTS "Viewable events are readable" ON public.events;
CREATE POLICY "Viewable events are readable"
    ON public.events
    FOR SELECT
    USING (
        COALESCE(events.visibility, CASE WHEN events.is_public THEN 'public' ELSE 'private' END) = 'public'
        OR (
            auth.uid() IS NOT NULL
            AND auth.uid() = events.host_user_id
        )
        OR public.can_read_event_row(events.id)
    );

DROP POLICY IF EXISTS "Attendees are viewable by everyone" ON public.event_attendees;
DROP POLICY IF EXISTS "Public attendees are viewable for public activities" ON public.event_attendees;
CREATE POLICY "Public attendees are viewable for public activities"
    ON public.event_attendees
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.events e
            WHERE e.id = event_attendees.event_id
              AND COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'public'
        )
    );

DROP POLICY IF EXISTS "Hosts and members can view attendee rows" ON public.event_attendees;
CREATE POLICY "Hosts and members can view attendee rows"
    ON public.event_attendees
    FOR SELECT
    USING (
        auth.uid() IS NOT NULL
        AND (
            public.is_event_host(event_id, auth.uid())
            OR user_id = auth.uid()
            OR attendee_profile_id IN (
                SELECT ap.id
                FROM public.attendee_profiles ap
                WHERE ap.user_id = auth.uid()
            )
            OR lower(coalesce(guest_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );

DROP POLICY IF EXISTS "Waitlist positions are viewable by everyone" ON public.event_waitlist_positions;
DROP POLICY IF EXISTS "Viewable waitlist positions" ON public.event_waitlist_positions;
CREATE POLICY "Viewable waitlist positions"
    ON public.event_waitlist_positions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.events e
            WHERE e.id = event_waitlist_positions.event_id
              AND (
                  COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'public'
                  OR public.can_read_event_row(e.id)
              )
        )
    );

DROP POLICY IF EXISTS "Hosts can view event host rows" ON public.event_hosts;
CREATE POLICY "Hosts can view event host rows"
    ON public.event_hosts
    FOR SELECT
    USING (
        auth.uid() IS NOT NULL
        AND public.is_event_host(event_id, auth.uid())
    );

DROP POLICY IF EXISTS "Hosts can add co-host rows" ON public.event_hosts;
CREATE POLICY "Hosts can add co-host rows"
    ON public.event_hosts
    FOR INSERT
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND public.is_event_host(event_id, auth.uid())
    );

DROP POLICY IF EXISTS "Hosts can leave their own host row" ON public.event_hosts;
CREATE POLICY "Hosts can leave their own host row"
    ON public.event_hosts
    FOR DELETE
    USING (
        auth.uid() = user_id
        AND public.event_host_count(event_id) > 1
    );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'events'
          AND policyname = 'Co-hosts can update events'
    ) THEN
        CREATE POLICY "Co-hosts can update events"
            ON public.events
            FOR UPDATE
            USING (
                auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = events.id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'events'
          AND policyname = 'Co-hosts can delete events'
    ) THEN
        CREATE POLICY "Co-hosts can delete events"
            ON public.events
            FOR DELETE
            USING (
                auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = events.id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_attendees'
          AND policyname = 'Co-hosts can update attendee rows'
    ) THEN
        CREATE POLICY "Co-hosts can update attendee rows"
            ON public.event_attendees
            FOR UPDATE
            USING (
                auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = event_attendees.event_id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_access_requests'
          AND policyname = 'Co-hosts can view event access requests'
    ) THEN
        CREATE POLICY "Co-hosts can view event access requests"
            ON public.event_access_requests
            FOR SELECT
            USING (
                auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = event_access_requests.event_id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_access_requests'
          AND policyname = 'Co-hosts can update event access requests'
    ) THEN
        CREATE POLICY "Co-hosts can update event access requests"
            ON public.event_access_requests
            FOR UPDATE
            USING (
                auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = event_access_requests.event_id
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_interests'
          AND policyname = 'Co-hosts can view named interest rows'
    ) THEN
        CREATE POLICY "Co-hosts can view named interest rows"
            ON public.event_interests
            FOR SELECT
            USING (
                auth.uid() IS NOT NULL
                AND visibility_mode = 'named'
                AND auth.uid() IN (
                    SELECT eh.user_id
                    FROM public.event_hosts eh
                    WHERE eh.event_id = event_interests.event_id
                )
            );
    END IF;
END $$;

-- 6) Reliable cancellation RPC (bypasses fragile RLS query paths)
-- -------------------------------------------------------------------
-- Why:
-- - Some environments/policies can fail with "permission denied for table users"
--   during direct UPDATE flows.
-- - This function keeps one secure, auditable cancel path with explicit auth checks.

CREATE OR REPLACE FUNCTION public.cancel_attendee_with_promotion(
    p_attendee_id UUID,
    p_session_token TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_actor_uid UUID;
    v_actor_email TEXT;
    v_event_id UUID;
    v_status TEXT;
    v_user_id UUID;
    v_attendee_profile_id UUID;
    v_guest_email TEXT;
    v_host_user_id UUID;
    v_next_waitlist_id UUID;
    v_session_profile_id UUID;
BEGIN
    v_actor_uid := auth.uid();
    v_actor_email := lower(coalesce(auth.jwt() ->> 'email', ''));

    -- Load target attendee row
    SELECT
        ea.event_id,
        ea.status,
        ea.user_id,
        ea.attendee_profile_id,
        lower(ea.guest_email)
    INTO
        v_event_id,
        v_status,
        v_user_id,
        v_attendee_profile_id,
        v_guest_email
    FROM public.event_attendees ea
    WHERE ea.id = p_attendee_id;

    IF v_event_id IS NULL THEN
        RETURN json_build_object('error', 'Attendee not found');
    END IF;

    -- Load event host
    SELECT e.host_user_id
    INTO v_host_user_id
    FROM public.events e
    WHERE e.id = v_event_id;

    -- Optional guest-session authorization path
    IF p_session_token IS NOT NULL THEN
        SELECT s.attendee_profile_id
        INTO v_session_profile_id
        FROM public.attendee_sessions s
        WHERE s.token = p_session_token
          AND s.expires_at > now()
        LIMIT 1;
    END IF;

    -- Authorization checks
    IF NOT (
        (v_actor_uid IS NOT NULL AND v_actor_uid = v_host_user_id) OR
        (v_actor_uid IS NOT NULL AND v_actor_uid IN (
            SELECT eh.user_id
            FROM public.event_hosts eh
            WHERE eh.event_id = v_event_id
        )) OR
        (v_actor_uid IS NOT NULL AND v_actor_uid = v_user_id) OR
        (v_actor_uid IS NOT NULL AND EXISTS (
            SELECT 1
            FROM public.attendee_profiles ap
            WHERE ap.id = v_attendee_profile_id
              AND ap.user_id = v_actor_uid
        )) OR
        (v_actor_email <> '' AND v_actor_email = v_guest_email) OR
        (v_session_profile_id IS NOT NULL AND v_session_profile_id = v_attendee_profile_id)
    ) THEN
        RETURN json_build_object('error', 'Not authorized to cancel this RSVP');
    END IF;

    -- Cancel target row
    UPDATE public.event_attendees
    SET
        status = 'cancelled',
        cancelled_at = now()
    WHERE id = p_attendee_id;

    IF v_status = 'pending_approval' THEN
        UPDATE public.event_join_requests jr
        SET status = 'cancelled',
            reviewed_by_user_id = COALESCE(jr.reviewed_by_user_id, v_actor_uid),
            reviewed_at = COALESCE(jr.reviewed_at, now())
        WHERE jr.event_id = v_event_id
          AND jr.status = 'pending'
          AND (
            (v_attendee_profile_id IS NOT NULL AND jr.attendee_profile_id = v_attendee_profile_id)
            OR lower(jr.guest_email) = v_guest_email
          );
    END IF;

    -- Promote next waitlist person when a confirmed attendee cancels
    IF v_status = 'confirmed' THEN
        SELECT ea.id
        INTO v_next_waitlist_id
        FROM public.event_attendees ea
        WHERE ea.event_id = v_event_id
          AND ea.status = 'waitlist'
          AND ea.id <> p_attendee_id
        ORDER BY ea.joined_at ASC
        LIMIT 1;

        IF v_next_waitlist_id IS NOT NULL THEN
            UPDATE public.event_attendees
            SET
                status = 'confirmed',
                promoted_at = now()
            WHERE id = v_next_waitlist_id;
        END IF;
    END IF;

    RETURN json_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.cancel_attendee_with_promotion(UUID, TEXT) TO anon, authenticated;

-- -------------------------------------------------------------------
-- 6b) Reliable RSVP RPC (avoids fragile direct INSERT/UPDATE policy paths)
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_rsvp(
    p_event_id UUID,
    p_guest_name TEXT,
    p_guest_email TEXT,
    p_attendee_profile_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_capacity INTEGER;
    v_allow_waitlist BOOLEAN;
    v_confirmed_count INTEGER;
    v_status TEXT;
    v_existing_id UUID;
    v_existing_status TEXT;
    v_attendee_id UUID;
    v_guest_name TEXT;
    v_guest_email TEXT;
    v_exact_id UUID;
    v_exact_status TEXT;
BEGIN
    v_guest_name := trim(coalesce(p_guest_name, ''));
    v_guest_email := lower(trim(coalesce(p_guest_email, '')));

    IF p_event_id IS NULL OR v_guest_name = '' OR v_guest_email = '' THEN
        RETURN json_build_object('error', 'Missing RSVP details');
    END IF;

    SELECT e.capacity, e.allow_waitlist
    INTO v_capacity, v_allow_waitlist
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.status = 'scheduled';

    IF v_capacity IS NULL THEN
        RETURN json_build_object('error', 'Event not found');
    END IF;

    SELECT ea.id, ea.status
    INTO v_existing_id, v_existing_status
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND coalesce(ea.added_by_type, 'self') <> 'proxy'
      AND (
        lower(ea.guest_email) = v_guest_email
        OR (p_attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = p_attendee_profile_id)
      )
    ORDER BY
      CASE WHEN ea.status = 'cancelled' THEN 1 ELSE 0 END,
      ea.joined_at DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL
       AND v_existing_status <> 'cancelled'
       AND v_existing_status <> 'pending_approval' THEN
        RETURN json_build_object('error', 'You have already said you''re in!');
    END IF;

    SELECT count(*) INTO v_confirmed_count
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.status = 'confirmed';

    IF v_confirmed_count < v_capacity THEN
        v_status := 'confirmed';
    ELSIF v_allow_waitlist THEN
        v_status := 'waitlist';
    ELSE
        RETURN json_build_object('error', 'Event is full and waitlist is disabled');
    END IF;

    IF v_existing_id IS NOT NULL THEN
        BEGIN
            UPDATE public.event_attendees
            SET
                status = v_status,
                guest_name = v_guest_name,
                guest_email = v_guest_email,
                attendee_profile_id = p_attendee_profile_id,
                added_by_type = 'self',
                added_by_attendee_profile_id = p_attendee_profile_id,
                user_id = NULL,
                joined_at = now(),
                promoted_at = null,
                cancelled_at = null
            WHERE id = v_existing_id
            RETURNING id INTO v_attendee_id;
        EXCEPTION
            WHEN unique_violation THEN
                -- If renaming/reviving conflicts, resolve to exact email+name row.
                SELECT ea.id, ea.status
                INTO v_exact_id, v_exact_status
                FROM public.event_attendees ea
                WHERE ea.event_id = p_event_id
                  AND lower(ea.guest_email) = v_guest_email
                  AND lower(ea.guest_name) = lower(v_guest_name)
                ORDER BY ea.joined_at DESC
                LIMIT 1;

                IF v_exact_id IS NULL THEN
                    RETURN json_build_object('error', 'RSVP conflict detected, please retry');
                END IF;

                IF v_exact_status <> 'cancelled' THEN
                    RETURN json_build_object('error', 'You have already said you''re in!');
                END IF;

                UPDATE public.event_attendees
                SET
                    status = v_status,
                    guest_name = v_guest_name,
                    guest_email = v_guest_email,
                    attendee_profile_id = p_attendee_profile_id,
                    added_by_type = 'self',
                    added_by_attendee_profile_id = p_attendee_profile_id,
                    user_id = NULL,
                    joined_at = now(),
                    promoted_at = null,
                    cancelled_at = null
                WHERE id = v_exact_id
                RETURNING id INTO v_attendee_id;
        END;
    ELSE
        BEGIN
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
                NULL,
                p_attendee_profile_id,
                v_guest_name,
                v_guest_email,
                v_status,
                'self',
                p_attendee_profile_id
            )
            RETURNING id INTO v_attendee_id;
        EXCEPTION
            WHEN unique_violation THEN
                -- Compatibility fallback for schemas with uniqueness including name/email.
                -- Revive/update the latest matching row instead of failing RSVP.
                UPDATE public.event_attendees
                SET
                    status = v_status,
                    guest_name = v_guest_name,
                    guest_email = v_guest_email,
                    attendee_profile_id = p_attendee_profile_id,
                    added_by_type = 'self',
                    added_by_attendee_profile_id = p_attendee_profile_id,
                    user_id = NULL,
                    joined_at = now(),
                    promoted_at = null,
                    cancelled_at = null
                WHERE id = (
                    SELECT ea.id
                    FROM public.event_attendees ea
                    WHERE ea.event_id = p_event_id
                      AND lower(ea.guest_email) = v_guest_email
                      AND lower(ea.guest_name) = lower(v_guest_name)
                    ORDER BY ea.joined_at DESC
                    LIMIT 1
                )
                RETURNING id INTO v_attendee_id;

                IF v_attendee_id IS NULL THEN
                    RETURN json_build_object('error', 'RSVP conflict detected, please retry');
                END IF;
        END;
    END IF;

    -- If the user formally RSVPs, remove any previous "thinking about it" row.
    DELETE FROM public.event_interests
    WHERE event_id = p_event_id
      AND (
        lower(guest_email) = v_guest_email
        OR (p_attendee_profile_id IS NOT NULL AND attendee_profile_id = p_attendee_profile_id)
      );

    RETURN json_build_object(
        'success', true,
        'status', v_status,
        'attendee_id', v_attendee_id
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.submit_rsvp(UUID, TEXT, TEXT, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_or_submit_rsvp(
    p_event_id UUID,
    p_guest_name TEXT,
    p_guest_email TEXT,
    p_attendee_profile_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_require_approval BOOLEAN := false;
    v_event_status TEXT;
    v_guest_name TEXT;
    v_guest_email TEXT;
    v_existing_attendee_id UUID;
    v_existing_attendee_status TEXT;
    v_existing_request_id UUID;
    v_existing_request_status TEXT;
    v_request_id UUID;
    v_submit_result JSON;
BEGIN
    v_guest_name := trim(coalesce(p_guest_name, ''));
    v_guest_email := lower(trim(coalesce(p_guest_email, '')));

    IF p_event_id IS NULL OR v_guest_name = '' OR v_guest_email = '' THEN
        RETURN json_build_object('error', 'Missing RSVP details');
    END IF;

    SELECT
        coalesce(e.require_host_approval_for_join, false),
        e.status
    INTO v_require_approval, v_event_status
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_event_status IS NULL OR v_event_status <> 'scheduled' THEN
        RETURN json_build_object('error', 'Event not found');
    END IF;

    SELECT ea.id, ea.status
    INTO v_existing_attendee_id, v_existing_attendee_status
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND coalesce(ea.added_by_type, 'self') <> 'proxy'
      AND (
        lower(ea.guest_email) = v_guest_email
        OR (p_attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = p_attendee_profile_id)
      )
    ORDER BY
      CASE WHEN ea.status = 'cancelled' THEN 1 ELSE 0 END,
      ea.joined_at DESC
    LIMIT 1;

    IF v_existing_attendee_status = 'pending_approval' THEN
        RETURN json_build_object(
            'success', true,
            'result', 'already_pending',
            'attendee_id', v_existing_attendee_id
        );
    END IF;

    IF v_existing_attendee_status IS NOT NULL AND v_existing_attendee_status <> 'cancelled' THEN
        RETURN json_build_object(
            'error', 'You have already said you''re in!',
            'result', 'already_member'
        );
    END IF;

    IF NOT v_require_approval THEN
        v_submit_result := public.submit_rsvp(
            p_event_id,
            v_guest_name,
            v_guest_email,
            p_attendee_profile_id
        );

        IF coalesce(v_submit_result ->> 'error', '') <> '' THEN
            RETURN v_submit_result;
        END IF;

        RETURN json_build_object(
            'success', true,
            'status', v_submit_result ->> 'status',
            'attendee_id', v_submit_result ->> 'attendee_id',
            'result',
            CASE WHEN coalesce(v_submit_result ->> 'status', '') = 'waitlist'
                THEN 'joined_waitlist'
                ELSE 'joined_confirmed'
            END
        );
    END IF;

    SELECT jr.id, jr.status
    INTO v_existing_request_id, v_existing_request_status
    FROM public.event_join_requests jr
    WHERE jr.event_id = p_event_id
      AND (
        (p_attendee_profile_id IS NOT NULL AND jr.attendee_profile_id = p_attendee_profile_id)
        OR lower(jr.guest_email) = v_guest_email
      )
    ORDER BY jr.created_at DESC
    LIMIT 1;

    IF v_existing_request_id IS NOT NULL AND v_existing_request_status = 'pending' THEN
        IF v_existing_attendee_id IS NULL THEN
            INSERT INTO public.event_attendees (
                event_id,
                user_id,
                attendee_profile_id,
                guest_name,
                guest_email,
                status,
                added_by_type
            )
            VALUES (
                p_event_id,
                auth.uid(),
                p_attendee_profile_id,
                v_guest_name,
                v_guest_email,
                'pending_approval',
                'self'
            )
            RETURNING id INTO v_existing_attendee_id;
        ELSE
            UPDATE public.event_attendees
            SET status = 'pending_approval',
                guest_name = v_guest_name,
                guest_email = v_guest_email,
                attendee_profile_id = COALESCE(p_attendee_profile_id, attendee_profile_id),
                user_id = COALESCE(auth.uid(), user_id),
                joined_at = COALESCE(joined_at, now()),
                cancelled_at = NULL
            WHERE id = v_existing_attendee_id;
        END IF;

        RETURN json_build_object(
            'success', true,
            'result', 'already_pending',
            'request_id', v_existing_request_id,
            'attendee_id', v_existing_attendee_id
        );
    END IF;

    IF v_existing_attendee_id IS NULL THEN
        INSERT INTO public.event_attendees (
            event_id,
            user_id,
            attendee_profile_id,
            guest_name,
            guest_email,
            status,
            added_by_type
        )
        VALUES (
            p_event_id,
            auth.uid(),
            p_attendee_profile_id,
            v_guest_name,
            v_guest_email,
            'pending_approval',
            'self'
        )
        RETURNING id INTO v_existing_attendee_id;
    ELSE
        UPDATE public.event_attendees
        SET status = 'pending_approval',
            guest_name = v_guest_name,
            guest_email = v_guest_email,
            attendee_profile_id = COALESCE(p_attendee_profile_id, attendee_profile_id),
            user_id = COALESCE(auth.uid(), user_id),
            joined_at = COALESCE(joined_at, now()),
            cancelled_at = NULL
        WHERE id = v_existing_attendee_id;
    END IF;

    INSERT INTO public.event_join_requests (
        event_id,
        user_id,
        attendee_profile_id,
        guest_name,
        guest_email,
        status
    )
    VALUES (
        p_event_id,
        auth.uid(),
        p_attendee_profile_id,
        v_guest_name,
        v_guest_email,
        'pending'
    )
    RETURNING id INTO v_request_id;

    RETURN json_build_object(
        'success', true,
        'result', 'request_pending',
        'request_id', v_request_id,
        'attendee_id', v_existing_attendee_id
    );
EXCEPTION
    WHEN unique_violation THEN
        SELECT jr.id
        INTO v_existing_request_id
        FROM public.event_join_requests jr
        WHERE jr.event_id = p_event_id
          AND jr.status = 'pending'
          AND (
            (p_attendee_profile_id IS NOT NULL AND jr.attendee_profile_id = p_attendee_profile_id)
            OR lower(jr.guest_email) = v_guest_email
          )
        ORDER BY jr.created_at DESC
        LIMIT 1;

        SELECT ea.id
        INTO v_existing_attendee_id
        FROM public.event_attendees ea
        WHERE ea.event_id = p_event_id
          AND ea.status = 'pending_approval'
          AND (
            (p_attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = p_attendee_profile_id)
            OR lower(ea.guest_email) = v_guest_email
          )
        ORDER BY ea.joined_at DESC
        LIMIT 1;

        RETURN json_build_object(
            'success', true,
            'result', 'already_pending',
            'request_id', v_existing_request_id,
            'attendee_id', v_existing_attendee_id
        );
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.request_or_submit_rsvp(UUID, TEXT, TEXT, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_join_request_for_event(
    p_event_id UUID,
    p_guest_email TEXT DEFAULT NULL,
    p_attendee_profile_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_guest_email TEXT := lower(trim(coalesce(p_guest_email, '')));
    v_row public.event_join_requests%ROWTYPE;
BEGIN
    IF p_event_id IS NULL THEN
        RETURN json_build_object('error', 'Missing event');
    END IF;

    SELECT jr.*
    INTO v_row
    FROM public.event_join_requests jr
    WHERE jr.event_id = p_event_id
      AND (
        (auth.uid() IS NOT NULL AND jr.user_id = auth.uid())
        OR (p_attendee_profile_id IS NOT NULL AND jr.attendee_profile_id = p_attendee_profile_id)
        OR (v_guest_email <> '' AND lower(jr.guest_email) = v_guest_email)
      )
    ORDER BY jr.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN json_build_object('status', null);
    END IF;

    RETURN json_build_object(
        'id', v_row.id,
        'status', v_row.status,
        'reviewed_at', v_row.reviewed_at,
        'created_at', v_row.created_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_my_join_request_for_event(UUID, TEXT, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_event_join_requests_for_host(
    p_event_id UUID,
    p_status TEXT DEFAULT NULL
) RETURNS SETOF public.event_join_requests AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to review join requests';
    END IF;

    RETURN QUERY
    SELECT jr.*
    FROM public.event_join_requests jr
    WHERE jr.event_id = p_event_id
      AND (p_status IS NULL OR jr.status = p_status)
    ORDER BY jr.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_event_join_requests_for_host(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_event_join_request(
    p_request_id UUID
) RETURNS JSON AS $$
DECLARE
    v_request public.event_join_requests%ROWTYPE;
    v_submit_result JSON;
    v_proxy_pending_attendee_id UUID;
    v_allow_waitlist BOOLEAN;
    v_capacity INTEGER;
    v_confirmed_count INTEGER;
    v_proxy_status TEXT;
BEGIN
    IF p_request_id IS NULL THEN
        RETURN json_build_object('error', 'Missing request');
    END IF;

    SELECT *
    INTO v_request
    FROM public.event_join_requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Join request not found');
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(v_request.event_id, auth.uid()) THEN
        RETURN json_build_object('error', 'Not authorized to review this request');
    END IF;

    IF v_request.status <> 'pending' THEN
        RETURN json_build_object('error', 'Join request is no longer pending');
    END IF;

    SELECT ea.id
    INTO v_proxy_pending_attendee_id
    FROM public.event_attendees ea
    WHERE ea.event_id = v_request.event_id
      AND ea.status = 'pending_approval'
      AND coalesce(ea.added_by_type, 'self') = 'proxy'
      AND lower(ea.guest_email) = lower(v_request.guest_email)
      AND lower(ea.guest_name) = lower(v_request.guest_name)
    ORDER BY ea.joined_at DESC
    LIMIT 1;

    IF v_proxy_pending_attendee_id IS NOT NULL THEN
        SELECT e.allow_waitlist, e.capacity
        INTO v_allow_waitlist, v_capacity
        FROM public.events e
        WHERE e.id = v_request.event_id
          AND e.status = 'scheduled';

        IF v_capacity IS NULL THEN
            RETURN json_build_object('error', 'Event not found');
        END IF;

        SELECT count(*) INTO v_confirmed_count
        FROM public.event_attendees ea
        WHERE ea.event_id = v_request.event_id
          AND ea.status = 'confirmed';

        IF v_confirmed_count < v_capacity THEN
            v_proxy_status := 'confirmed';
        ELSIF v_allow_waitlist THEN
            v_proxy_status := 'waitlist';
        ELSE
            RETURN json_build_object('error', 'Event is full and waitlist is disabled');
        END IF;

        UPDATE public.event_attendees
        SET status = v_proxy_status,
            promoted_at = CASE WHEN v_proxy_status = 'confirmed' THEN now() ELSE promoted_at END
        WHERE id = v_proxy_pending_attendee_id;

        UPDATE public.event_join_requests
        SET
            status = 'approved',
            reviewed_by_user_id = auth.uid(),
            reviewed_at = now()
        WHERE id = p_request_id;

        RETURN json_build_object(
            'success', true,
            'status', v_proxy_status
        );
    END IF;

    v_submit_result := public.submit_rsvp(
        v_request.event_id,
        v_request.guest_name,
        v_request.guest_email,
        v_request.attendee_profile_id
    );

    IF coalesce(v_submit_result ->> 'error', '') <> '' THEN
        IF coalesce(v_submit_result ->> 'error', '') = 'You have already said you''re in!' THEN
            UPDATE public.event_join_requests
            SET
                status = 'approved',
                reviewed_by_user_id = auth.uid(),
                reviewed_at = now()
            WHERE id = p_request_id;

            RETURN json_build_object(
                'success', true,
                'status', 'already_member'
            );
        END IF;

        RETURN v_submit_result;
    END IF;

    UPDATE public.event_join_requests
    SET
        status = 'approved',
        reviewed_by_user_id = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id;

    RETURN json_build_object(
        'success', true,
        'status', coalesce(v_submit_result ->> 'status', 'confirmed')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.approve_event_join_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_event_join_request(
    p_request_id UUID
) RETURNS JSON AS $$
DECLARE
    v_event_id UUID;
    v_status TEXT;
    v_guest_name TEXT;
    v_guest_email TEXT;
    v_attendee_profile_id UUID;
BEGIN
    IF p_request_id IS NULL THEN
        RETURN json_build_object('error', 'Missing request');
    END IF;

    SELECT event_id, status, guest_name, guest_email, attendee_profile_id
    INTO v_event_id, v_status, v_guest_name, v_guest_email, v_attendee_profile_id
    FROM public.event_join_requests
    WHERE id = p_request_id;

    IF v_event_id IS NULL THEN
        RETURN json_build_object('error', 'Join request not found');
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(v_event_id, auth.uid()) THEN
        RETURN json_build_object('error', 'Not authorized to review this request');
    END IF;

    IF v_status <> 'pending' THEN
        RETURN json_build_object('error', 'Join request is no longer pending');
    END IF;

    UPDATE public.event_join_requests
    SET
        status = 'rejected',
        reviewed_by_user_id = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id;

    UPDATE public.event_attendees ea
    SET status = 'cancelled',
        cancelled_at = now()
    WHERE ea.event_id = v_event_id
      AND ea.status = 'pending_approval'
      AND (
        (v_attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = v_attendee_profile_id)
        OR lower(ea.guest_email) = lower(coalesce(v_guest_email, ''))
      );

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.reject_event_join_request(UUID) TO authenticated;

-- -------------------------------------------------------------------
-- 7) Reliable proxy-add RPC (avoids fragile direct INSERT policy paths)
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.add_proxy_attendee(
    p_event_id UUID,
    p_proxy_name TEXT,
    p_attendee_profile_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_owner_email TEXT DEFAULT NULL,
    p_session_token TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_actor_uid UUID;
    v_actor_email TEXT;
    v_profile_user_id UUID;
    v_host_user_id UUID;
    v_require_approval BOOLEAN;
    v_allow_waitlist BOOLEAN;
    v_capacity INTEGER;
    v_confirmed_count INTEGER;
    v_status TEXT;
    v_existing_cancelled_id UUID;
    v_attendee_id UUID;
    v_existing_request_id UUID;
    v_session_profile_id UUID;
    v_guest_email TEXT;
BEGIN
    IF p_event_id IS NULL OR p_proxy_name IS NULL OR trim(p_proxy_name) = '' OR p_attendee_profile_id IS NULL THEN
        RETURN json_build_object('error', 'Missing required proxy RSVP input');
    END IF;

    v_actor_uid := auth.uid();
    v_actor_email := lower(coalesce(auth.jwt() ->> 'email', ''));

    -- Load event and profile ownership
    SELECT e.host_user_id, coalesce(e.require_host_approval_for_join, false), e.allow_waitlist, e.capacity
    INTO v_host_user_id, v_require_approval, v_allow_waitlist, v_capacity
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_capacity IS NULL THEN
        RETURN json_build_object('error', 'Event not found');
    END IF;

    SELECT ap.user_id
    INTO v_profile_user_id
    FROM public.attendee_profiles ap
    WHERE ap.id = p_attendee_profile_id;

    IF p_session_token IS NOT NULL THEN
        SELECT s.attendee_profile_id
        INTO v_session_profile_id
        FROM public.attendee_sessions s
        WHERE s.token = p_session_token
          AND s.expires_at > now()
        LIMIT 1;
    END IF;

    -- Authorization: host OR profile owner OR owner email OR valid guest session
    IF NOT (
        (v_actor_uid IS NOT NULL AND v_actor_uid = v_host_user_id) OR
        (v_actor_uid IS NOT NULL AND v_actor_uid IN (
            SELECT eh.user_id
            FROM public.event_hosts eh
            WHERE eh.event_id = p_event_id
        )) OR
        (v_actor_uid IS NOT NULL AND v_actor_uid = v_profile_user_id) OR
        (v_actor_email <> '' AND v_actor_email = lower(coalesce(p_owner_email, ''))) OR
        (v_session_profile_id IS NOT NULL AND v_session_profile_id = p_attendee_profile_id)
    ) THEN
        RETURN json_build_object('error', 'Not authorized to add someone for this RSVP');
    END IF;

    v_guest_email := lower(trim(coalesce(p_owner_email, '')));
    IF v_guest_email = '' THEN
        v_guest_email := concat(
            'proxy+',
            substr(p_attendee_profile_id::text, 1, 8),
            '-',
            substr(md5(clock_timestamp()::text || random()::text), 1, 10),
            '@proxy.im-in.local'
        );
    END IF;

    -- Capacity decision
    IF v_require_approval THEN
        v_status := 'pending_approval';
    ELSE
        SELECT count(*) INTO v_confirmed_count
        FROM public.event_attendees ea
        WHERE ea.event_id = p_event_id
          AND ea.status = 'confirmed';

        IF v_confirmed_count < v_capacity THEN
            v_status := 'confirmed';
        ELSIF v_allow_waitlist THEN
            v_status := 'waitlist';
        ELSE
            RETURN json_build_object('error', 'Event is full and waitlist is disabled');
        END IF;
    END IF;

    -- Try revive cancelled row by profile+name (case-insensitive)
    SELECT ea.id
    INTO v_existing_cancelled_id
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.attendee_profile_id = p_attendee_profile_id
      AND lower(ea.guest_name) = lower(trim(p_proxy_name))
      AND ea.status = 'cancelled'
    ORDER BY ea.cancelled_at DESC NULLS LAST
    LIMIT 1;

    IF v_existing_cancelled_id IS NOT NULL THEN
        UPDATE public.event_attendees
        SET
            status = v_status,
            user_id = p_user_id,
            attendee_profile_id = p_attendee_profile_id,
            added_by_type = 'proxy',
            added_by_attendee_profile_id = p_attendee_profile_id,
            guest_name = trim(p_proxy_name),
            guest_email = v_guest_email,
            joined_at = now(),
            promoted_at = null,
            cancelled_at = null
        WHERE id = v_existing_cancelled_id
        RETURNING id INTO v_attendee_id;
    ELSE
        BEGIN
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
                p_user_id,
                p_attendee_profile_id,
                trim(p_proxy_name),
                v_guest_email,
                v_status,
                'proxy',
                p_attendee_profile_id
            )
            RETURNING id INTO v_attendee_id;
        EXCEPTION
            WHEN unique_violation THEN
                v_guest_email := concat(
                    'proxy+',
                    substr(p_attendee_profile_id::text, 1, 8),
                    '-',
                    substr(md5(clock_timestamp()::text || random()::text), 1, 12),
                    '@proxy.im-in.local'
                );

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
                    p_user_id,
                    p_attendee_profile_id,
                    trim(p_proxy_name),
                    v_guest_email,
                    v_status,
                    'proxy',
                    p_attendee_profile_id
                )
                RETURNING id INTO v_attendee_id;
        END;
    END IF;

    IF v_require_approval THEN
        SELECT jr.id
        INTO v_existing_request_id
        FROM public.event_join_requests jr
        WHERE jr.event_id = p_event_id
          AND jr.status = 'pending'
          AND lower(jr.guest_email) = v_guest_email
        ORDER BY jr.created_at DESC
        LIMIT 1;

        IF v_existing_request_id IS NULL THEN
            INSERT INTO public.event_join_requests (
                event_id,
                user_id,
                attendee_profile_id,
                guest_name,
                guest_email,
                status
            )
            VALUES (
                p_event_id,
                p_user_id,
                NULL,
                trim(p_proxy_name),
                v_guest_email,
                'pending'
            )
            RETURNING id INTO v_existing_request_id;
        END IF;

        RETURN json_build_object(
            'success', true,
            'status', 'pending_approval',
            'result', 'request_pending',
            'request_id', v_existing_request_id,
            'attendee_id', v_attendee_id
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'status', v_status,
        'attendee_id', v_attendee_id
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.add_proxy_attendee(UUID, TEXT, UUID, UUID, TEXT, TEXT) TO anon, authenticated;

-- -------------------------------------------------------------------
-- 8) Thinking-about-it toggle RPC
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.toggle_event_interest(
    p_event_id UUID,
    p_guest_name TEXT,
    p_guest_email TEXT,
    p_visibility_mode TEXT DEFAULT 'named',
    p_user_id UUID DEFAULT NULL,
    p_attendee_profile_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_name TEXT;
    v_email TEXT;
    v_existing_id UUID;
    v_existing_visibility_mode TEXT;
    v_active_rsvp_id UUID;
    v_interest_id UUID;
BEGIN
    v_name := trim(coalesce(p_guest_name, ''));
    v_email := lower(trim(coalesce(p_guest_email, '')));

    IF p_event_id IS NULL OR v_name = '' OR v_email = '' THEN
        RETURN json_build_object('error', 'Missing interest details');
    END IF;

    IF p_visibility_mode NOT IN ('count_only', 'named') THEN
        RETURN json_build_object('error', 'Invalid visibility mode');
    END IF;

    SELECT ea.id
    INTO v_active_rsvp_id
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.status <> 'cancelled'
      AND coalesce(ea.added_by_type, 'self') <> 'proxy'
      AND (
        lower(ea.guest_email) = v_email
        OR (p_attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = p_attendee_profile_id)
        OR (p_user_id IS NOT NULL AND ea.user_id = p_user_id)
      )
    LIMIT 1;

    IF v_active_rsvp_id IS NOT NULL THEN
        RETURN json_build_object('error', 'You are already in this activity');
    END IF;

    SELECT ei.id, ei.visibility_mode
    INTO v_existing_id, v_existing_visibility_mode
    FROM public.event_interests ei
    WHERE ei.event_id = p_event_id
      AND (
        (p_user_id IS NOT NULL AND ei.user_id = p_user_id)
        OR (p_attendee_profile_id IS NOT NULL AND ei.attendee_profile_id = p_attendee_profile_id)
        OR lower(ei.guest_email) = v_email
      )
    ORDER BY ei.created_at DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        IF v_existing_visibility_mode = p_visibility_mode THEN
            DELETE FROM public.event_interests
            WHERE id = v_existing_id;
            RETURN json_build_object('success', true, 'removed', true);
        END IF;

        UPDATE public.event_interests
        SET
            guest_name = v_name,
            guest_email = v_email,
            user_id = p_user_id,
            attendee_profile_id = p_attendee_profile_id,
            visibility_mode = p_visibility_mode,
            updated_at = now()
        WHERE id = v_existing_id;

        RETURN json_build_object('success', true, 'removed', false);
    END IF;

    INSERT INTO public.event_interests (
        event_id,
        user_id,
        attendee_profile_id,
        guest_name,
        guest_email,
        visibility_mode
    )
    VALUES (
        p_event_id,
        p_user_id,
        p_attendee_profile_id,
        v_name,
        v_email,
        p_visibility_mode
    )
    RETURNING id INTO v_interest_id;

    RETURN json_build_object('success', true, 'removed', false, 'interest_id', v_interest_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('error', 'Interest already exists for this activity');
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.toggle_event_interest(UUID, TEXT, TEXT, TEXT, UUID, UUID) TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_attendees'
          AND policyname = 'Email owners can update attendee rows'
    ) THEN
        CREATE POLICY "Email owners can update attendee rows"
            ON public.event_attendees
            FOR UPDATE
            USING (
                auth.uid() IS NOT NULL
                AND nullif(lower(guest_email), '') IS NOT NULL
                AND lower(guest_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT event_id, position, count(*) AS c
            FROM public.event_waitlist_positions
            GROUP BY event_id, position
            HAVING count(*) > 1
        ) d
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS event_waitlist_positions_event_position_uidx
            ON public.event_waitlist_positions (event_id, position);
    ELSE
        RAISE NOTICE 'Skipped unique index on (event_id, position): duplicate rows exist.';
    END IF;
END $$;

-- -------------------------------------------------------------------
-- 3) Keep attendee_profiles.updated_at current
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'attendee_profiles_touch_updated_at'
          AND tgrelid = 'public.attendee_profiles'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER attendee_profiles_touch_updated_at
            BEFORE UPDATE ON public.attendee_profiles
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'event_interests_touch_updated_at'
          AND tgrelid = 'public.event_interests'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER event_interests_touch_updated_at
            BEFORE UPDATE ON public.event_interests
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'event_access_requests_touch_updated_at'
          AND tgrelid = 'public.event_access_requests'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER event_access_requests_touch_updated_at
            BEFORE UPDATE ON public.event_access_requests
            FOR EACH ROW
            EXECUTE FUNCTION public.touch_updated_at();
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_event_moderation_defaults()
RETURNS TRIGGER AS $$
DECLARE
    next_visibility TEXT := COALESCE(NEW.visibility, CASE WHEN COALESCE(NEW.is_public, false) THEN 'public' ELSE 'private' END);
    should_reset BOOLEAN := false;
BEGIN
    IF NEW.moderation_reasons IS NULL THEN
        NEW.moderation_reasons := ARRAY[]::TEXT[];
    END IF;

    IF TG_OP = 'INSERT' THEN
        should_reset := next_visibility IN ('public', 'semi_public');
    ELSE
        should_reset := NEW.visibility IS DISTINCT FROM OLD.visibility;

        IF NOT should_reset THEN
            IF next_visibility = 'semi_public' THEN
                should_reset := NEW.title IS DISTINCT FROM OLD.title
                    OR NEW.public_summary IS DISTINCT FROM OLD.public_summary
                    OR NEW.public_location_text IS DISTINCT FROM OLD.public_location_text
                    OR NEW.show_host_publicly IS DISTINCT FROM OLD.show_host_publicly;
            ELSE
                should_reset := NEW.title IS DISTINCT FROM OLD.title
                    OR NEW.description IS DISTINCT FROM OLD.description
                    OR NEW.public_summary IS DISTINCT FROM OLD.public_summary
                    OR NEW.location_text IS DISTINCT FROM OLD.location_text
                    OR NEW.public_location_text IS DISTINCT FROM OLD.public_location_text
                    OR NEW.show_host_publicly IS DISTINCT FROM OLD.show_host_publicly;
            END IF;
        END IF;
    END IF;

    IF next_visibility = 'private' THEN
        NEW.public_discovery_enabled := false;
        NEW.moderation_status := 'not_required';
        NEW.moderation_risk_level := NULL;
        NEW.moderation_action := NULL;
        NEW.moderation_confidence := NULL;
        NEW.moderation_reasons := ARRAY[]::TEXT[];
        NEW.moderation_input_hash := NULL;
        NEW.moderated_at := NULL;
        NEW.moderation_archived_at := NULL;
        NEW.moderation_override := NULL;
        RETURN NEW;
    END IF;

    IF NEW.moderation_override IS NOT NULL THEN
        CASE NEW.moderation_override
            WHEN 'force_visible', 'mark_safe' THEN
                NEW.public_discovery_enabled := true;
                NEW.moderation_status := 'approved';
                NEW.moderation_action := 'allow';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'force_limited' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'limited';
                NEW.moderation_action := 'limit_visibility';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'hide' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'review';
                NEW.moderation_action := 'require_review';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'mark_spam' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'blocked';
                NEW.moderation_risk_level := 'high';
                NEW.moderation_action := 'block';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
        END CASE;
        RETURN NEW;
    END IF;

    IF should_reset THEN
        NEW.public_discovery_enabled := false;
        NEW.moderation_status := 'pending';
        NEW.moderation_risk_level := NULL;
        NEW.moderation_action := NULL;
        NEW.moderation_confidence := NULL;
        NEW.moderation_reasons := ARRAY[]::TEXT[];
        NEW.moderation_input_hash := NULL;
        NEW.moderated_at := NULL;
        NEW.moderation_archived_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_apply_moderation_defaults ON public.events;

CREATE TRIGGER events_apply_moderation_defaults
    BEFORE INSERT OR UPDATE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_event_moderation_defaults();

-- -------------------------------------------------------------------
-- 4) Post-run manual checks (run separately if desired)
-- -------------------------------------------------------------------
-- SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;
-- SELECT * FROM pg_trigger WHERE tgrelid = 'public.attendee_profiles'::regclass;

-- -------------------------------------------------------------------
-- 5) RSVP cancellation reliability policy
-- -------------------------------------------------------------------
-- Some attendee rows are linked to users through attendee_profiles.user_id
-- while event_attendees.user_id may be null (legacy/guest-origin rows).
-- This policy allows authenticated profile owners to update their own attendee rows.

ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_attendees'
          AND policyname = 'Profile owners can update attendee rows'
    ) THEN
        CREATE POLICY "Profile owners can update attendee rows"
            ON public.event_attendees
            FOR UPDATE
            USING (
                auth.uid() IN (
                    SELECT ap.user_id
                    FROM public.attendee_profiles ap
                    WHERE ap.id = attendee_profile_id
                )
            );
    END IF;
END $$;
