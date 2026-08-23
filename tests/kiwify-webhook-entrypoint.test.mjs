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

async function loadActualEntrypoint(storedToken,createClient=()=>adminClient(storedToken)){
  let capturedHandler=null;
  globalThis.__kiwifyCreateClient=createClient;
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

function buyerNewAdmin(storedToken){
  const state={users:[],events:new Map(),grants:new Map(),createdPasswords:[]};
  const userId='a1000000-0000-4000-8000-000000000001';
  const productId='b1000000-0000-4000-8000-000000000001';
  const chain=result=>{
    const query={
      select(){return query;},eq(){return query;},
      async maybeSingle(){return result();},async single(){return result();},
      then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}
    };
    return query;
  };
  const client={
    rpc:async name=>{
      if(name==='get_kiwify_webhook_token')return {data:storedToken,error:null};
      if(name==='get_kiwify_webhook_contract_v2')return {data:null,error:{code:'PGRST202'}};
      throw new Error(`unexpected RPC in buyer-new test: ${name}`);
    },
    auth:{admin:{
      listUsers:async()=>({data:{users:[...state.users]},error:null}),
      createUser:async input=>{
        state.createdPasswords.push(input.password);
        const user={id:userId,email:input.email};state.users.push(user);
        return {data:{user},error:null};
      }
    }},
    from:table=>{
      if(table==='commercial_enforcement_state')return queryResult({error:{code:'PGRST205'}});
      if(table==='profiles')return {upsert:async()=>({data:null,error:{code:'PGRST205'}})};
      if(table==='products')return chain(()=>({data:{id:productId},error:null}));
      if(table==='payment_events'){
        const filters={};
        const query={
          select(){return query;},eq(column,value){filters[column]=value;return query;},
          async maybeSingle(){
            return {data:state.events.get(filters.event_id)||null,error:null};
          },
          async insert(row){state.events.set(row.event_id,{...row,id:`id-${row.event_id}`});return {error:null};},
          update(patch){
            return {
              eq(column,value){filters[column]=value;return this;},
              then(resolve,reject){
                const row=state.events.get(filters.event_id);
                if(row)Object.assign(row,patch);
                return Promise.resolve({error:null}).then(resolve,reject);
              }
            };
          }
        };
        return query;
      }
      if(table==='access_grants')return {
        upsert:async(row,options)=>{
          state.grants.set(`${row.user_id}:${row.product_id}`,{...row,options});
          return {error:null};
        }
      };
      throw new Error(`unexpected table in buyer-new test: ${table}`);
    }
  };
  return {client,state};
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

test('the real Edge entrypoint creates a new buyer with a bcrypt-safe private password',async()=>{
  const token='legacy-profile-token';
  const {client,state}=buyerNewAdmin(token);
  const handler=await loadActualEntrypoint(token,()=>client);
  const approved={
    provider:'kiwify',environment:'production',webhook_event_type:'purchase_approved',
    event_id:'buyer-new-approved',order_id:'buyer-new-order',
    Customer:{id:'buyer-new-customer',email:'buyer-new@example.invalid',full_name:'Synthetic Buyer'},
    Product:{product_id:'legacy-product',product_name:'Mentoria Black'},
    Subscription:{id:'buyer-new-subscription',customer_access:{access_until:'2026-09-23T00:00:00Z'}}
  };
  let response=await handler(request(token,approved));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    ok:true,status:'access_granted',duplicate:false,contract:'legacy'
  });
  assert.equal(state.users.length,1);
  assert.equal(state.createdPasswords.length,1);
  assert.equal(Buffer.byteLength(state.createdPasswords[0],'utf8'),64);
  assert.match(state.createdPasswords[0],/^[0-9a-f]{64}$/);
  assert.equal(state.grants.size,1);
  assert.equal(state.events.size,1);

  response=await handler(request(token,approved));
  assert.equal(response.status,200);
  assert.equal((await response.json()).duplicate,true);
  assert.equal(state.users.length,1,'retry must not create a second Auth user');
  assert.equal(state.createdPasswords.length,1,'retry must not generate or expose another credential');
  assert.equal(state.grants.size,1);
  assert.equal(state.events.size,1);

  const renewal={
    ...approved,webhook_event_type:'subscription_renewed',event_id:'buyer-new-renewal',
    order_id:'buyer-new-renewal-order',
    Subscription:{id:'buyer-new-subscription',customer_access:{access_until:'2026-10-23T00:00:00Z'}}
  };
  response=await handler(request(token,renewal));
  assert.equal(response.status,200);
  assert.equal((await response.json()).status,'access_granted');
  assert.equal(state.users.length,1,'a later event for the buyer must reuse the Auth identity');
  assert.equal(state.createdPasswords.length,1);
  assert.equal(state.grants.size,1,'renewal must update the existing legacy grant');
  assert.equal(state.events.size,2);
});
