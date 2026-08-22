export const PAYMENT_EVENTS=Object.freeze([
  'PAYMENT_CREATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED','PAYMENT_DELETED',
  'PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_REFUND_IN_PROGRESS','PAYMENT_REFUND_DENIED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE','PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
]);

export const SUBSCRIPTION_EVENTS=Object.freeze([
  'SUBSCRIPTION_CREATED','SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED'
]);

export const CHECKOUT_EVENTS=Object.freeze([
  'CHECKOUT_CREATED','CHECKOUT_CANCELED','CHECKOUT_EXPIRED','CHECKOUT_PAID'
]);

const SUPPORTED=new Set([...PAYMENT_EVENTS,...SUBSCRIPTION_EVENTS,...CHECKOUT_EVENTS]);

export function classifyAsaasEvent(event){
  if(event==='PAYMENT_CONFIRMED'||event==='PAYMENT_RECEIVED')return 'grant_activate';
  if(event==='PAYMENT_OVERDUE')return 'grant_grace';
  if(event==='PAYMENT_PARTIALLY_REFUNDED')return 'administrative_review';
  if(event==='PAYMENT_REFUNDED'||event==='PAYMENT_RECEIVED_IN_CASH_UNDONE'||event.startsWith('PAYMENT_CHARGEBACK_')||event==='PAYMENT_AWAITING_CHARGEBACK_REVERSAL')return 'grant_revoke';
  return 'informational';
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

function technicalId(value,label){
  const id=String(value||'').trim();
  if(!id)return null;
  if(id.length>200||!/^[A-Za-z0-9_&.-]+$/.test(id))throw new TypeError(`invalid ${label}`);
  return id;
}

export function safeEventMetadata(payload,payloadHash){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new TypeError('invalid webhook payload');
  if(payload.provider&&String(payload.provider).toLowerCase()!=='asaas')throw new TypeError('unexpected webhook provider');
  if(payload.environment&&String(payload.environment).toLowerCase()!=='sandbox')throw new TypeError('unexpected webhook environment');
  const externalEventId=technicalId(payload.id,'webhook event id');
  const eventType=String(payload.event||'').trim().toUpperCase();
  if(!externalEventId||!eventType)throw new TypeError('webhook id and event are required');
  if(!/^[A-Z][A-Z0-9_]{1,100}$/.test(eventType))throw new TypeError('invalid webhook event type');
  const payment=payload.payment&&typeof payload.payment==='object'?payload.payment:{};
  const subscription=payload.subscription&&typeof payload.subscription==='object'?payload.subscription:{};
  const checkout=payload.checkout&&typeof payload.checkout==='object'?payload.checkout:{};
  const externalCustomerId=technicalId(payment.customer||subscription.customer||checkout.customer,'customer id');
  const externalPaymentId=technicalId(payment.id,'payment id');
  const externalSubscriptionId=technicalId(subscription.id||payment.subscription,'subscription id');
  const externalCheckoutId=technicalId(checkout.id,'checkout id');
  const rawReference=String(payment.externalReference||subscription.externalReference||checkout.externalReference||'').trim();
  const externalReference=/^mbo_[A-Za-z0-9_-]{24,96}$/.test(rawReference)?rawReference:null;
  const billingPeriodAnchor=String(payment.dueDate||'').trim()||null;
  if(billingPeriodAnchor&&!/^\d{4}-\d{2}-\d{2}$/.test(billingPeriodAnchor))throw new TypeError('invalid payment due date');
  return Object.freeze({
    provider:'asaas',environment:'sandbox',externalEventId,eventType,
    classification:classifyAsaasEvent(eventType),supported:SUPPORTED.has(eventType),
    payloadHash,externalCustomerId,externalPaymentId,externalSubscriptionId,externalCheckoutId,externalReference,billingPeriodAnchor
  });
}

export function createAsaasWebhookHandler({expectedToken,environment='sandbox',recordEvent}){
  if(environment!=='sandbox')throw new Error('commercial access v2 webhook is sandbox-only');
  if(!expectedToken||expectedToken.length<32||expectedToken.length>255)throw new Error('strong sandbox webhook token is required');
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
