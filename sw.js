// Mértékegység-kaland – offline gyorsítótár
const CACHE = "mertekegyseg-v2";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== "berta-v2").map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  const put = r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); } return r; };
  if (u.pathname.includes("/tts/")) {
    // a hangfájlok nem változnak: előbb a tárolt példány
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(put)));
  } else {
    // az alkalmazás: előbb a hálózat (frissítés azonnal látszik), offline a tárolt példány
    e.respondWith(fetch(e.request).then(put).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
  }
});
