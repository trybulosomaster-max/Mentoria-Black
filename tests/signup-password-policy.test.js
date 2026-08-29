const {test}=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../js/signup-password-policy.js');

test('signup accepts the existing six-character minimum without a composition rule',()=>{
  assert.equal(policy.passwordIsValid('12345'),false);
  assert.equal(policy.passwordIsValid('123456'),true);
  assert.equal(policy.passwordIsValid('abcdef'),true);
});

test('confirmation and terms remain explicit signup gates',()=>{
  const base={name:'Novo Cliente',email:'new@example.test',password:'123456',confirmation:'123456',termsAccepted:true};
  assert.equal(policy.validateSignup({...base,name:''}).code,'name_required');
  assert.equal(policy.validateSignup({...base,email:'not-an-email'}).code,'email_required');
  assert.equal(policy.validateSignup({...base,password:'12345',confirmation:'12345'}).code,'password_requirements');
  assert.equal(policy.validateSignup({...base,confirmation:'654321'}).code,'password_confirmation');
  assert.equal(policy.validateSignup({...base,termsAccepted:false}).code,'terms_required');
  assert.equal(policy.validateSignup(base).ok,true);
});

test('invalid passwords never call signUp and a valid accepted request calls it once',async()=>{
  const calls=[];
  const signUp=async payload=>{calls.push(payload);return {data:{session:null},error:null}};
  const rejected=await policy.submitSignup({name:'Novo Cliente',email:'new@example.test',password:'short',confirmation:'short',termsAccepted:true,signUp});
  assert.equal(rejected.ok,false);assert.equal(calls.length,0);
  const accepted=await policy.submitSignup({name:'Novo Cliente',email:'new@example.test',password:'123456',confirmation:'123456',termsAccepted:true,signUp});
  assert.equal(accepted.ok,true);assert.equal(accepted.called,true);assert.equal(calls.length,1);
  assert.deepEqual(calls[0].options,{data:{full_name:'Novo Cliente'}});
});

test('policy module never logs or returns a submitted password',async()=>{
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'..','js','signup-password-policy.js'),'utf8');
  const entrypoint=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.doesNotMatch(source,/console\.(?:log|warn|error)/);
  assert.doesNotMatch(entrypoint,/console\.(?:log|warn|error)[\s\S]{0,120}password/i);
  assert.match(source,/Use pelo menos 6 caracteres\./);
  const result=await policy.submitSignup({name:'Novo Cliente',email:'new@example.test',password:'123456',confirmation:'123456',termsAccepted:true,signUp:async()=>({data:{},error:null})});
  assert.equal(JSON.stringify(result).includes('123456'),false);
});

test('the signup entrypoint uses the policy, keeps errors in the live status card, and preserves login',()=>{
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
  assert.match(source,/signupPolicy\.submitSignup/);
  assert.match(source,/id="signupName" type="text" autocomplete="name"/);
  assert.match(source,/setAuthMessage\(submitted\.validation\?\.message/);
  assert.match(source,/if\(signupPending\)return/);
  assert.match(source,/id="authMsg" class="msg meridian-auth-message" role="status" aria-live="polite"/);
  assert.match(source,/sb\.auth\.signInWithPassword\(\{email,password:\$\("loginPassword"\)\.value\}\)/);
  assert.match(source,/Use pelo menos 6 caracteres\./);
  assert.doesNotMatch(source,/Pelo menos um caractere especial|Mínimo de 8 caracteres/);
});
