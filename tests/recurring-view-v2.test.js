'use strict';

const assert=require('node:assert/strict');
const recurring=require('../js/recurring-view-data');

let tests=0,assertions=0;
const equal=(a,b,m)=>{assertions+=1;assert.equal(a,b,m)};
const ok=(v,m)=>{assertions+=1;assert.ok(v,m)};
const test=(name,fn)=>{fn();tests+=1};
const rule=(overrides={})=>({id:'rent',name:'Aluguel',transaction_type:'despesa',category:'Gastos Fixos',amount:1000,frequency:'monthly',interval:1,next_date:'2026-08-05',active:true,...overrides});
const tx=(overrides={})=>({id:'tx',transaction_type:'despesa',amount:1000,status:'pendente',transaction_date:'2026-08-05',recurring_series_id:'rent',recurring_occurrence_date:'2026-08-05',...overrides});
const view=(rules,transactions=[],options={})=>recurring.recurringView(rules,transactions,{year:2026,month:8,mode:'month',now:'2026-08-27',...options});

test('filtros distinguem ativas, pausadas, tipo e categoria',()=>{const active=rule(),paused=rule({id:'paused',active:false,category:'Lazer'});equal(recurring.ruleMatches(active,{status:'active'}),true);equal(recurring.ruleMatches(paused,{status:'active'}),false);equal(recurring.ruleMatches(paused,{status:'paused',category:'Lazer'}),true);equal(recurring.ruleMatches(active,{type:'receita'}),false)});
test('ocorrência materializada programada não duplica projeção',()=>{const result=view([rule()],[tx()]);equal(result.rows[0].scheduled,1000);equal(result.rows[0].projected,0);equal(result.rows[0].forecast,1000);equal(result.rows[0].expected,1000)});
test('ocorrência realizada substitui futuro sem mudar o esperado',()=>{const result=view([rule()],[tx({status:'realizado'})]);equal(result.rows[0].realized,1000);equal(result.rows[0].forecast,0);equal(result.rows[0].expected,1000)});
test('receita, despesa e investimento permanecem separados nos totais',()=>{const result=view([rule(),rule({id:'income',transaction_type:'receita',amount:2000}),rule({id:'invest',transaction_type:'investimento',amount:300})]);equal(result.totals.incomeExpected,2000);equal(result.totals.outflowExpected,1300);equal(result.totals.projected,3300)});
test('visão anual usa o motor existente sem alterar a cadência',()=>{const result=view([rule()],[],{mode:'year'});equal(result.rows[0].projectedCount,5);equal(result.rows[0].projected,5000);ok(result.warnings.length===0)});
test('pausada permanece listável sem gerar ocorrência',()=>{const result=view([rule({active:false})]);equal(result.counts.paused,1);equal(result.rows[0].projected,0);equal(result.rows[0].expected,0)});

console.log(`recurring-view-v2: ${tests} tests, ${assertions} assertions passed`);
