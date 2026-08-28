'use strict';

const assert=require('node:assert/strict');
const cards=require('../js/cards-view-data');
const {financialEffect}=require('../js/financial-core');

let tests=0,assertions=0;
const equal=(actual,expected,message)=>{assertions+=1;assert.equal(actual,expected,message)};
const ok=(value,message)=>{assertions+=1;assert.ok(value,message)};
const test=(name,fn)=>{fn();tests+=1};
const NOW='2026-08-27';
const card=(overrides={})=>({id:'card-a',name:'Cartão A',limit:1000,closing_day:22,due_day:30,...overrides});
const tx=(overrides={})=>({id:'tx',card_id:'card-a',transaction_type:'despesa',category:'Lazer',amount:100,status:'pendente',transaction_date:'2026-08-30',...overrides});
const rule=(overrides={})=>({id:'rule',card_id:'card-a',transaction_type:'despesa',category:'Gastos Fixos',amount:50,frequency:'monthly',interval:1,next_date:'2026-08-28',active:true,...overrides});
const project=(cardRows=[card()],transactions=[],rules=[],overrides={})=>cards.cardPeriodView(cardRows,transactions,rules,{year:2026,month:8,now:NOW,...overrides});

test('cartão com e sem limite preserva somente o dado cadastrado',()=>{
  const view=project([card(),card({id:'card-b',limit:null})]);equal(view.rows[0].limit,1000);equal(view.rows[0].limitKnown,true);equal(view.rows[1].limit,null);equal(view.contracts.availableLimit,'BACKEND_REQUIRED');
});
test('gate formal impede fatura, pagamento e limite reais sem persistência',()=>{
  const contract=project().contracts;
  equal(contract.gate,'REVIEW_REQUIRED');
  equal(contract.invoiceMembership,'DERIVED_FROM_TRANSACTION_DATE');
  equal(contract.invoiceLifecycle,'PERSISTED_INVOICE_REQUIRED');
  equal(contract.invoicePayment,'CARD_PAYMENT_CONTRACT_REQUIRED');
  equal(contract.availableLimit,'BACKEND_REQUIRED');
  equal(contract.installmentSeries,'STRUCTURED_INSTALLMENT_SERIES_REQUIRED');
  equal(contract.cardReversal,'CARD_REVERSAL_CONTRACT_REQUIRED');
});
test('cartão sem compras permanece zerado',()=>{const view=project();equal(view.totals.expected,0);equal(view.rows[0].items.length,0)});
test('compra à vista realizada entra apenas no realizado',()=>{const view=project([card()],[tx({status:'realizado',transaction_date:'2026-08-20'})]);equal(view.totals.realized,100);equal(view.totals.scheduled,0);equal(view.totals.expected,100)});
test('compra pendente usa transaction_date como competência',()=>{const row=tx({purchase_date:'2026-07-10'});equal(project([card()],[row]).totals.scheduled,100);equal(project([card()],[row],[],{month:7}).totals.expected,0)});
test('antes, no dia e depois do fechamento não substituem a competência persistida',()=>{
  const rows=[21,22,23].map((day,index)=>tx({id:`cycle-${index}`,amount:10,purchase_date:`2026-08-${day}`,transaction_date:'2026-09-30'}));
  equal(project([card()],rows).totals.expected,0);
  equal(project([card()],rows,[],{month:9}).totals.expected,30);
});
test('parcela de outro mês não contamina o período e fica no compromisso futuro',()=>{const rows=[tx({id:'p1',note:'Parcelado 1/2 • Compra 2026-07-25'}),tx({id:'p2',transaction_date:'2026-09-30',note:'Parcelado 2/2 • Compra 2026-07-25'})],view=project([card()],rows);equal(view.totals.expected,100);equal(view.rows[0].future.total,100);equal(view.rows[0].future.lastDate,'2026-09-30')});
test('parser de parcelas expõe progresso sem alterar os lançamentos',()=>{const parsed=cards.parseInstallment(tx({note:'Parcelado 2/4 • Compra 2026-07-25'}));assert.deepEqual(parsed,{current:2,total:4,remaining:2,purchaseDate:'2026-07-25'});assertions+=1});
test('série estruturada tem identidade sem inferir descrição',()=>{equal(cards.installmentSeriesKey(tx({installment_series_id:'series-a',installment_number:2,note:''})),'structured:series-a')});
test('virada do ano preserva uma parcela por competência',()=>{
  const rows=[tx({id:'dec',transaction_date:'2026-12-30',note:'Parcelado 1/2 • Compra 2026-11-20'}),tx({id:'jan',transaction_date:'2027-01-30',note:'Parcelado 2/2 • Compra 2026-11-20'})];
  equal(project([card()],rows,[],{year:2026,month:12,now:'2026-12-15'}).totals.expected,100);
  equal(project([card()],rows,[],{year:2027,month:1,now:'2027-01-15'}).totals.expected,100);
});
test('cancelado nunca entra',()=>{equal(project([card()],[tx({status:'cancelado'})]).totals.expected,0)});
test('recorrência de cartão aparece como projetado',()=>{const view=project([card()],[],[rule()]);equal(view.totals.projected,50);equal(view.totals.expected,50)});
test('materialização substitui projeção recorrente equivalente',()=>{const materialized=tx({amount:50,recurring_series_id:'rule',recurring_occurrence_date:'2026-08-28',transaction_date:'2026-08-28'}),view=project([card()],[materialized],[rule()]);equal(view.totals.scheduled,50);equal(view.totals.projected,0);equal(view.totals.expected,50)});
test('dois cartões permanecem separados e consolidam sem duplicar',()=>{const view=project([card(),card({id:'card-b',name:'B',limit:500})],[tx(),tx({id:'b',card_id:'card-b',amount:70})]);equal(view.rows[0].totals.expected,100);equal(view.rows[1].totals.expected,70);equal(view.totals.expected,170);equal(view.totalRegisteredLimit,1500)});
test('valor acima do limite é visível sem inventar bloqueio ou saldo de fatura',()=>{const view=project([card({limit:80})],[tx({amount:100})]);ok(view.rows[0].totals.expected>view.rows[0].limit);equal(view.contracts.invoiceBalance,'PENDENTE_DE_CONTRATO')});
test('limite zero não é apresentado como disponibilidade conhecida',()=>{const row=project([card({limit:0})]).rows[0];equal(row.limit,null);equal(row.limitKnown,false)});
test('fechamento alterado não reclassifica transação histórica',()=>{
  const row=tx({transaction_date:'2026-08-30',purchase_date:'2026-08-22'});
  equal(project([card({closing_day:10})],[row]).totals.expected,100);
  equal(project([card({closing_day:25})],[row]).totals.expected,100);
});
test('vencida, parcial e paga continuam indisponíveis sem liquidação agregada',()=>{
  const contract=project().contracts;
  for(const state of ['OPEN','CLOSED','DUE','PARTIALLY_PAID','PAID','OVERDUE'])equal(contract.invoiceStates[state],'BACKEND_REQUIRED');
});
test('liquidação futura deve ser neutra e não duplicar despesa econômica',()=>{
  const purchase=financialEffect({transaction_type:'despesa',amount:100,status:'realizado',transaction_date:'2026-08-20',card_id:'card-a'},{now:'2026-08-27'});
  const settlement=financialEffect({transaction_type:'transferencia',amount:100,status:'realizado',transaction_date:'2026-08-20',source_account_id:'cash',destination_account_id:'clearing'},{now:'2026-08-27'});
  equal(purchase.consumptionExpenseAmount,100);
  equal(settlement.consumptionExpenseAmount,0);
  equal(purchase.consumptionExpenseAmount+settlement.consumptionExpenseAmount,100);
});
test('comparação mensal usa a mesma competência',()=>{const rows=[tx({id:'jul',amount:80,transaction_date:'2026-07-30'}),tx({id:'ago',amount:100})],view=project([card()],rows);equal(view.rows[0].previous.expected,80);equal(view.rows[0].delta,20);equal(view.rows[0].deltaPercent,25)});
test('entradas não são mutadas',()=>{const input={cards:[card()],transactions:[tx()],rules:[rule()]},before=JSON.stringify(input);project(input.cards,input.transactions,input.rules);equal(JSON.stringify(input),before)});

console.log(`cards-v2: ${tests} tests, ${assertions} assertions passed`);
