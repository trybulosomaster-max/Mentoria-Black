const CACHE = "mentoria-black-v11";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request, {cache:"no-store"}).then(response => { const copy=response.clone(); caches.open(CACHE).then(c=>c.put(event.request,copy)); return response; }).catch(()=>caches.match(event.request).then(c=>c||caches.match("./index.html"))));
});
