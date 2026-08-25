(function(root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(require('./financial-core'), require('./recurrence-projection'))
    : factory(root?.MBCanonicalFinance, root?.MBRecurrenceProjection);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MBGoalProjection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(financialCore, recurrenceProjection) {
'use strict';

if (!financialCore || !recurrenceProjection) throw new Error('Canonical goal projection dependencies are unavailable');
const {temporalState,financialDate} = financialCore;
const {projectRecurringOccurrences,createRecurringOccurrenceCursor,materializedOccurrenceKey} = recurrenceProjection;

function finiteNumber(value,fallback=0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function positiveAmount(value) {
  const number=Number(value);
  return Number.isFinite(number)&&number>0?number:null;
}

function dateOnly(value) {
  return financialDate({transaction_date:value});
}

function requiredNow(value) {
  const date=dateOnly(value);
  if(!date)throw new TypeError('options.now must be a valid date');
  return date;
}

function effectOf(value) {
  const effect=String(value??'contribution').trim().toLowerCase();
  return effect==='contribution'||effect==='withdrawal'?effect:null;
}

function signed(amount,effect) {
  return effect==='withdrawal'?-amount:amount;
}

function dedupeGoalTransactions(records,warnings) {
  const seen=new Set(),result=[];
  for(const record of records) {
    const row=record.row;
    const key=materializedOccurrenceKey(row);
    if(key&&seen.has(key)) {
      warnings.push(`duplicate_materialized:${key}`);
      continue;
    }
    if(key)seen.add(key);
    result.push(record);
  }
  return result;
}

function classifiedGoalTransactions(rows,now,warnings) {
  const classified=[];
  for(const row of rows) {
    const id=row?.id??materializedOccurrenceKey(row)??'unknown';
    const temporal=temporalState(row,now);
    if(temporal.state==='cancelado') continue;
    if(temporal.state==='nao_classificado') {
      warnings.push(`unclassified_transaction:${id}`);
      continue;
    }
    const amount=positiveAmount(row?.amount);
    if(amount===null){warnings.push(`invalid_amount:${id}`);continue}
    const effect=effectOf(row?.goal_effect);
    if(!effect){warnings.push(`invalid_goal_effect:${id}`);continue}
    if(!temporal.financialDate) {
      warnings.push(`invalid_financial_date:${id}`);
      continue;
    }
    classified.push({row,amount,effect,temporal,date:temporal.financialDate,id});
  }
  return dedupeGoalTransactions(classified,warnings);
}

function completionForecast(target,realizedCoverage,scheduledRecords,rules,materialized,now,completionHorizonEnd,options,warnings) {
  if(target===null)return null;
  if(realizedCoverage>=target)return now;
  const scheduled=scheduledRecords.map(record=>({
    date:record.date<now?now:record.date,
    amount:signed(record.amount,record.effect),
    key:`materialized|${record.id}`
  })).sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
  const maxOccurrences=options.completionMaxOccurrences??Math.max(10000,Number(options.maxOccurrences)||0);
  const cursors=rules.map(rule=>createRecurringOccurrenceCursor(rule,{
    horizonStart:now,
    horizonEnd:completionHorizonEnd||undefined,
    materializedOccurrences:materialized,
    maxOccurrences,
    maxIterations:options.completionMaxIterations
  }));
  const streams=cursors.map(cursor=>({cursor,item:cursor.next()}));
  const stopIfTruncated=()=>{
    const truncated=cursors.filter(cursor=>cursor.truncated);
    for(const cursor of truncated)warnings.push(`completion_projection_truncated:${cursor.recurringSeriesId}`);
    return truncated.length>0;
  };
  let scheduledIndex=0,running=realizedCoverage;
  if(stopIfTruncated())return null;

  while(scheduledIndex<scheduled.length||streams.some(stream=>stream.item)) {
    let date=scheduledIndex<scheduled.length?scheduled[scheduledIndex].date:null;
    for(const stream of streams) {
      if(stream.item&&(!date||stream.item.occurrenceDate<date))date=stream.item.occurrenceDate;
    }
    let movement=0;
    while(scheduledIndex<scheduled.length&&scheduled[scheduledIndex].date===date) {
      movement+=scheduled[scheduledIndex].amount;
      scheduledIndex+=1;
    }
    for(const stream of streams) {
      while(stream.item&&stream.item.occurrenceDate===date) {
        movement+=signed(stream.item.amount,stream.item.goalEffect);
        stream.item=stream.cursor.next();
      }
    }
    running+=movement;
    if(running>=target)return date;
    if(stopIfTruncated())return null;
  }
  return null;
}

function projectGoal(goal,transactions,recurringRules,options={}) {
  if(!goal||typeof goal!=='object'||Array.isArray(goal))throw new TypeError('goal must be an object');
  if(!Array.isArray(transactions))throw new TypeError('transactions must be an array');
  if(!Array.isArray(recurringRules))throw new TypeError('recurringRules must be an array');
  const now=requiredNow(options.now);
  const deadline=goal.deadline?dateOnly(goal.deadline):'';
  if(goal.deadline&&!deadline)throw new TypeError('goal.deadline must be a valid date');
  const horizonEnd=dateOnly(options.horizonEnd??deadline);
  if(!horizonEnd)throw new TypeError('horizonEnd is required when goal has no deadline');
  const horizonStart=dateOnly(options.horizonStart??now);
  if(!horizonStart)throw new TypeError('horizonStart must be a valid date');

  const warnings=[];
  const target=positiveAmount(goal.target);
  if(target===null)warnings.push('invalid_target');
  const baseManual=finiteNumber(goal.current,0);
  if(!Number.isFinite(Number(goal.current??0)))warnings.push('invalid_base_manual');
  const goalId=String(goal.id??'');
  const materializedRows=transactions.filter(row=>String(row?.goal_id??'')===goalId);
  const linkedRecords=classifiedGoalTransactions(materializedRows,now,warnings);
  const realizedRows=[],scheduledRows=[];
  const scheduledRecords=[];
  let realized=0,scheduledMaterialized=0;

  for(const record of linkedRecords) {
    if(record.temporal.state==='efetivado') {
      realized+=signed(record.amount,record.effect);realizedRows.push(record.row);
    } else if(record.temporal.state==='previsto_materializado') {
      scheduledRecords.push(record);
      if(!deadline||record.date<=deadline) {
        scheduledMaterialized+=signed(record.amount,record.effect);scheduledRows.push(record.row);
      }
      if(record.temporal.warnings.includes('future_realized'))warnings.push(`future_realized:${record.id}`);
    }
  }

  const rules=recurringRules.filter(rule=>String(rule?.goal_id??'')===goalId);
  let projectedOccurrences=[];
  if(horizonStart>horizonEnd) {
    warnings.push('projection_horizon_elapsed');
  } else {
    for(const rule of rules) {
      projectedOccurrences.push(...projectRecurringOccurrences(rule,{
        horizonStart,
        horizonEnd,
        deadline:deadline||undefined,
        materializedOccurrences:materializedRows,
        maxOccurrences:options.maxOccurrences,
        maxIterations:options.maxIterations
      }));
    }
  }
  projectedOccurrences.sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate)||a.key.localeCompare(b.key));

  let projectedVirtual=projectedOccurrences.reduce((sum,item)=>sum+signed(item.amount,item.goalEffect),0);
  const realizedCoverage=baseManual+realized;
  let projectedCoverage=realizedCoverage+scheduledMaterialized+projectedVirtual;
  const estimatedCompletionDate=completionForecast(target,realizedCoverage,scheduledRecords,rules,materializedRows,now,deadline?'':horizonEnd,options,warnings);

  if(options.projectionMode==='until_target'&&estimatedCompletionDate) {
    projectedOccurrences=projectedOccurrences.filter(item=>item.occurrenceDate<=estimatedCompletionDate);
    projectedVirtual=projectedOccurrences.reduce((sum,item)=>sum+signed(item.amount,item.goalEffect),0);
    projectedCoverage=realizedCoverage+scheduledMaterialized+projectedVirtual;
  } else if(options.projectionMode!==undefined&&options.projectionMode!=='full') {
    throw new TypeError('projectionMode must be full or until_target');
  }

  return {
    target:target??0,
    baseManual,
    realized,
    scheduledMaterialized,
    projectedVirtual,
    projectedCoverage,
    remainingReal:Math.max(0,(target??0)-realizedCoverage),
    remainingUnplanned:Math.max(0,(target??0)-projectedCoverage),
    estimatedCompletionDate,
    deadline:deadline||null,
    onTrack:deadline&&estimatedCompletionDate?estimatedCompletionDate<=deadline:deadline?false:null,
    warnings,
    realizedTransactions:realizedRows.slice(),
    scheduledTransactions:scheduledRows.slice(),
    projectedOccurrences:projectedOccurrences.slice()
  };
}

return Object.freeze({projectGoal});
});
