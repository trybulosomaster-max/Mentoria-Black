import type {
  AccountRow,
  CardRow,
  TransactionRow,
} from '../../core/supabase/database.types.ts';
import {
  financialEffect,
  type TemporalStateName,
  type TransactionType,
} from '../../domain/finance/foundation-financial-read-model.ts';
import { formatDate, titleCase } from '../../lib/format.ts';
import {
  signedAmount,
  transactionStatusFromTemporalState,
  transactionTypeLabel,
  type StatusTone,
} from './transaction-presentation.ts';

export type TransactionFilter = 'all' | 'income' | 'expense' | 'card';
export type TransactionAmountTone = 'positive' | 'risk' | 'neutral';

export type TransactionDetailField = Readonly<{
  label: string;
  value: string;
}>;

export type TransactionListItem = Readonly<{
  id: string;
  createdAt: string;
  dateKey: string;
  dateLabel: string;
  title: string;
  amount: number;
  amountTone: TransactionAmountTone;
  type: TransactionType;
  temporalState: TemporalStateName;
  valid: boolean;
  typeLabel: string;
  statusLabel: string;
  statusTone: StatusTone;
  categoryLabel: string;
  originLabel: string;
  installmentLabel: string;
  isCard: boolean;
  searchText: string;
  detailComposition: readonly TransactionDetailField[];
  detailOrigin: readonly TransactionDetailField[];
}>;

export type TransactionDateSection = Readonly<{
  key: string;
  title: string;
  data: readonly TransactionListItem[];
}>;

export type TransactionsReadModel = Readonly<{
  allItems: readonly TransactionListItem[];
  visibleItems: readonly TransactionListItem[];
  sections: readonly TransactionDateSection[];
}>;

type BuildTransactionsReadModelInput = Readonly<{
  transactions: readonly TransactionRow[];
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  filter: TransactionFilter;
  query: string;
  now: unknown;
  dashboardFlow?: 'income' | 'expense' | null;
}>;

type BuildTransactionsCatalogInput = Pick<
  BuildTransactionsReadModelInput,
  'transactions' | 'accounts' | 'cards' | 'now'
>;

type SelectTransactionsReadModelInput = Readonly<{
  allItems: readonly TransactionListItem[];
  filter: TransactionFilter;
  query: string;
  dashboardFlow?: 'income' | 'expense' | null;
}>;

const typeFilter: Readonly<Record<Exclude<TransactionFilter, 'all' | 'card'>, TransactionType>> = Object.freeze({
  income: 'receita',
  expense: 'despesa',
});

function compactText(value: unknown): string {
  return String(value ?? '').trim();
}

