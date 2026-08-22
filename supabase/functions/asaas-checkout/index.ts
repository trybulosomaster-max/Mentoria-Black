import {createAsaasSandboxClient,createOpaqueReference} from '../_shared/asaas-client.mjs';
import {createAsaasCheckoutCorsHandler,createAsaasCheckoutHandler} from '../_shared/asaas-checkout.mjs';
import {resolveAsaasSandboxOffer} from '../_shared/asaas-offers.mjs';

const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';
function namedSecret(jsonName:string,legacyName:string){
  const encoded=Deno.env.get(jsonName);
  if(encoded)try{return String(JSON.parse(encoded)?.default||'')}catch{return ''}
  return Deno.env.get(legacyName)||'';
}
const publishableKey=namedSecret('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
const serverKey=namedSecret('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');

function serverHeaders(extra:Record<string,string>={}){
  const headers:Record<string,string>={apikey:serverKey,'content-type':'application/json',...extra};
  if(serverKey.startsWith('eyJ'))headers.authorization=`Bearer ${serverKey}`;
  return headers;
}
async function jsonOrThrow(response:Response,label:string){
  if(!response.ok)throw new Error(`${label} failed (${response.status})`);
  return response.status===204?null:response.json();
}

async function authenticate(request:Request){
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer\s+\S+$/.test(authorization)){const error:any=new Error('authentication required');error.code='unauthorized';throw error}
  const response=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:publishableKey,authorization}});
  if(!response.ok){const error:any=new Error('invalid session');error.code='unauthorized';throw error}
  const user=await response.json();
  if(!user?.id){const error:any=new Error('invalid session');error.code='unauthorized';throw error}
  return {userId:String(user.id)};
}

const orders={
  async create({userId,databaseOfferCode}:{userId:string,databaseOfferCode:string}){
    const offerResponse=await fetch(`${supabaseUrl}/rest/v1/commercial_offers?code=eq.${encodeURIComponent(databaseOfferCode)}&select=id,code&limit=1`,{headers:serverHeaders()});
    const offers=await jsonOrThrow(offerResponse,'offer lookup');
    if(!Array.isArray(offers)||offers.length!==1)throw new Error('configured offer is unavailable');
    const externalReference=createOpaqueReference('mbo');
    const response=await fetch(`${supabaseUrl}/rest/v1/billing_orders`,{
      method:'POST',headers:serverHeaders({prefer:'return=representation'}),
      body:JSON.stringify({user_id:userId,offer_id:offers[0].id,provider:'asaas',environment:'sandbox',status:'created',external_reference:externalReference})
    });
    const rows=await jsonOrThrow(response,'billing order creation');
    if(!Array.isArray(rows)||rows.length!==1)throw new Error('billing order creation was not unique');
    return {orderId:rows[0].id,externalReference};
  },
  async complete({orderId,externalReference,externalCheckoutId}:{orderId:string,externalReference:string,externalCheckoutId:string}){
    const response=await fetch(`${supabaseUrl}/rest/v1/billing_orders?id=eq.${encodeURIComponent(orderId)}&external_reference=eq.${encodeURIComponent(externalReference)}&status=eq.created`,{
      method:'PATCH',headers:serverHeaders({prefer:'return=representation'}),body:JSON.stringify({status:'pending',external_checkout_id:externalCheckoutId})
    });
    const rows=await jsonOrThrow(response,'checkout reconciliation');
    if(!Array.isArray(rows)||rows.length!==1)throw new Error('checkout reconciliation conflict');
  },
  async fail({orderId,externalReference}:{orderId:string,externalReference:string}){
    await fetch(`${supabaseUrl}/rest/v1/billing_orders?id=eq.${encodeURIComponent(orderId)}&external_reference=eq.${encodeURIComponent(externalReference)}&status=eq.created`,{
      method:'PATCH',headers:serverHeaders(),body:JSON.stringify({status:'failed'})
    });
  }
};

const customers={
  async find(userId:string){
    const response=await fetch(`${supabaseUrl}/rest/v1/billing_customers?user_id=eq.${encodeURIComponent(userId)}&provider=eq.asaas&environment=eq.sandbox&select=external_customer_id&limit=1`,{headers:serverHeaders()});
    const rows=await jsonOrThrow(response,'customer mapping lookup');
    return Array.isArray(rows)&&rows[0]?.external_customer_id?{externalCustomerId:rows[0].external_customer_id}:null;
  }
};

let handler:(request:Request)=>Promise<Response>;
try{
  if(!supabaseUrl||!publishableKey||!serverKey)throw new Error('Supabase server configuration missing');
  const client=createAsaasSandboxClient({
    environment:Deno.env.get('ASAAS_ENV')||'',baseUrl:Deno.env.get('ASAAS_BASE_URL')||'',apiKey:Deno.env.get('ASAAS_API_KEY')||'',
    userAgent:'Mentoria Black / Sandbox',fetchImpl:fetch
  });
  const checkoutHandler=createAsaasCheckoutHandler({authenticate,resolveOffer:offerId=>resolveAsaasSandboxOffer(offerId,Deno.env),orders,customers,client});
  handler=createAsaasCheckoutCorsHandler(checkoutHandler,Deno.env.get('ASAAS_CALLBACK_BASE_URL')||'');
}catch{
  handler=async()=>Response.json({error:'sandbox_checkout_not_configured'},{status:503});
}

Deno.serve(handler);
