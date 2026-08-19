'use strict';

const STATUS_ALIASES = Object.freeze({
  realizado: 'realizado',
  realized: 'realizado',
  paid: 'realizado',
  pago: 'realizado',
  pendente: 'programado',
  pending: 'programado',
  programado: 'programado',
  scheduled: 'programado',
  cancelado: 'cancelado',
  canceled: 'cancelado',
  cancelled: 'cancelado'
});

const CANONICAL_STATUSES = new Set(['realizado', 'programado', 'cancelado']);

function fold(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function validDate(year, month, day) {
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year
    && candidate.getMonth() === month - 1
    && candidate.getDate() === day;
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  const raw = String(value ?? '').trim();
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (match) {
    const [, year, month, day] = match.map(Number);
    return validDate(year, month, day)
      ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : '';
  }

  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:$|\s)/);
  if (match) {
    const [, day, month, year] = match.map(Number);
    return validDate(year, month, day)
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : '';
  }

  return '';
}

function financialDate(tx) {
  return ['transaction_date', 'date', 'due_date', 'created_at']
    .map(field => dateOnly(tx?.[field]))
    .find(Boolean) || '';
}

function canonicalStatus(tx) {
  const originalStatus = tx?.status ?? null;
  const normalized = fold(originalStatus);
  const status = STATUS_ALIASES[normalized];

  if (status) {
    return {
      status,
      originalStatus,
      aliasUsed: CANONICAL_STATUSES.has(normalized) ? null : normalized,
      confidence: 'high',
      warnings: []
    };
  }

  if (!normalized) {
    return {
      status: 'nao_classificado',
      originalStatus,
      aliasUsed: null,
      confidence: 'none',
      warnings: ['missing_status']
    };
  }

  return {
    status: 'nao_classificado',
    originalStatus,
    aliasUsed: null,
    confidence: 'low',
    warnings: ['unknown_status']
  };
}

function referenceDate(now) {
  if (now === undefined || now === null || now === '') {
    throw new TypeError('now is required');
  }
  const date = dateOnly(now);
  if (!date) throw new TypeError('now must be a valid Date, ISO date, or DD/MM/YYYY date');
  return date;
}

function temporalState(tx, now) {
  const canonical = canonicalStatus(tx);
  const date = financialDate(tx);
  const today = referenceDate(now);
  const warnings = [...canonical.warnings];

  if (canonical.status === 'cancelado') {
    return {...canonical, state: 'cancelado', financialDate: date, warnings};
  }

  if (canonical.status === 'nao_classificado') {
    return {...canonical, state: 'nao_classificado', financialDate: date, warnings};
  }

  if (!date) warnings.push('invalid_financial_date');

  if (canonical.status === 'programado') {
    return {...canonical, state: 'previsto_materializado', financialDate: date, warnings};
  }

  if (!date) {
    return {...canonical, state: 'nao_classificado', financialDate: '', warnings};
  }

  if (date > today) {
    warnings.push('future_realized');
    return {...canonical, state: 'previsto_materializado', financialDate: date, warnings};
  }

  return {...canonical, state: 'efetivado', financialDate: date, warnings};
}

function isRealized(tx, now) {
  return temporalState(tx, now).state === 'efetivado';
}

function isScheduled(tx, now) {
  return temporalState(tx, now).state === 'previsto_materializado';
}

function isCancelled(tx, now) {
  return temporalState(tx, now).state === 'cancelado';
}

function isUnclassified(tx, now) {
  return temporalState(tx, now).state === 'nao_classificado';
}

function normalizePeriod(period) {
  if (period === undefined || period === null) return {mode: 'all'};
  if (typeof period !== 'object' || Array.isArray(period)) {
    throw new TypeError('period must be an object');
  }

  const hasRange = period.dateFrom !== undefined || period.dateTo !== undefined;
  const hasCalendar = period.year !== undefined || period.month !== undefined;
  if (hasRange && hasCalendar) {
    throw new TypeError('period must use either year/month or dateFrom/dateTo');
  }

  if (hasRange) {
    const dateFrom = period.dateFrom ? dateOnly(period.dateFrom) : '';
    const dateTo = period.dateTo ? dateOnly(period.dateTo) : '';
    if (period.dateFrom && !dateFrom) throw new TypeError('dateFrom must be a valid date');
    if (period.dateTo && !dateTo) throw new TypeError('dateTo must be a valid date');
    if (dateFrom && dateTo && dateFrom > dateTo) throw new RangeError('dateFrom must not be after dateTo');
    return {mode: 'range', dateFrom, dateTo};
  }

  if (hasCalendar) {
    const year = Number(period.year);
    if (!Number.isInteger(year)) throw new TypeError('year must be an integer');
    if (period.month === undefined) return {mode: 'year', year};
    const month = Number(period.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new RangeError('month must be an integer from 1 to 12');
    }
    return {mode: 'month', year, month};
  }

  return {mode: 'all'};
}

function matchesPeriod(tx, period) {
  const normalized = normalizePeriod(period);
  if (normalized.mode === 'all') return true;

  const date = financialDate(tx);
  if (!date) return false;
  if (normalized.mode === 'year') return Number(date.slice(0, 4)) === normalized.year;
  if (normalized.mode === 'month') {
    return Number(date.slice(0, 4)) === normalized.year
      && Number(date.slice(5, 7)) === normalized.month;
  }
  return (!normalized.dateFrom || date >= normalized.dateFrom)
    && (!normalized.dateTo || date <= normalized.dateTo);
}

function selectByState(rows, period, now, expectedState) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  referenceDate(now);
  normalizePeriod(period);
  return rows.filter(row => matchesPeriod(row, period) && temporalState(row, now).state === expectedState);
}

function realizedTransactions(rows, period, now) {
  return selectByState(rows, period, now, 'efetivado');
}

function scheduledTransactions(rows, period, now) {
  return selectByState(rows, period, now, 'previsto_materializado');
}

function cancelledTransactions(rows, period, now) {
  return selectByState(rows, period, now, 'cancelado');
}

function unclassifiedTransactions(rows, period, now) {
  return selectByState(rows, period, now, 'nao_classificado');
}

module.exports = Object.freeze({
  canonicalStatus,
  financialDate,
  temporalState,
  isRealized,
  isScheduled,
  isCancelled,
  isUnclassified,
  realizedTransactions,
  scheduledTransactions,
  cancelledTransactions,
  unclassifiedTransactions
});
