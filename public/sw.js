// Service worker för webbnotiser: visar notisen och öppnar appen vid klick.
self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { title: 'OMX Analys', body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(m.title || 'OMX Analys', {
    body: m.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: m.tag, renotify: !!m.tag, data: { url: m.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.url.startsWith(self.location.origin)) { await w.focus(); return w.navigate(url); }
    return clients.openWindow(url);
  })());
});
