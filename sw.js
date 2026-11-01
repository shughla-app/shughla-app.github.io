/* شغلة — service worker (keep it small).
   Only the page itself (navigations) goes through here: network first, so every open gets the newest
   version when there is internet; the last good copy is kept for when there is none.
   On a weak network (connected but no data moving) the saved copy opens after 4 seconds instead of a blank
   wait; the newest copy is still stored when it arrives, so the next open is fresh (Dana, round 3).
   Everything else — Supabase API calls, fonts, images — is not touched and never cached.
   Emergency switch-off for everyone: scripts/sw-kill/README.md */
const CACHE = 'shughla-page-v1';
const SCOPE = new URL(self.registration.scope);
const SHELL = SCOPE.href;                                   /* https://shughla-app.github.io/ */
const SLOW_MS = 4000;
const isShell = u => u.pathname === SCOPE.pathname || u.pathname === SCOPE.pathname + 'index.html';

self.addEventListener('install', e => {
  self.skipWaiting();                                       /* a new sw.js takes over at once */
  /* keep an offline copy from the first visit (usually straight from the browser cache, no extra download) */
  e.waitUntil(caches.open(CACHE).then(c => c.add(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shughla-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;   /* API calls, fonts, images: straight to the network */
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin) return;
  /* no-cache = always ask the server (a tiny 304 when nothing changed), never a stale page from the HTTP cache */
  let fresh = req;
  try { fresh = new Request(req, { cache: 'no-cache' }); } catch (err) {}
  const net = fetch(fresh).then(res => {
    if (res.ok && res.type === 'basic' && isShell(url)) {
      const copy = res.clone();
      return caches.open(CACHE).then(c => c.put(SHELL, copy)).catch(() => {}).then(() => res);
    }
    return res;
  });
  e.waitUntil(net.then(() => {}, () => {}));                /* the newest copy still gets stored after we answered from the cache */
  e.respondWith((async () => {
    const hit = isShell(url) ? await caches.match(SHELL) : null;
    if (!hit) {
      try { return await net; } catch (err) { const h = await caches.match(SHELL); if (h) return h; throw err; }
    }
    const late = new Promise(r => setTimeout(() => r(null), SLOW_MS));
    try { return (await Promise.race([net, late])) || hit; } catch (err) { return hit; }  /* no internet: the last copy we have */
  })());
});
