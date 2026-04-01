import { createClient } from 'npm:@supabase/supabase-js@2';

type EventVisibility = 'public' | 'semi_public' | 'private';
type ModerationRiskLevel = 'low' | 'medium' | 'high';
type ModerationAction = 'allow' | 'limit_visibility' | 'require_review' | 'block';
type ModerationStatus = 'not_required' | 'pending' | 'approved' | 'limited' | 'review' | 'blocked' | 'error';
type ModerationOverride = 'force_visible' | 'force_limited' | 'hide' | 'mark_safe' | 'mark_spam';
type HostTrustLevel = 'new' | 'established' | 'trusted';
type PublicModerationLogAction = 'approved' | 'denied' | 'flagged' | 'marked_spam' | 'restored' | 'removed';

type EventModerationShape = {
  title?: string | null;
  description?: string | null;
  public_summary?: string | null;
  location_text?: string | null;
  public_location_text?: string | null;
  host_name?: string | null;
  show_host_publicly?: boolean | null;
  visibility?: EventVisibility | null;
  is_public?: boolean | null;
  moderation_status?: ModerationStatus | null;
  moderation_risk_level?: ModerationRiskLevel | null;
  moderation_action?: ModerationAction | null;
  moderation_confidence?: number | null;
  moderation_reasons?: string[] | null;
  moderation_input_hash?: string | null;
  moderated_at?: string | null;
  moderation_archived_at?: string | null;
  moderation_override?: ModerationOverride | null;
  public_discovery_enabled?: boolean | null;
};

type ActivityModerationInput = {
  title: string;
  description: string;
  publicSummary: string;
  location: string;
  publicLocation: string;
  hostName: string;
  visibility: 'public' | 'semi_public';
};

type ActivityModerationResult = {
  risk_level: ModerationRiskLevel;
  recommended_action: ModerationAction;
  reasons: string[];
  confidence: number;
};

type ModerationStrictnessMode = 'relaxed' | 'balanced' | 'strict';

type ModerationPolicyRules = {
  enable_ai_moderation: boolean;
  enable_trust_relaxation: boolean;
  restrict_for_abuse_or_hate: boolean;
  restrict_for_scam_or_impersonation: boolean;
  restrict_for_mass_posting: boolean;
  restrict_for_not_real_world_activity: boolean;
  restrict_for_low_detail: boolean;
  restrict_for_overly_promotional: boolean;
  restrict_for_other: boolean;
  medium_risk_requires_review: boolean;
  high_risk_requires_review: boolean;
};

type ModerationPolicyThresholds = {
  established_host_min_count: number;
  trusted_host_min_count: number;
  trust_relax_max_confidence: number;
};

type ModerationPolicy = {
  strictness_mode: ModerationStrictnessMode;
  rules: ModerationPolicyRules;
  thresholds: ModerationPolicyThresholds;
  updated_at: string | null;
  updated_by_user_id: string | null;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODERATION_REASON_CODES = [
  'low_detail',
  'overly_promotional',
  'mass_posting_signals',
  'not_a_real_world_activity',
  'possible_scam',
  'unsafe_or_illicit',
  'adult_services',
  'harassment_or_hate',
  'impersonation_or_misleading_host',
  'suspicious_contact_or_payment_request',
  'other',
] as const;

const MODERATION_PROMPT = `
You moderate listings for a real-world community activity app.

The app is for genuine local activities, classes, sports, meetups, games, and community plans.
Be tolerant of informal, casual, community-style wording.
Do not punish weak writing alone.

Focus on:
- obvious spam or repetitive mass-posting
- scams, misleading contact/payment requests, or impersonation
- unsafe, abusive, hateful, sexual-services, or clearly illicit listings
- listings so low-detail or low-trust that they should not get broad public discovery yet

This is not a hard safety takedown system.
The app still allows people to create activities.
Your job is to recommend how far the listing should spread in public discovery.

Return strict JSON only.
Use these reason codes when relevant:
- low_detail
- overly_promotional
- mass_posting_signals
- not_a_real_world_activity
- possible_scam
- unsafe_or_illicit
- adult_services
- harassment_or_hate
- impersonation_or_misleading_host
- suspicious_contact_or_payment_request
- other
Prefer 1-3 reason codes.
Use "other" only as a last resort when no more specific reason code fits.
`.trim();

const responseSchema = {
  name: 'activity_moderation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      risk_level: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
      },
      recommended_action: {
        type: 'string',
        enum: ['allow', 'limit_visibility', 'require_review', 'block'],
      },
      reasons: {
        type: 'array',
        items: {
          type: 'string',
          enum: [...MODERATION_REASON_CODES],
        },
      },
      confidence: {
        type: 'number',
      },
    },
    required: ['risk_level', 'recommended_action', 'reasons', 'confidence'],
  },
} as const;

const DEFAULT_MODERATION_RULES: ModerationPolicyRules = {
  enable_ai_moderation: true,
  enable_trust_relaxation: true,
  restrict_for_abuse_or_hate: true,
  restrict_for_scam_or_impersonation: true,
  restrict_for_mass_posting: true,
  restrict_for_not_real_world_activity: true,
  restrict_for_low_detail: false,
  restrict_for_overly_promotional: false,
  restrict_for_other: false,
  medium_risk_requires_review: false,
  high_risk_requires_review: true,
};

