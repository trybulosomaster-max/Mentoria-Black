import {ASAAS_SANDBOX_BASE_URL} from './asaas-offers.mjs';

export const ASAAS_SANDBOX_KEY_PREFIX='$aact_hmlg_';
export const ASAAS_PRODUCTION_KEY_PREFIX='$aact_prod_';
export const ASAAS_USER_AGENT='Mentoria Black / Sandbox';
export const ASAAS_PAYMENT_METHODS=Object.freeze(['PIX','CREDIT_CARD']);

export class AsaasApiError extends Error{
  constructor(status,codes=[]){super(`Asaas Sandbox request failed (${status}${codes.length?`; ${codes.join(',')}`:''})`);this.name='AsaasApiError';this.status=status;this.codes=Object.freeze([...codes])}
}

export function assertAsaasSandboxConfig({environment,baseUrl,apiKey,userAgent=ASAAS_USER_AGENT}){
  if(environment!=='sandbox')throw new Error('Asaas adapter is sandbox-only');
  if(baseUrl!==ASAAS_SANDBOX_BASE_URL)throw new Error('Asaas Sandbox base URL mismatch');
  if(typeof apiKey==='string'&&apiKey.startsWith(ASAAS_PRODUCTION_KEY_PREFIX))throw new Error('production Asaas keys are prohibited');
  if(typeof apiKey!=='string'||!apiKey.startsWith(ASAAS_SANDBOX_KEY_PREFIX)||apiKey.length<20)throw new Error('a Sandbox API key is required');
  if(userAgent!==ASAAS_USER_AGENT)throw new Error('Asaas Sandbox User-Agent mismatch');
  return Object.freeze({environment,baseUrl,apiKey,userAgent});
}

function pathOnly(path){
  const value=String(path||'');
  if(!value.startsWith('/')||value.startsWith('//')||value.includes('..')||/^https?:/i.test(value))throw new TypeError('Asaas path must be relative to the fixed Sandbox base URL');
  return value;
}

function safeErrorCodes(payload){
  const entries=Array.isArray(payload?.errors)?payload.errors:[];
  return entries.map(item=>String(item?.code||'').trim()).filter(code=>/^[a-z0-9_.-]{1,80}$/i.test(code)).slice(0,5);
}

async function parseJson(response){
  const text=await response.text();
  if(!text)return {};
  if(text.length>1024*1024)throw new AsaasApiError(response.status,['response_too_large']);
  try{return JSON.parse(text)}catch{throw new AsaasApiError(response.status,['invalid_json_response'])}
}

