// Service Worker لإشعارات بطاقة الولاء: بيعرض الإشعار، ولما الزبون يكبس عليه بيفتح بطاقته
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || 'نقاطك', {
      body: data.body || '',
      icon: data.icon,
      tag: data.tag,
      dir: 'rtl',
      lang: 'ar',
      data: { url: data.url || '/' },
    });
    // لو البطاقة مفتوحة قدّام الزبون (الآيفون ما بيطلّع الإشعار فوقها): بتتحدّث فوراً وبتعرض الرسالة جوّاها
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) c.postMessage({ type: 'push', title: data.title, body: data.body, url: data.url || '' });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if (c.url === url && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  })());
});
