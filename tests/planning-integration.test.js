const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {projectPlanningPeriod}=require('../js/planning-integration');

let testCount=0,assertionCount=0;
function equal(actual,expected,message){assertionCount+=1;assert.strictEqual(actual,expected,message)}
function deepEqual(actual,expected,message){assertionCount+=1;assert.deepStrictEqual(actual,expected,message)}
function ok(actual,message){assertionCount+=1;assert.ok(actual,message)}
function test(name,fn){try{fn();testCount+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const NOW='2026-01-15';
const options=(overrides={})=>({year:2026,month:1,now:NOW,...overrides});
const run=(plan=null,transactions=[],rules=[],overrides={})=>projectPlanningPeriod(plan,transactions,rules,options(overrides));
const tx=(overrides={})=>({id:'tx',transaction_type:'despesa',category:'Lazer',amount:100,status:'realizado',transaction_date:'2026-01-10',...overrides});
const rule=(overrides={})=>({id:'rule',transaction_type:'despesa',category:'Gastos Fixos',amount:100,frequency:'monthly',interval:1,next_date:'2026-01-20',active:true,...overrides});

test('seleciona monthlyPlan por ano e mês',()=>{
  const result=run([{year:2025,month:1,revenue:1},{year:2026,month:1,revenue:2000}]);
  equal(result.period.planFound,true);equal(result.planned.revenue,2000);equal(result.period.key,'2026-01');
});

test('receita planejada e seis envelopes permanecem explícitos',()=>{
  const plan={revenue:10000,fixed_expenses:2000,investments:1000,comfort:800,goals:700,leisure:600,knowledge:500};
  const result=run(plan);
  equal(result.planned.revenue,10000);equal(result.planned.fixedExpenses,2000);equal(result.planned.investment,1000);
  equal(result.planned.comfort,800);equal(result.planned.goals,700);equal(result.planned.leisure,600);equal(result.planned.knowledge,500);
  equal(result.planned.totalOut,5600);equal(result.planned.consumptionByCategory.Metas,700);
});

test('mês sem plano retorna estrutura zerada',()=>{
  const result=run(null);
  equal(result.period.planFound,false);equal(result.planned.revenue,0);equal(result.planned.totalOut,0);equal(result.warnings.length,0);
});

test('realizado canônico entra apenas em realized',()=>{
  const result=run(null,[tx()]);
  equal(result.realized.totalOut,100);equal(result.realized.consumptionByCategory.Lazer,100);
  equal(result.scheduledMaterialized.totalOut,0);equal(result.forecast.totalOut,0);
});

test('pending e pendente entram em programado materializado',()=>{
  const result=run(null,[tx({id:'a',status:'pending',amount:40}),tx({id:'b',status:'pendente',amount:60})]);
  equal(result.realized.totalOut,0);equal(result.scheduledMaterialized.totalOut,100);equal(result.forecast.totalOut,100);
});

test('programado e scheduled entram em programado materializado',()=>{
  const result=run(null,[tx({id:'a',status:'programado',amount:30}),tx({id:'b',status:'scheduled',amount:70})]);
  equal(result.scheduledMaterialized.consumptionByCategory.Lazer,100);equal(result.projectedVirtual.totalOut,0);
});

test('future_realized vira programado com warning',()=>{
  const result=run(null,[tx({transaction_date:'2026-01-20',amount:250})]);
  equal(result.realized.totalOut,0);equal(result.scheduledMaterialized.totalOut,250);ok(result.warnings.includes('future_realized:tx'));
});

test('cancelados são excluídos em todos aliases',()=>{
  const result=run(null,['cancelado','canceled','cancelled'].map((status,index)=>tx({id:`c${index}`,status})));
  equal(result.realized.totalOut,0);equal(result.scheduledMaterialized.totalOut,0);equal(result.unclassified.length,0);
});

test('status ausente e desconhecido são unclassified sem efeito',()=>{
  const result=run(null,[tx({id:'missing',status:null}),tx({id:'unknown',status:'mystery'})]);
  equal(result.realized.totalOut,0);equal(result.unclassified.length,2);
  deepEqual(result.unclassified.map(item=>item.reason),['missing_status','unknown_status']);
});

test('data inválida é auditada sem efeito',()=>{
  const result=run(null,[tx({transaction_date:'invalid'})]);
  equal(result.realized.totalOut,0);equal(result.unclassified.length,1);equal(result.unclassified[0].reason,'invalid_financial_date');
});

test('receita efetivada é income',()=>{
  const result=run(null,[tx({transaction_type:'receita',amount:500,account_id:'cash'})]);
  equal(result.realized.income,500);equal(result.realized.totalOut,0);
});

test('despesa é consumo por categoria',()=>{
  const result=run(null,[tx({amount:123.45,category:'Conforto'})]);
  equal(result.realized.consumptionByCategory.Conforto,123.45);equal(result.realized.investment,0);equal(result.realized.totalOut,123.45);
});

test('investimento permanece separado de consumo',()=>{
  const result=run(null,[tx({transaction_type:'investimento',category:'Investimentos',asset_id:'asset',amount:300})]);
  equal(result.realized.investment,300);equal(Object.keys(result.realized.consumptionByCategory).length,0);equal(result.realized.totalOut,300);
});

test('transferência é neutra no consolidado',()=>{
  const result=run(null,[tx({transaction_type:'transferencia',source_account_id:'a',destination_account_id:'b',amount:400})]);
  equal(result.realized.income,0);equal(result.realized.totalOut,0);equal(result.transfers.realized,400);
});

test('resgate fica separado de receita',()=>{
  const result=run(null,[tx({transaction_type:'resgate',account_id:'cash',asset_id:'asset',amount:450})]);
  equal(result.realized.income,0);equal(result.realized.totalOut,0);equal(result.rescues.realized,450);
});

test('recorrência virtual aparece apenas em projected e forecast',()=>{
  const result=run(null,[],[rule()]);
  equal(result.projectedVirtual.totalOut,100);equal(result.forecast.totalOut,100);equal(result.realized.totalOut,0);equal(result.scheduledMaterialized.totalOut,0);
});

test('materializado recorrente substitui virtual equivalente',()=>{
  const materialized=tx({status:'pending',transaction_date:'2026-01-20',recurring_series_id:'rule',recurring_occurrence_date:'2026-01-20',category:'Gastos Fixos',amount:175});
  const result=run(null,[materialized],[rule()]);
  equal(result.scheduledMaterialized.totalOut,175);equal(result.projectedVirtual.totalOut,0);equal(result.forecast.totalOut,175);
});

test('materializado legado por note substitui virtual equivalente',()=>{
  const materialized=tx({status:'pending',transaction_date:'2026-01-20',note:'Recorrência automática • abcdef12',category:'Gastos Fixos',amount:175});
  const result=run(null,[materialized],[rule({id:'abcdef12'})]);
  equal(result.scheduledMaterialized.totalOut,175);equal(result.projectedVirtual.totalOut,0);equal(result.forecast.totalOut,175);
});

test('duas séries na mesma data permanecem distintas',()=>{
  const result=run(null,[],[rule({id:'a',amount:100}),rule({id:'b',amount:50})]);
  equal(result.details.projectedVirtual.length,2);equal(new Set(result.details.projectedVirtual.map(item=>item.key)).size,2);equal(result.projectedVirtual.totalOut,150);
});

test('duplicata materializada da mesma série e data é somada uma vez',()=>{
  const rows=[tx({id:'first',amount:100,recurring_series_id:'series',recurring_occurrence_date:'2026-01-10'}),tx({id:'duplicate',amount:999,recurring_series_id:'series',recurring_occurrence_date:'2026-01-10'})];
  const result=run(null,rows,[]);
  equal(result.realized.totalOut,100);ok(result.warnings.includes('duplicate_materialized:series|2026-01-10'));
});

test('regra inativa não projeta',()=>{
  const result=run(null,[],[rule({active:false})]);
  equal(result.projectedVirtual.totalOut,0);equal(result.details.projectedVirtual.length,0);
});

test('end_date limita a projeção no mês',()=>{
  const result=run(null,[],[rule({frequency:'weekly',next_date:'2026-01-05',end_date:'2026-01-12'})]);
  deepEqual(result.details.projectedVirtual.map(item=>item.occurrenceDate),['2026-01-05','2026-01-12']);equal(result.projectedVirtual.totalOut,200);
});

test('interval maior que um é respeitado',()=>{
  const result=run(null,[],[rule({frequency:'weekly',interval:2,next_date:'2026-01-01'})]);
  deepEqual(result.details.projectedVirtual.map(item=>item.occurrenceDate),['2026-01-01','2026-01-15','2026-01-29']);
});

test('mês 2046 independe de materialização',()=>{
  const result=run(null,[],[rule({next_date:'2026-01-20'})],{year:2046,month:1,maxOccurrences:10});
  equal(result.details.projectedVirtual.length,1);equal(result.details.projectedVirtual[0].occurrenceDate,'2046-01-20');equal(result.projectedVirtual.totalOut,100);
});

test('mês posterior a 2046 não encontra teto fixo',()=>{
  const result=run(null,[],[rule({next_date:'2026-01-20'})],{year:2056,month:7,maxOccurrences:10});
  equal(result.details.projectedVirtual.length,1);equal(result.details.projectedVirtual[0].occurrenceDate,'2056-07-20');
});

test('virtual herda tipo categoria e goal_id da regra',()=>{
  const result=run(null,[],[rule({transaction_type:'investimento',category:'Carteira',category_id:'cat',goal_id:'goal',asset_id:'asset',amount:250})]);
  const item=result.details.projectedVirtual[0];
  equal(item.transactionType,'investimento');equal(item.category,'Carteira');equal(item.categoryId,'cat');equal(item.goalId,'goal');equal(result.projectedVirtual.investment,250);
});

test('parcelamento legítimo preserva parcelas diferentes',()=>{
  const rows=[tx({id:'p1',note:'Parcelado 1/2 • compra 2026-01'}),tx({id:'p2',note:'Parcelado 2/2 • compra 2026-01',transaction_date:'2026-01-11'})];
  const result=run(null,rows,[]);
  equal(result.realized.totalOut,200);equal(result.details.realized.length,2);
});

test('duplicata real de parcela é ignorada sem mutação',()=>{
  const rows=[tx({id:'p1',note:'Parcelado 1/2 • compra 2026-01-05'}),tx({id:'dup',note:'Parcelado 1/2 • compra 2026-01-05',amount:999})];
  const before=JSON.stringify(rows),result=run(null,rows,[]);
  equal(result.realized.totalOut,100);ok(result.warnings.includes('duplicate_installment:dup'));equal(JSON.stringify(rows),before);
});

test('duas compras semelhantes em dias diferentes não são duplicadas',()=>{
  const rows=[tx({id:'day5',note:'Parcelado 1/2 • compra 2026-01-05'}),tx({id:'day6',note:'Parcelado 1/2 • compra 2026-01-06',amount:150})];
  const result=run(null,rows,[]);
  equal(result.realized.totalOut,250);equal(result.details.realized.length,2);equal(result.warnings.length,0);
});

test('recorrência e parcelamento aplicam identidades independentes',()=>{
  const row=tx({note:'Parcelado 1/2 • compra 2026-01',recurring_series_id:'rule',recurring_occurrence_date:'2026-01-10'});
  const result=run(null,[row],[rule({next_date:'2026-01-10'})]);
  equal(result.realized.totalOut,100);equal(result.projectedVirtual.totalOut,0);equal(result.warnings.length,0);
});

test('forecast soma programado e projetado sem realizado',()=>{
  const result=run(null,[tx({status:'pending',amount:70})],[rule({amount:30})]);
  equal(result.realized.totalOut,0);equal(result.scheduledMaterialized.totalOut,70);equal(result.projectedVirtual.totalOut,30);equal(result.forecast.totalOut,100);
});

test('entradas nunca são mutadas',()=>{
  const plan={year:2026,month:1,revenue:1000},transactions=[tx()],rules=[rule()],opts=options();
  const before=JSON.stringify({plan,transactions,rules,opts});projectPlanningPeriod(plan,transactions,rules,opts);
  equal(JSON.stringify({plan,transactions,rules,opts}),before);
});

test('módulo funciona no navegador sem CommonJS ou Supabase',()=>{
  const context={console};context.globalThis=context;vm.createContext(context);
  for(const file of ['financial-core.js','recurrence-projection.js','planning-integration.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',file),'utf8'),context,{filename:file});
  ok(context.MBPlanningV82);equal(typeof context.MBPlanningV82.projectPlanningPeriod,'function');
  const source=fs.readFileSync(path.join(__dirname,'..','js','planning-integration.js'),'utf8');
  ok(!/supabase|localStorage|document\.|window\./i.test(source));
});

test('página Planejamento consome o motor sem substituir seletores globais',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const start=html.indexOf('function planning(){'),end=html.indexOf('function openPlan(){',start),source=html.slice(start,end);
  ok(source.includes('MBPlanningV82.projectPlanningPeriod'));
  for(const label of ['Planejado','Realizado','Programado','Projetado','Previsão'])ok(source.includes(label),`missing ${label}`);
  ok(source.includes('<canvas id="planChart"></canvas>'));
  ok(!source.includes('periodTx('));
});

console.log(`planning-integration: ${testCount} tests, ${assertionCount} assertions passed`);
