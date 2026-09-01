import type { TransactionRow } from '../../core/supabase/database.types.ts';
import {
  canonicalType,
  financialEffect,
  type TemporalStateName,
} from '../../domain/finance/foundation-financial-read-model.ts';

export type StatusTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'gold';

export function transactionStatusFromTemporalState(state: TemporalStateName) {
  if (state === 'efetivado') {
    return { label: 'Realizado', tone: 'positive' as StatusTone };
  }
  if (state === 'previsto_materializado') {
    return { label: 'Programado', tone: 'warning' as StatusTone };
  }
  if (state === 'cancelado') {
    return { label: 'Cancelado', tone: 'negative' as StatusTone };
  }
  return { label: 'Não classificado', tone: 'neutral' as StatusTone };
}

export function transactionStatus(transaction: TransactionRow, now: unknown) {
  return transactionStatusFromTemporalState(financialEffect(transaction, { now }).temporalState);
}

export function transactionTypeLabel(value: string | null | undefined): string {
  const type = canonicalType({ transaction_type: value });
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
  const type = canonicalType(transaction);
  if (type === 'despesa' || type === 'investimento') return -amount;
  return amount;
}
