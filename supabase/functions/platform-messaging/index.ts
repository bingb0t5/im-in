import { createClient } from 'npm:@supabase/supabase-js@2';

type BetaFeatureRow = {
  user_id: string;
  feature_key: string;
  enabled: boolean;
  updated_at: string;
};

type EventRow = {
  id: string;
  title: string | null;
  host_user_id: string;
};

type OwnerScope = {
  ownerApp: 'im_in';
  ownerWorkspaceId: string;
  ownerUserId: string;
};

type ActivityMessagingSettingsRow = {
  event_id: string;
  host_user_id: string;
  platform_target_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type ActivityMessageRow = {
  id: string;
  event_id: string;
  host_user_id: string;
  platform_message_id: string;
  platform_target_id: string;
  message_body: string;
  scheduled_for: string;
  status: string;
  created_at: string;
  updated_at: string;
};

const FEATURE_KEY = 'host_whatsapp_messaging';
const APP_NAME = "I'm In";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

function normalizeText(value: string | null | undefined) {
  return (value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getRequiredUser(supabaseUrl: string, supabaseAnonKey: string, authorizationHeader: string | null) {
  if (!authorizationHeader?.trim()) {
    throw Object.assign(new Error('Missing authorization header.'), { status: 401 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw Object.assign(new Error(error?.message || 'Could not verify current user.'), { status: 401 });
  }
  return data.user;
}

async function loadBetaFeature(adminClient: ReturnType<typeof createClient>, userId: string): Promise<BetaFeatureRow | null> {
  const { data, error } = await adminClient
    .from('user_beta_features')
    .select('user_id,feature_key,enabled,updated_at')
    .eq('feature_key', FEATURE_KEY)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw Object.assign(new Error(error.message || 'Could not load messaging beta settings.'), { status: 500 });
  return (data as BetaFeatureRow | null) || null;
}

async function loadManagedEvent(adminClient: ReturnType<typeof createClient>, eventId: string, userId: string) {
  const { data: eventRow, error: eventError } = await adminClient
    .from('events')
    .select('id,title,host_user_id')
    .eq('id', eventId)
    .single();
  if (eventError || !eventRow) {
    throw Object.assign(new Error(eventError?.message || 'Event not found.'), { status: 404 });
  }

  const event = eventRow as EventRow;
  let canManage = event.host_user_id === userId;
  if (!canManage) {
    const { data: hostMembership, error: hostError } = await adminClient
      .from('event_hosts')
      .select('id')
      .eq('event_id', event.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (hostError) {
      throw Object.assign(new Error(hostError.message || 'Could not verify host access.'), { status: 500 });
    }
    canManage = !!hostMembership?.id;
  }

  if (!canManage) {
    throw Object.assign(new Error('Only hosts can manage activity messaging.'), { status: 403 });
  }

  return event;
}

function buildHostScope(userId: string): OwnerScope {
  return {
    ownerApp: 'im_in',
    ownerWorkspaceId: `host:${userId}`,
    ownerUserId: userId,
  };
}

async function loadActivitySettings(adminClient: ReturnType<typeof createClient>, eventId: string) {
  const { data, error } = await adminClient
    .from('event_whatsapp_messaging_settings')
    .select('event_id,host_user_id,platform_target_id,enabled,created_at,updated_at')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw Object.assign(new Error(error.message || 'Could not load activity messaging settings.'), { status: 500 });
  return (data as ActivityMessagingSettingsRow | null) || null;
}

async function saveActivitySettings(
  adminClient: ReturnType<typeof createClient>,
  input: {
    eventId: string;
    hostUserId: string;
    enabled: boolean;
    platformTargetId: string | null;
  },
) {
  const { data, error } = await adminClient
    .from('event_whatsapp_messaging_settings')
    .upsert({
      event_id: input.eventId,
      host_user_id: input.hostUserId,
      enabled: input.enabled,
      platform_target_id: input.platformTargetId,
    }, { onConflict: 'event_id' })
    .select('event_id,host_user_id,platform_target_id,enabled,created_at,updated_at')
    .single();
  if (error || !data) {
    throw Object.assign(new Error(error?.message || 'Could not save activity messaging settings.'), { status: 500 });
  }
  return data as ActivityMessagingSettingsRow;
}

async function listActivityMessages(adminClient: ReturnType<typeof createClient>, eventId: string) {
  const { data, error } = await adminClient
    .from('event_whatsapp_scheduled_messages')
    .select('id,event_id,host_user_id,platform_message_id,platform_target_id,message_body,scheduled_for,status,created_at,updated_at')
    .eq('event_id', eventId)
    .order('scheduled_for', { ascending: true })
    .limit(50);
  if (error) throw Object.assign(new Error(error.message || 'Could not load activity WhatsApp messages.'), { status: 500 });
  return (data as ActivityMessageRow[] | null) || [];
}

async function recordActivityMessage(
  adminClient: ReturnType<typeof createClient>,
  input: {
    eventId: string;
    hostUserId: string;
    createdByUserId: string;
    platformMessage: Record<string, unknown>;
  },
) {
  const platformMessageId = normalizeText(typeof input.platformMessage.id === 'string' ? input.platformMessage.id : '');
  const platformTargetId = normalizeText(typeof input.platformMessage.target_id === 'string' ? input.platformMessage.target_id : '');
  const messageBody = normalizeText(typeof input.platformMessage.message_body === 'string' ? input.platformMessage.message_body : '');
  const scheduledFor = normalizeText(typeof input.platformMessage.scheduled_for === 'string' ? input.platformMessage.scheduled_for : '');
  const status = normalizeText(typeof input.platformMessage.status === 'string' ? input.platformMessage.status : 'scheduled');
  if (!platformMessageId || !platformTargetId || !messageBody || !scheduledFor) return null;

  const { data, error } = await adminClient
    .from('event_whatsapp_scheduled_messages')
    .insert({
      event_id: input.eventId,
      host_user_id: input.hostUserId,
      created_by_user_id: input.createdByUserId,
      platform_message_id: platformMessageId,
      platform_target_id: platformTargetId,
      message_body: messageBody,
      scheduled_for: scheduledFor,
      status: status || 'scheduled',
    })
    .select('id,event_id,host_user_id,platform_message_id,platform_target_id,message_body,scheduled_for,status,created_at,updated_at')
    .single();
  if (error || !data) {
    throw Object.assign(new Error(error?.message || 'Could not record activity WhatsApp message.'), { status: 500 });
  }
  return data as ActivityMessageRow;
}

function platformConfig() {
  const baseUrl = normalizeText(
    Deno.env.get('LALO_PLATFORM_API_BASE_URL') || Deno.env.get('LALO_PLATFORM_MESSAGING_API_BASE_URL'),
  ).replace(/\/$/, '');
  const apiKey = normalizeText(
    Deno.env.get('LALO_PLATFORM_API_KEY')
      || Deno.env.get('LALO_PLATFORM_MESSAGING_API_KEY')
      || Deno.env.get('PLATFORM_INTERNAL_API_KEY'),
  );

  if (!baseUrl || !apiKey) {
    throw Object.assign(new Error('Lalo Platform credentials are not configured for platform messaging.'), { status: 500 });
  }
  return { baseUrl, apiKey };
}

async function callPlatform(path: string, init: RequestInit = {}) {
  const { baseUrl, apiKey } = platformConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-platform-api-key': apiKey,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = typeof parsed?.error === 'string' ? parsed.error : `Platform request failed (${response.status}).`;
    throw Object.assign(new Error(message), { status: response.status, platformStatus: response.status });
  }
  return parsed;
}

async function callPlatformOptional(path: string, init: RequestInit = {}) {
  try {
    return await callPlatform(path, init);
  } catch (error) {
    if (typeof (error as { status?: unknown }).status === 'number' && (error as { status: number }).status === 404) {
      return null;
    }
    throw error;
  }
}

function platformPublicUrl() {
  return normalizeText(Deno.env.get('LALO_PLATFORM_SHOWQR_URL') || 'https://showqr.link').replace(/\/$/, '');
}

function ownerQuery(scope: OwnerScope) {
  const params = new URLSearchParams({
    ownerApp: scope.ownerApp,
    ownerWorkspaceId: scope.ownerWorkspaceId,
    ownerUserId: scope.ownerUserId,
  });
  return params.toString();
}

function readEngineId(body: Record<string, unknown>) {
  return normalizeText(typeof body.engineId === 'string' ? body.engineId : typeof body.engine_id === 'string' ? body.engine_id : '');
}

function targetIsReady(target: Record<string, unknown>) {
  return normalizeText(typeof target.status === 'string' ? target.status : '') === 'ready';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw Object.assign(new Error('Supabase credentials are not configured for platform-messaging.'), { status: 500 });
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const body = asRecord(await req.json().catch(() => ({})));
    const action = normalizeText(typeof body.action === 'string' ? body.action : '');
    const eventId = normalizeText(typeof body.eventId === 'string' ? body.eventId : typeof body.event_id === 'string' ? body.event_id : '');

    const beta = await loadBetaFeature(adminClient, user.id);
    const betaStatus = {
      enabled: beta?.enabled === true,
      featureKey: FEATURE_KEY,
      updatedAt: beta?.updated_at || null,
    };

    if (action === 'betaStatus') {
      return json(betaStatus);
    }

    if (!beta?.enabled) {
      return json({ error: 'You are not enabled for WhatsApp messaging.', ...betaStatus }, { status: 403 });
    }

    if (!isUuid(eventId)) {
      return json({ error: 'eventId is required.' }, { status: 400 });
    }

    const event = await loadManagedEvent(adminClient, eventId, user.id);
    const hostScope = buildHostScope(user.id);

    if (action === 'status') {
      const targets = await callPlatform(`/api/messaging/targets?${ownerQuery(hostScope)}`);
      const activitySettings = await loadActivitySettings(adminClient, event.id);
      const messages = await listActivityMessages(adminClient, event.id);
      let latestEngine = null;
      let latestEngineError: string | null = null;
      try {
        latestEngine = await callPlatform(`/api/messaging/engines/latest?${ownerQuery(hostScope)}`);
      } catch (error) {
        latestEngineError = error instanceof Error ? error.message : 'Could not load latest engine.';
      }
      return json({
        beta: betaStatus,
        event: {
          id: event.id,
          title: event.title,
        },
        ownerScope: hostScope,
        activitySettings,
        latestEngine,
        latestEngineError,
        targets: Array.isArray(targets?.targets) ? targets.targets : [],
        messages,
      });
    }

    if (action === 'getLatestEngine') {
      const latestEngine = await callPlatformOptional(`/api/messaging/engines/latest?${ownerQuery(hostScope)}`);
      return json({ engine: latestEngine, ownerScope: hostScope });
    }

    if (action === 'createEngine') {
      const existingEngine = await callPlatformOptional(`/api/messaging/engines/latest?${ownerQuery(hostScope)}`);
      if (existingEngine) {
        return json({ engine: existingEngine, ownerScope: hostScope, reusedExisting: true });
      }

      const label = normalizeText(typeof body.label === 'string' ? body.label : '');
      let engine;
      try {
        engine = await callPlatform('/api/messaging/engines', {
          method: 'POST',
          body: JSON.stringify({
            ...hostScope,
            label: label || `${APP_NAME} WhatsApp`,
          }),
        });
      } catch (createError) {
        const message = createError instanceof Error ? createError.message : '';
        if (!message.toLowerCase().includes('duplicate key')) throw createError;
        engine = await callPlatform(`/api/messaging/engines/latest?${ownerQuery(hostScope)}`);
      }
      return json({ engine, ownerScope: hostScope });
    }

    if (action === 'createTarget') {
      const engineId = readEngineId(body);
      const label = normalizeText(typeof body.label === 'string' ? body.label : '');
      const inviteUrl = normalizeText(typeof body.inviteUrl === 'string' ? body.inviteUrl : '');
      if (!engineId) return json({ error: 'engineId is required.' }, { status: 400 });
      if (!label) return json({ error: 'Group name is required.' }, { status: 400 });
      const target = await callPlatform('/api/messaging/targets', {
        method: 'POST',
        body: JSON.stringify({
          ...hostScope,
          engineId,
          label,
          inviteUrl: inviteUrl || null,
          status: inviteUrl ? 'pending' : 'failed',
          lastError: inviteUrl ? null : 'Add a WhatsApp group invite link so the worker can import the group.',
        }),
      });
      return json({ target, ownerScope: hostScope });
    }

    if (action === 'saveActivitySettings') {
      const enabled = body.enabled === true;
      const targetId = normalizeText(typeof body.targetId === 'string' ? body.targetId : '');
      if (enabled && !targetId) return json({ error: 'Select a WhatsApp group before enabling activity messaging.' }, { status: 400 });
      if (targetId) {
        const targets = await callPlatform(`/api/messaging/targets?${ownerQuery(hostScope)}`);
        const target = Array.isArray(targets?.targets)
          ? (targets.targets as Record<string, unknown>[]).find((item) => item.id === targetId)
          : null;
        if (!target) return json({ error: 'Selected WhatsApp group was not found for this host.' }, { status: 404 });
        if (!targetIsReady(target)) return json({ error: 'Selected WhatsApp group is not ready yet.' }, { status: 409 });
      }
      const activitySettings = await saveActivitySettings(adminClient, {
        eventId: event.id,
        hostUserId: user.id,
        enabled,
        platformTargetId: targetId || null,
      });
      return json({ activitySettings, ownerScope: hostScope });
    }

    if (action === 'createScheduledMessage' || action === 'sendMessageNow') {
      const requestedTargetId = normalizeText(typeof body.targetId === 'string' ? body.targetId : '');
      const activitySettings = await loadActivitySettings(adminClient, event.id);
      const configuredTargetId = normalizeText(activitySettings?.platform_target_id || '');
      const targetId = configuredTargetId || requestedTargetId;
      const messageBody = normalizeText(typeof body.messageBody === 'string' ? body.messageBody : '');
      const scheduledFor = action === 'sendMessageNow'
        ? new Date().toISOString()
        : normalizeText(typeof body.scheduledFor === 'string' ? body.scheduledFor : '');
      if (!activitySettings?.enabled) {
        return json({ error: 'Enable WhatsApp messaging for this activity before sending updates.' }, { status: 409 });
      }
      if (!configuredTargetId) return json({ error: 'Select and save a WhatsApp group for this activity before sending updates.' }, { status: 400 });
      if (requestedTargetId && requestedTargetId !== configuredTargetId) {
        return json({ error: 'Save the selected WhatsApp group before sending updates.' }, { status: 409 });
      }
      if (!targetId) return json({ error: 'targetId is required.' }, { status: 400 });
      if (!messageBody) return json({ error: 'Message is required.' }, { status: 400 });
      if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor))) {
        return json({ error: 'scheduledFor must be a valid date.' }, { status: 400 });
      }
      const targets = await callPlatform(`/api/messaging/targets?${ownerQuery(hostScope)}`);
      const target = Array.isArray(targets?.targets)
        ? (targets.targets as Record<string, unknown>[]).find((item) => item.id === targetId)
        : null;
      if (!target) return json({ error: 'Selected WhatsApp group was not found for this host.' }, { status: 404 });
      if (!targetIsReady(target)) return json({ error: 'Selected WhatsApp group is not ready yet.' }, { status: 409 });
      const message = await callPlatform('/api/messaging/scheduled-messages', {
        method: 'POST',
        body: JSON.stringify({
          ...hostScope,
          targetId,
          messageBody,
          scheduledFor: new Date(scheduledFor).toISOString(),
        }),
      });
      const activityMessage = await recordActivityMessage(adminClient, {
        eventId: event.id,
        hostUserId: user.id,
        createdByUserId: user.id,
        platformMessage: asRecord(message),
      });
      return json({ message, activityMessage, ownerScope: hostScope });
    }

    if (action === 'getEngineQr') {
      const engineId = readEngineId(body);
      if (!engineId) return json({ error: 'engineId is required.' }, { status: 400 });
      const qr = await callPlatform(`/api/messaging/engines/${encodeURIComponent(engineId)}/qr?${ownerQuery(hostScope)}`);
      return json({ qr, ownerScope: hostScope });
    }

    if (action === 'reconnectEngine' || action === 'disconnectEngine') {
      const engineId = readEngineId(body);
      if (!engineId) return json({ error: 'engineId is required.' }, { status: 400 });
      const platformAction = action === 'reconnectEngine' ? 'reconnect' : 'disconnect';
      const engine = await callPlatform(`/api/messaging/engines/${encodeURIComponent(engineId)}/${platformAction}`, {
        method: 'POST',
        body: JSON.stringify(hostScope),
      });
      return json({ engine, ownerScope: hostScope });
    }

    if (action === 'startQrHandoff') {
      const engineId = readEngineId(body);
      if (!engineId) return json({ error: 'engineId is required.' }, { status: 400 });
      const returnUrl = normalizeText(typeof body.returnUrl === 'string' ? body.returnUrl : '');
      const handoff = await callPlatform('/api/messaging/engine-handoffs', {
        method: 'POST',
        body: JSON.stringify({
          ...hostScope,
          engineId,
          appName: APP_NAME,
          themeColor: '#7c3aed',
          contextLabel: 'Host WhatsApp setup',
          returnUrl: returnUrl || null,
        }),
      });
      return json({
        handoff,
        showQrUrl: `${platformPublicUrl()}/showqr`,
        ownerScope: hostScope,
      });
    }

    return json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
    const message = error instanceof Error ? error.message : 'Unexpected platform-messaging error.';
    console.error('[platform-messaging] error', message);
    return json({ error: message }, { status });
  }
});
