const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {goalViewModel,projectGoalsForView}=require('../js/goals-integration');

let testCount=0,assertionCount=0;
function equal(actual,expected,message){assertionCount+=1;assert.strictEqual(actual,expected,message)}
function deepEqual(actual,expected,message){assertionCount+=1;assert.deepStrictEqual(actual,expected,message)}
function ok(actual,message){assertionCount+=1;assert.ok(actual,message)}
function test(name,fn){try{fn();testCount+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}

const NOW='2026-01-01';
const goal=(overrides={})=>({id:'goal',name:'Meta',target:1000,current:0,deadline:'2026-12-31',...overrides});
const tx=(overrides={})=>({id:'tx',goal_id:'goal',goal_effect:'contribution',amount:100,status:'realizado',transaction_date:'2025-12-01',...overrides});
const rule=(overrides={})=>({id:'rule',goal_id:'goal',goal_effect:'contribution',amount:100,frequency:'monthly',interval:1,next_date:'2026-02-01',active:true,...overrides});
const view=(g=goal(),transactions=[],rules=[],options={})=>goalViewModel(g,transactions,rules,{now:NOW,...options});

test('Meta sem recorrência não inventa projeção',()=>{
  const result=view(goal({current:100}),[tx({status:'pending',transaction_date:'2026-02-01',amount:200})]);
  equal(result.realizedTotal,100);equal(result.programmed,200);equal(result.projected,0);
  equal(result.projectedCovered,300);equal(result.remainingReal,900);equal(result.remainingUnplanned,700);
});

test('realizado canônico é separado do programado',()=>{
  const result=view(goal({current:50}),[tx({id:'done',amount:150}),tx({id:'next',status:'scheduled',transaction_date:'2026-02-01',amount:200})]);
  equal(result.baseManual,50);equal(result.realized,150);equal(result.realizedTotal,200);equal(result.programmed,200);
});

test('Meta 2046 combina 12 materializadas e futuro virtual sem duplicidade',()=>{
  const materialized=Array.from({length:12},(_,index)=>tx({
    id:`m${index}`,status:'pending',amount:500,
    transaction_date:`2026-${String(index+1).padStart(2,'0')}-01`,
    recurring_series_id:'long',recurring_occurrence_date:`2026-${String(index+1).padStart(2,'0')}-01`
  }));
  const result=view(goal({target:200000,current:1000,deadline:'2046-12-01'}),materialized,[rule({id:'long',amount:500,next_date:'2026-01-01'})],{maxOccurrences:400});
  equal(result.programmed,6000);equal(result.projectedOccurrences.length,240);equal(result.projected,120000);
  equal(result.projectedCovered,127000);equal(result.projectedOccurrences[0].occurrenceDate,'2027-01-01');
  equal(result.projectedOccurrences.at(-1).occurrenceDate,'2046-12-01');
  equal(new Set(result.projectedOccurrences.map(item=>item.key)).size,240);
});

test('Meta 2056 prova ausência de teto em 2046',()=>{
  const result=view(goal({target:999999,deadline:'2056-12-01'}),[],[rule({amount:500,next_date:'2026-01-01'})],{maxOccurrences:500});
  equal(result.projectedOccurrences.length,372);equal(result.projectedOccurrences.at(-1).occurrenceDate,'2056-12-01');
  equal(result.projected,186000);equal(result.remainingUnplanned,813999);
});

test('contribution e withdrawal preservam direção separada do valor',()=>{
  const result=view(goal({current:500}),[tx({id:'in',amount:200}),tx({id:'out',amount:50,goal_effect:'withdrawal'})],[rule({id:'out-rule',goal_effect:'withdrawal',amount:10})]);
  equal(result.realized,150);equal(result.realizedTotal,650);equal(result.projected,-110);
  ok(result.projectedOccurrences.every(item=>item.amount>0&&item.goalEffect==='withdrawal'));
});

test('múltiplas regras da mesma Meta mantêm identidades distintas',()=>{
  const result=view(goal(),[],[rule({id:'a',amount:100}),rule({id:'b',amount:50})]);
  equal(result.projectedOccurrences.length,22);equal(result.projected,1650);
  equal(new Set(result.projectedOccurrences.map(item=>item.recurringSeriesId)).size,2);
  equal(new Set(result.projectedOccurrences.map(item=>item.key)).size,22);
});

test('regra terminada respeita end_date',()=>{
  const result=view(goal(),[],[rule({end_date:'2026-04-01'})]);
  deepEqual(result.projectedOccurrences.map(item=>item.occurrenceDate),['2026-02-01','2026-03-01','2026-04-01']);
  equal(result.projected,300);
});

test('regra inativa não projeta',()=>{
  const result=view(goal(),[],[rule({active:false})]);
  equal(result.projectedOccurrences.length,0);equal(result.projected,0);equal(result.projectedCovered,0);
});

test('status desconhecido não vira realizado silenciosamente',()=>{
  const result=view(goal(),[tx({status:'mystery',amount:900})]);
  equal(result.realized,0);equal(result.programmed,0);equal(result.projectedCovered,0);
  ok(result.warnings.includes('unclassified_transaction:tx'));
});

test('future_realized aparece como programado e é auditado',()=>{
  const result=view(goal(),[tx({status:'realizado',transaction_date:'2026-02-01',amount:250})]);
  equal(result.realized,0);equal(result.programmed,250);ok(result.warnings.includes('future_realized:tx'));
});

test('materializado estrutural prevalece sobre virtual equivalente',()=>{
  const row=tx({status:'pending',transaction_date:'2026-02-01',amount:175,recurring_series_id:'rule',recurring_occurrence_date:'2026-02-01'});
  const result=view(goal(),[row],[rule({amount:100})]);
  equal(result.programmed,175);equal(result.projectedOccurrences.length,10);
  equal(result.projectedOccurrences[0].occurrenceDate,'2026-03-01');equal(result.projected,1000);
});

test('materializado legado por note também prevalece',()=>{
  const row=tx({status:'pending',transaction_date:'2026-02-01',note:'Recorrência automática • abcdef12',amount:125});
  const result=view(goal(),[row],[rule({id:'abcdef12'})]);
  equal(result.programmed,125);equal(result.projectedOccurrences.length,10);equal(result.projectedOccurrences[0].occurrenceDate,'2026-03-01');
});

test('base manual participa do realizado e da cobertura',()=>{
  const result=view(goal({current:300}),[tx({amount:200})]);
  equal(result.baseManual,300);equal(result.realized,200);equal(result.realizedTotal,500);
  equal(result.projectedCovered,500);equal(result.remainingReal,500);
});

test('Meta concluída usa somente cobertura efetivada para conclusão',()=>{
  const result=view(goal({target:500,current:400}),[tx({amount:100})],[rule()]);
  equal(result.isCompleted,true);equal(result.status,'completed');equal(result.estimatedCompletionDate,NOW);equal(result.remainingReal,0);
});

test('Meta sem cobertura suficiente mantém falta não planejada',()=>{
  const result=view(goal({target:5000}),[],[rule({amount:10})]);
  equal(result.isCompleted,false);equal(result.status,'no_forecast');equal(result.projected,110);equal(result.remainingUnplanned,4890);
});

test('Meta sem deadline funciona sem inventar horizonte virtual',()=>{
  const result=view(goal({deadline:null,current:100}),[tx({status:'pending',transaction_date:'2026-02-01',amount:50})],[]);
  equal(result.deadline,null);equal(result.projected,0);equal(result.programmed,50);equal(result.projectedCovered,150);
});

test('prazo já encerrado não projeta ocorrências retroativas',()=>{
  const result=view(goal({deadline:'2025-12-31'}),[],[rule({next_date:'2025-01-01'})]);
  equal(result.projected,0);equal(result.projectedOccurrences.length,0);ok(result.warnings.includes('projection_horizon_elapsed'));
});

test('coleções e objetos de entrada não são mutados',()=>{
  const goals=[goal()],transactions=[tx()],rules=[rule()],options={now:NOW};
  const before=JSON.stringify({goals,transactions,rules,options});
  const result=projectGoalsForView(goals,transactions,rules,options);
  equal(JSON.stringify({goals,transactions,rules,options}),before);equal(result.length,1);ok(Object.isFrozen(result[0]));
});

test('módulos carregam no navegador sem CommonJS',()=>{
  const context={console};context.globalThis=context;vm.createContext(context);
  for(const file of ['financial-core.js','recurrence-projection.js','goal-projection.js','goals-integration.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',file),'utf8'),context,{filename:file});
  }
  ok(context.MBCanonicalFinance);ok(context.MBRecurrenceProjection);ok(context.MBGoalProjection);ok(context.MBGoalsV82);
  const result=context.MBGoalsV82.goalViewModel(goal(),[],[],{now:NOW});
  equal(result.projected,0);equal(result.realizedTotal,0);
});

console.log(`goals-long-term-integration: ${testCount} tests, ${assertionCount} assertions passed`);
