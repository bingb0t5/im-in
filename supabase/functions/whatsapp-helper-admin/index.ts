import { createClient } from 'npm:@supabase/supabase-js@2';

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

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseEmailAllowlist(raw?: string | null) {
  return (raw || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
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

async function getPrimaryHelperAccount(adminClient: ReturnType<typeof createClient>) {
  const { data, error } = await adminClient
    .from('whatsapp_helper_accounts')
    .select('*')
    .eq('label', 'primary-helper')
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Could not load helper account.');
  }

  if (data) {
    return data;
  }

  const { data: inserted, error: insertError } = await adminClient
    .from('whatsapp_helper_accounts')
    .insert({
      label: 'primary-helper',
      status: 'offline',
      session_required: false,
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    throw new Error(insertError?.message || 'Could not create helper account.');
  }

  return inserted;
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
      throw new Error('Supabase credentials are not configured for whatsapp-helper-admin.');
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    const allowlist = parseEmailAllowlist(
      Deno.env.get('WHATSAPP_HELPER_ADMIN_EMAILS')
      || Deno.env.get('FEEDBACK_ADMIN_EMAILS')
      || Deno.env.get('MODERATION_ADMIN_EMAILS'),
    );
    const email = normalizeText(user.email).toLowerCase();
    if (!email || !allowlist.includes(email)) {
      return json({ error: 'Not authorized to use whatsapp helper admin.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = normalizeText(body?.action) || 'status';
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const helperAccount = await getPrimaryHelperAccount(adminClient);

    if (action === 'mark_reauth_required') {
      const { data: updatedHelper, error: updateError } = await adminClient
        .from('whatsapp_helper_accounts')
        .update({
          status: 'offline',
          session_required: true,
          last_health_state: 'offline',
          last_health_reason: 'MANUAL_REAUTH_REQUESTED',
          last_health_checked_at: new Date().toISOString(),
        })
        .eq('id', helperAccount.id)
        .select('*')
        .single();

      if (updateError || !updatedHelper) {
        throw new Error(updateError?.message || 'Could not mark helper as re-auth required.');
      }

      return json({ ok: true, helperAccount: updatedHelper });
    }

    if (action === 'clear_reauth_required') {
      const { data: updatedHelper, error: updateError } = await adminClient
        .from('whatsapp_helper_accounts')
        .update({
          session_required: false,
          last_health_reason: null,
        })
        .eq('id', helperAccount.id)
        .select('*')
        .single();

      if (updateError || !updatedHelper) {
        throw new Error(updateError?.message || 'Could not clear re-auth flag.');
      }

      return json({ ok: true, helperAccount: updatedHelper });
    }

    const { data: groups, error: groupsError } = await adminClient
      .from('event_whatsapp_groups')
      .select('*')
      .eq('helper_account_id', helperAccount.id)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (groupsError) {
      throw new Error(groupsError.message || 'Could not load event WhatsApp groups.');
    }

    const { data: joinJobs, error: joinJobsError } = await adminClient
      .from('whatsapp_join_jobs')
      .select('*')
      .eq('helper_account_id', helperAccount.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (joinJobsError) {
      throw new Error(joinJobsError.message || 'Could not load join jobs.');
    }

    const { data: sendJobs, error: sendJobsError } = await adminClient
      .from('whatsapp_send_jobs')
      .select('*')
      .eq('helper_account_id', helperAccount.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (sendJobsError) {
      throw new Error(sendJobsError.message || 'Could not load send jobs.');
    }

    return json({
      ok: true,
      helperAccount,
      groups: groups || [],
      joinJobs: joinJobs || [],
      sendJobs: sendJobs || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected whatsapp-helper-admin failure.';
    return json({ error: message }, { status: 500 });
  }
});
