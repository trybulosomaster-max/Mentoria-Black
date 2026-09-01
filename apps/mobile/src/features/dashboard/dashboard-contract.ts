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

export type DashboardTransactionsIntent = Readonly<{
  period: CalendarMonth;
  flow: DashboardShortcutFlow;
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

export function dashboardTransactionsHref(period: CalendarMonth, flow: DashboardShortcutFlow) {
  const [year, month] = calendarMonthKey(period).split('-');
  return Object.freeze({
    pathname: '/(tabs)/lancamentos' as const,
    params: Object.freeze({ year, month, flow }),
  });
}

function firstParam(value: string | readonly string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

export function parseDashboardTransactionsIntent(params: Readonly<{
  year?: string | readonly string[];
  month?: string | readonly string[];
  flow?: string | readonly string[];
}>): DashboardTransactionsIntent | null {
  const yearValue = firstParam(params.year);
  const monthValue = firstParam(params.month);
  const flowValue = firstParam(params.flow);
  if (!/^\d{4}$/.test(yearValue) || !/^(?:0[1-9]|1[0-2])$/.test(monthValue)) return null;
  if (flowValue !== 'income' && flowValue !== 'expense') return null;
  const period = Object.freeze({ year: Number(yearValue), month: Number(monthValue) });
  try {
    calendarMonthWindow(period);
    shiftCalendarMonth(period, -18);
    shiftCalendarMonth(period, 18);
  } catch {
    return null;
  }
  return Object.freeze({ period, flow: flowValue });
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
