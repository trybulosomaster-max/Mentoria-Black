import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type {
  AccountRow,
  CardRow,
  TransactionRow,
} from '../src/core/supabase/database.types.ts';
import {
  dashboardTransactionsHref,
  parseDashboardTransactionsIntent,
} from '../src/features/dashboard/dashboard-contract.ts';
import {
  buildTransactionsReadModel,
  type TransactionFilter,
} from '../src/features/transactions/transactions-read-model.ts';
import {
  createTransactionSelection,
  resolveTransactionSelection,
} from '../src/features/transactions/transactions-selection.ts';

async function source(relative: string): Promise<string> {
  return readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
}

function transaction(id: string, overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id,
    user_id: 'owner-a',
    amount: 100,
    transaction_type: 'receita',
    status: 'realizado',
    transaction_date: '2026-09-10',
    created_at: `2026-09-10T12:00:${String(id.length).padStart(2, '0')}.000Z`,
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
    updated_at: '2026-09-10T12:00:00.000Z',
    ...overrides,
  };
}

const accounts: readonly AccountRow[] = Object.freeze([
  {
    id: 'account-a', user_id: 'owner-a', name: 'Conta Principal', account_type: 'corrente',
    institution: 'Banco A', opening_balance: 0, statement_balance: 0, balance_as_of: '2026-09-15',
    last_reconciled_at: null, note: null, created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'account-b', user_id: 'owner-a', name: 'Reserva', account_type: 'poupanca',
    institution: 'Banco B', opening_balance: 0, statement_balance: 0, balance_as_of: '2026-09-15',
    last_reconciled_at: null, note: null, created_at: '2026-01-01T00:00:00.000Z',
  },
]);

const cards: readonly CardRow[] = Object.freeze([
  {
    id: 'card-a', user_id: 'owner-a', name: 'AVIORA Black', brand: 'Visa', institution: 'Banco A',
    limit: 10_000, closing_day: 20, due_day: 28, note: null, created_at: '2026-01-01T00:00:00.000Z',
  },
]);

function model(
  rows: readonly TransactionRow[],
  filter: TransactionFilter = 'all',
  query = '',
  dashboardFlow: 'income' | 'expense' | null = null,
) {
  return buildTransactionsReadModel({
    transactions: rows,
    accounts,
    cards,
    filter,
    query,
    dashboardFlow,
    now: '2026-09-15',
  });
}

test('herda período e filtro allowlisted da Principal sem criar outro contrato de mês', async () => {
  const period = { year: 2026, month: 9 } as const;
  assert.deepEqual(dashboardTransactionsHref(period, 'income'), {
    pathname: '/(tabs)/lancamentos',
    params: { year: '2026', month: '09', flow: 'income', origin: 'dashboard' },
  });
  assert.deepEqual(dashboardTransactionsHref(period, 'all'), {
    pathname: '/(tabs)/lancamentos',
    params: { year: '2026', month: '09', flow: 'all', origin: 'dashboard' },
  });
  assert.deepEqual(parseDashboardTransactionsIntent({ year: '2026', month: '09', flow: 'card', origin: 'dashboard' }), {
    period,
    flow: 'card',
    origin: 'dashboard',
  });
  assert.deepEqual(parseDashboardTransactionsIntent({ year: '2026', month: '09', flow: 'expense' }), {
    period,
    flow: 'expense',
    origin: null,
  });
  assert.equal(parseDashboardTransactionsIntent({ year: ['2026', '2025'], month: '09', flow: 'all' }), null);
  const [screen, layout] = await Promise.all([
    source('app/(tabs)/lancamentos.tsx'),
    source('app/(tabs)/_layout.tsx'),
  ]);
  assert.match(screen, /useFinancialPeriod\(\)/);
  assert.match(screen, /<MonthSelector/);
  assert.match(layout, /<FinancialPeriodProvider>/);
  assert.equal((`${screen}\n${layout}`.match(/<FinancialPeriodProvider>/g) ?? []).length, 1);
});

