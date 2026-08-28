const BUILD_ID=new URL(self.location.href).searchParams.get('v');
if(!BUILD_ID||!/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(BUILD_ID))throw new Error('AVIORA build identity is required');

const CACHE_PREFIX='mentoria-black-v82-production-aviora-shell-';
const CACHE_NAME=`${CACHE_PREFIX}${BUILD_ID}`;
const versioned=path=>`${path}${path.includes('?')?'&':'?'}v=${encodeURIComponent(BUILD_ID)}`;
const SHELL_PATHS=[
  './index.html','./manifest.webmanifest',
  './assets/branding/aviora-official.jpg','./assets/branding/aviora-login-hero.jpg',
  './assets/fonts/syncopate/Syncopate-Regular.ttf',
  './knowledge/knowledge-area.css','./knowledge/knowledge-area-premium.css',
  './assets/meridian-black-day-night-login.css','./assets/aviora-v82.css',
  './assets/admin-area.css','./assets/account-security.css',
  './js/production-environment.js','./js/production-runtime.js','./js/meridian-day-night-login.js','./js/observability.js',
  './js/financial-core.js','./js/recurrence-projection.js','./js/structured-recurring-v82.js','./js/card-billing-financial-adjustments.js','./js/accounts-networth-integration.js','./js/planning-integration.js',
  './js/cards-view-data.js','./js/recurring-view-data.js',
  './js/goal-projection.js','./js/goals-integration.js','./js/reports-integration.js','./js/dashboard-financial-integration.js','./js/health-integration.js',
  './commercial/access-contract.js','./commercial/provider-contract.js','./commercial/admin-access-contract.js','./commercial/admin-presentation.js',
  './js/admin-access-client.js','./js/admin-area.js','./js/account-security.js',
  './knowledge/import-contract.js','./knowledge/reader-experience.js','./knowledge/knowledge-area.js','./js/aviora-visual-v1.js'
];
const APP_SHELL=SHELL_PATHS.map(versioned);
const NAVIGATION_FALLBACK=versioned('./index.html');

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
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function network(request){
  return fetch(request,{cache:'no-store'});
}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);

    if(event.request.mode==='navigate'){
      try{
        return await network(event.request);
      }catch(_error){
        return (await cache.match(NAVIGATION_FALLBACK))||Response.error();
      }
    }

    const requestedBuild=url.searchParams.get('v');
    if(requestedBuild&&requestedBuild!==BUILD_ID)return network(event.request);
    if(requestedBuild===BUILD_ID){
      const cached=await cache.match(event.request);
      if(cached)return cached;
    }

    try{
      const response=await network(event.request);
      if(response?.ok)await cache.put(event.request,response.clone());
      return response;
    }catch(_error){
      return (await cache.match(event.request))||Response.error();
    }
  })());
});
