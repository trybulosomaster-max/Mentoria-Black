'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const adjustments=require('../js/card-billing-financial-adjustments');
const {projectPlanningPeriod}=require('../js/planning-integration');
const {projectDashboardPeriod}=require('../js/dashboard-financial-integration');
const {projectReport}=require('../js/reports-integration');
const health=require('../js/health-integration');
const accounts=require('../js/accounts-networth-integration');

let tests=0,assertions=0;
const equal=(actual,expected,message)=>{assertions++;assert.equal(actual,expected,message)};
const deepEqual=(actual,expected,message)=>{assertions++;assert.deepEqual(actual,expected,message)};
const ok=(actual,message)=>{assertions++;assert.ok(actual,message)};
const test=(name,fn)=>{try{fn();tests++}catch(error){error.message=`${name}: ${error.message}`;throw error}};

const NOW='2026-04-30';
const purchase=(overrides={})=>({id:'purchase',user_id:'user-a',transaction_date:'2026-01-20',purchase_date:'2026-01-10',transaction_type:'despesa',status:'realizado',category:'Gastos Fixos',amount:1000,card_id:'card-a',...overrides});
const credit=(overrides={})=>({credit_entry_id:'credit',operation_id:'operation-credit',user_id:'user-a',transaction_id:'purchase',card_id:'card-a',billing_cycle_id:'cycle-a',effective_date:'2026-03-10',entry_kind:'purchase_credit',amount:200,consumption_expense_delta:-200,category:'Gastos Fixos',...overrides});
const reversal=(overrides={})=>credit({credit_entry_id:'reversal',operation_id:'operation-reversal',effective_date:'2026-04-05',entry_kind:'credit_reversal',consumption_expense_delta:200,...overrides});
const period=(year,month,effects=[],transactions=[],rules=[])=>({
  planning:projectPlanningPeriod(null,transactions,rules,{year,month,now:NOW,cardPurchaseCreditEffects:effects}),
  dashboard:projectDashboardPeriod(transactions,rules,{year,month,now:NOW,cardPurchaseCreditEffects:effects}),
  report:projectReport(transactions,rules,{year,month,periodMode:'month',now:NOW,states:['realizado'],cardPurchaseCreditEffects:effects})
});

test('normaliza créditos e reversões como ajustes explícitos, nunca settlements ou transações falsas',()=>{
  const source=[credit(),reversal()],before=JSON.stringify(source);
  const result=adjustments.normalizeCardPurchaseCreditEffects(source,{now:NOW});
  equal(result.adjustments.length,2);equal(result.excludedCount,0);equal(result.warnings.length,0);
  deepEqual(result.adjustments.map(row=>row.consumptionDelta),[-200,200]);
  ok(result.adjustments.every(row=>row.kind==='card_purchase_credit_adjustment'&&row.readOnly===true));
  ok(result.adjustments.every(row=>!Object.hasOwn(row,'transaction_type')&&!Object.hasOwn(row,'accountDelta')));
  equal(JSON.stringify(source),before);
});

test('dedupe usa tanto entry id quanto operation id e não duplica economia',()=>{
  const result=adjustments.normalizeCardPurchaseCreditEffects([
    credit(),
    credit({operation_id:'other-operation'}),
    credit({credit_entry_id:'other-entry'}),
    reversal()
  ],{now:NOW});
  equal(result.adjustments.length,2);equal(result.excludedCount,2);
  equal(result.warnings.filter(item=>item.startsWith('duplicate_card_credit_effect:')).length,2);
  equal(result.adjustments.reduce((sum,row)=>sum+row.consumptionDelta,0),0);
});

test('falha fechada para kind, valor, data, sinal, futuro e identidade inválidos',()=>{
  const invalid=[
    credit({credit_entry_id:'kind',operation_id:'kind-op',entry_kind:'payment'}),
    credit({credit_entry_id:'negative',operation_id:'negative-op',amount:-1,consumption_expense_delta:1}),
    credit({credit_entry_id:'nan',operation_id:'nan-op',amount:'NaN'}),
    credit({credit_entry_id:'date',operation_id:'date-op',effective_date:'2026-02-30'}),
    credit({credit_entry_id:'sign',operation_id:'sign-op',consumption_expense_delta:200}),
    credit({credit_entry_id:'future',operation_id:'future-op',effective_date:'2026-05-01'}),
    credit({credit_entry_id:null,operation_id:null})
  ];
  const result=adjustments.normalizeCardPurchaseCreditEffects(invalid,{now:NOW});
  equal(result.adjustments.length,0);equal(result.excludedCount,invalid.length);
  for(const prefix of ['invalid_card_credit_entry_kind:','invalid_card_credit_amount:','invalid_card_credit_effective_date:','card_credit_delta_mismatch:','future_card_credit_effect:','missing_card_credit_identity:'])ok(result.warnings.some(item=>item.startsWith(prefix)),prefix);
});

