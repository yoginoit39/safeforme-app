// Offline support: caches the app's own files only. Product lookups and label
// photos always go straight to the network and are never stored here.
const CACHE = 'greenlit-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('./', { cache: 'no-cache' });
      const html = await res.clone().text();
      await cache.put('./', res);
      const urls = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
      await cache.addAll(urls);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put('./', fresh.clone());
          return fresh;
        } catch {
          return (await cache.match('./')) ?? Response.error();
        }
      }
      const hit = await cache.match(req);
      if (hit) return hit;
      const fresh = await fetch(req);
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })(),
  );
});
