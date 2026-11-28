// Network-first app shell cache so the board still opens without signal. API calls (script.google.com) are never cached here.
const C = "family-board-v11";
const SHELL = ["./","index.html","styles.css?v=11","app.js?v=11","config.js?v=11","demo-data.js?v=11","manifest.webmanifest","icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  // Same-origin app shell only. Never intercept or cache the Google Sheet API (script.google.com / googleusercontent.com) or any other host.
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if(r.ok){ const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
});
