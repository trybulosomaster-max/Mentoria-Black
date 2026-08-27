'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const contract=require('../commercial/admin-access-contract');
const clientModule=require('../js/admin-access-client');
const adminArea=require('../js/admin-area');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const deep=(actual,expected,message)=>{assertions++;assert.deepStrictEqual(actual,expected,message)};
async function test(name,fn){try{await fn();tests++}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const OWNER_ID='81000000-0000-4000-8000-000000000001';
const STAFF_ID='81000000-0000-4000-8000-000000000002';
const CUSTOMER_ID='81000000-0000-4000-8000-000000000003';
const GRANT_ID='81000000-0000-4000-8000-000000000004';
const owner=contract.normalizeContext({user_id:OWNER_ID,role:'OWNER',status:'active'});
const staff=contract.normalizeContext({user_id:STAFF_ID,role:'STAFF',status:'active',permissions:['users.read','licenses.read','licenses.grant','licenses.revoke']});
const dashboardPayload={
  server_now:'2026-08-26T22:00:00Z',
  period:{start:'2026-07-27T22:00:00Z',end:'2026-08-27T00:00:00Z',end_exclusive:true},
  metrics:{
    accounts:12,active_clients:7,monthly_licenses:4,annual_licenses:2,lifetime_licenses:1,trial_active:3,
    manual_commercial:{manual:5,commercial:4,unknown:1},expiring_30_days:{grants:6,users:4}
  },
  manual_by_actor:[{actor_user_id:STAFF_ID,actor_email:'staff@example.invalid',actor_role:'STAFF',actor_status:'disabled',grants:2,monthly:1,annual:1,lifetime:0}],
  manual_activity:[{
    grant_id:GRANT_ID,product_code:'APP',license_kind:'monthly',current_status:'revoked',
    target_user_id:CUSTOMER_ID,target_email:'customer@example.invalid',
    granted_by_user_id:STAFF_ID,granted_by_email:'staff@example.invalid',granted_by_role:'STAFF',granted_by_status:'disabled',
    granted_at:'2026-08-26T20:00:00Z',granted_reason:'Suporte comercial autorizado',
    revoked_by_user_id:OWNER_ID,revoked_by_name:'Olivia Owner',revoked_by_email:'owner@example.invalid',revoked_by_role:'OWNER',revoked_at:'2026-08-26T21:00:00Z',revoked_reason:'Solicitação do cliente'
  }]
};

(async()=>{
await test('contrato normaliza todas as métricas sem duplicar estruturas no frontend',()=>{
  const value=contract.normalizeManagementDashboard(dashboardPayload);
  equal(value.metrics.accounts,12);equal(value.metrics.activeClients,7);
  equal(value.metrics.monthlyLicenses,4);equal(value.metrics.annualLicenses,2);equal(value.metrics.lifetimeLicenses,1);
  equal(value.metrics.trialActive,3);deep(value.metrics.manualCommercial,{manual:5,commercial:4,unknown:1});deep(value.metrics.expiring30Days,{grants:6,users:4});
  equal(value.manualByActor.length,1);equal(value.manualActivity.length,1);
});

await test('OWNER vê o resumo gerencial completo e rastreabilidade real',()=>{
  const html=adminArea.renderManagement({context:owner,management:{phase:'ready',data:dashboardPayload}});
  for(const label of ['Contas cadastradas','Clientes ativos','Mensal','Anual','Vitalício','Trial ativo','Manual / Comercial','Expiram em 30 dias','Concessões manuais'])ok(html.includes(label),label);
  ok(html.includes('contas do sistema; podem incluir administrativas'));
  ok(html.includes('clientes únicos; Aplicativo + Conhecimento contam uma vez'));
  ok(html.includes('Manual exige proveniência AVIORA'));
  const detail=adminArea.renderManagement({context:owner,managementView:'manual',management:{phase:'ready',data:dashboardPayload}});
  ok(detail.includes('Concessões manuais'));
  ok(detail.includes('staff@example.invalid — Funcionário'));
  ok(detail.includes('Olivia Owner — owner@example.invalid — Proprietário'));
  ok(detail.includes('Desativado'));
  ok(detail.includes('Suporte comercial autorizado'));
  ok(detail.includes('Solicitação do cliente'));
});

await test('STAFF e CUSTOMER não recebem métricas globais no DOM',()=>{
  equal(adminArea.renderManagement({context:staff,management:{phase:'ready',data:dashboardPayload}}),'');
  equal(adminArea.renderManagement({context:contract.normalizeContext(null),management:{phase:'ready',data:dashboardPayload}}),'');
  const staffPage=adminArea.renderAdminArea({contextPhase:'ready',context:staff,section:'users',message:'',dialog:null,management:{phase:'ready',data:dashboardPayload},users:{phase:'idle',items:[]},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}});
  ok(!staffPage.includes('Visão Geral'));ok(!staffPage.includes('Concessões manuais'));
});

await test('filtro gerencial usa período ISO validado e rejeita campos controlados',()=>{
  const query=contract.validateManagementRequest({periodStart:'2026-08-01T00:00:00Z',periodEnd:'2026-09-01T00:00:00Z',limit:80});
  equal(query.periodStart,'2026-08-01T00:00:00.000Z');equal(query.periodEnd,'2026-09-01T00:00:00.000Z');equal(query.limit,80);
  assert.throws(()=>contract.validateManagementRequest({periodStart:'2026-09-01T00:00:00Z'}),/required together/);assertions++;
  assert.throws(()=>contract.validateManagementRequest({periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-08-01T00:00:00Z'}),/invalid/);assertions++;
  assert.throws(()=>contract.validateManagementRequest({actorUserId:OWNER_ID}),/not allowed/);assertions++;
});

await test('cliente envia uma única action agregada à Edge sem N+1',async()=>{
  const calls=[],supabaseClient={
    auth:{getSession:async()=>({data:{session:{access_token:'synthetic-jwt',user:{id:OWNER_ID}}},error:null})},
    functions:{invoke:async(name,options)=>{calls.push({name,options});return {data:{ok:true,data:dashboardPayload},error:null}}}
  };
  const client=clientModule.createAdminAccessClient({supabaseClient,cryptoApi:{randomUUID:()=>GRANT_ID}});
  await client.getManagementDashboard({periodStart:'2026-08-01T00:00:00Z',periodEnd:'2026-09-01T00:00:00Z'});
  equal(calls.length,1);equal(calls[0].options.body.action,'management.dashboard');
  ok(!Object.prototype.hasOwnProperty.call(calls[0].options.body,'actorUserId'));
});

await test('grant individual mostra atores e preserva histórico revogado sem nova ação',()=>{
  const base={contextPhase:'ready',context:owner,section:'users',message:'',dialog:null,management:{phase:'idle'},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]}};
  const html=adminArea.renderAdminArea({...base,users:{phase:'ready',query:'customer',items:[{
    id:CUSTOMER_ID,email:'customer@example.invalid',access:[{
      product_code:'APP',status:'revoked',access_type:'manual',license_kind:'monthly',grant_id:GRANT_ID,administrative:true,source:'manual',
      granted:{actor_user_id:STAFF_ID,actor_email:'staff@example.invalid',actor_role:'STAFF',actor_status:'disabled',at:'2026-08-26T20:00:00Z',reason:'Suporte comercial autorizado'},
      revoked:{actor_user_id:OWNER_ID,actor_name:'Olivia Owner',actor_email:'owner@example.invalid',actor_role:'OWNER',at:'2026-08-26T21:00:00Z',reason:'Solicitação do cliente'}
    }]
  }]}});
  ok(html.includes('Concedido por'));ok(html.includes('staff@example.invalid — Funcionário'));
  ok(html.includes('Revogado por'));ok(html.includes('Olivia Owner — owner@example.invalid — Proprietário'));
  ok(html.includes('Revogado'));ok(!html.includes('Revogar este grant'));
});

await test('identidade visual do ator nunca substitui e-mail ou UUID por nome editável',()=>{
  const withName=adminArea.renderManagement({context:owner,managementView:'manual',management:{phase:'ready',data:dashboardPayload}});
  ok(withName.includes('Olivia Owner — owner@example.invalid — Proprietário'));
  const withoutEmail=adminArea.renderAdminArea({contextPhase:'ready',context:owner,section:'users',message:'',dialog:null,management:{phase:'idle'},staff:{phase:'idle',items:[]},audit:{phase:'idle',items:[]},users:{phase:'ready',query:'customer',items:[{
    id:CUSTOMER_ID,email:'customer@example.invalid',access:[{
      product_code:'APP',status:'revoked',access_type:'manual',license_kind:'monthly',grant_id:GRANT_ID,administrative:true,source:'manual',
      granted:{actor_user_id:STAFF_ID,actor_name:'Nome Editável',actor_role:'STAFF',at:'2026-08-26T20:00:00Z',reason:'Suporte comercial autorizado'}
    }]
  }]}});
  ok(withoutEmail.includes(`Nome Editável — ${STAFF_ID} — Funcionário`));
  ok(!withoutEmail.includes('Nome Editável — Funcionário'));
});

await test('regressões de duração, senha, Web Crypto e STAFF sem lifetime permanecem',()=>{
  deep(contract.grantLicenseKinds(owner),['monthly','annual','lifetime']);deep(contract.grantLicenseKinds(staff),['monthly','annual']);
  ok(contract.passwordIssues('Synthetic-Strong-2026!').length===0);
  const clientSource=fs.readFileSync(path.join(__dirname,'../js/admin-access-client.js'),'utf8');
  ok(clientSource.includes('cryptoApi.randomUUID'));ok(clientSource.includes('cryptoApi.getRandomValues'));ok(!clientSource.includes('Math.random'));
});

console.log(`admin-management-dashboard: ${tests} tests, ${assertions} assertions passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
