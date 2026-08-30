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
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    year,
    month,
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    endExclusive: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
    label: titleCase(monthFormatter.format(new Date(`${year}-${String(month).padStart(2, '0')}-15T12:00:00-03:00`))),
  };
}
