'use strict';

const assert=require('node:assert/strict');
const cards=require('../js/cards-view-data');
const {financialEffect}=require('../js/financial-core');

let tests=0,assertions=0;
const equal=(actual,expected,message)=>{assertions+=1;assert.equal(actual,expected,message)};
const ok=(value,message)=>{assertions+=1;assert.ok(value,message)};
const deep=(actual,expected,message)=>{assertions+=1;assert.deepEqual(actual,expected,message)};
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
test('parcela estruturada prevalece sobre texto legado e preserva a compra',()=>{
  deep(cards.parseInstallment(tx({installment_number:3,installment_total:8,purchase_date:'2026-07-19',note:'Parcelado 1/2 • Compra 2020-01-01'})),{
    current:3,total:8,remaining:5,purchaseDate:'2026-07-19'
  });
  deep(cards.parseInstallment(tx({installment_number:null,installment_total:null,note:'Parcelado 1/2 • Compra 2026-07-25'})),{
    current:1,total:2,remaining:1,purchaseDate:'2026-07-25'
  });
});
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

test('status de billing separa liquidação, compromisso conhecido e exclusão',()=>{
  for(const status of ['realizado','realized','paid','pago']){
    const state=cards.billingTransactionState(tx({status}));
    equal(state.status,'realizado');equal(state.included,true);equal(state.knownCommitment,true);equal(state.eligible,true);equal(state.liquidatable,true);
  }
  for(const status of ['pendente','pending','programado','scheduled']){
    const state=cards.billingTransactionState(tx({status}));
    equal(state.status,'programado');equal(state.included,true);equal(state.knownCommitment,true);equal(state.eligible,false);equal(state.liquidatable,false);
  }
  const cancelled=cards.billingTransactionState(tx({status:'cancelado'}));
  equal(cancelled.included,false);equal(cancelled.knownCommitment,false);equal(cancelled.eligible,false);equal(cancelled.liquidatable,false);
  const unknown=cards.billingTransactionState(tx({status:'misterioso'}));
  equal(unknown.status,'nao_classificado');equal(unknown.included,false);equal(unknown.label,null);
});

test('summary normalizado só expõe estado e label quando presentes',()=>{
  const open=cards.normalizeBillingSummary({card_id:'card-a',cycle_id:'cycle-a',cycle_key:'2026-08-01',closing_date:'2026-08-22',due_date:'2026-08-30',purchase_amount:'500.125',credited_amount:50,paid_amount:100,outstanding_amount:350,credit_balance:0,credit_balance_review_required:false,settlement_state:'partially_paid'});
  equal(open.cardId,'card-a');equal(open.cycleKey,'2026-08-01');equal(open.purchaseAmount,500.13);equal(open.outstandingAmount,350);equal(open.settlementState,'partially_paid');equal(open.stateLabel,'Parcialmente paga');equal(open.creditBalanceReviewRequired,false);
  const absent=cards.normalizeBillingSummary({card_id:'card-a',cycle_id:'cycle-b',cycle_key:'2026-09-01'});
  equal(Object.hasOwn(absent,'settlementState'),false);equal(Object.hasOwn(absent,'stateLabel'),false);equal(Object.hasOwn(absent,'outstandingAmount'),false);
  equal(cards.normalizeBillingSummary({cycle_id:'orphan'}),null);
});

test('managed limit e posição de conta preservam null sem fabricar rótulo ou saldo',()=>{
  const unavailable=cards.normalizeManagedLimit({card_id:'card-a',configured_limit:1000,managed_used_limit:200,managed_available_limit:null,coverage_state:'partial'});
  equal(unavailable.configuredLimit,1000);equal(unavailable.managedUsedLimit,200);equal(unavailable.coverageState,'partial');equal(Object.hasOwn(unavailable,'managedAvailableLimit'),false);equal(Object.hasOwn(unavailable,'limitationNotice'),false);
  const available=cards.normalizeManagedLimit({card_id:'card-a',managed_available_limit:'800.50',metric_contract:'AVIORA_MANAGED_AVAILABLE_LIMIT',limitation_notice:'Gerencial'});
  equal(available.managedAvailableLimit,800.5);equal(available.metricContract,'AVIORA_MANAGED_AVAILABLE_LIMIT');equal(available.limitationNotice,'Gerencial');
  const position=cards.normalizeAccountPosition({account_id:'account-a',name:'Conta principal',statement_balance:'2500.45',balance_as_of:'2026-08-27T10:00:00Z'});
  deep(position,{accountId:'account-a',name:'Conta principal',balance:2500.45,balanceAsOf:'2026-08-27'});
});

