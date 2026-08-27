const ACTIONS=new Set([
  'me','users.search','licenses.get','licenses.grant','licenses.revoke',
  'users.password_recovery','users.password.reset_direct',
  'staff.list','staff.add','staff.permissions.set','staff.status.set','audit.list',
  'management.dashboard','management.drilldown'
]);

const PRODUCTS=new Set(['APP','KNOWLEDGE']);
const LICENSE_KINDS=new Set(['monthly','annual','lifetime']);
const STAFF_PERMISSIONS=new Set([
  'users.read','licenses.read','licenses.grant','licenses.revoke','audit.read'
]);
const FORBIDDEN_KEYS=new Set([
  'actorUserId','actor_user_id','effectiveRole','effective_role','expiresAt','expires_at',
  'assumedPermissions','assumed_permissions','serviceRole','service_role'
]);
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES=32768;
const MIN_PASSWORD_LENGTH=12;
const MAX_PASSWORD_LENGTH=128;

export class AdminApiError extends Error{
  constructor(status,code,message=code){
    super(message);
    this.name='AdminApiError';
    this.status=status;
    this.code=code;
    this.idempotent=false;
    this.retryAfter=null;
    this.rateLimitCheck=false;
    this.alreadyAudited=false;
  }
}

function fail(code,message=code){throw new AdminApiError(422,code,message)}

function isRecord(value){
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}

function assertNoForbiddenKeys(value,path='payload'){
  if(Array.isArray(value)){
    value.forEach((item,index)=>assertNoForbiddenKeys(item,`${path}[${index}]`));
    return;
  }
  if(!isRecord(value))return;
  for(const [key,item] of Object.entries(value)){
    if(FORBIDDEN_KEYS.has(key))fail('forbidden_field',`${path}.${key} is server-controlled`);
    assertNoForbiddenKeys(item,`${path}.${key}`);
  }
}

function assertKeys(payload,allowed){
  for(const key of Object.keys(payload))if(!allowed.has(key))fail('unexpected_field',`unexpected field: ${key}`);
}

function text(value,name,{min=1,max=500}={}){
  if(typeof value!=='string')fail('invalid_payload',`${name} must be a string`);
  const normalized=value.trim();
  if(normalized.length<min||normalized.length>max)fail('invalid_payload',`${name} length is invalid`);
  return normalized;
}

function uuid(value,name){
  const normalized=text(value,name,{min:36,max:36}).toLowerCase();
  if(!UUID_RE.test(normalized))fail('invalid_payload',`${name} must be a canonical UUID`);
  return normalized;
}

function integer(value,name,{min=1,max=50,defaultValue=20}={}){
  if(value===undefined)return defaultValue;
  if(!Number.isInteger(value)||value<min||value>max)fail('invalid_payload',`${name} is out of range`);
  return value;
}

function isoTimestamp(value,name){
  const normalized=text(value,name,{min:20,max:40});
  const millis=Date.parse(normalized);
  if(!Number.isFinite(millis)||!/[zZ]|[+-]\d\d:\d\d$/.test(normalized))fail('invalid_payload',`${name} must include a timezone`);
  return new Date(millis).toISOString();
}

function reason(value){return text(value,'reason',{min:8,max:500})}

