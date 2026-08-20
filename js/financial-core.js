(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MBCanonicalFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
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

const TYPE_ALIASES = Object.freeze({
  receita: 'receita',
  income: 'receita',
  despesa: 'despesa',
  expense: 'despesa',
  investimento: 'investimento',
  investment: 'investimento',
  transferencia: 'transferencia',
  transfer: 'transferencia',
  resgate: 'resgate',
  rescue: 'resgate'
});

function canonicalType(tx) {
  return TYPE_ALIASES[fold(tx?.transaction_type ?? tx?.type)] || 'nao_classificado';
}

function monetaryAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function emptyEffect(tx, type, temporal, amount, warnings, valid = true) {
  return {
    type,
    temporalState: temporal.state,
    financialDate: temporal.financialDate,
    amount,
    valid,
    sourceAccountId: tx?.source_account_id ?? null,
    destinationAccountId: tx?.destination_account_id ?? null,
    accountId: tx?.account_id ?? null,
    assetId: tx?.asset_id ?? null,
    liabilityId: tx?.liability_id ?? null,
    availableBalanceDelta: 0,
    sourceAccountDelta: 0,
    destinationAccountDelta: 0,
    assetDelta: 0,
    liabilityDelta: 0,
    netWorthDelta: 0,
    incomeAmount: 0,
    consumptionExpenseAmount: 0,
    investmentAmount: 0,
    transferAmount: 0,
    rescueAmount: 0,
    warnings
  };
}

function financialEffect(tx, options = {}) {
  const temporal = temporalState(tx, options.now);
  const type = canonicalType(tx);
  const amount = monetaryAmount(tx?.amount);
  const warnings = [...temporal.warnings];

  if (type === 'nao_classificado') warnings.push('unknown_type');
  if (amount === null) warnings.push('invalid_amount');
  if (temporal.state === 'nao_classificado') warnings.push('unclassified_transaction');

  let valid = type !== 'nao_classificado' && amount !== null;
  const sourceAccountId = tx?.source_account_id ?? tx?.account_id ?? null;
  const destinationAccountId = tx?.destination_account_id ?? tx?.account_id ?? null;

  if (type === 'receita' && !destinationAccountId) warnings.push('missing_destination_account');
  if (type === 'despesa' && !sourceAccountId) warnings.push('missing_source_account');
  if (type === 'investimento') {
    if (!sourceAccountId) { warnings.push('missing_source_account'); valid = false; }
    if (!tx?.asset_id) { warnings.push('missing_asset_destination'); valid = false; }
  }
  if (type === 'transferencia') {
    const transferSource = tx?.source_account_id ?? null;
    const transferDestination = tx?.destination_account_id ?? null;
    if (!transferSource) {
      warnings.push('missing_source_account');
      valid = false;
    }
    if (!transferDestination) {
      warnings.push('missing_destination_account');
      valid = false;
    }
    if (transferSource && transferDestination && String(transferSource) === String(transferDestination)) {
      warnings.push('same_transfer_account');
      valid = false;
    }
  }
  if (type === 'resgate') {
    if (!destinationAccountId) { warnings.push('missing_destination_account'); valid = false; }
    if (!tx?.asset_id) { warnings.push('missing_asset_source'); valid = false; }
  }

  const effect = emptyEffect(tx, type, temporal, amount, warnings, valid);
  if (type === 'despesa' || type === 'investimento') effect.sourceAccountId = sourceAccountId;
  if (type === 'receita' || type === 'resgate') effect.destinationAccountId = destinationAccountId;
  if (temporal.state !== 'efetivado' || !valid) return effect;

  if (type === 'receita') {
    effect.availableBalanceDelta = amount;
    effect.destinationAccountDelta = destinationAccountId ? amount : 0;
    effect.netWorthDelta = amount;
    effect.incomeAmount = amount;
  } else if (type === 'despesa') {
    effect.availableBalanceDelta = -amount;
    effect.sourceAccountDelta = sourceAccountId ? -amount : 0;
    effect.netWorthDelta = -amount;
    effect.consumptionExpenseAmount = amount;
  } else if (type === 'investimento') {
    effect.availableBalanceDelta = -amount;
    effect.sourceAccountDelta = sourceAccountId ? -amount : 0;
    effect.assetDelta = amount;
    effect.investmentAmount = amount;
  } else if (type === 'transferencia') {
    effect.sourceAccountDelta = -amount;
    effect.destinationAccountDelta = amount;
    effect.transferAmount = amount;
  } else if (type === 'resgate') {
    effect.availableBalanceDelta = amount;
    effect.destinationAccountDelta = destinationAccountId ? amount : 0;
    effect.assetDelta = -amount;
    effect.rescueAmount = amount;
  }

  return effect;
}

return Object.freeze({
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
  unclassifiedTransactions,
  financialEffect
});
});
