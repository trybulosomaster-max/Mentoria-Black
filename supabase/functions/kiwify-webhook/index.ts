import {createClient} from '@supabase/supabase-js';
import {
  buildLegacyGrantWrite,createKiwifyWebhookHandler,generateTemporaryPassword,
  validateStoredKiwifyWebhookToken
} from '../_shared/kiwify-webhook.mjs';

const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';

function namedSecret(jsonName:string,legacyName:string){
  const encoded=Deno.env.get(jsonName);
  if(encoded)try{return String(JSON.parse(encoded)?.default||'')}catch{return ''}
  return Deno.env.get(legacyName)||'';
}

const serverKey=namedSecret('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
const admin=createClient(supabaseUrl,serverKey,{auth:{autoRefreshToken:false,persistSession:false}});

function knownMissing(error:unknown,codes:string[]){
  const code=String((error as {code?:string})?.code||'');
  return codes.includes(code);
}

async function getToken(){
  const {data,error}=await admin.rpc('get_kiwify_webhook_token');
  if(error)throw new Error('Kiwify token is unavailable');
  return validateStoredKiwifyWebhookToken(data);
}

async function detectContract(){
  const contract=await admin.rpc('get_kiwify_webhook_contract_v2');
  if(!contract.error){
    if(contract.data!=='commercial_access_v2_kiwify_webhook_v1')throw new Error('unknown Kiwify V2 contract');
    return 'commercial_v2';
  }
  if(!knownMissing(contract.error,['PGRST202','42883']))throw new Error('Kiwify contract lookup failed');

  const marker=await admin.from('commercial_enforcement_state').select('schema_version').eq('singleton',true).maybeSingle();
  if(!marker.error&&marker.data)throw new Error('Commercial V2 exists without its Kiwify writer contract');
  if(marker.error&&!knownMissing(marker.error,['PGRST205','42P01']))throw new Error('Commercial marker lookup failed');
  return 'legacy';
}

async function findUserByEmail(email:string){
  const perPage=1000;
  for(let page=1;page<=100;page+=1){
    const result=await admin.auth.admin.listUsers({page,perPage});
    if(result.error)throw new Error('user lookup failed');
    const users=result.data?.users||[];
    const user=users.find(candidate=>String(candidate.email||'').trim().toLowerCase()===email);
    if(user)return user;
    if(users.length<perPage)return null;
  }
  throw new Error('user lookup safety limit reached');
}

async function resolveUser(metadata:Record<string,unknown>){
  const email=String(metadata.customerEmail||'').trim().toLowerCase();
  if(!email)throw new TypeError('confirmed customer email is required');
  let user=await findUserByEmail(email),newlyCreated=false;
  if(!user){
    const created=await admin.auth.admin.createUser({
      email,password:generateTemporaryPassword(),email_confirm:true,
      user_metadata:{source:'kiwify'}
    });
    if(created.error||!created.data.user){
      // A concurrent delivery may have created the same unique email first.
      user=await findUserByEmail(email);
      if(!user)throw new Error('user creation failed');
    }else{
      user=created.data.user;
      newlyCreated=true;
    }
  }
  const displayName=String(metadata.customerName||'').trim()||email.split('@')[0];
  const profile=await admin.from('profiles').upsert(
    {id:user.id,name:displayName,updated_at:new Date().toISOString()},{onConflict:'id'}
  );
  // Production's legacy writer enriches profiles; clean V82/Beta has no such
  // table. Absence is a supported contract, while any other profile error is not.
  if(profile.error&&!knownMissing(profile.error,['PGRST205','42P01'])){
    throw new Error('profile reconciliation failed');
  }
  return {userId:user.id,newlyCreated};
}

async function markLegacyEvent(eventId:string,patch:Record<string,unknown>={}){
  const result=await admin.from('payment_events').update({
    processed:true,processed_at:new Date().toISOString(),...patch
  }).eq('provider','kiwify').eq('event_id',eventId);
  if(result.error)throw new Error('legacy event finalization failed');
}

async function processLegacy(metadata:Record<string,any>,payload:Record<string,unknown>){
  const existing=await admin.from('payment_events').select('id,processed').eq('provider','kiwify')
    .eq('event_id',metadata.externalEventId).maybeSingle();
  if(existing.error)throw new Error('legacy event lookup failed');
  if(existing.data?.processed)return {status:'already_processed',duplicate:true};
  if(!existing.data){
    const inserted=await admin.from('payment_events').insert({
      provider:'kiwify',event_id:metadata.externalEventId,event_type:metadata.eventType,
      user_id:null,external_customer_id:metadata.externalCustomerId,
      external_purchase_id:metadata.externalPurchaseId,payload,processed:false
    });
    if(inserted.error&&inserted.error.code!=='23505')throw new Error('legacy event persistence failed');
  }
  if(metadata.testEvent){
    await markLegacyEvent(metadata.externalEventId);
    return {status:'test_event_received'};
  }

  if(['activate','renewal'].includes(metadata.action)){
    // The legacy database has no provider-offer mapping. Only the exact historical
    // product name may fall back to APP; an arbitrary Kiwify product ID is not proof.
    if(!metadata.legacyAppCandidate){
      await markLegacyEvent(metadata.externalEventId);
      return {status:'ignored_product'};
    }
    const identity=await resolveUser(metadata);
    const product=await admin.from('products').select('id').eq('slug','mentoria-black').eq('active',true).single();
    if(product.error||!product.data)throw new Error('legacy product lookup failed');
    const legacyWrite=buildLegacyGrantWrite(metadata,identity.userId,product.data.id);
    const grant=await admin.from('access_grants').upsert(legacyWrite.row,{onConflict:legacyWrite.onConflict});
    if(grant.error)throw new Error('legacy access grant failed');
    await markLegacyEvent(metadata.externalEventId,{user_id:identity.userId});
    return {status:'access_granted'};
  }

  const grants=admin.from('access_grants');
  if(metadata.action==='refund'||metadata.action==='chargeback'){
    const update=await grants.update({status:'revoked',revoked_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq('external_purchase_id',metadata.externalPurchaseId);
    if(update.error)throw new Error('legacy access revocation failed');
  }else if(metadata.action==='partial_refund'){
    await markLegacyEvent(metadata.externalEventId);
    return {status:'administrative_review'};
  }else if(metadata.action==='cancel'){
    const patch:Record<string,unknown>={updated_at:new Date().toISOString()};
    if(metadata.accessUntil)patch.expires_at=metadata.accessUntil;
    const update=await grants.update(patch).eq('external_purchase_id',metadata.externalPurchaseId);
    if(update.error)throw new Error('legacy cancellation failed');
  }else if(metadata.action==='late'){
    const update=await grants.update({status:'suspended',updated_at:new Date().toISOString()})
      .eq('external_purchase_id',metadata.externalPurchaseId);
    if(update.error)throw new Error('legacy late-state update failed');
  }else if(metadata.action==='expire'){
    const update=await grants.update({status:'expired',updated_at:new Date().toISOString()})
      .eq('external_purchase_id',metadata.externalPurchaseId);
    if(update.error)throw new Error('legacy expiration failed');
  }
  await markLegacyEvent(metadata.externalEventId);
  return {status:metadata.action==='informational'?'event_recorded':metadata.action};
}

async function processV2(metadata:Record<string,any>){
  let productCode:null|string=null,identity:null|{userId:string}=null;
  if(metadata.requiresIdentity&&!metadata.testEvent){
    const product=await admin.rpc('resolve_kiwify_product_v2',{
      p_external_product_id:metadata.externalProductId,
      p_product_name:metadata.productName
    });
    if(product.error)throw new Error('V2 product mapping failed');
    productCode=typeof product.data==='string'?product.data:null;
    if(productCode)identity=await resolveUser(metadata);
  }
  const processed=await admin.rpc('process_kiwify_webhook_event_v2',{
    p_external_event_id:metadata.externalEventId,
    p_event_type:metadata.eventType,
    p_action:metadata.testEvent?'informational':metadata.action,
    p_user_id:identity?.userId||null,
    p_product_code:productCode,
    p_external_customer_id:metadata.externalCustomerId,
    p_external_purchase_id:metadata.externalPurchaseId,
    p_external_subscription_id:metadata.externalSubscriptionId,
    p_access_until:metadata.accessUntil,
    p_payload_hash:metadata.payloadHash
  });
  if(processed.error||!processed.data)throw new Error('V2 Kiwify event processing failed');
  return {
    status:String(processed.data.status||'processed'),
    duplicate:processed.data.duplicate===true
  };
}

async function processEvent({contract,metadata,payload}:{contract:string,metadata:Record<string,any>,payload:Record<string,unknown>}){
  return contract==='legacy'?processLegacy(metadata,payload):processV2(metadata);
}

let handler:(request:Request)=>Promise<Response>;
try{
  if(!supabaseUrl||!serverKey)throw new Error('Supabase server configuration is missing');
  handler=createKiwifyWebhookHandler({getToken,detectContract,processEvent});
}catch{
  handler=async()=>Response.json({ok:false,error:'webhook_not_configured'},{status:503});
}

Deno.serve(handler);
