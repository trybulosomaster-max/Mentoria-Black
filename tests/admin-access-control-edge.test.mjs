import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {registerHooks} from 'node:module';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  ADMIN_ACTIONS,ASSIGNABLE_STAFF_PERMISSIONS,AdminApiError,canonicalJson,
  idempotencyPayload,parseAllowedOrigins,parsePasswordRecoveryRedirectUrl,
  passwordIssues,sha256Hex,validateActionPayload
} from '../supabase/functions/admin-access-control-v1/contract.mjs';
import {createAdminAccessHandler} from '../supabase/functions/admin-access-control-v1/handler.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(__dirname,'..');
const origin='https://trybulosomaster-max.github.io';
const actorId='11111111-1111-4111-8111-111111111111';
const targetId='22222222-2222-4222-8222-222222222222';
const grantId='33333333-3333-4333-8333-333333333333';
const requestId='44444444-4444-4444-8444-444444444444';

const supabaseClientModule='data:text/javascript,'+encodeURIComponent(`
  export function createClient(...args){return globalThis.__adminAccessCreateClient(...args)}
`);
registerHooks({
  resolve(specifier,context,nextResolve){
    if(specifier==='@supabase/supabase-js')return {url:supabaseClientModule,shortCircuit:true};
    return nextResolve(specifier,context);
  }
});

function actionRequest(payload,options={}){
  const headers={origin,'content-type':'application/json',authorization:'Bearer valid-user-jwt',...(options.headers||{})};
  return new Request('https://synthetic-project.invalid/functions/v1/admin-access-control-v1',{
    method:options.method||'POST',headers,body:options.body===undefined?JSON.stringify(payload):options.body
  });
}

function mockHandler({
  context={is_admin:true,role:'OWNER',status:'active',permissions:[],internal_access:{app:true,knowledge:true}},
  rpcErrors={},authenticateError=null,recoveryError=null,passwordResetError=null
}={}){
  const calls=[];
  const userClient={rpc:async(name,args)=>{calls.push({client:'user',name,args});return {data:context,error:null}}};
  const adminClient={rpc:async(name,args)=>{
    calls.push({client:'admin',name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_record_audit_event_v1')return {data:{recorded:true},error:null};
    if(name==='admin_prepare_password_recovery_v1')return rpcErrors[name]
      ?{data:null,error:rpcErrors[name]}
      :{data:{ok:true,send_required:true,target_email:'target@example.invalid',request_id:requestId,idempotent:false},error:null};
    if(name==='admin_complete_password_recovery_v1')return rpcErrors[name]
      ?{data:null,error:rpcErrors[name]}
      :{data:{ok:args.p_result==='succeeded',completed:true},error:null};
    if(name==='admin_prepare_direct_password_reset_v1')return rpcErrors[name]
      ?{data:null,error:rpcErrors[name]}
      :{data:{ok:true,reset_required:true,request_id:requestId,idempotent:false},error:null};
    if(name==='admin_complete_direct_password_reset_v1')return rpcErrors[name]
      ?{data:null,error:rpcErrors[name]}
      :{data:{ok:args.p_result==='succeeded',completed:true},error:null};
    return rpcErrors[name]?{data:null,error:rpcErrors[name]}:{data:{rpc:name},error:null};
  }};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    sendPasswordRecovery:async email=>{
      calls.push({client:'auth',name:'resetPasswordForEmail',email});
      if(recoveryError)throw recoveryError;
    },
    updateUserPassword:async(targetUserId,password)=>{
      calls.push({client:'auth',name:'updateUserById',targetUserId,password});
      if(passwordResetError)throw passwordResetError;
    },
    authenticate:async token=>{
      calls.push({client:'auth',name:'getUser',token});
      if(authenticateError)throw authenticateError;
      return {user:{id:actorId},userClient};
    }
  });
  return {handler,calls};
}

async function responseJson(response){return {status:response.status,body:await response.json()}}

test('strict CORS allowlist never expands to wildcard',()=>{
  const parsed=parseAllowedOrigins('http://192.168.15.34:8097',[origin]);
  assert.deepEqual([...parsed],[origin,'http://192.168.15.34:8097']);
  assert.throws(()=>parseAllowedOrigins('*'),/wildcard/);
  assert.throws(()=>parseAllowedOrigins('https://example.com/path'),/invalid CORS origin/);
});

test('password recovery redirect stays on an explicitly allowed origin and carries no token',()=>{
  const allowed=new Set([origin,'http://127.0.0.1:8097']);
  assert.equal(
    parsePasswordRecoveryRedirectUrl(`${origin}/Mentoria-Black/?view=account-security&recovery=1`,allowed),
    `${origin}/Mentoria-Black/?view=account-security&recovery=1`
  );
  assert.throws(
    ()=>parsePasswordRecoveryRedirectUrl('https://evil.invalid/reset',allowed),
    /not allowed/
  );
  assert.throws(
    ()=>parsePasswordRecoveryRedirectUrl(`${origin}/reset#access_token=secret`,allowed),
    /invalid/
  );
  assert.throws(
    ()=>parsePasswordRecoveryRedirectUrl(`${origin}/reset?token_hash=secret`,allowed),
    /token field/
  );
});

test('canonical operation hashes are stable and payload-sensitive',async()=>{
  const left={action:'licenses.grant',targetUserId:targetId,products:['APP','KNOWLEDGE'],licenseKind:'annual'};
  const right={products:['APP','KNOWLEDGE'],licenseKind:'annual',targetUserId:targetId,action:'licenses.grant'};
  assert.equal(canonicalJson(left),canonicalJson(right));
  const leftHash=await sha256Hex(left),rightHash=await sha256Hex(right);
  assert.match(leftHash,/^[0-9a-f]{64}$/);
  assert.equal(leftHash,rightHash);
  assert.notEqual(leftHash,await sha256Hex({...right,licenseKind:'lifetime'}));
});

test('password recovery is enabled while third-party session revocation remains absent from V1',()=>{
  assert.equal(ADMIN_ACTIONS.includes('users.password_recovery'),true);
  assert.equal(ASSIGNABLE_STAFF_PERMISSIONS.includes('users.password_recovery'),false);
  assert.equal(ADMIN_ACTIONS.includes('users.password.reset_direct'),true);
  assert.equal(ADMIN_ACTIONS.includes('users.sessions_revoke'),false);
  assert.equal(ASSIGNABLE_STAFF_PERMISSIONS.includes('users.sessions_revoke'),false);
});

