(function(root,factory){
  const adminContract=root?.AVAdminAccessContract||(typeof require==='function'?require('../commercial/admin-access-contract'):null);
  const api=factory(adminContract);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AVAccountSecurity=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(adminContract){
  'use strict';
  if(!adminContract)throw new Error('AVIORA password policy is unavailable');

  const MIN_PASSWORD_LENGTH=adminContract.MIN_PASSWORD_LENGTH;
  const MAX_PASSWORD_LENGTH=adminContract.MAX_PASSWORD_LENGTH;
  const GENERIC_RECOVERY_MESSAGE='Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.';

  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  const passwordIssues=adminContract.passwordIssues;
  function safeRecoveryRedirect(configured,locationObject){
    const fallback=locationObject?`${locationObject.origin}${locationObject.pathname}`:'';
    const value=String(configured||fallback||'').trim();
    try{
      const url=new URL(value);
      const local=['localhost','127.0.0.1','::1'].includes(url.hostname)||/^192\.168\.|^10\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname);
      if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new TypeError('recovery redirect must use HTTPS outside local development');
      url.hash='';
      return url.toString();
    }catch(_error){throw new TypeError('secure password recovery redirect is unavailable')}
  }
  function isRecoveryLocation(locationObject){
    if(!locationObject)return false;
    for(const raw of [locationObject.search,locationObject.hash]){
      const value=String(raw||'').replace(/^[?#]/,'');
      if(!value)continue;
      const params=new URLSearchParams(value);
      if(String(params.get('type')||'').toLowerCase()==='recovery')return true;
    }
    return false;
  }
  function passwordErrorMessage(error){
    const code=String(error?.code||'').toLowerCase();
    if(code.includes('weak_password'))return 'A nova senha não atende aos requisitos de segurança.';
    if(code.includes('same_password'))return 'A nova senha deve ser diferente da senha atual.';
    if(code.includes('recovery_signout_failed'))return 'Senha alterada, mas não foi possível encerrar esta sessão. Saia manualmente antes de continuar.';
    if(code.includes('reauthentication')||code.includes('reauth'))return 'Confirme novamente sua identidade e tente outra vez.';
    if(Number(error?.status)===401||code.includes('invalid_credentials'))return 'A senha atual não foi confirmada.';
    return 'Não foi possível alterar a senha. Verifique os dados e tente novamente.';
  }
  function renderPasswordForm(recoveryMode=false){
    return `<form class="account-security-form" data-account-security-form="password" novalidate>
      ${recoveryMode?'':`<div class="field"><label for="accountCurrentPassword">Senha atual</label><input id="accountCurrentPassword" name="currentPassword" type="password" autocomplete="current-password" required></div>`}
      <div class="field"><label for="accountNewPassword">Nova senha</label><input id="accountNewPassword" name="newPassword" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="${MAX_PASSWORD_LENGTH}" required aria-describedby="accountPasswordHelp"></div>
      <div class="field"><label for="accountConfirmPassword">Confirmar nova senha</label><input id="accountConfirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="${MAX_PASSWORD_LENGTH}" required></div>
      <p id="accountPasswordHelp" class="small muted">Use ${MIN_PASSWORD_LENGTH}+ caracteres, com maiúscula, minúscula, número e símbolo.</p>
      <div class="account-security-message" data-account-security-message aria-live="polite"></div>
      <button class="btn primary" type="submit">${recoveryMode?'Definir nova senha':'Alterar minha senha'}</button>
    </form>`;
  }
  function renderAccountSecurity(user){
    return `<div class="account-security-area">
      <div class="pagehead"><div><h1>Minha conta</h1><p>Segurança e sessões da sua conta AVIORA.</p></div></div>
      <div class="account-security-grid">
        <section class="card account-security-card" data-account-security-section="password" aria-labelledby="account-password-trigger"><button class="account-security-trigger" id="account-password-trigger" type="button" aria-expanded="false" aria-controls="account-password-panel"><span><strong>Alterar minha senha</strong><small data-account-security-summary>Proteja sua conta com uma senha forte</small></span><span class="account-security-chevron" aria-hidden="true"></span></button><div class="account-security-panel" id="account-password-panel" role="region" aria-labelledby="account-password-trigger" hidden><p class="desc">Confirme sua senha atual antes de definir uma nova.</p>${renderPasswordForm(false)}</div></section>
        <section class="card account-security-card" data-account-security-section="recovery" aria-labelledby="account-recovery-trigger"><button class="account-security-trigger" id="account-recovery-trigger" type="button" aria-expanded="false" aria-controls="account-recovery-panel"><span><strong>Recuperação da conta</strong><small data-account-security-summary>Use o e-mail cadastrado para recuperar o acesso</small></span><span class="account-security-chevron" aria-hidden="true"></span></button><div class="account-security-panel" id="account-recovery-panel" role="region" aria-labelledby="account-recovery-trigger" hidden><p class="desc">Enviaremos um link de recuperação para <strong>${escapeHtml(user?.email||'seu e-mail')}</strong>.</p><button class="btn" type="button" data-account-security-action="recovery">Enviar link de recuperação</button><div class="account-security-message" data-account-recovery-message aria-live="polite"></div></div></section>
        <section class="card account-security-card" data-account-security-section="sessions" aria-labelledby="account-sessions-trigger"><button class="account-security-trigger" id="account-sessions-trigger" type="button" aria-expanded="false" aria-controls="account-sessions-panel"><span><strong>Sessões</strong><small data-account-security-summary>Esta sessão permanece ativa</small></span><span class="account-security-chevron" aria-hidden="true"></span></button><div class="account-security-panel" id="account-sessions-panel" role="region" aria-labelledby="account-sessions-trigger" hidden><p class="desc">Encerre as outras sessões sem sair deste dispositivo.</p><div class="notice">As outras sessões serão encerradas. A sessão atual permanecerá ativa. Tokens de acesso já emitidos podem continuar válidos até a expiração.</div><button class="btn danger" type="button" data-account-security-action="signout-others">Encerrar outras sessões</button><div class="account-security-message" data-account-sessions-message aria-live="polite"></div></div></section>
      </div>
    </div>`;
  }
  function renderRecoveryScreen(){
    return `<main class="account-recovery-shell"><section class="account-recovery-card"><div class="brand-copy"><div class="title">AVIORA</div><div class="sub">Gestão Financeira</div></div><h1>Defina sua nova senha</h1><p>Esta tela foi aberta por um link oficial de recuperação do Supabase Auth.</p>${renderPasswordForm(true)}</section></main>`;
  }

  function setAccountSecurityExpanded(trigger,panel,expanded){
    if(!trigger||!panel)return;
    trigger.setAttribute('aria-expanded',String(expanded));
    panel.hidden=!expanded;
    trigger.closest?.('.account-security-card')?.classList?.toggle?.('is-open',expanded);
  }
  function bindAccountSecuritySections(root){
    root?.querySelectorAll?.('.account-security-trigger').forEach(trigger=>{
      const panel=root.querySelector(`#${trigger.getAttribute('aria-controls')}`);
      if(!panel||trigger.dataset.accountSecurityReady==='true')return;
      trigger.dataset.accountSecurityReady='true';
      setAccountSecurityExpanded(trigger,panel,false);
      trigger.addEventListener('click',()=>setAccountSecurityExpanded(trigger,panel,trigger.getAttribute('aria-expanded')!=='true'));
    });
  }

  function createAccountSecurity(options={}){
    const client=options.supabaseClient;
    if(!client?.auth?.updateUser||!client?.auth?.resetPasswordForEmail||!client?.auth?.signOut)throw new TypeError('Supabase Auth client is required');
    const notify=typeof options.notify==='function'?options.notify:()=>{};
    const locationObject=options.locationObject||(typeof location!=='undefined'?location:null);
    const recoveryRedirect=()=>safeRecoveryRedirect(typeof options.authRedirectUrl==='function'?options.authRedirectUrl():options.authRedirectUrl,locationObject);
    let recoveryMode=isRecoveryLocation(locationObject),subscription=null;

    function updateSectionSummary(element,text,tone=''){
      const card=element?.closest?.('[data-account-security-section]');
      const summary=card?.querySelector?.('[data-account-security-summary]');
      if(!summary)return;
      summary.textContent=text;
      summary.classList.remove('ok','err');
      if(tone)summary.classList.add(tone);
    }

    async function changePassword(form,{recovery=false}={}){
      const current=form.elements.currentPassword?.value||'',next=form.elements.newPassword?.value||'',confirmation=form.elements.confirmPassword?.value||'';
      const message=form.querySelector('[data-account-security-message]'),button=form.querySelector('button[type="submit"]');
      const show=(text,error=false)=>{if(message){message.textContent=text;message.className=`account-security-message ${error?'err':'ok'}`};updateSectionSummary(form,text,error?'err':'ok')};
      if(!recovery&&!current){show('Informe sua senha atual.',true);return false}
      if(next!==confirmation){show('A confirmação da nova senha não confere.',true);return false}
      const issues=passwordIssues(next);
      if(issues.length){show(`A nova senha precisa conter ${issues.join(', ')}.`,true);return false}
      if(!recovery&&next===current){show('A nova senha deve ser diferente da senha atual.',true);return false}
      if(button){button.disabled=true;button.setAttribute('aria-busy','true')}
      try{
        const payload=recovery?{password:next}:{password:next,current_password:current};
        const {error}=await client.auth.updateUser(payload);
        if(error)throw error;
        form.reset();
        if(recovery){
          const {error:signOutError}=await client.auth.signOut({scope:'local'});
          if(signOutError){
            const safeError=new Error('recovery session sign-out failed');
            safeError.code='recovery_signout_failed';
            throw safeError;
          }
          recoveryMode=false;
          if(typeof options.onRecoveryComplete==='function')options.onRecoveryComplete();
        }
        show('Senha alterada com sucesso.');
        return true;
      }catch(error){show(passwordErrorMessage(error),true);return false}
      finally{if(button){button.disabled=false;button.removeAttribute('aria-busy')}}
    }
    async function requestRecovery(email){
      const normalized=String(email||'').trim();
      if(!normalized)throw new TypeError('email is required');
      try{await client.auth.resetPasswordForEmail(normalized,{redirectTo:recoveryRedirect()})}catch(_error){}
      return Object.freeze({ok:true,message:GENERIC_RECOVERY_MESSAGE});
    }
    async function signOutOthers(){
      const {error}=await client.auth.signOut({scope:'others'});
      if(error)throw error;
      return Object.freeze({ok:true});
    }
    function bindPasswordForm(root,recovery=false){
      const form=root.querySelector('[data-account-security-form="password"]');
      if(form)form.onsubmit=async event=>{event.preventDefault();await changePassword(form,{recovery})};
    }
    function mount(root,user){
      if(!root)throw new TypeError('account security root is required');
      root.innerHTML=renderAccountSecurity(user);
      bindAccountSecuritySections(root);
      bindPasswordForm(root,false);
      const recoveryButton=root.querySelector('[data-account-security-action="recovery"]');
      if(recoveryButton)recoveryButton.onclick=async()=>{
        const message=root.querySelector('[data-account-recovery-message]');
        recoveryButton.disabled=true;
        try{const result=await requestRecovery(user?.email);if(message){message.textContent=result.message;message.className='account-security-message ok'};updateSectionSummary(recoveryButton,'Instruções de recuperação solicitadas','ok')}catch(_error){if(message){message.textContent=GENERIC_RECOVERY_MESSAGE;message.className='account-security-message ok'};updateSectionSummary(recoveryButton,'Instruções de recuperação solicitadas','ok')}
        finally{recoveryButton.disabled=false}
      };
      const sessionsButton=root.querySelector('[data-account-security-action="signout-others"]');
      if(sessionsButton)sessionsButton.onclick=async()=>{
        const message=root.querySelector('[data-account-sessions-message]');
        sessionsButton.disabled=true;
        try{await signOutOthers();if(message){message.textContent='As outras sessões foram encerradas. Esta sessão continua ativa.';message.className='account-security-message ok'};updateSectionSummary(sessionsButton,'Outras sessões encerradas; esta permanece ativa','ok')}catch(_error){if(message){message.textContent='Não foi possível encerrar as outras sessões.';message.className='account-security-message err'};updateSectionSummary(sessionsButton,'Não foi possível encerrar as outras sessões','err')}
        finally{sessionsButton.disabled=false}
      };
    }
    function mountRecovery(root){
      if(!root)throw new TypeError('recovery root is required');
      recoveryMode=true;
      root.innerHTML=renderRecoveryScreen();
      root.classList.remove('hidden');
      bindPasswordForm(root,true);
    }
    function watch(onRecovery){
      if(subscription)return subscription;
      const result=client.auth.onAuthStateChange((event)=>{
        if(event==='PASSWORD_RECOVERY'){
          recoveryMode=true;
          queueMicrotask(()=>onRecovery?.());
        }
      });
      subscription=result?.data?.subscription||result?.subscription||null;
      return subscription;
    }
    function destroy(){subscription?.unsubscribe?.();subscription=null}
    return Object.freeze({mount,mountRecovery,watch,destroy,changePassword,requestRecovery,signOutOthers,isRecoveryMode:()=>recoveryMode});
  }

  return Object.freeze({MIN_PASSWORD_LENGTH,MAX_PASSWORD_LENGTH,GENERIC_RECOVERY_MESSAGE,passwordIssues,safeRecoveryRedirect,isRecoveryLocation,passwordErrorMessage,renderPasswordForm,renderAccountSecurity,renderRecoveryScreen,setAccountSecurityExpanded,bindAccountSecuritySections,createAccountSecurity});
});
