import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { TransactionRow } from '../src/core/supabase/database.types.ts';
import { summarizeRealized } from '../src/domain/finance/foundation-financial-read-model.ts';
import {
  dashboardTransactionsHref,
  financialValuePresentation,
  parseDashboardTransactionsIntent,
  transactionMatchesDashboardFlow,
} from '../src/features/dashboard/dashboard-contract.ts';
import { buildDashboardPeriodReadModel } from '../src/features/dashboard/dashboard-read-model.ts';
import {
  calendarMonthKey,
  calendarMonthLabel,
  calendarMonthWindow,
  currentMonthWindow,
  shiftCalendarMonth,
} from '../src/lib/format.ts';

async function source(relative: string): Promise<string> {
  return readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
}

function transaction(
  id: string,
  overrides: Partial<TransactionRow> = {},
): TransactionRow {
  return {
    id,
    user_id: 'owner-a',
    amount: 100,
    transaction_type: 'receita',
    status: 'realizado',
    transaction_date: '2026-08-02',
    created_at: `2026-08-02T12:00:0${id.length}.000Z`,
    account_id: 'account-a',
    asset_id: null,
    card_billing_cycle_id: null,
    card_id: null,
    category: 'Categoria',
    description: `Lançamento ${id}`,
    destination_account_id: null,
    goal_effect: null,
    goal_id: null,
    installment_number: null,
    installment_series_id: null,
    installment_total: null,
    liability_id: null,
    note: null,
    operation_id: null,
    payment_method: null,
    purchase_date: null,
    recurring_occurrence_date: null,
    recurring_series_id: null,
    reversal_of_id: null,
    source_account_id: null,
    subcategory: null,
    updated_at: '2026-08-02T12:00:00.000Z',
    ...overrides,
  };
}

test('período inicial respeita o calendário financeiro de São Paulo', () => {
  assert.deepEqual(currentMonthWindow(new Date('2026-09-01T01:30:00.000Z')), {
    year: 2026,
    month: 8,
    start: '2026-08-01',
    endExclusive: '2026-09-01',
    label: 'Agosto de 2026',
  });
  assert.equal(currentMonthWindow(new Date('2026-09-01T04:00:00.000Z')).month, 9);
});

test('troca de mês preserva virada de ano, janela e rótulo canônicos', () => {
  const january = shiftCalendarMonth({ year: 2026, month: 12 }, 1);
  assert.deepEqual(january, { year: 2027, month: 1 });
  assert.equal(calendarMonthKey(january), '2027-01');
  assert.equal(calendarMonthLabel(january), 'Janeiro de 2027');
  assert.deepEqual(calendarMonthWindow(january), {
    year: 2027,
    month: 1,
    start: '2027-01-01',
    endExclusive: '2027-02-01',
    label: 'Janeiro de 2027',
  });
  assert.deepEqual(shiftCalendarMonth(january, -1), { year: 2026, month: 12 });
  assert.throws(() => calendarMonthWindow({ year: 2026, month: 13 }), /mês/);
});

test('atalhos de Receita e Despesa carregam somente período e filtro allowlisted', () => {
  const period = { year: 2026, month: 9 } as const;
  assert.deepEqual(dashboardTransactionsHref(period, 'income'), {
    pathname: '/(tabs)/lancamentos',
    params: { year: '2026', month: '09', flow: 'income' },
  });
  assert.deepEqual(parseDashboardTransactionsIntent({ year: '2026', month: '09', flow: 'expense' }), {
    period,
    flow: 'expense',
  });
  for (const invalid of [
    { year: '2026', month: '13', flow: 'income' },
    { year: '2026', month: '09', flow: 'transfer' },
    { year: '20x6', month: '09', flow: 'expense' },
    { year: '0000', month: '09', flow: 'income' },
    { year: '1900', month: '01', flow: 'expense' },
    { year: '9999', month: '11', flow: 'income' },
    { year: '9999', month: '12', flow: 'expense' },
  ]) assert.equal(parseDashboardTransactionsIntent(invalid), null);
});

