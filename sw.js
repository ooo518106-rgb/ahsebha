// عامل الخدمة: يشغّل البرنامج بدون إنترنت. الشبكة أولاً دائماً حتى تصل التحديثات فوراً،
// والنسخة المخزنة تُستخدم فقط عند انقطاع الاتصال.
const CACHE = 'ahsebha-accounting-v5';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ahsebha-accounting-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// مشاركة صورة إيصال من تطبيق آخر (واتساب، المعرض) إلى البرنامج المثبّت: نحفظها بنفس قاعدة البيانات
// ونفتح شاشة المصروف لتقرأها (store.takeShared)
function idbPut(key, value) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ahsebha-accounting', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => { r.result.close(); resolve(); };
      tx.onerror = () => { r.result.close(); reject(tx.error); };
    };
  });
}
async function shareTarget(req) {
  const form = await req.formData();
  const files = [];
  for (const f of form.getAll('files')) {
    if (f && typeof f === 'object' && f.size && files.length < 5) files.push({ name: f.name, type: f.type, data: await f.arrayBuffer() });
  }
  if (files.length) await idbPut('shared', { at: Date.now(), files });
  return Response.redirect(new URL(files.length ? './#/expenses/new?shared=1' : './#/', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(shareTarget(req).catch(() => Response.redirect(new URL('./', self.registration.scope).href, 303)));
    return;
  }
  if (req.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (sameOrigin || res.type === 'cors' || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
