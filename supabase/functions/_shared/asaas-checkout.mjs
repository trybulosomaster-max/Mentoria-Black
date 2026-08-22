import {buildAsaasCheckoutPayload} from './asaas-client.mjs';
import {validateAsaasCallbackBase} from './asaas-offers.mjs';

const CORS_HEADERS='authorization, apikey, content-type, x-client-info';

export function createAsaasCheckoutCorsHandler(handler,callbackBaseUrl){
  if(typeof handler!=='function')throw new TypeError('checkout handler is required');
  const allowedOrigin=new URL(validateAsaasCallbackBase(callbackBaseUrl)).origin;
  return async request=>{
    const origin=request.headers.get('origin');
    if(origin&&origin!==allowedOrigin)return new Response('origin_not_allowed',{status:403});
    if(request.method==='OPTIONS'){
      if(origin!==allowedOrigin)return new Response('origin_required',{status:403});
      return new Response(null,{status:204,headers:{
        'access-control-allow-origin':allowedOrigin,
        'access-control-allow-methods':'POST, OPTIONS',
        'access-control-allow-headers':CORS_HEADERS,
        'access-control-max-age':'600',vary:'Origin'
      }});
    }
    const response=await handler(request);
    if(origin===allowedOrigin){
      const headers=new Headers(response.headers);
      headers.set('access-control-allow-origin',allowedOrigin);
      headers.set('access-control-allow-headers',CORS_HEADERS);
      headers.set('vary','Origin');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    return response;
  };
}

export function validateCheckoutRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('checkout request is required');
  const offerId=String(input.offerId||'').trim().toUpperCase(),paymentMethod=String(input.paymentMethod||'').trim().toUpperCase();
  if(!['APP_MONTHLY','APP_ANNUAL','KNOWLEDGE_LIFETIME','COMPLETE'].includes(offerId))throw new TypeError('invalid Sandbox offer');
  if(!['PIX','CREDIT_CARD'].includes(paymentMethod))throw new TypeError('invalid Sandbox payment method');
  return Object.freeze({offerId,paymentMethod});
}

export function createAsaasCheckoutHandler({authenticate,resolveOffer,orders,customers,client,serverNow=()=>new Date()}){
  if(typeof authenticate!=='function'||typeof resolveOffer!=='function'||!orders||!customers||!client)throw new TypeError('checkout server adapters are required');
  return async request=>{
    if(request.method!=='POST')return new Response('method_not_allowed',{status:405});
    let input,identity,order;
    try{
      identity=await authenticate(request);
      input=validateCheckoutRequest(await request.json());
      const offer=resolveOffer(input.offerId);
      order=await orders.create({userId:identity.userId,databaseOfferCode:offer.databaseOfferCode});
      const customer=await customers.find(identity.userId,'asaas','sandbox');
      const payload=buildAsaasCheckoutPayload({offer,paymentMethod:input.paymentMethod,externalReference:order.externalReference,customerId:customer?.externalCustomerId,serverNow:serverNow()});
      const checkout=await client.createCheckout(payload);
      let checkoutUrl;
      try{checkoutUrl=new URL(String(checkout?.link||''))}catch{throw new Error('Asaas checkout response failed reconciliation')}
      if(!checkout?.id||checkoutUrl.protocol!=='https:'||checkoutUrl.hostname!=='sandbox.asaas.com'||checkout.externalReference!==order.externalReference)throw new Error('Asaas checkout response failed reconciliation');
      await orders.complete({orderId:order.orderId,externalReference:order.externalReference,externalCheckoutId:checkout.id});
      return Response.json({checkoutUrl:checkoutUrl.href,status:'pending_confirmation'},{status:201});
    }catch(error){
      if(order)try{await orders.fail({orderId:order.orderId,externalReference:order.externalReference,errorCode:error?.name==='AsaasApiError'?'asaas_request_failed':'checkout_failed'})}catch{}
      const status=error?.code==='unauthorized'?401:error instanceof TypeError?400:/disabled|not configured/.test(String(error?.message))?503:502;
      return Response.json({error:status===401?'unauthorized':status===400?'invalid_request':status===503?'offer_unavailable':'checkout_unavailable'},{status});
    }
  };
}
