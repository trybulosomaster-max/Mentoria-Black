const CACHE_NAME = 'aviora-v1-visual-shell-v3';
const APP_SHELL = ['./','./index.html','./assets/aviora-v82.css','./js/aviora-visual-v1.js','./assets/branding/aviora-official.jpg','./assets/branding/aviora-login-hero.jpg'];
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request,{cache:'no-store'})
      .then(response => {
        if(response && response.ok){
          const copy=response.clone();
          caches.open(CACHE_NAME).then(c=>c.put(event.request,copy)).catch(()=>{});
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(r=>r || caches.match('./index.html')))
  );
});
