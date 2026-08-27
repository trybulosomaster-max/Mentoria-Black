import {createClient} from '@supabase/supabase-js';
import {parseAllowedOrigins,parsePasswordRecoveryRedirectUrl} from './contract.mjs';
import {createAdminAccessHandler} from './handler.mjs';

const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';

function namedKey(jsonName:string,singularName:string,legacyName:string){
  const singular=Deno.env.get(singularName);
  if(singular)return singular;
  const encoded=Deno.env.get(jsonName);
  if(encoded){
    try{return String(JSON.parse(encoded)?.default||'')}
    catch{return ''}
  }
  return Deno.env.get(legacyName)||'';
}

const publishableKey=namedKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY');
const serverKey=namedKey('SUPABASE_SECRET_KEYS','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY');
// Every deployed environment must provide its exact browser origins. Keeping
// this fail-closed avoids accidentally allowing the production Pages origin
// in Beta (or a development origin in production).
const configuredOrigins=Deno.env.get('ADMIN_ALLOWED_ORIGINS')||'';
const configuredPasswordRecoveryRedirect=Deno.env.get('ADMIN_PASSWORD_RECOVERY_REDIRECT_URL')||'';

let handler:(request:Request)=>Promise<Response>;
try{
  if(!supabaseUrl||!publishableKey||!serverKey||!configuredOrigins||!configuredPasswordRecoveryRedirect){
    throw new Error('Supabase Edge configuration is missing');
  }
  const allowedOrigins=parseAllowedOrigins(configuredOrigins);
  const passwordRecoveryRedirectUrl=parsePasswordRecoveryRedirectUrl(
    configuredPasswordRecoveryRedirect,allowedOrigins
  );
  const adminClient=createClient(supabaseUrl,serverKey,{
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}
  });
  // Password recovery is an official public Auth flow. It does not need the
  // service-role credential after the protected database lookup resolves the
  // target, so a dedicated publishable-key client keeps privilege minimized.
  const recoveryClient=createClient(supabaseUrl,publishableKey,{
    auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}
  });
  const authenticate=async(token:string)=>{
    // This client carries only the publishable key and the caller's own JWT.
    const userClient=createClient(supabaseUrl,publishableKey,{
      global:{headers:{Authorization:`Bearer ${token}`}},
      auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}
    });
    const {data,error}=await userClient.auth.getUser(token);
    if(error||!data?.user){
      const authError:any=new Error('invalid session');
      authError.code='invalid_session';
      throw authError;
    }
    return {user:data.user,userClient};
  };
  const sendPasswordRecovery=async(email:string)=>{
    const {error}=await recoveryClient.auth.resetPasswordForEmail(email,{
      redirectTo:passwordRecoveryRedirectUrl
    });
    if(error)throw new Error('password recovery delivery failed');
  };
  const updateUserPassword=async(targetUserId:string,password:string)=>{
    const {error}=await adminClient.auth.admin.updateUserById(targetUserId,{password});
    if(error)throw new Error('direct password reset failed');
  };
  handler=createAdminAccessHandler({
    authenticate,adminClient,allowedOrigins,sendPasswordRecovery,updateUserPassword
  });
}catch{
  handler=async()=>Response.json({ok:false,error:{code:'admin_service_not_configured'}},{status:503,headers:{'cache-control':'no-store'}});
}

Deno.serve(handler);
