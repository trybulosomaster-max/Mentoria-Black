export const KIWIFY_PAYLOAD_LIMIT_BYTES=256000;

export const KIWIFY_EVENT_TYPES=Object.freeze({
  activate:Object.freeze(['compra_aprovada','order_approved','purchase_approved']),
  renewal:Object.freeze(['subscription_renewed']),
  cancel:Object.freeze(['subscription_canceled','subscription_cancelled']),
  late:Object.freeze(['subscription_late']),
  expire:Object.freeze(['subscription_expired','access_expired']),
  refund:Object.freeze(['compra_reembolsada','order_refunded','purchase_refunded']),
  partial_refund:Object.freeze([
    'compra_parcialmente_reembolsada','order_partially_refunded',
    'purchase_partially_refunded','partial_refund'
  ]),
  chargeback:Object.freeze(['chargeback'])
});

const CORS_HEADERS=Object.freeze({
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization, content-type, x-kiwify-webhook-token, x-webhook-token, x-kiwify-token'
});

function firstString(...values){
  for(const value of values){
    if(typeof value==='string'&&value.trim())return value.trim();
    if(typeof value==='number'&&Number.isFinite(value))return String(value);
  }
  return null;
}

function getPath(object,paths){
  for(const path of paths){
    let current=object;
    for(const part of path.split('.')){
      if(current==null)break;
      current=current[part];
    }
    if(current!==undefined&&current!==null&&current!=='')return current;
  }
  return null;
}

function findByKey(object,keys,depth=0){
  if(object==null||depth>8||typeof object!=='object')return null;
  for(const [key,value] of Object.entries(object)){
    if(keys.includes(key.toLowerCase())&&value!==undefined&&value!==null&&value!=='')return value;
  }
  for(const value of Object.values(object)){
    if(value&&typeof value==='object'){
      const found=findByKey(value,keys,depth+1);
      if(found!==null)return found;
    }
  }
  return null;
}

function technicalId(value,label){
  const id=String(value||'').trim();
  if(!id)return null;
  if(id.length>200||!/^[A-Za-z0-9_&.-]+$/.test(id))throw new TypeError(`invalid ${label}`);
  return id;
}

function normalizeEmail(value){
  if(typeof value!=='string')return null;
  const email=value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}

function safeDisplayName(value){
  const name=String(value||'').trim();
  return name&&name.length<=160?name:null;
}

function eventAction(type){
  for(const [action,types] of Object.entries(KIWIFY_EVENT_TYPES)){
    if(types.includes(type))return action;
  }
  return 'informational';
}

export function constantTimeEqual(left,right){
  const a=new TextEncoder().encode(String(left||''));
  const b=new TextEncoder().encode(String(right||''));
  const length=Math.max(a.length,b.length,1);
  let difference=a.length^b.length;
  for(let index=0;index<length;index+=1){
    difference|=(a[index%Math.max(a.length,1)]||0)^(b[index%Math.max(b.length,1)]||0);
  }
  return difference===0;
}

