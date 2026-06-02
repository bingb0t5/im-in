import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push';
import {
  appendDeliveryTrace,
  buildPushIdempotencyKey,
  evaluatePushDispatch,
  hashPushEndpoint,
  logPushDispatchDecision,
  resolveWebPushOptions,
  selectActivePushSubscriptions,
  type DeliveryTraceEntry,
} from '../_shared/pushNotificationPolicy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-dispatch-secret',
};

type QueueRow = {
  id: number;
  notification_id: string;
  recipient_user_id: string;
  attempts: number;
  delivery_trace?: DeliveryTraceEntry[] | null;
};

type NotificationRow = {
  id: string;
  recipient_user_id: string;
  type: string;
  title: string;
  message: string;
  action_url: string | null;
  event_id: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  status: string | null;
  ends_at: string | null;
  starts_at: string;
  duration_minutes: number | null;
};

type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  revoked_at: string | null;
  last_seen_at: string;
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

function resolveEventEndsAt(event: EventRow | null): string | null {
  if (!event) return null;
  if (event.ends_at) return event.ends_at;

  const startsMs = Date.parse(event.starts_at);
  if (!Number.isFinite(startsMs)) return null;

  const durationMinutes = Number.isFinite(event.duration_minutes) ? Number(event.duration_minutes) : 60;
  return new Date(startsMs + durationMinutes * 60 * 1000).toISOString();
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

async function requeueStaleJobs(admin: ReturnType<typeof buildAdminClient>) {
  const { error } = await admin.rpc('requeue_stale_push_dispatch_jobs');
  if (error) {
    console.warn('[push:dispatch] Could not requeue stale jobs:', error.message);
  }
}

async function skipQueueRow(
  admin: ReturnType<typeof buildAdminClient>,
  row: QueueRow,
  reason: string,
  skipCode: string,
  deliveryTrace?: DeliveryTraceEntry[],
) {
  const nowIso = new Date().toISOString();
  await admin
    .from('push_dispatch_queue')
    .update({
      status: 'skipped',
      attempts: row.attempts + 1,
      last_error: reason,
      processed_at: nowIso,
      dispatch_failed_at: nowIso,
      delivery_trace: deliveryTrace || row.delivery_trace || [],
    })
    .eq('id', row.id);

  logPushDispatchDecision({
    action: 'skipped',
    reason: skipCode,
    correlationId: row.notification_id,
    queueId: row.id,
    notificationId: row.notification_id,
    recipientUserId: row.recipient_user_id,
  });

  return { status: 'skipped', sentCount: 0, skipped: skipCode };
}

async function processQueueRow(admin: ReturnType<typeof buildAdminClient>, row: QueueRow) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  let deliveryTrace = Array.isArray(row.delivery_trace) ? [...row.delivery_trace] : [];

  await admin
    .from('push_dispatch_queue')
    .update({
      dispatch_attempted_at: nowIso,
      delivery_trace: deliveryTrace,
    })
    .eq('id', row.id);

  const { data: notification, error: notificationError } = await admin
    .from('notifications')
    .select('id, recipient_user_id, type, title, message, action_url, event_id, created_at')
    .eq('id', row.notification_id)
    .maybeSingle<NotificationRow>();

  if (notificationError) {
    throw new Error(notificationError.message);
  }

  if (!notification) {
    return skipQueueRow(admin, row, 'Notification no longer exists.', 'notification_missing', deliveryTrace);
  }

  let eventStatus: string | null = null;
  let eventEndsAt: string | null = null;

  if (notification.event_id) {
    const { data: event, error: eventError } = await admin
      .from('events')
      .select('id, status, ends_at, starts_at, duration_minutes')
      .eq('id', notification.event_id)
      .maybeSingle<EventRow>();

    if (eventError) throw new Error(eventError.message);

    if (!event) {
      return skipQueueRow(admin, row, 'Activity no longer exists.', 'event_missing', deliveryTrace);
    }

    eventStatus = event.status;
    eventEndsAt = resolveEventEndsAt(event);
  }

  const deliveryDecision = evaluatePushDispatch({
    notificationId: notification.id,
    createdAt: notification.created_at,
    eventId: notification.event_id,
    eventStatus,
    eventEndsAt,
    nowMs,
  });

  if (deliveryDecision.action === 'skip') {
    const skipMessages: Record<string, string> = {
      missing_idempotency_key: 'Notification is missing an idempotency key.',
      stale: 'Notification is stale and should not be pushed.',
      event_past: 'Activity has already ended.',
      event_cancelled: 'Activity was cancelled.',
      event_missing: 'Activity no longer exists.',
    };

    return skipQueueRow(
      admin,
      row,
      skipMessages[deliveryDecision.reason] || 'Notification skipped by delivery policy.',
      deliveryDecision.reason,
      deliveryTrace,
    );
  }

  const { data: hasWhatsappLinkRows, error: linkError } = await admin
    .from('attendee_profiles')
    .select('id')
    .eq('user_id', notification.recipient_user_id)
    .not('lalo_user_id', 'is', null)
    .limit(1);

  if (linkError) throw new Error(linkError.message);

  if (!hasWhatsappLinkRows || hasWhatsappLinkRows.length === 0) {
    return skipQueueRow(admin, row, 'Recipient is not WhatsApp linked.', 'missing_whatsapp_link', deliveryTrace);
  }

  const { data: pushEnabled, error: prefError } = await admin.rpc('is_push_enabled_for_notification', {
    p_recipient_user_id: notification.recipient_user_id,
    p_notification_type: notification.type,
  });
  if (prefError) throw new Error(prefError.message);

  if (!pushEnabled) {
    return skipQueueRow(admin, row, 'Push disabled for notification category.', 'category_disabled', deliveryTrace);
  }

  const { data: subscriptions, error: subscriptionError } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, revoked_at, last_seen_at')
    .eq('user_id', notification.recipient_user_id)
    .is('revoked_at', null);

  if (subscriptionError) throw new Error(subscriptionError.message);

  const activeSubscriptions = selectActivePushSubscriptions((subscriptions || []) as PushSubscriptionRow[], nowMs);

  if (activeSubscriptions.length === 0) {
    return skipQueueRow(admin, row, 'No active push subscriptions.', 'no_active_subscriptions', deliveryTrace);
  }

  const idempotencyKey = buildPushIdempotencyKey({ notificationId: notification.id })!;
  const webPushOptions = resolveWebPushOptions(notification.type, idempotencyKey);
  const payload = JSON.stringify({
    notificationId: notification.id,
    idempotencyKey,
    correlationId: notification.id,
    createdAt: notification.created_at,
    dispatchedAt: nowIso,
    eventId: notification.event_id,
    eventStatus,
    eventEndsAt,
    title: notification.title,
    body: notification.message,
    actionUrl: notification.action_url || null,
    tag: idempotencyKey,
  });

  logPushDispatchDecision({
    action: 'scheduled',
    correlationId: notification.id,
    queueId: row.id,
    notificationId: notification.id,
    recipientUserId: notification.recipient_user_id,
    idempotencyKey,
    subscriptionCount: activeSubscriptions.length,
    webPushOptions,
    notificationCreatedAt: notification.created_at,
    dispatchLagMs: nowMs - Date.parse(notification.created_at),
  });

  let sentCount = 0;
  let lastError: string | null = null;

  for (const subscription of activeSubscriptions) {
    const endpointHash = await hashPushEndpoint(subscription.endpoint);
    deliveryTrace = appendDeliveryTrace(deliveryTrace, {
      at: nowIso,
      endpointHash,
      status: 'attempted',
    });

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
        {
          TTL: webPushOptions.TTL,
          urgency: webPushOptions.urgency,
          topic: webPushOptions.topic,
        },
      );
      sentCount += 1;
      deliveryTrace = appendDeliveryTrace(deliveryTrace, {
        at: new Date().toISOString(),
        endpointHash,
        status: 'sent',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown push dispatch error.';
      lastError = errorMessage;
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
      deliveryTrace = appendDeliveryTrace(deliveryTrace, {
        at: new Date().toISOString(),
        endpointHash,
        status: 'failed',
        statusCode: statusCode || undefined,
        error: errorMessage,
      });
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
      dispatch_success_at: sentCount > 0 ? nowIso : null,
      dispatch_failed_at: sentCount > 0 ? null : nowIso,
      delivery_trace: deliveryTrace,
    })
    .eq('id', row.id);

  logPushDispatchDecision({
    action: nextStatus,
    correlationId: notification.id,
    queueId: row.id,
    notificationId: notification.id,
    recipientUserId: notification.recipient_user_id,
    idempotencyKey,
    sentCount,
    lastError,
    dispatchLagMs: nowMs - Date.parse(notification.created_at),
  });

  return { status: nextStatus, sentCount, skipped: null };
}