test('validation normalizes all supported action contracts',()=>{
  const cases=[
    [{action:'me'},'me'],
    [{action:'users.search',query:'  maria@example.com  ',limit:12,cursor:{createdAt:'2026-08-26T10:00:00-07:00',userId:targetId}},'users.search'],
    [{action:'licenses.get',targetUserId:targetId},'licenses.get'],
    [{action:'licenses.grant',targetUserId:targetId,products:['APP'],licenseKind:'monthly',reason:'Concessão mensal aprovada',requestId},'licenses.grant'],
    [{action:'licenses.grant',targetUserId:targetId,products:['KNOWLEDGE','APP'],licenseKind:'annual',reason:'Concessão aprovada',requestId},'licenses.grant'],
    [{action:'licenses.revoke',targetUserId:targetId,grantId,reason:'Revogação aprovada',requestId},'licenses.revoke'],
    [{action:'users.password_recovery',targetUserId:targetId,reason:'Recuperação autorizada',requestId},'users.password_recovery'],
    [{action:'users.password.reset_direct',targetUserId:targetId,newPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado',requestId},'users.password.reset_direct'],
    [{action:'staff.list'},'staff.list'],
    [{action:'staff.add',targetUserId:targetId,permissions:['licenses.read','users.read'],reason:'Admissão aprovada',requestId},'staff.add'],
    [{action:'staff.permissions.set',targetUserId:targetId,permissions:[],reason:'Revisão aprovada',requestId},'staff.permissions.set'],
    [{action:'staff.status.set',targetUserId:targetId,status:'disabled',reason:'Desligamento aprovado',requestId},'staff.status.set'],
    [{action:'audit.list',limit:10,cursor:{createdAt:'2026-08-26T17:00:00Z',id:grantId},filters:{targetUserId:targetId,action:'license.granted'}},'audit.list'],
    [{action:'management.dashboard',periodStart:'2026-08-01T00:00:00Z',periodEnd:'2026-09-01T00:00:00Z',limit:75},'management.dashboard']
  ];
  for(const [payload,expected] of cases)assert.equal(validateActionPayload(payload).action,expected);
  assert.equal(validateActionPayload(cases[3][0]).licenseKind,'monthly');
  assert.deepEqual(validateActionPayload(cases[4][0]).products,['APP','KNOWLEDGE']);
});

test('validation rejects server-controlled fields, unsafe permissions and loose identifiers',()=>{
  const invalid=[
    {action:'me',actorUserId:actorId},
    {action:'me',nested:{assumedPermissions:['licenses.grant']}},
    {action:'licenses.grant',targetUserId:'not-a-uuid',products:['APP'],licenseKind:'annual',reason:'Concessão aprovada',requestId},
    {action:'licenses.grant',targetUserId:targetId,products:['APP','APP'],licenseKind:'annual',reason:'Concessão aprovada',requestId},
    {action:'licenses.grant',targetUserId:targetId,products:['APP'],licenseKind:'quarterly',reason:'Concessão aprovada',requestId},
    {action:'staff.add',targetUserId:targetId,permissions:['staff.manage'],reason:'Admissão aprovada',requestId},
    {action:'staff.add',targetUserId:targetId,permissions:['staff.read'],reason:'Admissão aprovada',requestId},
    {action:'licenses.revoke',targetUserId:targetId,grantId,reason:'curto',requestId},
    {action:'users.password_recovery',targetUserId:targetId,reason:'curto',requestId},
    {action:'users.password_recovery',targetUserId:targetId,reason:'Recuperação aprovada',requestId,expiresAt:'2030-01-01T00:00:00Z'},
    {action:'users.password_recovery',targetUserId:targetId,reason:'Recuperação aprovada',requestId,email:'attacker@example.invalid'},
    {action:'users.password_recovery',targetUserId:targetId,reason:'Recuperação aprovada',requestId,redirectTo:'https://evil.invalid'},
    {action:'users.password_recovery',targetUserId:targetId,reason:'Diagnóstico access_token=do-not-store',requestId},
    {action:'users.password_recovery',targetUserId:targetId,reason:'Link https://example.invalid/reset?token_hash=do-not-store',requestId},
    {action:'users.password_recovery',targetUserId:targetId,reason:'Authorization: Bearer secret-secret-secret',requestId},
    {action:'users.password.reset_direct',targetUserId:targetId,newPassword:'weak',reason:'Suporte excepcional autorizado',requestId},
    {action:'users.password.reset_direct',targetUserId:targetId,newPassword:'Synthetic-Strong-2026!',reason:'Synthetic-Strong-2026!',requestId},
    {action:'users.password.reset_direct',targetUserId:targetId,newPassword:'Synthetic-Strong-2026!',reason:'synthetic-strong-2026!',requestId},
    {action:'users.password.reset_direct',targetUserId:targetId,newPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado',requestId,passwordConfirmation:'Synthetic-Strong-2026!'},
    {action:'audit.list',filters:{actorUserId:actorId}},
    {action:'management.dashboard',periodStart:'2026-08-01T00:00:00Z'},
    {action:'management.dashboard',periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-08-01T00:00:00Z'},
    {action:'management.dashboard',limit:null},
    {action:'management.dashboard',limit:0},
    {action:'management.dashboard',limit:101},
    {action:'management.dashboard',actorUserId:actorId}
  ];
  for(const payload of invalid)assert.throws(()=>validateActionPayload(payload),AdminApiError);
});

test('direct-reset password policy is shared and idempotency metadata excludes password and its digest',async()=>{
  assert.deepEqual(passwordIssues('Synthetic-Strong-2026!'),[]);
  assert.ok(passwordIssues('weak').length>=4);
  const first=validateActionPayload({
    action:'users.password.reset_direct',targetUserId:targetId,
    newPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado',requestId
  });
  const second=validateActionPayload({
    action:'users.password.reset_direct',targetUserId:targetId,
    newPassword:'Different-Strong-2027!',reason:'Suporte excepcional autorizado',requestId
  });
  const firstMetadata=idempotencyPayload(first),secondMetadata=idempotencyPayload(second);
  assert.equal(Object.hasOwn(firstMetadata,'newPassword'),false);
  assert.equal(Object.hasOwn(firstMetadata,'requestId'),false);
  assert.deepEqual(firstMetadata,secondMetadata);
  assert.equal(await sha256Hex(firstMetadata),await sha256Hex(secondMetadata));
  assert.equal(canonicalJson(firstMetadata).includes('Synthetic-Strong-2026!'),false);
});

test('OPTIONS is exact-origin CORS and an unlisted origin is denied',async()=>{
  const {handler,calls}=mockHandler();
  let response=await handler(new Request('https://synthetic.invalid',{method:'OPTIONS',headers:{origin}}));
  assert.equal(response.status,204);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal(response.headers.get('access-control-allow-credentials'),null);
  assert.equal(calls.length,0);

  response=await handler(new Request('https://synthetic.invalid',{method:'OPTIONS',headers:{origin:'https://evil.invalid'}}));
  assert.equal(response.status,403);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal((await response.json()).error.code,'origin_not_allowed');
  assert.equal(calls.length,0);
});

test('authentication is mandatory and invalid JWTs map to 401',async()=>{
  let fixture=mockHandler();
  let response=await fixture.handler(actionRequest({action:'me'},{headers:{authorization:''}}));
  assert.deepEqual(await responseJson(response),{status:401,body:{ok:false,error:{code:'authentication_required'}}});
  assert.equal(fixture.calls.length,0);

  fixture=mockHandler({authenticateError:new Error('GoTrue rejected token')});
  response=await fixture.handler(actionRequest({action:'me'}));
  assert.deepEqual(await responseJson(response),{status:401,body:{ok:false,error:{code:'invalid_session'}}});
});

test('durable rate limiting is keyed by authenticated actor and normalized action before business RPC',async()=>{
  const fixture=mockHandler();
  const response=await fixture.handler(actionRequest({
    action:'licenses.grant',targetUserId:targetId,products:['KNOWLEDGE','APP'],
    licenseKind:'annual',reason:'Concessão autorizada',requestId
  }));
  assert.equal(response.status,200);
  const rateIndex=fixture.calls.findIndex(call=>call.name==='admin_consume_rate_limit_v1');
  const grantIndex=fixture.calls.findIndex(call=>call.name==='admin_grant_customer_license_v1');
  assert.ok(rateIndex>0&&grantIndex>rateIndex);
  const rate=fixture.calls[rateIndex];
  assert.equal(rate.args.p_actor_user_id,actorId);
  assert.equal(rate.args.p_action,'licenses.grant');
  assert.equal(rate.args.p_request_id,requestId);
  assert.match(rate.args.p_payload_hash,/^[0-9a-f]{64}$/);
  assert.equal('ip' in rate.args,false);
  assert.equal('bucket' in rate.args,false,'the database owns action-to-bucket mapping');
});

test('rate-limit denial is generic 429, does not call business RPC, and remains retryable',async()=>{
  const calls=[];
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:false,retry_after_seconds:17,bucket:'mutations',count:10,limit:10},error:null};
    throw new Error(`business RPC must not run after rate denial: ${name}`);
  }};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}})
  });
  const response=await handler(actionRequest({
    action:'licenses.revoke',targetUserId:targetId,grantId,
    reason:'Revogação autorizada',requestId
  }));
  assert.equal(response.status,429);
  assert.equal(response.headers.get('retry-after'),'17');
  const responseBody=await response.json();
  assert.deepEqual(responseBody,{ok:false,error:{code:'rate_limited'}});
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal(calls.some(call=>call.name==='admin_revoke_customer_license_v1'),false);
  assert.equal(calls.some(call=>call.name==='admin_record_audit_event_v1'),false,
    'excess requests must not amplify writes with one audit row per attempt');
  assert.equal(JSON.stringify(responseBody).includes('mutations'),false);
});

