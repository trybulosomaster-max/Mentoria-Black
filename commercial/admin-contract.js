'use strict';

const ADMIN_PRODUCTS=Object.freeze(['APP','KNOWLEDGE']);
const ADMIN_ACCESS_TYPES=Object.freeze(['manual','lifetime']);
function validateGrantRequest(input){
  if(!input||typeof input!=='object')throw new TypeError('grant input is required');
  const targetUserId=String(input.targetUserId||'').trim();
  const products=[...new Set((input.products||[]).map(value=>String(value).trim().toUpperCase()))];
  const accessType=String(input.accessType||'').trim().toLowerCase();
  const reason=String(input.reason||'').trim();
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(targetUserId))throw new TypeError('valid target user id is required');
  if(!products.length||products.some(code=>!ADMIN_PRODUCTS.includes(code)))throw new TypeError('APP and/or KNOWLEDGE are required');
  if(!ADMIN_ACCESS_TYPES.includes(accessType))throw new TypeError('manual or lifetime is required');
  if(reason.length<3)throw new TypeError('administrative reason is required');
  if(accessType==='lifetime'&&input.expiresAt)throw new TypeError('lifetime access cannot expire');
  return Object.freeze({targetUserId,products,accessType,expiresAt:input.expiresAt||null,reason});
}
function createAdminPanelController(serverAdapter){
  for(const method of ['findUser','listGrants','grantAccess','revokeAccess'])if(typeof serverAdapter?.[method]!=='function')throw new TypeError(`server adapter missing ${method}`);
  return Object.freeze({
    findUser:identifier=>serverAdapter.findUser(String(identifier||'').trim()),
    listGrants:userId=>serverAdapter.listGrants(String(userId)),
    grantAccess:input=>serverAdapter.grantAccess(validateGrantRequest(input)),
    revokeAccess:(grantId,reason)=>serverAdapter.revokeAccess({grantId:String(grantId),reason:String(reason||'').trim()})
  });
}
const api={ADMIN_PRODUCTS,ADMIN_ACCESS_TYPES,validateGrantRequest,createAdminPanelController};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof globalThis!=='undefined')globalThis.MBCommercialAdmin=Object.freeze(api);
