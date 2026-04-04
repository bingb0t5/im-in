ALTER TABLE public.attendee_profiles
    ADD COLUMN IF NOT EXISTS lalo_user_id UUID;

ALTER TABLE public.attendee_profiles
    ADD COLUMN IF NOT EXISTS auth_provider TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendee_profiles_auth_provider_check'
          AND conrelid = 'public.attendee_profiles'::regclass
    ) THEN
        ALTER TABLE public.attendee_profiles
            ADD CONSTRAINT attendee_profiles_auth_provider_check
            CHECK (
                auth_provider IS NULL
                OR auth_provider IN ('email', 'google', 'lalo_whatsapp')
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS attendee_profiles_lalo_user_id_uidx
    ON public.attendee_profiles (lalo_user_id)
    WHERE lalo_user_id IS NOT NULL;
