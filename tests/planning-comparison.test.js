const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {projectPlanningPeriod}=require('../js/planning-integration');

let testCount=0,assertionCount=0;
function equal(actual,expected,message){assertionCount+=1;assert.strictEqual(actual,expected,message)}
function ok(actual,message){assertionCount+=1;assert.ok(actual,message)}
function test(name,fn){try{fn();testCount+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const context={DATA:{accounts:[],cards:[],categories:[],transactions:[],goals:[],recurring:[],assets:[],liabilities:[],monthly:[]},FILTERS:{year:2026,month:1},window:null,console};
context.window=context;context.selectedKey=()=>`${context.FILTERS.year}-${String(context.FILTERS.month).padStart(2,'0')}`;
vm.createContext(context);
const financeStart=html.indexOf('function parseMoney'),financeEnd=html.indexOf('function categoryOptions',financeStart);
const periodStart=html.indexOf('function periodTxRaw'),periodEnd=html.indexOf('function chartBar',periodStart);
assert(financeStart>=0&&financeEnd>financeStart&&periodStart>=0&&periodEnd>periodStart,'V81 planning dependencies must exist');
vm.runInContext(`${html.slice(financeStart,financeEnd)};this.MBFinanceApi=MBFinance;`,context);
vm.runInContext(`${html.slice(periodStart,periodEnd)};this.V81={periodTx,totals,realizedByCategory,planValues,planTotal};`,context);

const tx=(overrides={})=>({id:'tx',transaction_type:'despesa',category:'Lazer',amount:100,status:'realizado',transaction_date:'2026-01-10',...overrides});
const rule=(overrides={})=>({id:'rule',transaction_type:'despesa',category:'Gastos Fixos',amount:100,frequency:'monthly',next_date:'2026-01-20',active:true,...overrides});
function compare(rows=[],rules=[],opts={}){
  context.DATA.transactions=rows;
  context.FILTERS.year=opts.year??2026;context.FILTERS.month=opts.month??1;
  const selected=context.V81.periodTx();
  const v81={rows:selected,totals:context.V81.totals(selected),byCategory:context.V81.realizedByCategory(selected)};
  const canonical=projectPlanningPeriod(null,rows,rules,{year:context.FILTERS.year,month:context.FILTERS.month,now:opts.now??'2026-01-15',maxOccurrences:20});
  return {v81,canonical};
}

test('pendente sai do realizado e permanece programado',()=>{
  const {v81,canonical}=compare([tx({status:'pending'})]);
  equal(v81.totals.expense,100);equal(canonical.realized.totalOut,0);equal(canonical.scheduledMaterialized.totalOut,100);
});

test('future_realized sai do realizado com auditoria explícita',()=>{
  const {v81,canonical}=compare([tx({transaction_date:'2026-01-20'})]);
  equal(v81.totals.expense,100);equal(canonical.realized.totalOut,0);equal(canonical.scheduledMaterialized.totalOut,100);ok(canonical.warnings.includes('future_realized:tx'));
});

test('status ausente ou desconhecido deixa de produzir efeito',()=>{
  const rows=[tx({id:'missing',status:null,amount:40}),tx({id:'unknown',status:'mystery',amount:60})];
  const {v81,canonical}=compare(rows);
  equal(v81.totals.expense,100);equal(canonical.realized.totalOut,0);equal(canonical.unclassified.length,2);
});

test('investimento deixa de compartilhar o agregado de saída de consumo',()=>{
  const rows=[tx({id:'expense',amount:200}),tx({id:'investment',transaction_type:'investimento',category:'Investimentos',amount:300,asset_id:'asset'})];
  const {v81,canonical}=compare(rows);
  equal(v81.totals.expense+v81.totals.invest,500);equal(canonical.realized.totalOut,500);
  equal(canonical.realized.consumptionByCategory.Lazer,200);equal(canonical.realized.investment,300);
});

test('virtual entra somente no forecast canônico',()=>{
  const {v81,canonical}=compare([], [rule()]);
  equal(v81.totals.expense,0);equal(canonical.realized.totalOut,0);equal(canonical.projectedVirtual.totalOut,100);equal(canonical.forecast.totalOut,100);
});

test('transferência e resgate não viram receita ou despesa',()=>{
  const rows=[tx({id:'transfer',transaction_type:'transferencia',source_account_id:'a',destination_account_id:'b',amount:300}),tx({id:'rescue',transaction_type:'resgate',account_id:'a',asset_id:'asset',amount:200})];
  const {v81,canonical}=compare(rows);
  equal(v81.totals.income,0);equal(v81.totals.expense,0);equal(canonical.realized.income,0);equal(canonical.realized.totalOut,0);
  equal(canonical.transfers.realized,300);equal(canonical.rescues.realized,200);
});

test('horizonte futuro deixa de depender de transaction materializada',()=>{
  const {v81,canonical}=compare([], [rule({next_date:'2026-01-20'})],{year:2046,month:1});
  equal(v81.rows.length,0);equal(v81.totals.expense,0);equal(canonical.projectedVirtual.totalOut,100);
  equal(canonical.details.projectedVirtual[0].occurrenceDate,'2046-01-20');
});

test('plano mensal preserva números legados na camada planned',()=>{
  const plan={revenue:5000,fixed_expenses:1000,investments:500,comfort:400,goals:300,leisure:200,knowledge:100};
  const legacyValues=context.V81.planValues(plan),legacyTotal=context.V81.planTotal(plan);
  const canonical=projectPlanningPeriod(plan,[],[],{year:2026,month:1,now:'2026-01-15'});
  equal(legacyTotal,canonical.planned.totalOut);equal(legacyValues.Investimentos,canonical.planned.investment);
  equal(legacyValues['Gastos Fixos'],canonical.planned.fixedExpenses);equal(plan.revenue,canonical.planned.revenue);
});

console.log(`planning-comparison: ${testCount} tests, ${assertionCount} assertions passed`);
