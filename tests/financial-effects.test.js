const assert = require('assert');
const {financialEffect} = require('../js/financial-core');

let testCount = 0;
let assertionCount = 0;

function equal(actual, expected, message) {
  assertionCount += 1;
  assert.strictEqual(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function ok(actual, message) {
  assertionCount += 1;
  assert.ok(actual, message);
}

function test(name, fn) {
  try {
    fn();
    testCount += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

const NOW = '2026-08-19';
const effect = tx => financialEffect(tx,{now:NOW});
const zeroDeltas = result => {
  for (const field of [
    'availableBalanceDelta','sourceAccountDelta','destinationAccountDelta',
    'assetDelta','liabilityDelta','netWorthDelta','incomeAmount',
    'consumptionExpenseAmount','investmentAmount','transferAmount','rescueAmount'
  ]) equal(result[field],0,`${field} must be zero`);
};

test('receita efetivada aumenta disponibilidade, conta destino e patrimônio', () => {
  const result = effect({transaction_type:'receita',amount:100,status:'realizado',transaction_date:'2026-08-19',account_id:'cash'});
  equal(result.type,'receita');
  equal(result.temporalState,'efetivado');
  equal(result.amount,100);
  equal(result.destinationAccountId,'cash');
  equal(result.availableBalanceDelta,100);
  equal(result.destinationAccountDelta,100);
  equal(result.netWorthDelta,100);
  equal(result.incomeAmount,100);
  equal(result.assetDelta,0);
  equal(result.liabilityDelta,0);
  equal(result.consumptionExpenseAmount,0);
  deepEqual(result.warnings,[]);
});

test('receita não efetivada nunca produz deltas realizados', () => {
  const scheduled = effect({transaction_type:'receita',amount:100,status:'programado',transaction_date:'2026-08-01',account_id:'cash'});
  equal(scheduled.temporalState,'previsto_materializado');
  zeroDeltas(scheduled);
  const future = effect({transaction_type:'receita',amount:100,status:'realizado',transaction_date:'2026-08-20',account_id:'cash'});
  equal(future.temporalState,'previsto_materializado');
  ok(future.warnings.includes('future_realized'));
  zeroDeltas(future);
  const cancelled = effect({transaction_type:'receita',amount:100,status:'cancelado',transaction_date:'2026-08-01',account_id:'cash'});
  equal(cancelled.temporalState,'cancelado');
  zeroDeltas(cancelled);
  const unknown = effect({transaction_type:'receita',amount:100,transaction_date:'2026-08-01',account_id:'cash'});
  equal(unknown.temporalState,'nao_classificado');
  ok(unknown.warnings.includes('unclassified_transaction'));
  zeroDeltas(unknown);
});

test('despesa efetivada reduz disponibilidade, origem e patrimônio', () => {
  const result = effect({transaction_type:'despesa',amount:75.25,status:'paid',transaction_date:'2026-08-01',source_account_id:'cash'});
  equal(result.availableBalanceDelta,-75.25);
  equal(result.sourceAccountId,'cash');
  equal(result.sourceAccountDelta,-75.25);
  equal(result.destinationAccountDelta,0);
  equal(result.netWorthDelta,-75.25);
  equal(result.consumptionExpenseAmount,75.25);
  equal(result.investmentAmount,0);
  equal(result.assetDelta,0);
});

test('despesa prevista, cancelada ou não classificada tem deltas zero', () => {
  for (const tx of [
    {transaction_type:'despesa',amount:20,status:'pending',transaction_date:'2026-08-01'},
    {transaction_type:'despesa',amount:20,status:'realizado',transaction_date:'2026-09-01'},
    {transaction_type:'despesa',amount:20,status:'cancelled',transaction_date:'2026-08-01'},
    {transaction_type:'despesa',amount:20,status:'misterioso',transaction_date:'2026-08-01'}
  ]) zeroDeltas(effect(tx));
});

test('investimento troca disponibilidade por ativo sem despesa ou patrimônio', () => {
  const result = effect({transaction_type:'investimento',amount:250,status:'realizado',transaction_date:'2026-08-01',account_id:'cash',asset_id:'fund'});
  equal(result.availableBalanceDelta,-250);
  equal(result.sourceAccountDelta,-250);
  equal(result.assetDelta,250);
  equal(result.netWorthDelta,0);
  equal(result.investmentAmount,250);
  equal(result.consumptionExpenseAmount,0);
  equal(result.incomeAmount,0);
  deepEqual(result.warnings,[]);
});

test('investimento sem asset_id é inválido e não aplica perna parcial', () => {
  const result = effect({transaction_type:'investment',amount:80,status:'realizado',transaction_date:'2026-08-01',account_id:'cash'});
  equal(result.type,'investimento');
  equal(result.sourceAccountId,'cash');
  equal(result.valid,false);
  equal(result.availableBalanceDelta,0);
  equal(result.assetDelta,0);
  equal(result.netWorthDelta,0);
  equal(result.consumptionExpenseAmount,0);
  ok(result.warnings.includes('missing_asset_destination'));
});

test('transferência representa duas pernas e permanece consolidada neutra', () => {
  const result = effect({transaction_type:'transferencia',amount:300,status:'realizado',transaction_date:'2026-08-01',source_account_id:'a',destination_account_id:'b'});
  equal(result.sourceAccountDelta,-300);
  equal(result.destinationAccountDelta,300);
  equal(result.availableBalanceDelta,0);
  equal(result.netWorthDelta,0);
  equal(result.transferAmount,300);
  equal(result.incomeAmount,0);
  equal(result.consumptionExpenseAmount,0);
  equal(result.investmentAmount,0);
  deepEqual(result.warnings,[]);
});

test('transferência inválida não produz pernas parciais', () => {
  const same = effect({transaction_type:'transfer',amount:30,status:'realizado',transaction_date:'2026-08-01',source_account_id:'a',destination_account_id:'a'});
  equal(same.valid,false);
  ok(same.warnings.includes('same_transfer_account'));
  zeroDeltas(same);
  const noSource = effect({transaction_type:'transferencia',amount:30,status:'realizado',transaction_date:'2026-08-01',destination_account_id:'b'});
  equal(noSource.valid,false);
  ok(noSource.warnings.includes('missing_source_account'));
  zeroDeltas(noSource);
  const noDestination = effect({transaction_type:'transferencia',amount:30,status:'realizado',transaction_date:'2026-08-01',source_account_id:'a'});
  equal(noDestination.valid,false);
  ok(noDestination.warnings.includes('missing_destination_account'));
  zeroDeltas(noDestination);
});

test('resgate troca ativo por disponibilidade sem criar receita ou patrimônio', () => {
  const result = effect({transaction_type:'resgate',amount:125.5,status:'realizado',transaction_date:'2026-08-01',asset_id:'fund',destination_account_id:'cash'});
  equal(result.availableBalanceDelta,125.5);
  equal(result.destinationAccountDelta,125.5);
  equal(result.assetDelta,-125.5);
  equal(result.netWorthDelta,0);
  equal(result.rescueAmount,125.5);
  equal(result.incomeAmount,0);
  equal(result.consumptionExpenseAmount,0);
});

test('resgate sem asset_id é inválido e não aplica perna parcial', () => {
  const result = effect({transaction_type:'rescue',amount:40,status:'realizado',transaction_date:'2026-08-01',account_id:'cash'});
  equal(result.type,'resgate');
  equal(result.destinationAccountId,'cash');
  equal(result.valid,false);
  equal(result.availableBalanceDelta,0);
  equal(result.assetDelta,0);
  equal(result.netWorthDelta,0);
  equal(result.incomeAmount,0);
  ok(result.warnings.includes('missing_asset_source'));
});

test('valores inteiros, centavos e strings numéricas positivas são aceitos', () => {
  equal(effect({type:'income',amount:10,status:'realizado',transaction_date:'2026-08-01',account_id:'a'}).amount,10);
  equal(effect({type:'income',amount:10.37,status:'realizado',transaction_date:'2026-08-01',account_id:'a'}).incomeAmount,10.37);
  equal(effect({type:'income',amount:'10.37',status:'realizado',transaction_date:'2026-08-01',account_id:'a'}).incomeAmount,10.37);
  equal(effect({type:'income',amount:'.50',status:'realizado',transaction_date:'2026-08-01',account_id:'a'}).incomeAmount,0.5);
});

test('zero, negativo, NaN e texto inválido retornam resultado inválido', () => {
  for (const amount of [0,-10,NaN,'abc','10,50','']) {
    const result = effect({transaction_type:'receita',amount,status:'realizado',transaction_date:'2026-08-01',account_id:'a'});
    equal(result.valid,false);
    equal(result.amount,null);
    ok(result.warnings.includes('invalid_amount'));
    zeroDeltas(result);
  }
});

test('tipo desconhecido é inválido e não produz efeitos', () => {
  const result = effect({transaction_type:'outro',amount:100,status:'realizado',transaction_date:'2026-08-01'});
  equal(result.type,'nao_classificado');
  equal(result.valid,false);
  ok(result.warnings.includes('unknown_type'));
  zeroDeltas(result);
});

test('financialEffect não altera a transação nem options', () => {
  const tx = {transaction_type:'investimento',amount:'99.90',status:'realizado',transaction_date:'2026-08-01',account_id:'a',asset_id:'asset'};
  const options = {now:NOW};
  const txBefore = JSON.stringify(tx);
  const optionsBefore = JSON.stringify(options);
  const result = financialEffect(tx,options);
  equal(JSON.stringify(tx),txBefore);
  equal(JSON.stringify(options),optionsBefore);
  equal(result.amount,99.9);
  ok(result !== tx);
});

console.log(`financial-effects: ${testCount} tests, ${assertionCount} assertions passed`);
