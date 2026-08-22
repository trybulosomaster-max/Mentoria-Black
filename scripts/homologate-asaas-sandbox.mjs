#!/usr/bin/env node
import {createAsaasSandboxClient,createOpaqueReference,buildAsaasCheckoutPayload} from '../supabase/functions/_shared/asaas-client.mjs';
import {resolveAsaasSandboxOffer} from '../supabase/functions/_shared/asaas-offers.mjs';

const execute=process.argv.includes('--execute'),cleanup=process.argv.includes('--cleanup');
const required=['ASAAS_API_KEY','ASAAS_ENV','ASAAS_BASE_URL'];
const missing=required.filter(name=>!process.env[name]);
if(missing.length){
  console.error(`Sandbox homologation blocked: missing ${missing.join(', ')}. No network request was made.`);
  process.exit(2);
}
if(!execute){
  console.log('Sandbox homologation configuration detected. Use --execute only in an approved Sandbox window; no network request was made.');
  process.exit(0);
}

const customerName='Mentoria Black Sandbox Automated';
const customerDocument=String(process.env.ASAAS_SANDBOX_TEST_CPF_CNPJ||'').trim();
if(!customerDocument){
  console.error('Sandbox homologation blocked: a temporary synthetic ASAAS_SANDBOX_TEST_CPF_CNPJ is required. No network request was made.');
  process.exit(2);
}

let customerId=null,checkoutId=null;
try{
  const client=createAsaasSandboxClient({
    environment:process.env.ASAAS_ENV,baseUrl:process.env.ASAAS_BASE_URL,apiKey:process.env.ASAAS_API_KEY,
    userAgent:'Mentoria Black / Sandbox',fetchImpl:fetch
  });
  const offerId=String(process.env.ASAAS_SANDBOX_TEST_OFFER||'KNOWLEDGE_LIFETIME').trim().toUpperCase();
  const offer=resolveAsaasSandboxOffer(offerId,process.env);
  await client.probeAuthentication();
  const customerReference=createOpaqueReference('mbc');
  const customer=await client.createCustomer({name:customerName,cpfCnpj:customerDocument,externalReference:customerReference,notificationDisabled:true});
  customerId=customer?.id;
  const orderReference=createOpaqueReference('mbo');
  const checkout=await client.createCheckout(buildAsaasCheckoutPayload({
    offer,paymentMethod:offer.billingModel==='RECURRENT'?'CREDIT_CARD':'PIX',externalReference:orderReference,customerId,serverNow:new Date()
  }));
  checkoutId=checkout?.id;
  if(!checkoutId||!checkout?.link||checkout.externalReference!==orderReference)throw new Error('Sandbox checkout response did not reconcile');
  console.log('Asaas Sandbox authentication, synthetic customer and checkout response validated. No access grant was created.');
}catch(error){
  console.error(`Asaas Sandbox homologation failed safely (${error?.name||'Error'}). No credential or customer data was printed.`);
  process.exitCode=1;
}finally{
  if(cleanup&&customerId){
    const client=createAsaasSandboxClient({environment:process.env.ASAAS_ENV,baseUrl:process.env.ASAAS_BASE_URL,apiKey:process.env.ASAAS_API_KEY,userAgent:'Mentoria Black / Sandbox',fetchImpl:fetch});
    let checkoutSafeToRemove=!checkoutId;
    if(checkoutId)try{await client.cancelCheckout(checkoutId);checkoutSafeToRemove=true}catch{}
    try{
      if(!checkoutSafeToRemove)throw new Error('checkout cancellation was not confirmed');
      await client.removeCustomer(customerId);
      console.log(checkoutId?'Sandbox checkout canceled and synthetic customer cleanup requested.':'Synthetic Sandbox customer cleanup requested after checkout failure.');
    }catch{
      console.error('Automatic Sandbox cleanup was not confirmed; review the synthetic resources in the Asaas Sandbox dashboard.');
      process.exitCode=1;
    }
  }
}