const DEFAULT_MODERATION_THRESHOLDS: ModerationPolicyThresholds = {
  established_host_min_count: 3,
  trusted_host_min_count: 10,
  trust_relax_max_confidence: 0.75,
};

const PRESET_MODERATION_POLICIES: Record<ModerationStrictnessMode, {
  rules: ModerationPolicyRules;
  thresholds: ModerationPolicyThresholds;
}> = {
  relaxed: {
    rules: {
      ...DEFAULT_MODERATION_RULES,
      restrict_for_scam_or_impersonation: false,
      restrict_for_mass_posting: false,
      restrict_for_not_real_world_activity: false,
      restrict_for_low_detail: false,
      restrict_for_overly_promotional: false,
      restrict_for_other: false,
      medium_risk_requires_review: false,
      high_risk_requires_review: false,
      enable_trust_relaxation: true,
    },
    thresholds: {
      established_host_min_count: 2,
      trusted_host_min_count: 5,
      trust_relax_max_confidence: 0.9,
    },
  },
  balanced: {
    rules: { ...DEFAULT_MODERATION_RULES },
    thresholds: { ...DEFAULT_MODERATION_THRESHOLDS },
  },
  strict: {
    rules: {
      ...DEFAULT_MODERATION_RULES,
      enable_trust_relaxation: false,
      restrict_for_low_detail: true,
      restrict_for_overly_promotional: true,
      restrict_for_other: true,
      medium_risk_requires_review: true,
      high_risk_requires_review: true,
    },
    thresholds: {
      established_host_min_count: 5,
      trusted_host_min_count: 15,
      trust_relax_max_confidence: 0.6,
    },
  },
};

type MinimalStoredEvent = Pick<
  EventModerationShape,
  | 'visibility'
  | 'is_public'
  | 'show_host_publicly'
  | 'moderation_status'
  | 'moderation_risk_level'
  | 'moderation_action'
  | 'moderation_confidence'
  | 'moderation_reasons'
  | 'moderation_input_hash'
  | 'moderated_at'
  | 'moderation_archived_at'
  | 'moderation_override'
  | 'public_discovery_enabled'
> & {
  id: string;
  slug?: string | null;
  title?: string | null;
  host_user_id: string;
};

type StoredEvent = EventModerationShape & {
  id: string;
  slug?: string | null;
  host_user_id: string;
};

type EffectiveModerationUpdate = {
  public_discovery_enabled: boolean;
  moderation_status: ModerationStatus;
  moderation_risk_level: ActivityModerationResult['risk_level'] | null;
  moderation_action: ActivityModerationResult['recommended_action'] | null;
  moderation_confidence: number | null;
  moderation_reasons: string[];
  moderation_input_hash: string | null;
  moderated_at: string | null;
};

