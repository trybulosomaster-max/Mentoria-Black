const assert=require('assert');
const fs=require('fs');
const path=require('path');
const security=require('../js/account-security');
let tests=0,assertions=0;
function check(value,message){assertions++;assert.ok(value,message)}
function equal(a,b,message){assertions++;assert.strictEqual(a,b,message)}
async function test(name,fn){await fn();tests++;process.stdout.write(`✓ ${name}\n`)}

(async()=>{
await test('password policy rejects weak values and accepts a strong value',()=>{
  check(security.passwordIssues('short').length>=4);
  equal(security.passwordIssues('Strong-Beta-2026!').length,0);
  check(security.passwordIssues(`A1!${'a'.repeat(126)}`).some(issue=>issue.includes('máximo')));
  equal(security.MAX_PASSWORD_LENGTH,128);
});
await test('recovery redirects are restricted to HTTPS or local development',()=>{
  equal(security.safeRecoveryRedirect('',{origin:'http://192.168.15.34:8097',pathname:'/index.html'}),'http://192.168.15.34:8097/index.html');
  assert.throws(()=>security.safeRecoveryRedirect('http://public.example/reset'),TypeError);assertions++;
  equal(security.safeRecoveryRedirect('https://app.example/reset#token'),'https://app.example/reset');
});
await test('recovery links are detected synchronously before commercial bootstrap',()=>{
  check(security.isRecoveryLocation({search:'',hash:'#access_token=redacted&type=recovery'}));
  check(security.isRecoveryLocation({search:'?type=recovery',hash:''}));
  check(!security.isRecoveryLocation({search:'',hash:'#type=signup'}));
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const start=html.indexOf('window.start=async function()');
  const commercial=html.indexOf('const commercial=await resolveCommercialSession()',start);
  const guard=html.indexOf('if(AVIORA_ACCOUNT_SECURITY.isRecoveryMode())',start);
  check(start>=0&&guard>start&&guard<commercial,'recovery guard must precede commercial session resolution');
  check(html.includes('if(AVIORA_ACCOUNT_SECURITY.isRecoveryMode())showAccountRecovery();'));
});
await test('normal password update sends current_password only to official Auth',async()=>{
  const calls=[];
  const client={auth:{updateUser:async payload=>(calls.push(payload),{data:{},error:null}),resetPasswordForEmail:async()=>({error:null}),signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
  const app=security.createAccountSecurity({supabaseClient:client,locationObject:{origin:'https://app.example',pathname:'/'}});
  const message={textContent:'',className:''},button={disabled:false,setAttribute(){},removeAttribute(){}},form={elements:{currentPassword:{value:'Current-Beta-2026!'},newPassword:{value:'New-Strong-Beta-2026!'},confirmPassword:{value:'New-Strong-Beta-2026!'}},querySelector:selector=>selector.includes('message')?message:button,reset(){this.resetCalled=true}};
  equal(await app.changePassword(form),true);equal(calls.length,1);
  equal(calls[0].current_password,'Current-Beta-2026!');equal(calls[0].password,'New-Strong-Beta-2026!');
  check(!Object.keys(calls[0]).some(key=>/log|audit|store/i.test(key)));check(form.resetCalled);
});
await test('wrong current password is presented without logging or persistence',async()=>{
  const client={auth:{updateUser:async()=>({error:{status:401,code:'invalid_credentials'}}),resetPasswordForEmail:async()=>({error:null}),signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
  const app=security.createAccountSecurity({supabaseClient:client,locationObject:{origin:'https://app.example',pathname:'/'}}),message={textContent:'',className:''},button={setAttribute(){},removeAttribute(){}};
  const form={elements:{currentPassword:{value:'Wrong-Beta-2026!'},newPassword:{value:'New-Strong-Beta-2026!'},confirmPassword:{value:'New-Strong-Beta-2026!'}},querySelector:s=>s.includes('message')?message:button,reset(){}};
  equal(await app.changePassword(form),false);equal(message.textContent,'A senha atual não foi confirmada.');
  check(!JSON.stringify(message).includes('Wrong-Beta-2026!'));
});
await test('recovery mode updates password without current_password and signs out locally',async()=>{
  const calls=[];
  const client={auth:{updateUser:async payload=>(calls.push(['update',payload]),{error:null}),resetPasswordForEmail:async()=>({error:null}),signOut:async payload=>(calls.push(['signout',payload]),{error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
  const app=security.createAccountSecurity({supabaseClient:client,locationObject:{origin:'https://app.example',pathname:'/'}}),message={},button={setAttribute(){},removeAttribute(){}},form={elements:{newPassword:{value:'Recovered-Beta-2026!'},confirmPassword:{value:'Recovered-Beta-2026!'}},querySelector:s=>s.includes('message')?message:button,reset(){}};
  equal(await app.changePassword(form,{recovery:true}),true);equal(calls[0][1].current_password,undefined);equal(calls[1][1].scope,'local');
});
await test('recovery session remains guarded when local sign-out fails',async()=>{
  let completed=false;
  const client={auth:{updateUser:async()=>({error:null}),resetPasswordForEmail:async()=>({error:null}),signOut:async()=>({error:{code:'session_not_found'}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
  const app=security.createAccountSecurity({supabaseClient:client,locationObject:{origin:'https://app.example',pathname:'/',hash:'#type=recovery'},onRecoveryComplete:()=>{completed=true}}),message={},button={setAttribute(){},removeAttribute(){}},form={elements:{newPassword:{value:'Recovered-Beta-2026!'},confirmPassword:{value:'Recovered-Beta-2026!'}},querySelector:s=>s.includes('message')?message:button,reset(){}};
  equal(await app.changePassword(form,{recovery:true}),false);
  equal(app.isRecoveryMode(),true);equal(completed,false);
  check(message.textContent.includes('Senha alterada'));
});
await test('public recovery returns the same anti-enumeration message on success and error',async()=>{
  for(const error of [null,new Error('unknown user')]){
    const client={auth:{updateUser:async()=>({error:null}),resetPasswordForEmail:async()=>{if(error)throw error;return {error:null}},signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
    const app=security.createAccountSecurity({supabaseClient:client,locationObject:{origin:'https://app.example',pathname:'/'}}),result=await app.requestRecovery('nobody@example.invalid');
    equal(result.message,security.GENERIC_RECOVERY_MESSAGE);
  }
});
await test('signOut others preserves current-session scope contract',async()=>{
  const calls=[];const client={auth:{updateUser:async()=>({error:null}),resetPasswordForEmail:async()=>({error:null}),signOut:async payload=>(calls.push(payload),{error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
  await security.createAccountSecurity({supabaseClient:client,locationObject:{origin:'https://app.example',pathname:'/'}}).signOutOthers();equal(calls[0].scope,'others');
});
await test('rendered account security is available without administrative role',()=>{
  const html=security.renderAccountSecurity({email:'customer@example.invalid'});
  check(html.includes('Minha conta'));check(html.includes('Alterar minha senha'));check(html.includes('Encerrar outras sessões'));check(!html.includes('service_role'));
  check(html.includes('maxlength="128"'));
  check(security.renderRecoveryScreen().includes('Defina sua nova senha'));
});
await test('Minha conta renders three safe collapsed sections without invented state',()=>{
  const html=security.renderAccountSecurity({email:'customer@example.invalid'});
  equal((html.match(/class="account-security-trigger"/g)||[]).length,3);
  equal((html.match(/class="account-security-panel"/g)||[]).length,3);
  equal((html.match(/aria-expanded="false"/g)||[]).length,3);
  equal((html.match(/role="region"/g)||[]).length,3);
  equal((html.match(/ hidden>/g)||[]).length,3);
  for(const summary of ['Proteja sua conta com uma senha forte','Use o e-mail cadastrado para recuperar o acesso','Esta sessão permanece ativa'])check(html.includes(summary),`missing safe summary: ${summary}`);
  check(!/\b\d+ sess(?:ão|ões) ativa|recuperação configurada/i.test(html));
  for(const action of ['data-account-security-form="password"','data-account-security-action="recovery"','data-account-security-action="signout-others"'])check(html.includes(action),`missing ${action}`);
});
await test('account section state is semantic and toggles without changing Auth actions',()=>{
  const attributes=new Map(),classes=[];
  const trigger={setAttribute:(key,value)=>attributes.set(key,value),closest:()=>({classList:{toggle:(name,value)=>classes.push([name,value])}})};
  const panel={hidden:false};
  security.setAccountSecurityExpanded(trigger,panel,false);
  equal(attributes.get('aria-expanded'),'false');equal(panel.hidden,true);
  security.setAccountSecurityExpanded(trigger,panel,true);
  equal(attributes.get('aria-expanded'),'true');equal(panel.hidden,false);
  assert.deepStrictEqual(classes,[['is-open',false],['is-open',true]]);assertions++;
});
console.log(`account security: ${tests} tests, ${assertions} assertions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
