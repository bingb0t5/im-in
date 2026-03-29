import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedJobTypes = new Set([
  'send_test',
  'send_disclosure',
  'send_manual_post',
  'send_capacity_update',
]);

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

type EventWhatsAppGroupRow = {
  id: string;
  helper_account_id: string;
  event_id: string;
  join_status: string;
  group_name_exact: string | null;
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
      throw new Error('Supabase credentials are not configured for whatsapp-enqueue-send.');
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
    const eventWhatsAppGroupId = normalizeText(body?.eventWhatsAppGroupId);
    const jobType = normalizeText(body?.jobType);
    const payload = typeof body?.payload === 'object' && body?.payload !== null ? body.payload : {};

    if (!jobType || !allowedJobTypes.has(jobType)) {
      return json({ error: 'jobType is required and must be a supported send type.' }, { status: 400 });
    }

    if (!eventId && !eventWhatsAppGroupId) {
      return json({ error: 'eventId or eventWhatsAppGroupId is required.' }, { status: 400 });
    }

    let groupQuery = adminClient
      .from('event_whatsapp_groups')
      .select('id, helper_account_id, event_id, join_status, group_name_exact');

    if (eventWhatsAppGroupId) {
      groupQuery = groupQuery.eq('id', eventWhatsAppGroupId);
    } else {
      groupQuery = groupQuery.eq('event_id', eventId);
    }

    const { data: groupRowData, error: groupRowError } = await groupQuery.maybeSingle<EventWhatsAppGroupRow>();
    if (groupRowError) {
      throw new Error(groupRowError.message || 'Could not load event WhatsApp group mapping.');
    }
    if (!groupRowData?.id) {
      return json({ error: 'No WhatsApp group mapping found for this event.' }, { status: 404 });
    }

    if (!isAdmin) {
      const canHost = await isEventHost(adminClient, groupRowData.event_id, user.id);
      if (!canHost) {
        return json({ error: 'Not authorized to enqueue WhatsApp sends for this event.' }, { status: 403 });
      }
    }

    if (!groupRowData.group_name_exact || groupRowData.join_status !== 'joined') {
      return json({ error: 'WhatsApp group has not been joined yet.' }, { status: 409 });
    }

    const { data: sendJob, error: sendJobError } = await adminClient
      .from('whatsapp_send_jobs')
      .insert({
        helper_account_id: groupRowData.helper_account_id,
        event_whatsapp_group_id: groupRowData.id,
        job_type: jobType,
        payload_json: payload,
        status: 'queued',
      })
      .select('id')
      .single<{ id: string }>();

    if (sendJobError || !sendJob?.id) {
      throw new Error(sendJobError?.message || 'Could not create WhatsApp send job.');
    }

    return json({
      ok: true,
      sendJobId: sendJob.id,
      eventWhatsAppGroupId: groupRowData.id,
      groupNameExact: groupRowData.group_name_exact,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected whatsapp-enqueue-send failure.';
    return json({ error: message }, { status: 500 });
  }
});