test('rate-limit requestId conflicts do not poison the business idempotency record',async()=>{
  const calls=[];
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:null,error:{code:'22023',message:'rate-limit request id conflict'}};
    throw new Error(`unexpected RPC: ${name}`);
  }};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}})
  });
  const response=await handler(actionRequest({
    action:'staff.status.set',targetUserId:targetId,status:'disabled',
    reason:'Desligamento autorizado',requestId
  }));
  assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{ok:false,error:{code:'operation_conflict'}});
  assert.equal(calls.some(call=>call.name==='admin_record_audit_event_v1'),false);
  assert.equal(calls.some(call=>call.name==='admin_set_staff_status_v1'),false);
});

test('me uses the caller-scoped client and returns only its context',async()=>{
  const fixture=mockHandler();
  const response=await fixture.handler(actionRequest({action:'me'}));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.ok,true);
  assert.equal(body.data.role,'OWNER');
  assert.deepEqual(fixture.calls.map(call=>[call.client,call.name]),[
    ['auth','getUser'],['admin','admin_consume_rate_limit_v1'],
    ['user','get_my_admin_context_v1'],['admin','admin_touch_last_access_v1']
  ]);

  const customer=mockHandler({context:{is_admin:false,role:null,status:'customer',permissions:[],internal_access:{app:false,knowledge:false}}});
  await customer.handler(actionRequest({action:'me'}));
  assert.deepEqual(customer.calls.map(call=>[call.client,call.name]),[
    ['auth','getUser'],['admin','admin_consume_rate_limit_v1'],['user','get_my_admin_context_v1']
  ]);
});

