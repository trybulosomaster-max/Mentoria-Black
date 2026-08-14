const CACHE="mentoria-black-v14";
const APP_SHELL=["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 const u=new URL(e.request.url);
 if(u.origin!==self.location.origin)return;
 e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{
   if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}
   return r;
 }).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html"))));
});