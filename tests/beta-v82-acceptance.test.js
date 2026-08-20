'use strict';
const assert=require('assert');
const fixture=require('./fixtures-beta-v82');
const goals=require('../js/goals-integration');
const planning=require('../js/planning-integration');
const reports=require('../js/reports-integration');
const dashboard=require('../js/dashboard-financial-integration');
const health=require('../js/health-integration');
const accounts=require('../js/accounts-networth-integration');
const core=require('../js/financial-core');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
function test(_name,fn){fn();tests++}
const rowsA=fixture.transactions.filter(row=>row.user_id===fixture.ids.userA),rulesA=fixture.recurring.filter(row=>row.user_id===fixture.ids.userA);
const goal=name=>fixture.goals.find(row=>row.name===name);
const view=name=>goals.goalViewModel(goal(name),rowsA,rulesA,{now:fixture.now,maxOccurrences:1000});

test('usuário novo permanece em estado sem dados',()=>{
  const reserve=health.reserveSnapshot([],{targetMode:'custom',customTarget:0},0),score=health.healthScore({plan:null,transactions:[],rules:[],goalsData:[],reserve,year:2026,month:8,now:fixture.now});
  equal(score.score,null);equal(score.evaluable,false);equal(score.evaluatedComponents,0);ok(score.message.includes('sem dados suficientes'));
});

test('fixtures A e B são integralmente separadas',()=>{
  ok(fixture.users.every(user=>user.email.endsWith('.invalid')));ok(rowsA.length>0);ok(fixture.transactions.some(row=>row.user_id===fixture.ids.userB));
  ok(!rowsA.some(row=>row.user_id===fixture.ids.userB));ok(!fixture.accounts.filter(row=>row.user_id===fixture.ids.userA).some(row=>row.id===fixture.ids.checkingB));
});

test('legado desconhecido não altera realizado',()=>{
  const result=dashboard.projectDashboardPeriod([{id:'legacy',transaction_date:'2026-08-01',status:'mystery',transaction_type:'receita',amount:999}],[],{year:2026,month:8,now:fixture.now});
  equal(result.realized.income,0);equal(result.unclassified.length,1);ok(result.warnings.some(warning=>warning.startsWith('unclassified_transaction')));
});

test('Casamento 2031 separa realizado, programado e virtual',()=>{
  const result=view('Casamento');
  equal(result.realized,1100);equal(result.programmed,6600);equal(result.projected,27500);equal(result.projectedCovered,35200);equal(result.remainingReal,48900);equal(result.remainingUnplanned,14800);
  equal(result.estimatedCompletionDate,null);equal(result.onTrack,false);equal(result.projectedOccurrences.length,50);equal(result.projectedOccurrences[0].occurrenceDate,'2027-09-01');equal(result.projectedOccurrences.at(-1).occurrenceDate,'2031-10-01');
});

test('Casamento não duplica as doze materializações',()=>{
  const result=view('Casamento'),keys=new Set(result.projectedOccurrences.map(item=>item.key));
  equal(keys.size,result.projectedOccurrences.length);ok(!result.projectedOccurrences.some(item=>item.occurrenceDate<='2027-08-01'));equal(result.scheduledTransactions.length,12);
});

test('Viagem JP tem cobertura e conclusão antes do prazo',()=>{
  const result=view('Viagem JP');
  equal(result.realized,550);equal(result.programmed,3300);equal(result.projected,9900);equal(result.projectedCovered,13750);equal(result.remainingUnplanned,0);equal(result.estimatedCompletionDate,'2027-10-01');equal(result.onTrack,true);equal(result.status,'ahead');
});

test('Viagem sem deadline não inventa horizonte longo',()=>{
  const result=view('Viagem sem prazo');
  equal(result.deadline,null);equal(result.projected,0);equal(result.programmed,0);equal(result.projectedOccurrences.length,0);equal(result.estimatedCompletionDate,null);equal(result.status,'no_forecast');
});

test('recorrência materializada prevalece sobre virtual',()=>{
  const result=view('Viagem JP');
  equal(result.scheduledTransactions.length,6);equal(result.projectedOccurrences[0].occurrenceDate,'2027-03-01');ok(!result.projectedOccurrences.some(item=>item.occurrenceDate<='2027-02-01'));
});

test('parcelamento preserva compra legítima e remove duplicata real',()=>{
  const base={transaction_date:'2026-08-15',purchase_date:'2026-07-02',status:'realizado',transaction_type:'despesa',category:'Conforto',amount:100,description:'Compra Beta',account_id:fixture.ids.checkingA,note:'Parcelado 1/2 • Compra 2026-07-02'};
  const rows=[{...base,id:'parcel-1'},{...base,id:'parcel-duplicate'},{...base,id:'parcel-other',purchase_date:'2026-07-03',note:'Parcelado 1/2 • Compra 2026-07-03'}];
  const result=planning.projectPlanningPeriod(null,rows,[],{year:2026,month:8,now:fixture.now});
  equal(result.realized.consumptionByCategory.Conforto,200);ok(result.warnings.some(warning=>warning.startsWith('duplicate_installment')));
});

