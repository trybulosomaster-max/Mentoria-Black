import {test,expect} from '@playwright/test';

test.use({serviceWorkers:'allow'});

async function clearBrowserCacheState(page){
  await page.evaluate(async()=>{
    for(const registration of await navigator.serviceWorker.getRegistrations())await registration.unregister();
    for(const key of await caches.keys())await caches.delete(key);
  });
}

async function activateBuild(page,build){
  await page.evaluate(async value=>{
    const registration=await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(value)}`,{scope:'/',updateViaCache:'none'});
    await registration.update();
  },build);
  await expect.poll(()=>page.evaluate(async()=>{
    const registration=await navigator.serviceWorker.getRegistration('/');
    return registration?.active?.scriptURL||'';
  })).toContain(`v=${build}`);
}

test('atualização A → B mantém somente o shell atômico da versão B',async({page,browserName})=>{
  test.skip(browserName!=='chromium','lifecycle determinístico do Service Worker é validado no Chromium');
  await page.goto('/aviora-v82.preview.local.html?view=app&tab=dashboard',{waitUntil:'networkidle'});
  await clearBrowserCacheState(page);
  try{
    await activateBuild(page,'cache-e2e-a');
    await expect.poll(()=>page.evaluate(()=>caches.keys())).toEqual(['mentoria-black-v82-production-aviora-shell-cache-e2e-a']);

    await activateBuild(page,'cache-e2e-b');
    await expect.poll(()=>page.evaluate(()=>caches.keys())).toEqual(['mentoria-black-v82-production-aviora-shell-cache-e2e-b']);
    const cachedUrls=await page.evaluate(async()=>{
      const cache=await caches.open('mentoria-black-v82-production-aviora-shell-cache-e2e-b');
      return (await cache.keys()).map(request=>request.url);
    });
    expect(cachedUrls.length).toBeGreaterThan(20);
    expect(cachedUrls.every(url=>new URL(url).searchParams.get('v')==='cache-e2e-b')).toBe(true);

    await page.reload({waitUntil:'networkidle'});
    await expect(page.locator('#view')).toHaveAttribute('data-aviora-view','dashboard');
    await expect.poll(()=>page.evaluate(()=>globalThis.AVIORA_PREVIEW_ASSET_MISMATCHES())).toEqual([]);

    const cleanPage=await page.context().newPage();
    await cleanPage.goto('/aviora-v82.preview.local.html?view=app&tab=dashboard&reload=clean',{waitUntil:'networkidle'});
    await expect(cleanPage.locator('#view')).toHaveAttribute('data-aviora-view','dashboard');
    await expect.poll(()=>cleanPage.evaluate(()=>globalThis.AVIORA_PREVIEW_ASSET_MISMATCHES())).toEqual([]);
    await cleanPage.close();
  }finally{
    await clearBrowserCacheState(page);
  }
});
