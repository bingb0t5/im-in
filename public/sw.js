importScripts('/push-notification-policy.js');

var pushPolicy = self.pushNotificationPolicy;

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  if (!event.data) return;
  event.waitUntil(handlePushEvent(event));
});

async function recordReceipt(receipt) {
  await pushPolicy.recordPushReceipt(receipt);
  var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (var index = 0; index < clients.length; index += 1) {
    clients[index].postMessage({ type: 'push-receipt', receipt: receipt });
  }
}

async function handlePushEvent(event) {
  var receivedAt = new Date().toISOString();
  var payload = null;

  try {
    payload = event.data.json();
  } catch (error) {
    payload = {
      title: 'New notification',
      body: event.data.text(),
    };
  }

  var nowMs = Date.now();
  var idempotencyKey = pushPolicy.buildPushIdempotencyKey(payload || {});
  var correlationId = (payload && (payload.correlationId || payload.notificationId)) || null;

  pushPolicy.logPushDecision('received', {
    correlationId: correlationId,
    notificationId: payload && payload.notificationId ? payload.notificationId : null,
    idempotencyKey: idempotencyKey,
    receivedAt: receivedAt,
    dispatchedAt: payload && payload.dispatchedAt ? payload.dispatchedAt : null,
    createdAt: payload && payload.createdAt ? payload.createdAt : null,
  });

  var alreadyShownKeys = await pushPolicy.loadShownKeys();
  var decision = pushPolicy.evaluatePushDelivery({
    payload: payload || {},
    nowMs: nowMs,
    alreadyShownKeys: alreadyShownKeys,
  });

  if (decision.action === 'skip') {
    pushPolicy.logPushDecision('display', {
      action: 'skipped',
      reason: decision.reason,
      correlationId: correlationId,
      notificationId: payload && payload.notificationId ? payload.notificationId : null,
      idempotencyKey: idempotencyKey,
    });

    if (payload && payload.notificationId && idempotencyKey) {
      await recordReceipt({
        notificationId: payload.notificationId,
        idempotencyKey: idempotencyKey,
        correlationId: correlationId,
        receivedAt: receivedAt,
        displayedAt: null,
        skipReason: decision.reason,
      });
    }
    return;
  }

  var title = (payload && payload.title) || 'New notification';
  var tag = (payload && payload.tag) || idempotencyKey || undefined;
  var options = {
    body: (payload && payload.body) || '',
    icon: (payload && payload.icon) || '/icons/icon-192.svg',
    badge: (payload && payload.badge) || '/icons/icon-192.svg',
    tag: tag,
    renotify: false,
    data: {
      actionUrl: (payload && payload.actionUrl) || null,
      notificationId: (payload && payload.notificationId) || null,
      idempotencyKey: idempotencyKey,
      correlationId: correlationId,
    },
  };

  var existing = tag ? await self.registration.getNotifications({ tag: tag }) : [];
  if (existing.length > 0) {
    pushPolicy.logPushDecision('display', {
      action: 'skipped',
      reason: 'already_sent',
      correlationId: correlationId,
      notificationId: payload && payload.notificationId ? payload.notificationId : null,
      idempotencyKey: idempotencyKey,
      via: 'getNotifications',
    });

    if (payload && payload.notificationId && idempotencyKey) {
      await recordReceipt({
        notificationId: payload.notificationId,
        idempotencyKey: idempotencyKey,
        correlationId: correlationId,
        receivedAt: receivedAt,
        displayedAt: null,
        skipReason: 'already_sent',
      });
    }
    return;
  }

  await self.registration.showNotification(title, options);

  if (idempotencyKey) {
    await pushPolicy.markShown(idempotencyKey);
  }

  var displayedAt = new Date().toISOString();
  pushPolicy.logPushDecision('display', {
    action: 'sent',
    correlationId: correlationId,
    notificationId: payload && payload.notificationId ? payload.notificationId : null,
    idempotencyKey: idempotencyKey,
    tag: tag,
    receivedAt: receivedAt,
    displayedAt: displayedAt,
  });

  if (payload && payload.notificationId && idempotencyKey) {
    await recordReceipt({
      notificationId: payload.notificationId,
      idempotencyKey: idempotencyKey,
      correlationId: correlationId,
      receivedAt: receivedAt,
      displayedAt: displayedAt,
      skipReason: null,
    });
  }
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var actionUrl = (event.notification && event.notification.data && event.notification.data.actionUrl) || '/my-activities';

  pushPolicy.logPushDecision('clicked', {
    correlationId: event.notification && event.notification.data ? event.notification.data.correlationId : null,
    notificationId: event.notification && event.notification.data ? event.notification.data.notificationId : null,
    idempotencyKey: event.notification && event.notification.data ? event.notification.data.idempotencyKey : null,
    actionUrl: actionUrl,
  });

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var index = 0; index < clientList.length; index += 1) {
        var client = clientList[index];
        if (
          'focus' in client
          && new URL(client.url).pathname === new URL(actionUrl, self.location.origin).pathname
        ) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(actionUrl);
      }

      return null;
    }),
  );
});
