import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import type { TransactionRow } from '../../src/core/supabase/database.types';
import {
  Card,
  FilterChip,
  PageHeader,
  Pill,
  Screen,
  StateView,
  SearchField,
  commonStyles,
} from '../../src/design-system/components';
import { colors, primitives, semantic, spacing, textStyles } from '../../src/design-system/tokens';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import {
  signedAmount,
  transactionStatus,
  transactionTypeLabel,
} from '../../src/features/transactions/transaction-presentation';
import { formatDate, formatMoney } from '../../src/lib/format';

type Filter = 'todos' | 'realizado' | 'programado' | 'cancelado';
const filters: readonly { key: Filter; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'realizado', label: 'Realizados' },
  { key: 'programado', label: 'Programados' },
  { key: 'cancelado', label: 'Cancelados' },
];

function matchesFilter(transaction: TransactionRow, filter: Filter) {
  if (filter === 'todos') return true;
  const status = transactionStatus(transaction).label.toLocaleLowerCase('pt-BR');
  if (filter === 'realizado') return status === 'realizado';
  if (filter === 'programado') return status === 'programado';
  return status === 'cancelado';
}

export default function TransactionsScreen() {
  const { user } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(user?.id);
  const [filter, setFilter] = useState<Filter>('todos');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return (data?.transactions ?? []).filter((transaction) => {
      if (!matchesFilter(transaction, filter)) return false;
      if (!normalized) return true;
      return [transaction.description, transaction.category, transaction.subcategory]
        .some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(normalized));
    });
  }, [data?.transactions, filter, query]);

  if (loading && !data) return <Screen scroll={false}><StateView loading title="Carregando lançamentos" message="Buscando o período sob RLS." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView title="Falha ao carregar" message={error} /></Screen>;
  if (!data) return null;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.gold} />}>
      <PageHeader
        eyebrow={data.period.label}
        title="Lançamentos"
        description="Consulte os movimentos sem confundir status, data financeira ou tipo."
      />
      <SearchField
        label="Buscar lançamentos"
        value={query}
        onChangeText={setQuery}
        placeholder="Descrição ou categoria"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <View style={styles.filters}>
        {filters.map((item) => {
          const active = item.key === filter;
          return (
            <FilterChip
              key={item.key}
              label={item.label}
              selected={active}
              onPress={() => setFilter(item.key)}
            />
          );
        })}
      </View>

      <Text style={styles.count}>{visible.length} de {data.transactions.length} lançamentos no período</Text>

      {visible.length ? visible.map((transaction) => {
        const status = transactionStatus(transaction);
        const amount = signedAmount(transaction);
        return (
          <Card key={transaction.id} style={styles.transactionCard}>
            <View style={commonStyles.between}>
              <View style={styles.copy}>
                <Text numberOfLines={2} style={styles.title}>{transaction.description}</Text>
                <Text style={styles.meta}>{transactionTypeLabel(transaction.transaction_type)} • {formatDate(transaction.transaction_date)}</Text>
              </View>
              <Text style={[styles.amount, amount < 0 ? commonStyles.negative : commonStyles.positive]}>{formatMoney(amount)}</Text>
            </View>
            <View style={commonStyles.wrap}>
              <Pill label={status.label} tone={status.tone} />
              <Pill label={transaction.category || 'Sem categoria'} />
              {transaction.installment_total ? <Pill label={`${transaction.installment_number ?? 0}/${transaction.installment_total} parcelas`} tone="gold" /> : null}
            </View>
          </Card>
        );
      }) : (
        <Card><Text style={styles.empty}>Nenhum lançamento corresponde aos filtros.</Text></Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  count: { ...textStyles.caption, color: semantic.text.subtle },
  transactionCard: { gap: spacing.sm },
  copy: { flex: 1, minWidth: spacing.none, gap: spacing.xxs },
  title: { ...textStyles.body, color: semantic.text.primary, fontFamily: primitives.typography.family.uiExtraBold },
  meta: { ...textStyles.caption, color: semantic.text.secondary },
  amount: textStyles.moneyM,
  empty: { ...textStyles.bodySmall, color: semantic.text.secondary, textAlign: 'center', padding: spacing.lg },
});
