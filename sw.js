const CACHE_NAME='mentoria-black-v46';
const APP_SHELL=['./','./index.html'];
self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(
    fetch(e.request).then(r=>{
      const c=r.clone();
      caches.open(CACHE_NAME).then(ca=>ca.put(e.request,c));
      return r;
    }).catch(()=>caches.match(e.request))
  );
});
