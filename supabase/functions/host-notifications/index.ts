import { createClient } from 'npm:@supabase/supabase-js@2';

type NotificationEventType = 'request_to_view' | 'request_to_join';
type DeliveryStatus = 'pending' | 'sent' | 'skipped' | 'failed';

type DeliveryRow = {
  id: string;
  recipient_user_id: string;
};

type RequestToViewPayload = {
  id: string;
  event_id: string;
  requester_name: string;
  requester_whatsapp: string;
  requester_note: string | null;
  created_at: string;
  events: {
    id: string;
    title: string;
    slug: string;
    starts_at: string;
    timezone: string | null;
  } | null;
};

type RequestToJoinPayload = {
  id: string;
  event_id: string;
  guest_name: string;
  guest_email: string;
  request_note: string | null;
  created_at: string;
  events: {
    id: string;
    title: string;
    slug: string;
    starts_at: string;
    timezone: string | null;
  } | null;
};

type PreferenceRow = {
  user_id: string;
  email_on_request_to_view: boolean;
  email_on_request_to_join: boolean;
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
  return (value || '').replace(/\s+/g, ' ').trim();
}

function isDeliverableEmail(value: string | null | undefined) {
  const email = normalizeText(value).toLowerCase();
  if (!email) return false;
  if (!email.includes('@')) return false;
  if (email.endsWith('@guest.im-in.local')) return false;
  if (email.endsWith('@proxy.im-in.local')) return false;
  return true;
}

