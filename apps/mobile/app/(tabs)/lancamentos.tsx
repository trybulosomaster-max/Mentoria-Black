import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useFinancialPeriod } from '../../src/application/period/financial-period-provider';
import { useAuth } from '../../src/core/auth/AuthProvider';
import type { TransactionRow as TransactionData } from '../../src/core/supabase/database.types';
import { FilterChip, PageHeader, Screen, SearchField, StateView } from '../../src/design-system/components';
import { TransactionRow } from '../../src/design-system/financial-components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';
import { parseDashboardTransactionsIntent, transactionMatchesDashboardFlow } from '../../src/features/dashboard/dashboard-contract';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { signedAmount, transactionStatus, transactionTypeLabel } from '../../src/features/transactions/transaction-presentation';
import { formatDate, formatMoney, sameCalendarMonth } from '../../src/lib/format';

type Filter = 'todos' | 'realizado' | 'programado' | 'cancelado';
const filters: readonly { key: Filter; label: string }[] = [{ key: 'todos', label: 'Todos' }, { key: 'realizado', label: 'Realizados' }, { key: 'programado', label: 'Programados' }, { key: 'cancelado', label: 'Cancelados' }];

function matchesFilter(transaction: TransactionData, filter: Filter) {
  if (filter === 'todos') return true;
  const status = transactionStatus(transaction).label.toLocaleLowerCase('pt-BR');
  if (filter === 'realizado') return status === 'realizado';
  if (filter === 'programado') return status === 'programado';
  return status === 'cancelado';
}

export default function TransactionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string | string[]; month?: string | string[]; flow?: string | string[] }>();
  const intent = useMemo(() => parseDashboardTransactionsIntent(params), [params.flow, params.month, params.year]);
  const { period, setPeriod } = useFinancialPeriod();
  const activePeriod = intent?.period ?? period;
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext, activePeriod);
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [filter, setFilter] = useState<Filter>('todos');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (intent && !sameCalendarMonth(period, intent.period)) setPeriod(intent.period);
  }, [intent, period, setPeriod]);

  const visible = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return data.transactions.filter((transaction) => matchesFilter(transaction, filter)
      && transactionMatchesDashboardFlow(transaction, intent?.flow ?? null, data.financialAsOfDate)
      && (!normalized || [transaction.description, transaction.category, transaction.subcategory].some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(normalized))));
  }, [data, filter, intent?.flow, query]);

  if (loading && !data) return <Screen scroll={false}><StateView loading title="Carregando lançamentos" message="Atualizando o período." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView tone="error" title="Falha ao carregar" message={error} /></Screen>;
  if (!data) return null;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.action.primary} />}>
      <PageHeader eyebrow={data.period.label} title="Lançamentos" description="Seus movimentos, organizados por período." />
      {intent ? (
        <View accessibilityRole="toolbar" accessibilityLabel="Filtro recebido da Principal" style={styles.shortcutFilter}>
          <Text style={styles.shortcutLabel}>Atalho da Principal</Text>
          <FilterChip
            label={intent.flow === 'income' ? 'Receitas' : 'Despesas'}
            selected
            onPress={() => {
              setPeriod(intent.period);
              router.setParams({ flow: 'all' });
            }}
          />
        </View>
      ) : null}
      <SearchField label="Buscar lançamentos" value={query} onChangeText={setQuery} placeholder="Descrição ou categoria" autoCorrect={false} clearButtonMode="while-editing" />
      <View accessibilityRole="toolbar" accessibilityLabel="Filtros de lançamentos" style={styles.filters}>{filters.map((item) => <FilterChip key={item.key} label={item.label} selected={item.key === filter} onPress={() => setFilter(item.key)} />)}</View>
      <Text style={styles.count}>{query || filter !== 'todos' || intent ? `${visible.length} de ${data.transactions.length} lançamentos` : `${data.transactions.length} ${data.transactions.length === 1 ? 'lançamento' : 'lançamentos'} neste período`}</Text>
      {visible.length ? visible.map((transaction) => {
        const status = transactionStatus(transaction);
        return <TransactionRow key={transaction.id} title={transaction.description} meta={`${transactionTypeLabel(transaction.transaction_type)} • ${formatDate(transaction.transaction_date)}${transaction.installment_total ? ` • Parcela ${transaction.installment_number ?? 0}/${transaction.installment_total}` : ''}`} amount={formatMoney(signedAmount(transaction))} status={status.label} tone={status.tone} category={transaction.category || 'Sem categoria'} />;
      }) : <View accessibilityLiveRegion="polite" style={styles.emptyCard}><Text style={styles.emptyTitle}>{intent ? `Nenhuma ${intent.flow === 'income' ? 'receita' : 'despesa'} realizada neste período.` : query || filter !== 'todos' ? 'Nenhum lançamento encontrado' : 'Nenhum lançamento neste período.'}</Text>{query || filter !== 'todos' ? <Text style={styles.empty}>Tente ajustar a busca ou os filtros.</Text> : null}</View>}
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    shortcutFilter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.sm, borderRadius: primitives.radius.md, backgroundColor: tokens.background.surfaceMuted },
    shortcutLabel: { ...textStyles.caption, color: tokens.text.secondary },
    count: { ...textStyles.caption, color: tokens.text.secondary },
    emptyCard: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.lg, borderRadius: primitives.radius.lg, borderWidth: tokens.id === 'aviora-light-a' ? primitives.size.border.thin : StyleSheet.hairlineWidth, borderColor: tokens.border.default, backgroundColor: tokens.background.surface },
    emptyTitle: { ...textStyles.section, color: tokens.text.primary, textAlign: 'center' },
    empty: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center' },
  });
}
