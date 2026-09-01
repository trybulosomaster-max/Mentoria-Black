const moneyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const monthFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  month: 'long',
  year: 'numeric',
});

const monthNameFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  month: 'long',
});

export type CalendarMonth = Readonly<{ year: number; month: number }>;

export type CalendarMonthWindow = CalendarMonth & Readonly<{
  start: string;
  endExclusive: string;
  label: string;
}>;

function assertCalendarMonth(period: CalendarMonth): void {
  if (!Number.isInteger(period.year) || period.year < 1900 || period.year > 9999) {
    throw new RangeError('O ano do período deve estar entre 1900 e 9999.');
  }
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
    throw new RangeError('O mês do período deve estar entre 1 e 12.');
  }
}

function monthDate(period: CalendarMonth): Date {
  assertCalendarMonth(period);
  return new Date(`${period.year}-${String(period.month).padStart(2, '0')}-15T12:00:00-03:00`);
}

export function formatMoney(value: number | null | undefined): string {
  const number = Number(value ?? 0);
  return moneyFormatter.format(Number.isFinite(number) ? number : 0);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Sem data';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? 'Data inválida' : dateFormatter.format(date);
}

export function titleCase(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase('pt-BR') + value.slice(1) : value;
}

export function calendarMonthKey(period: CalendarMonth): string {
  assertCalendarMonth(period);
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

export function calendarMonthLabel(period: CalendarMonth): string {
  return titleCase(monthFormatter.format(monthDate(period)));
}

export function calendarMonthName(period: CalendarMonth): string {
  return titleCase(monthNameFormatter.format(monthDate(period)));
}

export function sameCalendarMonth(left: CalendarMonth, right: CalendarMonth): boolean {
  return left.year === right.year && left.month === right.month;
}

export function shiftCalendarMonth(period: CalendarMonth, offset: number): CalendarMonth {
  assertCalendarMonth(period);
  if (!Number.isInteger(offset)) throw new TypeError('O deslocamento do período deve ser inteiro.');
  const absoluteMonth = period.year * 12 + (period.month - 1) + offset;
  const year = Math.floor(absoluteMonth / 12);
  const month = ((absoluteMonth % 12) + 12) % 12 + 1;
  const shifted = Object.freeze({ year, month });
  assertCalendarMonth(shifted);
  return shifted;
}

export function calendarMonthWindow(period: CalendarMonth): CalendarMonthWindow {
  assertCalendarMonth(period);
  const next = shiftCalendarMonth(period, 1);
  return Object.freeze({
    year: period.year,
    month: period.month,
    start: `${period.year}-${String(period.month).padStart(2, '0')}-01`,
    endExclusive: `${next.year}-${String(next.month).padStart(2, '0')}-01`,
    label: calendarMonthLabel(period),
  });
}

export function saoPauloCalendar(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  return {
    year,
    month,
    day,
    today: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

export function currentMonthWindow(now = new Date()) {
  const { year, month } = saoPauloCalendar(now);
  return calendarMonthWindow({ year, month });
}
