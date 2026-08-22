'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const recurring=require('../js/structured-recurring-v82');
const projection=require('../js/recurrence-projection');
const finance=require('../js/financial-core');

let tests=0,assertions=0;
const equal=(actual,expected,message)=>{assertions++;assert.strictEqual(actual,expected,message)};
const deepEqual=(actual,expected,message)=>{assertions++;assert.deepStrictEqual(actual,expected,message)};
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const throws=(fn,error,message)=>{assertions++;assert.throws(fn,error,message)};
const test=(name,fn)=>{try{fn();tests++}catch(error){error.message=`${name}: ${error.message}`;throw error}};

test('normaliza os cinco tipos canônicos e aliases legados',()=>{
  equal(recurring.normalizeType('receita'),'receita');equal(recurring.normalizeType('expense'),'despesa');
  equal(recurring.normalizeType('investment'),'investimento');equal(recurring.normalizeType('transferência'),'transferencia');
  equal(recurring.normalizeType('withdrawal'),'resgate');equal(recurring.normalizeType('unknown'),null);
});

test('receita e despesa não exigem vínculos estruturais indevidos',()=>{
  equal(recurring.validateRecurring({type:'receita'}).valid,true);
  equal(recurring.validateRecurring({type:'despesa'}).valid,true);
  deepEqual(recurring.canonicalLinks({type:'receita'}),{source_account_id:null,destination_account_id:null,asset_id:null});
});

test('investimento exige conta de origem e ativo',()=>{
  const missing=recurring.validateRecurring({type:'investimento'});equal(missing.valid,false);
  ok(missing.errors.includes('conta de origem'));ok(missing.errors.includes('ativo de destino'));
  const links=recurring.canonicalLinks({type:'investimento',source_account_id:'account',asset_id:'asset'});
  deepEqual(links,{source_account_id:'account',destination_account_id:null,asset_id:'asset'});
});

test('transferência exige contas distintas',()=>{
  equal(recurring.validateRecurring({type:'transferencia',source_account_id:'a',destination_account_id:'a'}).valid,false);
  const links=recurring.canonicalLinks({type:'transferencia',source_account_id:'a',destination_account_id:'b'});
  deepEqual(links,{source_account_id:'a',destination_account_id:'b',asset_id:null});
});

test('resgate exige ativo e conta de destino',()=>{
  equal(recurring.validateRecurring({type:'resgate',asset_id:'asset'}).valid,false);
  const links=recurring.canonicalLinks({type:'resgate',asset_id:'asset',destination_account_id:'cash'});
  deepEqual(links,{source_account_id:null,destination_account_id:'cash',asset_id:'asset'});
});

test('alias legado de conta deriva somente de vínculos já explícitos',()=>{
  const investment=recurring.canonicalLinks({type:'investimento',source_account_id:'source',asset_id:'asset'});
  equal(recurring.legacyAccountAlias('investimento',investment,'legacy'),'source');
  const rescue=recurring.canonicalLinks({type:'resgate',destination_account_id:'destination',asset_id:'asset'});
  equal(recurring.legacyAccountAlias('resgate',rescue,'legacy'),'destination');
  equal(recurring.legacyAccountAlias('despesa',recurring.canonicalLinks({type:'despesa'}),'legacy'),'legacy');
});

test('identidade de ocorrência depende de série e data canônicas',()=>{
  equal(recurring.occurrenceKey({recurring_series_id:'series',recurring_occurrence_date:'2026-08-20'}),'series|2026-08-20');
  equal(recurring.occurrenceKey({recurring_series_id:'series',transaction_date:'2026-08-20'}),null);
});

test('projeção virtual preserva os vínculos estruturais sem virar transação',()=>{
  const [item]=projection.projectRecurringOccurrences({id:'series',amount:100,frequency:'monthly',next_date:'2026-09-01',source_account_id:'source',destination_account_id:'destination',asset_id:'asset'},{horizonStart:'2026-09-01',horizonEnd:'2026-09-01'});
  equal(item.sourceAccountId,'source');equal(item.destinationAccountId,'destination');equal(item.assetId,'asset');
  equal(Object.hasOwn(item,'transaction_type'),false);
});

