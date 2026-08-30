/**
 * Port TypeScript fiel ao contrato público de `js/financial-core.js` da
 * baseline main@9b8659643d5d66713d0f12e2af9422c573a27a8d
 * (Git blob `054f00edc7efdedf672f0066ff0a370638e6fbf7`).
 *
 * A implementação mantém nomes, precedência de data, aliases, warnings e
 * efeitos do núcleo Web. A extração futura para pacote compartilhado deve
 * substituir Web e mobile simultaneamente, protegida por fixtures douradas.
 */

export type FinancialStatus = 'realizado' | 'programado' | 'cancelado' | 'nao_classificado';
export type TemporalStateName = 'efetivado' | 'previsto_materializado' | 'cancelado' | 'nao_classificado';
export type TransactionType = 'receita' | 'despesa' | 'investimento' | 'transferencia' | 'resgate' | 'nao_classificado';
export type Confidence = 'high' | 'low' | 'none';

export type FoundationTransaction = Readonly<{
  amount?: number | string | null;
  transaction_type?: string | null;
  type?: string | null;
  status?: string | null;
  transaction_date?: string | Date | null;
  date?: string | Date | null;
  due_date?: string | Date | null;
  created_at?: string | Date | null;
  purchase_date?: string | Date | null; // campo aceito no DTO, mas não é data financeira canônica neste contrato.
  source_account_id?: string | null;
  destination_account_id?: string | null;
  account_id?: string | null;
  asset_id?: string | null;
  liability_id?: string | null;
}>;

export type CanonicalStatusResult = Readonly<{
  status: FinancialStatus;
  originalStatus: unknown;
  aliasUsed: string | null;
  confidence: Confidence;
  warnings: readonly string[];
}>;

export type TemporalStateResult = CanonicalStatusResult & Readonly<{
  state: TemporalStateName;
  financialDate: string;
  warnings: readonly string[];
}>;

export type FinancialEffect = {
  type: TransactionType;
  temporalState: TemporalStateName;
  financialDate: string;
  amount: number | null;
  valid: boolean;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  accountId: string | null;
  assetId: string | null;
  liabilityId: string | null;
  availableBalanceDelta: number;
  sourceAccountDelta: number;
  destinationAccountDelta: number;
  assetDelta: number;
  liabilityDelta: number;
  netWorthDelta: number;
  incomeAmount: number;
  consumptionExpenseAmount: number;
  investmentAmount: number;
  transferAmount: number;
  rescueAmount: number;
  warnings: string[];
};

export type FinancialPeriod =
  | Readonly<{ year: number; month?: number }>
  | Readonly<{ dateFrom?: string | Date; dateTo?: string | Date }>
  | null
  | undefined;

const STATUS_ALIASES: Readonly<Record<string, Exclude<FinancialStatus, 'nao_classificado'>>> = Object.freeze({
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
  cancelled: 'cancelado',
});

const CANONICAL_STATUSES = new Set(['realizado', 'programado', 'cancelado']);

const TYPE_ALIASES: Readonly<Record<string, Exclude<TransactionType, 'nao_classificado'>>> = Object.freeze({
  receita: 'receita',
  income: 'receita',
  despesa: 'despesa',
  expense: 'despesa',
  investimento: 'investimento',
  investment: 'investimento',
  transferencia: 'transferencia',
  transfer: 'transferencia',
  resgate: 'resgate',
  rescue: 'resgate',
});

function fold(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function validDate(year: number, month: number, day: number): boolean {
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year
    && candidate.getMonth() === month - 1
    && candidate.getDate() === day;
}

export function dateOnly(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  const raw = String(value ?? '').trim();
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return validDate(year, month, day)
      ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : '';
  }

  match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:$|\s)/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    return validDate(year, month, day)
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : '';
  }

  return '';
}

export function financialDate(transaction: FoundationTransaction): string {
  const fields: readonly (keyof FoundationTransaction)[] = [
    'transaction_date',
    'date',
    'due_date',
    'created_at',
  ];
  for (const field of fields) {
    const candidate = dateOnly(transaction?.[field]);
    if (candidate) return candidate;
  }
  return '';
}

export function canonicalStatus(transaction: FoundationTransaction): CanonicalStatusResult {
  const originalStatus = transaction?.status ?? null;
  const normalized = fold(originalStatus);
  const status = STATUS_ALIASES[normalized];

  if (status) {
    return {
      status,
      originalStatus,
      aliasUsed: CANONICAL_STATUSES.has(normalized) ? null : normalized,
      confidence: 'high',
      warnings: [],
    };
  }

  if (!normalized) {
    return {
      status: 'nao_classificado',
      originalStatus,
      aliasUsed: null,
      confidence: 'none',
      warnings: ['missing_status'],
    };
  }

  return {
    status: 'nao_classificado',
    originalStatus,
    aliasUsed: null,
    confidence: 'low',
    warnings: ['unknown_status'],
  };
}

