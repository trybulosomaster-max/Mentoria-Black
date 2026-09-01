import {
  financialEffect,
  type FoundationTransaction,
} from '../../domain/finance/foundation-financial-read-model.ts';
import {
  calendarMonthKey,
  calendarMonthWindow,
  shiftCalendarMonth,
  type CalendarMonth,
} from '../../lib/format.ts';

export type DashboardShortcutFlow = 'income' | 'expense';
export type DashboardTransactionsFlow = DashboardShortcutFlow | 'all' | 'card';
export type DashboardTransactionsOrigin = 'dashboard';

export type DashboardTransactionsIntent = Readonly<{
  period: CalendarMonth;
  flow: DashboardTransactionsFlow;
  origin: DashboardTransactionsOrigin | null;
}>;

export const HIDDEN_FINANCIAL_VALUE = String.fromCharCode(0x2022).repeat(6);
export const HIDDEN_FINANCIAL_ACCESSIBILITY_LABEL = 'Valor oculto';
export const UNAVAILABLE_FINANCIAL_VALUE = String.fromCharCode(0x2014);

export function financialValuePresentation(
  formattedValue: string | null,
  valuesVisible: boolean,
  emptyLabel = 'Não informado',
): Readonly<{ text: string; accessibilityLabel: string }> {
  if (!valuesVisible) {
    return Object.freeze({
      text: HIDDEN_FINANCIAL_VALUE,
      accessibilityLabel: HIDDEN_FINANCIAL_ACCESSIBILITY_LABEL,
    });
  }
  const value = formattedValue || emptyLabel;
  return Object.freeze({ text: value, accessibilityLabel: value });
}

export function dashboardTransactionsHref(
  period: CalendarMonth,
  flow: DashboardShortcutFlow | 'all',
) {
  const [year, month] = calendarMonthKey(period).split('-');
  return Object.freeze({
    pathname: '/(tabs)/lancamentos' as const,
    params: Object.freeze({ year, month, flow, origin: 'dashboard' as const }),
  });
}

function singleParam(value: string | readonly string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0] ?? '') : null;
  return String(value ?? '');
}

export function parseDashboardTransactionsIntent(params: Readonly<{
  year?: string | readonly string[];
  month?: string | readonly string[];
  flow?: string | readonly string[];
  origin?: string | readonly string[];
}>): DashboardTransactionsIntent | null {
  const yearValue = singleParam(params.year);
  const monthValue = singleParam(params.month);
  const flowValue = singleParam(params.flow);
  const originValue = singleParam(params.origin);
  if (yearValue === null || monthValue === null || flowValue === null || originValue === null) return null;
  if (!/^\d{4}$/.test(yearValue) || !/^(?:0[1-9]|1[0-2])$/.test(monthValue)) return null;
  if (!['all', 'income', 'expense', 'card'].includes(flowValue)) return null;
  if (originValue && originValue !== 'dashboard') return null;
  const period = Object.freeze({ year: Number(yearValue), month: Number(monthValue) });
  try {
    calendarMonthWindow(period);
    shiftCalendarMonth(period, -18);
    shiftCalendarMonth(period, 18);
  } catch {
    return null;
  }
  return Object.freeze({
    period,
    flow: flowValue as DashboardTransactionsFlow,
    origin: originValue === 'dashboard' ? originValue : null,
  });
}

export function transactionMatchesDashboardFlow(
  transaction: FoundationTransaction,
  flow: DashboardShortcutFlow | null,
  now: unknown,
): boolean {
  if (!flow) return true;
  const effect = financialEffect(transaction, { now });
  if (!effect.valid || effect.temporalState !== 'efetivado') return false;
  return flow === 'income' ? effect.type === 'receita' : effect.type === 'despesa';
}