test('data de referência inválida exclui tudo sem usar relógio implícito',()=>{
  const result=adjustments.normalizeCardPurchaseCreditEffects([credit()],{});
  equal(result.adjustments.length,0);equal(result.excludedCount,1);deepEqual(result.warnings,['invalid_card_credit_reference_date']);
});

test('módulo compartilhado funciona em browser sem CommonJS',()=>{
  const context={};context.globalThis=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js','card-billing-financial-adjustments.js'),'utf8'),context);
  equal(typeof context.MBCardBillingFinancialAdjustmentsV1.normalizeCardPurchaseCreditEffects,'function');
});

test('compra de janeiro, crédito de março e reversão de abril preservam seus períodos',()=>{
  const effects=[credit(),reversal()],january=period(2026,1,effects,[purchase()]),march=period(2026,3,effects),april=period(2026,4,effects);
  for(const projection of [january.planning.realized.totalOut,january.dashboard.realized.consumptionExpense,january.report.totals.consumptionExpense])equal(projection,1000);
  for(const projection of [march.planning.realized.totalOut,march.dashboard.realized.consumptionExpense,march.report.totals.consumptionExpense])equal(projection,-200);
  for(const projection of [april.planning.realized.totalOut,april.dashboard.realized.consumptionExpense,april.report.totals.consumptionExpense])equal(projection,200);
  equal(march.report.rows.length,1);equal(march.report.rows[0].readOnly,true);equal(march.report.rows[0].kind,'card_purchase_credit_adjustment');equal(march.report.rows[0].amount,200);equal(march.report.rows[0].consumptionDelta,-200);
});

test('crédito no mesmo mês reduz realizado exatamente uma vez em Planning, Dashboard e Reports',()=>{
  const effect=credit({effective_date:'2026-03-10'}),transaction=purchase({transaction_date:'2026-03-01'}),result=period(2026,3,[effect,effect],[transaction]);
  equal(result.planning.realized.totalOut,800);equal(result.dashboard.realized.consumptionExpense,800);equal(result.report.totals.consumptionExpense,800);
  equal(result.planning.realized.consumptionByCategory['Gastos Fixos'],800);equal(result.report.totals.byCategory['Gastos Fixos'],800);
  equal(result.planning.details.cardPurchaseCreditAdjustments.length,1);equal(result.report.rows.filter(row=>row.kind==='card_purchase_credit_adjustment').length,1);
  ok(result.planning.warnings.some(item=>item.startsWith('duplicate_card_credit_effect:')));
});

test('ajustes alteram só realizado; programado, projetado e previsão ficam intactos',()=>{
  const pending=purchase({id:'pending',transaction_date:'2026-03-20',status:'programado',amount:300});
  const rule={id:'rule',transaction_type:'despesa',category:'Lazer',amount:400,frequency:'monthly',interval:1,next_date:'2026-03-25',active:true};
  const without=projectPlanningPeriod(null,[pending],[rule],{year:2026,month:3,now:NOW});
  const withCredit=projectPlanningPeriod(null,[pending],[rule],{year:2026,month:3,now:NOW,cardPurchaseCreditEffects:[credit()]});
  equal(withCredit.realized.totalOut,-200);
  equal(withCredit.scheduledMaterialized.totalOut,without.scheduledMaterialized.totalOut);
  equal(withCredit.projectedVirtual.totalOut,without.projectedVirtual.totalOut);
  equal(withCredit.forecast.totalOut,without.forecast.totalOut);
});

test('filtros de Reports selecionam ajuste explícito por cartão e categoria',()=>{
  const visible=projectReport([],[],{now:NOW,periodMode:'month',year:2026,month:3,states:['realizado'],types:['despesa'],cardId:'card-a',category:'Gastos Fixos',cardPurchaseCreditEffects:[credit()]});
  equal(visible.rows.length,1);equal(visible.totals.consumptionExpense,-200);
  const hidden=projectReport([],[],{now:NOW,periodMode:'month',year:2026,month:3,states:['realizado'],cardId:'card-b',cardPurchaseCreditEffects:[credit()]});
  equal(hidden.rows.length,0);equal(hidden.totals.consumptionExpense,0);
});