test('password recovery authorizes in PostgreSQL, sends with official Auth, audits completion, and returns no target data',async()=>{
  const fixture=mockHandler();
  const response=await fixture.handler(actionRequest({
    action:'users.password_recovery',targetUserId:targetId,
    reason:'Solicitação administrativa autorizada',requestId
  }));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    ok:true,
    data:{request_id:requestId,result:'requested',idempotent:false}
  });
  const names=fixture.calls.map(call=>call.name);
  const rateIndex=names.indexOf('admin_consume_rate_limit_v1');
  const prepareIndex=names.indexOf('admin_prepare_password_recovery_v1');
  const sendIndex=names.indexOf('resetPasswordForEmail');
  const completeIndex=names.indexOf('admin_complete_password_recovery_v1');
  assert.ok(rateIndex>0&&prepareIndex>rateIndex&&sendIndex>prepareIndex&&completeIndex>sendIndex);
  assert.equal(fixture.calls[sendIndex].email,'target@example.invalid');
  const prepare=fixture.calls[prepareIndex];
  assert.equal(prepare.args.p_actor_user_id,actorId);
  assert.equal(prepare.args.p_target_user_id,targetId);
  assert.equal(prepare.args.p_request_id,requestId);
  assert.match(prepare.args.p_payload_hash,/^[0-9a-f]{64}$/);
  const complete=fixture.calls[completeIndex];
  assert.deepEqual({
    actor:complete.args.p_actor_user_id,
    target:complete.args.p_target_user_id,
    request:complete.args.p_request_id,
    result:complete.args.p_result,
    error:complete.args.p_error_code
  },{
    actor:actorId,target:targetId,request:requestId,result:'succeeded',error:null
  });
  const serialized=JSON.stringify(fixture.calls);
  assert.equal(serialized.includes('password:'),false);
  assert.equal(serialized.includes('access_token'),false);
  assert.equal(serialized.includes('refresh_token'),false);
});

test('password recovery replay is idempotent and never resends email',async()=>{
  const calls=[];
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_prepare_password_recovery_v1')return {
      data:{ok:true,send_required:false,request_id:requestId,idempotent:true},error:null
    };
    if(name==='admin_touch_last_access_v1')return {data:{ok:true},error:null};
    throw new Error(`unexpected RPC: ${name}`);
  }};
  let deliveries=0;
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    sendPasswordRecovery:async()=>{deliveries+=1},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}})
  });
  const response=await handler(actionRequest({
    action:'users.password_recovery',targetUserId:targetId,
    reason:'Solicitação administrativa autorizada',requestId
  }));
  assert.equal(response.status,200);
  assert.equal((await response.json()).data.idempotent,true);
  assert.equal(deliveries,0);
  assert.equal(calls.some(call=>call.name==='admin_complete_password_recovery_v1'),false);
});

test('password recovery failed replay remains generic and never resends email',async()=>{
  const calls=[];
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_prepare_password_recovery_v1')return {
      data:{
        ok:false,error:{code:'password_recovery_delivery_failed'},
        send_required:false,request_id:requestId,idempotent:true
      },
      error:null
    };
    throw new Error(`unexpected RPC: ${name}`);
  }};
  let deliveries=0;
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    sendPasswordRecovery:async()=>{deliveries+=1},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}})
  });
  const response=await handler(actionRequest({
    action:'users.password_recovery',targetUserId:targetId,
    reason:'Solicitação administrativa autorizada',requestId
  }));
  assert.deepEqual(await responseJson(response),{
    status:502,
    body:{ok:false,error:{code:'password_recovery_unavailable'},idempotent:true}
  });
  assert.equal(deliveries,0);
  assert.equal(calls.some(call=>call.name==='admin_record_audit_event_v1'),false);
});

test('password recovery delivery failure is generic, finalized once, and leaks no provider diagnostics',async()=>{
  const fixture=mockHandler({recoveryError:new Error('SMTP host leaked@example.invalid token=secret')});
  const response=await fixture.handler(actionRequest({
    action:'users.password_recovery',targetUserId:targetId,
    reason:'Solicitação administrativa autorizada',requestId
  }));
  const outcome=await responseJson(response);
  assert.deepEqual(outcome,{
    status:502,body:{ok:false,error:{code:'password_recovery_unavailable'}}
  });
  const complete=fixture.calls.find(call=>call.name==='admin_complete_password_recovery_v1');
  assert.equal(complete.args.p_result,'failed');
  assert.equal(complete.args.p_error_code,'password_recovery_delivery_failed');
  assert.equal(fixture.calls.some(call=>call.name==='admin_record_audit_event_v1'),false,
    'the completion RPC already owns the failed audit event');
  const exposed=JSON.stringify(outcome);
  assert.equal(exposed.includes('SMTP'),false);
  assert.equal(exposed.includes('token=secret'),false);
});

test('password recovery target limiter returns generic 429 and never invokes Auth delivery',async()=>{
  const calls=[];
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_prepare_password_recovery_v1')return {
      data:{ok:false,error:{code:'rate_limited'},retry_after_seconds:1700},error:null
    };
    throw new Error(`unexpected RPC: ${name}`);
  }};
  let deliveries=0;
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    sendPasswordRecovery:async()=>{deliveries+=1},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}})
  });
  const response=await handler(actionRequest({
    action:'users.password_recovery',targetUserId:targetId,
    reason:'Solicitação administrativa autorizada',requestId
  }));
  assert.equal(response.status,429);
  assert.equal(response.headers.get('retry-after'),'1700');
  assert.deepEqual(await response.json(),{ok:false,error:{code:'rate_limited'}});
  assert.equal(deliveries,0);
  assert.equal(calls.some(call=>call.name==='admin_record_audit_event_v1'),false);
});

test('password recovery target guards stay database-authoritative and denial audit uses the security event name',async()=>{
  const fixture=mockHandler({
    rpcErrors:{admin_prepare_password_recovery_v1:{code:'42501',message:'staff target forbidden'}}
  });
  const response=await fixture.handler(actionRequest({
    action:'users.password_recovery',targetUserId:targetId,
    reason:'Solicitação administrativa autorizada',requestId
  }));
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{ok:false,error:{code:'forbidden'}});
  assert.equal(fixture.calls.some(call=>call.name==='resetPasswordForEmail'),false);
  const audit=fixture.calls.find(call=>call.name==='admin_record_audit_event_v1');
  assert.ok(audit);
  assert.equal(audit.args.p_action,'user.password_recovery.requested');
  assert.equal(audit.args.p_permission_key,'users.password_recovery');
  assert.equal(audit.args.p_target_user_id,targetId);
  assert.equal(audit.args.p_result,'denied');
});

