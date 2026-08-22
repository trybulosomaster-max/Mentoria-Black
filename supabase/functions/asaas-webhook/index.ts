import {createAsaasWebhookHandler} from '../_shared/asaas-webhook.mjs';

const environment=Deno.env.get('ASAAS_ENV')||'';
const expectedToken=Deno.env.get('ASAAS_WEBHOOK_TOKEN')||'';
const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';

function namedSecret(jsonName:string,legacyName:string){
  const encoded=Deno.env.get(jsonName);
  if(encoded)try{return String(JSON.parse(encoded)?.default||'')}catch{return ''}
  return Deno.env.get(legacyName)||'';
}
const serverKey=namedSecret('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
function serverHeaders(){
  const headers:Record<string,string>={apikey:serverKey,'content-type':'application/json'};
  if(serverKey.startsWith('eyJ'))headers.authorization=`Bearer ${serverKey}`;
  return headers;
}

async function recordEvent(event:Record<string,unknown>){
  if(!supabaseUrl||!serverKey)throw new Error('server-side Supabase secrets are not configured');
  const response=await fetch(`${supabaseUrl}/rest/v1/payment_events?on_conflict=provider,environment,external_event_id`,{
    method:'POST',
    headers:{
      ...serverHeaders(),
      prefer:'resolution=ignore-duplicates,return=representation'
    },
    body:JSON.stringify({
      provider:event.provider,
      environment:event.environment,
      external_event_id:event.externalEventId,
      event_type:event.eventType,
      status:event.supported?'received':'ignored',
      payload_hash:event.payloadHash,
      external_customer_id:event.externalCustomerId,
      external_purchase_id:event.externalReference,
      external_payment_id:event.externalPaymentId,
      external_subscription_id:event.externalSubscriptionId,
      external_checkout_id:event.externalCheckoutId,
      billing_period_anchor:event.billingPeriodAnchor
    })
  });
  if(!response.ok)throw new Error(`payment event persistence failed (${response.status})`);
  const rows=await response.json();
  const duplicate=Array.isArray(rows)&&rows.length===0;
  if(!duplicate&&rows[0]?.id){
    const processed=await fetch(`${supabaseUrl}/rest/v1/rpc/process_payment_event_v1`,{
      method:'POST',headers:serverHeaders(),
      body:JSON.stringify({p_event_id:rows[0].id})
    });
    if(!processed.ok)throw new Error(`payment event processing failed (${processed.status})`);
  }
  return {duplicate};
}

let handler:ReturnType<typeof createAsaasWebhookHandler>;
try{
  if(expectedToken===Deno.env.get('ASAAS_API_KEY'))throw new Error('webhook token must be independent from API key');
  handler=createAsaasWebhookHandler({expectedToken,environment,recordEvent});
}catch{
  handler=async()=>new Response('sandbox_webhook_not_configured',{status:503});
}

Deno.serve(handler);
