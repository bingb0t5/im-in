import { createClient } from 'npm:@supabase/supabase-js@2';

type BetaFeatureRow = {
  id: string;
  user_id: string;
  feature_key: string;
  enabled: boolean;
  whatsapp_test_number: string | null;
  notes: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

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

function normalizeEmail(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function parseEmailAllowlist(raw?: string | null) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeFeatureKey(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'host_whatsapp_connect';
}

function normalizeWhatsappNumber(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\+[1-9]\d{6,14}$/.test(trimmed)) {
    throw new Error('whatsapp_test_number must be a valid E.164 number');
  }
  return trimmed;
}

function normalizePhoneSearch(value: string) {
  return value.replace(/\D/g, '');
}

function isLikelyPhoneSearch(value: string) {
  const digits = normalizePhoneSearch(value);
  return value.trim().startsWith('+') || digits.length >= 4;
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

async function loadBetaRow(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  featureKey: string,
): Promise<BetaFeatureRow | null> {
  const { data, error } = await adminClient
    .from('user_beta_features')
    .select('*')
    .eq('user_id', userId)
    .eq('feature_key', featureKey)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not load beta feature row.');
  return (data as BetaFeatureRow | null) || null;
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
      throw new Error('Supabase credentials are not configured for beta-feature-admin.');
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    const allowlist = parseEmailAllowlist(Deno.env.get('MODERATION_ADMIN_EMAILS'));
    const email = normalizeEmail(user.email);
    if (!email || !allowlist.includes(email)) {
      return json({ error: 'Not authorized to use beta feature admin.' }, { status: 403 });
    }

    const body = asRecord(await req.json().catch(() => ({})));
    const action = normalizeText(typeof body.action === 'string' ? body.action : '');
    const featureKey = normalizeFeatureKey(body.feature_key ?? body.featureKey);
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    if (action === 'lookup') {
      const query = normalizeText(typeof body.query === 'string' ? body.query : '');
      if (!query) {
        return json({ error: 'query is required.' }, { status: 400 });
      }

      const profileSelect = 'id,user_id,email,full_name,whatsapp_number,whatsapp_verified_at,auth_provider';
      let profileQuery = adminClient
        .from('attendee_profiles')
        .select(profileSelect)
        .limit(25);

      if (query.includes('@')) {
        profileQuery = profileQuery.ilike('email', `%${query.toLowerCase()}%`);
      } else if (isUuid(query)) {
        profileQuery = profileQuery.eq('user_id', query);
      } else if (isLikelyPhoneSearch(query)) {
        const digits = normalizePhoneSearch(query);
        const phoneNeedles = [
          query,
          digits,
          digits.length > 6 ? digits.slice(-6) : '',
          digits.length > 4 ? digits.slice(-4) : '',
        ]
          .map((value) => value.trim())
          .filter(Boolean);
        const phoneFilters = [...new Set(phoneNeedles)]
          .map((needle) => `whatsapp_number.ilike.%${needle}%`)
          .join(',');
        profileQuery = profileQuery.or(phoneFilters);
      } else {
        profileQuery = profileQuery.or(`full_name.ilike.%${query}%,whatsapp_number.ilike.%${query}%`);
      }

      const { data: profiles, error: profilesError } = await profileQuery;
      if (profilesError) throw new Error(profilesError.message || 'Could not search profiles.');

      const userIds = [...new Set((profiles || []).map((row: any) => row.user_id).filter(Boolean))];
      const betaByUserId = new Map<string, BetaFeatureRow>();
      if (userIds.length > 0) {
        const { data: betaRows, error: betaError } = await adminClient
          .from('user_beta_features')
          .select('*')
          .eq('feature_key', featureKey)
          .in('user_id', userIds);
        if (betaError) throw new Error(betaError.message || 'Could not load beta rows.');
        for (const row of (betaRows || []) as BetaFeatureRow[]) {
          betaByUserId.set(row.user_id, row);
        }
      }

      const items = (profiles || []).map((profile: any) => {
        const beta = profile.user_id ? betaByUserId.get(profile.user_id) || null : null;
        return {
          profile,
          beta,
        };
      });
      return json({ items });
    }

    if (action === 'upsert') {
      const userId = normalizeText(typeof body.user_id === 'string' ? body.user_id : typeof body.userId === 'string' ? body.userId : '');
      if (!isUuid(userId)) {
        return json({ error: 'user_id must be a valid UUID.' }, { status: 400 });
      }

      const enabled = body.enabled === true;
      const notes = normalizeText(typeof body.notes === 'string' ? body.notes : '');
      const whatsappTestNumber = normalizeWhatsappNumber(body.whatsapp_test_number ?? body.whatsappTestNumber);

      const { data, error } = await adminClient
        .from('user_beta_features')
        .upsert(
          {
            user_id: userId,
            feature_key: featureKey,
            enabled,
            whatsapp_test_number: whatsappTestNumber,
            notes: notes || null,
            updated_by_user_id: user.id,
          },
          { onConflict: 'user_id,feature_key' },
        )
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message || 'Could not upsert beta settings.');

      return json({ row: data });
    }

    if (action === 'get') {
      const userId = normalizeText(typeof body.user_id === 'string' ? body.user_id : typeof body.userId === 'string' ? body.userId : '');
      if (!isUuid(userId)) {
        return json({ error: 'user_id must be a valid UUID.' }, { status: 400 });
      }
      const row = await loadBetaRow(adminClient, userId, featureKey);
      return json({ row });
    }

    return json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected beta-feature-admin error.';
    console.error('[beta-feature-admin] error', message);
    return json({ error: message }, { status: 500 });
  }
});
