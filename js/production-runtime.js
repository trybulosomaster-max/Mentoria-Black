(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){
    const state=api.resolve(root.MB_PRODUCTION_CONFIG||{});
    root.MBProductionRuntime=Object.freeze({...api,...state});
    if(root.document)api.installIdentity(root.document,state);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

const LABEL='Mentoria Black — Gestão Financeira V82';
const EXPECTED_HOST='mwjqfzbpjmwiscvtxvfc.supabase.co';
const isLocalHost=host=>['localhost','127.0.0.1','::1'].includes(String(host||'').toLowerCase());

function validUrl(value){
  try{
    const parsed=new URL(String(value||''));
    return parsed.protocol==='https:'||(parsed.protocol==='http:'&&isLocalHost(parsed.hostname));
  }catch(_error){return false}
}

function validProductionUrl(value){
  try{
    const parsed=new URL(String(value||''));
    return parsed.protocol==='https:'&&parsed.hostname===EXPECTED_HOST;
  }catch(_error){return false}
}

function validPublishableKey(value){
  return /^sb_publishable_[A-Za-z0-9_-]+$/.test(String(value||'').trim());
}

function resolve(config={}){
  const environment=String(config.environment||'').toLowerCase();
  const supabaseUrl=String(config.supabaseUrl||'').trim();
  const supabasePublishableKey=String(config.supabasePublishableKey||'').trim();
  const configured=environment==='production'&&config.configured===true&&validProductionUrl(supabaseUrl)&&validPublishableKey(supabasePublishableKey);
  return Object.freeze({
    environment:'production',label:LABEL,isProduction:true,configured,
    supabaseUrl:configured?supabaseUrl:'',
    supabasePublishableKey:configured?supabasePublishableKey:'',
    authRedirectUrl:configured&&validUrl(config.authRedirectUrl)?String(config.authRedirectUrl):'',
    blockedReason:configured?null:'production_configuration_missing'
  });
}

function installIdentity(document,state){
  const apply=()=>{document.title=state.label};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
}

function requireConfigured(document,state){
  if(state.configured)return state;
  const show=()=>{
    if(!document?.body)return;
    document.body.innerHTML=`<main style="min-height:100vh;display:grid;place-items:center;background:#050505;color:#f5f5f5;font:14px system-ui;padding:24px"><section style="max-width:620px;border:1px solid #c9a227;border-radius:16px;padding:24px;background:#0d0d0d"><h1 style="color:#e4c55b">${LABEL}</h1><p>Configuração de produção indisponível. O acesso foi bloqueado para impedir conexão acidental com outro ambiente.</p></section></main>`;
  };
  if(document?.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show();
  throw new Error('V82 production blocked: production Supabase configuration is required');
}

return Object.freeze({LABEL,EXPECTED_HOST,resolve,validUrl,validProductionUrl,validPublishableKey,installIdentity,requireConfigured});
});
