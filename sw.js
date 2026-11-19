const CACHE = "liftlog-v4-sheets";
const ASSETS = ["./", "./index.html", "./sheets.js", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("liftlog-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  // Do not intercept or cache Google backup traffic, credentials or responses.
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy))); }
    return res;
  }).catch(async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    if (e.request.mode === "navigate") return await caches.match("./index.html") || Response.error();
    return Response.error();
  }));
});