test('Saúde reutiliza realizado ajustado sem alterar pesos ou fórmula',()=>{
  const result=health.healthScore({
    plan:{fixed_expenses:900},transactions:[purchase({transaction_date:'2026-03-01'})],rules:[],goalsData:[],
    reserve:{balance:0,target:0,coverage:0,months:6},year:2026,month:3,now:NOW,cardPurchaseCreditEffects:[credit()]
  });
  equal(result.t.consumptionExpense,800);equal(result.budgetScore,100);
  deepEqual(health.WEIGHTS,{budget:.25,investment:.25,reserve:.20,commitment:.15,goals:.15});
});

test('posição por conta exige snapshot e bloqueia pedido anterior à base',()=>{
  const result=accounts.projectAccountPositionsAsOf([
    {id:'missing',statement_balance:5000},
    {id:'historical',statement_balance:5000,balance_as_of:'2026-08-20'}
  ],[],{asOf:'2026-08-19'});
  equal(result.accounts[0].status,'BALANCE_SNAPSHOT_REQUIRED');equal(result.accounts[0].projectedBalance,null);
  equal(result.accounts[1].status,'HISTORICAL_POSITION_UNAVAILABLE');equal(result.accounts[1].projectedBalance,null);equal(result.valid,false);
});

test('balance_as_of é snapshot inclusivo de fim do dia',()=>{
  const account=[{id:'cash',user_id:'user-a',statement_balance:5000,balance_as_of:'2026-08-20'}];
  const transaction=purchase({id:'cash-income',transaction_date:'2026-08-20',transaction_type:'receita',amount:100,account_id:'cash',card_id:null});
  const settlement={settlement_id:'same-day',operation_id:'same-day-op',user_id:'user-a',account_id:'cash',effective_date:'2026-08-20',account_delta:-1000,consumption_expense_delta:0};
  const result=accounts.projectAccountPositionsAsOf(account,[transaction],{asOf:'2026-08-20',settlementEffects:[settlement]});
  equal(result.accounts[0].projectedBalance,5000);equal(result.accounts[0].movementDelta,0);equal(result.accounts[0].settlementDelta,0);equal(result.appliedSettlements,0);
});

test('movimentos canônicos e settlements aplicam somente em (balance_as_of, asOf]',()=>{
  const account=[{id:'cash',user_id:'user-a',statement_balance:5000,balance_as_of:'2026-08-20'}];
  const rows=[
    purchase({id:'before',transaction_date:'2026-08-19',transaction_type:'receita',amount:999,account_id:'cash',card_id:null}),
    purchase({id:'after',transaction_date:'2026-08-21',transaction_type:'receita',amount:100,account_id:'cash',card_id:null})
  ];
  const settlements=[
    {settlement_id:'settlement',operation_id:'settlement-op',user_id:'user-a',account_id:'cash',effective_date:'2026-08-25',account_delta:-1000,consumption_expense_delta:0},
    {settlement_id:'future',operation_id:'future-settlement-op',user_id:'user-a',account_id:'cash',effective_date:'2026-08-26',account_delta:-50,consumption_expense_delta:0}
  ];
  const result=accounts.projectAccountPositionsAsOf(account,rows,{asOf:'2026-08-25',settlementEffects:settlements});
  equal(result.accounts[0].projectedBalance,4100);equal(result.accounts[0].movementDelta,100);equal(result.accounts[0].settlementDelta,-1000);
  equal(result.appliedMovementLegs,1);equal(result.appliedSettlements,1);ok(result.warnings.includes('future_card_settlement_effect:future'));
});

