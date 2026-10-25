/* AETHER Siaga service worker — delivers citizen emergency alarms while the
 * portal is closed (Web Push), and opens the red alarm screen on tap.
 * Plain JS served as-is from /public (never bundled), scope "/".
 *
 * Deliberately does no offline caching of pages or API responses: a stale
 * cached status during an emergency is worse than an honest "no signal".
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { title: 'PERINGATAN DARURAT', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'PERINGATAN DARURAT';
  const url = data.url || '/';

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || 'Buka untuk melihat langkah penyelamatan.',
        icon: '/icons/icon-192.png?v=2',
        badge: '/icons/badge-96.png',
        // Level-coloured banner (Siaga orange, Awas red) in the expanded notification.
        image: data.image || (data.level ? `/icons/alert-${data.level}.png` : '/icons/alert-awas.png'),
        tag: data.alertId ? `aether-alert-${data.alertId}` : 'aether-alert',
        renotify: true,
        requireInteraction: true,
        vibrate: [600, 250, 600, 250, 600, 250, 1000],
        data: { url },
        actions: [{ action: 'open', title: 'Buka langkah penyelamatan' }],
      });

      // Any portal tab already open shows the red screen immediately
      // instead of waiting for its next poll.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({ type: 'aether-alert', alertId: data.alertId || null });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          try {
            await client.navigate(url);
          } catch (error) {
            // navigate() fails for uncontrolled clients — focusing is still useful.
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
