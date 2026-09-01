import type { TransactionListItem } from './transactions-read-model.ts';

export type TransactionSelection = Readonly<{
  id: string;
  scopeKey: string;
}>;

export function createTransactionSelection(id: string, scopeKey: string): TransactionSelection {
  if (!id || !scopeKey) throw new Error('Seleção de lançamento requer item e escopo ativos.');
  return Object.freeze({ id, scopeKey });
}

export function resolveTransactionSelection(
  items: readonly TransactionListItem[],
  selection: TransactionSelection | null,
  scopeKey: string,
): TransactionListItem | null {
  if (!selection || selection.scopeKey !== scopeKey) return null;
  return items.find((item) => item.id === selection.id) ?? null;
}