function referenceDate(now: unknown): string {
  if (now === undefined || now === null || now === '') throw new TypeError('now is required');
  const date = dateOnly(now);
  if (!date) throw new TypeError('now must be a valid Date, ISO date, or DD/MM/YYYY date');
  return date;
}

export function temporalState(transaction: FoundationTransaction, now: unknown): TemporalStateResult {
  const canonical = canonicalStatus(transaction);
  const date = financialDate(transaction);
  const today = referenceDate(now);
  const warnings = [...canonical.warnings];

  if (canonical.status === 'cancelado') {
    return { ...canonical, state: 'cancelado', financialDate: date, warnings };
  }
  if (canonical.status === 'nao_classificado') {
    return { ...canonical, state: 'nao_classificado', financialDate: date, warnings };
  }
  if (!date) warnings.push('invalid_financial_date');
  if (canonical.status === 'programado') {
    return { ...canonical, state: 'previsto_materializado', financialDate: date, warnings };
  }
  if (!date) {
    return { ...canonical, state: 'nao_classificado', financialDate: '', warnings };
  }
  if (date > today) {
    warnings.push('future_realized');
    return { ...canonical, state: 'previsto_materializado', financialDate: date, warnings };
  }
  return { ...canonical, state: 'efetivado', financialDate: date, warnings };
}

export function isRealized(transaction: FoundationTransaction, now: unknown): boolean {
  return temporalState(transaction, now).state === 'efetivado';
}

export function isScheduled(transaction: FoundationTransaction, now: unknown): boolean {
  return temporalState(transaction, now).state === 'previsto_materializado';
}

export function isCancelled(transaction: FoundationTransaction, now: unknown): boolean {
  return temporalState(transaction, now).state === 'cancelado';
}

export function isUnclassified(transaction: FoundationTransaction, now: unknown): boolean {
  return temporalState(transaction, now).state === 'nao_classificado';
}

type NormalizedPeriod =
  | { mode: 'all' }
  | { mode: 'year'; year: number }
  | { mode: 'month'; year: number; month: number }
  | { mode: 'range'; dateFrom: string; dateTo: string };

function normalizePeriod(period: FinancialPeriod): NormalizedPeriod {
  if (period === undefined || period === null) return { mode: 'all' };
  if (typeof period !== 'object' || Array.isArray(period)) throw new TypeError('period must be an object');

  const source = period as Record<string, unknown>;
  const hasRange = source.dateFrom !== undefined || source.dateTo !== undefined;
  const hasCalendar = source.year !== undefined || source.month !== undefined;
  if (hasRange && hasCalendar) throw new TypeError('period must use either year/month or dateFrom/dateTo');

  if (hasRange) {
    const dateFrom = source.dateFrom ? dateOnly(source.dateFrom) : '';
    const dateTo = source.dateTo ? dateOnly(source.dateTo) : '';
    if (source.dateFrom && !dateFrom) throw new TypeError('dateFrom must be a valid date');
    if (source.dateTo && !dateTo) throw new TypeError('dateTo must be a valid date');
    if (dateFrom && dateTo && dateFrom > dateTo) throw new RangeError('dateFrom must not be after dateTo');
    return { mode: 'range', dateFrom, dateTo };
  }

  if (hasCalendar) {
    const year = Number(source.year);
    if (!Number.isInteger(year)) throw new TypeError('year must be an integer');
    if (source.month === undefined) return { mode: 'year', year };
    const month = Number(source.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new RangeError('month must be an integer from 1 to 12');
    }
    return { mode: 'month', year, month };
  }

  return { mode: 'all' };
}

function matchesPeriod(transaction: FoundationTransaction, period: FinancialPeriod): boolean {
  const normalized = normalizePeriod(period);
  if (normalized.mode === 'all') return true;
  const date = financialDate(transaction);
  if (!date) return false;
  if (normalized.mode === 'year') return Number(date.slice(0, 4)) === normalized.year;
  if (normalized.mode === 'month') {
    return Number(date.slice(0, 4)) === normalized.year
      && Number(date.slice(5, 7)) === normalized.month;
  }
  return (!normalized.dateFrom || date >= normalized.dateFrom)
    && (!normalized.dateTo || date <= normalized.dateTo);
}