async function sendViaResend({
  apiKey,
  fromEmail,
  toEmail,
  subject,
  html,
  text,
}: {
  apiKey: string | null;
  fromEmail: string | null;
  toEmail: string;
  subject: string;
  html: string;
  text: string;
}) {
  if (!apiKey || !fromEmail) {
    throw new Error('Email provider is not configured (missing RESEND_API_KEY or HOST_NOTIFICATIONS_FROM_EMAIL).');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend failed: ${response.status} ${body}`);
  }

  const result = await response.json();
  return typeof result?.id === 'string' ? result.id : null;
}

function formatActivityStart(startsAt: string, timezone?: string | null) {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return startsAt;

  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function buildContentForRequestToView(payload: RequestToViewPayload, appUrl: string) {
  const event = payload.events;
  const hostDashboardUrl = appUrl ? `${appUrl}/host/events/${payload.event_id}` : '';
  const publicEventUrl = event?.slug && appUrl ? `${appUrl}/events/${event.slug}` : '';
  const startsAt = event?.starts_at ? formatActivityStart(event.starts_at, event?.timezone) : 'Unknown time';
  const title = event?.title || 'Your activity';
  const note = normalizeText(payload.requester_note) || 'None';

  const subject = `New request to view: ${title}`;
  const text = [
    `Someone requested to view your activity "${title}".`,
    '',
    `Name: ${payload.requester_name}`,
    `WhatsApp: ${payload.requester_whatsapp}`,
    `Note: ${note}`,
    `Activity time: ${startsAt}`,
    publicEventUrl ? `Public link: ${publicEventUrl}` : '',
    hostDashboardUrl ? `Host dashboard: ${hostDashboardUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <p>Someone requested to view your activity <strong>${title}</strong>.</p>
    <p><strong>Name:</strong> ${payload.requester_name}<br />
    <strong>WhatsApp:</strong> ${payload.requester_whatsapp}<br />
    <strong>Note:</strong> ${note}<br />
    <strong>Activity time:</strong> ${startsAt}</p>
    ${publicEventUrl ? `<p><a href="${publicEventUrl}">View public activity page</a></p>` : ''}
    ${hostDashboardUrl ? `<p><a href="${hostDashboardUrl}">Open host dashboard</a></p>` : ''}
  `.trim();

  return { subject, text, html };
}

function buildContentForRequestToJoin(payload: RequestToJoinPayload, appUrl: string) {
  const event = payload.events;
  const hostDashboardUrl = appUrl ? `${appUrl}/host/events/${payload.event_id}` : '';
  const publicEventUrl = event?.slug && appUrl ? `${appUrl}/events/${event.slug}` : '';
  const startsAt = event?.starts_at ? formatActivityStart(event.starts_at, event?.timezone) : 'Unknown time';
  const title = event?.title || 'Your activity';
  const note = normalizeText(payload.request_note) || 'None';

  const subject = `New request to join: ${title}`;
  const text = [
    `Someone requested to join your activity "${title}".`,
    '',
    `Name: ${payload.guest_name}`,
    `Email: ${payload.guest_email}`,
    `Request note: ${note}`,
    `Activity time: ${startsAt}`,
    publicEventUrl ? `Public link: ${publicEventUrl}` : '',
    hostDashboardUrl ? `Host dashboard: ${hostDashboardUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <p>Someone requested to join your activity <strong>${title}</strong>.</p>
    <p><strong>Name:</strong> ${payload.guest_name}<br />
    <strong>Email:</strong> ${payload.guest_email}<br />
    <strong>Request note:</strong> ${note}<br />
    <strong>Activity time:</strong> ${startsAt}</p>
    ${publicEventUrl ? `<p><a href="${publicEventUrl}">View public activity page</a></p>` : ''}
    ${hostDashboardUrl ? `<p><a href="${hostDashboardUrl}">Open host dashboard</a></p>` : ''}
  `.trim();

  return { subject, text, html };
}

async function markDelivery({
  adminClient,
  deliveryId,
  status,
  recipientEmail,
  providerMessageId,
  errorMessage,
}: {
  adminClient: ReturnType<typeof createClient>;
  deliveryId: string;
  status: DeliveryStatus;
  recipientEmail?: string | null;
  providerMessageId?: string | null;
  errorMessage?: string | null;
}) {
  await adminClient
    .from('host_notification_deliveries')
    .update({
      status,
      recipient_email: recipientEmail || null,
      provider_message_id: providerMessageId || null,
      error_message: errorMessage || null,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deliveryId);
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
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Supabase credentials are not configured for host notifications.');
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const body = await req.json().catch(() => ({}));
    const eventType = body?.eventType as NotificationEventType | undefined;
    const requestId = normalizeText(body?.requestId);
    if (!requestId || (eventType !== 'request_to_view' && eventType !== 'request_to_join')) {
      return json({ error: 'eventType and requestId are required.' }, { status: 400 });
    }

    const { data: deliveriesData, error: deliveriesError } = await adminClient
      .from('host_notification_deliveries')
      .select('id, recipient_user_id')
      .eq('event_type', eventType)
      .eq('source_request_id', requestId)
      .eq('status', 'pending');

    if (deliveriesError) {
      throw new Error(deliveriesError.message || 'Could not load pending notifications.');
    }

    const deliveries = (deliveriesData || []) as DeliveryRow[];
    if (deliveries.length === 0) {
      return json({ ok: true, processed: 0, message: 'No pending host notifications.' });
    }

    const recipientIds = Array.from(new Set(deliveries.map((row) => row.recipient_user_id).filter(Boolean)));
    const { data: prefsData } = await adminClient
      .from('host_notification_preferences')
      .select('user_id, email_on_request_to_view, email_on_request_to_join')
      .in('user_id', recipientIds);

    const prefsByUserId = new Map<string, PreferenceRow>();
    (prefsData || []).forEach((row) => {
      prefsByUserId.set(row.user_id, row as PreferenceRow);
    });

    let viewPayload: RequestToViewPayload | null = null;
    let joinPayload: RequestToJoinPayload | null = null;

    if (eventType === 'request_to_view') {
      const { data, error } = await adminClient
        .from('event_access_requests')
        .select('id, event_id, requester_name, requester_whatsapp, requester_note, created_at, events(id, title, slug, starts_at, timezone)')
        .eq('id', requestId)
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Could not load access request payload.');
      }
      viewPayload = data as unknown as RequestToViewPayload;
    } else {
      const { data, error } = await adminClient
        .from('event_join_requests')
        .select('id, event_id, guest_name, guest_email, request_note, created_at, events(id, title, slug, starts_at, timezone)')
        .eq('id', requestId)
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Could not load join request payload.');
      }
      joinPayload = data as unknown as RequestToJoinPayload;
    }

    const appUrlRaw = Deno.env.get('APP_URL') || Deno.env.get('VITE_APP_URL') || '';
    const appUrl = appUrlRaw.trim().replace(/\/+$/, '');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('HOST_NOTIFICATIONS_FROM_EMAIL');

    let processed = 0;
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      processed += 1;

      const userPrefs = prefsByUserId.get(delivery.recipient_user_id);
      const enabled = eventType === 'request_to_view'
        ? userPrefs?.email_on_request_to_view ?? true
        : userPrefs?.email_on_request_to_join ?? true;

      if (!enabled) {
        skipped += 1;
        await markDelivery({
          adminClient,
          deliveryId: delivery.id,
          status: 'skipped',
          errorMessage: 'disabled_by_host_preference',
        });
        continue;
      }

      const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(delivery.recipient_user_id);
      if (userError || !userData?.user || !isDeliverableEmail(userData.user.email)) {
        skipped += 1;
        await markDelivery({
          adminClient,
          deliveryId: delivery.id,
          status: 'skipped',
          errorMessage: userError?.message || 'missing_or_invalid_recipient_email',
        });
        continue;
      }

      const recipientEmail = normalizeText(userData.user.email).toLowerCase();

      try {
        const content = eventType === 'request_to_view' && viewPayload
          ? buildContentForRequestToView(viewPayload, appUrl)
          : buildContentForRequestToJoin(joinPayload as RequestToJoinPayload, appUrl);

        const providerMessageId = await sendViaResend({
          apiKey: resendApiKey,
          fromEmail,
          toEmail: recipientEmail,
          subject: content.subject,
          html: content.html,
          text: content.text,
        });

        sent += 1;
        await markDelivery({
          adminClient,
          deliveryId: delivery.id,
          status: 'sent',
          recipientEmail,
          providerMessageId,
        });
      } catch (sendError) {
        failed += 1;
        await markDelivery({
          adminClient,
          deliveryId: delivery.id,
          status: 'failed',
          recipientEmail,
          errorMessage: sendError instanceof Error ? sendError.message : 'Email send failed.',
        });
      }
    }

    return json({
      ok: true,
      processed,
      sent,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('host-notifications error', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error.' }, { status: 500 });
  }
});
