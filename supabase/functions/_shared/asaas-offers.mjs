export const ASAAS_SANDBOX_BASE_URL='https://api-sandbox.asaas.com/v3';

const CALLBACK_PATH='commercial/checkout-callback.html';

export const ASAAS_SANDBOX_OFFERS=Object.freeze({
  APP_MONTHLY:Object.freeze({
    internalOfferId:'APP_MONTHLY',databaseOfferCode:'APP_MONTHLY',entitlements:Object.freeze(['APP']),
    provider:'asaas',environment:'sandbox',billingModel:'RECURRENT',cycle:'MONTHLY',
    priceConfigKey:'ASAAS_PRICE_APP_MONTHLY',enabledConfigKey:'ASAAS_ENABLE_APP_MONTHLY',externalOfferId:null
  }),
  APP_ANNUAL:Object.freeze({
    internalOfferId:'APP_ANNUAL',databaseOfferCode:'APP_ANNUAL',entitlements:Object.freeze(['APP']),
    provider:'asaas',environment:'sandbox',billingModel:'RECURRENT',cycle:'YEARLY',
    priceConfigKey:'ASAAS_PRICE_APP_ANNUAL',enabledConfigKey:'ASAAS_ENABLE_APP_ANNUAL',externalOfferId:null
  }),
  KNOWLEDGE_LIFETIME:Object.freeze({
    internalOfferId:'KNOWLEDGE_LIFETIME',databaseOfferCode:'KNOWLEDGE_LIFETIME',entitlements:Object.freeze(['KNOWLEDGE']),
    provider:'asaas',environment:'sandbox',billingModel:'DETACHED',cycle:null,
    priceConfigKey:'ASAAS_PRICE_KNOWLEDGE_LIFETIME',enabledConfigKey:'ASAAS_ENABLE_KNOWLEDGE_LIFETIME',externalOfferId:null
  }),
  COMPLETE:Object.freeze({
    internalOfferId:'COMPLETE',databaseOfferCode:null,entitlements:Object.freeze(['APP','KNOWLEDGE']),
    provider:'asaas',environment:'sandbox',billingModel:'RECURRENT',cycle:null,
    priceConfigKey:'ASAAS_PRICE_COMPLETE',enabledConfigKey:'ASAAS_ENABLE_COMPLETE',externalOfferId:null
  })
});

function read(config,key){
  if(typeof config==='function')return config(key);
  if(config&&typeof config.get==='function')return config.get(key);
  return config?.[key];
}

function enabled(value){return String(value||'').trim().toLowerCase()==='true'}

function positiveMoney(value,key){
  const text=String(value||'').trim();
  if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)||Number(text)<=0)throw new Error(`${key} is not configured with a positive sandbox value`);
  return Number(text);
}

export function validateAsaasCallbackBase(value){
  const text=String(value||'').trim().replace(/\/+$/,'');
  let url;
  try{url=new URL(text)}catch{throw new Error('ASAAS_CALLBACK_BASE_URL must be a valid HTTPS URL')}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('ASAAS_CALLBACK_BASE_URL must be a credential-free HTTPS origin/path');
  return text;
}

export function resolveAsaasSandboxOffer(offerId,config){
  const code=String(offerId||'').trim().toUpperCase();
  const definition=ASAAS_SANDBOX_OFFERS[code];
  if(!definition)throw new TypeError('unsupported Asaas Sandbox offer');
  if(String(read(config,'ASAAS_ENV')||'').trim().toLowerCase()!=='sandbox')throw new Error('Asaas offer configuration is sandbox-only');
  if(String(read(config,'ASAAS_BASE_URL')||'').trim()!==ASAAS_SANDBOX_BASE_URL)throw new Error('Asaas Sandbox base URL mismatch');
  if(!enabled(read(config,definition.enabledConfigKey)))throw new Error(`${code} is disabled`);
  const price=positiveMoney(read(config,definition.priceConfigKey),definition.priceConfigKey);
  const base=validateAsaasCallbackBase(read(config,'ASAAS_CALLBACK_BASE_URL'));
  let cycle=definition.cycle,databaseOfferCode=definition.databaseOfferCode;
  if(code==='COMPLETE'){
    cycle=String(read(config,'ASAAS_COMPLETE_CYCLE')||'').trim().toUpperCase();
    if(!['MONTHLY','YEARLY'].includes(cycle))throw new Error('ASAAS_COMPLETE_CYCLE must be MONTHLY or YEARLY');
    databaseOfferCode=cycle==='MONTHLY'?'COMPLETE_MONTHLY':'COMPLETE_ANNUAL';
  }
  const callbackConfig=Object.freeze({
    successUrl:`${base}/${CALLBACK_PATH}?state=success`,
    cancelUrl:`${base}/${CALLBACK_PATH}?state=cancel`,
    expiredUrl:`${base}/${CALLBACK_PATH}?state=expired`
  });
  return Object.freeze({...definition,databaseOfferCode,cycle,price,enabled:true,callbackConfig});
}
