CREATE TABLE IF NOT EXISTS public.account_merge_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS account_merge_requests_source_user_id_idx
    ON public.account_merge_requests (source_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS account_merge_requests_target_email_idx
    ON public.account_merge_requests (target_email, created_at DESC);

ALTER TABLE public.account_merge_requests ENABLE ROW LEVEL SECURITY;
