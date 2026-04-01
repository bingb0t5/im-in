CREATE TABLE IF NOT EXISTS public.moderation_policy_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    strictness_mode TEXT NOT NULL DEFAULT 'balanced',
    rules JSONB NOT NULL DEFAULT '{
      "enable_ai_moderation": true,
      "enable_trust_relaxation": true,
      "restrict_for_abuse_or_hate": true,
      "restrict_for_scam_or_impersonation": true,
      "restrict_for_mass_posting": true,
      "restrict_for_not_real_world_activity": true,
      "restrict_for_low_detail": false,
      "restrict_for_overly_promotional": false,
      "restrict_for_other": false,
      "medium_risk_requires_review": false,
      "high_risk_requires_review": true
    }'::jsonb,
    thresholds JSONB NOT NULL DEFAULT '{
      "established_host_min_count": 3,
      "trusted_host_min_count": 10,
      "trust_relax_max_confidence": 0.75
    }'::jsonb,
    updated_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'moderation_policy_settings_strictness_mode_check'
    ) THEN
        ALTER TABLE public.moderation_policy_settings
            ADD CONSTRAINT moderation_policy_settings_strictness_mode_check
            CHECK (strictness_mode IN ('relaxed', 'balanced', 'strict'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'moderation_policy_settings_rules_object_check'
    ) THEN
        ALTER TABLE public.moderation_policy_settings
            ADD CONSTRAINT moderation_policy_settings_rules_object_check
            CHECK (jsonb_typeof(rules) = 'object');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'moderation_policy_settings_thresholds_object_check'
    ) THEN
        ALTER TABLE public.moderation_policy_settings
            ADD CONSTRAINT moderation_policy_settings_thresholds_object_check
            CHECK (jsonb_typeof(thresholds) = 'object');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.moderation_policy_change_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    changed_by_user_id UUID,
    previous_policy JSONB NOT NULL,
    next_policy JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moderation_policy_change_log_created_at
    ON public.moderation_policy_change_log(created_at DESC);

ALTER TABLE public.moderation_policy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_policy_change_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.moderation_policy_settings FROM anon, authenticated;
REVOKE ALL ON public.moderation_policy_change_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_moderation_policy_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS moderation_policy_settings_touch_updated_at ON public.moderation_policy_settings;

CREATE TRIGGER moderation_policy_settings_touch_updated_at
    BEFORE UPDATE ON public.moderation_policy_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_moderation_policy_settings_updated_at();

INSERT INTO public.moderation_policy_settings (
    id,
    strictness_mode,
    rules,
    thresholds
)
VALUES (
    TRUE,
    'balanced',
    '{
      "enable_ai_moderation": true,
      "enable_trust_relaxation": true,
      "restrict_for_abuse_or_hate": true,
      "restrict_for_scam_or_impersonation": true,
      "restrict_for_mass_posting": true,
      "restrict_for_not_real_world_activity": true,
      "restrict_for_low_detail": false,
      "restrict_for_overly_promotional": false,
      "restrict_for_other": false,
      "medium_risk_requires_review": false,
      "high_risk_requires_review": true
    }'::jsonb,
    '{
      "established_host_min_count": 3,
      "trusted_host_min_count": 10,
      "trust_relax_max_confidence": 0.75
    }'::jsonb
)
ON CONFLICT (id) DO NOTHING;
