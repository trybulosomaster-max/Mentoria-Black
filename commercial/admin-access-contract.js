(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AVAdminAccessContract=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ROLES=Object.freeze(['OWNER','STAFF']);
  const STATUSES=Object.freeze(['active','disabled']);
  const PERMISSIONS=Object.freeze([
    'users.read',
    'users.password_recovery',
    'users.sessions_revoke',
    'licenses.read',
    'licenses.grant',
    'licenses.revoke',
    'audit.read',
    'staff.read',
    'staff.manage'
  ]);
  const ENABLED_PERMISSIONS=Object.freeze(PERMISSIONS.filter(key=>key!=='users.sessions_revoke'));
  const STAFF_ASSIGNABLE=Object.freeze(ENABLED_PERMISSIONS.filter(key=>
    !key.startsWith('staff.')&&key!=='users.password_recovery'
  ));
  const PRODUCTS=Object.freeze(['APP','KNOWLEDGE']);
  const LICENSE_KINDS=Object.freeze(['monthly','annual','lifetime']);
  const MANAGEMENT_FILTERS=Object.freeze(['accounts','active_clients','monthly','annual','lifetime','trial_active','origin','expiring_30_days']);
  const MIN_PASSWORD_LENGTH=12;
  const MAX_PASSWORD_LENGTH=128;
  const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const FORBIDDEN_CLIENT_FIELDS=Object.freeze(['actorUserId','actor_user_id','effectiveRole','effective_role','expiresAt','expires_at','assumedPermissions','assumed_permissions']);

  function plain(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
  function dataOf(value){
    const source=plain(value);
    if(Object.prototype.hasOwnProperty.call(source,'data')&&source.data!==undefined)return source.data;
    return value;
  }
  function rowOf(value){
    const data=dataOf(value);
    return Array.isArray(data)?plain(data[0]):plain(data);
  }
  function requiredText(value,label,min=1,max=500){
    const text=String(value??'').trim();
    if(text.length<min)throw new TypeError(`${label} is required`);
    if(text.length>max)throw new TypeError(`${label} is too long`);
    return text;
  }
  function normalizeCursor(value,kind='users'){
    if(value===undefined||value===null)return null;
    const source=plain(value),idKey=kind==='audit'?'id':'userId';
    const createdAt=String(source.createdAt||'').trim(),id=uuid(source[idKey],`cursor ${idKey}`);
    if(!createdAt||!Number.isFinite(Date.parse(createdAt)))throw new TypeError('valid cursor timestamp is required');
    return Object.freeze({createdAt:new Date(createdAt).toISOString(),[idKey]:id});
  }
  function uuid(value,label='user ID'){
    const normalized=String(value??'').trim().toLowerCase();
    if(!UUID_RE.test(normalized))throw new TypeError(`valid ${label} is required`);
    return normalized;
  }
  function rejectForbiddenFields(payload){
    const visit=(value,path)=>{
      if(!value||typeof value!=='object')return;
      for(const [key,child] of Object.entries(value)){
        if(FORBIDDEN_CLIENT_FIELDS.includes(key))throw new TypeError(`client field is not allowed: ${path}${key}`);
        visit(child,`${path}${key}.`);
      }
    };
    visit(payload,'');
    return payload;
  }
  function normalizePermissions(value){
    const list=Array.isArray(value)?value:[];
    return Object.freeze([...new Set(list.map(item=>String(item||'').trim()).filter(item=>PERMISSIONS.includes(item)))].sort());
  }
  function normalizeContext(payload){
    const source=rowOf(payload);
    const role=ROLES.includes(String(source.role||'').toUpperCase())?String(source.role).toUpperCase():null;
    const status=STATUSES.includes(String(source.status||'').toLowerCase())?String(source.status).toLowerCase():'inactive';
    const active=(source.active===true||status==='active')&&role!==null;
    const assigned=normalizePermissions(source.permissions||source.effective_permissions);
    const permissions=role==='OWNER'&&active?Object.freeze([...ENABLED_PERMISSIONS]):active?Object.freeze([
      ...new Set([
        ...assigned.filter(key=>ENABLED_PERMISSIONS.includes(key)),
        ...(role==='STAFF'?['users.password_recovery']:[])
      ])
    ].sort()):Object.freeze([]);
    return Object.freeze({
      active,
      role:active?role:null,
      status:active?status:status==='disabled'?'disabled':'inactive',
      permissions,
      userId:source.user_id||source.userId?String(source.user_id||source.userId):null,
      lastAdminAccessAt:source.last_admin_access_at||source.lastAdminAccessAt||null
    });
  }
  function hasPermission(context,key){
    if(!PERMISSIONS.includes(key))return false;
    const normalized=normalizeContext(context);
    return normalized.active&&normalized.permissions.includes(key);
  }
  function visibleSections(context){
    const normalized=normalizeContext(context),sections=[];
    if(!normalized.active)return Object.freeze(sections);
    if(normalized.role==='OWNER')sections.push('overview');
    if(normalized.role==='STAFF'||['users.read','licenses.read','licenses.grant','licenses.revoke'].some(key=>hasPermission(normalized,key)))sections.push('users');
    if(normalized.role==='OWNER')sections.push('staff');
    if(hasPermission(normalized,'audit.read'))sections.push('audit');
    return Object.freeze(sections);
  }
  function canShowNavigation(context){return visibleSections(context).length>0}
  function targetIdentity(target){
    const source=plain(target);
    return Object.freeze({
      userId:source.user_id||source.userId||source.id?String(source.user_id||source.userId||source.id):null,
      adminRole:ROLES.includes(String(source.admin_role||source.adminRole||source.role||'').toUpperCase())?String(source.admin_role||source.adminRole||source.role).toUpperCase():null,
      adminStatus:String(source.admin_status||source.adminStatus||'').toLowerCase()||null
    });
  }
  function canManageCustomerLicense(context,target,permission){
    const actor=normalizeContext(context),identity=targetIdentity(target);
    if(!hasPermission(actor,permission))return false;
    if(actor.role==='OWNER')return true;
    if(!identity.userId||identity.userId===actor.userId)return false;
    return !identity.adminRole;
  }
  function grantLicenseKinds(context){
    const actor=normalizeContext(context);
    if(!hasPermission(actor,'licenses.grant'))return Object.freeze([]);
    return actor.role==='OWNER'?LICENSE_KINDS:Object.freeze(['monthly','annual']);
  }
  function canSearchUsers(context){
    const actor=normalizeContext(context);
    return actor.active&&(actor.role==='OWNER'||actor.role==='STAFF');
  }
  function canRequestPasswordRecovery(context,target){
    const actor=normalizeContext(context),identity=targetIdentity(target);
    if(!actor.active||!identity.userId||identity.userId===actor.userId)return false;
    if(actor.role==='OWNER')return identity.adminRole!=='OWNER';
    if(actor.role!=='STAFF')return false;
    return !identity.adminRole;
  }
  function canDirectResetPassword(context,target){
    const actor=normalizeContext(context),identity=targetIdentity(target);
    return actor.active&&actor.role==='OWNER'&&Boolean(identity.userId)
      &&identity.userId!==actor.userId&&identity.adminRole!=='OWNER';
  }
  function passwordIssues(password){
    const value=String(password||''),issues=[];
    if(value.length<MIN_PASSWORD_LENGTH)issues.push(`pelo menos ${MIN_PASSWORD_LENGTH} caracteres`);
    if(value.length>MAX_PASSWORD_LENGTH)issues.push(`no máximo ${MAX_PASSWORD_LENGTH} caracteres`);
    if(!/[a-z]/.test(value))issues.push('uma letra minúscula');
    if(!/[A-Z]/.test(value))issues.push('uma letra maiúscula');
    if(!/[0-9]/.test(value))issues.push('um número');
    if(!/[^A-Za-z0-9]/.test(value))issues.push('um símbolo');
    return Object.freeze(issues);
  }
  function validateDirectPasswordResetRequest(value){
    const source=plain(value);rejectForbiddenFields(source);
    const newPassword=String(source.newPassword??''),confirmation=String(source.confirmPassword??newPassword);
    if(passwordIssues(newPassword).length)throw new TypeError('new password does not meet the security policy');
    if(newPassword!==confirmation)throw new TypeError('password confirmation does not match');
    const administrativeReason=requiredText(source.reason,'administrative reason',8,500);
    if(administrativeReason.toLocaleLowerCase('en-US').includes(newPassword.toLocaleLowerCase('en-US')))throw new TypeError('administrative reason must not contain the password');
    return Object.freeze({
      requestId:uuid(source.requestId||source.request_id,'request ID'),
      targetUserId:uuid(source.targetUserId||source.target_user_id,'target user ID'),
      newPassword,
      reason:administrativeReason
    });
  }
  function validateSearchRequest(value){
    const source=typeof value==='string'?{query:value}:plain(value);
    rejectForbiddenFields(source);
    const query=requiredText(source.query,'search query',3,120);
    const limit=Math.max(1,Math.min(50,Number(source.limit)||20));
    return Object.freeze({query,cursor:normalizeCursor(source.cursor,'users'),limit});
  }
  function normalizeProducts(value){
    if(!Array.isArray(value)||!value.length)throw new TypeError('at least one product is required');
    const products=[...new Set(value.map(item=>String(item||'').trim().toUpperCase()))];
    if(products.some(product=>!PRODUCTS.includes(product)))throw new TypeError('invalid product');
    return Object.freeze(PRODUCTS.filter(product=>products.includes(product)));
  }
  function validateGrantRequest(value){
    const source=plain(value);rejectForbiddenFields(source);
    const licenseKind=String(source.licenseKind||source.license_kind||'').toLowerCase();
    if(!LICENSE_KINDS.includes(licenseKind))throw new TypeError('valid license kind is required');
    return Object.freeze({
      requestId:uuid(source.requestId||source.request_id,'request ID'),
      targetUserId:uuid(source.targetUserId||source.target_user_id,'target user ID'),
      products:normalizeProducts(source.products),
      licenseKind,
      reason:requiredText(source.reason,'administrative reason',8,500)
    });
  }
  function validateRevokeRequest(value){
    const source=plain(value);rejectForbiddenFields(source);
    return Object.freeze({
      requestId:uuid(source.requestId||source.request_id,'request ID'),
      targetUserId:uuid(source.targetUserId||source.target_user_id,'target user ID'),
      grantId:uuid(source.grantId||source.grant_id,'grant ID'),
      reason:requiredText(source.reason,'administrative reason',8,500)
    });
  }
  function validatePasswordRecoveryRequest(value){
    const source=plain(value);rejectForbiddenFields(source);
    return Object.freeze({
      requestId:uuid(source.requestId||source.request_id,'request ID'),
      targetUserId:uuid(source.targetUserId||source.target_user_id,'target user ID'),
      reason:requiredText(source.reason,'administrative reason',8,500)
    });
  }
  function validateStaffPermissions(value){
    if(!Array.isArray(value))throw new TypeError('staff permissions are required');
    const permissions=[...new Set(value.map(item=>String(item||'').trim()))];
    if(permissions.some(key=>!STAFF_ASSIGNABLE.includes(key)))throw new TypeError('permission cannot be assigned to STAFF');
    return Object.freeze(permissions.sort());
  }
  function validateStaffAddRequest(value){
    const source=plain(value);rejectForbiddenFields(source);
    return Object.freeze({
      requestId:uuid(source.requestId||source.request_id,'request ID'),
      targetUserId:uuid(source.targetUserId||source.target_user_id,'target user ID'),
      permissions:validateStaffPermissions(source.permissions),
      reason:requiredText(source.reason,'administrative reason',8,500)
    });
  }
  function validateStaffPermissionsRequest(value){return validateStaffAddRequest(value)}
  function validateStaffStatusRequest(value){
    const source=plain(value);rejectForbiddenFields(source);
    const status=String(source.status||'').toLowerCase();
    if(!STATUSES.includes(status))throw new TypeError('valid staff status is required');
    return Object.freeze({
      requestId:uuid(source.requestId||source.request_id,'request ID'),
      targetUserId:uuid(source.targetUserId||source.target_user_id,'target user ID'),
      status,
      reason:requiredText(source.reason,'administrative reason',8,500)
    });
  }
  function validateManagementRequest(value={}){
    const source=plain(value);rejectForbiddenFields(source);
    const allowed=new Set(['periodStart','periodEnd','limit']);
    for(const key of Object.keys(source))if(!allowed.has(key))throw new TypeError(`client field is not allowed: ${key}`);
    const hasStart=source.periodStart!==undefined&&source.periodStart!==null&&source.periodStart!=='';
    const hasEnd=source.periodEnd!==undefined&&source.periodEnd!==null&&source.periodEnd!=='';
    if(hasStart!==hasEnd)throw new TypeError('management period start and end are required together');
    const normalizeDate=(input,label)=>{
      const value=String(input||'').trim(),time=Date.parse(value);
      if(!value||!Number.isFinite(time))throw new TypeError(`valid ${label} is required`);
      return new Date(time).toISOString();
    };
    const periodStart=hasStart?normalizeDate(source.periodStart,'period start'):undefined;
    const periodEnd=hasEnd?normalizeDate(source.periodEnd,'period end'):undefined;
    if(periodStart&&Date.parse(periodStart)>=Date.parse(periodEnd))throw new TypeError('management period is invalid');
    return Object.freeze({
      ...(periodStart?{periodStart,periodEnd}:{}),
      limit:Math.max(1,Math.min(100,Number(source.limit)||50))
    });
  }
  function normalizeManagementDashboard(value){
    const source=rowOf(value),metrics=plain(source.metrics),origin=plain(metrics.manual_commercial||metrics.manualCommercial),expiring=plain(metrics.expiring_30_days||metrics.expiring30Days),period=plain(source.period);
    const count=input=>Math.max(0,Number(input)||0);
    const rows=input=>Object.freeze((Array.isArray(input)?input:[]).map(item=>Object.freeze({...plain(item)})));
    return Object.freeze({
      serverNow:source.server_now||source.serverNow||null,
      period:Object.freeze({start:period.start||null,end:period.end||null,endExclusive:period.end_exclusive!==false}),
      metrics:Object.freeze({
        accounts:count(metrics.accounts),
        activeClients:count(metrics.active_clients||metrics.activeClients),
        monthlyLicenses:count(metrics.monthly_licenses||metrics.monthlyLicenses),
        annualLicenses:count(metrics.annual_licenses||metrics.annualLicenses),
        lifetimeLicenses:count(metrics.lifetime_licenses||metrics.lifetimeLicenses),
        trialActive:count(metrics.trial_active||metrics.trialActive),
        manualCommercial:Object.freeze({manual:count(origin.manual),commercial:count(origin.commercial),unknown:count(origin.unknown)}),
        expiring30Days:Object.freeze({grants:count(expiring.grants),users:count(expiring.users)})
      }),
      manualByActor:rows(source.manual_by_actor||source.manualByActor),
      manualActivity:rows(source.manual_activity||source.manualActivity)
    });
  }
  function validateManagementDrilldownRequest(value={}){
    const source=plain(value);rejectForbiddenFields(source);
    const allowed=new Set(['filter','origin','limit','cursor']);
    for(const key of Object.keys(source))if(!allowed.has(key))throw new TypeError(`client field is not allowed: ${key}`);
    const filter=String(source.filter||'').trim().toLowerCase();
    if(!MANAGEMENT_FILTERS.includes(filter))throw new TypeError('valid management filter is required');
    const origin=String(source.origin||'').trim().toLowerCase();
    if(filter==='origin'&&!['manual','commercial'].includes(origin))throw new TypeError('management origin must be manual or commercial');
    if(filter!=='origin'&&origin)throw new TypeError('management origin is only valid for the origin filter');
    const numeric=source.limit===undefined?25:Number(source.limit);
    if(!Number.isInteger(numeric)||numeric<1||numeric>50)throw new TypeError('management drilldown limit must be between 1 and 50');
    return Object.freeze({filter,...(origin?{origin}:{}),limit:numeric,cursor:normalizeCursor(source.cursor,'users')});
  }
  function normalizeManagementDrilldown(value){
    const source=rowOf(value),items=Array.isArray(source.items)?source.items:[];
    const cursor=plain(source.next_cursor||source.nextCursor);
    return Object.freeze({
      filter:MANAGEMENT_FILTERS.includes(String(source.filter||'').toLowerCase())?String(source.filter).toLowerCase():null,
      origin:['manual','commercial'].includes(String(source.origin||'').toLowerCase())?String(source.origin).toLowerCase():null,
      entity:String(source.entity||'users'),
      items:Object.freeze(items.map(normalizeUser)),
      nextCursor:cursor.created_at&&cursor.user_id?Object.freeze({createdAt:cursor.created_at,userId:cursor.user_id}):null
    });
  }
  function normalizeGrantTrace(value){
    const source=plain(value);
    if(!Object.keys(source).length)return null;
    return Object.freeze({
      actorUserId:source.actor_user_id||source.actorUserId||null,
      actorName:String(source.actor_name||source.actorName||'').trim(),
      actorEmail:String(source.actor_email||source.actorEmail||'').trim(),
      actorRole:String(source.actor_role||source.actorRole||'').toUpperCase()||null,
      actorStatus:String(source.actor_status||source.actorStatus||'').toLowerCase()||null,
      at:source.at||null,
      reason:String(source.reason||'').trim()
    });
  }
  function normalizeAccess(value){
    const source=plain(value);
    const state=source.state||source.status||'none';
    return Object.freeze({
      productCode:String(source.product_code||source.productCode||'').toUpperCase(),
      hasAccess:source.has_access===true||source.hasAccess===true||['active','grace_period'].includes(String(state).toLowerCase()),
      accessType:source.access_type||source.accessType||null,
      licenseKind:LICENSE_KINDS.includes(String(source.license_kind||source.licenseKind||'').toLowerCase())?String(source.license_kind||source.licenseKind).toLowerCase():null,
      state,
      source:source.source||null,
      originClass:source.origin_class||source.originClass||null,
      startedAt:source.started_at||source.startedAt||null,
      expiresAt:source.expires_at||source.expiresAt||null,
      grantId:source.grant_id||source.grantId||source.id||null,
      adminManaged:source.admin_managed===true||source.adminManaged===true||source.administrative===true,
      granted:normalizeGrantTrace(source.granted),
      revoked:normalizeGrantTrace(source.revoked)
    });
  }
  function normalizeUser(value){
    const source=plain(value),identity=plain(source.user),admin=plain(source.admin);
    const base=Object.keys(identity).length?identity:source;
    const accessRows=Array.isArray(source.access)?source.access:Array.isArray(source.grants)?source.grants:[];
    const trials=Array.isArray(source.trials)?source.trials:[];
    const access=accessRows.map(normalizeAccess);
    return Object.freeze({
      id:String(base.user_id||base.userId||base.id||''),
      name:String(base.name||base.display_name||'').trim(),
      email:String(base.email||'').trim(),
      adminRole:ROLES.includes(String(source.admin_role||source.adminRole||admin.role||'').toUpperCase())?String(source.admin_role||source.adminRole||admin.role).toUpperCase():null,
      adminStatus:source.admin_status||source.adminStatus||admin.status||null,
      trial:plain(source.trial||trials[0]||(source.trial_active?{state:'active'}:null)),
      access:Object.freeze(access)
    });
  }

  return Object.freeze({
    ROLES,STATUSES,PERMISSIONS,ENABLED_PERMISSIONS,STAFF_ASSIGNABLE,PRODUCTS,LICENSE_KINDS,MANAGEMENT_FILTERS,FORBIDDEN_CLIENT_FIELDS,
    normalizeContext,normalizePermissions,normalizeAccess,normalizeUser,normalizeGrantTrace,normalizeManagementDashboard,normalizeManagementDrilldown,targetIdentity,
    hasPermission,visibleSections,canShowNavigation,canManageCustomerLicense,grantLicenseKinds,canSearchUsers,canRequestPasswordRecovery,canDirectResetPassword,
    MIN_PASSWORD_LENGTH,MAX_PASSWORD_LENGTH,passwordIssues,validateSearchRequest,validateGrantRequest,validateRevokeRequest,validatePasswordRecoveryRequest,validateDirectPasswordResetRequest,validateStaffPermissions,
    validateStaffAddRequest,validateStaffPermissionsRequest,validateStaffStatusRequest,validateManagementRequest,validateManagementDrilldownRequest,
    rejectForbiddenFields,uuid,normalizeCursor
  });
});
