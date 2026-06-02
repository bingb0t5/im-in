(function initPushNotificationPolicy(globalScope) {
  var PUSH_MAX_STALENESS_MS = 6 * 60 * 60 * 1000;
  var PUSH_EVENT_END_GRACE_MS = 60 * 60 * 1000;
  var SHOWN_CACHE_NAME = 'im-in-push-shown-v1';
  var RECEIPTS_CACHE_NAME = 'im-in-push-receipts-v1';
  var SHOWN_CACHE_LIMIT = 500;
  var RECEIPTS_CACHE_LIMIT = 100;

  function buildPushIdempotencyKey(input) {
    var explicit = input && input.idempotencyKey ? String(input.idempotencyKey).trim() : '';
    if (explicit) return explicit;

    var notificationId = input && input.notificationId ? String(input.notificationId).trim() : '';
    if (notificationId) return 'notification:' + notificationId;

    return null;
  }

  function isPushNotificationStale(createdAt, nowMs, maxStalenessMs) {
    if (!createdAt || !String(createdAt).trim()) return false;

    var createdMs = Date.parse(String(createdAt));
    if (!Number.isFinite(createdMs)) return false;

    return nowMs - createdMs > (maxStalenessMs || PUSH_MAX_STALENESS_MS);
  }

  function isEventPastForPush(eventEndsAt, nowMs, graceMs) {
    if (!eventEndsAt || !String(eventEndsAt).trim()) return false;

    var endsMs = Date.parse(String(eventEndsAt));
    if (!Number.isFinite(endsMs)) return false;

    return nowMs > endsMs + (graceMs || PUSH_EVENT_END_GRACE_MS);
  }

  function evaluatePushDelivery(input) {
    var payload = input.payload || {};
    var nowMs = input.nowMs;
    var idempotencyKey = buildPushIdempotencyKey(payload);

    if (!idempotencyKey) {
      return { action: 'skip', reason: 'missing_idempotency_key' };
    }

    if (input.alreadyShownKeys && input.alreadyShownKeys.has(idempotencyKey)) {
      return { action: 'skip', reason: 'already_sent' };
    }

    if (isPushNotificationStale(payload.createdAt, nowMs, input.maxStalenessMs)) {
      return { action: 'skip', reason: 'stale' };
    }

    var eventStatus = payload.eventStatus ? String(payload.eventStatus).trim().toLowerCase() : '';
    if (eventStatus === 'cancelled') {
      return { action: 'skip', reason: 'event_cancelled' };
    }

    if (payload.eventId && !payload.eventEndsAt && eventStatus === 'completed') {
      return { action: 'skip', reason: 'event_past' };
    }

    if (payload.eventId && isEventPastForPush(payload.eventEndsAt, nowMs, input.eventEndGraceMs)) {
      return { action: 'skip', reason: 'event_past' };
    }

    return { action: 'deliver' };
  }

  function logPushDecision(stage, details) {
    console.info('[push:' + stage + ']', details);
  }

  function shownCacheUrl(idempotencyKey) {
    return 'https://im-in.local/push-shown/' + encodeURIComponent(idempotencyKey);
  }

  async function loadShownKeys() {
    var cache = await caches.open(SHOWN_CACHE_NAME);
    var keys = await cache.keys();
    var shown = new Set();

    for (var index = 0; index < keys.length; index += 1) {
      var request = keys[index];
      var marker = '/push-shown/';
      var markerIndex = request.url.indexOf(marker);
      if (markerIndex === -1) continue;
      shown.add(decodeURIComponent(request.url.slice(markerIndex + marker.length)));
    }

    return shown;
  }

  async function markShown(idempotencyKey) {
    var cache = await caches.open(SHOWN_CACHE_NAME);
    await cache.put(shownCacheUrl(idempotencyKey), new Response('1', { status: 200 }));

    var keys = await cache.keys();
    if (keys.length <= SHOWN_CACHE_LIMIT) return;

    var overflow = keys.length - SHOWN_CACHE_LIMIT;
    for (var index = 0; index < overflow; index += 1) {
      await cache.delete(keys[index]);
    }
  }

  function receiptCacheUrl(idempotencyKey) {
    return 'https://im-in.local/push-receipt/' + encodeURIComponent(idempotencyKey);
  }

  async function recordPushReceipt(receipt) {
    if (!receipt || !receipt.idempotencyKey) return;

    var cache = await caches.open(RECEIPTS_CACHE_NAME);
    await cache.put(
      receiptCacheUrl(receipt.idempotencyKey),
      new Response(JSON.stringify(receipt), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    var keys = await cache.keys();
    if (keys.length <= RECEIPTS_CACHE_LIMIT) return;

    var overflow = keys.length - RECEIPTS_CACHE_LIMIT;
    for (var index = 0; index < overflow; index += 1) {
      await cache.delete(keys[index]);
    }
  }

  async function loadPendingReceipts() {
    var cache = await caches.open(RECEIPTS_CACHE_NAME);
    var keys = await cache.keys();
    var receipts = [];

    for (var index = 0; index < keys.length; index += 1) {
      var response = await cache.match(keys[index]);
      if (!response) continue;
      try {
        receipts.push(await response.json());
      } catch (error) {
        // Ignore malformed receipt payloads.
      }
    }

    return receipts.sort(function (left, right) {
      return Date.parse(right.receivedAt || 0) - Date.parse(left.receivedAt || 0);
    });
  }

  async function clearReceipt(idempotencyKey) {
    if (!idempotencyKey) return;
    var cache = await caches.open(RECEIPTS_CACHE_NAME);
    await cache.delete(receiptCacheUrl(idempotencyKey));
  }

  globalScope.pushNotificationPolicy = {
    PUSH_MAX_STALENESS_MS: PUSH_MAX_STALENESS_MS,
    PUSH_EVENT_END_GRACE_MS: PUSH_EVENT_END_GRACE_MS,
    RECEIPTS_CACHE_NAME: RECEIPTS_CACHE_NAME,
    buildPushIdempotencyKey: buildPushIdempotencyKey,
    evaluatePushDelivery: evaluatePushDelivery,
    logPushDecision: logPushDecision,
    loadShownKeys: loadShownKeys,
    markShown: markShown,
    recordPushReceipt: recordPushReceipt,
    loadPendingReceipts: loadPendingReceipts,
    clearReceipt: clearReceipt,
  };
})(typeof self !== 'undefined' ? self : globalThis);
