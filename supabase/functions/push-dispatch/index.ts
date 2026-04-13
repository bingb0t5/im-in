import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-dispatch-secret',
};

type QueueRow = {
  id: number;
  notification_id: string;
  recipient_user_id: string;
  attempts: number;
};

type NotificationRow = {
  id: string;
  recipient_user_id: string;
  type: string;
  title: string;
  message: string;
  action_url: string | null;
};

type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  revoked_at: string | null;
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

function getEnv(name: string) {
  return (Deno.env.get(name) || '').trim();
}

function assertDispatchSecret(request: Request) {
  const configuredSecret = getEnv('PUSH_DISPATCH_SECRET');
  if (!configuredSecret) {
    throw Object.assign(new Error('PUSH_DISPATCH_SECRET is not configured.'), { status: 500 });
  }

  const providedSecret = request.headers.get('x-push-dispatch-secret') || '';
  if (!providedSecret || providedSecret !== configuredSecret) {
    throw Object.assign(new Error('Unauthorized push dispatch request.'), { status: 401 });
  }
}

function buildAdminClient() {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw Object.assign(new Error('Supabase admin environment is not configured.'), { status: 500 });
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function configureWebPush() {
  const publicKey = getEnv('WEB_PUSH_PUBLIC_KEY');
  const privateKey = getEnv('WEB_PUSH_PRIVATE_KEY');
  const subject = getEnv('WEB_PUSH_SUBJECT') || 'mailto:support@im-in.local';
  if (!publicKey || !privateKey) {
    throw Object.assign(new Error('WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY must be configured.'), { status: 500 });
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

async function markSubscriptionRevoked(admin: ReturnType<typeof buildAdminClient>, endpoint: string) {
  await admin
    .from('push_subscriptions')
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('endpoint', endpoint)
    .is('revoked_at', null);
}

async function processQueueRow(admin: ReturnType<typeof buildAdminClient>, row: QueueRow) {
  const nowIso = new Date().toISOString();

  const { data: notification, error: notificationError } = await admin
    .from('notifications')
    .select('id, recipient_user_id, type, title, message, action_url')
    .eq('id', row.notification_id)
    .maybeSingle<NotificationRow>();

  if (notificationError) {
    throw new Error(notificationError.message);
  }

  if (!notification) {
    await admin
      .from('push_dispatch_queue')
      .update({
        status: 'skipped',
        attempts: row.attempts + 1,
        last_error: 'Notification no longer exists.',
        processed_at: nowIso,
      })
      .eq('id', row.id);
    return { status: 'skipped', sentCount: 0, skipped: 'notification_missing' };
  }

  const { data: hasWhatsappLinkRows, error: linkError } = await admin
    .from('attendee_profiles')
    .select('id')
    .eq('user_id', notification.recipient_user_id)
    .not('lalo_user_id', 'is', null)
    .limit(1);

  if (linkError) throw new Error(linkError.message);

  if (!hasWhatsappLinkRows || hasWhatsappLinkRows.length === 0) {
    await admin
      .from('push_dispatch_queue')
      .update({
        status: 'skipped',
        attempts: row.attempts + 1,
        last_error: 'Recipient is not WhatsApp linked.',
        processed_at: nowIso,
      })
      .eq('id', row.id);
    return { status: 'skipped', sentCount: 0, skipped: 'missing_whatsapp_link' };
  }

  const { data: pushEnabled, error: prefError } = await admin.rpc('is_push_enabled_for_notification', {
    p_recipient_user_id: notification.recipient_user_id,
    p_notification_type: notification.type,
  });
  if (prefError) throw new Error(prefError.message);

  if (!pushEnabled) {
    await admin
      .from('push_dispatch_queue')
      .update({
        status: 'skipped',
        attempts: row.attempts + 1,
        last_error: 'Push disabled for notification category.',
        processed_at: nowIso,
      })
      .eq('id', row.id);
    return { status: 'skipped', sentCount: 0, skipped: 'category_disabled' };
  }

  const { data: subscriptions, error: subscriptionError } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, revoked_at')
    .eq('user_id', notification.recipient_user_id)
    .is('revoked_at', null);

  if (subscriptionError) throw new Error(subscriptionError.message);
  const activeSubscriptions = (subscriptions || []) as PushSubscriptionRow[];

  if (activeSubscriptions.length === 0) {
    await admin
      .from('push_dispatch_queue')
      .update({
        status: 'skipped',
        attempts: row.attempts + 1,
        last_error: 'No active push subscriptions.',
        processed_at: nowIso,
      })
      .eq('id', row.id);
    return { status: 'skipped', sentCount: 0, skipped: 'no_active_subscriptions' };
  }

  const payload = JSON.stringify({
    notificationId: notification.id,
    title: notification.title,
    body: notification.message,
    actionUrl: notification.action_url || null,
    tag: `notification:${notification.id}`,
  });

  let sentCount = 0;
  let lastError: string | null = null;

  for (const subscription of activeSubscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload,
      );
      sentCount += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown push dispatch error.';
      lastError = errorMessage;
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        await markSubscriptionRevoked(admin, subscription.endpoint);
      }
    }
  }

  const nextStatus = sentCount > 0 ? 'sent' : 'failed';
  await admin
    .from('push_dispatch_queue')
    .update({
      status: nextStatus,
      attempts: row.attempts + 1,
      last_error: lastError,
      processed_at: nowIso,
    })
    .eq('id', row.id);

  return { status: nextStatus, sentCount, skipped: null };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, { status: 405 });
  }

  try {
    assertDispatchSecret(request);
    configureWebPush();
    const admin = buildAdminClient();

    const body = await request.json().catch(() => ({}));
    const limitInput = Number((body as { limit?: number })?.limit || 20);
    const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(100, Math.floor(limitInput))) : 20;

    const { data: queueRows, error: queueError } = await admin
      .from('push_dispatch_queue')
      .select('id, notification_id, recipient_user_id, attempts')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(limit);

    if (queueError) {
      throw new Error(queueError.message);
    }

    const jobs = (queueRows || []) as QueueRow[];
    if (jobs.length === 0) {
      return json({ ok: true, processed: 0, sent: 0, skipped: 0, failed: 0 });
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of jobs) {
      await admin
        .from('push_dispatch_queue')
        .update({ status: 'processing' })
        .eq('id', row.id)
        .eq('status', 'pending');

      try {
        const result = await processQueueRow(admin, row);
        if (result.status === 'sent') sent += 1;
        if (result.status === 'skipped') skipped += 1;
        if (result.status === 'failed') failed += 1;
      } catch (error) {
        failed += 1;
        await admin
          .from('push_dispatch_queue')
          .update({
            status: 'failed',
            attempts: row.attempts + 1,
            last_error: error instanceof Error ? error.message : 'Push dispatch failed.',
            processed_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }
    }

    return json({
      ok: true,
      processed: jobs.length,
      sent,
      skipped,
      failed,
    });
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    const message = error instanceof Error ? error.message : 'Push dispatch failed.';
    return json({ error: message }, { status });
  }
});