test('OWNER direct reset uses Auth Admin once and never sends password to PostgreSQL, audit, or response',async()=>{
  const fixture=mockHandler();
  const response=await fixture.handler(actionRequest({
    action:'users.password.reset_direct',targetUserId:targetId,
    newPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado',requestId
  }));
  const body=await response.json();
  assert.deepEqual({status:response.status,body},{
    status:200,body:{ok:true,data:{request_id:requestId,result:'reset',idempotent:false}}
  });
  const names=fixture.calls.map(call=>call.name);
  const prepareIndex=names.indexOf('admin_prepare_direct_password_reset_v1');
  const authIndex=names.indexOf('updateUserById');
  const completeIndex=names.indexOf('admin_complete_direct_password_reset_v1');
  assert.ok(prepareIndex>0&&authIndex>prepareIndex&&completeIndex>authIndex);
  assert.equal(fixture.calls[authIndex].targetUserId,targetId);
  assert.equal(fixture.calls[authIndex].password,'Synthetic-Strong-2026!');
  const databaseCalls=fixture.calls.filter(call=>call.client==='admin');
  assert.equal(databaseCalls.some(call=>JSON.stringify(call).includes('Synthetic-Strong-2026!')),false);
  assert.equal(databaseCalls.some(call=>Object.keys(call.args||{}).some(key=>/password/i.test(key))),false);
  assert.equal(JSON.stringify(body).includes('Synthetic-Strong-2026!'),false);
});

test('direct-reset completed retry is idempotent and never calls Auth Admin twice',async()=>{
  const calls=[];
  const adminClient={rpc:async(name,args)=>{
    calls.push({client:'admin',name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_prepare_direct_password_reset_v1')return {
      data:{ok:true,reset_required:false,request_id:requestId,result:'succeeded',idempotent:true},error:null
    };
    if(name==='admin_touch_last_access_v1')return {data:{ok:true},error:null};
    return {data:null,error:null};
  }};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}}),
    updateUserPassword:async()=>{calls.push({client:'auth',name:'updateUserById'})}
  });
  const response=await handler(actionRequest({
    action:'users.password.reset_direct',targetUserId:targetId,
    newPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado',requestId
  }));
  assert.deepEqual(await responseJson(response),{
    status:200,body:{ok:true,data:{request_id:requestId,result:'reset',idempotent:true}}
  });
  assert.equal(calls.some(call=>call.name==='updateUserById'),false);
  assert.equal(calls.some(call=>call.name==='admin_complete_direct_password_reset_v1'),false);
});

test('direct-reset completion failure stays durably ambiguous and retry never calls Auth Admin again',async()=>{
  const calls=[];
  const logs=[];
  let preparationAttempts=0;
  const adminClient={rpc:async(name,args)=>{
    calls.push({client:'admin',name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_prepare_direct_password_reset_v1'){
      preparationAttempts+=1;
      if(preparationAttempts===1)return {
        data:{ok:true,reset_required:true,request_id:requestId,idempotent:false},error:null
      };
      return {data:null,error:{code:'55000',message:'idempotent operation is still processing'}};
    }
    if(name==='admin_complete_direct_password_reset_v1')return {
      data:null,error:{code:'XX000',message:'synthetic completion failure'}
    };
    if(name==='admin_record_audit_event_v1')return {
      data:null,error:{code:'55000',message:'idempotent operation is still processing'}
    };
    throw new Error(`unexpected RPC: ${name}`);
  }};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,
    logger:{warn(message,details){logs.push({level:'warn',message,details})},error(message,details){logs.push({level:'error',message,details})}},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}}),
    updateUserPassword:async(targetUserId,password)=>{
      calls.push({client:'auth',name:'updateUserById',targetUserId,password});
    }
  });
  const payload={
    action:'users.password.reset_direct',targetUserId:targetId,
    newPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado',requestId
  };

  const first=await handler(actionRequest(payload));
  assert.deepEqual(await responseJson(first),{
    status:500,body:{ok:false,error:{code:'internal_error'}}
  });
  assert.equal(calls.filter(call=>call.name==='updateUserById').length,1,
    'Auth Admin ran exactly once before PostgreSQL completion failed');
  assert.equal(calls.filter(call=>call.name==='admin_complete_direct_password_reset_v1').length,1);

  const retry=await handler(actionRequest(payload));
  assert.deepEqual(await responseJson(retry),{
    status:409,body:{ok:false,error:{code:'operation_conflict'}}
  });
  assert.equal(calls.filter(call=>call.name==='updateUserById').length,1,
    'the durable processing reservation prevents a second Auth password update');
  assert.equal(calls.filter(call=>call.name==='admin_complete_direct_password_reset_v1').length,1,
    'an ambiguous operation is not silently completed with guessed state');
  assert.equal(calls.filter(call=>call.name==='admin_prepare_direct_password_reset_v1').length,2);

  const databaseCalls=calls.filter(call=>call.client==='admin');
  assert.equal(databaseCalls.some(call=>JSON.stringify(call).includes('Synthetic-Strong-2026!')),false);
  assert.equal(logs.some(entry=>JSON.stringify(entry).includes('Synthetic-Strong-2026!')),false);
  assert.ok(logs.some(entry=>entry.message==='direct password reset audit completion failed'));
});

test('direct-reset provider failure is generic, finalized, and never exposes diagnostics',async()=>{
  const fixture=mockHandler({passwordResetError:new Error('provider diagnostic with sensitive context')});
  const response=await fixture.handler(actionRequest({
    action:'users.password.reset_direct',targetUserId:targetId,
    newPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado',requestId
  }));
  assert.deepEqual(await responseJson(response),{
    status:502,body:{ok:false,error:{code:'password_reset_unavailable'}}
  });
  const complete=fixture.calls.find(call=>call.name==='admin_complete_direct_password_reset_v1');
  assert.equal(complete.args.p_result,'failed');
  assert.equal(complete.args.p_error_code,'direct_password_reset_failed');
  assert.equal(JSON.stringify(complete).includes('Synthetic-Strong-2026!'),false);
  assert.equal(fixture.calls.some(call=>call.name==='admin_record_audit_event_v1'),false,
    'completion RPC owns the single durable audit event');
});