test('múltiplos usuários e contas não aceitam settlement ou movimento cross-user',()=>{
  const accountRows=[
    {id:'a',user_id:'user-a',statement_balance:1000,balance_as_of:'2026-08-01'},
    {id:'b',user_id:'user-b',statement_balance:2000,balance_as_of:'2026-08-01'}
  ];
  const rows=[
    purchase({id:'income-a',user_id:'user-a',transaction_date:'2026-08-02',transaction_type:'receita',amount:100,account_id:'a',card_id:null}),
    purchase({id:'cross-transfer',user_id:'user-a',transaction_date:'2026-08-03',transaction_type:'transferencia',amount:500,source_account_id:'a',destination_account_id:'b',account_id:null,card_id:null})
  ];
  const settlements=[
    {settlement_id:'settle-b',operation_id:'settle-b-op',user_id:'user-b',account_id:'b',effective_date:'2026-08-04',account_delta:-300,consumption_expense_delta:0},
    {settlement_id:'spoof-settle',operation_id:'spoof-settle-op',user_id:'user-b',account_id:'a',effective_date:'2026-08-04',account_delta:-900,consumption_expense_delta:0}
  ];
  const result=accounts.projectAccountPositionsAsOf(accountRows,rows,{asOf:'2026-08-05',settlementEffects:settlements});
  equal(result.accounts[0].projectedBalance,1100);equal(result.accounts[1].projectedBalance,1700);equal(result.valid,false);
  ok(result.warnings.includes('cross_user_transaction:cross-transfer'));ok(result.warnings.includes('cross_user_settlement:spoof-settle'));
});

test('settlement inválido, não neutro e duplicado falha fechado',()=>{
  const account=[{id:'cash',statement_balance:5000,balance_as_of:'2026-08-20'}];
  const base={settlement_id:'entry',operation_id:'op',account_id:'cash',effective_date:'2026-08-25',account_delta:-1000,consumption_expense_delta:0};
  const result=accounts.projectAccountPositionsAsOf(account,[],{asOf:'2026-08-25',settlementEffects:[base,{...base,settlement_id:'duplicate'},{...base,settlement_id:'expense',operation_id:'expense-op',consumption_expense_delta:1000}]});
  equal(result.accounts[0].projectedBalance,4000);equal(result.appliedSettlements,1);equal(result.skippedSettlements,2);
  ok(result.warnings.includes('duplicate_card_settlement_effect:duplicate'));ok(result.warnings.includes('card_settlement_must_be_consumption_neutral:expense'));
});

test('reversão de settlement restaura a conta sem efeito de consumo',()=>{
  const account=[{id:'cash',statement_balance:5000,balance_as_of:'2026-08-20'}];
  const effects=[
    {settlement_id:'payment',operation_id:'payment-op',account_id:'cash',effective_date:'2026-08-25',direction:'decrease',amount:1000,account_delta:-1000,consumption_expense_delta:0},
    {settlement_id:'reversal',operation_id:'reversal-op',account_id:'cash',effective_date:'2026-08-26',direction:'increase',amount:1000,account_delta:1000,consumption_expense_delta:0}
  ];
  const result=accounts.projectAccountPositionsAsOf(account,[],{asOf:'2026-08-26',settlementEffects:effects});
  equal(result.accounts[0].projectedBalance,5000);equal(result.accounts[0].settlementDelta,0);equal(result.appliedSettlements,2);equal(result.valid,true);
  const drift=accounts.projectAccountPositionsAsOf(account,[],{asOf:'2026-08-26',settlementEffects:[{...effects[0],settlement_id:'drift',operation_id:'drift-op',direction:'increase'}]});
  equal(drift.accounts[0].projectedBalance,5000);equal(drift.appliedSettlements,0);ok(drift.warnings.includes('card_settlement_direction_mismatch:drift'));equal(drift.valid,false);
});

test('golden accounting: pagamento reduz conta sem duplicar despesa',()=>{
  const transaction=purchase({transaction_date:'2026-04-20'});
  const settlement={settlement_id:'golden-settlement',operation_id:'golden-operation',user_id:'user-a',account_id:'cash',effective_date:'2026-04-25',account_delta:-1000,consumption_expense_delta:0};
  const position=accounts.projectAccountPositionsAsOf([{id:'cash',user_id:'user-a',statement_balance:5000,balance_as_of:'2026-04-20'}],[transaction],{asOf:'2026-04-25',settlementEffects:[settlement]});
  equal(position.accounts[0].projectedBalance,4000);
  const projection=period(2026,4,[],[transaction]);
  equal(projection.planning.realized.totalOut,1000);equal(projection.dashboard.realized.consumptionExpense,1000);equal(projection.report.totals.consumptionExpense,1000);
});

console.log(`card-billing-financial-adjustments: ${tests} tests, ${assertions} assertions passed`);
