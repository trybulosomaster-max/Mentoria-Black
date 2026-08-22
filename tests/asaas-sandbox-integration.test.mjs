import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ASAAS_SANDBOX_OFFERS,ASAAS_SANDBOX_BASE_URL,resolveAsaasSandboxOffer} from '../supabase/functions/_shared/asaas-offers.mjs';
import {createAsaasSandboxClient,createOpaqueReference,buildAsaasCheckoutPayload,createOrReuseAsaasCustomer} from '../supabase/functions/_shared/asaas-client.mjs';
import {createAsaasCheckoutCorsHandler,createAsaasCheckoutHandler} from '../supabase/functions/_shared/asaas-checkout.mjs';
import {classifyAsaasEvent,createAsaasWebhookHandler,safeEventMetadata,sha256Hex} from '../supabase/functions/_shared/asaas-webhook.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/asaas-sandbox.json'),'utf8'));
const sandboxKey=['$aact','hmlg','synthetic-test-key-000000'].join('_');
const productionKey=['$aact','prod','synthetic-test-key-000000'].join('_');
let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.equal(actual,expected,message)};
async function test(name,fn){await fn();tests++}
function config(overrides={}){return {ASAAS_ENV:'sandbox',ASAAS_BASE_URL:ASAAS_SANDBOX_BASE_URL,ASAAS_CALLBACK_BASE_URL:'https://sandbox-app.example.invalid',ASAAS_ENABLE_APP_MONTHLY:'true',ASAAS_ENABLE_APP_ANNUAL:'true',ASAAS_ENABLE_KNOWLEDGE_LIFETIME:'true',ASAAS_ENABLE_COMPLETE:'true',ASAAS_PRICE_APP_MONTHLY:'19.90',ASAAS_PRICE_APP_ANNUAL:'199.90',ASAAS_PRICE_KNOWLEDGE_LIFETIME:'49.90',ASAAS_PRICE_COMPLETE:'69.90',ASAAS_COMPLETE_CYCLE:'MONTHLY',...overrides}}

await test('official Sandbox contract is fixed and production credentials are refused',()=>{
  equal(ASAAS_SANDBOX_BASE_URL,'https://api-sandbox.asaas.com/v3');
  assert.throws(()=>createAsaasSandboxClient({environment:'sandbox',baseUrl:ASAAS_SANDBOX_BASE_URL,apiKey:productionKey,fetchImpl:async()=>{throw new Error('network')}}),/production Asaas keys/);assertions++;
  assert.throws(()=>createAsaasSandboxClient({environment:'production',baseUrl:ASAAS_SANDBOX_BASE_URL,apiKey:sandboxKey,fetchImpl:async()=>{throw new Error('network')}}),/sandbox-only/);assertions++;
  assert.throws(()=>createAsaasSandboxClient({environment:'sandbox',baseUrl:'https://api.asaas.com/v3',apiKey:sandboxKey,fetchImpl:async()=>{throw new Error('network')}}),/base URL mismatch/);assertions++;
});

await test('four centralized offers have independent entitlements and configurable prices',()=>{
  equal(Object.keys(ASAAS_SANDBOX_OFFERS).join(','),'APP_MONTHLY,APP_ANNUAL,KNOWLEDGE_LIFETIME,COMPLETE');
  const monthly=resolveAsaasSandboxOffer('APP_MONTHLY',config()),annual=resolveAsaasSandboxOffer('APP_ANNUAL',config()),knowledge=resolveAsaasSandboxOffer('KNOWLEDGE_LIFETIME',config()),complete=resolveAsaasSandboxOffer('COMPLETE',config());
  equal(monthly.billingModel,'RECURRENT');equal(monthly.cycle,'MONTHLY');equal(annual.cycle,'YEARLY');equal(knowledge.billingModel,'DETACHED');equal(knowledge.entitlements.join(','),'KNOWLEDGE');equal(complete.entitlements.join(','),'APP,KNOWLEDGE');equal(complete.databaseOfferCode,'COMPLETE_MONTHLY');
  assert.throws(()=>resolveAsaasSandboxOffer('APP_MONTHLY',config({ASAAS_ENABLE_APP_MONTHLY:'false'})),/disabled/);assertions++;
  assert.throws(()=>resolveAsaasSandboxOffer('APP_MONTHLY',config({ASAAS_PRICE_APP_MONTHLY:''})),/not configured/);assertions++;
});

