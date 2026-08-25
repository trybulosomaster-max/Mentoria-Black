const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  projectRecurringOccurrences,
  createRecurringOccurrenceCursor,
  reconcileOccurrences,
  reconcileOccurrenceSets,
  projectRecurringForGoal
} = require('../js/recurrence-projection');

let testCount=0;
let assertionCount=0;
function equal(actual,expected,message){assertionCount+=1;assert.strictEqual(actual,expected,message)}
function deepEqual(actual,expected,message){assertionCount+=1;assert.deepStrictEqual(actual,expected,message)}
function ok(actual,message){assertionCount+=1;assert.ok(actual,message)}
function throws(fn,error,message){assertionCount+=1;assert.throws(fn,error,message)}
function test(name,fn){try{fn();testCount+=1}catch(error){error.message=`${name}: ${error.message}`;throw error}}
const dates=rows=>rows.map(row=>row.occurrenceDate);

function project(rule,overrides={}){
  return projectRecurringOccurrences({id:'rule',amount:100,frequency:'monthly',interval:1,next_date:'2026-01-01',active:true,...rule},{horizonStart:'2026-01-01',horizonEnd:'2026-12-31',...overrides});
}

test('mensal preserva dia âncora 28, 29, 30 e 31 sem deriva',()=>{
  deepEqual(dates(project({next_date:'2026-01-28'},{horizonEnd:'2026-04-30'})),['2026-01-28','2026-02-28','2026-03-28','2026-04-28']);
  deepEqual(dates(project({next_date:'2024-01-29'},{horizonStart:'2024-01-01',horizonEnd:'2024-04-30'})),['2024-01-29','2024-02-29','2024-03-29','2024-04-29']);
  deepEqual(dates(project({next_date:'2026-01-30'},{horizonEnd:'2026-04-30'})),['2026-01-30','2026-02-28','2026-03-30','2026-04-30']);
  deepEqual(dates(project({next_date:'2026-01-31'},{horizonEnd:'2026-04-30'})),['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
});

test('mensal respeita virada de ano e interval maior que um',()=>{
  deepEqual(dates(project({next_date:'2026-11-30'},{horizonStart:'2026-11-01',horizonEnd:'2027-02-28'})),['2026-11-30','2026-12-30','2027-01-30','2027-02-28']);
  deepEqual(dates(project({next_date:'2026-01-31',interval:2},{horizonEnd:'2026-07-31'})),['2026-01-31','2026-03-31','2026-05-31','2026-07-31']);
});

test('semanal suporta intervalos sem deriva',()=>{
  deepEqual(dates(project({frequency:'weekly',next_date:'2026-01-01'},{horizonEnd:'2026-01-22'})),['2026-01-01','2026-01-08','2026-01-15','2026-01-22']);
  deepEqual(dates(project({frequency:'weekly',interval:2,next_date:'2026-01-01'},{horizonEnd:'2026-02-01'})),['2026-01-01','2026-01-15','2026-01-29']);
});

test('quinzenal usa blocos exatos de quatorze dias',()=>{
  deepEqual(dates(project({frequency:'biweekly',next_date:'2026-01-25'},{horizonEnd:'2026-03-10'})),['2026-01-25','2026-02-08','2026-02-22','2026-03-08']);
});

test('diária atravessa meses e anos por calendário UTC',()=>{
  deepEqual(dates(project({frequency:'daily',next_date:'2026-12-30'},{horizonStart:'2026-12-30',horizonEnd:'2027-01-02'})),['2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
});

test('anual preserva âncora de leap year quando aplicável',()=>{
  deepEqual(dates(project({frequency:'yearly',next_date:'2024-02-29'},{horizonStart:'2024-01-01',horizonEnd:'2028-12-31'})),['2024-02-29','2025-02-28','2026-02-28','2027-02-28','2028-02-29']);
  deepEqual(dates(project({frequency:'yearly',interval:2,next_date:'2024-02-29'},{horizonStart:'2024-01-01',horizonEnd:'2030-12-31'})),['2024-02-29','2026-02-28','2028-02-29','2030-02-28']);
});

test('ocorrência virtual possui identidade e metadados determinísticos',()=>{
  const [item]=project({id:'abc',amount:'50.25',goal_id:'goal',goal_effect:'withdrawal'});
  deepEqual(item,{kind:'projected_virtual',recurringSeriesId:'abc',occurrenceDate:'2026-01-01',amount:50.25,sourceAccountId:null,destinationAccountId:null,assetId:null,goalId:'goal',goalEffect:'withdrawal',sourceRuleId:'abc',key:'abc|2026-01-01'});
  ok(Object.isFrozen(item));
});

test('next_date prevalece sobre start_date e horizonte inicial filtra passado',()=>{
  deepEqual(dates(project({start_date:'2025-01-01',next_date:'2026-03-01'},{horizonStart:'2026-02-01',horizonEnd:'2026-05-01'})),['2026-03-01','2026-04-01','2026-05-01']);
  deepEqual(dates(project({next_date:null,start_date:'2026-01-15'},{horizonStart:'2026-03-01',horizonEnd:'2026-04-30'})),['2026-03-15','2026-04-15']);
});

test('limites usam a menor data entre horizonte, deadline e end_date',()=>{
  deepEqual(dates(project({end_date:'2026-05-01'},{horizonEnd:'2026-12-31',deadline:'2026-08-01'})),['2026-01-01','2026-02-01','2026-03-01','2026-04-01','2026-05-01']);
  deepEqual(dates(project({end_date:'2026-10-01'},{horizonEnd:'2026-12-31',deadline:'2026-04-01'})),['2026-01-01','2026-02-01','2026-03-01','2026-04-01']);
});

test('regras inativas ou fora do horizonte não geram ocorrências',()=>{
  deepEqual(project({active:false}),[]);
  deepEqual(project({end_date:'2025-12-31'}),[]);
  deepEqual(project({next_date:'2027-01-01'}),[]);
});

test('effective_from, cancelled_at e paused_at limitam projeção',()=>{
  deepEqual(dates(project({effective_from:'2026-03-01'},{horizonEnd:'2026-06-01'})),['2026-03-01','2026-04-01','2026-05-01','2026-06-01']);
  deepEqual(dates(project({cancelled_at:'2026-04-01'},{horizonEnd:'2026-06-01'})),['2026-01-01','2026-02-01','2026-03-01']);
  deepEqual(dates(project({paused_at:'2026-03-15'},{horizonEnd:'2026-06-01'})),['2026-01-01','2026-02-01','2026-03-01']);
});

test('reconciliação prefere IDs estruturais e aceita note legado',()=>{
  const projected=project({id:'12345678-abcd'},{horizonEnd:'2026-04-01'});
  const materialized=[
    {recurring_series_id:'12345678-abcd',recurring_occurrence_date:'2026-01-01'},
    {note:'Recorrência automática • 12345678-abcd',transaction_date:'2026-02-01'}
  ];
  deepEqual(dates(reconcileOccurrences(materialized,projected)),['2026-03-01','2026-04-01']);
  deepEqual(dates(project({id:'12345678-abcd'},{horizonEnd:'2026-04-01',materializedOccurrences:materialized})),['2026-03-01','2026-04-01']);
});

test('reconciliação mantém séries diferentes na mesma data',()=>{
  const projected=[
    {key:'series-a|2026-01-01',recurringSeriesId:'series-a',occurrenceDate:'2026-01-01'},
    {key:'series-b|2026-01-01',recurringSeriesId:'series-b',occurrenceDate:'2026-01-01'}
  ];
  const materialized=[{recurring_series_id:'series-a',recurring_occurrence_date:'2026-01-01',amount:90}];
  const result=reconcileOccurrenceSets(materialized,projected);
  equal(result.materialized.length,1);
  deepEqual(result.projected.map(item=>item.key),['series-b|2026-01-01']);
});

test('mesma série em datas diferentes permanece separada',()=>{
  const projected=[
    {key:'series-a|2026-01-01',recurringSeriesId:'series-a',occurrenceDate:'2026-01-01'},
    {key:'series-a|2026-02-01',recurringSeriesId:'series-a',occurrenceDate:'2026-02-01'}
  ];
  const materialized=[{recurring_series_id:'series-a',recurring_occurrence_date:'2026-01-01'}];
  deepEqual(reconcileOccurrenceSets(materialized,projected).projected.map(item=>item.key),['series-a|2026-02-01']);
});

test('materializado funciona como override mesmo com valor diferente',()=>{
  const projected=[{key:'series-a|2026-01-01',recurringSeriesId:'series-a',occurrenceDate:'2026-01-01',amount:100,goalEffect:'contribution'}];
  const materialized=[{recurring_series_id:'series-a',recurring_occurrence_date:'2026-01-01',amount:125,goal_effect:'contribution'}];
  const result=reconcileOccurrenceSets(materialized,projected);
  equal(result.materialized[0].amount,125);
  equal(result.projected.length,0);
});

test('ID estrutural prevalece sobre note legado conflitante',()=>{
  const projected=[
    {key:'structured|2026-01-01',recurringSeriesId:'structured',occurrenceDate:'2026-01-01'},
    {key:'legacy|2026-01-01',recurringSeriesId:'legacy',occurrenceDate:'2026-01-01'}
  ];
  const materialized=[{recurring_series_id:'structured',note:'Recorrência automática • legacy',transaction_date:'2026-01-01'}];
  deepEqual(reconcileOccurrenceSets(materialized,projected).projected.map(item=>item.key),['legacy|2026-01-01']);
});

test('ID estrutural vazio não bloqueia alias válido da recorrência',()=>{
  const projected=project({id:'alias-series'},{horizonEnd:'2026-02-01'});
  const materialized=[{recurring_series_id:'',recurringSeriesId:'alias-series',recurring_occurrence_date:'2026-01-01'}];
  deepEqual(reconcileOccurrenceSets(materialized,projected).projected.map(item=>item.occurrenceDate),['2026-02-01']);
});

test('duplicata materializada é isolada e não somada duas vezes',()=>{
  const rule={id:'dup-series',amount:100,frequency:'monthly',next_date:'2026-01-01',goal_effect:'contribution'};
  const goal={id:'goal',current:0,target:1000,deadline:'2026-03-01'};
  const materialized=[
    {id:'first',recurring_series_id:'dup-series',recurring_occurrence_date:'2026-01-01',amount:110,goal_effect:'contribution'},
    {id:'duplicate',recurring_series_id:'dup-series',recurring_occurrence_date:'2026-01-01',amount:999,goal_effect:'withdrawal'}
  ];
  const result=projectRecurringForGoal(rule,goal,materialized,{horizonStart:'2026-01-01',horizonEnd:'2026-03-01'});
  equal(result.materialized.length,1);
  equal(result.materialized[0].id,'first');
  equal(result.duplicateMaterialized.length,1);
  equal(result.materializedAmount,110);
  deepEqual(result.projected.map(item=>item.occurrenceDate),['2026-02-01','2026-03-01']);
});

test('withdrawal materializado substitui virtual com direção preservada',()=>{
  const result=projectRecurringForGoal(
    {id:'withdraw-series',amount:50,frequency:'monthly',next_date:'2026-01-01',goal_effect:'withdrawal'},
    {id:'goal',current:500,target:1000,deadline:'2026-02-01'},
    [{recurring_series_id:'withdraw-series',recurring_occurrence_date:'2026-01-01',amount:75,goal_effect:'withdrawal'}],
    {horizonStart:'2026-01-01',horizonEnd:'2026-02-01'}
  );
  equal(result.materializedAmount,-75);
  equal(result.projectedAmount,-50);
  equal(result.projectedCoverage,375);
});

test('reconciliação endurecida não muta arrays ou registros',()=>{
  const materialized=[{recurring_series_id:'series',recurring_occurrence_date:'2026-01-01',amount:100}];
  const projected=[{key:'series|2026-01-01',recurringSeriesId:'series',occurrenceDate:'2026-01-01',amount:90}];
  const beforeMaterialized=JSON.stringify(materialized),beforeProjected=JSON.stringify(projected);
  reconcileOccurrenceSets(materialized,projected);
  equal(JSON.stringify(materialized),beforeMaterialized);
  equal(JSON.stringify(projected),beforeProjected);
});

test('contribution e withdrawal permanecem separados do sinal',()=>{
  equal(project({goal_effect:'contribution'})[0].goalEffect,'contribution');
  equal(project({goal_effect:'withdrawal'})[0].goalEffect,'withdrawal');
  equal(project({goal_effect:'withdrawal'})[0].amount,100);
});

test('entradas inválidas falham explicitamente',()=>{
  throws(()=>project({next_date:'invalid'}),TypeError);
  throws(()=>project({amount:0}),RangeError);
  throws(()=>project({amount:-1}),RangeError);
  throws(()=>project({amount:'NaN'}),RangeError);
  throws(()=>project({frequency:'quarterly'}),TypeError);
  throws(()=>project({interval:0}),RangeError);
  throws(()=>project({goal_effect:'other'}),TypeError);
  throws(()=>project({id:null}),TypeError);
  throws(()=>project({}, {horizonEnd:null}),TypeError);
});

test('maxOccurrences falha sem truncamento silencioso',()=>{
  throws(()=>project({frequency:'daily',next_date:'2026-01-01'},{horizonEnd:'2046-12-31',maxOccurrences:1000}),RangeError);
  equal(project({frequency:'monthly'},{horizonEnd:'2046-12-31',maxOccurrences:300}).length,252);
  equal(project({frequency:'monthly'},{horizonEnd:'2046-12-31',maxOccurrences:252}).length,252);
});

test('Meta 2046 combina 12 materializadas com futuro virtual sem duplicidade',()=>{
  const rule={id:'long-rule',amount:500,frequency:'monthly',interval:1,next_date:'2026-01-01',active:true,goal_id:'car',goal_effect:'contribution'};
  const goal={id:'car',target:200000,current:1000,deadline:'2046-12-01'};
  const materialized=Array.from({length:12},(_,index)=>{
    const month=String(index+1).padStart(2,'0');
    return {id:`tx-${month}`,recurring_series_id:'long-rule',recurring_occurrence_date:`2026-${month}-01`,transaction_date:`2026-${month}-01`,amount:500,goal_id:'car',goal_effect:'contribution'};
  });
  const result=projectRecurringForGoal(rule,goal,materialized,{horizonStart:'2026-01-01',horizonEnd:'2050-12-31',maxOccurrences:400});
  equal(result.materialized.length,12);
  equal(result.projected.length,240);
  equal(result.projected[0].occurrenceDate,'2027-01-01');
  equal(result.projected.at(-1).occurrenceDate,'2046-12-01');
  equal(result.materializedAmount,6000);
  equal(result.projectedAmount,120000);
  equal(result.projectedCoverage,127000);
  equal(new Set([...result.materialized.map(row=>`long-rule|${row.recurring_occurrence_date}`),...result.projected.map(row=>row.key)]).size,252);
  ok(result.projected.every(item=>item.kind==='projected_virtual'));
  ok(result.projected.every(item=>!Object.hasOwn(item,'transaction_type')),'virtual items are not real transactions');
});

test('Meta pode interromper projeção ao atingir target',()=>{
  const result=projectRecurringForGoal(
    {id:'target-rule',amount:100,frequency:'monthly',next_date:'2026-01-01',goal_effect:'contribution'},
    {id:'goal',current:50,target:250,deadline:'2027-12-31'},
    [],
    {horizonStart:'2026-01-01',horizonEnd:'2027-12-31',stopAtTarget:true}
  );
  equal(result.projected.length,2);
  equal(result.projectedCoverage,250);
});

test('cursor continua recorrência indefinida sem criar lote materializado',()=>{
  const cursor=createRecurringOccurrenceCursor(
    {id:'cursor-rule',amount:400,frequency:'monthly',next_date:'2026-10-01',goal_effect:'contribution'},
    {horizonStart:'2031-11-01'}
  );
  equal(cursor.next().occurrenceDate,'2031-11-01');
  equal(cursor.next().occurrenceDate,'2031-12-01');
  equal(cursor.truncated,false);
});

test('cursor respeita término natural e materializações',()=>{
  const cursor=createRecurringOccurrenceCursor(
    {id:'cursor-rule',amount:100,frequency:'monthly',next_date:'2026-01-01',end_date:'2026-04-01',goal_effect:'contribution'},
    {horizonStart:'2026-01-01',materializedOccurrences:[{recurring_series_id:'cursor-rule',recurring_occurrence_date:'2026-02-01'}]}
  );
  equal(cursor.next().occurrenceDate,'2026-01-01');
  equal(cursor.next().occurrenceDate,'2026-03-01');
  equal(cursor.next().occurrenceDate,'2026-04-01');
  equal(cursor.next(),null);equal(cursor.exhausted,true);
});

test('cursor sinaliza guard sem inventar exaustão financeira',()=>{
  const cursor=createRecurringOccurrenceCursor(
    {id:'cursor-rule',amount:1,frequency:'monthly',next_date:'2026-01-01',goal_effect:'contribution'},
    {horizonStart:'2026-01-01',maxOccurrences:2}
  );
  ok(cursor.next());ok(cursor.next());equal(cursor.next(),null);equal(cursor.truncated,true);equal(cursor.exhausted,false);
});

test('projeção e reconciliação não alteram entradas',()=>{
  const rule={id:'immutable',amount:100,frequency:'monthly',next_date:'2026-01-01',goal_effect:'contribution'};
  const options={horizonStart:'2026-01-01',horizonEnd:'2026-03-01',materializedOccurrences:[]};
  const ruleBefore=JSON.stringify(rule),optionsBefore=JSON.stringify(options);
  const projected=projectRecurringOccurrences(rule,options);
  equal(JSON.stringify(rule),ruleBefore);
  equal(JSON.stringify(options),optionsBefore);
  equal(projected.length,3);
});

test('módulo não contém dependências de rede ou persistência',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','recurrence-projection.js'),'utf8');
  ok(!source.includes('supabase'));
  ok(!source.includes('fetch('));
  ok(!source.includes('localStorage'));
  ok(!source.includes('.insert('));
  ok(!source.includes('.update('));
});

console.log(`recurrence-projection: ${testCount} tests, ${assertionCount} assertions passed`);
