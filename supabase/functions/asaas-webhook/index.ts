import {createAsaasWebhookHandler} from '../_shared/asaas-webhook.mjs';

const environment=Deno.env.get('ASAAS_ENVIRONMENT')||'sandbox';
const expectedToken=Deno.env.get('ASAAS_WEBHOOK_TOKEN')||'';
const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';
const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';

async function recordEvent(event:Record<string,unknown>){
  if(!supabaseUrl||!serviceRoleKey)throw new Error('server-side Supabase secrets are not configured');
  const response=await fetch(`${supabaseUrl}/rest/v1/payment_events?on_conflict=provider,environment,external_event_id`,{
    method:'POST',
    headers:{
      apikey:serviceRoleKey,
      authorization:`Bearer ${serviceRoleKey}`,
      'content-type':'application/json',
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
      external_payment_id:event.externalPaymentId,
      external_subscription_id:event.externalSubscriptionId
    })
  });
  if(!response.ok)throw new Error(`payment event persistence failed (${response.status})`);
  const rows=await response.json();
  const duplicate=Array.isArray(rows)&&rows.length===0;
  if(!duplicate&&rows[0]?.id){
    const processed=await fetch(`${supabaseUrl}/rest/v1/rpc/process_payment_event_v1`,{
      method:'POST',headers:{apikey:serviceRoleKey,authorization:`Bearer ${serviceRoleKey}`,'content-type':'application/json'},
      body:JSON.stringify({p_event_id:rows[0].id})
    });
    if(!processed.ok)throw new Error(`payment event processing failed (${processed.status})`);
  }
  return {duplicate};
}

let handler:ReturnType<typeof createAsaasWebhookHandler>;
try{
  handler=createAsaasWebhookHandler({expectedToken,environment,recordEvent});
}catch{
  handler=async()=>new Response('sandbox_webhook_not_configured',{status:503});
}

Deno.serve(handler);
