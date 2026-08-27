'use strict';

const PRODUCT_CODES=Object.freeze({APP:'APP',KNOWLEDGE:'KNOWLEDGE',COMPLETE:'COMPLETE'});
const ACCESS_TYPES=Object.freeze(['paid','trial','manual','lifetime','internal']);
const ACCESS_STATES=Object.freeze(['active','grace_period','past_due','expired','revoked','refunded','chargeback','administrative_review','none']);
const TRIAL_RESULTS=Object.freeze(['started','already_active','already_used','not_eligible','internal_access']);
const ACCESS_BASES=Object.freeze(['commercial','internal','internal_and_commercial','none']);
const AUTH_ERROR_MESSAGES=Object.freeze({invalid_credentials:'E-mail ou senha incorretos.',email_not_confirmed:'Confirme seu e-mail antes de entrar.'});
const NORMALIZED_ENTITLEMENTS=new WeakSet();

function entitlement(value){
  const source=value&&typeof value==='object'?value:{};
  const accessType=source.access_type||source.type;
  const state=source.state||source.status||'none';
  const accessBasis=ACCESS_BASES.includes(source.access_basis)?source.access_basis:'none';
  return Object.freeze({
    hasAccess:source.has_access===true||source.access===true,
    access:source.has_access===true||source.access===true,
    accessType:ACCESS_TYPES.includes(accessType)?accessType:null,
    type:ACCESS_TYPES.includes(accessType)?accessType:null,
    source:typeof source.source==='string'?source.source:null,
    state:ACCESS_STATES.includes(state)?state:'none',
    status:ACCESS_STATES.includes(state)?state:'none',
    expiresAt:source.expires_at||null,
    graceUntil:source.grace_until||null,
    trialRemainingSeconds:Number.isFinite(Number(source.trial_remaining_seconds))?Math.max(0,Number(source.trial_remaining_seconds)):null,
    commercialState:typeof source.commercial_state==='string'?source.commercial_state:null,
    accessBasis,
    internalAccess:source.internal_access===true,
    commercialAccess:Object.freeze(source.commercial_access&&typeof source.commercial_access==='object'?{...source.commercial_access}:{has_access:false})
  });
}

function explicitProductInternalAccess(value,fallback){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  return source&&typeof source.internal_access==='boolean'?source.internal_access===true:fallback;
}

function internalAccess(value,appValue,knowledgeValue){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  if(source){
    return Object.freeze({
      active:source.active===true,
      app:source.app===true,
      knowledge:source.knowledge===true,
      role:typeof source.role==='string'?source.role:null
    });
  }
  const active=value===true;
  return Object.freeze({
    active,
    app:explicitProductInternalAccess(appValue,active),
    knowledge:explicitProductInternalAccess(knowledgeValue,active),
    role:null
  });
}

function normalizeEntitlements(payload){
  if(!payload||typeof payload!=='object')throw new TypeError('invalid entitlement response');
  if(NORMALIZED_ENTITLEMENTS.has(payload))return payload;
  if(!payload.server_now)throw new TypeError('server_now is required');
  const app=entitlement(payload.app),knowledge=entitlement(payload.knowledge),internal=internalAccess(payload.internal_access,payload.app,payload.knowledge);
  const hasCommercial=[app,knowledge].some(item=>item.hasAccess&&item.accessType!=='internal');
  const inferredBasis=internal.active?(hasCommercial?'internal_and_commercial':'internal'):hasCommercial?'commercial':'none';
  const basis=ACCESS_BASES.includes(payload.access_basis)?payload.access_basis:inferredBasis;
  const normalized=Object.freeze({
    serverNow:String(payload.server_now),
    app,
    knowledge,
    trial:Object.freeze(payload.trial&&typeof payload.trial==='object'?{...payload.trial}:{state:'eligible'}),
    internalAccess:internal,
    accessBasis:basis
  });
  NORMALIZED_ENTITLEMENTS.add(normalized);
  return normalized;
}

function resolveExperience(entitlements){
  const state=normalizeEntitlements(entitlements);
  if(state.app.hasAccess&&state.knowledge.hasAccess)return 'complete';
  if(state.app.hasAccess)return state.app.accessType==='trial'?'app_trial':'app';
  if(state.knowledge.hasAccess)return 'knowledge';
  return state.trial.state==='expired'||state.app.state==='expired'?'trial_expired':'no_access';
}

function trialRemaining(entitlements){
  const state=normalizeEntitlements(entitlements);
  if(state.app.trialRemainingSeconds!==null)return state.app.trialRemainingSeconds*1000;
  const end=Date.parse(state.trial.expires_at||'');
  const server=Date.parse(state.serverNow);
  return Number.isFinite(end)&&Number.isFinite(server)?Math.max(0,end-server):0;
}

function trialNotice(entitlements){
  const state=normalizeEntitlements(entitlements);
  if(state.internalAccess.active===true)return '';
  const remaining=trialRemaining(state);
  if(!remaining)return '';
  const hours=Math.ceil(remaining/3600000);
  if(hours<=24)return `Teste gratuito — ${hours===1?'menos de 1 hora':`${hours} horas restantes`}`;
  return `Teste gratuito — ${Math.ceil(hours/24)} dias restantes`;
}

function authErrorMessage(error){
  const code=String(error?.code||'').trim().toLowerCase();
  if(AUTH_ERROR_MESSAGES[code])return AUTH_ERROR_MESSAGES[code];
  const message=String(error?.message||'');
  if(/invalid login credentials/i.test(message))return AUTH_ERROR_MESSAGES.invalid_credentials;
  if(/email not confirmed/i.test(message))return AUTH_ERROR_MESSAGES.email_not_confirmed;
  return 'Não foi possível entrar. Tente novamente.';
}

function accountLoadErrorMessage(){return 'Não foi possível carregar sua conta. Tente novamente.';}

async function beginCommercialSession(client){
  if(!client||typeof client.rpc!=='function')throw new TypeError('Supabase client is required');
  const trial=await client.rpc('start_my_app_trial');
  if(trial.error)throw trial.error;
  const trialRow=Array.isArray(trial.data)?trial.data[0]:trial.data;
  if(trialRow?.result&&!TRIAL_RESULTS.includes(trialRow.result))throw new TypeError('invalid trial result');
  const resolved=await client.rpc('get_my_entitlements');
  if(resolved.error)throw resolved.error;
  const entitlements=normalizeEntitlements(resolved.data);
  return Object.freeze({trialResult:trialRow?.result||null,entitlements,experience:resolveExperience(resolved.data)});
}

const api={PRODUCT_CODES,ACCESS_TYPES,ACCESS_STATES,TRIAL_RESULTS,ACCESS_BASES,normalizeEntitlements,resolveExperience,trialRemaining,trialNotice,authErrorMessage,accountLoadErrorMessage,beginCommercialSession};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof globalThis!=='undefined')globalThis.MBCommercialAccess=Object.freeze(api);
