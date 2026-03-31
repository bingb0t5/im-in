-- Supabase migration: guest identity/session compatibility
--
-- Purpose:
-- - Add schema pieces required by current frontend code:
--   - attendee_profiles
--   - attendee_sessions
--   - event_attendees.attendee_profile_id
-- - Bootstrap environments that do not already have these structures.
--
-- Notes:
-- - This migration is intentionally idempotent where practical.
-- - RLS is kept permissive to match existing app behavior patterns.
-- - Tightening policies should be a follow-up security task.
-- - If your live Supabase already has these tables/column, prefer
--   `supabase_reconcile_live_schema.sql` for non-destructive alignment.

-- 1) Guest profile table
CREATE TABLE IF NOT EXISTS public.attendee_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    full_name TEXT GENERATED ALWAYS AS (
        CASE
            WHEN trim(concat_ws(' ', first_name, last_name)) = '' THEN email
            ELSE trim(concat_ws(' ', first_name, last_name))
        END
    ) STORED,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness by email.
CREATE UNIQUE INDEX IF NOT EXISTS attendee_profiles_email_lower_uidx
    ON public.attendee_profiles (lower(email));

CREATE INDEX IF NOT EXISTS attendee_profiles_user_id_idx
    ON public.attendee_profiles (user_id);

-- 2) Guest session table
CREATE TABLE IF NOT EXISTS public.attendee_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendee_profile_id UUID NOT NULL REFERENCES public.attendee_profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS attendee_sessions_token_uidx
    ON public.attendee_sessions (token);

CREATE INDEX IF NOT EXISTS attendee_sessions_profile_id_idx
    ON public.attendee_sessions (attendee_profile_id);

CREATE INDEX IF NOT EXISTS attendee_sessions_expires_at_idx
    ON public.attendee_sessions (expires_at);

-- 3) Link attendee rows to attendee_profiles where available
ALTER TABLE public.event_attendees
    ADD COLUMN IF NOT EXISTS attendee_profile_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'event_attendees_attendee_profile_id_fkey'
          AND conrelid = 'public.event_attendees'::regclass
    ) THEN
        ALTER TABLE public.event_attendees
            ADD CONSTRAINT event_attendees_attendee_profile_id_fkey
            FOREIGN KEY (attendee_profile_id)
            REFERENCES public.attendee_profiles(id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_attendees_attendee_profile_id_idx
    ON public.event_attendees (attendee_profile_id);

-- 4) Optional backfill: create basic profiles from existing attendee emails
--    and connect event_attendees.attendee_profile_id when null.
INSERT INTO public.attendee_profiles (email, first_name, last_name)
SELECT DISTINCT
    lower(ea.guest_email) AS email,
    ''::text AS first_name,
    ''::text AS last_name
FROM public.event_attendees ea
LEFT JOIN public.attendee_profiles ap
    ON lower(ap.email) = lower(ea.guest_email)
WHERE ea.guest_email IS NOT NULL
  AND trim(ea.guest_email) <> ''
  AND ap.id IS NULL;

UPDATE public.event_attendees ea
SET attendee_profile_id = ap.id
FROM public.attendee_profiles ap
WHERE ea.attendee_profile_id IS NULL
  AND lower(ap.email) = lower(ea.guest_email);

-- 5) Grants for API roles
GRANT SELECT, INSERT, UPDATE ON public.attendee_profiles TO anon, authenticated;
GRANT SELECT, INSERT ON public.attendee_sessions TO anon, authenticated;

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
        first_name = CASE
            WHEN v_target_name = '' AND v_source_name <> '' THEN v_source.first_name
            ELSE v_target.first_name
        END,
        last_name = CASE
            WHEN v_target_name = '' AND v_source_name <> '' THEN v_source.last_name
            ELSE v_target.last_name
        END,
        updated_at = now()
    WHERE id = p_target_profile_id
    RETURNING * INTO v_target;

    DELETE FROM public.attendee_profiles
    WHERE id = p_source_profile_id;

    RETURN v_target;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.merge_attendee_profiles(UUID, UUID, TEXT) TO anon, authenticated;

-- 6) RLS policies (permissive for compatibility)
ALTER TABLE public.attendee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendee_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'attendee_profiles'
          AND policyname = 'Attendee profiles are viewable by everyone'
    ) THEN
        CREATE POLICY "Attendee profiles are viewable by everyone"
            ON public.attendee_profiles
            FOR SELECT
            USING (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'attendee_profiles'
          AND policyname = 'Anyone can create attendee profiles'
    ) THEN
        CREATE POLICY "Anyone can create attendee profiles"
            ON public.attendee_profiles
            FOR INSERT
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'attendee_profiles'
          AND policyname = 'Anyone can update attendee profiles'
    ) THEN
        CREATE POLICY "Anyone can update attendee profiles"
            ON public.attendee_profiles
            FOR UPDATE
            USING (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'attendee_sessions'
          AND policyname = 'Attendee sessions are viewable by everyone'
    ) THEN
        CREATE POLICY "Attendee sessions are viewable by everyone"
            ON public.attendee_sessions
            FOR SELECT
            USING (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'attendee_sessions'
          AND policyname = 'Anyone can create attendee sessions'
    ) THEN
        CREATE POLICY "Anyone can create attendee sessions"
            ON public.attendee_sessions
            FOR INSERT
            WITH CHECK (true);
    END IF;
END $$;
