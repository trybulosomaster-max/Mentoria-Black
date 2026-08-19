const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {projectGoal}=require('../js/goal-projection');

let testCount=0,assertionCount=0;
function equal(a,e,m){assertionCount+=1;assert.strictEqual(a,e,m)}
function ok(a,m){assertionCount+=1;assert.ok(a,m)}
function test(name,fn){try{fn();testCount+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function parseMoney');
const end=html.indexOf('function categoryOptions',start);
assert(start>=0&&end>start,'V81 finance/goal source block must exist');
const context={DATA:{goals:[],transactions:[],recurring:[],categories:[]},window:null,console};
context.window=context;
vm.createContext(context);
vm.runInContext(`${html.slice(start,end)};this.MBGoalsApi=MBGoals;`,context);
const vmDate=iso=>vm.runInContext(`new Date(${JSON.stringify(iso)})`,context);
const NOW='2026-01-01';

function compare(goal,transactions=[],recurring=[],options={}){
  const legacy=context.MBGoalsApi.metrics(goal,{transactions,recurring,now:vmDate(`${NOW}T12:00:00`)});
  const canonical=projectGoal(goal,transactions,recurring,{now:NOW,...options});
  return {legacy,canonical};
}

test('base manual permanece semanticamente equivalente',()=>{
  const {legacy,canonical}=compare({id:'g',target:1000,current:250,deadline:'2026-12-31'});
  equal(legacy.baseManual,250);equal(canonical.baseManual,250);equal(legacy.realized,250);equal(canonical.baseManual+canonical.realized,250);
});

test('status desconhecido continua fora da cobertura, mas canônico o audita',()=>{
  const row={id:'unknown',goal_id:'g',amount:100,status:'legacy',transaction_date:'2025-12-01',goal_effect:'contribution'};
  const {legacy,canonical}=compare({id:'g',target:1000,current:0,deadline:'2026-12-31'},[row]);
  equal(legacy.realized,0);equal(canonical.realized,0);equal(legacy.transactions.ignored[0].reason,'unrecognized_status');ok(canonical.warnings.includes('unclassified_transaction:unknown'));
});

test('future_realized é previsto nos dois motores e explicitamente auditado',()=>{
  const row={id:'future',goal_id:'g',amount:100,status:'realizado',transaction_date:'2026-02-01',goal_effect:'contribution'};
  const {legacy,canonical}=compare({id:'g',target:1000,current:0,deadline:'2026-12-31'},[row]);
  equal(legacy.programmed,100);equal(legacy.transactions.futureRealized.length,1);equal(canonical.scheduledMaterialized,100);ok(canonical.warnings.includes('future_realized:future'));
});

test('programado e scheduled passados divergem intencionalmente da V81',()=>{
  const rows=[
    {id:'programado',goal_id:'g',amount:100,status:'programado',transaction_date:'2025-11-01',goal_effect:'contribution'},
    {id:'scheduled',goal_id:'g',amount:50,status:'scheduled',transaction_date:'2025-12-01',goal_effect:'contribution'}
  ];
  const {legacy,canonical}=compare({id:'g',target:1000,current:0,deadline:'2026-12-31'},rows);
  equal(legacy.programmed,0);equal(legacy.transactions.ignored.length,2);equal(canonical.scheduledMaterialized,150);equal(canonical.scheduledTransactions.length,2);
});

test('projeção além de 12 meses existe somente no motor canônico',()=>{
  const goal={id:'g',target:200000,current:1000,deadline:'2046-12-01'};
  const rule={id:'abcdef12',goal_id:'g',amount:500,frequency:'monthly',interval:1,next_date:'2026-01-01',active:true,goal_effect:'contribution'};
  const materialized=Array.from({length:12},(_,index)=>({id:`m${index}`,goal_id:'g',amount:500,status:'pending',transaction_date:`2026-${String(index+1).padStart(2,'0')}-01`,recurring_series_id:'abcdef12',recurring_occurrence_date:`2026-${String(index+1).padStart(2,'0')}-01`,goal_effect:'contribution',note:'Recorrência automática • abcdef12'}));
  const {legacy,canonical}=compare(goal,materialized,[rule],{maxOccurrences:400});
  equal(legacy.programmed,6000);equal(legacy.projectedCovered,7000);equal(canonical.scheduledMaterialized,6000);equal(canonical.projectedVirtual,120000);equal(canonical.projectedCoverage,127000);equal(canonical.projectedOccurrences.at(-1).occurrenceDate,'2046-12-01');
});

test('end_date limita canônico enquanto ritmo V81 continua indefinido pelo término',()=>{
  const goal={id:'g',target:1000,current:0,deadline:'2027-12-31'};
  const rule={id:'abcdef12',goal_id:'g',amount:100,frequency:'monthly',interval:1,next_date:'2026-01-01',end_date:'2026-03-01',active:true,goal_effect:'contribution'};
  const {legacy,canonical}=compare(goal,[],[rule]);
  equal(legacy.recurringMonthlyPace,100);ok(legacy.estimatedCompletionDate!==null);equal(canonical.projectedVirtual,300);equal(canonical.estimatedCompletionDate,null);
});

test('withdrawal permanece separado e reduz cobertura canônica virtual',()=>{
  const goal={id:'g',target:1000,current:500,deadline:'2026-03-01'};
  const rows=[{id:'out',goal_id:'g',amount:100,status:'realizado',transaction_date:'2025-12-01',goal_effect:'withdrawal'}];
  const rule={id:'abcdef12',goal_id:'g',amount:50,frequency:'monthly',next_date:'2026-01-01',active:true,goal_effect:'withdrawal'};
  const {legacy,canonical}=compare(goal,rows,[rule]);
  equal(legacy.realized,400);equal(canonical.baseManual+canonical.realized,400);equal(legacy.recurringMonthlyPace,null);equal(canonical.projectedVirtual,-150);equal(canonical.projectedCoverage,250);
});

console.log(`goal-projection-comparison: ${testCount} tests, ${assertionCount} assertions passed`);
