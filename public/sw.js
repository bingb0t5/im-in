self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = null;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'New notification',
      body: event.data.text(),
    };
  }

  const title = payload?.title || 'New notification';
  const options = {
    body: payload?.body || '',
    icon: payload?.icon || '/icons/icon-192.svg',
    badge: payload?.badge || '/icons/icon-192.svg',
    tag: payload?.tag || payload?.notificationId || undefined,
    data: {
      actionUrl: payload?.actionUrl || null,
      notificationId: payload?.notificationId || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const actionUrl = event.notification?.data?.actionUrl || '/my-activities';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client && new URL(client.url).pathname === new URL(actionUrl, self.location.origin).pathname) {
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
