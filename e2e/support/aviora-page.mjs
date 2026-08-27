import {expect} from '@playwright/test';

const EXPECTED_ORIGIN=`http://127.0.0.1:${Number(process.env.E2E_PORT||4173)}`;

export const VIEWPORTS=Object.freeze([
  Object.freeze({name:'mobile-375',width:375,height:812}),
  Object.freeze({name:'mobile-390',width:390,height:844}),
  Object.freeze({name:'mobile-430',width:430,height:932}),
  Object.freeze({name:'tablet',width:768,height:1024}),
  Object.freeze({name:'desktop',width:1440,height:900})
]);

export const DESTINATIONS=Object.freeze([
  ['dashboard','Dashboard'],
  ['transactions','Lançamentos'],
  ['planning','Planejamento'],
  ['accounts','Contas'],
  ['cards','Cartões'],
  ['categories','Categorias'],
  ['goals','Metas'],
  ['recurring','Recorrências'],
  ['wealth','Patrimônio'],
  ['reports','Relatórios'],
  ['knowledge','Conhecimento'],
  ['account','Minha conta'],
  ['reserve-v52','Reserva de Emergência'],
  ['health-v53','Saúde Financeira'],
  ['administration','Administração']
]);

export async function monitorBrowser(page){
  const evidence={externalRequests:[],unsafeMethods:[],consoleErrors:[],pageErrors:[]};
  page.on('console',message=>{
    if(message.type()==='error')evidence.consoleErrors.push(message.text());
  });
  page.on('pageerror',error=>evidence.pageErrors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    if(!['http:','https:'].includes(url.protocol))return route.continue();
    const local=url.origin===EXPECTED_ORIGIN;
    if(!local){evidence.externalRequests.push(request.url());return route.abort('blockedbyclient')}
    if(!['GET','HEAD'].includes(request.method())){evidence.unsafeMethods.push(`${request.method()} ${request.url()}`);return route.abort('blockedbyclient')}
    return route.continue();
  });
  return Object.freeze({
    evidence,
    assertClean(){
      expect(evidence.externalRequests,'nenhuma requisição externa').toEqual([]);
      expect(evidence.unsafeMethods,'nenhuma escrita HTTP').toEqual([]);
      expect(evidence.consoleErrors,'nenhum console.error').toEqual([]);
      expect(evidence.pageErrors,'nenhuma exceção de página').toEqual([]);
    }
  });
}

export async function openPreview(page,{view='app',tab='dashboard',profile='owner',state='normal',viewport}={}){
  if(viewport)await page.setViewportSize({width:viewport.width,height:viewport.height});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  const query=new URLSearchParams({view,tab,profile,state,cache:'e2e-synthetic-v1'});
  await page.goto(`/aviora-v82.preview.local.html?${query}`,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
    await document.fonts?.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  if(view==='app'){
    const expectedTab=profile==='customer'&&tab==='administration'?'dashboard':tab;
    await expect(page.locator('#appPreview')).not.toHaveClass(/hidden/);
    await expect(page.locator('#view')).toHaveAttribute('data-aviora-view',expectedTab);
    await expect.poll(()=>page.evaluate(()=>globalThis.__AVIORA_VISUAL_V1_INSTALLED__===true)).toBe(true);
  }else if(view==='login')await expect(page.locator('#loginPreview')).not.toHaveClass(/hidden/);
  else await expect(page.locator('#knowledgePreview')).not.toHaveClass(/hidden/);
}

export async function navigateTo(page,tab){
  const destination=page.locator(`#nav > [data-tab="${tab}"]`);
  if(await destination.isVisible())await destination.click();
  else{
    const trigger=page.locator('[data-aviora-mobile-nav-trigger]');
    if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
    await page.getByRole('dialog',{name:'Áreas do AVIORA'}).locator(`[data-tab="${tab}"]`).click();
  }
  await expect(page.locator('#view')).toHaveAttribute('data-aviora-view',tab);
}

export async function assertNoHorizontalOverflow(page){
  const geometry=await page.evaluate(()=>({
    documentWidth:document.documentElement.scrollWidth,
    viewportWidth:document.documentElement.clientWidth,
    bodyWidth:document.body.scrollWidth
  }));
  expect(geometry.documentWidth,'documento sem overflow horizontal involuntário').toBeLessThanOrEqual(geometry.viewportWidth+1);
  expect(geometry.bodyWidth,'body sem overflow horizontal involuntário').toBeLessThanOrEqual(geometry.viewportWidth+1);
}

export async function assertHeaderDoesNotOverlap(page){
  const boxes=await page.evaluate(()=>{
    const box=selector=>{
      const node=document.querySelector(selector);if(!node)return null;
      const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};
    };
    return {brand:box('#appPreview .header .brand-full'),session:box('#appPreview .header > .row'),actions:box('#appPreview .header .actions'),viewport:innerWidth};
  });
  for(const [name,box] of Object.entries(boxes))if(name!=='viewport')expect(box,`${name} existe`).not.toBeNull();
  const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
  expect(intersects(boxes.brand,boxes.actions),'marca não sobrepõe ações').toBe(false);
  expect(boxes.actions.left).toBeGreaterThanOrEqual(0);
  expect(boxes.actions.right).toBeLessThanOrEqual(boxes.viewport+1);
}

export async function assertTouchTargets(page,selector){
  const invalid=await page.locator(selector).evaluateAll(nodes=>nodes.filter(node=>{
    const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return false;
    const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0&&(rect.width<44||rect.height<44);
  }).map(node=>({text:(node.getAttribute('aria-label')||node.textContent||'').trim(),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
  expect(invalid,'alvos críticos com pelo menos 44 × 44 px').toEqual([]);
}

export async function assertAriaControlsResolve(page){
  const invalid=await page.evaluate(()=>[...document.querySelectorAll('[aria-controls]')].filter(control=>!document.getElementById(control.getAttribute('aria-controls'))).map(control=>control.outerHTML.slice(0,160)));
  expect(invalid,'aria-controls aponta para IDs existentes').toEqual([]);
}

export async function snapshotBrowserStorage(page){
  return page.evaluate(async()=>({
    cookies:document.cookie,
    localStorage:{...localStorage},
    sessionStorage:{...sessionStorage},
    indexedDatabases:typeof indexedDB.databases==='function'?(await indexedDB.databases()).map(item=>item.name).filter(Boolean):[],
    caches:typeof caches!=='undefined'?await caches.keys():[],
    serviceWorkers:'serviceWorker' in navigator?(await navigator.serviceWorker.getRegistrations()).length:0
  }));
}