await test('monthly yearly knowledge complete Pix and card payloads match checkout contract',()=>{
  const now=new Date('2026-08-22T12:00:00Z');
  const monthly=buildAsaasCheckoutPayload({offer:resolveAsaasSandboxOffer('APP_MONTHLY',config()),paymentMethod:'CREDIT_CARD',externalReference:fixtures.checkoutResponses.appMonthly.externalReference,serverNow:now});
  const annual=buildAsaasCheckoutPayload({offer:resolveAsaasSandboxOffer('APP_ANNUAL',config()),paymentMethod:'CREDIT_CARD',externalReference:fixtures.checkoutResponses.appAnnual.externalReference,serverNow:now});
  const knowledgePix=buildAsaasCheckoutPayload({offer:resolveAsaasSandboxOffer('KNOWLEDGE_LIFETIME',config()),paymentMethod:'PIX',externalReference:fixtures.checkoutResponses.knowledge.externalReference,serverNow:now});
  const knowledgeCard=buildAsaasCheckoutPayload({offer:resolveAsaasSandboxOffer('KNOWLEDGE_LIFETIME',config()),paymentMethod:'CREDIT_CARD',externalReference:createOpaqueReference('mbo'),serverNow:now});
  const complete=buildAsaasCheckoutPayload({offer:resolveAsaasSandboxOffer('COMPLETE',config()),paymentMethod:'CREDIT_CARD',externalReference:fixtures.checkoutResponses.complete.externalReference,serverNow:now});
  equal(monthly.chargeTypes[0],'RECURRENT');equal(monthly.subscription.cycle,'MONTHLY');equal(annual.subscription.cycle,'YEARLY');equal(knowledgePix.chargeTypes[0],'DETACHED');equal(knowledgePix.billingTypes[0],'PIX');equal(knowledgeCard.billingTypes[0],'CREDIT_CARD');equal(complete.subscription.cycle,'MONTHLY');
  equal(monthly.callback.successUrl,'https://sandbox-app.example.invalid/commercial/checkout-callback.html?state=success');
  assert.throws(()=>buildAsaasCheckoutPayload({offer:resolveAsaasSandboxOffer('APP_MONTHLY',config()),paymentMethod:'PIX',externalReference:createOpaqueReference('mbo')}),/requires CREDIT_CARD/);assertions++;
});

await test('real adapter uses access_token and identifying User-Agent, never Bearer',async()=>{
  let captured;const fetchImpl=async(url,init)=>(captured={url,init},new Response(JSON.stringify({data:[],totalCount:0}),{status:200}));
  const client=createAsaasSandboxClient({environment:'sandbox',baseUrl:ASAAS_SANDBOX_BASE_URL,apiKey:sandboxKey,fetchImpl});
  await client.probeAuthentication();
  equal(captured.url,'https://api-sandbox.asaas.com/v3/customers?limit=1');equal(captured.init.headers.access_token,sandboxKey);equal(captured.init.headers['user-agent'],'Mentoria Black / Sandbox');equal(captured.init.redirect,'error');ok(captured.init.signal instanceof AbortSignal);ok(!('authorization' in captured.init.headers));
});

await test('customer creation is reused by technical mapping and never keyed by email',async()=>{
  const saved=[],store={find:async()=>null,save:async(userId,row)=>saved.push({userId,...row})};let created=0;
  const client={listCustomersByExternalReference:async()=>({data:[]}),createCustomer:async()=>{created++;return {id:'cus_sandbox_001'}}};
  const result=await createOrReuseAsaasCustomer({client,store,userId:'synthetic-user',customer:{name:'Mentoria Black Sandbox',cpfCnpj:'00000000000',externalReference:createOpaqueReference('mbc')}});
  equal(result.externalCustomerId,'cus_sandbox_001');equal(created,1);equal(saved[0].provider,'asaas');ok(!('email' in saved[0]));
});

