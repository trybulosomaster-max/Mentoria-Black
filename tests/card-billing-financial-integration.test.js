'use strict';

const assert=require('node:assert/strict');
const {financialEffect}=require('../js/financial-core');
const {projectDashboardPeriod}=require('../js/dashboard-financial-integration');
const {projectPlanningPeriod}=require('../js/planning-integration');
const {projectReport}=require('../js/reports-integration');
const {projectAccountBalances}=require('../js/accounts-networth-integration');

let tests=0,assertions=0;
const equal=(actual,expected,message)=>{assertions++;assert.equal(actual,expected,message)};
const test=(name,fn)=>{fn();tests++};
const now='2026-08-20';
const purchase={id:'golden-purchase',transaction_date:'2026-08-20',purchase_date:'2026-08-10',description:'Compra sintética',category:'Gastos Fixos',amount:1000,card_id:'synthetic-card',transaction_type:'despesa',status:'realizado'};
const settlementEffect={effective_date:'2026-08-25',account_id:'synthetic-account',billing_cycle_id:'synthetic-cycle-liability',amount:1000,account_delta:-1000,consumption_expense_delta:0};
const settlementAdjustments=[
  {
    entityType:'account',entityId:settlementEffect.account_id,
    amount:Math.abs(settlementEffect.account_delta),
    direction:settlementEffect.account_delta<0?'decrease':'increase'
  },
  {
    entityType:'liability',entityId:settlementEffect.billing_cycle_id,
    amount:settlementEffect.amount,direction:'decrease'
  }
];

test('teste econômico de ouro reduz a conta sem criar segunda despesa',()=>{
  const effect=financialEffect(purchase,{now});
  const before=projectAccountBalances(
    [{id:'synthetic-account',opening_balance:5000}],[],
    {now,liabilities:[{id:'synthetic-cycle-liability',balance:1000}]}
  );
  const after=projectAccountBalances(
    [{id:'synthetic-account',opening_balance:5000}],[],
    {now,liabilities:[{id:'synthetic-cycle-liability',balance:1000}],adjustments:settlementAdjustments}
  );
  equal(effect.consumptionExpenseAmount,1000);
  equal(before.accounts[0].projectedBalance,5000);
  equal(before.liabilities[0].projectedBalance,1000);
  equal(before.netWorth.netWorth,4000);
  equal(after.accounts[0].projectedBalance,4000);
  equal(after.liabilities[0].projectedBalance,0);
  equal(after.adjustmentsApplied,2);
  equal(after.netWorth.netWorth,4000);
  equal(effect.consumptionExpenseAmount+settlementEffect.consumption_expense_delta,1000);
});

test('Dashboard continua consumindo somente a compra econômica canônica',()=>{
  const result=projectDashboardPeriod([purchase],[],{year:2026,month:8,now});
  equal(result.realized.consumptionExpense,1000);
  equal(result.realized.income,0);
  equal(result.realized.investment,0);
});

test('Planejamento não recebe settlement como segunda saída',()=>{
  const result=projectPlanningPeriod(null,[purchase],[],{year:2026,month:8,now});
  equal(result.realized.consumptionByCategory['Gastos Fixos'],1000);
  equal(result.realized.totalOut,1000);
});

test('Relatórios preservam uma única despesa econômica',()=>{
  const result=projectReport([purchase],[],{now,periodMode:'month',year:2026,month:8,states:['realizado']});
  equal(result.totals.consumptionExpense,1000);
  equal(result.rows.length,1);
});

test('settlement não é forjado como transaction_type de despesa',()=>{
  equal(Object.hasOwn(settlementEffect,'transaction_type'),false);
  equal(settlementEffect.consumption_expense_delta,0);
});

test('crédito e reversão preservam janeiro e reconhecem março/abril',()=>{
  const januaryPurchase={...purchase,transaction_date:'2026-01-20'};
  const marchCredit={effective_date:'2026-03-10',consumption_expense_delta:-200,liability_delta:-200};
  const aprilReversal={effective_date:'2026-04-05',consumption_expense_delta:200,liability_delta:200};
  equal(januaryPurchase.transaction_date,'2026-01-20');
  equal(marchCredit.effective_date,'2026-03-10');
  equal(aprilReversal.effective_date,'2026-04-05');
  equal(financialEffect(januaryPurchase,{now:'2026-04-30'}).consumptionExpenseAmount,1000);
  equal(1000+marchCredit.consumption_expense_delta+aprilReversal.consumption_expense_delta,1000);
  equal(1000+marchCredit.liability_delta+aprilReversal.liability_delta,1000);
});

console.log(`card-billing-financial-integration: ${tests} tests, ${assertions} assertions passed`);
