(function(root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(require('./goal-projection'))
    : factory(root?.MBGoalProjection);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MBGoalsV82 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(goalProjection) {
'use strict';

if (!goalProjection) throw new Error('Canonical goal projection is unavailable');
const {projectGoal} = goalProjection;

function dateOnly(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!match) return '';
  const [,year,month,day] = match.map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
    ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    : '';
}

function addMonths(date, amount) {
  const [year,month,day] = date.split('-').map(Number);
  const index = year * 12 + month - 1 + amount;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index % 12 + 1;
  const maxDay = new Date(Date.UTC(nextYear,nextMonth,0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2,'0')}-${String(Math.min(day,maxDay)).padStart(2,'0')}`;
}

function monthsBetween(from,to) {
  if (!from || !to || to < from) return 0;
  const [fy,fm,fd] = from.split('-').map(Number);
  const [ty,tm,td] = to.split('-').map(Number);
  return Math.max(0,(ty-fy)*12+(tm-fm)+(td>=fd?0:-1));
}

function metricStatus(metric, now) {
  const realizedTotal = metric.baseManual + metric.realized;
  if (metric.target > 0 && realizedTotal >= metric.target) return 'completed';
  if (!metric.estimatedCompletionDate) return 'no_forecast';
  if (!metric.deadline) return 'on_track';
  if (metric.estimatedCompletionDate > metric.deadline) return 'behind';
  return metric.estimatedCompletionDate <= addMonths(metric.deadline,-1) ? 'ahead' : 'on_track';
}

function goalViewModel(goal, transactions, recurringRules, options = {}) {
  const now = dateOnly(options.now);
  if (!now) throw new TypeError('options.now must be an ISO date');
  const deadline = dateOnly(goal?.deadline);
  const horizonEnd = dateOnly(options.horizonEnd) || deadline || now;
  const metric = projectGoal(goal,transactions,recurringRules,{
    now,
    horizonStart:now,
    horizonEnd,
    maxOccurrences:options.maxOccurrences,
    maxIterations:options.maxIterations,
    projectionMode:'full'
  });
  const realizedTotal = metric.baseManual + metric.realized;
  const progressRealPct = metric.target > 0 ? realizedTotal / metric.target * 100 : 0;
  const progressProjectedPct = metric.target > 0 ? metric.projectedCoverage / metric.target * 100 : 0;
  const monthsRemaining = deadline ? monthsBetween(now,deadline) : null;
  return Object.freeze({
    ...metric,
    goal,
    realizedTotal,
    programmed:metric.scheduledMaterialized,
    projected:metric.projectedVirtual,
    projectedCovered:metric.projectedCoverage,
    progressRealPct,
    progressProjectedPct,
    monthsRemaining,
    monthlyNeeded:monthsRemaining ? metric.remainingReal / monthsRemaining : 0,
    isCompleted:metric.target > 0 && realizedTotal >= metric.target,
    status:metricStatus(metric,now)
  });
}

function projectGoalsForView(goals, transactions, recurringRules, options = {}) {
  if (!Array.isArray(goals) || !Array.isArray(transactions) || !Array.isArray(recurringRules)) {
    throw new TypeError('goals, transactions and recurringRules must be arrays');
  }
  return goals.map(goal=>goalViewModel(goal,transactions,recurringRules,options));
}

return Object.freeze({goalViewModel,projectGoalsForView});
});