test('STAFF/CUSTOMER forged direct reset is database-authoritative 403 and never reaches Auth Admin',async()=>{
  for(const message of ['active OWNER access required for direct password reset','administrative access denied']){
    const fixture=mockHandler({rpcErrors:{admin_prepare_direct_password_reset_v1:{code:'42501',message}}});
    const response=await fixture.handler(actionRequest({
      action:'users.password.reset_direct',targetUserId:targetId,
      newPassword:'Synthetic-Strong-2026!',reason:'Tentativa administrativa negada',requestId
    }));
    assert.equal(response.status,403);
    assert.deepEqual(await response.json(),{ok:false,error:{code:'forbidden'}});
    assert.equal(fixture.calls.some(call=>call.name==='updateUserById'),false);
    const audit=fixture.calls.find(call=>call.name==='admin_record_audit_event_v1');
    assert.equal(audit.args.p_action,'users.password.reset_direct');
    assert.equal(audit.args.p_permission_key,null);
    assert.equal(JSON.stringify(audit).includes('Synthetic-Strong-2026!'),false);
  }
});

test('direct-reset dedicated limiter maps to opaque 429 before Auth Admin',async()=>{
  const calls=[];
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_prepare_direct_password_reset_v1')return {
      data:{ok:false,error:{code:'rate_limited'},retry_after_seconds:120},error:null
    };
    throw new Error(`unexpected RPC: ${name}`);
  }};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}}),
    updateUserPassword:async()=>{calls.push({name:'updateUserById'})}
  });
  const response=await handler(actionRequest({
    action:'users.password.reset_direct',targetUserId:targetId,
    newPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado',requestId
  }));
  assert.equal(response.status,429);
  assert.equal(response.headers.get('retry-after'),'120');
  assert.deepEqual(await response.json(),{ok:false,error:{code:'rate_limited'}});
  assert.equal(calls.some(call=>call.name==='updateUserById'),false);
  assert.equal(calls.some(call=>call.name==='admin_record_audit_event_v1'),false);
});

test('dispatcher maps every privileged action and derives actor from the JWT',async()=>{
  const payloads=new Map([
    ['admin_search_users_v1',{action:'users.search',query:'cliente',limit:7}],
    ['admin_get_user_access_v1',{action:'licenses.get',targetUserId:targetId}],
    ['admin_grant_customer_license_v1',{action:'licenses.grant',targetUserId:targetId,products:['APP','KNOWLEDGE'],licenseKind:'monthly',reason:'Concessão mensal aprovada',requestId}],
    ['admin_revoke_customer_license_v1',{action:'licenses.revoke',targetUserId:targetId,grantId,reason:'Revogação aprovada',requestId}],
    ['admin_list_staff_v1',{action:'staff.list',limit:9}],
    ['admin_add_staff_v1',{action:'staff.add',targetUserId:targetId,permissions:['users.read'],reason:'Admissão aprovada',requestId}],
    ['admin_set_staff_permissions_v1',{action:'staff.permissions.set',targetUserId:targetId,permissions:['licenses.read'],reason:'Permissões aprovadas',requestId}],
    ['admin_set_staff_status_v1',{action:'staff.status.set',targetUserId:targetId,status:'disabled',reason:'Desligamento aprovado',requestId}],
    ['admin_list_audit_v1',{action:'audit.list',filters:{targetUserId:targetId,action:'license.granted'}}],
    ['admin_get_management_dashboard_v1',{action:'management.dashboard',periodStart:'2026-08-01T00:00:00Z',periodEnd:'2026-09-01T00:00:00Z',limit:80}],
    ['admin_list_management_drilldown_v1',{action:'management.drilldown',filter:'origin',origin:'manual',limit:25}]
  ]);
  for(const [rpcName,payload] of payloads){
    const fixture=mockHandler();
    const response=await fixture.handler(actionRequest(payload));
    assert.equal(response.status,200,`${payload.action} should succeed`);
    const call=fixture.calls.find(candidate=>candidate.name===rpcName);
    assert.ok(call,`${payload.action} must call ${rpcName}`);
    assert.equal(call.args.p_actor_user_id,actorId,'the actor must come from validated Auth state');
    assert.equal('actorUserId' in call.args,false);
    if(payload.requestId){
      assert.equal(call.args.p_request_id,requestId);
      assert.match(call.args.p_payload_hash,/^[0-9a-f]{64}$/);
      if(payload.action==='licenses.grant')assert.equal(call.args.p_license_kind,'monthly');
    }else assert.equal('p_payload_hash' in call.args,false);
  }
});

test('management dashboard preserves the backend OWNER-only denial',async()=>{
  const fixture=mockHandler({rpcErrors:{admin_get_management_dashboard_v1:{code:'42501',message:'OWNER access required'}}});
  const response=await fixture.handler(actionRequest({action:'management.dashboard'}));
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{ok:false,error:{code:'forbidden'}});
  assert.ok(fixture.calls.some(call=>call.name==='admin_consume_rate_limit_v1'));
  assert.ok(fixture.calls.some(call=>call.name==='admin_get_management_dashboard_v1'));
});

test('management drill-down validates server filters and preserves OWNER-only denial',async()=>{
  assert.deepEqual(validateActionPayload({action:'management.drilldown',filter:'monthly'}),{
    action:'management.drilldown',filter:'monthly',origin:null,limit:25,cursor:{createdAt:null,id:null}
  });
  assert.throws(()=>validateActionPayload({action:'management.drilldown',filter:'origin',origin:'unknown'}),/management origin/);
  assert.throws(()=>validateActionPayload({action:'management.drilldown',filter:'accounts',origin:'manual'}),/only valid/);
  const fixture=mockHandler({rpcErrors:{admin_list_management_drilldown_v1:{code:'42501',message:'OWNER access required'}}});
  const response=await fixture.handler(actionRequest({action:'management.drilldown',filter:'active_clients'}));
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{ok:false,error:{code:'forbidden'}});
  assert.ok(fixture.calls.some(call=>call.name==='admin_consume_rate_limit_v1'));
  assert.ok(fixture.calls.some(call=>call.name==='admin_list_management_drilldown_v1'));
});

