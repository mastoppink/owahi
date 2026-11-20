'use strict';
/* Service worker Lapis: HTML/JS/CSS selalu dicek ke server dulu (versi baru langsung tampil, walau
   GitHub Pages memberi cache 10 menit), cadangan dari cache saat offline. Model AI besar: cache dulu. */
const CACHE = 'lapis-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  if (/\.(onnx|bin)$/.test(url.pathname)) { // file model besar: jarang berubah
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  e.respondWith((async () => {
    try {
      const r = await fetch(req, { cache: 'no-cache' }); // revalidasi (ETag) → cepat bila tidak berubah
      if (r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
      return r;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