test('filtro Todas preserva todos os lançamentos e busca ignora acentos', () => {
  const rows = [
    transaction('income', { description: 'Salário mensal' }),
    transaction('expense', { transaction_type: 'despesa', description: 'Educação', category: 'Formação' }),
    transaction('transfer', { transaction_type: 'transferencia', source_account_id: 'account-a', destination_account_id: 'account-b' }),
  ];
  assert.deepEqual(model(rows).visibleItems.map((item) => item.id).sort(), ['expense', 'income', 'transfer']);
  assert.deepEqual(model(rows, 'all', 'educacao').visibleItems.map((item) => item.id), ['expense']);
});

test('filtro Receitas usa tipo canônico e o drill-down da Principal mantém somente realizado', () => {
  const rows = [
    transaction('income-alias', { transaction_type: 'income' }),
    transaction('future-income', { transaction_type: 'receita', transaction_date: '2026-09-20' }),
    transaction('invalid-income', { transaction_type: 'receita', amount: 0 }),
    transaction('expense', { transaction_type: 'despesa' }),
  ];
  assert.deepEqual(model(rows, 'income').visibleItems.map((item) => item.id), ['future-income', 'income-alias']);
  assert.deepEqual(model(rows, 'income', '', 'income').visibleItems.map((item) => item.id), ['income-alias']);
  assert.deepEqual(model(rows, 'all', '', 'income').visibleItems.map((item) => item.id), ['income-alias']);
  assert.equal(model(rows).allItems.some((item) => item.id === 'invalid-income'), true);
  assert.equal(model(rows).allItems.find((item) => item.id === 'future-income')?.statusLabel, 'Programado');
});

test('filtro Despesas mostra somente o tipo despesa com valor vermelho semântico', () => {
  const rows = [
    transaction('expense', { transaction_type: 'expense', amount: 75 }),
    transaction('investment', { transaction_type: 'investimento', amount: 50, asset_id: 'asset-a' }),
    transaction('income'),
  ];
  const visible = model(rows, 'expense').visibleItems;
  assert.deepEqual(visible.map((item) => item.id), ['expense']);
  assert.equal(visible[0]?.amount, -75);
  assert.equal(visible[0]?.amountTone, 'risk');
});

test('filtro Cartões usa somente card_id exato e resolve a origem no mesmo snapshot', () => {
  const rows = [
    transaction('card', { transaction_type: 'despesa', card_id: 'card-a', description: 'Compra' }),
    transaction('name-only', { description: 'AVIORA Black' }),
    transaction('missing-card', { transaction_type: 'despesa', card_id: 'card-missing' }),
  ];
  const visible = model(rows, 'card').visibleItems;
  assert.deepEqual(visible.map((item) => item.id).sort(), ['card', 'missing-card']);
  assert.equal(visible.find((item) => item.id === 'card')?.originLabel, 'AVIORA Black');
  assert.equal(visible.find((item) => item.id === 'missing-card')?.originLabel, 'Cartão não disponível');
});

test('agrupa por data financeira canônica e ordena por data, criação e id', () => {
  const rows = [
    transaction('older', { transaction_date: '2026-09-08' }),
    transaction('b', { transaction_date: '2026-09-10', created_at: '2026-09-10T10:00:00.000Z' }),
    transaction('a', { transaction_date: '2026-09-10', created_at: '2026-09-10T10:00:00.000Z' }),
    transaction('latest', { transaction_date: '2026-09-11' }),
  ];
  const readModel = model(rows);
  assert.deepEqual(readModel.sections.map((section) => section.key), ['2026-09-11', '2026-09-10', '2026-09-08']);
  assert.deepEqual(readModel.sections[1]?.data.map((item) => item.id), ['a', 'b']);
  assert.equal(readModel.sections[0]?.title.includes('11'), true);
});

