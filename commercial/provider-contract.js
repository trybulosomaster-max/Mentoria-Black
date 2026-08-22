'use strict';

const PROVIDERS=Object.freeze(['asaas','kiwify','hotmart','eduzz','manual','trial']);
const BILLING_MODES=Object.freeze(['subscription','one_time']);
const ASAAS_PAYMENT_METHODS=Object.freeze(['PIX','CREDIT_CARD']);

function requireSandbox(environment){
  if(environment!=='sandbox')throw new Error('commercial access v1 provider adapters are sandbox-only');
  return environment;
}

function checkoutIntent(input){
  if(!input||typeof input!=='object')throw new TypeError('checkout input is required');
  const environment=requireSandbox(input.environment);
  const offerCode=String(input.offerCode||'').trim().toUpperCase();
  const paymentMethod=String(input.paymentMethod||'').trim().toUpperCase();
  if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(offerCode))throw new TypeError('invalid offer code');
  if(!ASAAS_PAYMENT_METHODS.includes(paymentMethod))throw new TypeError('unsupported sandbox payment method');
  return Object.freeze({environment,offerCode,paymentMethod});
}

function assertProviderAdapter(adapter){
  for(const method of ['createCustomer','createCheckout','createSubscription','fetchPayment']){
    if(typeof adapter?.[method]!=='function')throw new TypeError(`provider adapter missing ${method}`);
  }
  return adapter;
}

module.exports={PROVIDERS,BILLING_MODES,ASAAS_PAYMENT_METHODS,requireSandbox,checkoutIntent,assertProviderAdapter};