test('filtro de atalho usa o mesmo efeito financeiro realizado do agregado', () => {
  const now = '2026-08-31';
  const realized = { status: 'realizado', transaction_date: '2026-08-20', amount: 100, account_id: 'account-a' } as const;
  assert.equal(transactionMatchesDashboardFlow({ ...realized, transaction_type: 'receita' }, 'income', now), true);
  assert.equal(transactionMatchesDashboardFlow({ ...realized, transaction_type: 'income' }, 'income', now), true);
  assert.equal(transactionMatchesDashboardFlow({ ...realized, transaction_type: 'despesa' }, 'expense', now), true);
  assert.equal(transactionMatchesDashboardFlow({ ...realized, transaction_type: 'transferencia' }, 'income', now), false);
  assert.equal(transactionMatchesDashboardFlow({ ...realized, transaction_type: 'investimento' }, 'expense', now), false);
  assert.equal(transactionMatchesDashboardFlow({ ...realized, transaction_type: 'receita', status: 'programado' }, 'income', now), false);
  assert.equal(transactionMatchesDashboardFlow({ ...realized, transaction_type: 'despesa', status: 'cancelado' }, 'expense', now), false);
  assert.equal(transactionMatchesDashboardFlow({ ...realized, transaction_type: 'receita', transaction_date: '2026-09-01' }, 'income', now), false);
});

test('ocultação remove o valor tanto do texto quanto do rótulo acessível', () => {
  const hidden = financialValuePresentation('R$ 9.876,54', false);
  assert.equal(hidden.text, '••••••');
  assert.equal(hidden.accessibilityLabel, 'Valor oculto');
  assert.doesNotMatch(`${hidden.text}:${hidden.accessibilityLabel}`, /9\.876|9876/);
  assert.deepEqual(financialValuePresentation(null, true, 'Saldo ainda não informado'), {
    text: 'Saldo ainda não informado',
    accessibilityLabel: 'Saldo ainda não informado',
  });
});

test('série diária da Principal usa somente efeitos realizados do contrato financeiro', () => {
  const today = '2026-08-10';
  const rows = [
    transaction('income', { amount: 100, transaction_type: 'receita' }),
    transaction('expense', { amount: 25, transaction_type: 'despesa' }),
    transaction('investment', { amount: 30, transaction_type: 'investimento', transaction_date: '2026-08-03', asset_id: 'asset-a' }),
    transaction('transfer', { amount: 999, transaction_type: 'transferencia', transaction_date: '2026-08-04', source_account_id: 'account-a', destination_account_id: 'account-b' }),
    transaction('scheduled', { amount: 40, transaction_type: 'despesa', status: 'programado', transaction_date: '2026-08-05' }),
    transaction('future-realized', { amount: 50, transaction_type: 'receita', transaction_date: '2026-08-20' }),
    transaction('cancelled', { amount: 500, transaction_type: 'receita', status: 'cancelado', transaction_date: '2026-08-06' }),
  ];
  const model = buildDashboardPeriodReadModel(rows, { year: 2026, month: 8 }, today);
  const canonical = summarizeRealized(rows, today);

  assert.equal(model.realizedDailyMovements.length, 10, 'mês atual termina no hoje financeiro, não no futuro');
  assert.deepEqual(model.realizedDailyMovements[1], {
    date: '2026-08-02',
    day: 2,
    income: 100,
    expense: 25,
  });
  assert.equal(model.realizedDailyMovements.reduce((total, point) => total + point.income, 0), canonical.income);
  assert.equal(model.realizedDailyMovements.reduce((total, point) => total + point.expense, 0), canonical.expense);
  assert.deepEqual(model.scheduledTransactions.map((row) => row.id), ['scheduled', 'future-realized']);
  assert.equal(model.realizedDailyMovements.some((point) => point.income === 50 || point.income === 500), false);
  assert.equal(model.realizedDailyMovements.some((point) => point.expense === 30 || point.income === 999), false);
});

test('read model não sintetiza série quando não existe Receita/Despesa realizada', () => {
  const model = buildDashboardPeriodReadModel([
    transaction('investment-only', { transaction_type: 'investimento', asset_id: 'asset-a' }),
    transaction('programmed-only', { transaction_type: 'despesa', status: 'programado' }),
  ], { year: 2026, month: 8 }, '2026-08-31');
  assert.deepEqual(model.realizedDailyMovements, []);
  assert.deepEqual(model.scheduledTransactions.map((row) => row.id), ['programmed-only']);
});

