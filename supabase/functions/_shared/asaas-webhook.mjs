export const PAYMENT_EVENTS=Object.freeze([
  'PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED','PAYMENT_DELETED',
  'PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE','PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
]);

export const SUBSCRIPTION_EVENTS=Object.freeze([
  'SUBSCRIPTION_CREATED','SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED'
]);

const SUPPORTED=new Set([...PAYMENT_EVENTS,...SUBSCRIPTION_EVENTS]);

export function classifyAsaasEvent(event){
  if(event==='PAYMENT_CONFIRMED')return 'confirmed';
  if(event==='PAYMENT_RECEIVED')return 'received';
  if(event==='PAYMENT_OVERDUE')return 'past_due';
  if(event==='PAYMENT_CREDIT_CARD_CAPTURE_REFUSED')return 'failed';
  if(event==='PAYMENT_DELETED'||event==='SUBSCRIPTION_INACTIVATED'||event==='SUBSCRIPTION_DELETED')return 'cancelled';
  if(event==='PAYMENT_REFUNDED'||event==='PAYMENT_PARTIALLY_REFUNDED'||event==='PAYMENT_RECEIVED_IN_CASH_UNDONE')return 'refunded';
  if(event.startsWith('PAYMENT_CHARGEBACK_')||event==='PAYMENT_AWAITING_CHARGEBACK_REVERSAL')return 'chargeback';
  if(event==='SUBSCRIPTION_CREATED'||event==='SUBSCRIPTION_UPDATED')return 'subscription_update';
  return 'ignored';
}

export function constantTimeEqual(left,right){
  const a=new TextEncoder().encode(String(left||''));
  const b=new TextEncoder().encode(String(right||''));
  const length=Math.max(a.length,b.length);
  let difference=a.length^b.length;
  for(let i=0;i<length;i++)difference|=(a[i%Math.max(1,a.length)]||0)^(b[i%Math.max(1,b.length)]||0);
  return difference===0;
}

export async function sha256Hex(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function safeEventMetadata(payload,payloadHash){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new TypeError('invalid webhook payload');
  const externalEventId=String(payload.id||'').trim();
  const eventType=String(payload.event||'').trim().toUpperCase();
  if(!externalEventId||!eventType)throw new TypeError('webhook id and event are required');
  const payment=payload.payment&&typeof payload.payment==='object'?payload.payment:{};
  const subscription=payload.subscription&&typeof payload.subscription==='object'?payload.subscription:{};
  const externalCustomerId=String(payment.customer||subscription.customer||'').trim()||null;
  const externalPaymentId=String(payment.id||'').trim()||null;
  const externalSubscriptionId=String(subscription.id||payment.subscription||'').trim()||null;
  return Object.freeze({
    provider:'asaas',environment:'sandbox',externalEventId,eventType,
    classification:classifyAsaasEvent(eventType),supported:SUPPORTED.has(eventType),
    payloadHash,externalCustomerId,externalPaymentId,externalSubscriptionId
  });
}

export function createAsaasWebhookHandler({expectedToken,environment='sandbox',recordEvent}){
  if(environment!=='sandbox')throw new Error('commercial access v1 webhook is sandbox-only');
  if(!expectedToken||expectedToken.length<32)throw new Error('strong sandbox webhook token is required');
  if(typeof recordEvent!=='function')throw new TypeError('recordEvent adapter is required');
  return async request=>{
    if(request.method!=='POST')return new Response('method_not_allowed',{status:405});
    if(!constantTimeEqual(request.headers.get('asaas-access-token'),expectedToken))return new Response('unauthorized',{status:401});
    const raw=await request.text();
    if(raw.length>256000)return new Response('payload_too_large',{status:413});
    let payload;
    try{payload=JSON.parse(raw)}catch{return new Response('invalid_json',{status:400})}
    try{
      const metadata=safeEventMetadata(payload,await sha256Hex(raw));
      const result=await recordEvent(metadata);
      return Response.json({accepted:true,duplicate:result?.duplicate===true,supported:metadata.supported},{status:200});
    }catch(error){
      return Response.json({accepted:false,error:'invalid_event'},{status:error instanceof TypeError?400:500});
    }
  };
}
