(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MBRecurrenceProjection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
'use strict';

const FREQUENCIES = new Set(['daily','weekly','biweekly','monthly','yearly']);

function validDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  const raw = String(value ?? '').trim();
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (match) {
    const [,year,month,day] = match.map(Number);
    return validDate(year,month,day) ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : '';
  }
  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:$|\s)/);
  if (match) {
    const [,day,month,year] = match.map(Number);
    return validDate(year,month,day) ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : '';
  }
  return '';
}

function requiredDate(value, name) {
  const result = dateOnly(value);
  if (!result) throw new TypeError(`${name} must be a valid date`);
  return result;
}

function positiveAmount(value, name = 'amount') {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value > 0) return value;
    throw new RangeError(`${name} must be a positive finite number`);
  }
  if (typeof value === 'string' && /^(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    const amount = Number(value.trim());
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  throw new RangeError(`${name} must be a positive finite number`);
}

function dateParts(value) {
  return {year:Number(value.slice(0,4)),month:Number(value.slice(5,7)),day:Number(value.slice(8,10))};
}

function daysInMonth(year,month) {
  return new Date(Date.UTC(year,month,0)).getUTCDate();
}

function addDays(anchor,days) {
  const parts = dateParts(anchor);
  const value = new Date(Date.UTC(parts.year,parts.month-1,parts.day + days));
  return value.toISOString().slice(0,10);
}

function addMonthsAnchored(anchor,months) {
  const parts = dateParts(anchor);
  const index = parts.year * 12 + parts.month - 1 + months;
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  const day = Math.min(parts.day,daysInMonth(year,month));
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function addYearsAnchored(anchor,years) {
  const parts = dateParts(anchor);
  const year = parts.year + years;
  const day = Math.min(parts.day,daysInMonth(year,parts.month));
  return `${year}-${String(parts.month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function occurrenceDate(anchor,frequency,interval,index) {
  const step = interval * index;
  if (frequency === 'daily') return addDays(anchor,step);
  if (frequency === 'weekly') return addDays(anchor,7*step);
  if (frequency === 'biweekly') return addDays(anchor,14*step);
  if (frequency === 'monthly') return addMonthsAnchored(anchor,step);
  return addYearsAnchored(anchor,step);
}

function earlierDate(...values) {
  const dates = values.filter(Boolean);
  return dates.length ? dates.reduce((earliest,value)=>value < earliest ? value : earliest) : '';
}

function laterDate(...values) {
  const dates = values.filter(Boolean);
  return dates.length ? dates.reduce((latest,value)=>value > latest ? value : latest) : '';
}

function ruleSeriesId(rule) {
  const value = rule?.recurring_series_id ?? rule?.id;
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new TypeError('rule id or recurring_series_id is required');
  }
  return String(value);
}

function goalEffect(value) {
  const normalized = String(value ?? 'contribution').trim().toLowerCase();
  if (normalized !== 'contribution' && normalized !== 'withdrawal') {
    throw new TypeError('goal_effect must be contribution or withdrawal');
  }
  return normalized;
}

function projectionBounds(rule, options) {
  const horizonStart = requiredDate(options?.horizonStart ?? options?.now,'horizonStart');
  const horizonEnd = requiredDate(options?.horizonEnd,'horizonEnd');
  if (horizonStart > horizonEnd) throw new RangeError('horizonStart must not be after horizonEnd');

  const deadline = options?.deadline ? requiredDate(options.deadline,'deadline') : '';
  const endDate = rule?.end_date ? requiredDate(rule.end_date,'end_date') : '';
  const effectiveFrom = rule?.effective_from ? requiredDate(rule.effective_from,'effective_from') : '';
  const cancelledAt = rule?.cancelled_at ? addDays(requiredDate(rule.cancelled_at,'cancelled_at'),-1) : '';
  const pausedAt = rule?.paused_at ? addDays(requiredDate(rule.paused_at,'paused_at'),-1) : '';
  return {
    start: laterDate(horizonStart,effectiveFrom),
    end: earlierDate(horizonEnd,deadline,endDate,cancelledAt,pausedAt)
  };
}

function materializedSeriesId(row) {
  const structured = row?.recurring_series_id ?? row?.recurringSeriesId ?? row?.source_rule_id;
  if (structured !== undefined && structured !== null && String(structured).trim()) return String(structured);
  const note = String(row?.note ?? '');
  return (note.match(/Recorrência automática\s*•\s*([^\s•]+)/i) || [])[1] || '';
}

function materializedDate(row) {
  return dateOnly(row?.recurring_occurrence_date)
    || dateOnly(row?.occurrence_date)
    || ['transaction_date','date','due_date','created_at'].map(field=>dateOnly(row?.[field])).find(Boolean)
    || '';
}

function occurrenceKey(seriesId,date) {
  return `${seriesId}|${date}`;
}

function materializedOccurrenceKey(row) {
  const seriesId = materializedSeriesId(row);
  const date = materializedDate(row);
  return seriesId && date ? occurrenceKey(seriesId,date) : null;
}

function reconcileOccurrenceSets(materialized,projected) {
  if (!Array.isArray(materialized) || !Array.isArray(projected)) throw new TypeError('materialized and projected must be arrays');
  const keys = new Set(), canonicalMaterialized = [], duplicateMaterialized = [];
  for (const row of materialized) {
    const seriesId = materializedSeriesId(row);
    const date = materializedDate(row);
    if (!seriesId || !date) continue;
    const key = occurrenceKey(seriesId,date);
    if (keys.has(key)) {
      duplicateMaterialized.push(row);
      continue;
    }
    keys.add(key);
    canonicalMaterialized.push(row);
  }
  return {
    materialized:canonicalMaterialized,
    projected:projected.filter(item=>!keys.has(item.key)),
    duplicateMaterialized
  };
}

function reconcileOccurrences(materialized,projected) {
  return reconcileOccurrenceSets(materialized,projected).projected;
}

function projectRecurringOccurrences(rule, options = {}) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new TypeError('rule must be an object');
  if (rule.active === false) return [];

  const recurringSeriesId = ruleSeriesId(rule);
  const frequency = String(rule.frequency ?? 'monthly').trim().toLowerCase();
  if (!FREQUENCIES.has(frequency)) throw new TypeError(`unsupported frequency: ${frequency}`);
  const interval = Number(rule.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1) throw new RangeError('interval must be a positive integer');
  const amount = positiveAmount(rule.amount);
  const effect = goalEffect(rule.goal_effect);
  const anchor = requiredDate(rule.next_date ?? rule.start_date,'next_date or start_date');
  const bounds = projectionBounds(rule,options);
  if (anchor > bounds.end || bounds.start > bounds.end) return [];

  const maxOccurrences = Number(options.maxOccurrences ?? 1000);
  if (!Number.isInteger(maxOccurrences) || maxOccurrences < 1) throw new RangeError('maxOccurrences must be a positive integer');
  const maxIterations = Number(options.maxIterations ?? Math.max(10000,maxOccurrences*10));
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw new RangeError('maxIterations must be a positive integer');

  const projected = [];
  let index = 0;
  while (true) {
    if (index >= maxIterations) throw new RangeError(`maxIterations exceeded for recurring series ${recurringSeriesId}`);
    const date = occurrenceDate(anchor,frequency,interval,index);
    if (date > bounds.end) break;
    if (date >= bounds.start) {
      if (projected.length >= maxOccurrences) throw new RangeError(`maxOccurrences exceeded for recurring series ${recurringSeriesId}`);
      projected.push(Object.freeze({
        kind:'projected_virtual',
        recurringSeriesId,
        occurrenceDate:date,
        amount,
        sourceAccountId:rule.source_account_id ?? null,
        destinationAccountId:rule.destination_account_id ?? null,
        assetId:rule.asset_id ?? null,
        goalId:rule.goal_id ?? null,
        goalEffect:effect,
        sourceRuleId:String(rule.id ?? recurringSeriesId),
        key:occurrenceKey(recurringSeriesId,date)
      }));
    }
    index += 1;
  }

  return reconcileOccurrences(options.materializedOccurrences ?? [],projected);
}

function signedGoalAmount(item) {
  const amount = positiveAmount(item?.amount,'materialized amount');
  return goalEffect(item?.goal_effect ?? item?.goalEffect) === 'withdrawal' ? -amount : amount;
}

function projectRecurringForGoal(rule, goal, materialized = [], options = {}) {
  if (!goal || typeof goal !== 'object' || Array.isArray(goal)) throw new TypeError('goal must be an object');
  if (!Array.isArray(materialized)) throw new TypeError('materialized must be an array');
  const seriesId = ruleSeriesId(rule);
  const deadline = goal.deadline ? requiredDate(goal.deadline,'goal.deadline') : options.deadline;
  const projected = projectRecurringOccurrences(rule,{
    ...options,
    deadline,
    materializedOccurrences:materialized
  });
  const matchingRows = materialized.filter(row=>materializedSeriesId(row) === seriesId);
  const reconciled = reconcileOccurrenceSets(matchingRows,[]);
  const matchingMaterialized = reconciled.materialized;
  const baseManual = Number.isFinite(Number(goal.current)) ? Number(goal.current) : 0;
  const materializedAmount = matchingMaterialized.reduce((sum,row)=>sum+signedGoalAmount(row),0);
  let selectedProjected = projected;
  if (options.stopAtTarget === true && Number(goal.target) > 0) {
    let coverage = baseManual + materializedAmount;
    selectedProjected = [];
    for (const item of projected) {
      if (coverage >= Number(goal.target)) break;
      selectedProjected.push(item);
      coverage += item.goalEffect === 'withdrawal' ? -item.amount : item.amount;
    }
  }
  const projectedAmount = selectedProjected.reduce((sum,item)=>sum+(item.goalEffect === 'withdrawal' ? -item.amount : item.amount),0);
  return {
    materialized:matchingMaterialized.slice(),
    duplicateMaterialized:reconciled.duplicateMaterialized.slice(),
    projected:selectedProjected,
    baseManual,
    materializedAmount,
    projectedAmount,
    projectedCoverage:baseManual+materializedAmount+projectedAmount
  };
}

return Object.freeze({
  projectRecurringOccurrences,
  reconcileOccurrences,
  reconcileOccurrenceSets,
  materializedOccurrenceKey,
  projectRecurringForGoal
});
});
