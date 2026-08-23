import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  KIWIFY_EVENT_TYPES,buildLegacyGrantWrite,createKiwifyWebhookHandler,
  generateTemporaryPassword,hmacSha1Hex,parseKiwifyMetadata,sha256Hex
} from '../supabase/functions/_shared/kiwify-webhook.mjs';

const TOKEN='synthetic-kiwify-webhook-token-000000000001';

test('generates 1,000 bounded high-variability temporary passwords without PII input',()=>{
  const passwords=Array.from({length:1000},()=>generateTemporaryPassword());
  assert.equal(generateTemporaryPassword.length,0,'the generator accepts no PII or caller-controlled input');
  assert.equal(new Set(passwords).size,passwords.length,'the sample must contain no duplicate passwords');
  for(const password of passwords){
    assert.equal(password.length,64);
    assert.ok(Buffer.byteLength(password,'utf8')<=72);
    assert.match(password,/^[0-9a-f]{64}$/);
  }
});

function payload(overrides={}){
  return {
    webhook_event_type:'purchase_approved',event_id:'evt-synthetic-001',
    order_id:'purchase-synthetic-001',provider:'kiwify',environment:'production',
    Customer:{id:'customer-synthetic',email:'buyer@example.invalid',full_name:'Synthetic Buyer'},
    Product:{product_id:'product-synthetic-app',product_name:'Mentoria Black'},
    Subscription:{id:'subscription-synthetic',customer_access:{access_until:'2026-09-23T00:00:00Z'}},
    ...overrides
  };
}

function requestFor(body,{token=TOKEN,url='https://beta.invalid/functions/v1/kiwify-webhook'}={}){
  return new Request(url,{method:'POST',headers:{'content-type':'application/json','x-kiwify-webhook-token':token},body:JSON.stringify(body)});
}

test('classifies every supported Kiwify commercial action',async()=>{
  let assertions=0;
  for(const [action,types] of Object.entries(KIWIFY_EVENT_TYPES)){
    for(const eventType of types){
      const metadata=parseKiwifyMetadata(payload({webhook_event_type:eventType,event_id:`evt-${action}-${assertions}`}),await sha256Hex(eventType));
      assert.equal(metadata.action,action);assertions+=1;
    }
  }
  assert.ok(assertions>=16);
});

test('extracts only bounded technical metadata and the legacy APP candidate',async()=>{
  const metadata=parseKiwifyMetadata(payload(),await sha256Hex('synthetic'));
  assert.equal(metadata.environment,'production');
  assert.equal(metadata.externalEventId,'evt-synthetic-001');
  assert.equal(metadata.externalPurchaseId,'purchase-synthetic-001');
  assert.equal(metadata.externalSubscriptionId,'subscription-synthetic');
  assert.equal(metadata.customerEmail,'buyer@example.invalid');
  assert.equal(metadata.legacyAppCandidate,true);
  assert.equal(metadata.requiresIdentity,true);
  assert.match(metadata.payloadHash,/^[0-9a-f]{64}$/);
  const unknown=parseKiwifyMetadata(payload({Product:{product_id:'other-product',product_name:'Other Product'}}),await sha256Hex('unknown'));
  assert.equal(unknown.legacyAppCandidate,false);
});

test('rejects provider, environment, identifiers and access timestamps outside the contract',async()=>{
  const hash=await sha256Hex('synthetic');
  assert.throws(()=>parseKiwifyMetadata(payload({provider:'asaas'}),hash),/provider/);
  assert.throws(()=>parseKiwifyMetadata(payload({environment:'sandbox'}),hash),/environment/);
  assert.throws(()=>parseKiwifyMetadata(payload({event_id:'bad/id'}),hash),/event id/);
  assert.throws(()=>parseKiwifyMetadata(payload({Subscription:{customer_access:{access_until:'not-a-date'}}}),hash),/timestamp/);
});