function selectByState(
  rows: readonly FoundationTransaction[],
  period: FinancialPeriod,
  now: unknown,
  expectedState: TemporalStateName,
): FoundationTransaction[] {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  referenceDate(now);
  normalizePeriod(period);
  return rows.filter(
    (row) => matchesPeriod(row, period) && temporalState(row, now).state === expectedState,
  );
}

export function realizedTransactions(rows: readonly FoundationTransaction[], period: FinancialPeriod, now: unknown) {
  return selectByState(rows, period, now, 'efetivado');
}

export function scheduledTransactions(rows: readonly FoundationTransaction[], period: FinancialPeriod, now: unknown) {
  return selectByState(rows, period, now, 'previsto_materializado');
}

export function cancelledTransactions(rows: readonly FoundationTransaction[], period: FinancialPeriod, now: unknown) {
  return selectByState(rows, period, now, 'cancelado');
}

export function unclassifiedTransactions(rows: readonly FoundationTransaction[], period: FinancialPeriod, now: unknown) {
  return selectByState(rows, period, now, 'nao_classificado');
}

export function canonicalType(transaction: FoundationTransaction): TransactionType {
  return TYPE_ALIASES[fold(transaction?.transaction_type ?? transaction?.type)] ?? 'nao_classificado';
}

function monetaryAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function emptyEffect(
  transaction: FoundationTransaction,
  type: TransactionType,
  temporal: TemporalStateResult,
  amount: number | null,
  warnings: string[],
  valid = true,
): FinancialEffect {
  return {
    type,
    temporalState: temporal.state,
    financialDate: temporal.financialDate,
    amount,
    valid,
    sourceAccountId: transaction?.source_account_id ?? null,
    destinationAccountId: transaction?.destination_account_id ?? null,
    accountId: transaction?.account_id ?? null,
    assetId: transaction?.asset_id ?? null,
    liabilityId: transaction?.liability_id ?? null,
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
    warnings,
  };
}

export function financialEffect(
  transaction: FoundationTransaction,
  options: Readonly<{ now?: unknown }> = {},
): FinancialEffect {
  const temporal = temporalState(transaction, options.now);
  const type = canonicalType(transaction);
  const amount = monetaryAmount(transaction?.amount);
  const warnings = [...temporal.warnings];

  if (type === 'nao_classificado') warnings.push('unknown_type');
  if (amount === null) warnings.push('invalid_amount');
  if (temporal.state === 'nao_classificado') warnings.push('unclassified_transaction');

  let valid = type !== 'nao_classificado' && amount !== null;
  const sourceAccountId = transaction?.source_account_id ?? transaction?.account_id ?? null;
  const destinationAccountId = transaction?.destination_account_id ?? transaction?.account_id ?? null;

  if (type === 'receita' && !destinationAccountId) warnings.push('missing_destination_account');
  if (type === 'despesa' && !sourceAccountId) warnings.push('missing_source_account');
  if (type === 'investimento') {
    if (!sourceAccountId) {
      warnings.push('missing_source_account');
      valid = false;
    }
    if (!transaction?.asset_id) {
      warnings.push('missing_asset_destination');
      valid = false;
    }
  }
  if (type === 'transferencia') {
    const transferSource = transaction?.source_account_id ?? null;
    const transferDestination = transaction?.destination_account_id ?? null;
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
    if (!destinationAccountId) {
      warnings.push('missing_destination_account');
      valid = false;
    }
    if (!transaction?.asset_id) {
      warnings.push('missing_asset_source');
      valid = false;
    }
  }

  const effect = emptyEffect(transaction, type, temporal, amount, warnings, valid);
  if (type === 'despesa' || type === 'investimento') effect.sourceAccountId = sourceAccountId;
  if (type === 'receita' || type === 'resgate') effect.destinationAccountId = destinationAccountId;
  if (temporal.state !== 'efetivado' || !valid || amount === null) return effect;

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

export function summarizeRealized(
  transactions: readonly FoundationTransaction[],
  now: unknown,
) {
  return transactions.reduce(
    (summary, transaction) => {
      const effect = financialEffect(transaction, { now });
      summary.income += effect.incomeAmount;
      summary.expense += effect.consumptionExpenseAmount;
      summary.investment += effect.investmentAmount;
      summary.transfer += effect.transferAmount;
      summary.rescue += effect.rescueAmount;
      summary.availableBalanceDelta += effect.availableBalanceDelta;
      summary.netWorthDelta += effect.netWorthDelta;
      if (!effect.valid || effect.temporalState === 'nao_classificado') summary.unclassified += 1;
      return summary;
    },
    {
      income: 0,
      expense: 0,
      investment: 0,
      transfer: 0,
      rescue: 0,
      availableBalanceDelta: 0,
      netWorthDelta: 0,
      unclassified: 0,
    },
  );
}
