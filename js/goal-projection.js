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
const {projectRecurringOccurrences,materializedOccurrenceKey} = recurrenceProjection;

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

function dedupeGoalTransactions(rows,warnings) {
  const seen=new Set(),result=[];
  for(const row of rows) {
    const key=materializedOccurrenceKey(row);
    if(key&&seen.has(key)) {
      warnings.push(`duplicate_materialized:${key}`);
      continue;
    }
    if(key)seen.add(key);
    result.push(row);
  }
  return result;
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
  const linked=dedupeGoalTransactions(transactions.filter(row=>String(row?.goal_id??'')===goalId),warnings);
  const realizedRows=[],scheduledRows=[];
  let realized=0,scheduledMaterialized=0;

  for(const row of linked) {
    const amount=positiveAmount(row?.amount);
    const effect=effectOf(row?.goal_effect);
    const id=row?.id??materializedOccurrenceKey(row)??'unknown';
    if(amount===null){warnings.push(`invalid_amount:${id}`);continue}
    if(!effect){warnings.push(`invalid_goal_effect:${id}`);continue}
    const temporal=temporalState(row,now);
    if(temporal.state==='efetivado') {
      realized+=signed(amount,effect);realizedRows.push(row);
    } else if(temporal.state==='previsto_materializado') {
      scheduledMaterialized+=signed(amount,effect);scheduledRows.push(row);
      if(temporal.warnings.includes('future_realized'))warnings.push(`future_realized:${id}`);
    } else if(temporal.state==='nao_classificado') {
      warnings.push(`unclassified_transaction:${id}`);
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
        materializedOccurrences:linked,
        maxOccurrences:options.maxOccurrences,
        maxIterations:options.maxIterations
      }));
    }
  }
  projectedOccurrences.sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate)||a.key.localeCompare(b.key));

  let projectedVirtual=projectedOccurrences.reduce((sum,item)=>sum+signed(item.amount,item.goalEffect),0);
  const realizedCoverage=baseManual+realized;
  let projectedCoverage=realizedCoverage+scheduledMaterialized+projectedVirtual;
  const effectiveTarget=target??0;
  let estimatedCompletionDate=realizedCoverage>=effectiveTarget&&target!==null?now:null;
  if(!estimatedCompletionDate&&target!==null) {
    let running=realizedCoverage;
    const future=[
      ...scheduledRows.map(row=>({date:financialDate(row),amount:signed(positiveAmount(row.amount),effectOf(row.goal_effect)),key:`materialized|${row.id??''}`})),
      ...projectedOccurrences.map(item=>({date:item.occurrenceDate,amount:signed(item.amount,item.goalEffect),key:item.key}))
    ].sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
    for(const item of future) {
      running+=item.amount;
      if(running>=target){estimatedCompletionDate=item.date;break}
    }
  }

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
