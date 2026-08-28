'use strict';

const assert=require('node:assert/strict');
const cards=require('../js/cards-view-data');

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
  const view=project([card(),card({id:'card-b',limit:null})]);equal(view.rows[0].limit,1000);equal(view.rows[0].limitKnown,true);equal(view.rows[1].limit,null);equal(view.contracts.availableLimit,'PENDENTE_DE_CONTRATO');
});
test('cartão sem compras permanece zerado',()=>{const view=project();equal(view.totals.expected,0);equal(view.rows[0].items.length,0)});
test('compra à vista realizada entra apenas no realizado',()=>{const view=project([card()],[tx({status:'realizado',transaction_date:'2026-08-20'})]);equal(view.totals.realized,100);equal(view.totals.scheduled,0);equal(view.totals.expected,100)});
test('compra pendente usa transaction_date como competência',()=>{const row=tx({purchase_date:'2026-07-10'});equal(project([card()],[row]).totals.scheduled,100);equal(project([card()],[row],[],{month:7}).totals.expected,0)});
test('parcela de outro mês não contamina o período e fica no compromisso futuro',()=>{const rows=[tx({id:'p1',note:'Parcelado 1/2 • Compra 2026-07-25'}),tx({id:'p2',transaction_date:'2026-09-30',note:'Parcelado 2/2 • Compra 2026-07-25'})],view=project([card()],rows);equal(view.totals.expected,100);equal(view.rows[0].future.total,100);equal(view.rows[0].future.lastDate,'2026-09-30')});
test('parser de parcelas expõe progresso sem alterar os lançamentos',()=>{const parsed=cards.parseInstallment(tx({note:'Parcelado 2/4 • Compra 2026-07-25'}));assert.deepEqual(parsed,{current:2,total:4,remaining:2,purchaseDate:'2026-07-25'});assertions+=1});
test('cancelado nunca entra',()=>{equal(project([card()],[tx({status:'cancelado'})]).totals.expected,0)});
test('recorrência de cartão aparece como projetado',()=>{const view=project([card()],[],[rule()]);equal(view.totals.projected,50);equal(view.totals.expected,50)});
test('materialização substitui projeção recorrente equivalente',()=>{const materialized=tx({amount:50,recurring_series_id:'rule',recurring_occurrence_date:'2026-08-28',transaction_date:'2026-08-28'}),view=project([card()],[materialized],[rule()]);equal(view.totals.scheduled,50);equal(view.totals.projected,0);equal(view.totals.expected,50)});
test('dois cartões permanecem separados e consolidam sem duplicar',()=>{const view=project([card(),card({id:'card-b',name:'B',limit:500})],[tx(),tx({id:'b',card_id:'card-b',amount:70})]);equal(view.rows[0].totals.expected,100);equal(view.rows[1].totals.expected,70);equal(view.totals.expected,170);equal(view.totalRegisteredLimit,1500)});
test('valor acima do limite é visível sem inventar bloqueio ou saldo de fatura',()=>{const view=project([card({limit:80})],[tx({amount:100})]);ok(view.rows[0].totals.expected>view.rows[0].limit);equal(view.contracts.invoiceBalance,'PENDENTE_DE_CONTRATO')});
test('comparação mensal usa a mesma competência',()=>{const rows=[tx({id:'jul',amount:80,transaction_date:'2026-07-30'}),tx({id:'ago',amount:100})],view=project([card()],rows);equal(view.rows[0].previous.expected,80);equal(view.rows[0].delta,20);equal(view.rows[0].deltaPercent,25)});
test('entradas não são mutadas',()=>{const input={cards:[card()],transactions:[tx()],rules:[rule()]},before=JSON.stringify(input);project(input.cards,input.transactions,input.rules);equal(JSON.stringify(input),before)});

console.log(`cards-v2: ${tests} tests, ${assertions} assertions passed`);