test('keeps the removed conflict target exclusively in the legacy write builder',async()=>{
  const metadata=parseKiwifyMetadata(payload(),await sha256Hex('synthetic'));
  const write=buildLegacyGrantWrite(metadata,'user-synthetic','product-synthetic',new Date('2026-08-23T00:00:00Z'));
  assert.equal(write.onConflict,'user_id,product_id');
  assert.equal(write.row.source,'kiwify');
  assert.equal(write.row.external_purchase_id,'purchase-synthetic-001');
  assert.equal(write.row.updated_at,'2026-08-23T00:00:00.000Z');
});

test('routes authenticated requests through explicit legacy and V2 feature contracts',async()=>{
  for(const contract of ['legacy','commercial_v2']){
    const calls=[];
    const handler=createKiwifyWebhookHandler({
      getToken:async()=>TOKEN,detectContract:async()=>contract,
      processEvent:async input=>{calls.push(input);return {status:'processed',duplicate:false}}
    });
    const response=await handler(requestFor(payload({event_id:`evt-${contract}`})));
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,status:'processed',duplicate:false,contract});
    assert.equal(calls.length,1);
    assert.equal(calls[0].contract,contract);
  }
});

test('accepts the HMAC signature contract without exposing the token',async()=>{
  const raw=JSON.stringify(payload({event_id:'evt-signature'}));
  const signature=await hmacSha1Hex(TOKEN,raw);
  const handler=createKiwifyWebhookHandler({
    getToken:async()=>TOKEN,detectContract:async()=>'commercial_v2',
    processEvent:async()=>({status:'processed'})
  });
  const response=await handler(new Request(`https://beta.invalid/functions/v1/kiwify-webhook?signature=${signature}`,{method:'POST',body:raw}));
  assert.equal(response.status,200);
  assert.doesNotMatch(await response.text(),new RegExp(TOKEN));
});

test('preserves the existing v4 token-length reader contract',async()=>{
  const legacyToken='legacy8!';
  const handler=createKiwifyWebhookHandler({
    getToken:async()=>legacyToken,detectContract:async()=>'legacy',
    processEvent:async()=>({status:'processed'})
  });
  const response=await handler(requestFor(payload({event_id:'evt-legacy-token'}),{token:legacyToken}));
  assert.equal(response.status,200);
});

test('rejects missing/wrong tokens, malformed JSON, methods and oversized payloads',async()=>{
  const handler=createKiwifyWebhookHandler({
    getToken:async()=>TOKEN,detectContract:async()=>'legacy',processEvent:async()=>({})
  });
  assert.equal((await handler(requestFor(payload(),{token:'wrong'}))).status,401);
  assert.equal((await handler(new Request('https://beta.invalid',{method:'POST',headers:{'x-kiwify-webhook-token':TOKEN},body:'{'}))).status,400);
  assert.equal((await handler(new Request('https://beta.invalid',{method:'GET'}))).status,405);
  const smallLimit=createKiwifyWebhookHandler({getToken:async()=>TOKEN,detectContract:async()=>'legacy',processEvent:async()=>({}),payloadLimit:8});
  assert.equal((await smallLimit(requestFor(payload()))).status,413);
});

test('returns duplicate state without leaking identities or payloads',async()=>{
  const handler=createKiwifyWebhookHandler({
    getToken:async()=>TOKEN,detectContract:async()=>'commercial_v2',
    processEvent:async()=>({status:'processed',duplicate:true,userId:'must-not-leak'})
  });
  const response=await handler(requestFor(payload({event_id:'evt-duplicate'})));
  const body=await response.text();
  assert.match(body,/"duplicate":true/);
  assert.doesNotMatch(body,/must-not-leak|buyer@example|purchase-synthetic/);
});

test('uses the supported paginated Admin API for dual-contract user resolution',()=>{
  const source=readFileSync(new URL('../supabase/functions/kiwify-webhook/index.ts',import.meta.url),'utf8');
  assert.match(source,/admin\.auth\.admin\.listUsers\(\{page,perPage\}\)/);
  assert.doesNotMatch(source,/getUserByEmail/);
  assert.match(source,/page<=100/);
});

console.log('kiwify-webhook-v2: 11 tests passed');
