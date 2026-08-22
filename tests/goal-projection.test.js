const assert=require('assert');
const {projectGoal}=require('../js/goal-projection');

let testCount=0,assertionCount=0;
function equal(a,e,m){assertionCount+=1;assert.strictEqual(a,e,m)}
function deepEqual(a,e,m){assertionCount+=1;assert.deepStrictEqual(a,e,m)}
function ok(a,m){assertionCount+=1;assert.ok(a,m)}
function throws(fn,e,m){assertionCount+=1;assert.throws(fn,e,m)}
function test(name,fn){try{fn();testCount+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}
const NOW='2026-01-01';
const baseGoal={id:'goal',target:1000,current:0,deadline:'2026-12-31'};
const tx=(overrides={})=>({id:'tx',goal_id:'goal',goal_effect:'contribution',amount:100,status:'realizado',transaction_date:'2025-12-01',...overrides});
const rule=(overrides={})=>({id:'rule',goal_id:'goal',goal_effect:'contribution',amount:100,frequency:'monthly',interval:1,next_date:'2026-02-01',active:true,...overrides});
const project=(goal=baseGoal,transactions=[],rules=[],options={})=>projectGoal(goal,transactions,rules,{now:NOW,...options});

test('Meta curta sem recorrência usa apenas base manual',()=>{
  const result=project({...baseGoal,current:200,target:500},[],[]);
  equal(result.baseManual,200);equal(result.realized,0);equal(result.projectedCoverage,200);equal(result.remainingReal,300);equal(result.remainingUnplanned,300);
});

test('Meta com apenas realizado separa base e movimentos',()=>{
  const result=project({...baseGoal,current:50},[tx({amount:200})],[]);
  equal(result.realized,200);equal(result.projectedCoverage,250);equal(result.realizedTransactions.length,1);
});

test('Meta com materializado futuro não promove valor a realizado',()=>{
  const result=project(baseGoal,[tx({status:'pending',transaction_date:'2026-02-01',amount:150})],[]);
  equal(result.realized,0);equal(result.scheduledMaterialized,150);equal(result.projectedCoverage,150);
});

test('Meta com uma recorrência projeta até deadline',()=>{
  const result=project(baseGoal,[],[rule()]);
  equal(result.projectedOccurrences.length,11);equal(result.projectedVirtual,1100);equal(result.projectedOccurrences.at(-1).occurrenceDate,'2026-12-01');
});

test('duas recorrências da mesma Meta permanecem independentes',()=>{
  const result=project(baseGoal,[],[rule({id:'a',amount:100}),rule({id:'b',amount:50})]);
  equal(result.projectedOccurrences.length,22);equal(result.projectedVirtual,1650);equal(new Set(result.projectedOccurrences.map(item=>item.key)).size,22);
});

test('aporte e retirada usam goal_effect sem valor negativo',()=>{
  const result=project(baseGoal,[tx({id:'in',amount:300}),tx({id:'out',amount:80,goal_effect:'withdrawal'})],[rule({id:'withdraw',amount:20,goal_effect:'withdrawal'})]);
  equal(result.realized,220);equal(result.projectedVirtual,-220);ok(result.projectedOccurrences.every(item=>item.amount>0));
});

test('recorrência com end_date termina antes da Meta',()=>{
  const result=project({...baseGoal,deadline:'2027-12-31'},[],[rule({end_date:'2026-04-01'})]);
  deepEqual(result.projectedOccurrences.map(item=>item.occurrenceDate),['2026-02-01','2026-03-01','2026-04-01']);
});

test('recorrência cancelada não projeta após cancelled_at',()=>{
  const result=project(baseGoal,[],[rule({cancelled_at:'2026-04-01'})]);
  deepEqual(result.projectedOccurrences.map(item=>item.occurrenceDate),['2026-02-01','2026-03-01']);
});

test('Meta sem deadline exige e aceita horizonte explícito',()=>{
  throws(()=>project({...baseGoal,deadline:null},[],[rule()]),TypeError);
  const result=project({...baseGoal,deadline:null},[],[rule()],{horizonEnd:'2026-05-01'});
  equal(result.deadline,null);equal(result.onTrack,null);equal(result.projectedOccurrences.length,4);
});

test('status desconhecido é auditado e excluído da cobertura',()=>{
  const result=project(baseGoal,[tx({status:'mystery',amount:900})],[]);
  equal(result.realized,0);equal(result.scheduledMaterialized,0);ok(result.warnings.includes('unclassified_transaction:tx'));
});

test('Meta já concluída usa now como conclusão',()=>{
  const result=project({...baseGoal,current:1000},[],[]);
  equal(result.estimatedCompletionDate,NOW);equal(result.remainingReal,0);equal(result.onTrack,true);
});

test('Meta que não será atingida não inventa conclusão',()=>{
  const result=project({...baseGoal,target:5000},[],[rule({amount:10})]);
  equal(result.estimatedCompletionDate,null);equal(result.onTrack,false);ok(result.remainingUnplanned>0);
});

test('Meta atingida antes do prazo calcula primeira ocorrência suficiente',()=>{
  const result=project({...baseGoal,target:250,current:50},[],[rule({amount:100})]);
  equal(result.estimatedCompletionDate,'2026-03-01');equal(result.onTrack,true);
  const compact=project({...baseGoal,target:250,current:50},[],[rule({amount:100})],{projectionMode:'until_target'});
  equal(compact.projectedOccurrences.length,2);equal(compact.projectedCoverage,250);
});

for(const [years,label] of [[5,'5 anos'],[10,'10 anos'],[20,'20 anos'],[30,'além de 20 anos']]){
  test(`Meta de ${label} não depende de teto fixo`,()=>{
    const endYear=2026+years;
    const result=project({id:'goal',target:999999,current:0,deadline:`${endYear}-01-01`},[],[rule({next_date:'2026-02-01'})],{maxOccurrences:500});
    equal(result.projectedOccurrences.at(-1).occurrenceDate,`${endYear}-01-01`);
    ok(result.projectedOccurrences.length>=years*12-1);
  });
}

test('Meta 2046 reconcilia 12 meses materializados com restante virtual',()=>{
  const materialized=Array.from({length:12},(_,index)=>tx({id:`m${index}`,status:'pending',transaction_date:`2026-${String(index+1).padStart(2,'0')}-01`,recurring_series_id:'long',recurring_occurrence_date:`2026-${String(index+1).padStart(2,'0')}-01`,amount:500}));
  const result=projectGoal({id:'goal',target:200000,current:1000,deadline:'2046-12-01'},materialized,[rule({id:'long',next_date:'2026-01-01',amount:500})],{now:NOW,maxOccurrences:400});
  equal(result.scheduledMaterialized,6000);equal(result.projectedOccurrences.length,240);equal(result.projectedVirtual,120000);equal(result.projectedCoverage,127000);equal(result.projectedOccurrences[0].occurrenceDate,'2027-01-01');equal(result.projectedOccurrences.at(-1).occurrenceDate,'2046-12-01');
});

test('Meta 2056 prova horizonte posterior a 2046',()=>{
  const result=projectGoal({id:'goal',target:999999,current:0,deadline:'2056-12-01'},[],[rule({next_date:'2026-01-01',amount:500})],{now:NOW,maxOccurrences:500});
  equal(result.projectedOccurrences.at(-1).occurrenceDate,'2056-12-01');equal(result.projectedOccurrences.length,372);
});

test('future_realized permanece programado materializado com warning',()=>{
  const result=project(baseGoal,[tx({status:'realizado',transaction_date:'2026-02-01'})],[]);
  equal(result.realized,0);equal(result.scheduledMaterialized,100);ok(result.warnings.includes('future_realized:tx'));
});

test('programado e scheduled são programados materializados',()=>{
  const result=project(baseGoal,[tx({id:'a',status:'programado'}),tx({id:'b',status:'scheduled'})],[]);
  equal(result.scheduledMaterialized,200);equal(result.realized,0);
});

test('duplicata recorrente materializada não é somada duas vezes',()=>{
  const rows=[tx({id:'a',recurring_series_id:'series',recurring_occurrence_date:'2025-12-01'}),tx({id:'b',recurring_series_id:'series',recurring_occurrence_date:'2025-12-01',amount:999})];
  const result=project(baseGoal,rows,[]);
  equal(result.realized,100);ok(result.warnings.includes('duplicate_materialized:series|2025-12-01'));
});

test('entradas não são mutadas',()=>{
  const goal={...baseGoal},transactions=[tx()],rules=[rule()],options={now:NOW};
  const before=JSON.stringify({goal,transactions,rules,options});projectGoal(goal,transactions,rules,options);
  equal(JSON.stringify({goal,transactions,rules,options}),before);
});

console.log(`goal-projection: ${testCount} tests, ${assertionCount} assertions passed`);
