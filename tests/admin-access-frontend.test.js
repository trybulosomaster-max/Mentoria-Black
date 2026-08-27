'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const contract=require('../commercial/admin-access-contract');
const commercial=require('../commercial/access-contract');
const clientModule=require('../js/admin-access-client');
const adminArea=require('../js/admin-area');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const deep=(actual,expected,message)=>{assertions++;assert.deepStrictEqual(actual,expected,message)};
const rejects=async(fn,pattern,message)=>{assertions++;await assert.rejects(fn,pattern,message)};
const licenseOptionValues=html=>[...(String(html).match(/<select id="adminLicenseKind"[\s\S]*?<\/select>/)||[''])[0].matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]);
async function test(name,fn){try{await fn();tests++}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const OWNER_ID='10000000-0000-4000-8000-000000000001';
const STAFF_ID='20000000-0000-4000-8000-000000000002';
const CUSTOMER_ID='30000000-0000-4000-8000-000000000003';
const GRANT_ID='40000000-0000-4000-8000-000000000004';
const REQUEST_ID='50000000-0000-4000-8000-000000000005';

const owner=contract.normalizeContext({is_admin:true,user_id:OWNER_ID,role:'OWNER',status:'active',permissions:[]});
const staff=contract.normalizeContext({is_admin:true,user_id:STAFF_ID,role:'STAFF',status:'active',permissions:['users.read','licenses.read','licenses.grant','audit.read']});
const revokingStaff=contract.normalizeContext({is_admin:true,user_id:STAFF_ID,role:'STAFF',status:'active',permissions:['users.read','licenses.read','licenses.revoke']});
const recoveryStaff=contract.normalizeContext({is_admin:true,user_id:STAFF_ID,role:'STAFF',status:'active',permissions:[]});

(async()=>{
await test('OWNER recebe permissões implícitas e todas as seções',()=>{
  equal(owner.active,true);equal(owner.role,'OWNER');
  deep(contract.visibleSections(owner),['overview','users','staff','audit']);
  for(const permission of contract.ENABLED_PERMISSIONS)ok(contract.hasPermission(owner,permission),permission);
});

await test('STAFF recebe somente permissões explícitas e nunca gestão de funcionários',()=>{
  deep(contract.visibleSections(staff),['users','audit']);
  equal(contract.hasPermission(staff,'licenses.grant'),true);
  equal(contract.hasPermission(staff,'licenses.revoke'),false);
  equal(contract.hasPermission(staff,'staff.manage'),false);
  equal(contract.canShowNavigation(contract.normalizeContext({role:'STAFF',status:'active',permissions:[]})),true);
  equal(contract.hasPermission(recoveryStaff,'users.password_recovery'),true);
  equal(contract.canShowNavigation(contract.normalizeContext({role:'STAFF',status:'disabled',permissions:['users.read']})),false);
});

await test('UI bloqueia self-license de STAFF, OWNER e outro STAFF',()=>{
  equal(contract.canManageCustomerLicense(staff,{id:STAFF_ID},'licenses.grant'),false);
  equal(contract.canManageCustomerLicense(staff,{id:OWNER_ID,admin_role:'OWNER'},'licenses.grant'),false);
  equal(contract.canManageCustomerLicense(staff,{id:OWNER_ID,admin_role:'STAFF'},'licenses.grant'),false);
  equal(contract.canManageCustomerLicense(staff,{id:CUSTOMER_ID},'licenses.grant'),true);
  equal(contract.canManageCustomerLicense(owner,{id:OWNER_ID,admin_role:'OWNER'},'licenses.grant'),true);
});

await test('recuperação administrativa respeita OWNER, CUSTOMER e auto/proteção STAFF',()=>{
  equal(contract.canRequestPasswordRecovery(owner,{id:OWNER_ID,admin_role:'OWNER'}),false);
  equal(contract.canRequestPasswordRecovery(owner,{id:STAFF_ID,admin_role:'STAFF'}),true);
  equal(contract.canRequestPasswordRecovery(recoveryStaff,{id:CUSTOMER_ID}),true);
  equal(contract.canRequestPasswordRecovery(recoveryStaff,{id:STAFF_ID}),false);
  equal(contract.canRequestPasswordRecovery(recoveryStaff,{id:OWNER_ID,admin_role:'OWNER'}),false);
  equal(contract.canRequestPasswordRecovery(recoveryStaff,{id:'60000000-0000-4000-8000-000000000006',admin_role:'STAFF'}),false);
  ok(!contract.STAFF_ASSIGNABLE.includes('users.password_recovery'));
  ok(!contract.STAFF_ASSIGNABLE.includes('users.sessions_revoke'));
  ok(!contract.hasPermission(owner,'users.sessions_revoke'));
  const request=contract.validatePasswordRecoveryRequest({requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,reason:'Recuperação solicitada pelo cliente'});
  equal(request.targetUserId,CUSTOMER_ID);equal(request.reason,'Recuperação solicitada pelo cliente');
  assert.throws(()=>contract.validatePasswordRecoveryRequest({...request,expiresAt:'2027-01-01'}),/not allowed/);assertions++;
});

await test('redefinição direta é exclusiva do OWNER e reutiliza a política forte da própria conta',()=>{
  equal(contract.canDirectResetPassword(owner,{id:CUSTOMER_ID}),true);
  equal(contract.canDirectResetPassword(owner,{id:STAFF_ID,admin_role:'STAFF'}),true);
  equal(contract.canDirectResetPassword(owner,{id:OWNER_ID,admin_role:'OWNER'}),false);
  equal(contract.canDirectResetPassword(recoveryStaff,{id:CUSTOMER_ID}),false);
  equal(contract.canDirectResetPassword(recoveryStaff,{id:OWNER_ID,admin_role:'OWNER'}),false);
  equal(contract.passwordIssues('Synthetic-Strong-2026!').length,0);
  ok(contract.passwordIssues('weak').length>=4);
  ok(contract.passwordIssues(`A1!${'a'.repeat(126)}`).some(issue=>issue.includes('máximo')));
  const request=contract.validateDirectPasswordResetRequest({
    requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,
    newPassword:'Synthetic-Strong-2026!',confirmPassword:'Synthetic-Strong-2026!',
    reason:'Suporte excepcional autorizado'
  });
  equal(request.targetUserId,CUSTOMER_ID);equal(request.newPassword,'Synthetic-Strong-2026!');
  assert.throws(()=>contract.validateDirectPasswordResetRequest({...request,confirmPassword:'Different-Strong-2027!'}),/confirmation/);assertions++;
  assert.throws(()=>contract.validateDirectPasswordResetRequest({...request,newPassword:'weak',confirmPassword:'weak'}),/security policy/);assertions++;
  assert.throws(()=>contract.validateDirectPasswordResetRequest({...request,reason:'synthetic-strong-2026!'}),/must not contain/);assertions++;
});

await test('contratos validam monthly/annual/lifetime, motivo, requestId e campos controlados',()=>{
  const monthly=contract.validateGrantRequest({requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,products:['APP'],licenseKind:'monthly',reason:'Aprovação mensal do cliente'});
  equal(monthly.licenseKind,'monthly');
  const grant=contract.validateGrantRequest({requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,products:['knowledge','APP'],licenseKind:'annual',reason:'Aprovação anual do cliente'});
  deep(grant.products,['APP','KNOWLEDGE']);equal(grant.licenseKind,'annual');
  equal(contract.validateGrantRequest({...grant,licenseKind:'lifetime'}).licenseKind,'lifetime');
  assert.throws(()=>contract.validateGrantRequest({...grant,licenseKind:'quarterly'}),/license kind/);assertions++;
  assert.throws(()=>contract.validateGrantRequest({...grant,reason:'curto'}),/reason/);assertions++;
  assert.throws(()=>contract.validateGrantRequest({...grant,expiresAt:'2099-01-01'}),/not allowed/);assertions++;
  assert.throws(()=>contract.validateStaffAddRequest({requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,permissions:['staff.manage'],reason:'Cadastro inicial autorizado'}),/cannot be assigned/);assertions++;
  const revoke=contract.validateRevokeRequest({requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,grantId:GRANT_ID,reason:'Revogação solicitada pelo cliente'});
  equal(revoke.grantId,GRANT_ID);
});

await test('cursores são objetos canônicos e não strings frouxas',()=>{
  const cursor=contract.normalizeCursor({createdAt:'2026-08-26T15:00:00Z',userId:CUSTOMER_ID},'users');
  equal(cursor.createdAt,'2026-08-26T15:00:00.000Z');equal(cursor.userId,CUSTOMER_ID);
  assert.throws(()=>contract.normalizeCursor('[object Object]','users'),/cursor/);assertions++;
});

await test('contrato comercial preserva acesso interno e compatibilidade comercial',()=>{
  const internal=commercial.normalizeEntitlements({server_now:'2026-08-26T12:00:00Z',app:{has_access:true,access_type:'internal',status:'active',access_basis:'internal',internal_access:true,commercial_access:{has_access:false}},knowledge:{has_access:true,access_type:'internal',status:'active',access_basis:'internal',internal_access:true},trial:{state:'eligible'},internal_access:{active:true,app:true,knowledge:true,role:'STAFF'},access_basis:'internal'});
  equal(internal.app.accessType,'internal');equal(internal.app.accessBasis,'internal');equal(internal.app.internalAccess,true);equal(internal.internalAccess.active,true);equal(internal.internalAccess.role,'STAFF');equal(internal.accessBasis,'internal');equal(commercial.resolveExperience({server_now:'2026-08-26T12:00:00Z',app:{has_access:true,access_type:'internal',status:'active'},knowledge:{has_access:true,access_type:'internal',status:'active'},internal_access:{active:true,app:true,knowledge:true}}),'complete');
  const legacy=commercial.normalizeEntitlements({server_now:'2026-08-26T12:00:00Z',app:{has_access:true,access_type:'paid',status:'active'},knowledge:{has_access:false},trial:{state:'eligible'}});
  equal(legacy.accessBasis,'commercial');equal(legacy.internalAccess.active,false);
});

await test('sessão interna aceita short-circuit autoritativo sem consumir trial',async()=>{
  const calls=[];
  const payload={server_now:'2026-08-26T12:00:00Z',app:{has_access:true,access_type:'internal',status:'active',access_basis:'internal',internal_access:true},knowledge:{has_access:true,access_type:'internal',status:'active',access_basis:'internal',internal_access:true},trial:{state:'eligible'},internal_access:{active:true,app:true,knowledge:true,role:'OWNER'}};
  const client={rpc:async name=>{calls.push(name);return name==='start_my_app_trial'?{data:[{result:'internal_access',trial_state:'eligible'}],error:null}:{data:payload,error:null}}};
  const session=await commercial.beginCommercialSession(client);
  equal(session.trialResult,'internal_access');equal(session.experience,'complete');deep(calls,['start_my_app_trial','get_my_entitlements']);
});

await test('cliente usa JWT atual e envia somente a action para a Edge Function',async()=>{
  const calls=[];
  const supabaseClient={
    auth:{getSession:async()=>({data:{session:{access_token:'user-jwt',user:{id:STAFF_ID}}},error:null})},
    functions:{invoke:async(name,options)=>{calls.push({name,options});return {data:{ok:true,data:{is_admin:true,role:'STAFF',status:'active',permissions:['users.read']}},error:null}}}
  };
  const client=clientModule.createAdminAccessClient({supabaseClient,cryptoApi:{randomUUID:()=>REQUEST_ID}});
  const context=await client.me();equal(context.user_id,STAFF_ID);equal(calls[0].name,'admin-access-control-v1');equal(calls[0].options.body.action,'me');equal(calls[0].options.headers.Authorization,'Bearer user-jwt');
  equal(client.operationId(),REQUEST_ID);
  await client.requestPasswordRecovery({requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,reason:'Recuperação solicitada pelo OWNER'});
  equal(calls[1].options.body.action,'users.password_recovery');equal(calls[1].options.body.targetUserId,CUSTOMER_ID);
  ok(!Object.prototype.hasOwnProperty.call(calls[1].options.body,'email'));ok(!Object.prototype.hasOwnProperty.call(calls[1].options.body,'password'));
  await client.resetUserPassword({requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,newPassword:'Synthetic-Strong-2026!',confirmPassword:'Synthetic-Strong-2026!',reason:'Suporte excepcional autorizado'});
  equal(calls[2].options.body.action,'users.password.reset_direct');equal(calls[2].options.body.newPassword,'Synthetic-Strong-2026!');
  ok(!Object.prototype.hasOwnProperty.call(calls[2].options.body,'actorUserId'));
  assert.throws(()=>client.grantLicense({requestId:REQUEST_ID,targetUserId:CUSTOMER_ID,products:['APP'],licenseKind:'annual',reason:'Licença anual aprovada',actorUserId:OWNER_ID}),/not allowed/);assertions++;
});

await test('operationId prefere randomUUID e usa fallback Web Crypto UUID v4 seguro',()=>{
  let randomUuidCalls=0,getRandomValuesCalls=0;
  const preferred=clientModule.operationId({
    randomUUID:()=>{randomUuidCalls++;return REQUEST_ID},
    getRandomValues:()=>{getRandomValuesCalls++;throw new Error('fallback não deve ser usado')}
  });
  equal(preferred,REQUEST_ID);equal(randomUuidCalls,1);equal(getRandomValuesCalls,0);

  const source=Uint8Array.from([0x00,0x11,0x22,0x33,0x44,0x55,0xff,0x77,0xff,0x99,0xaa,0xbb,0xcc,0xdd,0xee,0xff]);
  const fallback=clientModule.operationId({getRandomValues:bytes=>{getRandomValuesCalls++;bytes.set(source);return bytes}});
  equal(fallback,'00112233-4455-4f77-bf99-aabbccddeeff');
  equal(getRandomValuesCalls,1);
  equal(contract.uuid(fallback,'request ID'),fallback);
  ok(/^([0-9a-f]{8}-){1}[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(fallback));

  const clientSource=fs.readFileSync(path.join(__dirname,'../js/admin-access-client.js'),'utf8');
  ok(!clientSource.includes('Math.random'));
  assert.throws(()=>clientModule.operationId({}),error=>error.code==='secure_request_id_unavailable');assertions++;
});

await test('cliente falha fechado em sessão ausente e traduz erro da Edge',async()=>{
  const noSession=clientModule.createAdminAccessClient({supabaseClient:{auth:{getSession:async()=>({data:{session:null}})},functions:{invoke:async()=>({})}}});
  await rejects(()=>noSession.me(),error=>error.status===401&&error.code==='missing_session');
  const denied=clientModule.createAdminAccessClient({supabaseClient:{auth:{getSession:async()=>({data:{session:{access_token:'jwt',user:{id:STAFF_ID}}}})},functions:{invoke:async()=>({data:{ok:false,error:{code:'permission_denied'}},error:null})}}});
  await rejects(()=>denied.me(),error=>error.code==='permission_denied');
  const httpDenied=clientModule.createAdminAccessClient({supabaseClient:{
    auth:{getSession:async()=>({data:{session:{access_token:'jwt',user:{id:STAFF_ID}}}})},
    functions:{invoke:async()=>({
      data:null,
      error:{message:'FunctionsHttpError',context:new Response(JSON.stringify({ok:false,error:{code:'permission_denied'}}),{status:403,headers:{'content-type':'application/json'}})}
    })}
  }});
  await rejects(()=>httpDenied.me(),error=>error.status===403&&error.code==='permission_denied');
});

await test('requestId permanece estável no mesmo diálogo e submit pending fica bloqueado',()=>{
  let generated=0;const dialog={kind:'grant'},fake={operationId:()=>{generated++;return REQUEST_ID}};
  equal(adminArea.ensureDialogRequestId(dialog,fake),REQUEST_ID);equal(adminArea.ensureDialogRequestId(dialog,fake),REQUEST_ID);equal(generated,1);
  const html=adminArea.renderAdminArea({contextPhase:'ready',context:owner,section:'users',message:'',dialog:{kind:'grant',pending:true,user:{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test'}},users:{phase:'idle',query:'',items:[]},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}});
  ok(html.includes('aria-busy="true"'));ok(html.includes('Processando…'));
});

await test('logout/troca de sessão limpa contexto e navegação administrativa em memória',async()=>{
  const api=adminArea.createAdminArea({client:{me:async()=>({is_admin:true,user_id:OWNER_ID,role:'OWNER',status:'active'}),listStaff:async()=>[],listAudit:async()=>[]},document:null});
  await api.loadContext({silent:true});equal(api.canShowNavigation(),true);api.resetContext();equal(api.canShowNavigation(),false);equal(api.snapshot().context.active,false);
});

await test('render escapa dados remotos e apresenta OWNER sem DELETE',()=>{
  const malicious='<img src=x onerror=alert(1)>';
  const html=adminArea.renderAdminArea({contextPhase:'ready',context:owner,section:'users',message:malicious,dialog:null,users:{phase:'ready',query:malicious,items:[{id:CUSTOMER_ID,name:malicious,email:'x@example.test',trial:{state:'active'},access:[{product_code:'APP',status:'active',access_type:'manual',grant_id:GRANT_ID,administrative:true,source:malicious}]}]},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}});
  ok(!html.includes(malicious));ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));ok(html.includes('Conceder licença'));ok(html.includes('Revogar esta licença'));ok(html.includes('Enviar recuperação de senha'));ok(html.includes('Redefinir senha do usuário'));ok(!/>Excluir</.test(html));
  const audit=adminArea.renderAdminArea({contextPhase:'ready',context:owner,section:'audit',message:'',dialog:null,users:{phase:'idle',items:[]},staff:{phase:'idle',items:[]},audit:{phase:'ready',items:[{actor_name:malicious,target_name:malicious,action:malicious,result:'denied',reason:malicious}]}});
  ok(!audit.includes(malicious));ok(audit.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

await test('ações administrativas de senha renderizam conforme papel e alvo',()=>{
  const renderUser=(context,user)=>adminArea.renderAdminArea({contextPhase:'ready',context,section:'users',message:'',dialog:null,users:{phase:'ready',query:'cliente',items:[user]},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}});
  const ownerCustomer=renderUser(owner,{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test'});
  ok(ownerCustomer.includes('Enviar recuperação de senha'));ok(ownerCustomer.includes('Redefinir senha do usuário'));
  const ownerStaff=renderUser(owner,{id:STAFF_ID,name:'Funcionário',email:'staff@example.test',admin_role:'STAFF'});
  ok(ownerStaff.includes('Enviar recuperação de senha'));ok(ownerStaff.includes('Redefinir senha do usuário'));
  const staffCustomer=renderUser(recoveryStaff,{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test'});
  ok(staffCustomer.includes('Enviar recuperação de senha'));ok(!staffCustomer.includes('Redefinir senha do usuário'));
  for(const target of [
    {id:STAFF_ID,admin_role:'STAFF'},
    {id:OWNER_ID,admin_role:'OWNER'},
    {id:'60000000-0000-4000-8000-000000000006',admin_role:'STAFF'}
  ]){
    const html=renderUser(recoveryStaff,target);
    ok(!html.includes('Enviar recuperação de senha'));ok(!html.includes('Redefinir senha do usuário'));
  }
});

await test('revogação aparece somente em grant administrativo não revogado e alvo autorizado',()=>{
  const renderUser=(context,user)=>adminArea.renderAdminArea({contextPhase:'ready',context,section:'users',message:'',dialog:null,users:{phase:'ready',query:'cliente',items:[user]},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}});
  const activeGrant={product_code:'APP',status:'active',access_type:'manual',license_kind:'monthly',grant_id:GRANT_ID,administrative:true,source:'manual'};
  const active=renderUser(revokingStaff,{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test',access:[activeGrant]});
  ok(active.includes('Ativo'));ok(active.includes('Mensal'));ok(active.includes('Revogar esta licença'));

  const revoked=renderUser(revokingStaff,{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test',access:[{...activeGrant,status:'revoked'}]});
  ok(revoked.includes('Aplicativo'));ok(revoked.includes('Revogado'));ok(!revoked.includes('Revogar esta licença'));

  const external=renderUser(revokingStaff,{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test',access:[{...activeGrant,administrative:false}]});
  ok(!external.includes('Revogar esta licença'));
  const self=renderUser(revokingStaff,{id:STAFF_ID,name:'Funcionário',email:'staff@example.test',admin_role:'STAFF',access:[activeGrant]});
  ok(!self.includes('Revogar esta licença'));
  const ownerTarget=renderUser(revokingStaff,{id:OWNER_ID,name:'Owner',email:'owner@example.test',admin_role:'OWNER',access:[activeGrant]});
  ok(!ownerTarget.includes('Revogar esta licença'));
});

await test('listagem distingue Mensal, Anual e Vitalícia pela espécie persistida do grant',()=>{
  const html=adminArea.renderAdminArea({contextPhase:'ready',context:owner,section:'users',message:'',dialog:null,users:{phase:'ready',query:'cliente',items:[{
    id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test',access:[
      {product_code:'APP',status:'active',access_type:'manual',license_kind:'monthly',grant_id:GRANT_ID,administrative:true,source:'manual'},
      {product_code:'KNOWLEDGE',status:'active',access_type:'manual',license_kind:'annual',grant_id:'41000000-0000-4000-8000-000000000004',administrative:true,source:'manual'},
      {product_code:'APP',status:'active',access_type:'lifetime',license_kind:'lifetime',grant_id:'42000000-0000-4000-8000-000000000004',administrative:true,source:'manual'}
    ]
  }]},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}});
  ok(html.includes('Mensal'));ok(html.includes('Anual'));ok(html.includes('Vitalício'));
  equal(contract.normalizeAccess({access_type:'manual',license_kind:'monthly'}).licenseKind,'monthly');
});

await test('CUSTOMER/401/403 e estados loading/empty/error são explícitos',()=>{
  const base={context:contract.normalizeContext(null),section:'users',message:'',dialog:null,users:{phase:'idle',items:[]},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}};
  ok(adminArea.renderAdminArea({...base,contextPhase:'ready'}).includes('não possui acesso'));
  ok(adminArea.renderAdminArea({...base,contextPhase:'loading'}).includes('Carregando'));
  ok(adminArea.renderAdminArea({...base,contextPhase:'error',contextError:{status:401}}).includes('sessão expirou'));
  ok(adminArea.renderAdminArea({...base,contextPhase:'error',contextError:{status:403}}).includes('não possui permissão'));
});

await test('OWNER visualiza Funcionários e Auditoria; STAFF segue permissões',()=>{
  const empty={phase:'ready',items:[]};
  const ownerStaff=adminArea.renderAdminArea({contextPhase:'ready',context:owner,section:'staff',message:'',dialog:null,users:empty,staff:empty,audit:empty});
  ok(ownerStaff.includes('Adicionar funcionário'));ok(ownerStaff.includes('Nenhum resultado'));
  const staffAudit=adminArea.renderAdminArea({contextPhase:'ready',context:staff,section:'audit',message:'',dialog:null,users:empty,staff:empty,audit:{phase:'ready',items:[{actor_name:'Alice',target_name:'Cliente',action:'license.grant',result:'succeeded',reason:'Autorização registrada',created_at:'2026-08-26T12:00:00Z'}]}});
  ok(staffAudit.includes('Auditoria'));ok(staffAudit.includes('Alice'));ok(!staffAudit.includes('Funcionários</button>'));
});

await test('ações sensíveis exibem confirmação e exigem motivo compatível com a Edge',()=>{
  const base={contextPhase:'ready',context:owner,section:'users',message:'',users:{phase:'idle',query:'',items:[]},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}};
  const grant=adminArea.renderAdminArea({...base,dialog:{kind:'grant',user:{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test'}}});
  ok(grant.includes('Motivo obrigatório'));ok(grant.includes('minlength="8"'));ok(grant.includes('APP'));ok(grant.includes('KNOWLEDGE'));
  ok(grant.includes('<option value="monthly"'));ok(grant.includes('Mensal'));
  ok(grant.includes('<option value="annual"'));ok(grant.includes('Anual'));
  ok(grant.includes('<option value="lifetime"'));ok(grant.includes('Vitalício'));
  deep(licenseOptionValues(grant),['monthly','annual','lifetime']);
  deep(contract.grantLicenseKinds(owner),['monthly','annual','lifetime']);
  const staffGrant=adminArea.renderAdminArea({...base,context:staff,dialog:{kind:'grant',user:{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test'}}});
  ok(staffGrant.includes('<option value="monthly"'));ok(staffGrant.includes('<option value="annual"'));
  ok(!staffGrant.includes('<option value="lifetime"'));ok(!staffGrant.includes('Vitalício'));
  deep(licenseOptionValues(staffGrant),['monthly','annual']);
  deep(contract.grantLicenseKinds(staff),['monthly','annual']);
  const revoke=adminArea.renderAdminArea({...base,dialog:{kind:'revoke',userId:CUSTOMER_ID,grantId:GRANT_ID,product:'APP'}});
  ok(revoke.includes('Confirma a revogação'));ok(revoke.includes('Somente a licença administrativa selecionada'));ok(revoke.includes('Revogar licença'));
  const recovery=adminArea.renderAdminArea({...base,dialog:{kind:'password-recovery',user:{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test'}}});
  ok(recovery.includes('Enviar recuperação de senha'));ok(recovery.includes('nunca verá nem definirá a nova senha'));ok(recovery.includes('Motivo obrigatório'));
  const direct=adminArea.renderAdminArea({...base,dialog:{kind:'password-reset-direct',user:{id:CUSTOMER_ID,name:'Cliente',email:'cliente@example.test'}}});
  ok(direct.includes('Redefinir senha do usuário'));ok(direct.includes('Use apenas em situação excepcional de suporte.'));ok(direct.includes('A senha atual não será exibida.'));
  ok(direct.includes('name="newPassword"'));ok(direct.includes('name="confirmPassword"'));ok(direct.includes('Motivo obrigatório'));ok(direct.includes('Redefinir senha'));
  ok(direct.includes(`minlength="${contract.MIN_PASSWORD_LENGTH}"`));ok(direct.includes('autocomplete="new-password"'));
  ok(direct.includes(`maxlength="${contract.MAX_PASSWORD_LENGTH}"`));
});

await test('integração registra assets, menu condicionado e rota administrativa',()=>{
  const root=path.join(__dirname,'..'),index=fs.readFileSync(path.join(root,'index.html'),'utf8'),css=fs.readFileSync(path.join(root,'assets/admin-area.css'),'utf8');
  for(const asset of ['assets/admin-area.css','commercial/admin-access-contract.js','js/admin-access-client.js','js/admin-area.js'])ok(index.includes(asset),asset);
  ok(index.includes("AVIORA_ADMIN_APP.canShowNavigation()"));ok(index.includes("TAB==='administration'"));ok(index.includes("AVIORA_ADMIN_APP.loadContext({silent:true})"));
  equal((index.match(/AVIORA_ADMIN_APP\.resetContext\(\)/g)||[]).length,2);
  ok(css.includes('@media (max-width: 600px)'));ok(css.includes('grid-template-columns: 1fr'));ok(css.includes('min-height: 44px'));ok(css.includes('env(safe-area-inset-bottom)'));
  const navBody=index.match(/window\.__MB_BASE_NAV60__\s*=\s*function\(\)\{([\s\S]*?)\n\s*\};/)?.[1];ok(navBody);
  const renderNav=allowed=>{const nav={innerHTML:'',setAttribute(){},querySelectorAll(){return []}};vm.runInNewContext(`(function(){${navBody}})()`,{TAB:'dashboard',AVIORA_ADMIN_APP:{canShowNavigation:()=>allowed},document:{getElementById:()=>nav}});return nav.innerHTML};
  ok(!renderNav(false).includes('data-tab="administration"'));ok(renderNav(true).includes('data-tab="administration"'));
});

await test('frontend administrativo não contém segredo, papel persistido ou API privilegiada',()=>{
  const root=path.join(__dirname,'..'),files=['commercial/admin-access-contract.js','js/admin-access-client.js','js/admin-area.js','assets/admin-area.css'];
  const source=files.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
  ok(!/service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_|BEGIN PRIVATE KEY/i.test(source));
  ok(!/localStorage|sessionStorage|ADMIN_EMAIL|user\.email\s*===/i.test(source));
  ok(!source.includes('Math.random'));
  ok(source.includes("if(kind!=='password-reset-direct')model.dialog.operation=operation"));
  ok(source.includes('raw=null;operation=null'));
  ok(source.includes("for(const name of ['newPassword','confirmPassword'])"));
  ok(!source.includes('model.dialog.password'));
  ok(source.includes('Bearer ${token}'));ok(source.includes("functions.invoke(functionName"));ok(!source.includes('.rpc('));
});

console.log(`admin-access-frontend: ${tests} tests, ${assertions} assertions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
