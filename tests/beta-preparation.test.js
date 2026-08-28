'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const vm=require('vm');
const runtime=require('../js/beta-runtime');
const observability=require('../js/beta-observability');
const artifact=require('../scripts/prepare-beta-artifact');
const migrations=require('../scripts/prepare-beta-migrations');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const throws=(fn,pattern)=>{assertions++;assert.throws(fn,pattern)};
async function test(name,fn){await fn();tests++}

(async()=>{
await test('Beta vazia permanece bloqueada e identificada',()=>{
  const state=runtime.resolve({environment:'beta'});
  equal(state.label,'AVIORA — Gestão Financeira V82 BETA');equal(state.isBeta,true);equal(state.configured,false);equal(state.blockedReason,'beta_configuration_missing');
});

await test('somente URL segura e chave publicável configuram Beta',()=>{
  const state=runtime.resolve({environment:'beta',configured:true,supabaseUrl:'https://isolated-beta.example.invalid',supabasePublishableKey:'sb_publishable_beta_test',authRedirectUrl:'https://beta.example.invalid'});
  equal(state.configured,true);equal(state.supabaseUrl,'https://isolated-beta.example.invalid');
  equal(runtime.resolve({environment:'beta',configured:true,supabaseUrl:'http://remote.example.invalid',supabasePublishableKey:'sb_publishable_x'}).configured,false);
  equal(runtime.resolve({environment:'beta',configured:true,supabaseUrl:'https://beta.example.invalid',supabasePublishableKey:'service_role_forbidden'}).configured,false);
});

await test('bloqueio fail-closed mostra mensagem e interrompe cliente',()=>{
  const document={readyState:'complete',body:{innerHTML:''}};
  throws(()=>runtime.requireConfigured(document,runtime.resolve({environment:'beta'})),/isolated Supabase configuration is required/);
  ok(document.body.innerHTML.includes('Configuração Beta indisponível'));
});

await test('observabilidade remove ID, e-mail e valor',()=>{
  observability.clear();
  const event=observability.record('rpc_error',new Error('user aaaaaaaa-1111-4111-8111-111111111111 beta-a@example.invalid R$ 1.250,00'),{operation:'transfer'});
  ok(!event.message.includes('aaaaaaaa-1111'));ok(!event.message.includes('beta-a@'));ok(!event.message.includes('1.250,00'));equal(event.context.operation,'transfer');
});

await test('fetch monitorado registra apenas metadados seguros',async()=>{
  observability.clear();
  const response={ok:false,status:403,clone:()=>({json:async()=>({code:'42501',message:'private row value 999.99'})})};
  const result=await observability.monitoredFetch(async()=>response)('https://isolated-beta.example.invalid/rest/v1/transactions?amount=999.99',{method:'POST'});
  equal(result,response);const events=observability.snapshot();equal(events.length,1);equal(events[0].kind,'rls_or_auth_denial');equal(events[0].context.code,'42501');ok(!JSON.stringify(events).includes('999.99'));
});

await test('artefato Beta remove configuração legada e injeta somente configuração isolada',()=>{
  const rootDir=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'mb-beta-artifact-'));
  try{
    const out=path.join(temp,'artifact'),rootIndexBefore=fs.readFileSync(path.join(rootDir,'index.html'),'utf8');
    const result=artifact.prepareArtifact({rootDir,pathOut:out,supabaseUrl:'https://isolated-beta.example.invalid',supabasePublishableKey:'sb_publishable_beta_test',authRedirectUrl:'https://beta.example.invalid'});
    const html=fs.readFileSync(path.join(out,'index.html'),'utf8'),env=fs.readFileSync(path.join(out,'js','beta-environment.js'),'utf8');
    ok(html.includes('const SUPABASE_URL="";'));ok(html.includes('const SUPABASE_ANON_KEY="";'));ok(!html.includes('createClient(SUPABASE_URL,SUPABASE_ANON_KEY)'));
    ok(env.includes('isolated-beta.example.invalid'));ok(env.includes('sb_publishable_beta_test'));ok(!env.includes('service_role'));
    for(const asset of ['assets/branding/aviora-official.jpg','assets/branding/aviora-login-hero.jpg']){
      ok(result.files.includes(asset),`artefato declara ${asset}`);
      ok(fs.existsSync(path.join(out,asset)),`artefato copia ${asset}`);
    }
    equal(result.validation.valid,true);equal(fs.readFileSync(path.join(rootDir,'index.html'),'utf8'),rootIndexBefore);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
  equal(fs.existsSync(temp),false);
});

await test('gerador rejeita credencial privilegiada',()=>{
  throws(()=>artifact.environmentSource({supabaseUrl:'https://isolated-beta.example.invalid',supabasePublishableKey:'sb_secret_forbidden'}),/valid Beta URL/);
});

await test('cadeia de produção contém somente migrations elegíveis na ordem e exclui baseline',()=>{
  const rootDir=path.resolve(__dirname,'..'),entries=migrations.eligibleMigrations(rootDir);
  equal(entries.length,3);
  equal(entries[0],'supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql');
  equal(entries[1],'supabase/migrations/20260820195658_structure_recurring_financial_operations_v82.sql');
  equal(entries[2],'supabase/migrations/20260821205630_reconcile_v82_production_access_contract.sql');
  ok(!entries.some(entry=>/baseline|local|beta\//i.test(entry)));
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mb-beta-migrations-'));
  try{const result=migrations.prepareMigrationChain({rootDir,pathOut:path.join(temp,'migrations')});equal(fs.readdirSync(result.output).length,3);for(const entry of entries)ok(!fs.readFileSync(path.join(result.output,path.basename(entry)),'utf8').match(/^\s*create\s+table\b/im))}finally{fs.rmSync(temp,{recursive:true,force:true})}
});

await test('validador rejeita a árvore de produção tratada como Beta',()=>{
  throws(()=>artifact.validateBetaArtifact(path.resolve(__dirname,'..')),/invalid Beta artifact|incomplete Beta artifact/);
});

function withArtifact(run){
  const rootDir=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'mb-beta-validation-')),out=path.join(temp,'artifact');
  try{
    artifact.prepareArtifact({rootDir,pathOut:out,supabaseUrl:'https://isolated-beta.example.invalid',supabasePublishableKey:'sb_publishable_beta_test',authRedirectUrl:'https://beta.example.invalid'});
    run(out);
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
  equal(fs.existsSync(temp),false);
}

await test('artefato Beta correto satisfaz identidade, runtime, cache e fail-closed',()=>withArtifact(out=>{
  const html=fs.readFileSync(path.join(out,'index.html'),'utf8'),manifest=fs.readFileSync(path.join(out,'manifest.webmanifest'),'utf8'),sw=fs.readFileSync(path.join(out,'sw.js'),'utf8');
  equal(artifact.validateBetaArtifact(out).valid,true);
  ok(html.includes('js/beta-runtime.js'));ok(html.includes('MBBetaRuntime.requireConfigured'));ok(manifest.includes('V82 BETA'));ok(sw.includes('mentoria-black-v82-beta'));
  ok(sw.includes('./js/beta-environment.js'));ok(sw.includes('./js/beta-runtime.js'));
  ok(!html.includes('production-runtime'));ok(!sw.includes('mentoria-black-v82-production'));ok(!sw.includes('./js/production-runtime.js'));
}));

await test('artefato Beta com runtime de produção é rejeitado',()=>withArtifact(out=>{
  const file=path.join(out,'index.html');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('js/beta-runtime.js','js/production-runtime.js'));
  throws(()=>artifact.validateBetaArtifact(out),/Beta runtime/);
}));

await test('artefato Beta com cache de produção é rejeitado',()=>withArtifact(out=>{
  const file=path.join(out,'sw.js');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('mentoria-black-v82-beta','mentoria-black-v82-production'));
  throws(()=>artifact.validateBetaArtifact(out),/Beta cache identity/);
}));

await test('artefato Beta incompleto é rejeitado',()=>withArtifact(out=>{
  fs.rmSync(path.join(out,'js','beta-runtime.js'));
  throws(()=>artifact.validateBetaArtifact(out),/incomplete Beta artifact/);
}));

await test('scripts clássicos ativos compilam juntos sem colisão de escopo global',()=>{
  const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sources=[];
  for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
    const sourceMatch=match[1].match(/\bsrc="([^"]+)"/);
    if(sourceMatch&&!/^https?:/i.test(sourceMatch[1]))sources.push(fs.readFileSync(path.join(root,sourceMatch[1].split(/[?#]/,1)[0]),'utf8'));
    if(!sourceMatch&&match[2].trim())sources.push(match[2]);
  }
  ok(sources.length>10);
  new vm.Script(sources.join('\n;\n'),{filename:'production-browser-bundle.js'});
});

console.log(`beta-preparation: ${tests} tests, ${assertions} assertions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
