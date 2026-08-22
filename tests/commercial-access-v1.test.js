'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {webcrypto}=require('crypto');
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const access=require('../commercial/access-contract');
const provider=require('../commercial/provider-contract');

let tests=0,assertions=0;
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
async function test(name,fn){await fn();tests++}

(async()=>{
const webhook=await import('../supabase/functions/_shared/asaas-webhook.mjs');

await test('resolver distinguishes trial, paid, knowledge, complete and no access',()=>{
  const base={server_now:'2026-08-22T00:00:00Z',trial:{state:'eligible'}};
  equal(access.resolveExperience({...base,app:{access:true,type:'trial'},knowledge:{access:false}}),'app_trial');
  equal(access.resolveExperience({...base,app:{access:true,type:'paid'},knowledge:{access:false}}),'app');
  equal(access.resolveExperience({...base,app:{access:false},knowledge:{access:true,type:'lifetime'}}),'knowledge');
  equal(access.resolveExperience({...base,app:{access:true,type:'paid'},knowledge:{access:true,type:'lifetime'}}),'complete');
  equal(access.resolveExperience({...base,app:{access:false},knowledge:{access:false}}),'no_access');
  equal(access.resolveExperience({...base,trial:{state:'expired'},app:{access:false},knowledge:{access:false}}),'trial_expired');
});

await test('remaining trial time uses server_now, never browser time',()=>{
  const state={server_now:'2026-08-22T00:00:00Z',app:{access:true,type:'trial'},knowledge:{access:false},trial:{state:'active',expires_at:'2026-08-29T00:00:00Z'}};
  equal(access.trialRemaining(state),168*60*60*1000);
});

await test('commercial session starts server trial before resolving entitlements',async()=>{
  const calls=[];
  const client={rpc:async name=>{calls.push(name);return name==='start_my_app_trial'?{data:[{trial_state:'active'}],error:null}:{data:{server_now:'2026-08-22T00:00:00Z',app:{access:true,type:'trial'},knowledge:{access:false},trial:{state:'active'}},error:null}}};
  const result=await access.beginCommercialSession(client);
  equal(calls.join(','),'start_my_app_trial,get_my_entitlements');
  equal(result.experience,'app_trial');
});

await test('Asaas classifications cover access-relevant payment lifecycle',()=>{
  equal(webhook.classifyAsaasEvent('PAYMENT_CONFIRMED'),'confirmed');
  equal(webhook.classifyAsaasEvent('PAYMENT_RECEIVED'),'received');
  equal(webhook.classifyAsaasEvent('PAYMENT_OVERDUE'),'past_due');
  equal(webhook.classifyAsaasEvent('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'),'failed');
  equal(webhook.classifyAsaasEvent('PAYMENT_REFUNDED'),'refunded');
  equal(webhook.classifyAsaasEvent('PAYMENT_CHARGEBACK_REQUESTED'),'chargeback');
  equal(webhook.classifyAsaasEvent('SUBSCRIPTION_DELETED'),'cancelled');
});

await test('webhook rejects invalid token and accepts valid sandbox event',async()=>{
  const token='sandbox-webhook-token-strong-000000000000';
  let recorded=null;
  const handler=webhook.createAsaasWebhookHandler({expectedToken:token,recordEvent:async event=>{recorded=event;return {duplicate:false}}});
  const body=JSON.stringify({id:'evt_synthetic_1',event:'PAYMENT_RECEIVED',payment:{id:'pay_synthetic_1',customer:'cus_synthetic_1'}});
  const denied=await handler(new Request('https://example.invalid',{method:'POST',body,headers:{'asaas-access-token':'wrong'}}));
  equal(denied.status,401);
  const accepted=await handler(new Request('https://example.invalid',{method:'POST',body,headers:{'asaas-access-token':token}}));
  equal(accepted.status,200);ok(recorded);equal(recorded.eventType,'PAYMENT_RECEIVED');equal(recorded.payloadHash.length,64);
  ok(!JSON.stringify(recorded).includes('value'));ok(!JSON.stringify(recorded).includes('description'));
});

await test('duplicate delivery is surfaced without a second business action',async()=>{
  const token='sandbox-webhook-token-strong-111111111111';
  const seen=new Set();let firstActions=0;
  const handler=webhook.createAsaasWebhookHandler({expectedToken:token,recordEvent:async event=>{
    const key=`${event.provider}:${event.environment}:${event.externalEventId}`;
    if(seen.has(key))return {duplicate:true};seen.add(key);firstActions++;return {duplicate:false};
  }});
  const body=JSON.stringify({id:'evt_duplicate',event:'PAYMENT_CONFIRMED',payment:{id:'pay_duplicate'}});
  const request=()=>new Request('https://example.invalid',{method:'POST',body,headers:{'asaas-access-token':token}});
  const first=await (await handler(request())).json();const second=await (await handler(request())).json();
  equal(first.duplicate,false);equal(second.duplicate,true);equal(firstActions,1);
});

await test('edge handler is sandbox-only and contains no committed credential',()=>{
  const root=path.resolve(__dirname,'..');
  const source=fs.readFileSync(path.join(root,'supabase/functions/asaas-webhook/index.ts'),'utf8');
  ok(source.includes("ASAAS_ENVIRONMENT")&&source.includes("'sandbox'"));
  ok(source.includes('ASAAS_WEBHOOK_TOKEN'));
  ok(source.includes('SUPABASE_SERVICE_ROLE_KEY'));
  ok(!/\$aact_|sb_secret_[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9_-]{20,}/.test(source));
});

await test('provider contract accepts only explicit Sandbox checkout intents',()=>{
  const intent=provider.checkoutIntent({environment:'sandbox',offerCode:'app_monthly',paymentMethod:'pix'});
  equal(intent.offerCode,'APP_MONTHLY');equal(intent.paymentMethod,'PIX');
  assert.throws(()=>provider.checkoutIntent({environment:'production',offerCode:'APP_MONTHLY',paymentMethod:'PIX'}),/sandbox-only/);assertions++;
  assert.throws(()=>provider.checkoutIntent({environment:'sandbox',offerCode:'APP_MONTHLY',paymentMethod:'BOLETO'}),/unsupported/);assertions++;
});

console.log(`commercial-access-v1: ${tests} tests, ${assertions} assertions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
