'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const contract=require('../commercial/admin-access-contract');
const presentation=require('../commercial/admin-presentation');
const clientModule=require('../js/admin-access-client');
const adminArea=require('../js/admin-area');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const deep=(actual,expected,message)=>{assertions++;assert.deepStrictEqual(actual,expected,message)};
async function test(name,fn){try{await fn();tests++}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const OWNER_ID='a1000000-0000-4000-8000-000000000001';
const STAFF_ID='a2000000-0000-4000-8000-000000000002';
const CUSTOMER_ID='a3000000-0000-4000-8000-000000000003';
const GRANT_ID='a4000000-0000-4000-8000-000000000004';
const owner=contract.normalizeContext({user_id:OWNER_ID,role:'OWNER',status:'active'});
const staff=contract.normalizeContext({user_id:STAFF_ID,role:'STAFF',status:'active',permissions:['users.read','licenses.read','licenses.grant','licenses.revoke']});
const dashboard={
  period:{start:'2026-07-28T00:00:00Z',end:'2026-08-27T00:00:00Z'},
  metrics:{accounts:9,active_clients:6,monthly_licenses:3,annual_licenses:2,lifetime_licenses:1,trial_active:1,manual_commercial:{manual:4,commercial:2,unknown:1},expiring_30_days:{grants:3,users:2}},
  manual_by_actor:[{actor_user_id:STAFF_ID,actor_email:'staff@example.invalid',actor_role:'STAFF',actor_status:'disabled',grants:4,monthly:2,annual:2,lifetime:0}],
  manual_activity:[{grant_id:GRANT_ID,product_code:'KNOWLEDGE',license_kind:'monthly',current_status:'revoked',target_user_id:CUSTOMER_ID,target_email:'cliente@example.invalid',granted_by_user_id:STAFF_ID,granted_by_email:'staff@example.invalid',granted_by_role:'STAFF',granted_by_status:'disabled',granted_at:'2026-08-26T20:00:00Z',granted_reason:'Suporte aprovado'}]
};
const baseModel=context=>({contextPhase:'ready',context,section:context.role==='OWNER'?'overview':'users',message:'',dialog:null,managementView:'cards',management:{phase:'ready',data:dashboard},users:{phase:'idle',query:'',items:[],error:null,filter:null,origin:null,nextCursor:null},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}});

