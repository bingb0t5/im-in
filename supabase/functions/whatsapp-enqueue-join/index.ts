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

function isSupportedInviteUrl(inviteUrl: string) {
  try {
    const parsed = new URL(inviteUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'chat.whatsapp.com') {
      return true;
    }
    if (hostname === 'www.whatsapp.com' || hostname === 'whatsapp.com') {
      return parsed.pathname.toLowerCase().includes('accept');
    }
    return false;
  } catch {
    return false;
  }
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

async function isEventHost(
  adminClient: ReturnType<typeof createClient>,
  eventId: string,
  userId: string,
) {
  const { data: ownedEvent, error: ownedEventError } = await adminClient
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('host_user_id', userId)
    .maybeSingle();

  if (ownedEventError) {
    throw new Error(ownedEventError.message || 'Could not verify event ownership.');
  }

  if (ownedEvent?.id) {
    return true;
  }

  const { data: hostLink, error: hostLinkError } = await adminClient
    .from('event_hosts')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();

  if (hostLinkError) {
    throw new Error(hostLinkError.message || 'Could not verify host access.');
  }

  return Boolean(hostLink?.id);
}

type HelperAccountRow = {
  id: string;
  label: string;
};

type EventWhatsAppGroupRow = {
  id: string;
  helper_account_id: string;
  event_id: string;
};

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
      throw new Error('Supabase credentials are not configured for whatsapp-enqueue-join.');
    }

    const user = await getRequiredUser(supabaseUrl, supabaseAnonKey, req.headers.get('Authorization'));
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const allowlist = parseEmailAllowlist(
      Deno.env.get('WHATSAPP_HELPER_ADMIN_EMAILS')
      || Deno.env.get('FEEDBACK_ADMIN_EMAILS')
      || Deno.env.get('MODERATION_ADMIN_EMAILS'),
    );
    const userEmail = normalizeText(user.email).toLowerCase();
    const isAdmin = !!userEmail && allowlist.includes(userEmail);

    const body = await req.json().catch(() => ({}));
    const eventId = normalizeText(body?.eventId);
    const inviteUrl = normalizeText(body?.inviteUrl);
    if (!eventId || !inviteUrl) {
      return json({ error: 'eventId and inviteUrl are required.' }, { status: 400 });
    }

    if (!isSupportedInviteUrl(inviteUrl)) {
      return json({ error: 'inviteUrl is not a supported WhatsApp group invite link.' }, { status: 400 });
    }

    if (!isAdmin) {
      const canHost = await isEventHost(adminClient, eventId, user.id);
      if (!canHost) {
        return json({ error: 'Not authorized to enqueue WhatsApp joins for this event.' }, { status: 403 });
      }
    }

    const { data: helperAccount, error: helperAccountError } = await adminClient
      .from('whatsapp_helper_accounts')
      .select('id, label')
      .eq('label', 'primary-helper')
      .maybeSingle<HelperAccountRow>();

    if (helperAccountError) {
      throw new Error(helperAccountError.message || 'Could not load helper account.');
    }

    let helperAccountId = helperAccount?.id;
    if (!helperAccountId) {
      const { data: insertedAccount, error: insertAccountError } = await adminClient
        .from('whatsapp_helper_accounts')
        .insert({
          label: 'primary-helper',
          status: 'offline',
          session_required: false,
        })
        .select('id')
        .single<{ id: string }>();

      if (insertAccountError || !insertedAccount?.id) {
        throw new Error(insertAccountError?.message || 'Could not create helper account.');
      }
      helperAccountId = insertedAccount.id;
    }

    const { data: groupRecord, error: groupError } = await adminClient
      .from('event_whatsapp_groups')
      .upsert(
        {
          event_id: eventId,
          helper_account_id: helperAccountId,
          invite_url: inviteUrl,
          join_status: 'pending_join',
          last_error_code: null,
        },
        {
          onConflict: 'event_id,helper_account_id',
        },
      )
      .select('id, helper_account_id, event_id')
      .single<EventWhatsAppGroupRow>();

    if (groupError || !groupRecord?.id) {
      throw new Error(groupError?.message || 'Could not upsert event WhatsApp group mapping.');
    }

    const { data: joinJob, error: joinJobError } = await adminClient
      .from('whatsapp_join_jobs')
      .insert({
        helper_account_id: groupRecord.helper_account_id,
        event_whatsapp_group_id: groupRecord.id,
        invite_url: inviteUrl,
        status: 'queued',
      })
      .select('id')
      .single<{ id: string }>();

    if (joinJobError || !joinJob?.id) {
      throw new Error(joinJobError?.message || 'Could not create WhatsApp join job.');
    }

    return json({
      ok: true,
      eventWhatsAppGroupId: groupRecord.id,
      joinJobId: joinJob.id,
      helperAccountId: groupRecord.helper_account_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected whatsapp-enqueue-join failure.';
    return json({ error: message }, { status: 500 });
  }
});