test('drill-down expõe apenas campos disponíveis e nunca vaza ids ou a linha bruta', () => {
  const card = transaction('card-detail', {
    transaction_type: 'despesa', card_id: 'card-a', category: 'Alimentação', subcategory: 'Restaurante',
    note: 'Jantar', installment_number: null, installment_total: 4, recurring_occurrence_date: '2026-09-10',
  });
  const transfer = transaction('transfer-detail', {
    transaction_type: 'transferencia', source_account_id: 'account-a', destination_account_id: 'account-b',
  });
  const readModel = model([card, transfer]);
  const cardItem = readModel.allItems.find((item) => item.id === 'card-detail');
  const transferItem = readModel.allItems.find((item) => item.id === 'transfer-detail');
  assert.equal(cardItem?.originLabel, 'AVIORA Black');
  assert.equal(transferItem?.originLabel, 'Conta Principal → Reserva');
  assert.deepEqual(cardItem?.detailComposition.map((field) => field.label), [
    'Data', 'Tipo', 'Status', 'Categoria', 'Subcategoria', 'Parcelamento', 'Recorrência', 'Observação',
  ]);
  assert.deepEqual(cardItem?.detailOrigin, [{ label: 'Cartão', value: 'AVIORA Black' }]);
  assert.equal(cardItem?.installmentLabel, '4 parcelas');
  assert.doesNotMatch(JSON.stringify(cardItem), /Parcela 0\//);
  const serialized = JSON.stringify(readModel);
  assert.doesNotMatch(serialized, /owner-a|account-a|account-b|card-a|recurring_series_id|user_id/);
  assert.equal('transaction' in (cardItem ?? {}), false);
  assert.equal(Object.isFrozen(readModel), true);
  assert.equal(Object.isFrozen(cardItem), true);
  assert.equal(Object.isFrozen(cardItem?.detailComposition), true);
  assert.equal(Object.isFrozen(cardItem?.detailOrigin), true);
});

test('tela declara loading, erro, mês vazio, filtro vazio e detalhe acessível', async () => {
  const [screen, components] = await Promise.all([
    source('app/(tabs)/lancamentos.tsx'),
    source('src/features/transactions/transactions-components.tsx'),
  ]);
  for (const contract of ['Carregando lançamentos', 'Não foi possível carregar', 'Nenhum movimento em', 'Nenhum lançamento encontrado']) {
    assert.match(screen, new RegExp(contract));
  }
  assert.match(screen, /<SectionList/);
  assert.match(screen, /useDeferredValue\(query\)/);
  assert.match(screen, /buildTransactionsCatalog/);
  assert.match(screen, /selectTransactionsReadModel/);
  assert.match(components, /item\.dateLabel, item\.title/);
  assert.match(screen, /stickySectionHeadersEnabled=\{false\}/);
  assert.match(screen, /accessibilityRole="toolbar"/);
  assert.match(components, /accessibilityHint="Abre os detalhes deste lançamento\."/);
  assert.match(components, /<BottomSheet/);
  assert.match(components, /minHeight: 76/);
  assert.equal((components.match(/width < 390/g) ?? []).length, 2);
  assert.match(screen, /if \(nextFilter === filter\) return/);
  assert.doesNotMatch(screen, /CTA|Adicionar lançamento|Novo lançamento/);
});

test('Transações consome métricas e efeito canônicos sem segunda agregação ou acesso ao backend', async () => {
  const [screen, readModel, presentation, components] = await Promise.all([
    source('app/(tabs)/lancamentos.tsx'),
    source('src/features/transactions/transactions-read-model.ts'),
    source('src/features/transactions/transaction-presentation.ts'),
    source('src/features/transactions/transactions-components.tsx'),
  ]);
  const combined = `${screen}\n${readModel}\n${presentation}\n${components}`;
  assert.match(screen, /data\.metrics\.monthlyCashFlow/);
  assert.match(screen, /data\.metrics\.realizedIncome/);
  assert.match(screen, /data\.metrics\.realizedExpense/);
  assert.match(readModel, /financialEffect\(transaction, \{ now \}\)/);
  assert.match(presentation, /financialEffect\(transaction, \{ now \}\)/);
  assert.doesNotMatch(combined, /@supabase\/supabase-js|requireSupabaseClient|getSupabaseClient|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/i);
  assert.doesNotMatch(combined, /fetch\s*\(|axios|XMLHttpRequest/);
});

test('Quick Add permanece montado, sem handlers, rotas ou writes', async () => {
  const [layout, host, contract] = await Promise.all([
    source('app/(tabs)/_layout.tsx'),
    source('src/features/quick-actions/quick-action-host.tsx'),
    source('src/features/quick-actions/quick-action-contract.ts'),
  ]);
  assert.match(layout, /<QuickActionHost tabBarHeight=\{tabBarHeight\} \/>/);
  assert.doesNotMatch(layout, /QuickActionHost[^>]*(?:handler|route|href)/);
  assert.match(host, /const enabled = Boolean\(handlers\[action\.id\]\)/);
  assert.match(host, /disabled=\{!enabled\}/);
  assert.doesNotMatch(`${host}\n${contract}`, /expo-router|\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(|\.rpc\s*\(/i);
});

test('Dashboard congelada preserva módulos e aceita somente rota e seletor compartilhado autorizados', async () => {
  const expected = new Map<string, string>([
    ['src/features/dashboard/dashboard-hero.tsx', '5b6ede9fe1be47754ec09f15b637a2663e2c83f601db16133af79fa97ed52d45'],
    ['src/features/dashboard/dashboard-monthly-movements.tsx', 'a1695412ea953c334d92575aa54139fdc607a3472649bebae7ca36888658714f'],
    ['src/features/dashboard/dashboard-activity.tsx', 'ba6b44ae9416e15e70e34344788cb638078d1dd6e056f2e5e5029c62bcf82baf'],
    ['src/features/dashboard/month-selector.tsx', '77d199a006e0edce5b180590244d6dd925b765341052cd1bf6b0126596dfae84'],
    ['src/features/dashboard/month-selector-snap.ts', '9cc0ecf217aaaf4124a1a7842caccd134f7215234be3aa332581c38da6c221ad'],
    ['src/features/dashboard/dashboard-read-model.ts', 'aa4ec8cb5dcc98063ae07f63127e6d000210f0fc6df637e27ece91b53610f3e8'],
  ]);
  for (const [file, hash] of expected) {
    assert.equal(createHash('sha256').update(await source(file)).digest('hex'), hash, file);
  }
  const dashboard = await source('app/(tabs)/index.tsx');
  const normalized = dashboard.replace(
    /  const openAllTransactions = \(\) => \{\n[\s\S]*?\n  \};/,
    '  const openAllTransactions = () => {\n    __TRANSACTIONS_ROUTE_CONTRACT__\n  };',
  );
  assert.equal(createHash('sha256').update(normalized).digest('hex'), 'fa96e905186f3de202040dc0e7de9d9aa66935b3d963f132f3950a98be8b651d');
  assert.match(dashboard, /router\.push\(dashboardTransactionsHref\(period, 'all'\)\)/);
});

test('detalhe permanece preso ao snapshot owner/período e desaparece sincronicamente na troca de identidade', async () => {
  const itemA = model([transaction('shared', { description: 'Movimento de A' })]).allItems[0];
  const itemB = model([transaction('shared', { description: 'Movimento de B' })]).allItems[0];
  assert.ok(itemA);
  assert.ok(itemB);
  const selection = createTransactionSelection('shared', 'owner-a:2026-09');
  assert.equal(resolveTransactionSelection([itemA], selection, 'owner-a:2026-09')?.title, 'Movimento de A');
  assert.equal(resolveTransactionSelection([itemB], selection, 'owner-b:2026-09'), null);
  assert.equal(resolveTransactionSelection([itemA], selection, 'owner-a:2026-10'), null);

  const [screen, hook, repository] = await Promise.all([
    source('app/(tabs)/lancamentos.tsx'),
    source('src/features/read-models/use-mobile-snapshot.ts'),
    source('src/features/read-models/mobile-read.repository.ts'),
  ]);
  assert.match(screen, /resolveTransactionSelection\(model\.allItems, selection, selectionScopeKey\)/);
  assert.match(screen, /createTransactionSelection\(item\.id, selectionScopeKey\)/);
  assert.match(screen, /accessContext\?\.generation/);
  assert.match(screen, /accessContext\?\.resourceOwnerId/);
  assert.match(screen, /setSelection\(null\)/);
  assert.match(hook, /resourceOwnerId/);
  assert.match(hook, /requestGeneration/);
  assert.match(hook, /requestIsCurrent/);
  assert.match(repository, /actingUserId !== context\.resourceOwnerId/);
  assert.match(repository, /\.eq\('user_id', userId\)/);
});
