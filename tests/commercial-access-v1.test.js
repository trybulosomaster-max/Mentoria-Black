'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {webcrypto}=require('crypto');if(!globalThis.crypto)globalThis.crypto=webcrypto;
const access=require('../commercial/access-contract'),provider=require('../commercial/provider-contract'),admin=require('../commercial/admin-contract');
let tests=0,assertions=0;const equal=(a,e,m)=>{assertions++;assert.strictEqual(a,e,m)},ok=(v,m)=>{assertions++;assert.ok(v,m)};
async function test(name,fn){await fn();tests++}
(async()=>{const webhook=await import('../supabase/functions/_shared/asaas-webhook.mjs');
await test('resolver covers trial, paid, knowledge, complete, grace and paywall',()=>{
 const base={server_now:'2026-08-22T00:00:00Z',trial:{state:'eligible'}};
 equal(access.resolveExperience({...base,app:{has_access:true,access_type:'trial',state:'active'},knowledge:{has_access:false}}),'app_trial');
 equal(access.resolveExperience({...base,app:{has_access:true,access_type:'paid',state:'grace_period'},knowledge:{has_access:false}}),'app');
 equal(access.resolveExperience({...base,app:{has_access:false},knowledge:{has_access:true,access_type:'lifetime'}}),'knowledge');
 equal(access.resolveExperience({...base,app:{has_access:true,access_type:'paid'},knowledge:{has_access:true,access_type:'lifetime'}}),'complete');
 equal(access.resolveExperience({...base,trial:{state:'expired'},app:{has_access:false,state:'expired'},knowledge:{has_access:false}}),'trial_expired');
});
await test('trial display uses only server response',()=>{
 const state={server_now:'2026-08-22T00:00:00Z',app:{has_access:true,access_type:'trial',trial_remaining_seconds:604800},knowledge:{has_access:false},trial:{state:'active',expires_at:'2099-01-01'}};
 equal(access.trialRemaining(state),604800000);equal(access.trialNotice(state),'Teste gratuito — 7 dias restantes');
 const final={...state,app:{...state.app,trial_remaining_seconds:3600}};equal(access.trialNotice(final),'Teste gratuito — menos de 1 hora');
});
await test('commercial bootstrap starts trial then resolves before app data',async()=>{
 const calls=[],client={rpc:async name=>{calls.push(name);return name==='start_my_app_trial'?{data:[{result:'started',trial_state:'active'}],error:null}:{data:{server_now:'2026-08-22T00:00:00Z',app:{has_access:true,access_type:'trial'},knowledge:{has_access:false},trial:{state:'active'}},error:null}}};
 const result=await access.beginCommercialSession(client);equal(calls.join(','),'start_my_app_trial,get_my_entitlements');equal(result.trialResult,'started');equal(result.experience,'app_trial');
});
await test('checkout adapter exposes four named sandbox mocks with zero network',async()=>{
 const mock=provider.createMockCheckoutAdapter();for(const method of ['createAppMonthlyCheckout','createAppAnnualCheckout','createKnowledgeCheckout','createCompleteCheckout']){const result=await mock[method]({paymentMethod:'PIX'});ok(result.mock);equal(result.network,false);equal(result.checkoutCreated,false);ok(!/mock|sandbox|teste|homologa/i.test(result.message));ok(result.message.includes('Nenhuma cobrança foi realizada.'))}
 equal(provider.checkoutIntent({environment:'sandbox',offerCode:'APP_MONTHLY',paymentMethod:'pix'}).offerCode,'APP_MONTHLY');
 assert.throws(()=>provider.checkoutIntent({environment:'production',offerCode:'APP_MONTHLY',paymentMethod:'PIX'}),/sandbox-only/);assertions++;
 const calls=[],server=provider.createAsaasSandboxCheckoutAdapter({invoke:async(name,options)=>(calls.push({name,options}),{data:{checkoutUrl:'https://sandbox.asaas.com/checkoutSession/show/synthetic',status:'pending_confirmation'},error:null})});
 const result=await server.createCompleteCheckout({paymentMethod:'CREDIT_CARD'});equal(result.status,'pending_confirmation');equal(calls[0].name,'asaas-checkout');equal(calls[0].options.body.offerId,'COMPLETE');
});
await test('admin browser contract validates and delegates only to server adapter',async()=>{
 const request=admin.validateGrantRequest({targetUserId:'a0000000-0000-4000-8000-000000000001',products:['app','knowledge'],accessType:'lifetime',reason:'Owner bootstrap'});
 equal(request.products.join(','),'APP,KNOWLEDGE');assert.throws(()=>admin.validateGrantRequest({...request,targetUserId:'bad'}),/valid target/);assertions++;
 assert.throws(()=>admin.createAdminPanelController({}),/server adapter/);assertions++;
 const calls=[],controller=admin.createAdminPanelController({findUser:async id=>(calls.push('find'),{id}),listGrants:async()=>(calls.push('list'),[]),grantAccess:async value=>(calls.push('grant'),value),revokeAccess:async value=>(calls.push('revoke'),value)});
 await controller.findUser(request.targetUserId);await controller.listGrants(request.targetUserId);await controller.grantAccess(request);await controller.revokeAccess('grant-id','Support complete');equal(calls.join(','),'find,list,grant,revoke');
});
await test('Asaas event classifier separates partial refunds and lifecycle',()=>{
 equal(webhook.classifyAsaasEvent('PAYMENT_CONFIRMED'),'grant_activate');equal(webhook.classifyAsaasEvent('PAYMENT_OVERDUE'),'grant_grace');equal(webhook.classifyAsaasEvent('PAYMENT_PARTIALLY_REFUNDED'),'administrative_review');equal(webhook.classifyAsaasEvent('PAYMENT_REFUNDED'),'grant_revoke');equal(webhook.classifyAsaasEvent('PAYMENT_CHARGEBACK_REQUESTED'),'grant_revoke');equal(webhook.classifyAsaasEvent('SUBSCRIPTION_DELETED'),'informational');
});
await test('webhook authenticates, hashes and stores only safe metadata',async()=>{
 const token='sandbox-webhook-token-strong-000000000000';let recorded;
 const handler=webhook.createAsaasWebhookHandler({expectedToken:token,recordEvent:async event=>(recorded=event,{duplicate:false})});
 const body=JSON.stringify({id:'evt_1',event:'PAYMENT_RECEIVED',payment:{id:'pay_1',customer:'cus_1',value:999,description:'private'}});
 equal((await handler(new Request('https://example.invalid',{method:'POST',body,headers:{'asaas-access-token':'wrong'}}))).status,401);
 equal((await handler(new Request('https://example.invalid',{method:'POST',body,headers:{'asaas-access-token':token}}))).status,200);
 equal(recorded.payloadHash.length,64);ok(!JSON.stringify(recorded).includes('private'));ok(!JSON.stringify(recorded).includes('999'));
});
await test('frontend entitlement gate precedes every financial load',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),start=html.indexOf('window.start=async function()'),gate=html.indexOf('const commercial=await resolveCommercialSession()',start),load=html.indexOf('await load()',start);
 ok(start>0&&gate>start&&load>gate);ok(html.includes('Seu período gratuito terminou.'));ok(html.includes('commercialGate'));ok(html.includes('commercialKnowledgeRoot'));ok(html.includes('mountKnowledgeArea'));
});
await test('no administrative or Asaas secret is shipped in frontend assets',()=>{
 const sources=['index.html','commercial/access-contract.js','commercial/provider-contract.js','commercial/admin-contract.js'].map(file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8')).join('\n');
 ok(!sources.includes('SUPABASE_SERVICE_ROLE_KEY'));ok(!/sb_secret_|\$aact_|Bearer\s+[A-Za-z0-9_-]{20,}/.test(sources));
 const edge=fs.readFileSync(path.join(__dirname,'..','supabase/functions/asaas-webhook/index.ts'),'utf8');ok(edge.includes('process_payment_event_v1'));ok(edge.includes('SUPABASE_SERVICE_ROLE_KEY'));
});
console.log(`commercial-access-v2: ${tests} tests, ${assertions} assertions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
