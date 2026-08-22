(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MBBetaObservability=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';

const MAX_EVENTS=100,events=[];
const UUID=/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const MONEY=/\b(?:R\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})\b|\b\d+\.\d{2}\b/g;
const EMAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function safeText(value){
  return String(value??'').slice(0,240).replace(UUID,'[id]').replace(EMAIL,'[email]').replace(MONEY,'[amount]');
}
function safeContext(context={}){
  const allowed={};
  for(const key of ['module','operation','code','status','category'])if(context[key]!==undefined)allowed[key]=safeText(context[key]);
  return allowed;
}
function record(kind,error,context={}){
  const item=Object.freeze({timestamp:new Date().toISOString(),kind:safeText(kind||'unknown'),message:safeText(error?.message||error),context:Object.freeze(safeContext(context))});
  events.push(item);if(events.length>MAX_EVENTS)events.shift();return item;
}
function snapshot(){return events.map(item=>({...item,context:{...item.context}}))}
function clear(){events.length=0}
function recordProjection(warnings,module){for(const warning of warnings||[])record('projection_warning',warning,{module,category:String(warning).split(':')[0]})}
function monitoredFetch(baseFetch){
  if(typeof baseFetch!=='function')throw new TypeError('baseFetch must be a function');
  return async function betaMonitoredFetch(input,init){
    const method=String(init?.method||'GET').toUpperCase();
    let path='request';
    try{path=new URL(typeof input==='string'?input:input.url).pathname.split('/').slice(0,4).join('/')}catch(_error){}
    try{
      const response=await baseFetch(input,init);
      if(!response.ok){
        let code='http_error';
        try{const body=await response.clone().json();if(body?.code)code=String(body.code)}catch(_error){}
        record(response.status===401||response.status===403?'rls_or_auth_denial':response.status===409?'duplicate_rejected':'supabase_error',code,{operation:method,module:path,status:response.status,code});
      }
      return response;
    }catch(error){record('supabase_network_error',error,{operation:method,module:path});throw error}
  };
}
if(root?.addEventListener){
  root.addEventListener('error',event=>record('javascript_error',event.error||event.message,{module:'window'}));
  root.addEventListener('unhandledrejection',event=>record('unhandled_rejection',event.reason,{module:'window'}));
}
return Object.freeze({record,recordProjection,monitoredFetch,snapshot,clear,safeText});
});
