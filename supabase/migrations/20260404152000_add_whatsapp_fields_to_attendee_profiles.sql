ALTER TABLE public.attendee_profiles
    ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

ALTER TABLE public.attendee_profiles
    ADD COLUMN IF NOT EXISTS whatsapp_verified_at TIMESTAMPTZ;