function passwordRecoveryReason(value){
  const normalized=reason(value);
  const namedSecret=/(?:access[_ -]?token|refresh[_ -]?token|token[_ -]?hash|recovery[_ -]?token)/i;
  const bearer=/\bauthorization\s*:\s*bearer\b|\bbearer\s+[a-z0-9._~-]{16,}/i;
  const jwt=/\b[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i;
  const tokenizedUrl=/https?:\/\/\S*[?&#](?:access_token|refresh_token|token|token_hash|code)=/i;
  if(namedSecret.test(normalized)||bearer.test(normalized)||jwt.test(normalized)||tokenizedUrl.test(normalized)){
    fail('invalid_payload','reason must not include credentials, tokens, or reset URLs');
  }
  return normalized;
}

export function passwordIssues(value){
  const password=typeof value==='string'?value:'',issues=[];
  if(password.length<MIN_PASSWORD_LENGTH)issues.push('minimum_length');
  if(password.length>MAX_PASSWORD_LENGTH)issues.push('maximum_length');
  if(!/[a-z]/.test(password))issues.push('lowercase');
  if(!/[A-Z]/.test(password))issues.push('uppercase');
  if(!/[0-9]/.test(password))issues.push('number');
  if(!/[^A-Za-z0-9]/.test(password))issues.push('symbol');
  return Object.freeze(issues);
}

function strongPassword(value){
  if(typeof value!=='string'||passwordIssues(value).length)fail('weak_password','password does not meet the security policy');
  return value;
}

function requestId(value){return uuid(value,'requestId')}

function products(value){
  if(!Array.isArray(value)||value.length<1||value.length>2)fail('invalid_payload','products must contain APP and/or KNOWLEDGE');
  const normalized=value.map(item=>text(item,'product',{min:3,max:9}).toUpperCase());
  if(normalized.some(item=>!PRODUCTS.has(item))||new Set(normalized).size!==normalized.length)fail('invalid_payload','products must be unique APP/KNOWLEDGE values');
  return normalized.sort();
}

function permissions(value){
  if(!Array.isArray(value)||value.length>STAFF_PERMISSIONS.size)fail('invalid_payload','permissions must be an array');
  const normalized=value.map(item=>text(item,'permission',{min:5,max:64}));
  if(normalized.some(item=>!STAFF_PERMISSIONS.has(item))||new Set(normalized).size!==normalized.length){
    fail('invalid_payload','permissions contain a forbidden or duplicate key');
  }
  return normalized.sort();
}

function pageCursor(value,kind){
  if(value===undefined||value===null)return {createdAt:null,id:null};
  if(!isRecord(value))fail('invalid_payload','cursor must be an object');
  const idKey=kind==='audit'?'id':'userId';
  assertKeys(value,new Set(['createdAt',idKey]));
  if(!value.createdAt||!value[idKey])fail('invalid_payload',`cursor requires createdAt and ${idKey}`);
  return {createdAt:isoTimestamp(value.createdAt,'cursor.createdAt'),id:uuid(value[idKey],`cursor.${idKey}`)};
}

function auditFilters(value){
  if(value===undefined)return {targetUserId:null,action:null};
  if(!isRecord(value))fail('invalid_payload','filters must be an object');
  assertKeys(value,new Set(['targetUserId','action']));
  return {
    targetUserId:value.targetUserId===undefined?null:uuid(value.targetUserId,'filters.targetUserId'),
    action:value.action===undefined?null:text(value.action,'filters.action',{min:3,max:80})
  };
}

export function validateActionPayload(payload){
  if(!isRecord(payload))fail('invalid_payload','payload must be a JSON object');
  assertNoForbiddenKeys(payload);
  const action=text(payload.action,'action',{min:2,max:32});
  if(!ACTIONS.has(action))fail('unsupported_action','unsupported action');

  if(action==='me'){
    assertKeys(payload,new Set(['action']));
    return {action};
  }
  if(action==='users.search'){
    assertKeys(payload,new Set(['action','query','limit','cursor']));
    const cursor=pageCursor(payload.cursor,'users');
    return {action,query:text(payload.query,'query',{min:3,max:120}),limit:integer(payload.limit,'limit'),cursor};
  }
  if(action==='licenses.get'){
    assertKeys(payload,new Set(['action','targetUserId']));
    return {action,targetUserId:uuid(payload.targetUserId,'targetUserId')};
  }
  if(action==='licenses.grant'){
    assertKeys(payload,new Set(['action','targetUserId','products','licenseKind','reason','requestId']));
    const licenseKind=text(payload.licenseKind,'licenseKind',{min:6,max:8});
    if(!LICENSE_KINDS.has(licenseKind))fail('invalid_payload','licenseKind must be monthly, annual, or lifetime');
    return {action,targetUserId:uuid(payload.targetUserId,'targetUserId'),products:products(payload.products),licenseKind,reason:reason(payload.reason),requestId:requestId(payload.requestId)};
  }
  if(action==='licenses.revoke'){
    assertKeys(payload,new Set(['action','targetUserId','grantId','reason','requestId']));
    return {action,targetUserId:uuid(payload.targetUserId,'targetUserId'),grantId:uuid(payload.grantId,'grantId'),reason:reason(payload.reason),requestId:requestId(payload.requestId)};
  }
  if(action==='users.password_recovery'){
    assertKeys(payload,new Set(['action','targetUserId','reason','requestId']));
    return {
      action,
      targetUserId:uuid(payload.targetUserId,'targetUserId'),
      reason:passwordRecoveryReason(payload.reason),
      requestId:requestId(payload.requestId)
    };
  }
  if(action==='users.password.reset_direct'){
    assertKeys(payload,new Set(['action','targetUserId','newPassword','reason','requestId']));
    const newPassword=strongPassword(payload.newPassword),administrativeReason=passwordRecoveryReason(payload.reason);
    if(administrativeReason.toLocaleLowerCase('en-US').includes(newPassword.toLocaleLowerCase('en-US')))fail('invalid_payload','reason must not contain the password');
    return {
      action,
      targetUserId:uuid(payload.targetUserId,'targetUserId'),
      newPassword,
      reason:administrativeReason,
      requestId:requestId(payload.requestId)
    };
  }
  if(action==='staff.list'){
    assertKeys(payload,new Set(['action','limit','cursor']));
    return {action,limit:integer(payload.limit,'limit',{defaultValue:50}),cursor:pageCursor(payload.cursor,'staff')};
  }
  if(action==='staff.add'||action==='staff.permissions.set'){
    assertKeys(payload,new Set(['action','targetUserId','permissions','reason','requestId']));
    return {action,targetUserId:uuid(payload.targetUserId,'targetUserId'),permissions:permissions(payload.permissions),reason:reason(payload.reason),requestId:requestId(payload.requestId)};
  }
  if(action==='staff.status.set'){
    assertKeys(payload,new Set(['action','targetUserId','status','reason','requestId']));
    const status=text(payload.status,'status',{min:6,max:8});
    if(!new Set(['active','disabled']).has(status))fail('invalid_payload','status must be active or disabled');
    return {action,targetUserId:uuid(payload.targetUserId,'targetUserId'),status,reason:reason(payload.reason),requestId:requestId(payload.requestId)};
  }
  if(action==='audit.list'){
    assertKeys(payload,new Set(['action','limit','cursor','filters']));
    return {action,limit:integer(payload.limit,'limit',{defaultValue:50}),cursor:pageCursor(payload.cursor,'audit'),filters:auditFilters(payload.filters)};
  }
  if(action==='management.dashboard'){
    assertKeys(payload,new Set(['action','periodStart','periodEnd','limit']));
    const hasStart=payload.periodStart!==undefined,hasEnd=payload.periodEnd!==undefined;
    if(hasStart!==hasEnd)fail('invalid_payload','periodStart and periodEnd are required together');
    const periodStart=hasStart?isoTimestamp(payload.periodStart,'periodStart'):null;
    const periodEnd=hasEnd?isoTimestamp(payload.periodEnd,'periodEnd'):null;
    if(periodStart&&Date.parse(periodStart)>=Date.parse(periodEnd))fail('invalid_payload','management period is invalid');
    return {action,periodStart,periodEnd,limit:integer(payload.limit,'limit',{min:1,max:100,defaultValue:50})};
  }
  if(action==='management.drilldown'){
    assertKeys(payload,new Set(['action','filter','origin','limit','cursor']));
    const filter=text(payload.filter,'filter',{min:6,max:30});
    const filters=new Set(['accounts','active_clients','monthly','annual','lifetime','trial_active','origin','expiring_30_days']);
    if(!filters.has(filter))fail('invalid_payload','management drilldown filter is invalid');
    const origin=payload.origin===undefined?null:text(payload.origin,'origin',{min:6,max:10});
    if(filter==='origin'&&!new Set(['manual','commercial']).has(origin))fail('invalid_payload','management origin is invalid');
    if(filter!=='origin'&&origin!==null)fail('unexpected_field','origin is only valid for the origin filter');
    return {action,filter,origin,limit:integer(payload.limit,'limit',{min:1,max:50,defaultValue:25}),cursor:pageCursor(payload.cursor,'users')};
  }
  fail('unsupported_action','unsupported action');
}

export function canonicalJson(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function sha256Hex(value){
  const bytes=new TextEncoder().encode(typeof value==='string'?value:canonicalJson(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function idempotencyPayload(validated){
  if(!validated.requestId)return null;
  const {requestId,newPassword,...operation}=validated;
  return operation;
}

export function parseAllowedOrigins(raw,defaults=[]){
  const candidates=[...defaults,...String(raw||'').split(',')].map(item=>String(item).trim()).filter(Boolean);
  const origins=new Set();
  for(const candidate of candidates){
    if(candidate==='*')throw new Error('wildcard CORS origin is forbidden');
    const url=new URL(candidate);
    if(url.origin!==candidate||!['http:','https:'].includes(url.protocol))throw new Error(`invalid CORS origin: ${candidate}`);
    origins.add(candidate);
  }
  return origins;
}

export function parsePasswordRecoveryRedirectUrl(raw,allowedOrigins){
  if(!(allowedOrigins instanceof Set))throw new Error('allowed origins are required');
  const value=String(raw||'').trim();
  if(!value||value.length>2048)throw new Error('password recovery redirect URL is required');
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash){
    throw new Error('password recovery redirect URL is invalid');
  }
  if(!allowedOrigins.has(url.origin))throw new Error('password recovery redirect origin is not allowed');
  for(const key of ['access_token','refresh_token','token','token_hash','code']){
    if(url.searchParams.has(key))throw new Error('password recovery redirect URL contains a token field');
  }
  return url.href;
}

export function corsHeaders(origin,allowedOrigins){
  if(!origin||!allowedOrigins.has(origin))return {'vary':'Origin'};
  return {
    'access-control-allow-origin':origin,
    'access-control-allow-methods':'POST, OPTIONS',
    'access-control-allow-headers':'authorization, apikey, x-client-info, content-type, x-retry-count, traceparent, tracestate, baggage',
    'access-control-max-age':'600',
    'vary':'Origin'
  };
}

export function assertOriginAllowed(origin,allowedOrigins){
  if(origin&&!allowedOrigins.has(origin))throw new AdminApiError(403,'origin_not_allowed','origin is not allowed');
}

export function bearerToken(authorization){
  const match=/^Bearer\s+([^\s]+)$/i.exec(String(authorization||''));
  if(!match)throw new AdminApiError(401,'authentication_required','authentication required');
  return match[1];
}

export async function readJsonBody(request){
  const length=Number(request.headers.get('content-length')||0);
  if(Number.isFinite(length)&&length>MAX_BODY_BYTES)throw new AdminApiError(422,'payload_too_large','payload is too large');
  const body=await request.text();
  if(new TextEncoder().encode(body).length>MAX_BODY_BYTES)throw new AdminApiError(422,'payload_too_large','payload is too large');
  try{return JSON.parse(body)}catch{throw new AdminApiError(422,'invalid_json','request body must be valid JSON')}
}

export function mapRpcError(error){
  const databaseCode=String(error?.code||'');
  const message=String(error?.message||'').toLowerCase();
  if(databaseCode==='42501'||/(forbidden|not authorized|permission denied|does not belong|self[_ -]?license|owner[_ -]?protected|staff[_ -]?target)/.test(message)){
    return new AdminApiError(403,'forbidden','operation is not permitted');
  }
  if(databaseCode==='23505'||/(idempoten|request[_ -]?id|payload[_ -]?hash|conflict)/.test(message)){
    return new AdminApiError(409,'operation_conflict','operation request conflicts with an existing request');
  }
  if(['22023','22007','22P02','23514'].includes(databaseCode)||/(invalid|unsupported|required|must be)/.test(message)){
    return new AdminApiError(422,'invalid_operation','operation was rejected');
  }
  return new AdminApiError(500,'internal_error','administrative operation failed');
}

export function errorFromStableCode(code,idempotent=false){
  const status=({
    forbidden:403,
    operation_conflict:409,
    invalid_operation:422,
    rate_limited:429,
    password_recovery_unavailable:502,
    password_reset_unavailable:502,
    internal_error:500
  })[code]||500;
  const error=new AdminApiError(status,status===500?'internal_error':code);
  error.idempotent=idempotent===true;
  return error;
}

export const ADMIN_ACTIONS=Object.freeze([...ACTIONS]);
export const ASSIGNABLE_STAFF_PERMISSIONS=Object.freeze([...STAFF_PERMISSIONS]);
