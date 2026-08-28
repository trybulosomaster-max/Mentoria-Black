const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const planning=require('../js/planning-integration');

let testCount=0,assertionCount=0;
function equal(actual,expected,message){assertionCount+=1;assert.strictEqual(actual,expected,message)}
function ok(actual,message){assertionCount+=1;assert.ok(actual,message)}
function test(name,fn){try{fn();testCount+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const NOW='2026-08-20';
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const helperStart=html.indexOf('  function dashboardPlanningSummary(){');
const helperEnd=html.indexOf('\n\n  window.dashboard = function(){',helperStart);
assert(helperStart>=0&&helperEnd>helperStart,'Dashboard planning helper source must exist');

class FixedDate extends Date { constructor(...args){super(...(args.length?args:[`${NOW}T12:00:00Z`]))} }
const plan={year:2026,month:8,revenue:8000,fixed_expenses:1000,comfort:600,goals:500,leisure:400,knowledge:300,investments:1200};
const tx=(overrides={})=>({id:'tx',transaction_type:'despesa',category:'Conforto',amount:100,status:'realizado',transaction_date:'2026-08-10',...overrides});
const rule=(overrides={})=>({id:'rule',transaction_type:'despesa',category:'Lazer',amount:50,frequency:'monthly',interval:1,next_date:'2026-08-25',active:true,...overrides});

function project(selectedPlan=plan,transactions=[],rules=[],year=2026,month=8){return planning.projectPlanningPeriod(selectedPlan,transactions,rules,{year,month,now:NOW,maxOccurrences:500})}
function render(selectedPlan=plan,transactions=[],rules=[],year=2026,month=8){
  const context={DATA:{transactions,recurring:rules},FILTERS:{year,month},Date:FixedDate,console,MBPlanningV82:planning,
    CAT_ORDER:['Gastos Fixos','Investimentos','Conforto','Metas','Lazer','Conhecimento'],
    monthlyPlan:()=>selectedPlan,esc:value=>String(value),money:value=>`$${Number(value)}`,categoryColor:()=>'#000'};
  context.window=context;vm.createContext(context);
  vm.runInContext(`${html.slice(helperStart,helperEnd)};this.renderDashboardPlanning=dashboardPlanningSummary;`,context);
  return context.renderDashboardPlanning();
}
function renderActiveDashboard(selectedPlan=plan,transactions=[],rules=[],year=2026,month=8){
  const wrapperStart=html.indexOf('  window.dashboard = function(){',helperStart);
  const wrapperEnd=html.indexOf("\n\n  document.title='AVIORA",wrapperStart);
  const base=`<div class="kpis"></div><div class="grid"><section class="card s6"><h2>Cartões de crédito</h2></section><section class="card s12 dashboard-latest-transactions" data-dashboard-latest><h2>Últimos lançamentos do período</h2></section></div>`;
  const context={DATA:{transactions,recurring:rules},FILTERS:{year,month},Date:FixedDate,console,MBPlanningV82:planning,
    CAT_ORDER:['Gastos Fixos','Investimentos','Conforto','Metas','Lazer','Conhecimento'],monthlyPlan:()=>selectedPlan,esc:value=>String(value),money:value=>`$${Number(value)}`,
    categoryColor:()=>'#000',baseDashboard60:()=>base,periodTx:()=>[],totals:()=>({income:0,expense:0,invest:0,balance:0}),kpi:()=>'',netWorth:()=>0,revenueYear:()=>[],dashboardGoalsSummary:()=>'',MB_V56_RESERVE_CURRENT:()=>0};
  context.window=context;vm.createContext(context);
  vm.runInContext(`${html.slice(helperStart,helperEnd)};${html.slice(wrapperStart,wrapperEnd)};this.renderActiveDashboard=window.dashboard;`,context);
  return context.renderActiveDashboard();
}

test('Dashboard chama o motor canônico público, sem cálculo financeiro paralelo',()=>{
  const source=html.slice(helperStart,helperEnd);
  ok(source.includes('MBPlanningV82.projectPlanningPeriod'));
  ok(source.includes('DATA.transactions||[]'));
  ok(source.includes('DATA.recurring||[]'));
  ok(source.includes('year:FILTERS.year,month:FILTERS.month,now'));
  ok(!source.includes('periodTx()'));
  ok(!source.includes('totals('));
});

test('o renderer base não mantém os dois blocos legados duplicados',()=>{
  const baseStart=html.indexOf('function dashboard(){'),baseEnd=html.indexOf('function planning(){',baseStart);
  const base=html.slice(baseStart,baseEnd),wrapper=html.slice(helperStart,html.indexOf("  document.title='AVIORA",helperStart));
  equal((base.match(/Planejado × realizado/g)||[]).length,0);
  equal((wrapper.match(/dashboard-planning-categories-v82/g)||[]).length,0);
  equal((wrapper.match(/Planejado × realizado por categoria/g)||[]).length,0);
  ok(wrapper.includes('planningSection+planningAnchor'));
  const output=renderActiveDashboard();
  equal((output.match(/Planejamento por envelope/g)||[]).length,0);
  equal((output.match(/Resumo do mês/g)||[]).length,1);
  equal((output.match(/Abrir Planejamento/g)||[]).length,1);
  equal((output.match(/Planejado × realizado por categoria/g)||[]).length,0);
});

test('mês atual mostra planejado, realizado, programado, projetado e previsão do mesmo resultado do Planejamento',()=>{
  const rows=[tx({id:'done',amount:120}),tx({id:'pending',status:'pending',amount:80,transaction_date:'2026-08-22'}),tx({id:'future-realized',status:'realizado',amount:40,transaction_date:'2026-08-24'})];
  const result=project(plan,rows,[rule()]);const output=render(plan,rows,[rule()]);
  equal(result.realized.totalOut,120);equal(result.scheduledMaterialized.totalOut,120);equal(result.projectedVirtual.totalOut,50);equal(result.forecast.totalOut,170);
  ok(output.includes('$4000'));ok(output.includes('$120'));ok(output.includes('$170'));ok(output.includes('Resumo do mês'));
});

test('pending, scheduled e future_realized são programados; cancelado e desconhecido não entram',()=>{
  const rows=[tx({id:'pending',status:'pending',amount:10}),tx({id:'scheduled',status:'scheduled',amount:20}),tx({id:'future',status:'realizado',amount:30,transaction_date:'2026-08-23'}),tx({id:'cancel',status:'cancelado',amount:40}),tx({id:'unknown',status:'mystery',amount:50}),tx({id:'missing',status:null,amount:60})];
  const result=project(plan,rows,[]);const output=render(plan,rows,[]);
  equal(result.realized.totalOut,0);equal(result.scheduledMaterialized.totalOut,60);equal(result.unclassified.length,2);ok(result.warnings.includes('future_realized:future'));
  ok(output.includes('$60'));ok(output.includes('2 lançamento(s) sem categoria reconhecida'));
});

test('receita, despesa e investimento permanecem separados; transferência e resgate são neutros nos envelopes',()=>{
  const rows=[tx({id:'income',transaction_type:'receita',amount:900,category:'Receitas'}),tx({id:'expense',amount:100,category:'Lazer'}),tx({id:'investment',transaction_type:'investimento',amount:300,category:'Investimentos',asset_id:'asset'}),tx({id:'transfer',transaction_type:'transferencia',amount:400,source_account_id:'a',destination_account_id:'b'}),tx({id:'rescue',transaction_type:'resgate',amount:200,asset_id:'asset'})];
  const result=project(plan,rows,[]);const output=render(plan,rows,[]);
  equal(result.realized.income,900);equal(result.realized.consumptionByCategory.Lazer,100);equal(result.realized.investment,300);equal(result.realized.totalOut,400);equal(result.transfers.realized,400);equal(result.rescues.realized,200);
  ok(output.includes('$500'),'expected result keeps income, expenses and investments separated');
  ok(html.slice(html.indexOf('function planning(){'),html.indexOf('function openPlan(){')).includes('Investimentos'),'planning keeps the investment category visible');
});

test('materializado prevalece sobre virtual e duas séries permanecem distintas',()=>{
  const rows=[tx({id:'materialized',status:'pending',transaction_date:'2026-08-25',amount:75,recurring_series_id:'a',recurring_occurrence_date:'2026-08-25'})];
  const rules=[rule({id:'a',amount:50}),rule({id:'b',amount:30})];const result=project(plan,rows,rules);const output=render(plan,rows,rules);
  equal(result.scheduledMaterialized.totalOut,75);equal(result.projectedVirtual.totalOut,30);equal(result.details.projectedVirtual.length,1);equal(result.details.projectedVirtual[0].recurringSeriesId,'b');
  ok(output.includes('$105'),'Dashboard summarizes the single reconciled forecast');
  ok(html.includes('<th>Programado</th><th>Projetado</th><th>Previsão</th>'),'Planning keeps the detailed components available on demand');
});

test('regra inativa e encerrada não gera previsão virtual',()=>{
  const inactive=project(plan,[],[rule({active:false})]);const ended=project(plan,[],[rule({end_date:'2026-08-01'})]);
  equal(inactive.projectedVirtual.totalOut,0);equal(ended.projectedVirtual.totalOut,0);ok(render(plan,[],[rule({active:false})]).includes('$0'));
});

test('mês futuro e mês sem plano mantêm semântica e não inventam planejado',()=>{
  const futurePlan={...plan,year:2027,month:1};const rows=[tx({status:'pending',transaction_date:'2027-01-10',amount:70})];const future=project(futurePlan,rows,[rule({next_date:'2027-01-20'})],2027,1);
  equal(future.realized.totalOut,0);equal(future.scheduledMaterialized.totalOut,70);equal(future.projectedVirtual.totalOut,50);equal(future.forecast.totalOut,120);
  const noPlan=project(null,rows,[],2027,1);equal(noPlan.period.planFound,false);equal(noPlan.planned.totalOut,0);ok(render(null,rows,[],2027,1).includes('Sem planejamento cadastrado'));
});

test('2046 e ano posterior não têm teto no Dashboard porque o período vem do motor',()=>{
  const rule2046=rule({next_date:'2046-06-10'}),year2046=project({year:2046,month:6},[],[rule2046],2046,6);
  const rule2056=rule({next_date:'2056-07-10'}),year2056=project({year:2056,month:7},[],[rule2056],2056,7);
  equal(year2046.projectedVirtual.totalOut,50);equal(year2056.projectedVirtual.totalOut,50);ok(render({year:2056,month:7},[],[rule2056],2056,7).includes('$50'));
  ok(!/2046|2056/.test(fs.readFileSync(path.join(__dirname,'..','js','planning-integration.js'),'utf8')));
});

console.log(`dashboard-planning-integration: ${testCount} tests, ${assertionCount} assertions passed`);