async function processPendingBatch(admin: ReturnType<typeof buildAdminClient>, limit: number) {
  const { data: queueRows, error: queueError } = await admin
    .from('push_dispatch_queue')
    .select('id, notification_id, recipient_user_id, attempts, delivery_trace')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (queueError) {
    throw new Error(queueError.message);
  }

  const jobs = (queueRows || []) as QueueRow[];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of jobs) {
    const { data: claimedRow, error: claimError } = await admin
      .from('push_dispatch_queue')
      .update({ status: 'processing' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id, notification_id, recipient_user_id, attempts, delivery_trace')
      .maybeSingle<QueueRow>();

    if (claimError) {
      throw new Error(claimError.message);
    }

    if (!claimedRow) {
      continue;
    }

    try {
      const result = await processQueueRow(admin, claimedRow);
      if (result.status === 'sent') sent += 1;
      if (result.status === 'skipped') skipped += 1;
      if (result.status === 'failed') failed += 1;
    } catch (error) {
      failed += 1;
      const failedAt = new Date().toISOString();
      await admin
        .from('push_dispatch_queue')
        .update({
          status: 'failed',
          attempts: claimedRow.attempts + 1,
          last_error: error instanceof Error ? error.message : 'Push dispatch failed.',
          processed_at: failedAt,
          dispatch_failed_at: failedAt,
        })
        .eq('id', claimedRow.id);
    }
  }

  return { processed: jobs.length, sent, skipped, failed, hasMore: jobs.length === limit };
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
    await requeueStaleJobs(admin);

    const body = await request.json().catch(() => ({}));
    const limitInput = Number((body as { limit?: number })?.limit || 100);
    const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(100, Math.floor(limitInput))) : 100;
    const maxBatches = 3;

    let totalProcessed = 0;
    let totalSent = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
      const batch = await processPendingBatch(admin, limit);
      totalProcessed += batch.processed;
      totalSent += batch.sent;
      totalSkipped += batch.skipped;
      totalFailed += batch.failed;
      if (!batch.hasMore) break;
    }

    return json({
      ok: true,
      processed: totalProcessed,
      sent: totalSent,
      skipped: totalSkipped,
      failed: totalFailed,
    });
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    const message = error instanceof Error ? error.message : 'Push dispatch failed.';
    return json({ error: message }, { status });
  }
});
