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

function buildOwnerScope(event: EventRow, userId: string): OwnerScope {
  return {
    ownerApp: 'im_in',
    ownerWorkspaceId: event.id,
    ownerUserId: userId,
  };
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
  return platformConfig().baseUrl;
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
    const ownerScope = buildOwnerScope(event, user.id);

    if (action === 'status') {
      const targets = await callPlatform(`/api/messaging/targets?${ownerQuery(ownerScope)}`);
      let latestEngine = null;
      let latestEngineError: string | null = null;
      try {
        latestEngine = await callPlatform(`/api/messaging/engines/latest?${ownerQuery(ownerScope)}`);
      } catch (error) {
        latestEngineError = error instanceof Error ? error.message : 'Could not load latest engine.';
      }
      return json({
        beta: betaStatus,
        event: {
          id: event.id,
          title: event.title,
        },
        ownerScope,
        latestEngine,
        latestEngineError,
        targets: Array.isArray(targets?.targets) ? targets.targets : [],
      });
    }

    if (action === 'getLatestEngine') {
      const latestEngine = await callPlatformOptional(`/api/messaging/engines/latest?${ownerQuery(ownerScope)}`);
      return json({ engine: latestEngine, ownerScope });
    }

    if (action === 'createEngine') {
      const label = normalizeText(typeof body.label === 'string' ? body.label : event.title || '');
      const engine = await callPlatform('/api/messaging/engines', {
        method: 'POST',
        body: JSON.stringify({
          ...ownerScope,
          label: label || `${APP_NAME} activity`,
        }),
      });
      return json({ engine, ownerScope });
    }

    if (action === 'getEngineQr') {
      const engineId = readEngineId(body);
      if (!engineId) return json({ error: 'engineId is required.' }, { status: 400 });
      const qr = await callPlatform(`/api/messaging/engines/${encodeURIComponent(engineId)}/qr?${ownerQuery(ownerScope)}`);
      return json({ qr, ownerScope });
    }

    if (action === 'reconnectEngine' || action === 'disconnectEngine') {
      const engineId = readEngineId(body);
      if (!engineId) return json({ error: 'engineId is required.' }, { status: 400 });
      const platformAction = action === 'reconnectEngine' ? 'reconnect' : 'disconnect';
      const engine = await callPlatform(`/api/messaging/engines/${encodeURIComponent(engineId)}/${platformAction}`, {
        method: 'POST',
        body: JSON.stringify(ownerScope),
      });
      return json({ engine, ownerScope });
    }

    if (action === 'startQrHandoff') {
      const engineId = readEngineId(body);
      if (!engineId) return json({ error: 'engineId is required.' }, { status: 400 });
      const returnUrl = normalizeText(typeof body.returnUrl === 'string' ? body.returnUrl : '');
      const handoff = await callPlatform('/api/messaging/engine-handoffs', {
        method: 'POST',
        body: JSON.stringify({
          ...ownerScope,
          engineId,
          appName: APP_NAME,
          themeColor: '#7c3aed',
          contextLabel: event.title || 'Activity messaging',
          returnUrl: returnUrl || null,
        }),
      });
      return json({
        handoff,
        showQrUrl: `${platformPublicUrl()}/showqr`,
        ownerScope,
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