function parseEmailAllowlist(raw?: string | null) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStrictnessMode(value: unknown): ModerationStrictnessMode {
  return value === 'relaxed' || value === 'strict' || value === 'balanced'
    ? value
    : 'balanced';
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function buildPresetModerationPolicy(mode: ModerationStrictnessMode): ModerationPolicy {
  const preset = PRESET_MODERATION_POLICIES[mode];
  return {
    strictness_mode: mode,
    rules: { ...preset.rules },
    thresholds: { ...preset.thresholds },
    updated_at: null,
    updated_by_user_id: null,
  };
}

function normalizeModerationPolicy(
  value: unknown,
  basePolicy: ModerationPolicy = buildPresetModerationPolicy('balanced'),
): ModerationPolicy {
  const source = isRecord(value) ? value : {};
  const strictnessMode = normalizeStrictnessMode(source.strictness_mode ?? basePolicy.strictness_mode);
  const presetForMode = PRESET_MODERATION_POLICIES[strictnessMode];
  const rawRules = isRecord(source.rules) ? source.rules : {};
  const rawThresholds = isRecord(source.thresholds) ? source.thresholds : {};

  const rules: ModerationPolicyRules = {
    enable_ai_moderation:
      typeof rawRules.enable_ai_moderation === 'boolean'
        ? rawRules.enable_ai_moderation
        : basePolicy.rules.enable_ai_moderation ?? presetForMode.rules.enable_ai_moderation,
    enable_trust_relaxation:
      typeof rawRules.enable_trust_relaxation === 'boolean'
        ? rawRules.enable_trust_relaxation
        : basePolicy.rules.enable_trust_relaxation ?? presetForMode.rules.enable_trust_relaxation,
    restrict_for_abuse_or_hate:
      typeof rawRules.restrict_for_abuse_or_hate === 'boolean'
        ? rawRules.restrict_for_abuse_or_hate
        : basePolicy.rules.restrict_for_abuse_or_hate ?? presetForMode.rules.restrict_for_abuse_or_hate,
    restrict_for_scam_or_impersonation:
      typeof rawRules.restrict_for_scam_or_impersonation === 'boolean'
        ? rawRules.restrict_for_scam_or_impersonation
        : basePolicy.rules.restrict_for_scam_or_impersonation ?? presetForMode.rules.restrict_for_scam_or_impersonation,
    restrict_for_mass_posting:
      typeof rawRules.restrict_for_mass_posting === 'boolean'
        ? rawRules.restrict_for_mass_posting
        : basePolicy.rules.restrict_for_mass_posting ?? presetForMode.rules.restrict_for_mass_posting,
    restrict_for_not_real_world_activity:
      typeof rawRules.restrict_for_not_real_world_activity === 'boolean'
        ? rawRules.restrict_for_not_real_world_activity
        : basePolicy.rules.restrict_for_not_real_world_activity ?? presetForMode.rules.restrict_for_not_real_world_activity,
    restrict_for_low_detail:
      typeof rawRules.restrict_for_low_detail === 'boolean'
        ? rawRules.restrict_for_low_detail
        : basePolicy.rules.restrict_for_low_detail ?? presetForMode.rules.restrict_for_low_detail,
    restrict_for_overly_promotional:
      typeof rawRules.restrict_for_overly_promotional === 'boolean'
        ? rawRules.restrict_for_overly_promotional
        : basePolicy.rules.restrict_for_overly_promotional ?? presetForMode.rules.restrict_for_overly_promotional,
    restrict_for_other:
      typeof rawRules.restrict_for_other === 'boolean'
        ? rawRules.restrict_for_other
        : basePolicy.rules.restrict_for_other ?? presetForMode.rules.restrict_for_other,
    medium_risk_requires_review:
      typeof rawRules.medium_risk_requires_review === 'boolean'
        ? rawRules.medium_risk_requires_review
        : basePolicy.rules.medium_risk_requires_review ?? presetForMode.rules.medium_risk_requires_review,
    high_risk_requires_review:
      typeof rawRules.high_risk_requires_review === 'boolean'
        ? rawRules.high_risk_requires_review
        : basePolicy.rules.high_risk_requires_review ?? presetForMode.rules.high_risk_requires_review,
  };

  const thresholds: ModerationPolicyThresholds = {
    established_host_min_count: clampInteger(
      rawThresholds.established_host_min_count,
      0,
      10000,
      basePolicy.thresholds.established_host_min_count ?? presetForMode.thresholds.established_host_min_count,
    ),
    trusted_host_min_count: clampInteger(
      rawThresholds.trusted_host_min_count,
      0,
      10000,
      basePolicy.thresholds.trusted_host_min_count ?? presetForMode.thresholds.trusted_host_min_count,
    ),
    trust_relax_max_confidence: clampFloat(
      rawThresholds.trust_relax_max_confidence,
      0,
      1,
      basePolicy.thresholds.trust_relax_max_confidence ?? presetForMode.thresholds.trust_relax_max_confidence,
    ),
  };

  if (thresholds.trusted_host_min_count < thresholds.established_host_min_count) {
    thresholds.trusted_host_min_count = thresholds.established_host_min_count;
  }

  return {
    strictness_mode: strictnessMode,
    rules,
    thresholds,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : basePolicy.updated_at,
    updated_by_user_id:
      typeof source.updated_by_user_id === 'string' ? source.updated_by_user_id : basePolicy.updated_by_user_id,
  };
}

function normalizeVisibility(event: Pick<EventModerationShape, 'visibility' | 'is_public'>): EventVisibility {
  if (event.visibility === 'public' || event.visibility === 'semi_public' || event.visibility === 'private') {
    return event.visibility;
  }
  return event.is_public ? 'public' : 'private';
}

function normalizeText(value?: string | null) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function buildActivityModerationInput(event: EventModerationShape): ActivityModerationInput | null {
  const visibility = normalizeVisibility(event);
  if (visibility === 'private') return null;

  const safePublicHostName = event.show_host_publicly ? normalizeText(event.host_name) : '';

  if (visibility === 'semi_public') {
    return {
      title: normalizeText(event.title),
      description: '',
      publicSummary: normalizeText(event.public_summary),
      location: '',
      publicLocation: normalizeText(event.public_location_text),
      hostName: safePublicHostName,
      visibility,
    };
  }

  return {
    title: normalizeText(event.title),
    description: normalizeText(event.description),
    publicSummary: normalizeText(event.public_summary),
    location: normalizeText(event.location_text),
    publicLocation: normalizeText(event.public_location_text),
    hostName: safePublicHostName,
    visibility,
  };
}

function buildModerationHash(input: ActivityModerationInput) {
  const canonical = JSON.stringify(input);
  let hash = 2166136261;

  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function isPlatformModeratedVisibility(event: Pick<EventModerationShape, 'visibility' | 'is_public'>) {
  const visibility = normalizeVisibility(event);
  return visibility === 'public' || visibility === 'semi_public';
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, Number(value)));
}

function sanitizeModerationReasons(reasons: unknown, recommendedAction?: ModerationAction) {
  const validReasons = Array.isArray(reasons)
    ? reasons.filter((reason): reason is string =>
      typeof reason === 'string' && MODERATION_REASON_CODES.includes(reason as (typeof MODERATION_REASON_CODES)[number]))
    : [];

  const deduped = Array.from(new Set(validReasons));
  const withoutOther = deduped.filter((reason) => reason !== 'other');
  const normalized = withoutOther.length > 0 ? withoutOther : deduped;

  if (normalized.length > 0) return normalized.slice(0, 3);

  return recommendedAction && recommendedAction !== 'allow' ? ['other'] : [];
}

function getTrustLevel(priorHostedCount: number, thresholds: ModerationPolicyThresholds): HostTrustLevel {
  if (priorHostedCount >= thresholds.trusted_host_min_count) return 'trusted';
  if (priorHostedCount >= thresholds.established_host_min_count) return 'established';
  return 'new';
}