function searchable(value: unknown): string {
  return compactText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function humanize(value: unknown): string {
  const text = compactText(value).replace(/[_-]+/g, ' ');
  return text ? titleCase(text.toLocaleLowerCase('pt-BR')) : '';
}

function accountName(accounts: ReadonlyMap<string, AccountRow>, id: string | null | undefined): string {
  if (!id) return '';
  return compactText(accounts.get(id)?.name) || 'Conta não disponível';
}

function cardName(cards: ReadonlyMap<string, CardRow>, id: string | null | undefined): string {
  if (!id) return '';
  return compactText(cards.get(id)?.name) || 'Cartão não disponível';
}

function originLabel(
  transaction: TransactionRow,
  type: TransactionType,
  accounts: ReadonlyMap<string, AccountRow>,
  cards: ReadonlyMap<string, CardRow>,
): string {
  if (transaction.card_id) return cardName(cards, transaction.card_id);
  if (type === 'transferencia') {
    const source = accountName(accounts, transaction.source_account_id) || 'Origem não informada';
    const destination = accountName(accounts, transaction.destination_account_id) || 'Destino não informado';
    return `${source} → ${destination}`;
  }
  const accountId = type === 'receita' || type === 'resgate'
    ? transaction.destination_account_id ?? transaction.account_id
    : transaction.source_account_id ?? transaction.account_id;
  return accountName(accounts, accountId) || humanize(transaction.payment_method);
}

function installmentLabel(transaction: TransactionRow): string {
  const total = Number(transaction.installment_total);
  if (!Number.isInteger(total) || total <= 0) return '';
  const number = Number(transaction.installment_number);
  if (!Number.isInteger(number) || number <= 0 || number > total) return `${total} parcelas`;
  return `Parcela ${number}/${total}`;
}

function amountTone(type: TransactionType): TransactionAmountTone {
  if (type === 'receita' || type === 'resgate') return 'positive';
  if (type === 'despesa' || type === 'investimento') return 'risk';
  return 'neutral';
}

function detailFields(
  transaction: TransactionRow,
  dateKey: string,
  typeLabel: string,
  statusLabel: string,
  origin: string,
  installment: string,
): Readonly<{
  composition: readonly TransactionDetailField[];
  origin: readonly TransactionDetailField[];
}> {
  const composition: TransactionDetailField[] = [
    { label: 'Data', value: formatDate(dateKey) },
    { label: 'Tipo', value: typeLabel },
    { label: 'Status', value: statusLabel },
  ];
  const category = compactText(transaction.category);
  const subcategory = compactText(transaction.subcategory);
  const note = compactText(transaction.note);
  if (category) composition.push({ label: 'Categoria', value: category });
  if (subcategory) composition.push({ label: 'Subcategoria', value: subcategory });
  if (installment) composition.push({ label: 'Parcelamento', value: installment });
  if (transaction.recurring_occurrence_date) {
    composition.push({ label: 'Recorrência', value: `Ocorrência de ${formatDate(transaction.recurring_occurrence_date)}` });
  } else if (transaction.recurring_series_id) {
    composition.push({ label: 'Recorrência', value: 'Ocorrência recorrente' });
  }
  if (note) composition.push({ label: 'Observação', value: note });
  const originFields = origin
    ? [{ label: transaction.card_id ? 'Cartão' : 'Conta ou origem', value: origin }]
    : [];
  return Object.freeze({
    composition: Object.freeze(composition.map((field) => Object.freeze(field))),
    origin: Object.freeze(originFields.map((field) => Object.freeze(field))),
  });
}

function buildItem(
  transaction: TransactionRow,
  accounts: ReadonlyMap<string, AccountRow>,
  cards: ReadonlyMap<string, CardRow>,
  now: unknown,
): TransactionListItem {
  const effect = financialEffect(transaction, { now });
  const status = transactionStatusFromTemporalState(effect.temporalState);
  const typeLabel = transactionTypeLabel(transaction.transaction_type);
  const origin = originLabel(transaction, effect.type, accounts, cards);
  const installment = installmentLabel(transaction);
  const dateKey = effect.financialDate || '';
  const title = compactText(transaction.description) || 'Lançamento sem descrição';
  const categoryLabel = compactText(transaction.category);
  const detail = detailFields(transaction, dateKey, typeLabel, status.label, origin, installment);
  const searchText = searchable([
    title,
    typeLabel,
    status.label,
    categoryLabel,
    transaction.subcategory,
    origin,
    installment,
    transaction.note,
  ].filter(Boolean).join(' '));
  return Object.freeze({
    id: transaction.id,
    createdAt: transaction.created_at,
    dateKey,
    dateLabel: dateKey ? formatDate(dateKey) : 'Sem data informada',
    title,
    amount: signedAmount(transaction),
    amountTone: amountTone(effect.type),
    type: effect.type,
    temporalState: effect.temporalState,
    valid: effect.valid,
    typeLabel,
    statusLabel: status.label,
    statusTone: status.tone,
    categoryLabel,
    originLabel: origin,
    installmentLabel: installment,
    isCard: Boolean(transaction.card_id),
    searchText,
    detailComposition: detail.composition,
    detailOrigin: detail.origin,
  });
}

function transactionOrder(left: TransactionListItem, right: TransactionListItem): number {
  const byDate = right.dateKey.localeCompare(left.dateKey);
  if (byDate) return byDate;
  const byCreated = right.createdAt.localeCompare(left.createdAt);
  return byCreated || left.id.localeCompare(right.id);
}

function matchesFilter(item: TransactionListItem, filter: TransactionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'card') return item.isCard;
  return item.valid && item.type === typeFilter[filter];
}

function matchesDashboardFlow(item: TransactionListItem, flow: 'income' | 'expense' | null): boolean {
  if (!flow) return true;
  const expectedType = typeFilter[flow];
  return item.valid && item.type === expectedType && item.temporalState === 'efetivado';
}

function groupByDate(items: readonly TransactionListItem[]): readonly TransactionDateSection[] {
  const sections = new Map<string, TransactionListItem[]>();
  for (const item of items) {
    const key = item.dateKey || 'sem-data';
    const current = sections.get(key);
    if (current) current.push(item);
    else sections.set(key, [item]);
  }
  return Object.freeze([...sections.entries()].map(([key, data]) => Object.freeze({
    key,
    title: data[0]?.dateLabel ?? 'Sem data informada',
    data: Object.freeze(data),
  })));
}

export function buildTransactionsCatalog(
  input: BuildTransactionsCatalogInput,
): readonly TransactionListItem[] {
  const accounts = new Map(input.accounts.map((account) => [account.id, account]));
  const cards = new Map(input.cards.map((card) => [card.id, card]));
  return Object.freeze(input.transactions
    .map((transaction) => buildItem(transaction, accounts, cards, input.now))
    .sort(transactionOrder));
}

export function selectTransactionsReadModel(
  input: SelectTransactionsReadModelInput,
): TransactionsReadModel {
  const normalizedQuery = searchable(input.query);
  const dashboardFlow = input.dashboardFlow ?? null;
  const visibleItems = Object.freeze(input.allItems.filter((item) => (
    matchesDashboardFlow(item, dashboardFlow)
    && matchesFilter(item, input.filter)
    && (!normalizedQuery || item.searchText.includes(normalizedQuery))
  )));
  return Object.freeze({
    allItems: input.allItems,
    visibleItems,
    sections: groupByDate(visibleItems),
  });
}

export function buildTransactionsReadModel(input: BuildTransactionsReadModelInput): TransactionsReadModel {
  return selectTransactionsReadModel({
    allItems: buildTransactionsCatalog(input),
    filter: input.filter,
    query: input.query,
    dashboardFlow: input.dashboardFlow,
  });
}