await test('real customer checkout and cleanup methods stay inside Sandbox',async()=>{
  const calls=[],fetchImpl=async(url,init)=>{calls.push({url,init});
    if(url.endsWith('/customers')&&init.method==='POST')return new Response(JSON.stringify({id:'cus_sandbox_001'}),{status:200});
    if(url.endsWith('/checkouts')&&init.method==='POST')return new Response(JSON.stringify(fixtures.checkoutResponses.knowledge),{status:200});
    return new Response(JSON.stringify({deleted:true}),{status:200});
  };
  const client=createAsaasSandboxClient({environment:'sandbox',baseUrl:ASAAS_SANDBOX_BASE_URL,apiKey:sandboxKey,fetchImpl});
  const reference=createOpaqueReference('mbc');
  await client.createCustomer({name:'Mentoria Black Sandbox',cpfCnpj:'00000000000',externalReference:reference,email:'payer@example.invalid'});
  await client.createCheckout({externalReference:fixtures.checkoutResponses.knowledge.externalReference});
  await client.cancelCheckout('chk_sandbox_001');await client.removeCustomer('cus_sandbox_001');
  equal(calls.map(call=>`${call.init.method}:${new URL(call.url).pathname}`).join(','),'POST:/v3/customers,POST:/v3/checkouts,POST:/v3/checkouts/chk_sandbox_001/cancel,DELETE:/v3/customers/cus_sandbox_001');
  ok(calls.every(call=>call.url.startsWith(ASAAS_SANDBOX_BASE_URL)));ok(calls.every(call=>!('authorization' in call.init.headers)));ok(!calls[0].init.body.includes('gmail'));
});

await test('checkout endpoint creates a pending order but never a grant',async()=>{
  const calls=[],offer=resolveAsaasSandboxOffer('KNOWLEDGE_LIFETIME',config());
  const handler=createAsaasCheckoutHandler({authenticate:async()=>({userId:'synthetic-user'}),resolveOffer:()=>offer,
    orders:{create:async input=>(calls.push(['order',input]),{orderId:'order-internal',externalReference:fixtures.checkoutResponses.knowledge.externalReference}),complete:async input=>calls.push(['complete',input]),fail:async input=>calls.push(['fail',input])},
    customers:{find:async()=>null},client:{createCheckout:async()=>fixtures.checkoutResponses.knowledge},serverNow:()=>new Date('2026-08-22T00:00:00Z')});
  const response=await handler(new Request('https://edge.example.invalid',{method:'POST',headers:{authorization:'Bearer synthetic-user-jwt'},body:JSON.stringify({offerId:'KNOWLEDGE_LIFETIME',paymentMethod:'PIX'})}));
  equal(response.status,201);equal((await response.json()).status,'pending_confirmation');equal(calls.map(entry=>entry[0]).join(','),'order,complete');ok(!JSON.stringify(calls).includes('grant'));
});

await test('checkout CORS permits only the configured HTTPS frontend origin',async()=>{
  const allowed='https://sandbox-app.example.invalid',handler=createAsaasCheckoutCorsHandler(async()=>Response.json({ok:true}),`${allowed}/nested`);
  let response=await handler(new Request('https://edge.example.invalid',{method:'OPTIONS',headers:{origin:allowed}}));
  equal(response.status,204);equal(response.headers.get('access-control-allow-origin'),allowed);ok(response.headers.get('access-control-allow-headers').includes('authorization'));
  response=await handler(new Request('https://edge.example.invalid',{method:'POST',headers:{origin:allowed}}));equal(response.status,200);equal(response.headers.get('access-control-allow-origin'),allowed);
  response=await handler(new Request('https://edge.example.invalid',{method:'POST',headers:{origin:'https://attacker.example.invalid'}}));equal(response.status,403);
});

