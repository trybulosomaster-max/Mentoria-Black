(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AVIORA_SIGNUP_PASSWORD_POLICY=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const MIN_PASSWORD_LENGTH=6;
  const PASSWORD_MESSAGE='Use pelo menos 6 caracteres.';
  const EMAIL_PATTERN=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function passwordIsValid(password){
    return String(password||'').length>=MIN_PASSWORD_LENGTH;
  }

  function validateSignup({name='',email='',password='',confirmation='',termsAccepted=false}={}){
    const value=String(password||'');
    if(!String(name||'').trim())return Object.freeze({ok:false,code:'name_required',message:'Informe seu nome para criar a conta.'});
    if(!EMAIL_PATTERN.test(String(email||'').trim()))return Object.freeze({ok:false,code:'email_required',message:'Informe um e-mail válido para criar a conta.'});
    if(!passwordIsValid(value))return Object.freeze({ok:false,code:'password_requirements',message:PASSWORD_MESSAGE});
    if(value!==String(confirmation||''))return Object.freeze({ok:false,code:'password_confirmation',message:'As senhas não coincidem.'});
    if(termsAccepted!==true)return Object.freeze({ok:false,code:'terms_required',message:'Confirme que você concorda com os Termos de Uso e a Política de Privacidade.'});
    return Object.freeze({ok:true,code:null,message:''});
  }

  async function submitSignup({name,email,password,confirmation,termsAccepted,signUp}={}){
    const validation=validateSignup({name,email,password,confirmation,termsAccepted});
    if(!validation.ok)return Object.freeze({ok:false,called:false,validation});
    if(typeof signUp!=='function')throw new TypeError('signUp is required');
    const result=await signUp({email:String(email).trim(),password:String(password),options:{data:{full_name:String(name).trim()}}});
    return Object.freeze({ok:!result?.error,called:true,validation,error:result?.error||null,data:result?.data||null});
  }

  return Object.freeze({MIN_PASSWORD_LENGTH,PASSWORD_MESSAGE,passwordIsValid,validateSignup,submitSignup});
});