(async()=>{
await test('navegação humana começa em Visão Geral somente para Proprietário',()=>{
  deep(contract.visibleSections(owner),['overview','users','staff','audit']);
  deep(contract.visibleSections(staff),['users']);
  deep(contract.visibleSections(contract.normalizeContext(null)),[]);
  const ownerHtml=adminArea.renderAdminArea(baseModel(owner));
  ok(ownerHtml.includes('Visão Geral'));ok(ownerHtml.includes('Usuários e Licenças'));ok(ownerHtml.includes('Funcionários'));ok(ownerHtml.includes('Auditoria'));ok(ownerHtml.includes('Proprietário'));
  const staffHtml=adminArea.renderAdminArea(baseModel(staff));
  ok(!staffHtml.includes('Visão Geral'));ok(!staffHtml.includes('Resumo operacional'));ok(staffHtml.includes('Funcionário'));
});

await test('os nove cards são botões completos, acessíveis e apontam para filtros reais',()=>{
  const html=adminArea.renderManagement(baseModel(owner));
  const expected=['accounts','active_clients','monthly','annual','lifetime','trial_active','origin','expiring_30_days','manual_activity'];
  for(const filter of expected)ok(html.includes(`data-admin-management-card="${filter}"`),filter);
  equal((html.match(/class="admin-management-metric"/g)||[]).length,9);
  equal((html.match(/<button class="admin-management-metric"/g)||[]).length,9);
  ok(html.includes('Ver clientes →'));ok(html.includes('Ver por funcionário →'));ok(html.includes('aria-label='));
});

await test('destinos dos cards usam uma lista filtrada ou a visão manual dedicada',()=>{
  for(const filter of ['accounts','active_clients','monthly','annual','lifetime','trial_active','expiring_30_days'])deep(adminArea.managementCardDestination(filter),{section:'users',filter,origin:null});
  deep(adminArea.managementCardDestination('origin'),{section:'users',filter:'origin',origin:'manual'});
  deep(adminArea.managementCardDestination('manual_activity'),{section:'overview',view:'manual'});
  equal(adminArea.managementCardDestination('unknown'),null);
});

await test('Concessões manuais vira visão própria com retorno e rastreabilidade em português',()=>{
  const html=adminArea.renderManagement({...baseModel(owner),managementView:'manual'});
  ok(html.includes('Concessões manuais'));ok(html.includes('← Voltar para Visão Geral'));
  ok(html.includes('staff@example.invalid — Funcionário'));ok(html.includes('Desativado'));
  ok(html.includes('Conhecimento · Mensal'));ok(html.includes('Suporte aprovado'));
});

await test('drill-down normaliza paginação e preserva values técnicos na única chamada Edge',async()=>{
  const request=contract.validateManagementDrilldownRequest({filter:'origin',origin:'commercial',limit:25,cursor:{createdAt:'2026-08-26T00:00:00Z',userId:CUSTOMER_ID}});
  equal(request.filter,'origin');equal(request.origin,'commercial');equal(request.limit,25);equal(request.cursor.userId,CUSTOMER_ID);
  assert.throws(()=>contract.validateManagementDrilldownRequest({filter:'origin',origin:'unknown'}),/manual or commercial/);assertions++;
  assert.throws(()=>contract.validateManagementDrilldownRequest({filter:'accounts',origin:'manual'}),/only valid/);assertions++;
  const calls=[],client=clientModule.createAdminAccessClient({supabaseClient:{
    auth:{getSession:async()=>({data:{session:{access_token:'jwt'}}})},
    functions:{invoke:async(name,options)=>{
      calls.push({name,options});
      return {data:{ok:true,data:{filter:'monthly',items:[]}},error:null};
    }}
  }});
  await client.getManagementDrilldown({filter:'monthly',limit:25});
  equal(calls.length,1);equal(calls[0].options.body.action,'management.drilldown');equal(calls[0].options.body.filter,'monthly');
  ok(!Object.prototype.hasOwnProperty.call(calls[0].options.body,'actorUserId'));
});

await test('Auditoria usa título humano e preserva o código técnico apenas como dado secundário',()=>{
  const model={...baseModel(owner),section:'audit',audit:{phase:'ready',items:[{created_at:'2026-08-26T00:00:00Z',action:'licenses.revoke',result:'succeeded',product_code:'KNOWLEDGE',actor_email:'owner@example.invalid'}]}};
  const html=adminArea.renderAdminArea(model);
  ok(html.includes('<h3>Licença revogada</h3>'));ok(html.includes('Código técnico: <code>licenses.revoke</code>'));
  ok(html.includes('Concluído'));ok(html.includes('Conhecimento'));
});

await test('camada central traduz papéis, estados, ações e erros de autenticação sem alterar códigos',()=>{
  equal(presentation.roleLabel('OWNER'),'Proprietário');equal(presentation.roleLabel('STAFF'),'Funcionário');equal(presentation.roleLabel('CUSTOMER'),'Cliente');
  equal(presentation.statusLabel('succeeded'),'Concluído');equal(presentation.statusLabel('denied'),'Negado');
  equal(presentation.actionLabel('users.password.reset_direct'),'Senha redefinida pelo administrador');
  equal(presentation.productLabel('KNOWLEDGE'),'Conhecimento');equal(presentation.kindLabel('lifetime'),'Vitalício');
  equal(presentation.safeErrorMessage({message:'Invalid login credentials'},{scope:'auth'}),'E-mail ou senha incorretos.');
  equal(presentation.safeErrorMessage({message:'Email not confirmed'},{scope:'auth'}),'Confirme seu e-mail antes de entrar.');
  equal(presentation.safeErrorMessage({message:'Failed to fetch'},{scope:'auth'}),'Não foi possível conectar agora. Verifique sua conexão e tente novamente.');
  equal(presentation.actionLabel('licenses.revoke'),'Licença revogada');
});

await test('histórico não ativo fica recolhível e grant revogado continua sem nova revogação',()=>{
  const model={...baseModel(owner),section:'users',users:{phase:'ready',query:'cliente',filter:null,origin:null,nextCursor:null,items:[{id:CUSTOMER_ID,email:'cliente@example.invalid',access:[
    {product_code:'APP',status:'active',license_kind:'annual',grant_id:'a5000000-0000-4000-8000-000000000005',administrative:true},
    {product_code:'KNOWLEDGE',status:'revoked',license_kind:'monthly',grant_id:GRANT_ID,administrative:true}
  ]}]}};
  const html=adminArea.renderAdminArea(model);
  ok(html.includes('Mostrar histórico (1)'));ok(html.includes('Revogado'));ok(html.includes('Revogar esta licença'));
  const history=(html.match(/<details class="admin-access-history">[\s\S]*?<\/details>/)||[''])[0];
  ok(history.includes('Revogado'));ok(!history.includes('Revogar esta licença'));
});

await test('regressões de senha, duração e Web Crypto permanecem explícitas',()=>{
  deep(contract.grantLicenseKinds(owner),['monthly','annual','lifetime']);deep(contract.grantLicenseKinds(staff),['monthly','annual']);
  ok(contract.passwordIssues('Synthetic-Strong-2026!').length===0);
  const clientSource=fs.readFileSync(path.join(__dirname,'../js/admin-access-client.js'),'utf8');
  ok(clientSource.includes('cryptoApi.randomUUID'));ok(clientSource.includes('cryptoApi.getRandomValues'));ok(!clientSource.includes('Math.random'));
  const css=fs.readFileSync(path.join(__dirname,'../assets/admin-area.css'),'utf8');
  ok(css.includes('.admin-management-metric:focus-visible'));ok(css.includes('@media (max-width: 370px)'));
});

console.log(`admin-management-ux: ${tests} tests, ${assertions} assertions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