test('ingestão filtra linhas órfãs, aceita aliases e congela as fontes',()=>{
  const result=cards.ingestBillingData({
    billingSummaries:[{card_id:'card-a',cycle_id:'cycle-a',cycle_key:'2026-08-01'},{cycle_id:'orphan'}],
    managed_limits:[{card_id:'card-a',managed_available_limit:700},{managed_available_limit:1}],
    account_positions:[{id:'account-a',projected_balance:900},{}]
  });
  equal(result.summaries.length,1);equal(result.managedLimits.length,1);equal(result.accountPositions.length,1);
  equal(result.managedLimits[0].managedAvailableLimit,700);equal(result.accountPositions[0].balance,900);
  equal(Object.isFrozen(result),true);equal(Object.isFrozen(result.summaries),true);equal(Object.isFrozen(result.summaries[0]),true);
});

test('seleção de ciclo exige cartão e mês exatos',()=>{
  const summaries=[
    {card_id:'card-a',cycle_id:'a-jul',cycle_key:'2026-07-01',due_date:'2026-07-30'},
    {card_id:'card-a',cycle_id:'a-ago',cycle_key:'2026-08-01',due_date:'2026-08-30'},
    {card_id:'card-b',cycle_id:'b-ago',cycle_key:'2026-08-01',due_date:'2026-08-31'}
  ];
  equal(cards.selectedCycleForCard(summaries,'card-a',{year:2026,month:8}).cycleId,'a-ago');
  equal(cards.selectedCycleForCard(summaries,'card-b',{key:'2026-08'}).cycleId,'b-ago');
  equal(cards.selectedCycleForCard(summaries,'card-a',{year:2026,month:9}),null);
  equal(cards.selectedCycleForCard(summaries,'card-c',{year:2026,month:8}),null);
});

test('múltiplos ciclos do mesmo cartão no mês ficam enumerados e selecionáveis sem ocultar obrigação',()=>{
  const summaries=[
    {card_id:'card-a',cycle_id:'cycle-30',cycle_key:'2026-08-01',closing_date:'2026-08-22',due_date:'2026-08-30',outstanding_amount:100},
    {card_id:'card-a',cycle_id:'cycle-31',cycle_key:'2026-08-01',closing_date:'2026-08-23',due_date:'2026-08-31',outstanding_amount:200}
  ];
  deep(cards.cyclesForCard(summaries,'card-a',{year:2026,month:8}).map(item=>item.cycleId),['cycle-31','cycle-30']);
  equal(cards.selectedCycleForCard(summaries,'card-a',{year:2026,month:8,cycleId:'cycle-30'}).cycleId,'cycle-30');
  const view=cards.joinCardBillingData([card()],[],{summaries},{year:2026,month:8,cycleIds:{'card-a':'cycle-30'}});
  equal(view.rows[0].cycles.length,2);equal(view.rows[0].selectedCycle.cycleId,'cycle-30');
});

test('agrupamento mês para dia mostra compra e preserva competência',()=>{
  const rows=[
    tx({id:'aug-real',status:'realizado',amount:120,purchase_date:'2026-08-12',transaction_date:'2026-08-30',card_billing_cycle_id:'cycle-a'}),
    tx({id:'aug-pending',status:'pendente',amount:80,purchase_date:'2026-08-12',transaction_date:'2026-08-30'}),
    tx({id:'sep',status:'programado',amount:50,purchase_date:'2026-08-28',transaction_date:'2026-09-30',card_billing_cycle_id:'cycle-b'}),
    tx({id:'cancelled',status:'cancelado',amount:999,purchase_date:'2026-08-13',transaction_date:'2026-08-30'})
  ];
  const result=cards.groupTransactionsByMonthDay(rows,{cards:[card()]});
  equal(result.total,250);equal(result.visibleTotal,250);equal(result.count,3);equal(result.groups.length,2);
  equal(result.groups[0].key,'2026-09');equal(result.groups[0].days[0].date,'2026-09-30');
  const august=result.groups[1];equal(august.key,'2026-08');equal(august.total,200);equal(august.days.length,1);equal(august.days[0].date,'2026-08-30');equal(august.days[0].total,200);
  const first=august.days[0].items.find(item=>item.transaction.id==='aug-real');
  equal(first.purchaseDate,'2026-08-12');equal(first.financialDate,'2026-08-30');equal(first.membership,'structured');equal(first.billingState.liquidatable,true);
  const pending=august.days[0].items.find(item=>item.transaction.id==='aug-pending');
  equal(pending.membership,'legacy');equal(pending.legacyFallback,true);equal(pending.billingState.liquidatable,false);equal(august.legacyFallback,true);
  equal(august.days[0].total,august.days[0].items.reduce((sum,item)=>sum+item.transaction.amount,0));
});

