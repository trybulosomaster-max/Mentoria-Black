'use strict';

const PROVIDERS=Object.freeze(['asaas','kiwify','hotmart','eduzz','manual','trial']);
const BILLING_MODES=Object.freeze(['subscription','one_time']);
const ASAAS_PAYMENT_METHODS=Object.freeze(['PIX','CREDIT_CARD']);
const OFFER_CODES=Object.freeze({appMonthly:'APP_MONTHLY',appAnnual:'APP_ANNUAL',knowledge:'KNOWLEDGE_LIFETIME',complete:'COMPLETE'});

function requireSandbox(environment){if(environment!=='sandbox')throw new Error('commercial access v2 provider adapters are sandbox-only');return environment}
function checkoutIntent(input){
  if(!input||typeof input!=='object')throw new TypeError('checkout input is required');
  const environment=requireSandbox(input.environment),offerCode=String(input.offerCode||'').trim().toUpperCase(),paymentMethod=String(input.paymentMethod||'').trim().toUpperCase();
  if(!Object.values(OFFER_CODES).includes(offerCode))throw new TypeError('invalid offer code');
  if(!ASAAS_PAYMENT_METHODS.includes(paymentMethod))throw new TypeError('unsupported sandbox payment method');
  return Object.freeze({environment,offerCode,paymentMethod});
}
function createMockCheckoutAdapter(){
  const create=offerCode=>async input=>Object.freeze({mock:true,network:false,checkoutCreated:false,offerCode,paymentMethod:String(input?.paymentMethod||'PIX').toUpperCase(),message:'Checkout Sandbox ainda não configurado.'});
  return Object.freeze({createAppMonthlyCheckout:create(OFFER_CODES.appMonthly),createAppAnnualCheckout:create(OFFER_CODES.appAnnual),createKnowledgeCheckout:create(OFFER_CODES.knowledge),createCompleteCheckout:create(OFFER_CODES.complete)});
}
function createAsaasSandboxCheckoutAdapter({invoke}={}){
  if(typeof invoke!=='function')throw new TypeError('authenticated Edge Function invoker is required');
  const create=offerId=>async input=>{
    const paymentMethod=String(input?.paymentMethod||'').trim().toUpperCase();
    checkoutIntent({environment:'sandbox',offerCode:offerId,paymentMethod});
    const result=await invoke('asaas-checkout',{body:{offerId,paymentMethod}});
    if(result?.error)throw result.error;
    let checkoutUrl;try{checkoutUrl=new URL(String(result?.data?.checkoutUrl||''))}catch{throw new Error('invalid Sandbox checkout response')}
    if(checkoutUrl.protocol!=='https:'||checkoutUrl.hostname!=='sandbox.asaas.com'||result.data.status!=='pending_confirmation')throw new Error('invalid Sandbox checkout response');
    return Object.freeze({checkoutUrl:checkoutUrl.href,status:result.data.status});
  };
  return Object.freeze({createAppMonthlyCheckout:create(OFFER_CODES.appMonthly),createAppAnnualCheckout:create(OFFER_CODES.appAnnual),createKnowledgeCheckout:create(OFFER_CODES.knowledge),createCompleteCheckout:create(OFFER_CODES.complete)});
}
function assertProviderAdapter(adapter){for(const method of ['createCustomer','createCheckout','createSubscription','fetchPayment'])if(typeof adapter?.[method]!=='function')throw new TypeError(`provider adapter missing ${method}`);return adapter}
const api={PROVIDERS,BILLING_MODES,ASAAS_PAYMENT_METHODS,OFFER_CODES,requireSandbox,checkoutIntent,createMockCheckoutAdapter,createAsaasSandboxCheckoutAdapter,assertProviderAdapter};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof globalThis!=='undefined')globalThis.MBCommercialProvider=Object.freeze(api);
