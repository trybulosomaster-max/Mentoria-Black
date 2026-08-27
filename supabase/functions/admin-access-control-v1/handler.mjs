import {
  AdminApiError,assertOriginAllowed,bearerToken,corsHeaders,errorFromStableCode,
  idempotencyPayload,mapRpcError,readJsonBody,sha256Hex,validateActionPayload
} from './contract.mjs';

function jsonResponse(body,status,headers={}){
  return Response.json(body,{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
}

function rpcSpec(action,actorUserId,payloadHash){
  const common={p_actor_user_id:actorUserId};
  if(action.action==='users.search')return ['admin_search_users_v1',{...common,p_query:action.query,p_limit:action.limit,p_cursor_created_at:action.cursor.createdAt,p_cursor_user_id:action.cursor.id}];
  if(action.action==='licenses.get')return ['admin_get_user_access_v1',{...common,p_target_user_id:action.targetUserId}];
  if(action.action==='licenses.grant')return ['admin_grant_customer_license_v1',{...common,p_target_user_id:action.targetUserId,p_product_codes:action.products,p_license_kind:action.licenseKind,p_reason:action.reason,p_request_id:action.requestId,p_payload_hash:payloadHash}];
  if(action.action==='licenses.revoke')return ['admin_revoke_customer_license_v1',{...common,p_target_user_id:action.targetUserId,p_grant_id:action.grantId,p_reason:action.reason,p_request_id:action.requestId,p_payload_hash:payloadHash}];
  if(action.action==='staff.list')return ['admin_list_staff_v1',{...common,p_limit:action.limit,p_cursor_created_at:action.cursor.createdAt,p_cursor_user_id:action.cursor.id}];
  if(action.action==='staff.add')return ['admin_add_staff_v1',{...common,p_target_user_id:action.targetUserId,p_permission_keys:action.permissions,p_reason:action.reason,p_request_id:action.requestId,p_payload_hash:payloadHash}];
  if(action.action==='staff.permissions.set')return ['admin_set_staff_permissions_v1',{...common,p_target_user_id:action.targetUserId,p_permission_keys:action.permissions,p_reason:action.reason,p_request_id:action.requestId,p_payload_hash:payloadHash}];
  if(action.action==='staff.status.set')return ['admin_set_staff_status_v1',{...common,p_target_user_id:action.targetUserId,p_status:action.status,p_reason:action.reason,p_request_id:action.requestId,p_payload_hash:payloadHash}];
  if(action.action==='audit.list')return ['admin_list_audit_v1',{...common,p_limit:action.limit,p_cursor_created_at:action.cursor.createdAt,p_cursor_id:action.cursor.id,p_target_user_id:action.filters.targetUserId,p_action:action.filters.action}];
  if(action.action==='management.dashboard')return ['admin_get_management_dashboard_v1',{...common,p_period_start:action.periodStart,p_period_end:action.periodEnd,p_limit:action.limit}];
  if(action.action==='management.drilldown')return ['admin_list_management_drilldown_v1',{...common,p_filter:action.filter,p_origin:action.origin,p_limit:action.limit,p_cursor_created_at:action.cursor.createdAt,p_cursor_user_id:action.cursor.id}];
  throw new AdminApiError(422,'unsupported_action','unsupported action');
}

function permissionForAction(action){
  return ({
    'users.search':'users.read','users.password_recovery':'users.password_recovery',
    'users.password.reset_direct':null,
    'licenses.get':'licenses.read',
    'licenses.grant':'licenses.grant','licenses.revoke':'licenses.revoke',
    'staff.list':'staff.read','staff.add':'staff.manage',
    'staff.permissions.set':'staff.manage','staff.status.set':'staff.manage',
    'audit.list':'audit.read','management.dashboard':null,'management.drilldown':null
  })[action]||null;
}

function auditActionFor(action){
  return action==='users.password_recovery'
    ?'user.password_recovery.requested'
    :action;
}

async function callRpc(client,name,args={}){
  const result=await client.rpc(name,args);
  if(result?.error)throw mapRpcError(result.error);
  const data=result?.data??null;
  if(data&&typeof data==='object'&&!Array.isArray(data)&&data.ok===false){
    throw errorFromStableCode(String(data.error?.code||''),data.idempotent===true);
  }
  return data;
}

async function touchLastAccess(adminClient,actorUserId,logger){
  try{await callRpc(adminClient,'admin_touch_last_access_v1',{p_actor_user_id:actorUserId})}
  catch(error){logger?.warn?.('admin last-access update failed',{code:error?.code||'internal_error'})}
}

async function enforceRateLimit(adminClient,actorUserId,action,payloadHash){
  const limited=await adminClient.rpc('admin_consume_rate_limit_v1',{
    p_actor_user_id:actorUserId,
    p_action:action.action,
    p_request_id:action.requestId||null,
    p_payload_hash:payloadHash
  });
  if(limited?.error){
    const error=mapRpcError(limited.error);
    error.rateLimitCheck=true;
    throw error;
  }
  const data=limited?.data;
  if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.allowed!=='boolean'){
    const error=new AdminApiError(500,'internal_error','rate-limit contract failed');
    error.rateLimitCheck=true;
    throw error;
  }
  if(data.allowed)return;
  const retryAfter=Math.max(1,Math.min(3600,Math.ceil(Number(data.retry_after_seconds)||1)));
  const error=new AdminApiError(429,'rate_limited','request rate limit exceeded');
  error.retryAfter=retryAfter;
  error.rateLimitCheck=true;
  throw error;
}

function recoveryErrorFromData(data){
  const storedCode=String(data?.error?.code||'internal_error');
  const code=storedCode==='password_recovery_delivery_failed'
    ?'password_recovery_unavailable'
    :storedCode;
  const error=errorFromStableCode(code,data?.idempotent===true);
  if(code==='rate_limited'){
    error.rateLimitCheck=true;
    error.retryAfter=Math.max(1,Math.min(3600,Math.ceil(Number(data?.retry_after_seconds)||1)));
  }
  if(data?.idempotent===true)error.alreadyAudited=true;
  return error;
}

async function runPasswordRecovery({
  adminClient,actorUserId,action,payloadHash,sendPasswordRecovery,logger
}){
  if(typeof sendPasswordRecovery!=='function'){
    throw new AdminApiError(503,'password_recovery_unavailable','password recovery is unavailable');
  }

  const prepared=await adminClient.rpc('admin_prepare_password_recovery_v1',{
    p_actor_user_id:actorUserId,
    p_target_user_id:action.targetUserId,
    p_reason:action.reason,
    p_request_id:action.requestId,
    p_payload_hash:payloadHash
  });
  if(prepared?.error)throw mapRpcError(prepared.error);
  const preparation=prepared?.data;
  if(!preparation||typeof preparation!=='object'||Array.isArray(preparation)){
    throw new AdminApiError(500,'internal_error','password recovery contract failed');
  }
  if(preparation.ok===false)throw recoveryErrorFromData(preparation);
  if(preparation.ok!==true){
    throw new AdminApiError(500,'internal_error','password recovery contract failed');
  }
  if(preparation.idempotent===true&&preparation.send_required===false){
    return {
      request_id:action.requestId,
      result:'requested',
      idempotent:true
    };
  }

  const targetEmail=String(preparation.target_email||'').trim();
  if(preparation.send_required!==true||!targetEmail||targetEmail.length>320){
    throw new AdminApiError(500,'internal_error','password recovery contract failed');
  }

  let deliveryResult='succeeded';
  let deliveryErrorCode=null;
  try{
    await sendPasswordRecovery(targetEmail);
  }catch{
    deliveryResult='failed';
    deliveryErrorCode='password_recovery_delivery_failed';
  }

  const completed=await adminClient.rpc('admin_complete_password_recovery_v1',{
    p_actor_user_id:actorUserId,
    p_target_user_id:action.targetUserId,
    p_request_id:action.requestId,
    p_payload_hash:payloadHash,
    p_result:deliveryResult,
    p_error_code:deliveryErrorCode
  });
  if(completed?.error){
    logger?.warn?.('password recovery audit completion failed',{code:'completion_failed'});
    throw mapRpcError(completed.error);
  }
  if(!completed?.data||typeof completed.data!=='object'||Array.isArray(completed.data)
     ||completed.data.ok!==(deliveryResult==='succeeded')){
    logger?.warn?.('password recovery audit completion failed',{code:'invalid_completion'});
    throw new AdminApiError(500,'internal_error','password recovery completion contract failed');
  }

  if(deliveryResult==='failed'){
    const error=new AdminApiError(502,'password_recovery_unavailable','password recovery is unavailable');
    error.alreadyAudited=true;
    throw error;
  }
  return {
    request_id:action.requestId,
    result:'requested',
    idempotent:false
  };
}

function directPasswordResetErrorFromData(data){
  const storedCode=String(data?.error?.code||'internal_error');
  const code=storedCode==='direct_password_reset_failed'?'password_reset_unavailable':storedCode;
  const error=errorFromStableCode(code,data?.idempotent===true);
  if(code==='rate_limited'){
    error.rateLimitCheck=true;
    error.retryAfter=Math.max(1,Math.min(3600,Math.ceil(Number(data?.retry_after_seconds)||1)));
  }
  if(data?.idempotent===true)error.alreadyAudited=true;
  return error;
}

async function runDirectPasswordReset({
  adminClient,actorUserId,action,payloadHash,updateUserPassword,logger
}){
  if(typeof updateUserPassword!=='function')throw new AdminApiError(503,'password_reset_unavailable','password reset is unavailable');
  let transientPassword=String(action.newPassword||'');
  delete action.newPassword;
  try{
    const prepared=await adminClient.rpc('admin_prepare_direct_password_reset_v1',{
      p_actor_user_id:actorUserId,
      p_target_user_id:action.targetUserId,
      p_reason:action.reason,
      p_request_id:action.requestId,
      p_payload_hash:payloadHash
    });
    if(prepared?.error)throw mapRpcError(prepared.error);
    const preparation=prepared?.data;
    if(!preparation||typeof preparation!=='object'||Array.isArray(preparation))throw new AdminApiError(500,'internal_error','password reset contract failed');
    if(preparation.ok===false)throw directPasswordResetErrorFromData(preparation);
    if(preparation.ok!==true)throw new AdminApiError(500,'internal_error','password reset contract failed');
    if(preparation.idempotent===true&&preparation.reset_required===false){
      return {request_id:action.requestId,result:'reset',idempotent:true};
    }
    if(preparation.reset_required!==true)throw new AdminApiError(500,'internal_error','password reset contract failed');

    let resetResult='succeeded',resetErrorCode=null;
    try{await updateUserPassword(action.targetUserId,transientPassword)}
    catch{resetResult='failed';resetErrorCode='direct_password_reset_failed'}

    const completed=await adminClient.rpc('admin_complete_direct_password_reset_v1',{
      p_actor_user_id:actorUserId,
      p_target_user_id:action.targetUserId,
      p_request_id:action.requestId,
      p_payload_hash:payloadHash,
      p_result:resetResult,
      p_error_code:resetErrorCode
    });
    if(completed?.error){
      logger?.warn?.('direct password reset audit completion failed',{code:'completion_failed'});
      throw mapRpcError(completed.error);
    }
    if(!completed?.data||typeof completed.data!=='object'||Array.isArray(completed.data)
       ||completed.data.ok!==(resetResult==='succeeded')){
      logger?.warn?.('direct password reset audit completion failed',{code:'invalid_completion'});
      throw new AdminApiError(500,'internal_error','password reset completion contract failed');
    }
    if(resetResult==='failed'){
      const error=new AdminApiError(502,'password_reset_unavailable','password reset is unavailable');
      error.alreadyAudited=true;
      throw error;
    }
    return {request_id:action.requestId,result:'reset',idempotent:false};
  }finally{
    transientPassword='';
  }
}


async function recordRejectedOperation(adminClient,actorUserId,action,payloadHash,error,logger){
  const result=error.status===500?'failed':'denied';
  const productCodes=Array.isArray(action.products)?action.products:[];
  const productCode=productCodes.length===1?productCodes[0]:null;
  const auditArgs={
    p_actor_user_id:actorUserId,
    p_target_user_id:action.targetUserId||action.filters?.targetUserId||null,
    p_action:auditActionFor(action.action),
    p_permission_key:permissionForAction(action.action),
    p_product_code:productCode,
    p_license_kind:action.licenseKind||null,
    p_reason:action.reason||`Administrative request ${result} by server-side controls`,
    p_result:result,
    p_error_code:error.code,
    p_details:{
      http_status:error.status,
      ...(productCodes.length?{product_codes:productCodes}:{}),
      ...(action.licenseKind?{license_kind:action.licenseKind}:{})
    },
    p_request_id:action.requestId||crypto.randomUUID(),
    // Defensive only: rate-stage failures are not sent to this audit helper,
    // preventing rejected-request write amplification.
    p_payload_hash:error.rateLimitCheck===true?null:payloadHash
  };
  const fallbackAudit=async()=>{
    const fallback=await adminClient.rpc('admin_record_audit_event_v1',{
      ...auditArgs,
      p_request_id:crypto.randomUUID(),
      p_payload_hash:null,
      p_details:{...auditArgs.p_details,conflicting_request_id:action.requestId||null}
    });
    if(fallback?.error)throw mapRpcError(fallback.error);
  };
  try{
    const audit=await adminClient.rpc('admin_record_audit_event_v1',auditArgs);
    if(audit?.error){
      const mapped=mapRpcError(audit.error);
      if(mapped.code==='operation_conflict')await fallbackAudit();
      else throw mapped;
    }else if(audit?.data?.recorded!==true&&audit?.data?.ok!==false){
      // A previously successful operation can still be denied later after the
      // actor is disabled. Preserve that distinct security event without
      // changing the original idempotency record.
      await fallbackAudit();
    }
  }catch(auditError){
    logger?.warn?.('admin security-event audit failed',{code:auditError?.code||'internal_error'});
  }
}

export function createAdminAccessHandler({
  authenticate,adminClient,allowedOrigins,sendPasswordRecovery=null,updateUserPassword=null,logger=console
}){
  if(typeof authenticate!=='function'||!adminClient||!(allowedOrigins instanceof Set))throw new TypeError('admin handler dependencies are invalid');
  return async function adminAccessHandler(request){
    const origin=request.headers.get('origin')||'';
    const headers=corsHeaders(origin,allowedOrigins);
    let actorUserId=null;
    let action=null;
    let payloadHash=null;
    try{
      assertOriginAllowed(origin,allowedOrigins);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(request.method!=='POST')return jsonResponse({ok:false,error:{code:'method_not_allowed'}},405,{...headers,'allow':'POST, OPTIONS'});

      const token=bearerToken(request.headers.get('authorization'));
      let authenticated;
      try{authenticated=await authenticate(token)}
      catch{throw new AdminApiError(401,'invalid_session','invalid session')}
      actorUserId=String(authenticated?.user?.id||'');
      if(!actorUserId)throw new AdminApiError(401,'invalid_session','invalid session');

      action=validateActionPayload(await readJsonBody(request));
      const operation=idempotencyPayload(action);
      payloadHash=operation?await sha256Hex(operation):null;
      await enforceRateLimit(adminClient,actorUserId,action,payloadHash);
      if(action.action==='me'){
        const context=await callRpc(authenticated.userClient,'get_my_admin_context_v1');
        if(context?.is_admin===true&&context?.status==='active')await touchLastAccess(adminClient,actorUserId,logger);
        return jsonResponse({ok:true,data:context},200,headers);
      }

      if(action.action==='users.password_recovery'){
        const data=await runPasswordRecovery({
          adminClient,actorUserId,action,payloadHash,sendPasswordRecovery,logger
        });
        await touchLastAccess(adminClient,actorUserId,logger);
        return jsonResponse({ok:true,data},200,headers);
      }
      if(action.action==='users.password.reset_direct'){
        const data=await runDirectPasswordReset({adminClient,actorUserId,action,payloadHash,updateUserPassword,logger});
        await touchLastAccess(adminClient,actorUserId,logger);
        return jsonResponse({ok:true,data},200,headers);
      }

      const [rpcName,rpcArgs]=rpcSpec(action,actorUserId,payloadHash);
      const data=await callRpc(adminClient,rpcName,rpcArgs);
      await touchLastAccess(adminClient,actorUserId,logger);
      return jsonResponse({ok:true,data},200,headers);
    }catch(error){
      const mapped=error instanceof AdminApiError?error:mapRpcError(error);
      // The durable rate-limit window is itself the diagnostic record. Writing
      // one audit row per excess request would let spam amplify database writes.
      if(actorUserId&&action&&mapped.rateLimitCheck!==true&&mapped.alreadyAudited!==true){
        await recordRejectedOperation(adminClient,actorUserId,action,payloadHash,mapped,logger);
      }
      if(mapped.status===500)logger?.error?.('admin access request failed',{code:mapped.code});
      const responseHeaders=mapped.retryAfter?{...headers,'retry-after':String(mapped.retryAfter)}:headers;
      return jsonResponse({ok:false,error:{code:mapped.code},...(mapped.idempotent?{idempotent:true}:{})},mapped.status,responseHeaders);
    }
  };
}

export {rpcSpec};
