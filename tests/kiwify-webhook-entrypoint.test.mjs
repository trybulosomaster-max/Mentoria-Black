import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import test from 'node:test';

const supabaseClientModule='data:text/javascript,'+encodeURIComponent(`
  export function createClient(...args){
    return globalThis.__kiwifyCreateClient(...args);
  }
`);

registerHooks({
  resolve(specifier,context,nextResolve){
    if(specifier==='@supabase/supabase-js')return {url:supabaseClientModule,shortCircuit:true};
    return nextResolve(specifier,context);
  }
});

let moduleSequence=0;

function queryResult({data=null,error=null}={}){
  const query={
    select(){return query;},
    eq(){return query;},
    update(){return query;},
    async insert(){return {data:null,error:null};},
    async maybeSingle(){return {data,error};},
    then(resolve,reject){return Promise.resolve({data,error}).then(resolve,reject);}
  };
  return query;
}

function adminClient(storedToken){
  return {
    rpc:async name=>{
      if(name==='get_kiwify_webhook_token')return {data:storedToken,error:null};
      if(name==='get_kiwify_webhook_contract_v2')return {data:null,error:{code:'PGRST202'}};
      throw new Error(`unexpected RPC in entrypoint test: ${name}`);
    },
    from:table=>{
      if(table==='commercial_enforcement_state')return queryResult({error:{code:'PGRST205'}});
      if(table==='payment_events')return queryResult();
      throw new Error(`unexpected table in entrypoint test: ${table}`);
    }
  };
}

async function loadActualEntrypoint(storedToken){
  let capturedHandler=null;
  globalThis.__kiwifyCreateClient=()=>adminClient(storedToken);
  globalThis.Deno={
    env:{get:name=>({
      SUPABASE_URL:'https://synthetic-beta.invalid',
      SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role-for-entrypoint-test'
    })[name]||null},
    serve:handler=>{capturedHandler=handler;}
  };
  const entrypoint=new URL('../supabase/functions/kiwify-webhook/index.ts',import.meta.url);
  entrypoint.searchParams.set('entrypoint-test',String(moduleSequence++));
  await import(entrypoint.href);
  assert.equal(typeof capturedHandler,'function','the real entrypoint must register its request handler');
  return capturedHandler;
}

function request(token,payload={}){
  return new Request('https://synthetic-beta.invalid/functions/v1/kiwify-webhook',{
    method:'POST',
    headers:{'content-type':'application/json','x-kiwify-webhook-token':token},
    body:JSON.stringify(payload)
  });
}

const authorizedTestEvent={
  provider:'kiwify',environment:'production',
  webhook_event_type:'test',event_id:'entrypoint-test-event',order_id:'entrypoint-test-order',
  Customer:{id:'synthetic-customer',email:'johndoe@example.com'},
  Product:{product_id:'synthetic-product',product_name:'Example product'}
};

test('the real Edge entrypoint preserves legacy reads without weakening V2 writes',async()=>{
  const legacyToken='legacy8!';
  const strongToken='v2-strong-token-abcdefghijklmnopqrstuvwxyz';

  let handler=await loadActualEntrypoint(legacyToken);
  let response=await handler(request(legacyToken));
  assert.equal(response.status,400,'an 8-character legacy token must pass authentication and reach payload validation');
  assert.equal((await response.json()).error,'invalid_event');

  handler=await loadActualEntrypoint(strongToken);
  response=await handler(request(strongToken));
  assert.equal(response.status,400,'a strong V2 token must pass authentication and reach payload validation');
  assert.equal((await response.json()).error,'invalid_event');

  handler=await loadActualEntrypoint('');
  response=await handler(request('unused-token'));
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'webhook_not_configured');

  handler=await loadActualEntrypoint('short7');
  response=await handler(request('short7'));
  assert.equal(response.status,503,'tokens below the historical v4 minimum must fail closed');

  handler=await loadActualEntrypoint('        ');
  response=await handler(request('        '));
  assert.equal(response.status,503,'whitespace is not a valid legacy token');

  handler=await loadActualEntrypoint(legacyToken);
  response=await handler(request('wrong-token'));
  assert.equal(response.status,401,'a configured legacy token must not weaken request authentication');

  response=await handler(request(legacyToken,authorizedTestEvent));
  assert.equal(response.status,200,'the real entrypoint must authorize a valid legacy-profile request');
  assert.deepEqual(await response.json(),{
    ok:true,status:'test_event_received',duplicate:false,contract:'legacy'
  });
});