test('database authorization, idempotency and validation errors use stable minimal responses',async()=>{
  let fixture=mockHandler({rpcErrors:{admin_grant_customer_license_v1:{code:'42501',message:'staff self-license forbidden'}}});
  let response=await fixture.handler(actionRequest({action:'licenses.grant',targetUserId:targetId,products:['APP'],licenseKind:'annual',reason:'Concessão aprovada',requestId}));
  assert.deepEqual(await responseJson(response),{status:403,body:{ok:false,error:{code:'forbidden'}}});
  const denialAudit=fixture.calls.find(call=>call.name==='admin_record_audit_event_v1');
  assert.ok(denialAudit);
  assert.equal(denialAudit.args.p_actor_user_id,actorId);
  assert.equal(denialAudit.args.p_target_user_id,targetId);
  assert.equal(denialAudit.args.p_permission_key,'licenses.grant');
  assert.equal(denialAudit.args.p_license_kind,'annual');
  assert.equal(denialAudit.args.p_result,'denied');
  assert.deepEqual(denialAudit.args.p_details,{http_status:403,product_codes:['APP'],license_kind:'annual'});
  assert.match(denialAudit.args.p_payload_hash,/^[0-9a-f]{64}$/);

  fixture=mockHandler({rpcErrors:{admin_revoke_customer_license_v1:{code:'P0001',message:'admin idempotency payload hash conflict'}}});
  response=await fixture.handler(actionRequest({action:'licenses.revoke',targetUserId:targetId,grantId,reason:'Revogação aprovada',requestId}));
  assert.deepEqual(await responseJson(response),{status:409,body:{ok:false,error:{code:'operation_conflict'}}});

  fixture=mockHandler();
  response=await fixture.handler(actionRequest({action:'users.search',query:'x'}));
  assert.deepEqual(await responseJson(response),{status:422,body:{ok:false,error:{code:'invalid_payload'}}});
});

test('denied combined license attempts retain product codes, kind and an unknown target for safe DB normalization',async()=>{
  const fixture=mockHandler({rpcErrors:{admin_grant_customer_license_v1:{code:'22023',message:'target user not found'}}});
  const response=await fixture.handler(actionRequest({
    action:'licenses.grant',targetUserId:targetId,products:['KNOWLEDGE','APP'],licenseKind:'lifetime',
    reason:'Target lookup did not resolve',requestId
  }));
  assert.equal(response.status,422);
  const audit=fixture.calls.find(call=>call.name==='admin_record_audit_event_v1');
  assert.ok(audit);
  assert.equal(audit.args.p_target_user_id,targetId);
  assert.equal(audit.args.p_product_code,null);
  assert.equal(audit.args.p_license_kind,'lifetime');
  assert.deepEqual(audit.args.p_details,{
    http_status:422,
    product_codes:['APP','KNOWLEDGE'],
    license_kind:'lifetime'
  });
  assert.match(audit.args.p_payload_hash,/^[0-9a-f]{64}$/);
});

test('database remains authoritative for CUSTOMER, STAFF, disabled, OWNER and peer-STAFF rules',async()=>{
  const denials=[
    'customer forbidden',
    'staff permission denied',
    'disabled membership forbidden',
    'owner protected',
    'staff target forbidden'
  ];
  for(const message of denials){
    const fixture=mockHandler({rpcErrors:{admin_grant_customer_license_v1:{code:'42501',message}}});
    const response=await fixture.handler(actionRequest({
      action:'licenses.grant',targetUserId:targetId,products:['APP'],licenseKind:'annual',
      reason:'Concessão autorizada',requestId
    }));
    assert.equal(response.status,403,message);
    assert.equal((await response.json()).error.code,'forbidden');
    const audit=fixture.calls.find(call=>call.name==='admin_record_audit_event_v1');
    assert.ok(audit,`${message} must produce a best-effort denied audit`);
    assert.equal(audit.args.p_result,'denied');
    assert.equal(audit.args.p_error_code,'forbidden');
    assert.equal(JSON.stringify(audit.args).includes('valid-user-jwt'),false);
    assert.equal(JSON.stringify(audit.args).includes(message),false);
  }
});

test('an idempotent retry carries the same canonical hash and preserves the database result',async()=>{
  const calls=[];
  let attempts=0,rateAttempts=0;
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1'){
      rateAttempts+=1;
      return {data:{allowed:true,retry_after_seconds:0,idempotent_replay:rateAttempts>1},error:null};
    }
    if(name==='admin_touch_last_access_v1')return {data:{ok:true},error:null};
    attempts+=1;
    return {data:{idempotent:attempts>1,requestId:args.p_request_id},error:null};
  }};
  const userClient={rpc:async()=>({data:null,error:null})};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    authenticate:async()=>({user:{id:actorId},userClient})
  });
  const payload={action:'licenses.grant',targetUserId:targetId,products:['KNOWLEDGE','APP'],licenseKind:'lifetime',reason:'Concessão autorizada',requestId};
  const first=await handler(actionRequest(payload));
  const second=await handler(actionRequest({...payload,products:['APP','KNOWLEDGE']}));
  assert.equal((await first.json()).data.idempotent,false);
  assert.equal((await second.json()).data.idempotent,true);
  const operationCalls=calls.filter(call=>call.name==='admin_grant_customer_license_v1');
  assert.equal(operationCalls.length,2);
  assert.equal(operationCalls[0].args.p_payload_hash,operationCalls[1].args.p_payload_hash);
  const rateCalls=calls.filter(call=>call.name==='admin_consume_rate_limit_v1');
  assert.equal(rateCalls.length,2,'a DB-approved idempotent replay must still reach the cached business RPC');
  assert.equal(rateCalls[0].args.p_payload_hash,rateCalls[1].args.p_payload_hash);
});

test('a cached failed operation remains an idempotent failure instead of becoming HTTP 200',async()=>{
  const calls=[];
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_grant_customer_license_v1'){
      return {data:{ok:false,error:{code:'forbidden'},idempotent:true},error:null};
    }
    return {data:{recorded:true},error:null};
  }};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}})
  });
  const response=await handler(actionRequest({
    action:'licenses.grant',targetUserId:targetId,products:['APP'],licenseKind:'annual',
    reason:'Concessão autorizada',requestId
  }));
  assert.deepEqual(await responseJson(response),{
    status:403,body:{ok:false,error:{code:'forbidden'},idempotent:true}
  });
  assert.ok(calls.some(call=>call.name==='admin_record_audit_event_v1'));
});

test('unexpected database failures are opaque 500 responses',async()=>{
  const fixture=mockHandler({rpcErrors:{admin_get_user_access_v1:{code:'XX000',message:'sensitive internal diagnostic'}}});
  const response=await fixture.handler(actionRequest({action:'licenses.get',targetUserId:targetId}));
  assert.deepEqual(await responseJson(response),{status:500,body:{ok:false,error:{code:'internal_error'}}});
  const audit=fixture.calls.find(call=>call.name==='admin_record_audit_event_v1');
  assert.equal(audit.args.p_payload_hash,null,'read operations must not reserve idempotency keys');
  assert.equal(audit.args.p_result,'failed');
});