test('busca cobre nome, descrição, estabelecimento, categoria e cartão sem mudar totais',()=>{
  const rows=[
    tx({id:'coffee',name:'Compra café',description:'Café da manhã',establishment:'Padaria Central',category:'Lazer',amount:30,status:'realizado',purchase_date:'2026-08-10',transaction_date:'2026-08-30'}),
    tx({id:'market',description:'Compras do mês',merchant_name:'Mercado Bairro',category:'Gastos Fixos',amount:170,status:'pendente',purchase_date:'2026-08-11',transaction_date:'2026-08-30'})
  ];
  for(const [query,visible] of [['compra café',1],['café da manhã',1],['padaria',1],['mercado bairro',1],['gastos fixos',1],['cartão a',2]]){
    const result=cards.groupTransactionsByMonthDay(rows,{query,cards:[card()]});
    equal(result.total,200,`total financeiro preservado para ${query}`);equal(result.visibleCount,visible,`linhas visíveis para ${query}`);
    equal(result.visibleTotal,result.groups.flatMap(month=>month.days).reduce((sum,day)=>sum+day.total,0));
  }
  const none=cards.groupTransactionsByMonthDay(rows,{query:'inexistente',cards:[card()]});
  equal(none.total,200);equal(none.visibleTotal,0);equal(none.groups.length,0);
});

test('junção combina ciclo, limite, contas e fallback legado sem reclassificar',()=>{
  const input={
    cards:[card(),card({id:'card-b',name:'Cartão B'})],
    transactions:[
      tx({id:'linked',status:'realizado',amount:100,card_billing_cycle_id:'cycle-a',purchase_date:'2026-08-15'}),
      tx({id:'legacy',status:'pendente',amount:40,purchase_date:'2026-08-16'}),
      tx({id:'other-cycle',status:'realizado',amount:90,card_billing_cycle_id:'cycle-other',purchase_date:'2026-08-17'}),
      tx({id:'card-b-row',card_id:'card-b',status:'programado',amount:60,purchase_date:'2026-08-18'})
    ],
    sources:{
      summaries:[{card_id:'card-a',cycle_id:'cycle-a',cycle_key:'2026-08-01',settlement_state:'open',outstanding_amount:100}],
      managedLimits:[{card_id:'card-a',managed_available_limit:900},{card_id:'card-b',managed_available_limit:null}],
      accountPositions:[{account_id:'global-account',name:'Conta global',balance:500},{account_id:'cycle-account',billing_cycle_id:'cycle-a',balance:300},{account_id:'other-account',billing_cycle_id:'cycle-other',balance:200}]
    }
  };
  const before=JSON.stringify(input),view=cards.joinCardBillingData(input.cards,input.transactions,input.sources,{year:2026,month:8,query:'cartão a'});
  const first=view.rows[0],second=view.rows[1];
  equal(first.mode,'structured');equal(first.selectedCycle.cycleId,'cycle-a');equal(first.managedLimit.managedAvailableLimit,900);equal(first.groups.total,140);equal(first.groups.visibleCount,2);
  equal(first.legacyFallback.reason,'UNLINKED_ROWS_IN_PERIOD');equal(first.legacyFallback.count,1);
  deep(first.accountPositions.map(item=>item.accountId),['global-account','cycle-account']);
  equal(first.groups.groups[0].days.flatMap(day=>day.items).some(item=>item.transaction.id==='other-cycle'),false);
  equal(second.mode,'legacy');equal(second.selectedCycle,null);equal(second.legacyFallback.reason,'NO_PERSISTED_CYCLE');equal(second.legacyFallback.count,1);
  deep(second.accountPositions.map(item=>item.accountId),['global-account']);
  equal(Object.hasOwn(second.managedLimit,'managedAvailableLimit'),false);
  equal(JSON.stringify(input),before);equal(Object.isFrozen(view),true);equal(Object.isFrozen(first.groups.groups),true);
});

test('fallback legado permanece explícito mesmo sem linhas no período',()=>{
  const view=cards.joinCardBillingData([card()],[],{}, {year:2026,month:8});
  equal(view.rows[0].mode,'legacy');equal(view.rows[0].legacyFallback.reason,'NO_PERSISTED_CYCLE');equal(view.rows[0].legacyFallback.count,0);
});

console.log(`cards-v2: ${tests} tests, ${assertions} assertions passed`);
