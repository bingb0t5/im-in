CREATE TABLE IF NOT EXISTS public.moderation_runtime_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_runtime_events_event_id_created_at
    ON public.moderation_runtime_events(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_runtime_events_created_at
    ON public.moderation_runtime_events(created_at DESC);

ALTER TABLE public.moderation_runtime_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_runtime_events FROM anon, authenticated;