export async function sha256Hex(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function hmacSha1Hex(secret,value){
  const key=await crypto.subtle.importKey(
    'raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']
  );
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function parseKiwifyMetadata(payload,payloadHash){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new TypeError('invalid webhook payload');
  if(payload.provider&&String(payload.provider).trim().toLowerCase()!=='kiwify')throw new TypeError('unexpected webhook provider');
  if(payload.environment&&String(payload.environment).trim().toLowerCase()!=='production')throw new TypeError('unexpected webhook environment');

  const type=String(firstString(
    getPath(payload,['webhook_event_type','event_type','eventType','type','event']),
    findByKey(payload,['webhook_event_type','event_type','eventtype'])
  )||'unknown').trim().toLowerCase();
  if(!/^[a-z][a-z0-9_]{1,99}$/.test(type))throw new TypeError('invalid webhook event type');

  const externalEventId=technicalId(firstString(
    getPath(payload,['event_id','eventId','webhook_id','webhookId','id','order_id','orderId']),
    findByKey(payload,['event_id','eventid','webhook_id','order_id','orderid'])
  ),'webhook event id');
  if(!externalEventId)throw new TypeError('webhook event id is required');

  const externalPurchaseId=technicalId(firstString(
    getPath(payload,['order_id','orderId','purchase_id','purchaseId','sale_id','saleId']),
    findByKey(payload,['order_id','orderid','purchase_id','purchaseid','sale_id','saleid']),
    externalEventId
  ),'purchase id');
  const externalSubscriptionId=technicalId(firstString(
    getPath(payload,['Subscription.id','subscription.id','subscription_id','subscriptionId']),
    findByKey(payload,['subscription_id','subscriptionid'])
  ),'subscription id');
  const externalCustomerId=technicalId(firstString(
    getPath(payload,['Customer.id','customer.id','customerId','customer_id']),
    findByKey(payload,['customer_id','customerid'])
  ),'customer id');
  const externalProductId=technicalId(firstString(
    getPath(payload,['Product.product_id','product.product_id','product_id','productId']),
    findByKey(payload,['product_id','productid'])
  ),'product id');
  const productName=safeDisplayName(firstString(
    getPath(payload,['Product.product_name','product.product_name','Product.name','product.name','product_name','productName']),
    findByKey(payload,['product_name','productname'])
  ));
  const customerEmail=normalizeEmail(
    getPath(payload,['Customer.email','customer.email','customerEmail','email','Buyer.email','buyer.email','client.email','cliente.email'])||
      findByKey(payload,['email','customer_email','customeremail'])
  );
  const customerName=safeDisplayName(firstString(
    getPath(payload,['Customer.full_name','Customer.first_name','customer.full_name','customer.first_name']),
    findByKey(payload,['customer_name','customername','full_name','firstname'])
  ));
  const rawAccessUntil=getPath(payload,[
    'Subscription.customer_access.access_until','subscription.customer_access.access_until',
    'Subscription.access_until','subscription.access_until'
  ]);
  let accessUntil=null;
  if(typeof rawAccessUntil==='string'&&rawAccessUntil.trim()){
    const date=new Date(rawAccessUntil);
    if(Number.isNaN(date.getTime()))throw new TypeError('invalid access until timestamp');
    accessUntil=date.toISOString();
  }

  return Object.freeze({
    provider:'kiwify',environment:'production',externalEventId,eventType:type,
    action:eventAction(type),payloadHash,externalPurchaseId,externalSubscriptionId,
    externalCustomerId,externalProductId,productName,customerEmail,customerName,accessUntil,
    legacyAppCandidate:(productName||'').trim().toLowerCase()==='mentoria black',
    requiresIdentity:['activate','renewal'].includes(eventAction(type)),
    testEvent:customerEmail==='johndoe@example.com'&&productName==='Example product'
  });
}

export function buildLegacyGrantWrite(metadata,userId,productId,now=new Date()){
  if(!metadata||!userId||!productId)throw new TypeError('legacy grant identity is required');
  const timestamp=(now instanceof Date?now:new Date(now)).toISOString();
  return Object.freeze({
    row:Object.freeze({
      user_id:String(userId),product_id:String(productId),status:'active',source:'kiwify',
      external_customer_id:metadata.externalCustomerId,
      external_purchase_id:metadata.externalPurchaseId,
      expires_at:metadata.accessUntil,revoked_at:null,updated_at:timestamp
    }),
    onConflict:'user_id,product_id'
  });
}

async function authenticated(request,rawBody,payload,expectedToken){
  // Production v4 historically accepted an 8-character Vault token. Preserve
  // that reader contract until a separately authorized rotation; new setters
  // installed by V2 still require 32+ characters.
  if(typeof expectedToken!=='string'||expectedToken.length<8||expectedToken.length>255)return false;
  const signature=new URL(request.url).searchParams.get('signature')?.trim().toLowerCase()||null;
  if(signature){
    if(!/^[0-9a-f]{40}$/.test(signature))return false;
    return constantTimeEqual(signature,await hmacSha1Hex(expectedToken,rawBody));
  }
  const authorization=request.headers.get('authorization')||'';
  const supplied=request.headers.get('x-kiwify-webhook-token')?.trim()||
    request.headers.get('x-webhook-token')?.trim()||
    request.headers.get('x-kiwify-token')?.trim()||
    (/^Bearer\s+\S+$/i.test(authorization)?authorization.replace(/^Bearer\s+/i,'').trim():null)||
    firstString(getPath(payload,['token','webhook_token','webhookToken']));
  return supplied?constantTimeEqual(supplied,expectedToken):false;
}

function json(body,status=200){
  return Response.json(body,{status,headers:CORS_HEADERS});
}

export function createKiwifyWebhookHandler({getToken,detectContract,processEvent,payloadLimit=KIWIFY_PAYLOAD_LIMIT_BYTES}){
  if(typeof getToken!=='function'||typeof detectContract!=='function'||typeof processEvent!=='function'){
    throw new TypeError('Kiwify server adapters are required');
  }
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS_HEADERS});
    if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
    const rawBody=await request.text();
    if(new TextEncoder().encode(rawBody).byteLength>payloadLimit)return json({ok:false,error:'payload_too_large'},413);
    let payload;
    try{payload=JSON.parse(rawBody)}catch{return json({ok:false,error:'invalid_json'},400)}

    let expectedToken;
    try{expectedToken=await getToken()}catch{return json({ok:false,error:'webhook_not_configured'},503)}
    if(!await authenticated(request,rawBody,payload,expectedToken))return json({ok:false,error:'unauthorized'},401);

    try{
      const metadata=parseKiwifyMetadata(payload,await sha256Hex(rawBody));
      const contract=await detectContract();
      if(!['legacy','commercial_v2'].includes(contract))throw new Error('unsupported commercial contract');
      const result=await processEvent({contract,metadata,payload});
      return json({
        ok:true,status:String(result?.status||'processed'),duplicate:result?.duplicate===true,
        contract
      });
    }catch(error){
      const invalid=error instanceof TypeError;
      return json({ok:false,error:invalid?'invalid_event':'processing_failed'},invalid?400:500);
    }
  };
}