test('Dashboard implementa composição, loading, vazio, erro e leitura sem números artificiais', async () => {
  const dashboard = await source('app/(tabs)/index.tsx');
  for (const contract of ['MonthSelector', 'DashboardHero', 'DashboardMonthlyMovements', 'DashboardActivity', 'StateView', 'useMobileSnapshot(accessContext, period)']) {
    assert.match(dashboard, new RegExp(contract.replace(/[()]/g, '\\$&')));
  }
  assert.match(dashboard, /styles\.topPanel/);
  assert.match(dashboard, /styles\.body/);
  assert.match(dashboard, /Não foi possível carregar/);
  assert.doesNotMatch(dashboard, /<ChartCard\b/);
  assert.doesNotMatch(dashboard, /PageHeader|PRINCIPAL|Seu panorama financeiro/);
  assert.doesNotMatch(dashboard, /R\$\s*\d|38,55|8\.193|8\.154/);
  assert.doesNotMatch(dashboard, /\.(?:insert|update|upsert|delete|rpc)\s*\(/);
});

test('seletor recolhe o carrossel e, ao expandir, oferece swipe, snap e alternativa acessível', async () => {
  const [selector, dashboard] = await Promise.all([
    source('src/features/dashboard/month-selector.tsx'),
    source('app/(tabs)/index.tsx'),
  ]);
  assert.match(dashboard, /monthSelectorExpanded, setMonthSelectorExpanded.*useState\(false\)/);
  assert.match(selector, /expanded: boolean/);
  assert.match(selector, /onExpandedChange\(expanded: boolean\)/);
  assert.match(selector, /embedded\?: boolean/);
  assert.match(selector, /embedded && styles\.triggerEmbedded/);
  assert.match(dashboard, /<MonthSelector[\s\S]*?embedded/);
  assert.match(selector, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(selector, /name="calendar"/);
  assert.match(selector, /borderColor: tokens\.border\.default/);
  assert.match(selector, /backgroundColor: tokens\.background\.surface/);
  assert.match(selector, /chevron-up.*chevron-down|chevron-down.*chevron-up/);
  assert.match(selector, /expanded \? \(/);
  assert.match(selector, /<FlatList/);
  assert.match(selector, /snapToInterval/);
  assert.match(selector, /monthSequence\(period\)/);
  assert.match(selector, /onMomentumScrollEnd/);
  assert.match(selector, /onScrollEndDrag=\{finishDrag\}/);
  assert.match(selector, /onMomentumScrollBegin/);
  assert.match(selector, /requestAnimationFrame/);
  assert.match(selector, /const offset = event\.nativeEvent\.contentOffset\.x;[\s\S]*?selectFromOffset\(offset\)/);
  assert.doesNotMatch(selector, /requestAnimationFrame\(\(\) => \{[\s\S]*?selectFromOffset\(event\)/);
  assert.match(selector, /onPress=\{\(\) => onChange\(item\)\}/);
  assert.doesNotMatch(selector, /onPress=\{\(\) => \{[\s\S]*?onExpandedChange\(false\)/);
  assert.match(selector, /userIsDragging/);
  assert.match(selector, /onScrollBeginDrag/);
  assert.match(selector, /name: 'decrement', label: 'Mês anterior'/);
  assert.match(selector, /name: 'increment', label: 'Próximo mês'/);
  assert.match(selector, /accessibilityState=\{\{ selected \}\}/);
  assert.match(selector, /useReducedMotion/);
  assert.match(selector, /animated: !reducedMotion/);
  assert.match(selector, /useResponsiveLayout/);
  assert.match(selector, /Math\.min\(width, layout\.contentMaxWidth\)/);
  assert.match(selector, /\[interval, reducedMotion, selectedIndex\]/);
});

test('período participa da leitura e da proteção contra snapshot atrasado', async () => {
  const [repository, hook, layout, transactions] = await Promise.all([
    source('src/features/read-models/mobile-read.repository.ts'),
    source('src/features/read-models/use-mobile-snapshot.ts'),
    source('app/(tabs)/_layout.tsx'),
    source('app/(tabs)/lancamentos.tsx'),
  ]);
  assert.match(repository, /calendarMonthWindow\(period\)/);
  assert.match(repository, /\.gte\('transaction_date', start\)/);
  assert.match(repository, /\.lt\('transaction_date', endExclusive\)/);
  assert.match(repository, /\.eq\('year', window\.year\)/);
  assert.match(repository, /\.eq\('month', window\.month\)/);
  assert.match(repository, /buildDashboardPeriodReadModel\(transactions, period, calendar\.today\)/);
  assert.match(repository, /financialAsOfDate: calendar\.today/);
  assert.match(hook, /periodKey/);
  assert.match(hook, /loadSnapshot\(context, period\)/);
  assert.match(layout, /<FinancialPeriodProvider>/);
  assert.match(transactions, /parseDashboardTransactionsIntent/);
  assert.match(transactions, /transactionMatchesDashboardFlow/);
  assert.match(transactions, /data\.financialAsOfDate/);
  assert.doesNotMatch(transactions, /transactionMatchesDashboardFlow\([^)]*data\.generatedAt/);
});

test('Dashboard mantém árvore ABC única e módulos congelados fora da implementação', async () => {
  const dashboardFiles = await Promise.all([
    source('app/(tabs)/index.tsx'),
    source('src/features/dashboard/dashboard-hero.tsx'),
    source('src/features/dashboard/dashboard-monthly-movements.tsx'),
    source('src/features/dashboard/dashboard-activity.tsx'),
    source('src/features/dashboard/month-selector.tsx'),
  ]);
  const combined = dashboardFiles.join('\n');
  assert.match(combined, /useAvioraTheme/);
  assert.doesNotMatch(combined, /tokens\.id|resolvedTheme|themeTokens\.(?:serene|white|dark)/);
  assert.doesNotMatch(combined, /Open Finance|Saúde V2|Knowledge|Reader|Quick Add|startTrial/);
});

test('topo integra mês, saldo e Receita/Despesa acionáveis numa superfície única', async () => {
  const [hero, dashboard] = await Promise.all([
    source('src/features/dashboard/dashboard-hero.tsx'),
    source('app/(tabs)/index.tsx'),
  ]);
  assert.doesNotMatch(hero, /PANORAMA FINANCEIRO|Movimentos em|periodLabel/);
  assert.match(hero, /variant="ghost"/);
  assert.match(hero, /width < 350/);
  assert.match(hero, /function FlowShortcut/);
  assert.match(hero, /name=\{income \? 'arrow-up' : 'arrow-down'\}/);
  assert.match(hero, /tokens\.status\.onPositive/);
  assert.match(hero, /tokens\.status\.onRisk/);
  assert.match(hero, /styles\.flowIndicator/);
  assert.match(hero, /accessibilityElementsHidden/);
  assert.doesNotMatch(hero, /<Card\b|<Image\b|<LinearGradient\b/);
  assert.doesNotMatch(hero, /currencyGlyph|flowRing|flowArrowMask|allowFontScaling=\{false\}/);
  assert.doesNotMatch(hero, /Desempenho positivo|Controle de gastos|Ao vivo/);
  assert.equal((hero.match(/<FlowShortcut\b/g) ?? []).length, 2);
  assert.match(dashboard, /contentStyle=\{styles\.screenContent\}/);
  assert.match(dashboard, /<View style=\{\[styles\.topPanel/);
  assert.match(dashboard, /<LinearGradient/);
  assert.match(dashboard, /embedded/);
  assert.match(dashboard, /<View style=\{\[styles\.body/);
  assert.match(dashboard, /const periodSelector = \([\s\S]*?<MonthSelector/);
  assert.match(dashboard, /loading && !data[\s\S]*?<Screen>\{periodSelector\}<StateView loading/);
});

test('composição analítica usa série canônica, equivalente acessível e listas agrupadas', async () => {
  const [dashboard, chart, activity, readModel] = await Promise.all([
    source('app/(tabs)/index.tsx'),
    source('src/features/dashboard/dashboard-monthly-movements.tsx'),
    source('src/features/dashboard/dashboard-activity.tsx'),
    source('src/features/dashboard/dashboard-read-model.ts'),
  ]);
  assert.match(dashboard, /data\.dashboard\.realizedDailyMovements/);
  assert.match(dashboard, /data\.dashboard\.scheduledTransactions/);
  assert.match(dashboard, /data\.dashboard\.recentTransactions/);
  assert.doesNotMatch(dashboard, /<TransactionRow\b|<SectionTitle\b/);
  assert.match(chart, /accessibilityRole="image"/);
  assert.match(chart, /accessibleEquivalent/);
  assert.match(chart, /Sem série realizada neste período/);
  assert.match(chart, /Valores do gráfico ocultos/);
  assert.doesNotMatch(chart, /Math\.random|fixture|mock|8\.193|8\.154|38,55/);
  assert.equal((activity.match(/<Card\b/g) ?? []).length, 2);
  assert.match(activity, /breakpoints\.mediumMin/);
  assert.match(activity, /Programados do período/);
  assert.match(activity, /Movimentos recentes/);
  assert.match(activity, /financialValuePresentation/);
  assert.match(readModel, /financialEffect\(transaction, \{ now: today \}\)/);
  assert.doesNotMatch(readModel, /Math\.random|fixture|mock/);
});
