import type { TransactionRow } from '../../core/supabase/database.types.ts';
import { financialEffect } from '../../domain/finance/foundation-financial-read-model.ts';
import { calendarMonthWindow, type CalendarMonth } from '../../lib/format.ts';

export type DashboardDailyMovement = Readonly<{
  date: string;
  day: number;
  income: number;
  expense: number;
}>;

export type DashboardActivityItem = Readonly<{
  id: string;
  description: string;
  financialDate: string;
  typeLabel: string;
  statusLabel: 'Realizado' | 'Programado' | 'Cancelado' | 'Não classificado';
  tone: 'positive' | 'risk' | 'neutral';
  amount: number | null;
}>;

export type DashboardPeriodReadModel = Readonly<{
  realizedDailyMovements: readonly DashboardDailyMovement[];
  scheduledTransactions: readonly DashboardActivityItem[];
  recentTransactions: readonly DashboardActivityItem[];
}>;

function activityItem(transaction: TransactionRow, today: string): DashboardActivityItem {
  const effect = financialEffect(transaction, { now: today });
  const typeLabel = {
    receita: 'Receita',
    despesa: 'Despesa',
    investimento: 'Investimento',
    transferencia: 'Transferência',
    resgate: 'Resgate',
    nao_classificado: 'Outro',
  }[effect.type];
  const statusLabel = {
    efetivado: 'Realizado',
    previsto_materializado: 'Programado',
    cancelado: 'Cancelado',
    nao_classificado: 'Não classificado',
  }[effect.temporalState] as DashboardActivityItem['statusLabel'];
  const tone: DashboardActivityItem['tone'] = effect.type === 'receita'
    ? 'positive'
    : effect.type === 'despesa'
      ? 'risk'
      : 'neutral';
  const amount = effect.valid && effect.amount !== null
    ? (effect.type === 'despesa' ? -effect.amount : effect.amount)
    : null;

  return Object.freeze({
    id: transaction.id,
    description: transaction.description,
    financialDate: effect.financialDate || transaction.transaction_date,
    typeLabel,
    statusLabel,
    tone,
    amount,
  });
}

function daysInMonth(period: CalendarMonth): number {
  return new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
}

function lastVisibleDay(period: CalendarMonth, today: string): number {
  const window = calendarMonthWindow(period);
  if (today < window.start) return 0;
  if (today >= window.endExclusive) return daysInMonth(period);
  return Number(today.slice(8, 10));
}

/**
 * Adapta os efeitos financeiros canônicos para a composição da Principal.
 * Não cria fórmulas, métricas ou projeções: apenas agrupa Receita/Despesa
 * realizadas por sua data financeira e separa o estado temporal programado.
 */
export function buildDashboardPeriodReadModel(
  transactions: readonly TransactionRow[],
  period: CalendarMonth,
  today: string,
): DashboardPeriodReadModel {
  const window = calendarMonthWindow(period);
  const visibleDays = lastVisibleDay(period, today);
  const daily = Array.from({ length: visibleDays }, (_, index) => {
    const day = index + 1;
    return {
      date: `${period.year}-${String(period.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      income: 0,
      expense: 0,
    };
  });
  const scheduled: { transaction: TransactionRow; item: DashboardActivityItem }[] = [];
  let hasRealizedMovement = false;

  for (const transaction of transactions) {
    const effect = financialEffect(transaction, { now: today });
    const belongsToPeriod = effect.financialDate >= window.start
      && effect.financialDate < window.endExclusive;

    if (!belongsToPeriod) continue;
    if (effect.temporalState === 'previsto_materializado') {
      if (effect.valid) scheduled.push({ transaction, item: activityItem(transaction, today) });
      continue;
    }
    if (effect.temporalState !== 'efetivado' || !effect.valid) continue;
    if (!effect.incomeAmount && !effect.consumptionExpenseAmount) continue;

    const day = Number(effect.financialDate.slice(8, 10));
    const point = daily[day - 1];
    if (!point) continue;
    point.income += effect.incomeAmount;
    point.expense += effect.consumptionExpenseAmount;
    hasRealizedMovement = true;
  }

  scheduled.sort((left, right) => {
    const byFinancialDate = left.item.financialDate.localeCompare(right.item.financialDate);
    return byFinancialDate || left.transaction.created_at.localeCompare(right.transaction.created_at);
  });

  return Object.freeze({
    realizedDailyMovements: hasRealizedMovement
      ? Object.freeze(daily.map((point) => Object.freeze(point)))
      : Object.freeze([]),
    scheduledTransactions: Object.freeze(scheduled.map(({ item }) => item)),
    recentTransactions: Object.freeze(transactions
      .map((transaction) => activityItem(transaction, today))
      .filter((item) => item.statusLabel !== 'Programado')
      .slice(0, 4)),
  });
}
