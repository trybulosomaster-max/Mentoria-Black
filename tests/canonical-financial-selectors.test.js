const assert = require('assert');
const core = require('../js/financial-core');

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

function throws(fn, constructor, message) {
  assertionCount += 1;
  assert.throws(fn, constructor, message);
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
const ids = rows => rows.map(row => row.id);

test('canonicalStatus normaliza aliases realizados', () => {
  for (const status of ['realizado','realized','paid','pago']) {
    const result = core.canonicalStatus({status});
    equal(result.status,'realizado');
    equal(result.originalStatus,status);
    equal(result.aliasUsed,status === 'realizado' ? null : status);
    equal(result.confidence,'high');
    deepEqual(result.warnings,[]);
  }
});

test('canonicalStatus normaliza aliases programados', () => {
  for (const status of ['pendente','pending','programado','scheduled']) {
    const result = core.canonicalStatus({status});
    equal(result.status,'programado');
    equal(result.aliasUsed,status === 'programado' ? null : status);
    equal(result.confidence,'high');
  }
});

test('canonicalStatus normaliza aliases cancelados', () => {
  for (const status of ['cancelado','canceled','cancelled']) {
    const result = core.canonicalStatus({status});
    equal(result.status,'cancelado');
    equal(result.aliasUsed,status === 'cancelado' ? null : status);
    deepEqual(result.warnings,[]);
  }
});

test('canonicalStatus não promove status ausente ou desconhecido', () => {
  const missing = core.canonicalStatus({});
  deepEqual(missing,{status:'nao_classificado',originalStatus:null,aliasUsed:null,confidence:'none',warnings:['missing_status']});
  const unknown = core.canonicalStatus({status:'legado-estranho'});
  deepEqual(unknown,{status:'nao_classificado',originalStatus:'legado-estranho',aliasUsed:null,confidence:'low',warnings:['unknown_status']});
  equal(core.canonicalStatus({status:' PAGO '}).status,'realizado');
  equal(core.canonicalStatus({status:'CANCELADO'}).status,'cancelado');
});

test('temporalState separa efetivado, previsto, cancelado e não classificado', () => {
  equal(core.temporalState({status:'realizado',transaction_date:'2026-08-18'},NOW).state,'efetivado');
  equal(core.temporalState({status:'realizado',transaction_date:NOW},NOW).state,'efetivado');
  const future = core.temporalState({status:'realizado',transaction_date:'2026-08-20'},NOW);
  equal(future.state,'previsto_materializado');
  deepEqual(future.warnings,['future_realized']);
  equal(core.temporalState({status:'programado',transaction_date:'2026-08-01'},NOW).state,'previsto_materializado');
  equal(core.temporalState({status:'scheduled',transaction_date:'2027-01-01'},NOW).state,'previsto_materializado');
  equal(core.temporalState({status:'cancelled',transaction_date:'2026-08-01'},NOW).state,'cancelado');
  equal(core.temporalState({transaction_date:'2026-08-01'},NOW).state,'nao_classificado');
  equal(core.temporalState({status:'???',transaction_date:'2026-08-01'},NOW).state,'nao_classificado');
});

test('helpers refletem exclusivamente o estado temporal', () => {
  const realized = {status:'paid',transaction_date:NOW};
  const scheduled = {status:'realizado',transaction_date:'2026-08-20'};
  const cancelled = {status:'canceled',transaction_date:NOW};
  const unknown = {status:'other',transaction_date:NOW};
  ok(core.isRealized(realized,NOW));
  ok(!core.isRealized(scheduled,NOW));
  ok(core.isScheduled(scheduled,NOW));
  ok(core.isCancelled(cancelled,NOW));
  ok(core.isUnclassified(unknown,NOW));
});

test('financialDate preserva precedência V81 e ignora purchase_date', () => {
  equal(core.financialDate({transaction_date:'2026-01-01',date:'2026-02-01'}),'2026-01-01');
  equal(core.financialDate({transaction_date:'',date:'2026-02-01',due_date:'2026-03-01'}),'2026-02-01');
  equal(core.financialDate({due_date:'2026-03-01',created_at:'2026-04-01T10:00:00Z'}),'2026-03-01');
  equal(core.financialDate({created_at:'2026-04-01T10:00:00Z'}),'2026-04-01');
  equal(core.financialDate({transaction_date:'05/06/2026'}),'2026-06-05');
  equal(core.financialDate({purchase_date:'2026-07-01'}),'');
  equal(core.financialDate({transaction_date:'2026-02-30'}),'');
});

test('temporalState exige now determinístico e não efetiva data inválida', () => {
  throws(()=>core.temporalState({status:'realizado',transaction_date:'2026-01-01'}),TypeError);
  throws(()=>core.temporalState({status:'realizado',transaction_date:'2026-01-01'},'invalid'),TypeError);
  const invalid = core.temporalState({status:'realizado',transaction_date:'invalid'},NOW);
  equal(invalid.state,'nao_classificado');
  deepEqual(invalid.warnings,['invalid_financial_date']);
  const scheduledInvalid = core.temporalState({status:'programado',transaction_date:'invalid'},NOW);
  equal(scheduledInvalid.state,'previsto_materializado');
  deepEqual(scheduledInvalid.warnings,['invalid_financial_date']);
});

const rows = [
  {id:'realized-january',status:'realizado',transaction_date:'2026-01-10'},
  {id:'realized-august',status:'paid',transaction_date:'2026-08-19'},
  {id:'future-realized',status:'realizado',transaction_date:'2026-08-20'},
  {id:'scheduled-past',status:'pendente',transaction_date:'2026-01-11'},
  {id:'scheduled-future',status:'scheduled',transaction_date:'2027-01-15'},
  {id:'cancelled',status:'cancelled',transaction_date:'2026-08-12'},
  {id:'missing',transaction_date:'2026-08-13'},
  {id:'unknown',status:'legacy',transaction_date:'2025-12-31'},
  {id:'purchase-only',status:'realizado',purchase_date:'2026-08-01'}
];

test('seletores separam os quatro conjuntos sem sobreposição indevida', () => {
  deepEqual(ids(core.realizedTransactions(rows,null,NOW)),['realized-january','realized-august']);
  deepEqual(ids(core.scheduledTransactions(rows,null,NOW)),['future-realized','scheduled-past','scheduled-future']);
  deepEqual(ids(core.cancelledTransactions(rows,null,NOW)),['cancelled']);
  deepEqual(ids(core.unclassifiedTransactions(rows,null,NOW)),['missing','unknown','purchase-only']);
});

test('seletores aceitam ano e mês sem depender de estado global', () => {
  deepEqual(ids(core.realizedTransactions(rows,{year:2026},NOW)),['realized-january','realized-august']);
  deepEqual(ids(core.realizedTransactions(rows,{year:2026,month:8},NOW)),['realized-august']);
  deepEqual(ids(core.scheduledTransactions(rows,{year:2026,month:8},NOW)),['future-realized']);
  deepEqual(ids(core.cancelledTransactions(rows,{year:2026,month:8},NOW)),['cancelled']);
  deepEqual(ids(core.unclassifiedTransactions(rows,{year:2026,month:8},NOW)),['missing']);
});

test('seletores aceitam intervalo inclusivo e limites abertos', () => {
  deepEqual(ids(core.scheduledTransactions(rows,{dateFrom:'2026-01-11',dateTo:'2026-08-20'},NOW)),['future-realized','scheduled-past']);
  deepEqual(ids(core.realizedTransactions(rows,{dateFrom:'2026-08-01'},NOW)),['realized-august']);
  deepEqual(ids(core.scheduledTransactions(rows,{dateTo:'2026-01-31'},NOW)),['scheduled-past']);
});

test('seletores validam contrato de período', () => {
  throws(()=>core.realizedTransactions(rows,{month:8},NOW),TypeError);
  throws(()=>core.realizedTransactions(rows,{year:2026,month:13},NOW),RangeError);
  throws(()=>core.realizedTransactions(rows,{year:2026,dateFrom:'2026-01-01'},NOW),TypeError);
  throws(()=>core.realizedTransactions(rows,{dateFrom:'2026-02-01',dateTo:'2026-01-01'},NOW),RangeError);
  throws(()=>core.realizedTransactions({},null,NOW),TypeError);
});

test('seletores não alteram array nem objetos de origem', () => {
  const source = rows.map(row=>({...row}));
  const before = JSON.stringify(source);
  const selected = core.scheduledTransactions(source,{year:2026},NOW);
  equal(JSON.stringify(source),before);
  ok(selected !== source);
  equal(selected[0],source[2],'selectors preserve original row references');
});

console.log(`canonical-financial-selectors: ${testCount} tests, ${assertionCount} assertions passed`);