test('an idempotency-hash conflict gets a separate best-effort denial audit',async()=>{
  const calls=[];
  let auditAttempts=0;
  const conflict={code:'22023',message:'idempotency request conflict'};
  const adminClient={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
    if(name==='admin_grant_customer_license_v1')return {data:null,error:conflict};
    if(name==='admin_record_audit_event_v1'){
      auditAttempts+=1;
      return auditAttempts===1?{data:null,error:conflict}:{data:{recorded:true},error:null};
    }
    return {data:null,error:null};
  }};
  const handler=createAdminAccessHandler({
    allowedOrigins:new Set([origin]),adminClient,logger:{warn(){},error(){}},
    authenticate:async()=>({user:{id:actorId},userClient:{rpc:async()=>({data:null,error:null})}})
  });
  const response=await handler(actionRequest({
    action:'licenses.grant',targetUserId:targetId,products:['APP'],licenseKind:'annual',
    reason:'Concessão autorizada',requestId
  }));
  assert.equal(response.status,409);
  const audits=calls.filter(call=>call.name==='admin_record_audit_event_v1');
  assert.equal(audits.length,2);
  assert.equal(audits[0].args.p_request_id,requestId);
  assert.match(audits[0].args.p_payload_hash,/^[0-9a-f]{64}$/);
  assert.notEqual(audits[1].args.p_request_id,requestId);
  assert.equal(audits[1].args.p_payload_hash,null);
  assert.equal(audits[1].args.p_details.conflicting_request_id,requestId);
});

test('entrypoint pins Supabase, separates clients, validates getUser(token), and enables JWT gateway verification',()=>{
  const index=fs.readFileSync(path.join(root,'supabase/functions/admin-access-control-v1/index.ts'),'utf8');
  const deno=JSON.parse(fs.readFileSync(path.join(root,'supabase/functions/admin-access-control-v1/deno.json'),'utf8'));
  const config=fs.readFileSync(path.join(root,'supabase/config.toml'),'utf8');
  assert.equal(deno.imports['@supabase/supabase-js'],'npm:@supabase/supabase-js@2.112.3');
  assert.match(index,/const adminClient=createClient\(supabaseUrl,serverKey/);
  assert.match(index,/const recoveryClient=createClient\(supabaseUrl,publishableKey/);
  assert.match(index,/const userClient=createClient\(supabaseUrl,publishableKey/);
  assert.match(index,/userClient\.auth\.getUser\(token\)/);
  assert.match(index,/recoveryClient\.auth\.resetPasswordForEmail\(email/);
  assert.match(index,/adminClient\.auth\.admin\.updateUserById\(targetUserId,\{password\}\)/);
  assert.match(index,/ADMIN_PASSWORD_RECOVERY_REDIRECT_URL/);
  assert.doesNotMatch(index,/update\s+auth\.users|encrypted_password/i);
  assert.doesNotMatch(index,/auth\.admin\.signOut|auth\.sessions|DELETE\s+FROM\s+auth\.sessions/i);
  assert.doesNotMatch(index,/actorUserId\s*[:=]/);
  assert.match(config,/\[functions\.admin-access-control-v1\]\s*\nverify_jwt = true/);
  assert.doesNotMatch(index,/sb_secret_|eyJ[a-zA-Z0-9_-]{20,}/);
});

test('the real entrypoint authenticates with caller JWT before using the privileged client',async()=>{
  let registeredHandler=null;
  const calls=[];
  const userClient={
    auth:{
      getUser:async token=>{calls.push(['getUser',token]);return {data:{user:{id:actorId}},error:null}},
      resetPasswordForEmail:async()=>({data:{},error:null})
    },
    rpc:async(name,args)=>{calls.push(['userRpc',name,args]);return {data:{is_admin:true,role:'OWNER',status:'active',permissions:[],internal_access:{app:true,knowledge:true}},error:null}}
  };
  const adminClient={
    rpc:async(name,args)=>{
      calls.push(['adminRpc',name,args]);
      if(name==='admin_consume_rate_limit_v1')return {data:{allowed:true,retry_after_seconds:0},error:null};
      return {data:{ok:true},error:null};
    }
  };
  globalThis.__adminAccessCreateClient=(_url,key,options)=>{
    calls.push(['createClient',key,options]);
    if(key==='synthetic-publishable')return userClient;
    if(key==='synthetic-server-secret')return adminClient;
    throw new Error('unexpected client key');
  };
  globalThis.Deno={
    env:{get:name=>({
      SUPABASE_URL:'https://synthetic-project.invalid',
      SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable',
      SUPABASE_SECRET_KEY:'synthetic-server-secret',
      ADMIN_ALLOWED_ORIGINS:origin,
      ADMIN_PASSWORD_RECOVERY_REDIRECT_URL:`${origin}/Mentoria-Black/?view=account-security&recovery=1`
    })[name]||null},
    serve:handler=>{registeredHandler=handler}
  };
  const entrypoint=new URL('../supabase/functions/admin-access-control-v1/index.ts',import.meta.url);
  entrypoint.searchParams.set('test',String(Date.now()));
  await import(entrypoint.href);
  assert.equal(typeof registeredHandler,'function');

  const response=await registeredHandler(actionRequest({action:'me'}));
  assert.equal(response.status,200);
  assert.deepEqual(calls.filter(call=>call[0]==='getUser'),[['getUser','valid-user-jwt']]);
  const created=calls.filter(call=>call[0]==='createClient');
  assert.equal(created.length,3);
  assert.equal(created[0][1],'synthetic-server-secret');
  assert.equal(created[1][1],'synthetic-publishable');
  assert.equal(created[2][1],'synthetic-publishable');
  assert.equal(created[0][2]?.global?.headers?.Authorization,undefined);
  assert.equal(created[1][2]?.global?.headers?.Authorization,undefined);
  assert.equal(created[2][2].global.headers.Authorization,'Bearer valid-user-jwt');
  assert.ok(calls.some(call=>call[0]==='adminRpc'&&call[1]==='admin_touch_last_access_v1'));
});
