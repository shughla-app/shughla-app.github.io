/* شغلة — service worker (keep it small).
   Only the page itself (navigations) goes through here: network first, so every open gets the newest
   version when there is internet; the last good copy is kept for when there is none.
   On a weak network (connected but no data moving) the saved copy opens after 4 seconds instead of a blank
   wait; the newest copy is still stored when it arrives, so the next open is fresh (Dana, round 3).
   Everything else — Supabase API calls, fonts, images — is not touched and never cached.
   Round 4: it also shows the notifications the server pushes, and opens their link when one is tapped (bottom).
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

/* ---- notifications (Web Push, round 4) ----
   The server sends {title, body, url: "#/job/123", tag: "job-123"}. Shown in Arabic, right to left, with our icon.
   The same tag replaces the older one (a second offer on the same job) and still rings (renotify). The page side,
   asking and subscribing, is src/js/10_push.js */
const ICON = new URL('icons/icon-192.png', SCOPE).href;
const BADGE = new URL('icons/badge-96.png', SCOPE).href;   /* Android's status bar: white «ش» on transparent (scripts/make_icons.py) */
const appHash = h => typeof h === 'string' && /^#\/[^\s<>"'\\]{0,200}$/.test(h) ? h : '#/';  /* only our own pages */
function showPush(d) {
  d = d && typeof d === 'object' ? d : {};
  const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  const tag = str(d.tag, 64);
  const opt = { body: str(d.body, 300) || 'عندك تحديث جديد على شغلة', icon: ICON, badge: BADGE, lang: 'ar', dir: 'rtl', data: { url: appHash(d.url) } };
  if (tag) { opt.tag = tag; opt.renotify = true; }
  return self.registration.showNotification(str(d.title, 80) || 'شغلة', opt);  /* always one: the browser requires it for every push */
}
self.addEventListener('push', e => {
  let d = null;
  try { d = e.data ? e.data.json() : null; } catch (err) { try { d = { body: e.data.text() }; } catch (_) {} }
  e.waitUntil(showPush(d));
});

/* a tap: an open شغلة window comes to the front and shows the link; with none open, a new one opens on it */
async function openApp(hash) {
  hash = appHash(hash);
  const url = SHELL + hash;
  const mine = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter(c => { try { const u = new URL(c.url); return u.origin === SCOPE.origin && isShell(u); } catch (err) { return false; } });
  const w = mine.find(c => c.focused) || mine.find(c => c.visibilityState === 'visible') || mine[0];
  if (!w) return self.clients.openWindow(url);
  try { await w.focus(); } catch (err) {}
  /* the page moves itself (a hash change, never a reload) and answers; a page too old to answer is moved from here */
  if (!(await told(w, hash))) { try { await w.navigate(url); } catch (err) {} }
}
function told(w, hash) {
  return new Promise(res => {
    const ch = new MessageChannel(), t = setTimeout(() => res(false), 2000);
    ch.port1.onmessage = () => { clearTimeout(t); res(true); };
    try { w.postMessage({ shughla: 'open', url: hash }, [ch.port2]); } catch (err) { clearTimeout(t); res(false); }
  });
}
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(openApp((e.notification.data || {}).url));
});