export function createAsaasSandboxClient(options){
  const config=assertAsaasSandboxConfig(options||{});
  const fetchImpl=options?.fetchImpl||globalThis.fetch;
  if(typeof fetchImpl!=='function')throw new TypeError('fetch implementation is required');
  async function request(path,{method='GET',body}={}){
    const response=await fetchImpl(`${config.baseUrl}${pathOnly(path)}`,{
      method,headers:{accept:'application/json','content-type':'application/json',access_token:config.apiKey,'user-agent':config.userAgent},
      redirect:'error',signal:AbortSignal.timeout(15000),
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const payload=await parseJson(response);
    if(!response.ok)throw new AsaasApiError(response.status,safeErrorCodes(payload));
    return payload;
  }
  return Object.freeze({
    probeAuthentication:()=>request('/customers?limit=1'),
    listCustomersByExternalReference:reference=>request(`/customers?limit=2&externalReference=${encodeURIComponent(assertExternalReference(reference))}`),
    createCustomer:customer=>request('/customers',{method:'POST',body:validateCustomer(customer)}),
    removeCustomer:id=>request(`/customers/${encodeURIComponent(assertExternalId(id,'customer'))}`,{method:'DELETE'}),
    createCheckout:payload=>request('/checkouts',{method:'POST',body:payload}),
    cancelCheckout:id=>request(`/checkouts/${encodeURIComponent(assertExternalId(id,'checkout'))}/cancel`,{method:'POST'})
  });
}

export function assertExternalReference(value){
  const reference=String(value||'').trim();
  if(!/^mb[osc]_[A-Za-z0-9_-]{24,96}$/.test(reference))throw new TypeError('invalid opaque external reference');
  return reference;
}

export function assertExternalId(value,label='resource'){
  const id=String(value||'').trim();
  if(!/^[A-Za-z0-9_-]{6,100}$/.test(id))throw new TypeError(`invalid Asaas ${label} id`);
  return id;
}

export function createOpaqueReference(prefix='mbo',cryptoImpl=globalThis.crypto){
  if(!['mbo','mbc','mbs'].includes(prefix)||!cryptoImpl?.getRandomValues)throw new TypeError('secure random reference generator is required');
  const bytes=cryptoImpl.getRandomValues(new Uint8Array(24));
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  const encoded=typeof btoa==='function'?btoa(binary):Buffer.from(bytes).toString('base64');
  return `${prefix}_${encoded.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
}

export function validateCustomer(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('synthetic Sandbox customer is required');
  const name=String(input.name||'').trim(),cpfCnpj=String(input.cpfCnpj||'').replace(/\D/g,''),externalReference=assertExternalReference(input.externalReference);
  if(name.length<3||name.length>100)throw new TypeError('customer name is invalid');
  if(!/^(?:\d{11}|\d{14})$/.test(cpfCnpj))throw new TypeError('Sandbox customer CPF/CNPJ format is invalid');
  const result={name,cpfCnpj,externalReference,notificationDisabled:true};
  if(input.email){const email=String(input.email).trim().toLowerCase();if(!email.endsWith('.invalid'))throw new TypeError('Sandbox customer email must use the reserved .invalid domain');result.email=email}
  return result;
}

function isoDate(value){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))throw new TypeError('valid server date is required');
  return date.toISOString().slice(0,10);
}

export function buildAsaasCheckoutPayload({offer,paymentMethod,externalReference,customerId,serverNow=new Date()}){
  if(!offer?.enabled||offer.environment!=='sandbox'||offer.provider!=='asaas')throw new Error('enabled Asaas Sandbox offer is required');
  const method=String(paymentMethod||'').trim().toUpperCase();
  if(!ASAAS_PAYMENT_METHODS.includes(method))throw new TypeError('unsupported Asaas Sandbox payment method');
  if(offer.billingModel==='RECURRENT'&&method!=='CREDIT_CARD')throw new TypeError('recurring Sandbox checkout requires CREDIT_CARD');
  const reference=assertExternalReference(externalReference);
  const payload={
    billingTypes:[method],chargeTypes:[offer.billingModel],minutesToExpire:60,externalReference:reference,
    callback:{...offer.callbackConfig},items:[{externalReference:offer.internalOfferId,name:offer.internalOfferId.replace(/_/g,' '),quantity:1,value:offer.price}]
  };
  if(customerId)payload.customer=assertExternalId(customerId,'customer');
  if(offer.billingModel==='RECURRENT')payload.subscription={cycle:offer.cycle,nextDueDate:isoDate(serverNow)};
  return Object.freeze(payload);
}

export async function createOrReuseAsaasCustomer({client,store,userId,customer}){
  if(!client||!store||typeof store.find!=='function'||typeof store.save!=='function')throw new TypeError('customer client and store adapters are required');
  const existing=await store.find(userId,'asaas','sandbox');
  if(existing?.externalCustomerId)return Object.freeze({externalCustomerId:existing.externalCustomerId,reused:true});
  const reference=existing?.externalReference||customer?.externalReference;
  const listed=await client.listCustomersByExternalReference(reference);
  const matches=Array.isArray(listed?.data)?listed.data:[];
  if(matches.length>1)throw new Error('multiple Asaas customers share the opaque reference');
  const created=matches[0]||await client.createCustomer({...customer,externalReference:reference});
  const externalCustomerId=assertExternalId(created?.id,'customer');
  await store.save(userId,{provider:'asaas',environment:'sandbox',externalReference:reference,externalCustomerId});
  return Object.freeze({externalCustomerId,reused:matches.length===1});
}
