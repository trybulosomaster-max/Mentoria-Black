const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let assertionCount = 0;
let testCount = 0;

function equal(actual, expected, message) {
  assertionCount += 1;
  assert.strictEqual(actual, expected, message);
}

function approxEqual(actual, expected, epsilon = 1e-12, message) {
  assertionCount += 1;
  assert.ok(Math.abs(actual - expected) <= epsilon, message || `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
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

function sliceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return html.slice(start, end);
}

const context = {
  DATA: {
    accounts: [], cards: [], categories: [], transactions: [], goals: [],
    recurring: [], assets: [], liabilities: [], monthly: []
  },
  FILTERS: {year: 2026, month: 1},
  window: null,
  console
};
context.window = context;
context.selectedKey = () => `${context.FILTERS.year}-${String(context.FILTERS.month).padStart(2, '0')}`;
vm.createContext(context);
const dateInContext = iso => vm.runInContext(`new Date(${JSON.stringify(iso)})`, context);

const financeAndGoals = sliceBetween('function parseMoney', 'function categoryOptions');
vm.runInContext(`${financeAndGoals}\nthis.api={MBFinance,MBGoals};`, context);

const periodAndWealth = sliceBetween('function periodTxRaw', 'function chartBar');
vm.runInContext(`${periodAndWealth}\nObject.assign(this.api,{periodTxRaw,periodTx,periodAudit,txDuplicateKey,cleanTransactions,realizedByCategory,netWorth});`, context);

const v19Dedup = sliceBetween('  // Fix parcel deduplication:', '  window.cardSummary = function');
vm.runInContext(v19Dedup, context);
context.api.txDuplicateKey = context.txDuplicateKey;
context.api.cleanTransactions = context.cleanTransactions;

const {MBFinance, MBGoals} = context.api;
const rowIds = rows => Array.from(rows, row => row.id);

test('datas financeiras respeitam precedência, formatos e invalidez atuais', () => {
  equal(MBFinance.financialDate({transaction_date:'2026-01-02',date:'2025-12-31'}), '2026-01-02');
  equal(MBFinance.financialDate({transaction_date:'',date:'2026-02-03'}), '2026-02-03');
  equal(MBFinance.financialDate({due_date:'2026-03-04'}), '2026-03-04');
  equal(MBFinance.financialDate({created_at:'2026-04-05T23:59:00Z'}), '2026-04-05');
  equal(MBFinance.financialDate({transaction_date:'06/05/2026'}), '2026-05-06');
  equal(MBFinance.financialDate({transaction_date:'2026-02-30'}), '');
  equal(MBFinance.financialDate({purchase_date:'2026-01-01',transaction_date:'2026-02-10'}), '2026-02-10', 'purchase_date does not define the financial period');
  deepEqual({...MBFinance.period({transaction_date:'2026-12-31'})}, {date:'2026-12-31',year:2026,month:12,key:'2026-12'});
  deepEqual({...MBFinance.period({transaction_date:'2027-01-01'})}, {date:'2027-01-01',year:2027,month:1,key:'2027-01'});
  deepEqual({...MBFinance.period({transaction_date:'invalid'})}, {date:'',year:null,month:null,key:''});
});

test('tipos e aliases mantêm a classificação V81', () => {
  const cases = [
    ['receita','receita'], ['income','receita'], ['despesa','despesa'], ['expense','despesa'],
    ['investimento','investimento'], ['investment','investimento'],
    ['transferência','transferencia'], ['transfer','transferencia'],
    ['resgate','resgate'], ['rescue','resgate'], ['Outro Tipo','outro tipo']
  ];
  cases.forEach(([input, expected]) => equal(MBFinance.kind(input), expected));
  ok(MBFinance.isIncome({transaction_type:'receita'}));
  ok(MBFinance.isExpense({transaction_type:'despesa',category:'Lazer'}));
  ok(MBFinance.isInvestment({transaction_type:'investimento'}));
  ok(MBFinance.isInvestment({transaction_type:'despesa',category:'Investimentos'}));
  ok(!MBFinance.isExpense({transaction_type:'despesa',category:'Investimentos'}));
  ok(MBFinance.isTransfer({transaction_type:'transferência'}));
  ok(MBFinance.isRescue({transaction_type:'resgate'}));
});

test('cancelamento reconhece somente os três aliases atuais', () => {
  ['cancelado','canceled','cancelled'].forEach(status => ok(MBFinance.isCancelled({status})));
  ['realizado','realized','paid','pago','pendente','pending','programado','scheduled','',undefined,'desconhecido']
    .forEach(status => ok(!MBFinance.isCancelled({status})));
});

test('totals exclui apenas cancelados e mantém previstos e desconhecidos', () => {
  const rows = [
    {transaction_type:'receita',amount:100,status:'realizado'},
    {transaction_type:'receita',amount:10,status:'pendente'},
    {transaction_type:'receita',amount:20,status:'programado'},
    {transaction_type:'receita',amount:30},
    {transaction_type:'receita',amount:40,status:'desconhecido'},
    {transaction_type:'despesa',amount:25,status:'pending'},
    {transaction_type:'despesa',amount:15,status:'scheduled'},
    {transaction_type:'investimento',amount:50,status:'paid'},
    {transaction_type:'transferencia',amount:999,status:'realizado'},
    {transaction_type:'resgate',amount:888,status:'realizado'},
    {transaction_type:'receita',amount:1000,status:'cancelado'},
    {transaction_type:'despesa',amount:1000,status:'canceled'},
    {transaction_type:'investimento',amount:1000,status:'cancelled'}
  ];
  deepEqual({...MBFinance.totals(rows)}, {income:200,expense:40,invest:50,balance:110});
});

test('periodTx seleciona competência, ignora compra e exclui somente cancelados', () => {
  context.FILTERS.year = 2026;
  context.FILTERS.month = 1;
  context.DATA.transactions = [
    {id:'realizado',transaction_date:'2026-01-01',status:'realizado'},
    {id:'realized',transaction_date:'2026-01-02',status:'realized'},
    {id:'paid',transaction_date:'2026-01-03',status:'paid'},
    {id:'pago',transaction_date:'2026-01-04',status:'pago'},
    {id:'pendente',transaction_date:'2026-01-05',status:'pendente'},
    {id:'pending',transaction_date:'2026-01-06',status:'pending'},
    {id:'programado',transaction_date:'2026-01-07',status:'programado'},
    {id:'scheduled',transaction_date:'2026-01-08',status:'scheduled'},
    {id:'ausente',transaction_date:'2026-01-09'},
    {id:'desconhecido',transaction_date:'2026-01-10',status:'xyz'},
    {id:'purchase-other-month',purchase_date:'2025-12-20',transaction_date:'2026-01-11',status:'realizado'},
    {id:'previous-month',transaction_date:'2025-12-31',status:'realizado'},
    {id:'next-year',transaction_date:'2027-01-01',status:'realizado'},
    {id:'cancelado',transaction_date:'2026-01-12',status:'cancelado'},
    {id:'canceled',transaction_date:'2026-01-13',status:'canceled'},
    {id:'cancelled',transaction_date:'2026-01-14',status:'cancelled'}
  ];
  deepEqual(rowIds(context.api.periodTx()), ['realizado','realized','paid','pago','pendente','pending','programado','scheduled','ausente','desconhecido','purchase-other-month']);
});

test('realizedByCategory soma despesas e investimentos não cancelados sem filtrar status', () => {
  const result = context.api.realizedByCategory([
    {transaction_type:'despesa',category:'Lazer',amount:10,status:'realizado'},
    {transaction_type:'despesa',category:'Lazer',amount:20,status:'pendente'},
    {transaction_type:'despesa',category:'Lazer',amount:30,status:'programado'},
    {transaction_type:'investimento',category:'Qualquer',amount:40,status:'desconhecido'},
    {transaction_type:'despesa',category:'Lazer',amount:100,status:'cancelado'},
    {transaction_type:'receita',category:'Lazer',amount:500,status:'realizado'}
  ]);
  deepEqual({...result}, {Lazer:60,Investimentos:40});
});

test('MBGoals classifica realizado, previsto, futuro e desconhecido como na V81', () => {
  const now = dateInContext('2026-01-15T12:00:00');
  const transactions = [
    {id:'realizado',goal_id:'g1',transaction_date:'2026-01-01',amount:10,status:'realizado'},
    {id:'realized',goal_id:'g1',transaction_date:'2026-01-02',amount:11,status:'realized'},
    {id:'paid',goal_id:'g1',transaction_date:'2026-01-03',amount:12,status:'paid'},
    {id:'pago',goal_id:'g1',transaction_date:'2026-01-04',amount:13,status:'pago'},
    {id:'withdrawal',goal_id:'g1',transaction_date:'2026-01-05',amount:5,status:'realizado',goal_effect:'withdrawal'},
    {id:'pendente',goal_id:'g1',transaction_date:'2026-01-06',amount:20,status:'pendente'},
    {id:'pending',goal_id:'g1',transaction_date:'2026-01-07',amount:21,status:'pending'},
    {id:'programado',goal_id:'g1',transaction_date:'2026-01-08',amount:22,status:'programado'},
    {id:'scheduled',goal_id:'g1',transaction_date:'2026-01-09',amount:23,status:'scheduled'},
    {id:'missing',goal_id:'g1',transaction_date:'2026-01-10',amount:24},
    {id:'unknown',goal_id:'g1',transaction_date:'2026-01-11',amount:25,status:'other'},
    {id:'future-realized',goal_id:'g1',transaction_date:'2026-02-01',amount:30,status:'realizado'},
    {id:'future-unknown',goal_id:'g1',transaction_date:'2026-02-02',amount:31,status:'other'},
    {id:'cancelled',goal_id:'g1',transaction_date:'2026-01-12',amount:100,status:'cancelado'}
  ];
  const classified = MBGoals.classifyTransactions('g1',{transactions,recurring:[],now});
  deepEqual(rowIds(classified.realized.map(item => item.row)), ['realizado','realized','paid','pago','withdrawal']);
  deepEqual(rowIds(classified.programmed.map(item => item.row)), ['pendente','pending','future-realized','future-unknown']);
  deepEqual(rowIds(classified.futureRealized.map(item => item.row)), ['future-realized']);
  deepEqual(Array.from(classified.ignored, item => [item.row.id,item.reason]), [
    ['programado','unrecognized_status'],['scheduled','unrecognized_status'],
    ['missing','unrecognized_status'],['unknown','unrecognized_status'],['cancelled','cancelled']
  ]);
});

test('MBGoals combina current manual, aportes, retiradas e múltiplas transações', () => {
  const goal = {id:'g2',target:500,current:100,deadline:'2026-12-31'};
  const transactions = [
    {goal_id:'g2',transaction_date:'2026-01-01',amount:50,status:'realizado',goal_effect:'contribution'},
    {goal_id:'g2',transaction_date:'2026-01-02',amount:20,status:'realizado',goal_effect:'withdrawal'},
    {goal_id:'g2',transaction_date:'2026-02-01',amount:40,status:'pendente',goal_effect:'contribution'},
    {goal_id:'g2',transaction_date:'2026-03-01',amount:10,status:'pendente',goal_effect:'withdrawal'},
    {goal_id:'g2',transaction_date:'2026-01-03',amount:999,status:'cancelled'}
  ];
  const metrics = MBGoals.metrics(goal,{transactions,recurring:[],now:dateInContext('2026-01-15T12:00:00')});
  equal(metrics.baseManual,100);
  equal(metrics.realized,130);
  equal(metrics.programmed,30);
  equal(metrics.projectedCovered,160);
  equal(metrics.remainingReal,370);
  equal(metrics.remainingUnplanned,340);
});

test('recurringInfo caracteriza frequências, intervalos, next_date e atividade', () => {
  const recurring = [
    {id:'monthly',goal_id:'g3',amount:120,frequency:'monthly',interval:1,next_date:'2026-02-01',active:true},
    {id:'annual',goal_id:'g3',amount:1200,frequency:'yearly',interval:1,next_date:'2026-02-01',active:true,end_date:'2028-01-01'},
    {id:'weekly',goal_id:'g3',amount:10,frequency:'weekly',interval:1,next_date:'2026-02-01',active:true},
    {id:'biweekly',goal_id:'g3',amount:20,frequency:'biweekly',interval:2,next_date:'2026-02-01',active:true},
    {id:'daily',goal_id:'g3',amount:1,frequency:'daily',interval:2,next_date:'2026-02-01',active:true},
    {id:'inactive',goal_id:'g3',amount:999,frequency:'monthly',interval:1,next_date:'2026-02-01',active:false},
    {id:'no-next',goal_id:'g3',amount:50,frequency:'monthly',interval:1,active:true}
  ];
  const info = MBGoals.recurringInfo('g3',{transactions:[],recurring});
  equal(info.rules.length,7);
  equal(info.rules.find(row => row.id==='monthly').monthlyAmount,120);
  equal(info.rules.find(row => row.id==='annual').monthlyAmount,100);
  approxEqual(info.rules.find(row => row.id==='weekly').monthlyAmount,520/12);
  approxEqual(info.rules.find(row => row.id==='biweekly').monthlyAmount,260/12);
  approxEqual(info.rules.find(row => row.id==='daily').monthlyAmount,365.2425/24);
  equal(info.rules.find(row => row.id==='inactive').monthlyAmount,0);
  equal(info.rules.find(row => row.id==='monthly').nextDate,'2026-02-01');
  equal(info.rules.find(row => row.id==='annual').endDate,undefined, 'current recurringInfo does not expose or apply end_date');
  ok(info.hasReliablePace, 'an active rule with next_date makes pace reliable');
  approxEqual(info.monthlyPace,120+100+(520/12)+(260/12)+(365.2425/24)+50,1e-12,'a rule without next_date still contributes to monthlyPace');
});

test('recurringInfo encontra última materialização pelo note legado', () => {
  const recurring = [{id:'12345678-abcd',goal_id:'g4',amount:100,frequency:'monthly',interval:1,next_date:'2026-04-01',active:true}];
  const transactions = [
    {transaction_date:'2026-01-01',note:'Recorrência automática • 12345678-abcd'},
    {transaction_date:'2026-03-01',note:'Texto • Recorrência automática • 12345678-abcd'}
  ];
  const info = MBGoals.recurringInfo('g4',{transactions,recurring});
  equal(info.rules[0].lastMaterializedDate,'2026-03-01');
});

test('parcelamentos usam identidade derivada de note e preservam compras distintas', () => {
  const common = {transaction_type:'despesa',description:'Notebook',category:'Conhecimento',amount:100,account_id:'a1'};
  const first = {...common,id:'p1',transaction_date:'2026-02-10',purchase_date:'2026-01-02',note:'Parcelado 1/2 • Compra 2026-01-02'};
  const duplicate = {...first,id:'p1-copy'};
  const similarOtherPurchase = {...common,id:'p2',transaction_date:'2026-02-10',purchase_date:'2026-01-20',note:'Parcelado 1/2 • Compra 2026-01-20'};
  const malformed = {...common,id:'plain',transaction_date:'2026-02-10',note:'Parcela 1 de 2'};
  equal(context.api.txDuplicateKey(first),context.api.txDuplicateKey(duplicate));
  ok(context.api.txDuplicateKey(first)!==context.api.txDuplicateKey(similarOtherPurchase));
  const source = [first,duplicate,similarOtherPurchase,malformed];
  const before = JSON.stringify(source);
  const cleaned = context.api.cleanTransactions(source);
  deepEqual(rowIds(cleaned.rows),['p1','p2','plain']);
  deepEqual(rowIds(cleaned.duplicates),['p1-copy']);
  equal(JSON.stringify(source),before,'deduplication must not mutate the source array');
});

test('netWorth usa somente contas, ativos e passivos', () => {
  context.DATA.accounts = [
    {statement_balance:1000},
    {statement_balance:null,opening_balance:250}
  ];
  context.DATA.assets = [{current_value:5000},{current_value:750}];
  context.DATA.liabilities = [{balance:900},{balance:100}];
  context.DATA.transactions = [
    {transaction_type:'receita',amount:100000,status:'realizado'},
    {transaction_type:'despesa',amount:99999,status:'realizado'},
    {transaction_type:'investimento',amount:50000,status:'realizado'},
    {transaction_type:'resgate',amount:25000,status:'realizado'},
    {transaction_type:'transferencia',amount:10000,status:'realizado'}
  ];
  equal(context.api.netWorth(),6000,'transactions do not automatically affect current net worth');
  context.DATA.transactions = [];
  equal(context.api.netWorth(),6000,'removing every transaction leaves net worth unchanged');
});

test('Meta 2046 documenta o limite entre materialização e ritmo recorrente', () => {
  const goal = {id:'long',target:250000,current:1000,deadline:'2046-01-01'};
  const recurring = [{
    id:'long-rule',goal_id:'long',goal_effect:'contribution',amount:500,
    frequency:'monthly',interval:1,next_date:'2027-02-01',active:true
  }];
  const transactions = Array.from({length:12},(_,index) => ({
    id:`materialized-${index+1}`,
    goal_id:'long',goal_effect:'contribution',amount:500,status:'pendente',
    transaction_date:`2027-${String(index+1).padStart(2,'0')}-01`,
    note:'Recorrência automática • long-rule'
  }));
  const metrics = MBGoals.metrics(goal,{transactions,recurring,now:dateInContext('2026-12-15T12:00:00')});
  equal(metrics.programmed,6000,'only the 12 materialized transactions are included');
  equal(metrics.projectedCovered,7000,'projectedCovered is manual current plus materialized transactions');
  equal(metrics.recurring.monthlyPace,500,'recurringInfo still derives a monthly pace from the rule');
  equal(metrics.recurringMonthlyPace,500);
  equal(metrics.forecastSource,'recurring');
  ok(metrics.estimatedCompletionDate!==null,'pace can estimate completion independently of projectedCovered');
  equal(metrics.projectedCovered < goal.target,true,'there is no full financial projection through 2046');
  equal(metrics.remainingUnplanned,243000,'future virtual occurrences are not subtracted from remainingUnplanned');
});

console.log(`financial-characterization: ${testCount} tests, ${assertionCount} assertions passed`);