function getPublicReasonCode(reasons: string[]) {
  return reasons[0] || 'other';
}

function getPublicExplanation(action: PublicModerationLogAction, reasonCode: string | null) {
  switch (action) {
    case 'approved':
      return 'This public-facing activity listing was approved for broader public discovery.';
    case 'restored':
      return 'This public-facing activity listing was restored to broader public discovery.';
    case 'flagged':
      return reasonCode === 'low_detail'
        ? 'This public-facing activity listing needs a little more review before broader public discovery.'
        : 'This public-facing activity listing was flagged for review before broader public discovery.';
    case 'marked_spam':
      return 'This public-facing activity listing was marked as spam and removed from broader public discovery.';
    case 'removed':
      return 'This public-facing activity listing was removed from broader public discovery.';
    case 'denied':
      return 'This public-facing activity listing was not approved for broader public discovery.';
    default:
      return 'A moderation action was recorded for this public-facing activity listing.';
  }
}

async function loadModerationPolicy(admin: ReturnType<typeof createClient>) {
  const defaultPolicy = buildPresetModerationPolicy('balanced');
  try {
    const { error: ensureError } = await admin
      .from('moderation_policy_settings')
      .upsert(
        {
          id: true,
          strictness_mode: defaultPolicy.strictness_mode,
          rules: defaultPolicy.rules,
          thresholds: defaultPolicy.thresholds,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );

    if (ensureError) {
      throw ensureError;
    }

    const { data, error } = await admin
      .from('moderation_policy_settings')
      .select('strictness_mode, rules, thresholds, updated_at, updated_by_user_id')
      .eq('id', true)
      .single();

    if (error) {
      throw error;
    }

    return normalizeModerationPolicy(data, defaultPolicy);
  } catch (error) {
    console.warn('Falling back to default moderation policy.', error);
    return defaultPolicy;
  }
}

type ModerationPolicyUpdatePayload = {
  strictness_mode?: ModerationStrictnessMode;
  rules?: Partial<ModerationPolicyRules>;
  thresholds?: Partial<ModerationPolicyThresholds>;
  apply_preset?: boolean;
};

async function updateModerationPolicy(
  admin: ReturnType<typeof createClient>,
  userId: string,
  payload: ModerationPolicyUpdatePayload,
) {
  const currentPolicy = await loadModerationPolicy(admin);
  const mode = normalizeStrictnessMode(payload.strictness_mode ?? currentPolicy.strictness_mode);
  const baseForUpdate = payload.apply_preset === true
    ? buildPresetModerationPolicy(mode)
    : currentPolicy;

  const nextPolicy = normalizeModerationPolicy(
    {
      strictness_mode: mode,
      rules: {
        ...baseForUpdate.rules,
        ...(isRecord(payload.rules) ? payload.rules : {}),
      },
      thresholds: {
        ...baseForUpdate.thresholds,
        ...(isRecord(payload.thresholds) ? payload.thresholds : {}),
      },
      updated_by_user_id: userId,
    },
    baseForUpdate,
  );

  const { error: updateError } = await admin
    .from('moderation_policy_settings')
    .upsert(
      {
        id: true,
        strictness_mode: nextPolicy.strictness_mode,
        rules: nextPolicy.rules,
        thresholds: nextPolicy.thresholds,
        updated_by_user_id: userId,
      },
      { onConflict: 'id' },
    );

  if (updateError) {
    throw updateError;
  }

  await admin
    .from('moderation_policy_change_log')
    .insert({
      changed_by_user_id: userId,
      previous_policy: currentPolicy,
      next_policy: nextPolicy,
    });

  return loadModerationPolicy(admin);
}

function derivePublicLogAction(
  nextState: Pick<EffectiveModerationUpdate, 'public_discovery_enabled' | 'moderation_status'>,
  context: {
    previousDiscoveryEnabled?: boolean | null;
    override?: ModerationOverride | null;
    source: 'manual' | 'system';
  },
): PublicModerationLogAction {
  if (context.override === 'mark_spam') return 'marked_spam';
  if (context.override === 'hide') return 'removed';
  if (context.override === 'force_limited') return 'removed';
  if (context.override === 'force_visible' || context.override === 'mark_safe') {
    return context.previousDiscoveryEnabled ? 'approved' : 'restored';
  }

  if (nextState.public_discovery_enabled) {
    return context.previousDiscoveryEnabled ? 'approved' : context.source === 'manual' ? 'restored' : 'approved';
  }

  if (nextState.moderation_status === 'blocked') return 'removed';
  if (nextState.moderation_status === 'review' || nextState.moderation_status === 'limited') return 'flagged';
  return 'denied';
}

async function getModeratorPublicHandle(admin: ReturnType<typeof createClient>, moderatorInternalId: string | null) {
  if (!moderatorInternalId) return 'System';

  const { data, error } = await admin.rpc('get_or_create_public_moderator_handle', {
    p_user_id: moderatorInternalId,
  });

  if (error) {
    throw error;
  }

  return typeof data === 'string' && data.trim() ? data : 'Moderator';
}

async function insertPublicModerationLog(
  admin: ReturnType<typeof createClient>,
  event: Pick<StoredEvent, 'id' | 'slug' | 'title' | 'visibility' | 'is_public'>,
  update: EffectiveModerationUpdate,
  options: {
    previousDiscoveryEnabled?: boolean | null;
    override?: ModerationOverride | null;
    moderatorInternalId?: string | null;
    publicExplanation?: string | null;
    source?: 'manual' | 'system';
  } = {},
) {
  if (!isPlatformModeratedVisibility(event)) return;

  const moderatorPublicHandle = await getModeratorPublicHandle(admin, options.moderatorInternalId || null);
  const action = derivePublicLogAction(update, {
    previousDiscoveryEnabled: options.previousDiscoveryEnabled,
    override: options.override || null,
    source: options.source || 'system',
  });
  const reasonCode = getPublicReasonCode(update.moderation_reasons || []);
  const manualExplanation = normalizeText(options.publicExplanation);

  const { error } = await admin.from('public_moderation_log_entries').insert({
    target_type: 'activity',
    target_id: event.id,
    target_visibility_snapshot: normalizeVisibility(event),
    public_title_snapshot: normalizeText(event.title),
    public_slug_snapshot: normalizeText(event.slug),
    action,
    reason_code: reasonCode,
    public_explanation: manualExplanation || getPublicExplanation(action, reasonCode),
    moderator_public_handle: moderatorPublicHandle,
    moderator_internal_id: options.moderatorInternalId || null,
  });

  if (error) {
    throw error;
  }
}

function getManualOverrideUpdate(override: ModerationOverride): EffectiveModerationUpdate {
  const now = new Date().toISOString();

  switch (override) {
    case 'force_visible':
    case 'mark_safe':
      return {
        public_discovery_enabled: true,
        moderation_status: 'approved',
        moderation_risk_level: 'low',
        moderation_action: 'allow',
        moderation_confidence: 1,
        moderation_reasons: [`manual_${override}`],
        moderation_input_hash: null,
        moderated_at: now,
      };
    case 'force_limited':
      return {
        public_discovery_enabled: false,
        moderation_status: 'limited',
        moderation_risk_level: 'medium',
        moderation_action: 'limit_visibility',
        moderation_confidence: 1,
        moderation_reasons: ['manual_force_limited'],
        moderation_input_hash: null,
        moderated_at: now,
      };
    case 'hide':
      return {
        public_discovery_enabled: false,
        moderation_status: 'review',
        moderation_risk_level: 'high',
        moderation_action: 'require_review',
        moderation_confidence: 1,
        moderation_reasons: ['manual_hide'],
        moderation_input_hash: null,
        moderated_at: now,
      };
    case 'mark_spam':
      return {
        public_discovery_enabled: false,
        moderation_status: 'blocked',
        moderation_risk_level: 'high',
        moderation_action: 'block',
        moderation_confidence: 1,
        moderation_reasons: ['manual_mark_spam'],
        moderation_input_hash: null,
        moderated_at: now,
      };
  }
}

function hasHardReason(reasons: string[]) {
  return reasons.some((reason) =>
    [
      'mass_posting_signals',
      'not_a_real_world_activity',
      'possible_scam',
      'unsafe_or_illicit',
      'adult_services',
      'harassment_or_hate',
      'impersonation_or_misleading_host',
      'suspicious_contact_or_payment_request',
    ].includes(reason),
  );
}

function shouldRestrictForReasons(reasons: string[], rules: ModerationPolicyRules) {
  return reasons.some((reason) => {
    if (reason === 'harassment_or_hate' || reason === 'unsafe_or_illicit' || reason === 'adult_services') {
      return rules.restrict_for_abuse_or_hate;
    }

    if (reason === 'possible_scam' || reason === 'impersonation_or_misleading_host' || reason === 'suspicious_contact_or_payment_request') {
      return rules.restrict_for_scam_or_impersonation;
    }

    if (reason === 'mass_posting_signals') {
      return rules.restrict_for_mass_posting;
    }

    if (reason === 'not_a_real_world_activity') {
      return rules.restrict_for_not_real_world_activity;
    }

    if (reason === 'low_detail') {
      return rules.restrict_for_low_detail;
    }

    if (reason === 'overly_promotional') {
      return rules.restrict_for_overly_promotional;
    }

    if (reason === 'other') {
      return rules.restrict_for_other;
    }

    return false;
  });
}

function buildEffectiveModerationUpdate(
  aiResult: ActivityModerationResult,
  inputHash: string,
  trustLevel: HostTrustLevel,
  policy: ModerationPolicy,
): EffectiveModerationUpdate {
  const confidence = clampConfidence(aiResult.confidence);
  const reasons = aiResult.reasons || [];
  const shouldRestrictForReason = shouldRestrictForReasons(reasons, policy.rules);
  const onlySoftReasons = reasons.length === 0 || reasons.every((reason) => ['low_detail', 'overly_promotional', 'other'].includes(reason));
  const hasAnyReasons = reasons.length > 0;
  const hasOnlyNonRestrictedReasons = hasAnyReasons && !shouldRestrictForReason;

  let moderation_status: ModerationStatus = 'approved';
  let public_discovery_enabled = true;

  if (shouldRestrictForReason) {
    moderation_status = aiResult.recommended_action === 'block' ? 'blocked' : 'review';
    public_discovery_enabled = false;
  } else if (aiResult.recommended_action === 'block' && hasHardReason(reasons)) {
    moderation_status = 'blocked';
    public_discovery_enabled = false;
  } else if (aiResult.risk_level === 'high' && policy.rules.high_risk_requires_review) {
    moderation_status = 'review';
    public_discovery_enabled = false;
  } else if (aiResult.recommended_action === 'require_review' && !hasOnlyNonRestrictedReasons) {
    moderation_status = 'review';
    public_discovery_enabled = false;
  } else if ((aiResult.recommended_action === 'limit_visibility' || aiResult.risk_level === 'medium') && !hasOnlyNonRestrictedReasons) {
    const canRelaxForTrust = policy.rules.enable_trust_relaxation
      && trustLevel !== 'new'
      && onlySoftReasons
      && confidence < policy.thresholds.trust_relax_max_confidence;
    moderation_status = canRelaxForTrust
      ? 'approved'
      : (policy.rules.medium_risk_requires_review ? 'review' : 'limited');
    public_discovery_enabled = canRelaxForTrust;
  }

  return {
    public_discovery_enabled,
    moderation_status,
    moderation_risk_level: aiResult.risk_level,
    moderation_action: aiResult.recommended_action,
    moderation_confidence: confidence,
    moderation_reasons: reasons,
    moderation_input_hash: inputHash,
    moderated_at: new Date().toISOString(),
  };
}

async function getPriorHostedCount(admin: ReturnType<typeof createClient>, hostUserId: string, eventId: string) {
  const { count, error } = await admin
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('host_user_id', hostUserId)
    .neq('id', eventId);

  if (error) {
    throw error;
  }

  return count || 0;
}

async function callModerationModel(
  input: ReturnType<typeof buildActivityModerationInput> extends infer T ? Exclude<T, null> : never,
  trustLevel: HostTrustLevel,
  priorHostedCount: number,
) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured for moderate-activity.');
  }

  const model = Deno.env.get('OPENAI_MODERATION_MODEL') || 'gpt-5.4-nano';
  const baseUrl = Deno.env.get('OPENAI_API_BASE_URL') || 'https://api.openai.com/v1';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: MODERATION_PROMPT,
        },
        {
          role: 'user',
          content: JSON.stringify({
            activity: input,
            host_trust: {
              trust_level: trustLevel,
              prior_hosted_count: priorHostedCount,
            },
          }),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: responseSchema,
      },
    }),
  });

  if (!response.ok) {
    const failureBody = await response.text();
    throw new Error(`Moderation model request failed: ${response.status} ${failureBody}`);
  }

  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string') {
    throw new Error('Moderation model returned no structured content.');
  }

  const parsed = JSON.parse(rawContent) as ActivityModerationResult;

  return {
    risk_level: parsed.risk_level,
    recommended_action: parsed.recommended_action,
    reasons: sanitizeModerationReasons(parsed.reasons, parsed.recommended_action),
    confidence: parsed.confidence,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return json({ error: 'Supabase environment is not configured.' }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization') || '';

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return json({ error: 'Authentication required.' }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let currentEvent: StoredEvent | null = null;
  let currentInputHash: string | null = null;

  try {
    const requestBody = await request.json();
    const {
      eventId,
      override,
      clearOverride,
      rerun,
      archive,
      unarchive,
      listQueue,
      listPolicy,
      updatePolicy,
      publicExplanation,
    } = isRecord(requestBody) ? requestBody : {};
    const adminEmails = parseEmailAllowlist(Deno.env.get('MODERATION_ADMIN_EMAILS'));
    const isAdmin = !!user.email && adminEmails.includes(user.email.trim().toLowerCase());

    if (listPolicy === true) {
      if (!isAdmin) {
        return json({ error: 'Admin permissions are required to view moderation policy settings.' }, { status: 403 });
      }

      const policy = await loadModerationPolicy(admin);
      return json({ policy });
    }

    if (isRecord(updatePolicy)) {
      if (!isAdmin) {
        return json({ error: 'Admin permissions are required to update moderation policy settings.' }, { status: 403 });
      }

      const policy = await updateModerationPolicy(admin, user.id, {
        strictness_mode: updatePolicy.strictness_mode as ModerationStrictnessMode | undefined,
        rules: isRecord(updatePolicy.rules) ? updatePolicy.rules as Partial<ModerationPolicyRules> : undefined,
        thresholds: isRecord(updatePolicy.thresholds) ? updatePolicy.thresholds as Partial<ModerationPolicyThresholds> : undefined,
        apply_preset: updatePolicy.apply_preset === true,
      });

      return json({ policy });
    }

    if (listQueue === true) {
      if (!isAdmin) {
        return json({ error: 'Admin permissions are required to view the moderation queue.' }, { status: 403 });
      }

      const { data: queueItems, error: queueError } = await admin
        .from('events')
        .select(`
          id,
          slug,
          title,
          starts_at,
          timezone,
          public_summary,
          public_location_text,
          description,
          location_text,
          host_name,
          show_host_publicly,
          visibility,
          is_public,
          status,
          created_at,
          public_discovery_enabled,
          moderation_status,
          moderation_risk_level,
          moderation_action,
          moderation_confidence,
          moderation_reasons,
          moderation_input_hash,
          moderated_at,
          moderation_archived_at,
          moderation_override
        `)
        .in('visibility', ['public', 'semi_public'])
        .order('created_at', { ascending: false })
        .limit(150);

      if (queueError) {
        throw queueError;
      }

      const safeItems = (queueItems || []).map((item) => ({
        ...item,
        host_name:
          item.visibility === 'semi_public' && !item.show_host_publicly
            ? null
            : item.host_name,
        description: item.visibility === 'public' ? item.description : null,
        location_text: item.visibility === 'public' ? item.location_text : null,
      }));

      return json({ items: safeItems });
    }

    if (!eventId || typeof eventId !== 'string') {
      return json({ error: 'eventId is required.' }, { status: 400 });
    }

    const { data: minimalEvent, error: eventError } = await admin
      .from('events')
      .select(`
        id,
        slug,
        title,
        show_host_publicly,
        host_user_id,
        visibility,
        is_public,
        moderation_status,
        moderation_risk_level,
        moderation_action,
        moderation_confidence,
        moderation_reasons,
        moderation_input_hash,
        moderated_at,
        moderation_archived_at,
        moderation_override,
        public_discovery_enabled
      `)
      .eq('id', eventId)
      .single<MinimalStoredEvent>();

    if (eventError || !minimalEvent) {
      return json({ error: 'Activity not found.' }, { status: 404 });
    }

    const { data: hostMembership } = await admin
      .from('event_hosts')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (minimalEvent.host_user_id !== user.id && !hostMembership?.id && !isAdmin) {
      return json({ error: 'You do not have permission to moderate this activity.' }, { status: 403 });
    }

    const requestedOverride = typeof override === 'string' ? override as ModerationOverride : null;
    const shouldClearOverride = clearOverride === true;
    const shouldRerun = rerun === true;
    const shouldArchive = archive === true;
    const shouldUnarchive = unarchive === true;

    if ((requestedOverride || shouldClearOverride || shouldArchive || shouldUnarchive) && !isAdmin) {
      return json({ error: 'Admin permissions are required for manual moderation overrides.' }, { status: 403 });
    }

    if (!isPlatformModeratedVisibility(minimalEvent)) {
      if (isAdmin || requestedOverride || shouldClearOverride || shouldArchive || shouldUnarchive || shouldRerun) {
        return json(
          {
            error: 'Platform moderation only applies to public-facing activity content. Private activities stay outside platform moderation review.',
          },
          { status: 403 },
        );
      }

      return json({
        reused: false,
        skipped: true,
        scope: 'non_public',
      });
    }

    const { data: event, error: fullEventError } = await admin
      .from('events')
      .select(`
        id,
        slug,
        title,
        description,
        public_summary,
        location_text,
        public_location_text,
        host_name,
        show_host_publicly,
        host_user_id,
        visibility,
        is_public,
        moderation_status,
        moderation_risk_level,
        moderation_action,
        moderation_confidence,
        moderation_reasons,
        moderation_input_hash,
        moderated_at,
        moderation_archived_at,
        moderation_override,
        public_discovery_enabled
      `)
      .eq('id', eventId)
      .single<StoredEvent>();

    if (fullEventError || !event) {
      return json({ error: 'Activity not found.' }, { status: 404 });
    }
    currentEvent = event;

    if (shouldArchive || shouldUnarchive) {
      const archiveValue = shouldArchive ? new Date().toISOString() : null;
      const { data: updatedEvent, error: archiveError } = await admin
        .from('events')
        .update({ moderation_archived_at: archiveValue })
        .eq('id', event.id)
        .select(`
          public_discovery_enabled,
          moderation_status,
          moderation_risk_level,
          moderation_action,
          moderation_confidence,
          moderation_reasons,
          moderation_input_hash,
          moderated_at,
          moderation_archived_at,
          moderation_override
        `)
        .single();

      if (archiveError) {
        throw archiveError;
      }

      return json({
        reused: false,
        archived: shouldArchive,
        result: updatedEvent,
      });
    }

    if (requestedOverride) {
      const previousDiscoveryEnabled = !!event.public_discovery_enabled;
      const { data: updatedEvent, error: overrideError } = await admin
        .from('events')
        .update({ moderation_override: requestedOverride })
        .eq('id', event.id)
        .select(`
          public_discovery_enabled,
          moderation_status,
          moderation_risk_level,
          moderation_action,
          moderation_confidence,
          moderation_reasons,
          moderation_input_hash,
          moderated_at,
          moderation_archived_at,
          moderation_override
        `)
        .single();

      if (overrideError) {
        throw overrideError;
      }

      await insertPublicModerationLog(
        admin,
        event,
        getManualOverrideUpdate(requestedOverride),
        {
          previousDiscoveryEnabled,
          override: requestedOverride,
          moderatorInternalId: user.id,
          publicExplanation: typeof publicExplanation === 'string' ? publicExplanation : null,
          source: 'manual',
        },
      );

      return json({ reused: false, override: requestedOverride, result: updatedEvent });
    }

    if (shouldClearOverride) {
      const clearState = {
        moderation_override: null,
        public_discovery_enabled: false,
        moderation_status: 'pending',
        moderation_risk_level: null,
        moderation_action: null,
        moderation_confidence: null,
        moderation_reasons: [],
        moderation_input_hash: null,
        moderated_at: null,
      };

      const { error: clearError } = await admin
        .from('events')
        .update(clearState)
        .eq('id', event.id);

      if (clearError) {
        throw clearError;
      }

      event.moderation_override = null;
      event.public_discovery_enabled = false;
      event.moderation_status = 'pending';
      event.moderation_risk_level = null;
      event.moderation_action = null;
      event.moderation_confidence = null;
      event.moderation_reasons = [];
      event.moderation_input_hash = null;
      event.moderated_at = null;

      if (!shouldRerun) {
        return json({ reused: false, cleared: true, result: clearState });
      }
    }

    if (event.moderation_override) {
      const previousDiscoveryEnabled = !!event.public_discovery_enabled;
      const overrideUpdate = getManualOverrideUpdate(event.moderation_override);
      const { error: overrideError } = await admin
        .from('events')
        .update(overrideUpdate)
        .eq('id', event.id);

      if (overrideError) {
        throw overrideError;
      }

      await insertPublicModerationLog(
        admin,
        event,
        overrideUpdate,
        {
          previousDiscoveryEnabled,
          override: event.moderation_override,
          moderatorInternalId: user.id,
          publicExplanation: typeof publicExplanation === 'string' ? publicExplanation : null,
          source: 'manual',
        },
      );

      return json({ reused: false, override: event.moderation_override, result: overrideUpdate });
    }

    const moderationInput = buildActivityModerationInput(event);
    if (!moderationInput) {
      const bypassUpdate: EffectiveModerationUpdate = {
        public_discovery_enabled: false,
        moderation_status: 'not_required',
        moderation_risk_level: null,
        moderation_action: null,
        moderation_confidence: null,
        moderation_reasons: [],
        moderation_input_hash: null,
        moderated_at: null,
      };

      const { error: bypassError } = await admin
        .from('events')
        .update(bypassUpdate)
        .eq('id', event.id);

      if (bypassError) {
        throw bypassError;
      }

      return json({ reused: false, result: bypassUpdate });
    }

    const inputHash = buildModerationHash(moderationInput);
    currentInputHash = inputHash;
    if (
      !shouldRerun &&
      event.moderation_input_hash === inputHash &&
      event.moderation_status &&
      !['pending', 'error'].includes(event.moderation_status)
    ) {
      return json({
        reused: true,
        result: {
          public_discovery_enabled: !!event.public_discovery_enabled,
          moderation_status: event.moderation_status,
          moderation_risk_level: event.moderation_risk_level,
          moderation_action: event.moderation_action,
          moderation_confidence: event.moderation_confidence,
          moderation_reasons: event.moderation_reasons || [],
          moderation_input_hash: event.moderation_input_hash,
          moderated_at: event.moderated_at,
        },
      });
    }

    const moderationPolicy = await loadModerationPolicy(admin);

    if (!moderationPolicy.rules.enable_ai_moderation) {
      const previousDiscoveryEnabled = !!event.public_discovery_enabled;
      const policyBypassUpdate: EffectiveModerationUpdate = {
        public_discovery_enabled: true,
        moderation_status: 'approved',
        moderation_risk_level: null,
        moderation_action: null,
        moderation_confidence: null,
        moderation_reasons: [],
        moderation_input_hash: inputHash,
        moderated_at: new Date().toISOString(),
      };

      const { error: bypassError } = await admin
        .from('events')
        .update(policyBypassUpdate)
        .eq('id', event.id);

      if (bypassError) {
        throw bypassError;
      }

      await insertPublicModerationLog(
        admin,
        event,
        policyBypassUpdate,
        {
          previousDiscoveryEnabled,
          publicExplanation: typeof publicExplanation === 'string' ? publicExplanation : null,
          source: 'system',
        },
      );

      return json({
        reused: false,
        ai_skipped: true,
        policy_mode: moderationPolicy.strictness_mode,
        result: policyBypassUpdate,
      });
    }

    const priorHostedCount = await getPriorHostedCount(admin, event.host_user_id, event.id);
    const trustLevel = getTrustLevel(priorHostedCount, moderationPolicy.thresholds);
    const aiResult = await callModerationModel(moderationInput, trustLevel, priorHostedCount);
    const previousDiscoveryEnabled = !!event.public_discovery_enabled;
    const effectiveUpdate = buildEffectiveModerationUpdate(aiResult, inputHash, trustLevel, moderationPolicy);

    const { error: updateError } = await admin
      .from('events')
      .update(effectiveUpdate)
      .eq('id', event.id);

    if (updateError) {
      throw updateError;
    }

    await insertPublicModerationLog(
      admin,
      event,
      effectiveUpdate,
      {
        previousDiscoveryEnabled,
        publicExplanation: typeof publicExplanation === 'string' ? publicExplanation : null,
        source: 'system',
      },
    );

    return json({
      reused: false,
      policy_mode: moderationPolicy.strictness_mode,
      trust_level: trustLevel,
      prior_hosted_count: priorHostedCount,
      ai_result: aiResult,
      result: effectiveUpdate,
    });
  } catch (error) {
    console.error('moderate-activity failed', error);

    if (currentEvent) {
      await admin
        .from('events')
        .update({
          public_discovery_enabled: false,
          moderation_status: 'error',
          moderation_input_hash: currentInputHash,
          moderated_at: new Date().toISOString(),
        })
        .eq('id', currentEvent.id);
    }

    return json(
      {
        error: error instanceof Error ? error.message : 'Unknown moderation error.',
      },
      { status: 500 },
    );
  }
});
