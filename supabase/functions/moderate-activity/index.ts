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

function getTrustLevel(priorHostedCount: number): HostTrustLevel {
  if (priorHostedCount >= 10) return 'trusted';
  if (priorHostedCount >= 3) return 'established';
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

function buildEffectiveModerationUpdate(
  aiResult: ActivityModerationResult,
  inputHash: string,
  trustLevel: HostTrustLevel,
): EffectiveModerationUpdate {
  const confidence = clampConfidence(aiResult.confidence);
  const reasons = aiResult.reasons || [];
  const hardReasonPresent = hasHardReason(reasons);
  const onlySoftReasons = reasons.length === 0 || reasons.every((reason) => ['low_detail', 'overly_promotional', 'other'].includes(reason));

  let moderation_status: ModerationStatus = 'approved';
  let public_discovery_enabled = true;

  if (aiResult.recommended_action === 'block' || aiResult.risk_level === 'high' || hardReasonPresent) {
    moderation_status = aiResult.recommended_action === 'block' ? 'blocked' : 'review';
    public_discovery_enabled = false;
  } else if (aiResult.recommended_action === 'require_review') {
    moderation_status = 'review';
    public_discovery_enabled = false;
  } else if (aiResult.recommended_action === 'limit_visibility' || aiResult.risk_level === 'medium') {
    const canRelaxForTrust = trustLevel !== 'new' && onlySoftReasons && confidence < 0.75;
    moderation_status = canRelaxForTrust ? 'approved' : 'limited';
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
    const { eventId, override, clearOverride, rerun, archive, unarchive, listQueue, publicExplanation } = await request.json();
    const adminEmails = parseEmailAllowlist(Deno.env.get('MODERATION_ADMIN_EMAILS'));
    const isAdmin = !!user.email && adminEmails.includes(user.email.trim().toLowerCase());

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

    const priorHostedCount = await getPriorHostedCount(admin, event.host_user_id, event.id);
    const trustLevel = getTrustLevel(priorHostedCount);
    const aiResult = await callModerationModel(moderationInput, trustLevel, priorHostedCount);
    const previousDiscoveryEnabled = !!event.public_discovery_enabled;
    const effectiveUpdate = buildEffectiveModerationUpdate(aiResult, inputHash, trustLevel);

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