test('Planejamento sintético mantém cinco conjuntos separados',()=>{
  const result=planning.projectPlanningPeriod(fixture.monthly,rowsA,rulesA,{year:2026,month:8,now:fixture.now});
  equal(result.planned.revenue,8000);equal(result.realized.income,8000);equal(result.realized.consumptionByCategory['Gastos Fixos'],1200);equal(result.realized.consumptionByCategory.Conforto,250);equal(result.realized.investment,1600);equal(result.scheduledMaterialized.totalOut,0);equal(result.projectedVirtual.totalOut,0);equal(result.forecast.totalOut,0);
});

test('Relatórios respeitam usuário, período e estado explícito',()=>{
  const result=reports.projectReport(rowsA,rulesA,{now:fixture.now,periodMode:'month',year:2026,month:8,states:['realizado']});
  ok(result.rows.length>0);ok(result.rows.every(row=>row.user_id===fixture.ids.userA));ok(result.rows.every(row=>row.state==='efetivado'));equal(result.totals.income,8000);equal(result.totals.consumptionExpense,1450);equal(result.totals.investment,1600);
});

test('Dashboard financeiro coincide com Planejamento',()=>{
  const plan=planning.projectPlanningPeriod(fixture.monthly,rowsA,rulesA,{year:2026,month:8,now:fixture.now}),dash=dashboard.projectDashboardPeriod(rowsA,rulesA,{year:2026,month:8,now:fixture.now});
  equal(dash.realized.income,plan.realized.income);equal(dash.realized.consumptionExpense,Object.values(plan.realized.consumptionByCategory).reduce((sum,value)=>sum+value,0));equal(dash.realized.investment,plan.realized.investment);equal(dash.forecast.availableBalanceEffect,plan.forecast.income-plan.forecast.totalOut);
});

test('Reserva usa apenas ledger sintético explícito',()=>{
  const result=health.reserveSnapshot(fixture.reserveLedger,fixture.reserveSettings,1200);
  equal(result.balance,2500);equal(result.target,12000);equal(result.remaining,9500);ok(Math.abs(result.coverage-2500/1200)<1e-12);
});

test('Saúde usa componentes avaliáveis da fixture',()=>{
  const reserve=health.reserveSnapshot(fixture.reserveLedger,fixture.reserveSettings,1200),result=health.healthScore({plan:fixture.monthly[0],transactions:rowsA,rules:rulesA,goalsData:fixture.goals,reserve,year:2026,month:8,now:fixture.now});
  equal(result.evaluable,true);equal(result.partial,false);equal(result.evaluatedComponents,5);ok(Number.isInteger(result.score));ok(result.score>=0&&result.score<=100);
});

test('Contas e patrimônio permanecem reconstruíveis sem futuros',()=>{
  const result=accounts.projectAccountBalances(fixture.accounts.filter(row=>row.user_id===fixture.ids.userA),rowsA,{assets:fixture.assets,liabilities:fixture.liabilities,now:fixture.now});
  const checking=result.accounts.find(row=>row.id===fixture.ids.checkingA),asset=result.assets.find(row=>row.id===fixture.ids.assetA);
  equal(checking.projectedBalance,14400);equal(asset.projectedValue,5150);equal(result.netWorth.netWorth,21550);equal(result.appliedMovements,7);ok(result.skippedMovements>=18);
});

test('Transferência é neutra e estruturalmente completa',()=>{
  const result=core.financialEffect({transaction_type:'transferencia',status:'realizado',transaction_date:'2026-08-10',amount:300,source_account_id:fixture.ids.checkingA,destination_account_id:fixture.ids.savingsA},{now:fixture.now});
  equal(result.sourceAccountDelta,-300);equal(result.destinationAccountDelta,300);equal(result.availableBalanceDelta,0);equal(result.netWorthDelta,0);equal(result.valid,true);
});

test('Investimento é neutro no patrimônio e separado do consumo',()=>{
  const result=core.financialEffect({transaction_type:'investimento',status:'realizado',transaction_date:'2026-08-10',amount:500,source_account_id:fixture.ids.checkingA,asset_id:fixture.ids.assetA},{now:fixture.now});
  equal(result.availableBalanceDelta,-500);equal(result.assetDelta,500);equal(result.netWorthDelta,0);equal(result.consumptionExpenseAmount,0);equal(result.investmentAmount,500);
});

test('Resgate não é receita e permanece neutro no patrimônio',()=>{
  const result=core.financialEffect({transaction_type:'resgate',status:'realizado',transaction_date:'2026-08-10',amount:250,destination_account_id:fixture.ids.checkingA,asset_id:fixture.ids.assetA},{now:fixture.now});
  equal(result.availableBalanceDelta,250);equal(result.assetDelta,-250);equal(result.netWorthDelta,0);equal(result.incomeAmount,0);equal(result.rescueAmount,250);
});

console.log(`beta-v82-acceptance: ${tests} tests, ${assertions} assertions passed`);
