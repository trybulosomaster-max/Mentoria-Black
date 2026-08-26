(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){
    const state=api.resolve(root.MB_BETA_CONFIG||{});
    root.MBBetaRuntime=Object.freeze({...api,...state});
    if(root.document)api.installIdentity(root.document,state);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

const LABEL='AVIORA — Gestão Financeira V82 BETA';
const isLocalHost=host=>['localhost','127.0.0.1','::1'].includes(String(host||'').toLowerCase());

function validUrl(value){
  try{
    const parsed=new URL(String(value||''));
    return parsed.protocol==='https:'||(parsed.protocol==='http:'&&isLocalHost(parsed.hostname));
  }catch(_error){return false}
}

function validPublishableKey(value){
  const key=String(value||'').trim();
  return /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
}

function resolve(config={}){
  const environment=String(config.environment||'').toLowerCase();
  const supabaseUrl=String(config.supabaseUrl||'').trim();
  const supabasePublishableKey=String(config.supabasePublishableKey||'').trim();
  const configured=environment==='beta'&&config.configured===true&&validUrl(supabaseUrl)&&validPublishableKey(supabasePublishableKey);
  return Object.freeze({
    environment:'beta',label:LABEL,isBeta:true,configured,
    supabaseUrl:configured?supabaseUrl:'',
    supabasePublishableKey:configured?supabasePublishableKey:'',
    authRedirectUrl:configured&&validUrl(config.authRedirectUrl)?String(config.authRedirectUrl):'',
    blockedReason:configured?null:'beta_configuration_missing'
  });
}

function installIdentity(document,state){
  const apply=()=>{
    document.title=state.label;
    const footer=document.querySelector('.footer');
    if(footer)footer.textContent=`${state.label} • ambiente isolado de homologação`;
    if(!document.getElementById('mbBetaBadge')){
      const badge=document.createElement('div');
      badge.id='mbBetaBadge';
      badge.textContent='V82 BETA';
      badge.setAttribute('role','status');
      badge.style.cssText='position:fixed;z-index:99999;right:10px;top:10px;padding:7px 10px;border-radius:999px;background:#c9a227;color:#080808;font:800 11px system-ui;letter-spacing:.08em;box-shadow:0 4px 18px #0008';
      document.body?.appendChild(badge);
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
}

function requireConfigured(document,state){
  if(state.configured)return state;
  const show=()=>{
    if(!document?.body)return;
    document.body.innerHTML=`<main style="min-height:100vh;display:grid;place-items:center;background:#050505;color:#f5f5f5;font:14px system-ui;padding:24px"><section style="max-width:620px;border:1px solid #c9a227;border-radius:16px;padding:24px;background:#0d0d0d"><h1 style="color:#e4c55b">${LABEL}</h1><p>Configuração Beta indisponível. O acesso foi bloqueado para impedir conexão acidental com outro ambiente.</p><p style="color:#aaa">Gere o artefato com URL e chave publicável exclusivas do Supabase Beta.</p></section></main>`;
  };
  if(document?.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show();
  throw new Error('V82 Beta blocked: isolated Supabase configuration is required');
}

return Object.freeze({LABEL,resolve,validUrl,validPublishableKey,installIdentity,requireConfigured});
});
