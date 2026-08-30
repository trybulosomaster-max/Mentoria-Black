import type { TransactionRow } from '../../core/supabase/database.types';

export type StatusTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'gold';

export function transactionStatus(transaction: Pick<TransactionRow, 'status'>) {
  const status = String(transaction.status ?? '').toLocaleLowerCase('pt-BR');
  if (['realizado', 'pago', 'paid', 'realized'].includes(status)) {
    return { label: 'Realizado', tone: 'positive' as StatusTone };
  }
  if (['programado', 'pendente', 'pending', 'scheduled'].includes(status)) {
    return { label: 'Programado', tone: 'warning' as StatusTone };
  }
  if (['cancelado', 'canceled', 'cancelled'].includes(status)) {
    return { label: 'Cancelado', tone: 'negative' as StatusTone };
  }
  return { label: 'Não classificado', tone: 'neutral' as StatusTone };
}

export function transactionTypeLabel(value: string | null | undefined): string {
  const type = String(value ?? '').toLocaleLowerCase('pt-BR');
  const labels: Record<string, string> = {
    receita: 'Receita',
    despesa: 'Despesa',
    investimento: 'Investimento',
    transferencia: 'Transferência',
    resgate: 'Resgate',
  };
  return labels[type] ?? 'Outro';
}

export function signedAmount(transaction: Pick<TransactionRow, 'amount' | 'transaction_type'>): number {
  const amount = Number(transaction.amount || 0);
  if (transaction.transaction_type === 'despesa' || transaction.transaction_type === 'investimento') return -amount;
  return amount;
}
