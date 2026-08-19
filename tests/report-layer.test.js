const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function reportStatus');
const end = html.indexOf('function reportCheck', start);
assert(start > 0 && end > start, 'report query layer must be present');

const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const financialDate = row => ['transaction_date', 'date', 'due_date', 'created_at'].map(k => String(row?.[k] || '').slice(0, 10)).find(v => /^\d{4}-\d{2}-\d{2}$/.test(v)) || '';
const kind = value => ({income:'receita', expense:'despesa', investment:'investimento', transfer:'transferencia', rescue:'resgate'})[fold(value)] || fold(value);
const context = {
  REPORT_FILTERS: {},
  DATA: {transactions: []},
  MBFinance: {
    normalizeTransaction: row => ({...row, amount:Number(row.amount || 0), transaction_type:kind(row.transaction_type || row.type), transaction_date:financialDate(row)}),
    financialDate,
    period: row => { const d=financialDate(row); return {year:d?Number(d.slice(0,4)):null}; },
    kind,
    category: value => ({name:String(value || 'Sem categoria')}),
    isCancelled: row => ['cancelado','canceled','cancelled'].includes(fold(row.status))
  },
  categoryUiNameKey: fold,
  console
};
vm.createContext(context);
vm.runInContext(`${html.slice(start, end)};this.api={reportStatus,matchesReportPeriod,matchesReportType,matchesReportCategory,matchesReportStatus,matchesReportAccount,buildReportDataset,reportTotalsByType,reportTotalsByCategory,reportTotalsByMonth,reportTotalsByYear,reportTotalsByStatus,reportAggregations};`, context);

const rows = [
  {id:'r1',transaction_date:'2026-01-10',transaction_type:'receita',category:'Salário',status:'realizado',amount:5000,account_id:'a1'},
  {id:'d1',transaction_date:'2026-01-12',transaction_type:'despesa',category:'Conforto',status:'realizado',amount:400,account_id:'a1'},
  {id:'i1',transaction_date:'2026-02-01',transaction_type:'investimento',category:'Investimentos',status:'pendente',amount:700,goal_id:'g1'},
  {id:'t1',transaction_date:'2025-12-20',transaction_type:'transferencia',category:'Transferência',status:'realizado',amount:300,account_id:'a2'},
  {id:'s1',transaction_date:'2024-06-15',transaction_type:'resgate',category:'Investimentos',status:'realizado',amount:200,card_id:'c1'},
  {id:'c1',transaction_date:'2026-01-18',transaction_type:'despesa',category:'Conforto',status:'cancelado',amount:50},
  {id:'f1',transaction_date:'2099-03-10',transaction_type:'receita',category:'Renda extra',status:'pendente',amount:100}
];
context.DATA.transactions = rows;
const api = context.api;
const base = {periodMode:'month',year:2026,month:1,years:[],dateFrom:'',dateTo:'',types:[],category:'',statuses:['realizado','pendente'],includeFuture:true,accountId:'',cardId:'',goalId:''};
const ids = filters => Array.from(api.buildReportDataset({...base,...filters}), row => row.id);

assert.deepStrictEqual(ids({}), ['d1','r1']);
assert.deepStrictEqual(ids({periodMode:'year'}), ['i1','d1','r1']);
assert.deepStrictEqual(ids({periodMode:'multi',years:[2024,2025]}), ['t1','s1']);
assert.deepStrictEqual(ids({periodMode:'custom',dateFrom:'2025-12-01',dateTo:'2026-01-31'}), ['d1','r1','t1']);
assert.deepStrictEqual(ids({periodMode:'year',types:['receita']}), ['r1']);
assert.deepStrictEqual(ids({periodMode:'year',types:['despesa']}), ['d1']);
assert.deepStrictEqual(ids({periodMode:'year',types:['investimento']}), ['i1']);
assert.deepStrictEqual(ids({periodMode:'multi',years:[2025],types:['transferencia']}), ['t1']);
assert.deepStrictEqual(ids({periodMode:'multi',years:[2024],types:['resgate']}), ['s1']);
assert.deepStrictEqual(ids({category:'Conforto'}), ['d1']);
assert.deepStrictEqual(ids({statuses:['realizado']}), ['d1','r1']);
assert.deepStrictEqual(ids({statuses:['pendente'],periodMode:'year'}), ['i1']);
assert.deepStrictEqual(ids({statuses:['cancelado']}), ['c1']);
assert.deepStrictEqual(ids({periodMode:'multi',years:[2099],includeFuture:false}), []);
assert.deepStrictEqual(ids({types:['despesa'],category:'Conforto',statuses:['realizado']}), ['d1']);
assert.deepStrictEqual(ids({accountId:'a1'}), ['d1','r1']);
assert.deepStrictEqual(ids({periodMode:'year',goalId:'g1'}), ['i1']);
assert.deepStrictEqual(ids({periodMode:'multi',years:[2024],cardId:'c1'}), ['s1']);

const agg = api.reportAggregations(api.buildReportDataset({...base,periodMode:'year'}));
assert.strictEqual(agg.count, 3);
assert.strictEqual(agg.byType.receita, 5000);
assert.strictEqual(agg.byType.despesa, 400);
assert.strictEqual(agg.byType.investimento, 700);
assert.strictEqual(agg.byCategory.Conforto, 400);
assert.strictEqual(agg.byStatus.realizado, 5400);
assert.strictEqual(agg.byMonth['2026-01'], 5400);
assert.strictEqual(agg.byYear['2026'], 6100);

assert(html.includes('if(TAB==="reports")bindReportFilters()'), 'reports must use its own binder');
assert(!html.includes('["planYear","planMonth"],["repYear","repMonth"]'), 'legacy shared report filters must be removed');
assert(/@media print\{[\s\S]*\.report-no-print/.test(html), 'report print controls must be hidden');
assert(!html.slice(start, end).includes('sb.from('), 'report query layer must be read-only');

console.log('report-layer: 26 assertions passed');
