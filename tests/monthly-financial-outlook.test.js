'use strict';

const assert=require('assert');
const {projectDashboardPeriod,combineFinancialBuckets}=require('../js/dashboard-financial-integration');

let tests=0,assertions=0;
const equal=(actual,expected,message)=>{assertions+=1;assert.strictEqual(actual,expected,message)};
const deep=(actual,expected,message)=>{assertions+=1;assert.deepStrictEqual(actual,expected,message)};
const ok=(value,message)=>{assertions+=1;assert.ok(value,message)};
function test(name,fn){try{fn();tests+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const tx=(overrides={})=>({
  id:'tx',transaction_type:'despesa',category:'Lazer',subcategory:null,amount:100,
  status:'realizado',transaction_date:'2026-10-02',account_id:'cash',...overrides
});
const rule=(overrides={})=>({
  id:'rule',transaction_type:'despesa',category:'Gastos Fixos',subcategory:null,
  amount:100,frequency:'monthly',interval:1,next_date:'2026-09-05',active:true,
  account_id:'cash',...overrides
});
const options=(overrides={})=>({year:2026,month:10,now:'2026-10-15',...overrides});
const project=(rows=[],rules=[],overrides={})=>projectDashboardPeriod(rows,rules,options(overrides));

const octoberRows=[
  tx({id:'paid-expense',amount:120,category:'Lazer',subcategory:'Cinema'}),
  tx({id:'pending-expense',amount:80,status:'pendente',category:'Conhecimento',subcategory:'Livro'}),
  tx({id:'card-pending',amount:300,status:'pendente',transaction_date:'2026-10-10',purchase_date:'2026-09-28',card_id:'card',account_id:null,category:'Conforto',subcategory:'Casa'}),
  tx({id:'installment-oct',amount:150,status:'pendente',transaction_date:'2026-10-18',purchase_date:'2026-08-05',card_id:'card',account_id:null,category:'Conhecimento',subcategory:'Curso',note:'Parcelado 2/3 • Compra 2026-08-05'}),
  tx({id:'installment-sep',amount:150,status:'pendente',transaction_date:'2026-09-18',purchase_date:'2026-08-05',card_id:'card',account_id:null,category:'Conhecimento',subcategory:'Curso',note:'Parcelado 1/3 • Compra 2026-08-05'}),
  tx({id:'installment-nov',amount:150,status:'pendente',transaction_date:'2026-11-18',purchase_date:'2026-08-05',card_id:'card',account_id:null,category:'Conhecimento',subcategory:'Curso',note:'Parcelado 3/3 • Compra 2026-08-05'}),
  tx({id:'scheduled-investment',transaction_type:'investimento',category:'Investimentos',amount:250,status:'programado',transaction_date:'2026-10-20',asset_id:'asset',source_account_id:'cash'}),
  tx({id:'realized-income',transaction_type:'receita',category:'Salário',amount:500,status:'realizado',transaction_date:'2026-10-01'}),
  tx({id:'cancelled',amount:999,status:'cancelado',transaction_date:'2026-10-12'})
];
const octoberRules=[
  rule({id:'rent',amount:1000,category:'Gastos Fixos',subcategory:'Aluguel'}),
  rule({id:'internet',amount:100,category:'Gastos Fixos',subcategory:'Internet',next_date:'2026-09-12'}),
  rule({id:'salary',transaction_type:'receita',category:'Salário',amount:3000,next_date:'2026-09-01'}),
  rule({id:'future-investment',transaction_type:'investimento',category:'Investimentos',amount:200,next_date:'2026-09-22',source_account_id:'cash',asset_id:'asset'})
];

test('contratos permanecem separados: realizado, programado, projetado e previsão',()=>{
  const result=project(octoberRows,octoberRules);
  equal(result.realized.consumptionExpense,120);
  equal(result.scheduled.consumptionExpense,530);
  equal(result.projected.consumptionExpense,1100);
  equal(result.forecast.consumptionExpense,1630,'Previsão continua Programado + Projetado');
  equal(result.realized.income,500);equal(result.forecast.income,3000);
  equal(result.realized.investment,0);equal(result.forecast.investment,450);
});

test('esperado do mês combina realizado e previsão sem redefinir previsão',()=>{
  const result=project(octoberRows,octoberRules);
  equal(result.expected.income,3500);
  equal(result.expected.consumptionExpense,1750);
  equal(result.expected.investment,450);
  equal(result.realized.availableBalanceEffect,380);
  equal(result.forecast.availableBalanceEffect,920);
  equal(result.expected.availableBalanceEffect,1300);
  equal(result.forecast.consumptionExpense,result.scheduled.consumptionExpense+result.projected.consumptionExpense);
});

test('despesa comum realizada aparece somente no realizado',()=>{
  const result=project([octoberRows[0]],[]);
  equal(result.realized.consumptionExpense,120);equal(result.forecast.consumptionExpense,0);equal(result.expected.consumptionExpense,120);
});

test('despesa persistida pendente aparece prospectivamente uma vez',()=>{
  const result=project([octoberRows[1]],[]);
  equal(result.realized.consumptionExpense,0);equal(result.scheduled.consumptionExpense,80);equal(result.expected.consumptionExpense,80);
});

test('cartão usa a competência da fatura e não a data da compra',()=>{
  const october=project([octoberRows[2]],[]);
  const september=projectDashboardPeriod([octoberRows[2]],[],options({month:9,now:'2026-09-15'}));
  equal(october.scheduled.consumptionExpense,300);equal(september.expected.consumptionExpense,0);
  equal(october.byCategory.expected.Conforto,300);
  equal(octoberRows[2].subcategory,'Casa','view-data keeps the canonical subcategory on the source row');
});

test('parcela pertence somente ao mês da respectiva fatura',()=>{
  const rows=octoberRows.filter(row=>String(row.id).startsWith('installment-'));
  const september=projectDashboardPeriod(rows,[],options({month:9,now:'2026-09-15'}));
  const october=project(rows,[]);
  const november=projectDashboardPeriod(rows,[],options({month:11,now:'2026-11-15'}));
  equal(september.expected.consumptionExpense,150);equal(october.expected.consumptionExpense,150);equal(november.expected.consumptionExpense,150);
});

test('aluguel e outra recorrência de despesa entram como projeções virtuais',()=>{
  const result=project([],octoberRules.slice(0,2));
  equal(result.projected.consumptionExpense,1100);equal(result.byCategory.projected['Gastos Fixos'],1100);
});

test('receita recorrente conhecida entra na leitura prospectiva',()=>{
  const result=project([],octoberRules.filter(item=>item.id==='salary'));
  equal(result.projected.income,3000);equal(result.expected.income,3000);equal(result.expected.availableBalanceEffect,3000);
});

test('investimento programado e projetado permanece separado do consumo',()=>{
  const result=project([octoberRows.find(item=>item.id==='scheduled-investment')],[octoberRules.find(item=>item.id==='future-investment')]);
  equal(result.scheduled.investment,250);equal(result.projected.investment,200);equal(result.expected.investment,450);
  equal(result.expected.consumptionExpense,0);equal(result.expected.availableBalanceEffect,-450);
});

test('realizado, programado e projetado coexistem sem apagar categorias',()=>{
  const result=project(octoberRows,octoberRules);
  deep(result.byCategory.expected,{Lazer:120,Conhecimento:230,Conforto:300,'Gastos Fixos':1100});
  equal(result.byCategory.realized.Lazer,120);equal(result.byCategory.forecast.Conhecimento,230);
});

test('cancelado não entra em qualquer agregado',()=>{
  const result=project([octoberRows.find(item=>item.id==='cancelled')],[]);
  equal(result.realized.consumptionExpense,0);equal(result.forecast.consumptionExpense,0);equal(result.expected.consumptionExpense,0);
});

test('pagamento posterior move a mesma ocorrência sem dupla contabilização',()=>{
  const pending=tx({id:'rent-occurrence',amount:1000,status:'pendente',transaction_date:'2026-10-05',category:'Gastos Fixos',recurring_series_id:'rent',recurring_occurrence_date:'2026-10-05'});
  const paid={...pending,status:'realizado'};
  const rent=rule({id:'rent',amount:1000,category:'Gastos Fixos'});
  const before=project([pending],[rent]);
  const after=project([paid],[rent]);
  equal(before.realized.consumptionExpense,0);equal(before.forecast.consumptionExpense,1000);equal(before.expected.consumptionExpense,1000);
  equal(after.realized.consumptionExpense,1000);equal(after.forecast.consumptionExpense,0);equal(after.expected.consumptionExpense,1000);
  equal(before.projected.consumptionExpense,0);equal(after.projected.consumptionExpense,0);
});

test('ocorrência materializada substitui a recorrência virtual equivalente',()=>{
  const materialized=tx({id:'internet-materialized',amount:100,status:'pendente',transaction_date:'2026-10-12',category:'Gastos Fixos',recurring_series_id:'internet',recurring_occurrence_date:'2026-10-12'});
  const internet=rule({id:'internet',amount:100,next_date:'2026-09-12'});
  const result=project([materialized],[internet]);
  equal(result.scheduled.consumptionExpense,100);equal(result.projected.consumptionExpense,0);equal(result.expected.consumptionExpense,100);
});

test('helper de view-data é puro, congelado e não concede nova verdade financeira',()=>{
  const realized={income:10,consumptionExpense:3,investment:2,availableBalanceEffect:5};
  const forecast={income:20,consumptionExpense:4,investment:1,availableBalanceEffect:15};
  const before=JSON.stringify({realized,forecast}),expected=combineFinancialBuckets(realized,forecast);
  deep(expected,{income:30,consumptionExpense:7,investment:3,availableBalanceEffect:20});
  equal(JSON.stringify({realized,forecast}),before);ok(Object.isFrozen(expected));
});

test('entradas completas permanecem imutáveis',()=>{
  const before=JSON.stringify({octoberRows,octoberRules});project(octoberRows,octoberRules);
  equal(JSON.stringify({octoberRows,octoberRules}),before);
});

console.log(`monthly-financial-outlook: ${tests} tests, ${assertions} assertions passed`);
