(function(root,factory){
  const contract=root?.AVAdminAccessContract||(typeof require==='function'?require('../commercial/admin-access-contract'):null);
  const presentation=root?.AVAdminPresentation||(typeof require==='function'?require('../commercial/admin-presentation'):null);
  const api=factory(contract,presentation);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AVAdminAccessClient=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(contract,presentation){
  'use strict';
  if(!contract)throw new Error('AVIORA administrative contract is unavailable');

  class AdminAccessError extends Error{
    constructor(message,status=500,code='admin_request_failed'){
      super(message||'Não foi possível concluir a operação administrativa.');
      this.name='AdminAccessError';
      this.status=Number(status)||500;
      this.code=String(code||'admin_request_failed');
    }
  }

  function operationId(cryptoApi=globalThis.crypto){
    if(cryptoApi&&typeof cryptoApi.randomUUID==='function')return cryptoApi.randomUUID();
    if(cryptoApi&&typeof cryptoApi.getRandomValues==='function'){
      const bytes=new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6]=(bytes[6]&0x0f)|0x40;
      bytes[8]=(bytes[8]&0x3f)|0x80;
      const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }
    throw new AdminAccessError('Este navegador não oferece geração segura do identificador da operação.',400,'secure_request_id_unavailable');
  }
  function statusFrom(error){return Number(error?.context?.status||error?.status||0)||500}
  async function errorPayload(error){
    const response=error?.context;
    if(!response||typeof response.clone!=='function')return null;
    try{return await response.clone().json()}catch{return null}
  }
  function unwrap(payload){
    if(payload&&typeof payload==='object'&&payload.ok===false){
      const code=payload.error?.code||payload.code||'admin_request_failed';
      throw new AdminAccessError(presentation?.safeErrorMessage?.({code,message:payload.error?.message})||'Não foi possível concluir a operação.',payload.status,code);
    }
    if(payload&&typeof payload==='object'&&Object.prototype.hasOwnProperty.call(payload,'data'))return payload.data;
    return payload;
  }

  function createAdminAccessClient(options={}){
    const supabaseClient=options.supabaseClient;
    const functionName=String(options.functionName||'admin-access-control-v1');
    if(!supabaseClient?.auth?.getSession||!supabaseClient?.functions?.invoke)throw new TypeError('authenticated Supabase client is required');

    async function accessToken(){
      const {data,error}=await supabaseClient.auth.getSession();
      if(error)throw new AdminAccessError('Não foi possível validar sua sessão.',401,'invalid_session');
      const token=data?.session?.access_token;
      if(!token)throw new AdminAccessError('Faça login novamente para acessar a Administração.',401,'missing_session');
      return token;
    }
    async function invoke(action,payload={}){
      const request={action:String(action||''),...payload};
      contract.rejectForbiddenFields(request);
      const token=await accessToken();
      const {data,error}=await supabaseClient.functions.invoke(functionName,{
        body:request,
        headers:{Authorization:`Bearer ${token}`}
      });
      if(error){
        const remote=await errorPayload(error),status=statusFrom(error);
        const code=remote?.error?.code||remote?.code||error.code||'admin_request_failed';
        throw new AdminAccessError(presentation?.safeErrorMessage?.({code,message:error.message})||'Não foi possível concluir a operação.',status,code);
      }
      return unwrap(data);
    }

    return Object.freeze({
      me:async()=>{
        const context=await invoke('me');
        const session=await supabaseClient.auth.getSession();
        return {...(context&&typeof context==='object'?context:{}),user_id:session?.data?.session?.user?.id||null};
      },
      searchUsers:value=>invoke('users.search',contract.validateSearchRequest(value)),
      getLicenses:targetUserId=>invoke('licenses.get',{targetUserId:contract.uuid(targetUserId,'target user ID')}),
      grantLicense:value=>invoke('licenses.grant',contract.validateGrantRequest(value)),
      revokeLicense:value=>invoke('licenses.revoke',contract.validateRevokeRequest(value)),
      requestPasswordRecovery:value=>invoke('users.password_recovery',contract.validatePasswordRecoveryRequest(value)),
      resetUserPassword:value=>invoke('users.password.reset_direct',contract.validateDirectPasswordResetRequest(value)),
      listStaff:(value={})=>invoke('staff.list',{cursor:contract.normalizeCursor(value.cursor,'staff'),limit:Math.max(1,Math.min(50,Number(value.limit)||20))}),
      addStaff:value=>invoke('staff.add',contract.validateStaffAddRequest(value)),
      setStaffPermissions:value=>invoke('staff.permissions.set',contract.validateStaffPermissionsRequest(value)),
      setStaffStatus:value=>invoke('staff.status.set',contract.validateStaffStatusRequest(value)),
      listAudit:(value={})=>{
        const filters=value.filters&&typeof value.filters==='object'?{
          targetUserId:value.filters.targetUserId?contract.uuid(value.filters.targetUserId,'audit target user ID'):undefined,
          action:value.filters.action?String(value.filters.action).trim():undefined
        }:{};
        return invoke('audit.list',{cursor:contract.normalizeCursor(value.cursor,'audit'),limit:Math.max(1,Math.min(50,Number(value.limit)||30)),filters});
      },
      getManagementDashboard:value=>invoke('management.dashboard',contract.validateManagementRequest(value)),
      getManagementDrilldown:value=>invoke('management.drilldown',contract.validateManagementDrilldownRequest(value)),
      operationId:()=>operationId(options.cryptoApi),
      invoke
    });
  }

  return Object.freeze({AdminAccessError,createAdminAccessClient,operationId});
});