await test('webhook token payload validation classification and replay metadata are safe',async()=>{
  equal(classifyAsaasEvent('PAYMENT_CREATED'),'informational');equal(classifyAsaasEvent('PAYMENT_CONFIRMED'),'grant_activate');equal(classifyAsaasEvent('PAYMENT_OVERDUE'),'grant_grace');equal(classifyAsaasEvent('PAYMENT_REFUNDED'),'grant_revoke');equal(classifyAsaasEvent('PAYMENT_PARTIALLY_REFUNDED'),'administrative_review');equal(classifyAsaasEvent('CHECKOUT_PAID'),'informational');
  const raw=JSON.stringify({...fixtures.events.received,payment:{...fixtures.events.received.payment,value:999,description:'must-not-persist'}});
  const metadata=safeEventMetadata(JSON.parse(raw),await sha256Hex(raw));
  equal(metadata.externalReference,fixtures.events.received.payment.externalReference);equal(metadata.billingPeriodAnchor,'2026-08-22');equal(metadata.environment,'sandbox');ok(!JSON.stringify(metadata).includes('999'));ok(!JSON.stringify(metadata).includes('must-not-persist'));
  const checkoutMetadata=safeEventMetadata(fixtures.events.checkoutCanceled,await sha256Hex(JSON.stringify(fixtures.events.checkoutCanceled)));equal(checkoutMetadata.externalCheckoutId,fixtures.events.checkoutCanceled.checkout.id);
  assert.throws(()=>safeEventMetadata({...fixtures.events.received,environment:'production'},'0'.repeat(64)),/unexpected webhook environment/);assertions++;
  assert.throws(()=>safeEventMetadata({...fixtures.events.received,event:'payer@example.invalid'},'0'.repeat(64)),/invalid webhook event type/);assertions++;
  const token='sandbox-webhook-token-strong-000000000000',seen=new Set();
  const handler=createAsaasWebhookHandler({expectedToken:token,recordEvent:async event=>{const key=`${event.provider}:${event.environment}:${event.externalEventId}`;const duplicate=seen.has(key);seen.add(key);return {duplicate}}});
  equal((await handler(new Request('https://edge.example.invalid',{method:'POST',headers:{'asaas-access-token':token},body:raw}))).status,200);
  equal((await (await handler(new Request('https://edge.example.invalid',{method:'POST',headers:{'asaas-access-token':token},body:raw}))).json()).duplicate,true);
  equal((await handler(new Request('https://edge.example.invalid',{method:'POST',headers:{'asaas-access-token':'wrong'},body:raw}))).status,401);
  equal((await handler(new Request('https://edge.example.invalid',{method:'POST',headers:{'asaas-access-token':token},body:'{' }))).status,400);
});

await test('fixtures cover requested lifecycle without any real customer data',()=>{
  for(const key of ['appMonthly','appAnnual','knowledge','complete'])ok(fixtures.checkoutResponses[key]);
  for(const key of ['created','confirmed','received','renewal','overdue','refund','partialRefund','chargeback','checkoutCanceled','checkoutExpired'])ok(fixtures.events[key]);
  const serialized=JSON.stringify(fixtures);ok(!/@(gmail|hotmail|outlook)\./i.test(serialized));ok(!/\$aact_|service_role|access_token/.test(serialized));
  const callback=fs.readFileSync(path.join(root,'commercial/checkout-callback.html'),'utf8');ok(callback.includes('Pagamento recebido para processamento. Seu acesso será liberado após confirmação.'));ok(callback.includes("state==='success'"));ok(!/grant|service_role|access_token/i.test(callback));
});

await test('future homologation script makes no network request without a key and rejects prod key before fetch',()=>{
  const baseEnv={...process.env};for(const key of Object.keys(baseEnv))if(key.startsWith('ASAAS_'))delete baseEnv[key];
  let result=spawnSync(process.execPath,['scripts/homologate-asaas-sandbox.mjs','--execute'],{cwd:root,env:baseEnv,encoding:'utf8'});
  equal(result.status,2);ok(result.stderr.includes('No network request was made'));
  result=spawnSync(process.execPath,['scripts/homologate-asaas-sandbox.mjs','--execute'],{cwd:root,env:{...baseEnv,ASAAS_API_KEY:productionKey,ASAAS_ENV:'sandbox',ASAAS_BASE_URL:ASAAS_SANDBOX_BASE_URL,ASAAS_SANDBOX_TEST_CPF_CNPJ:'00000000000'},encoding:'utf8'});
  equal(result.status,1);ok(result.stderr.includes('failed safely'));
});

console.log(`asaas-sandbox-integration: ${tests} tests, ${assertions} assertions passed`);