test('reconciliação remove a ocorrência virtual materializada uma única vez',()=>{
  const projected=projection.projectRecurringOccurrences({id:'series',amount:100,frequency:'monthly',next_date:'2026-09-01',source_account_id:'source',asset_id:'asset'},{horizonStart:'2026-09-01',horizonEnd:'2026-10-01'});
  const result=projection.reconcileOccurrenceSets([{id:'tx',recurring_series_id:'series',recurring_occurrence_date:'2026-09-01',source_account_id:'source',asset_id:'asset'}],projected);
  equal(result.materialized.length,1);equal(result.projected.length,1);equal(result.projected[0].occurrenceDate,'2026-10-01');
});

test('núcleo financeiro rejeita investimento e resgate incompletos sem efeito parcial',()=>{
  const investment=finance.financialEffect({transaction_type:'investimento',amount:100,status:'realizado',transaction_date:'2026-08-20',source_account_id:'source'},{now:'2026-08-20'});
  equal(investment.valid,false);equal(investment.sourceAccountDelta,0);equal(investment.assetDelta,0);
  const rescue=finance.financialEffect({transaction_type:'resgate',amount:100,status:'realizado',transaction_date:'2026-08-20',asset_id:'asset'},{now:'2026-08-20'});
  equal(rescue.valid,false);equal(rescue.destinationAccountDelta,0);equal(rescue.assetDelta,0);
});

test('núcleo mantém investimento, resgate e transferência patrimonialmente canônicos',()=>{
  const investment=finance.financialEffect({transaction_type:'investimento',amount:100,status:'realizado',transaction_date:'2026-08-20',source_account_id:'source',asset_id:'asset'},{now:'2026-08-20'});
  equal(investment.sourceAccountDelta,-100);equal(investment.assetDelta,100);equal(investment.netWorthDelta,0);
  const rescue=finance.financialEffect({transaction_type:'resgate',amount:40,status:'realizado',transaction_date:'2026-08-20',destination_account_id:'cash',asset_id:'asset'},{now:'2026-08-20'});
  equal(rescue.destinationAccountDelta,40);equal(rescue.assetDelta,-40);equal(rescue.netWorthDelta,0);
  const transfer=finance.financialEffect({transaction_type:'transferencia',amount:25,status:'realizado',transaction_date:'2026-08-20',source_account_id:'source',destination_account_id:'destination'},{now:'2026-08-20'});
  equal(transfer.sourceAccountDelta,-25);equal(transfer.destinationAccountDelta,25);equal(transfer.netWorthDelta,0);
});

test('frontend materializa somente pela RPC atômica',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const block=html.slice(html.indexOf('async function materializeRecurringV17()'),html.indexOf('// V18 lifecycle'));
  ok(block.includes('materialize_recurring_occurrences_v82'));ok(!block.includes('.from("transactions").insert'));
  ok(!block.includes('.from("recurring").update'));
});

test('formulário de recorrência expõe e valida vínculos explícitos',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  for(const id of ['v19RecurringSource','v19RecurringDestination','v19RecurringAsset'])ok(html.includes(`id="${id}"`));
  ok(html.includes("['transferencia','Transferência']"));ok(html.includes("['resgate','Resgate']"));
  ok(html.includes('MBStructuredRecurringV82.validateRecurring'));
});

test('investimento comum usa a RPC estruturada e exige ativo',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  ok(html.includes("sb.rpc('create_investment_entry_v82'"));ok(html.includes("errors.push('ativo de destino')"));
  ok(html.includes('p_source_account_id:accountId'));ok(html.includes('p_asset_id:asset.value'));
});

test('frontend normaliza status programado como pendente nas ações e rótulos',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  ok(html.includes('function isPendingTransaction(t)'));
  ok(html.includes('"programado","scheduled"'));
  equal((html.match(/const pending=isPendingTransaction\(t\);/g)||[]).length,2);
  ok(html.includes('linked.filter(t=>isPendingTransaction(t)'));
});

test('módulo de contrato não persiste nem acessa rede',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','structured-recurring-v82.js'),'utf8');
  ok(!source.includes('supabase'));ok(!source.includes('fetch('));ok(!source.includes('.insert('));ok(!source.includes('.update('));
  throws(()=>recurring.canonicalLinks({type:'investimento',source_account_id:'source'}),TypeError);
});

console.log(`structured-recurring-v82: ${tests} tests, ${assertions} assertions passed`);
