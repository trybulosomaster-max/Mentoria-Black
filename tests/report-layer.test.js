const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert(html.includes('class="tablewrap report-table-wrap"'), 'reports table must use its responsive scroll container');
assert(html.includes('class="report-table"'), 'reports table must have isolated responsive styling');
assert(/\.report-table\{min-width:780px\}/.test(html), 'reports table must preserve a readable minimum width on mobile');
const start = html.indexOf('function reportStatus');
const end = html.indexOf('function reportCheck', start);
assert(start > 0 && end > start, 'report query layer must be present');

const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const financialDate = row => ['transaction_date', 'date', 'due_date', 'created_at'].map(k => String(row?.[k] || '').slice(0, 10)).find(v => /^\d{4}-\d{2}-\d{2}$/.test(v)) || '';
const kind = value => ({income:'receita', expense:'despesa', investment:'investimento', transfer:'transferencia', rescue:'resgate'})[fold(value)] || fold(value);
const txDuplicateKey = t => {
  const parcel=String(t.note||'').match(/parcelado\s+(\d+)\/(\d+).*?compra\s+([0-9]{4}-[0-9]{2}(?:-[0-9]{2})?)/i);
  if(parcel)return ['parcel',parcel[3],parcel[1],parcel[2],String(t.description||'').trim().toLowerCase(),String(t.transaction_type||''),String(t.category||'').trim().toLowerCase(),t.account_id||'',t.card_id||''].join('|');
  return [t.transaction_date,t.purchase_date||'',t.transaction_type,String(t.description||'').trim().toLowerCase(),String(t.category||'').trim().toLowerCase(),Number(t.amount||0).toFixed(2),t.account_id||'',t.card_id||''].join('|');
};
const cleanTransactions = rows => {
  const seen=new Set(),out=[],duplicates=[];
  for(const row of rows){
    if(/parcelado\s+\d+\/\d+/i.test(String(row.note||''))){const key=txDuplicateKey(row);if(seen.has(key)){duplicates.push(row);continue}seen.add(key)}
    out.push(row);
  }
  return {rows:out,duplicates};
};
const context = {
  REPORT_FILTERS: {},
  DATA: {transactions: []},
  MBFinance: {
    normalizeTransaction: row => ({...row, amount:Number(row.amount || 0), transaction_type:kind(row.transaction_type || row.type), transaction_date:financialDate(row)}),
    financialDate,
    period: row => { const d=financialDate(row); return {year:d?Number(d.slice(0,4)):null}; },
    kind,
    category: value => ({name:String(value || 'Sem categoria')}),
    isCancelled: row => ['cancelado','canceled','cancelled'].includes(fold(row.status)),
    totals: rows => {
      const active=rows.filter(row=>!['cancelado','canceled','cancelled'].includes(fold(row.status)));
      const income=active.filter(row=>kind(row.transaction_type)==='receita').reduce((sum,row)=>sum+Number(row.amount||0),0);
      const expense=active.filter(row=>kind(row.transaction_type)==='despesa').reduce((sum,row)=>sum+Number(row.amount||0),0);
      const invest=active.filter(row=>kind(row.transaction_type)==='investimento').reduce((sum,row)=>sum+Number(row.amount||0),0);
      return {income,expense,invest,balance:income-expense-invest};
    }
  },
  cleanTransactions,
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

const duplicateRows=[
  {id:'p1',transaction_date:'2026-01-20',purchase_date:'2026-01-02',transaction_type:'despesa',category:'Conforto',status:'realizado',amount:100,description:'Compra parcelada',account_id:'a1',note:'Parcelado 1/2 • Compra 2026-01-02'},
  {id:'p1-duplicate',transaction_date:'2026-01-20',purchase_date:'2026-01-02',transaction_type:'despesa',category:'Conforto',status:'realizado',amount:100,description:'Compra parcelada',account_id:'a1',note:'Parcelado 1/2 • Compra 2026-01-02'}
];
context.DATA.transactions=duplicateRows;
const before=JSON.stringify(context.DATA.transactions);
const deduplicated=api.buildReportDataset(base);
assert.deepStrictEqual(Array.from(deduplicated,row=>row.id),['p1']);
assert.strictEqual(api.reportAggregations(deduplicated).count,1);
assert.strictEqual(api.reportAggregations(deduplicated).movementTotal,100);
assert.strictEqual(JSON.stringify(context.DATA.transactions),before,'report deduplication must not mutate DATA.transactions');

const balanceOf = row => api.reportAggregations([row]).periodBalance;
assert.strictEqual(balanceOf({transaction_type:'receita',amount:100,status:'realizado'}),100);
assert.strictEqual(balanceOf({transaction_type:'despesa',amount:100,status:'realizado'}),-100);
assert.strictEqual(balanceOf({transaction_type:'investimento',amount:100,status:'realizado'}),-100);
assert.strictEqual(balanceOf({transaction_type:'transferencia',amount:100,status:'realizado'}),0);
assert.strictEqual(balanceOf({transaction_type:'resgate',amount:100,status:'realizado'}),0);
const rescueAgg=api.reportAggregations([{transaction_type:'resgate',amount:100,status:'realizado'}]);
assert.strictEqual(rescueAgg.byType.resgate,100);
assert.strictEqual(rescueAgg.movementTotal,100);

assert(html.includes('if(TAB==="reports")bindReportFilters()'), 'reports must use its own binder');
assert(!html.includes('["planYear","planMonth"],["repYear","repMonth"]'), 'legacy shared report filters must be removed');
assert(/@media print\{[\s\S]*\.report-no-print/.test(html), 'report print controls must be hidden');
assert(!html.slice(start, end).includes('sb.from('), 'report query layer must be read-only');
assert(html.slice(start,end).includes('cleanTransactions(normalized).rows'), 'reports must reuse canonical deduplication');
assert(html.includes('kpi("Movimentação total"'), 'gross sum must be labelled as movement');
assert(html.includes('kpi("Saldo do período"'), 'canonical balance label must be explicit');
assert(!html.includes('kpi("Resultado"'), 'movement or balance must not be labelled as result');

console.log('report-layer: 40 assertions passed');
