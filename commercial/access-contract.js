'use strict';

const PRODUCT_CODES=Object.freeze({APP:'APP',KNOWLEDGE:'KNOWLEDGE',COMPLETE:'COMPLETE'});
const ACCESS_TYPES=Object.freeze(['paid','trial','manual','lifetime']);
const ACCESS_STATES=Object.freeze(['active','grace_period','past_due','expired','revoked','refunded','chargeback']);

function entitlement(value){
  const source=value&&typeof value==='object'?value:{};
  return Object.freeze({
    access:source.access===true,
    type:ACCESS_TYPES.includes(source.type)?source.type:null,
    source:typeof source.source==='string'?source.source:null,
    status:ACCESS_STATES.includes(source.status)?source.status:null,
    expiresAt:source.expires_at||null,
    graceUntil:source.grace_until||null
  });
}

function normalizeEntitlements(payload){
  if(!payload||typeof payload!=='object')throw new TypeError('invalid entitlement response');
  if(!payload.server_now)throw new TypeError('server_now is required');
  return Object.freeze({
    serverNow:String(payload.server_now),
    app:entitlement(payload.app),
    knowledge:entitlement(payload.knowledge),
    trial:Object.freeze(payload.trial&&typeof payload.trial==='object'?{...payload.trial}:{state:'eligible'})
  });
}

function resolveExperience(entitlements){
  const state=normalizeEntitlements(entitlements);
  if(state.app.access&&state.knowledge.access)return 'complete';
  if(state.app.access)return state.app.type==='trial'?'app_trial':'app';
  if(state.knowledge.access)return 'knowledge';
  return state.trial.state==='expired'?'trial_expired':'no_access';
}

function trialRemaining(entitlements){
  const state=normalizeEntitlements(entitlements);
  const end=Date.parse(state.trial.expires_at||'');
  const server=Date.parse(state.serverNow);
  if(!Number.isFinite(end)||!Number.isFinite(server))return 0;
  return Math.max(0,end-server);
}

async function beginCommercialSession(client){
  if(!client||typeof client.rpc!=='function')throw new TypeError('Supabase client is required');
  const trial=await client.rpc('start_my_app_trial');
  if(trial.error)throw trial.error;
  const resolved=await client.rpc('get_my_entitlements');
  if(resolved.error)throw resolved.error;
  const entitlements=normalizeEntitlements(resolved.data);
  return Object.freeze({entitlements,experience:resolveExperience(resolved.data)});
}

const api={PRODUCT_CODES,ACCESS_TYPES,ACCESS_STATES,normalizeEntitlements,resolveExperience,trialRemaining,beginCommercialSession};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof globalThis!=='undefined')globalThis.MBCommercialAccess=Object.freeze(api);
