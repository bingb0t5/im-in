import { createClient } from 'npm:@supabase/supabase-js@2';

type BetaFeatureRow = {
  user_id: string;
  feature_key: string;
  enabled: boolean;
  whatsapp_test_number: string | null;
  notes: string | null;
  updated_at: string;
};

const FEATURE_KEY = 'host_whatsapp_connect';

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

function maskPhoneNumber(e164: string | null) {
  if (!e164) return null;
  const normalized = normalizeText(e164);
  if (!normalized.startsWith('+') || normalized.length <= 5) return null;
  return `+${'*'.repeat(Math.max(0, normalized.length - 5))}${normalized.slice(-4)}`;
}

function toHelperLabel(userId: string) {
  return `host-${userId.replace(/-/g, '').slice(0, 20)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

async function getRequiredUser(supabaseUrl: string, supabaseAnonKey: string, authorizationHeader: string | null) {
  if (!authorizationHeader?.trim()) {
    throw new Error('Missing authorization header.');
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new Error(error?.message || 'Could not verify current user.');
  }
  return data.user;
}

async function loadBetaFeature(adminClient: ReturnType<typeof createClient>, userId: string): Promise<BetaFeatureRow | null> {
  const { data, error } = await adminClient
    .from('user_beta_features')
    .select('*')
    .eq('feature_key', FEATURE_KEY)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not load beta settings.');
  return (data as BetaFeatureRow | null) || null;
}

async function loadFallbackWhatsappNumber(adminClient: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data, error } = await adminClient
    .from('attendee_profiles')
    .select('whatsapp_number')
    .eq('user_id', userId)
    .not('whatsapp_number', 'is', null)
    .limit(1);
  if (error) throw new Error(error.message || 'Could not load fallback WhatsApp number.');
  const value = normalizeText(data?.[0]?.whatsapp_number || '');
  return value || null;
}

async function callWorkerApi(params: {
  workerBaseUrl: string;
  workerApiKey: string;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}) {
  const target = `${params.workerBaseUrl.replace(/\/$/, '')}${params.path}`;
  const response = await fetch(target, {
    method: params.method,
    headers: {
      Authorization: `Bearer ${params.workerApiKey}`,
      'Content-Type': 'application/json',
    },
    body: params.method === 'POST' ? JSON.stringify(params.body || {}) : undefined,
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof parsed?.error === 'string' ? parsed.error : `Worker API request failed (${response.status})`;
    return { ok: false as const, status: response.status, error: message, payload: parsed };
  }
  return { ok: true as const, payload: parsed };
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
    const workerBaseUrl = Deno.env.get('WORKER_SOCIAL_API_BASE_URL') || Deno.env.get('LALO_WORKER_SOCIAL_API_BASE_URL');
    const workerApiKey = Deno.env.get('WORKER_SOCIAL_API_KEY') || Deno.env.get('LALO_WORKER_SOCIAL_API_KEY');
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error('Supabase credentials are not configured for host-whatsapp-connect.');
    }
    if (!workerBaseUrl || !workerApiKey) {
      throw new Error('Worker social API credentials are not configured for host-whatsapp-connect.');
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const body = asRecord(await req.json().catch(() => ({})));
    const action = normalizeText(typeof body.action === 'string' ? body.action : '');
    const helperLabel = toHelperLabel(user.id);
    const beta = await loadBetaFeature(adminClient, user.id);

    if (action === 'betaStatus') {
      return json({
        enabled: beta?.enabled === true,
        featureKey: FEATURE_KEY,
        phoneNumberMasked: maskPhoneNumber(beta?.whatsapp_test_number || null),
        hasWhatsAppTestNumber: Boolean(normalizeText(beta?.whatsapp_test_number || '')),
        updatedAt: beta?.updated_at || null,
      });
    }

    if (!beta?.enabled) {
      return json({ error: 'You are not enabled for this beta feature.' }, { status: 403 });
    }

    if (action === 'start') {
      const fallback = await loadFallbackWhatsappNumber(adminClient, user.id);
      const phoneNumberE164 = normalizeText(beta.whatsapp_test_number || fallback || '');
      if (!/^\+[1-9]\d{6,14}$/.test(phoneNumberE164)) {
        return json(
          { error: 'No valid test WhatsApp number is configured. Ask admin to set your beta WhatsApp number.' },
          { status: 400 },
        );
      }

      const worker = await callWorkerApi({
        workerBaseUrl,
        workerApiKey,
        method: 'POST',
        path: '/api/workers/social/session/start',
        body: { helperLabel, phoneNumberE164 },
      });
      if (!worker.ok) {
        return json({ error: worker.error, workerStatus: worker.status }, { status: 502 });
      }
      return json({
        ...worker.payload,
        phoneNumberMasked: maskPhoneNumber(phoneNumberE164),
      });
    }

    if (action === 'status') {
      const worker = await callWorkerApi({
        workerBaseUrl,
        workerApiKey,
        method: 'GET',
        path: `/api/workers/social/session/status?helperLabel=${encodeURIComponent(helperLabel)}`,
      });
      if (!worker.ok) {
        return json({ error: worker.error, workerStatus: worker.status }, { status: 502 });
      }
      return json(worker.payload);
    }

    if (action === 'code') {
      const worker = await callWorkerApi({
        workerBaseUrl,
        workerApiKey,
        method: 'GET',
        path: `/api/workers/social/session/code?helperLabel=${encodeURIComponent(helperLabel)}`,
      });
      if (!worker.ok) {
        const status = worker.status === 409 ? 409 : 502;
        return json({ error: worker.error, workerStatus: worker.status, flowState: worker.payload?.flowState || null }, { status });
      }
      return json(worker.payload);
    }

    return json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected host-whatsapp-connect error.';
    console.error('[host-whatsapp-connect] error', message);
    return json({ error: message }, { status: 500 });
  }
});
