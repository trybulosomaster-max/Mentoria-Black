'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const BUILD_ID='aviora-v1-structural-b2-smoke2';

function localAssets(source){
  return [...source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)]
    .map(match=>match[1])
    .filter(value=>!/^https?:|^data:/i.test(value));
}

const index=read('index.html'),preview=read('aviora-v82.preview.local.html'),sw=read('sw.js');
assert.match(index,/@supabase\/supabase-js@2\.112\.4" integrity="sha384-/,'external Auth client is immutable and integrity checked');
assert.doesNotMatch(index,/@supabase\/supabase-js@2"/,'mutable major alias is forbidden');
for(const [name,source] of [['index',index],['preview',preview]]){
  assert.match(source,new RegExp(`<meta name="aviora-build" content="${BUILD_ID}">`),`${name} exposes one build identity`);
  for(const asset of localAssets(source))assert.equal(new URL(asset,'https://local.invalid/').searchParams.get('v'),BUILD_ID,`${name}: ${asset} uses the build identity`);
}

assert.match(sw,/new URL\(self\.location\.href\)\.searchParams\.get\('v'\)/);
assert.match(sw,/requestedBuild&&requestedBuild!==BUILD_ID/);
assert.match(sw,/event\.request\.mode==='navigate'/);
assert.doesNotMatch(sw,/cache\.match\('\.\/index\.html'\)/,'non-navigation requests never fall back to HTML');
assert.doesNotMatch(sw,/keys\.filter\(k => k !== CACHE_NAME\)/,'activation must not delete unrelated caches');
assert.match(sw,/k\.startsWith\(CACHE_PREFIX\)/,'activation only removes prior AVIORA builds');
assert.match(index,/aviora-build-reloaded:\$\{MB_BUILD_ID\}/);
assert.doesNotMatch(index,/MB_SW_VERSION|mb-v29-reloaded/);

const adapters=require('../e2e/adapters/aviora-preview-adapters');
assert.deepEqual(adapters.PARITY,{
  dashboard:'EQUIVALENT_FIXTURE',transactions:'EQUIVALENT_FIXTURE',planning:'EQUIVALENT_FIXTURE',
  accounts:'EQUIVALENT_FIXTURE',cards:'EQUIVALENT_FIXTURE',categories:'EQUIVALENT_FIXTURE',
  goals:'EQUIVALENT_FIXTURE',recurring:'EQUIVALENT_FIXTURE',wealth:'EQUIVALENT_FIXTURE',
  reports:'EQUIVALENT_FIXTURE',knowledge:'SAFE_ADAPTER',account:'REAL_RENDERER',
  'reserve-v52':'REQUIRES_AUTHENTICATED_BETA_SMOKE','health-v53':'REQUIRES_AUTHENTICATED_BETA_SMOKE',administration:'SAFE_ADAPTER'
});
for(const forbidden of ['Fatura atual','Fechamento / vencimento','Diagnóstico sintético','Compromissos conhecidos representam 42%'])assert.equal(preview.includes(forbidden),false,`preview does not invent ${forbidden}`);
assert.match(preview,/AVAdminArea\.renderAdminArea/);
assert.match(preview,/AVIORA_PREVIEW_ADAPTERS\.mountKnowledge/);
assert.match(preview,/REQUIRES_AUTHENTICATED_BETA_SMOKE/);
assert.doesNotMatch(preview,/createClient\(|SUPABASE_|service_role|sb_secret_/i);

console.log('aviora-cache-coherence: 2 build surfaces and 15 parity classifications passed');
