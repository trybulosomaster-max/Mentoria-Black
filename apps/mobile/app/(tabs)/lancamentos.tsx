import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useFinancialPeriod } from '../../src/application/period/financial-period-provider';
import { useAuth } from '../../src/core/auth/AuthProvider';
import {
  AppButton,
  FilterChip,
  PageHeader,
  Screen,
  SearchField,
  StateView,
} from '../../src/design-system/components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import {
  primitives,
  spacing,
  textStyles,
  type ThemeTokens,
} from '../../src/design-system/tokens';
import {
  parseDashboardTransactionsIntent,
  type DashboardTransactionsOrigin,
} from '../../src/features/dashboard/dashboard-contract';
import { MonthSelector } from '../../src/features/dashboard/month-selector';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import {
  TransactionDateHeader,
  TransactionDetailSheet,
  TransactionListRow,
  TransactionsSummary,
} from '../../src/features/transactions/transactions-components';
import {
  buildTransactionsCatalog,
  selectTransactionsReadModel,
  type TransactionDateSection,
  type TransactionFilter,
  type TransactionListItem,
} from '../../src/features/transactions/transactions-read-model';
import {
  createTransactionSelection,
  resolveTransactionSelection,
  type TransactionSelection,
} from '../../src/features/transactions/transactions-selection';
import {
  calendarMonthKey,
  calendarMonthLabel,
  sameCalendarMonth,
  type CalendarMonth,
} from '../../src/lib/format';

const filters: readonly { key: TransactionFilter; label: string }[] = Object.freeze([
  { key: 'all', label: 'Todas' },
  { key: 'income', label: 'Receitas' },
  { key: 'expense', label: 'Despesas' },
  { key: 'card', label: 'Cartões' },
]);

type RouteParams = Readonly<{
  year?: string | string[];
  month?: string | string[];
  flow?: string | string[];
  origin?: string | string[];
}>;

function intentKey(intent: ReturnType<typeof parseDashboardTransactionsIntent>): string {
  if (!intent) return '';
  return `${calendarMonthKey(intent.period)}:${intent.flow}:${intent.origin ?? 'direct'}`;
}

function emptyCopy(
  period: CalendarMonth,
  filter: TransactionFilter,
  query: string,
  dashboardFlow: 'income' | 'expense' | null,
) {
  if (query.trim()) {
    return Object.freeze({
      title: 'Nenhum lançamento encontrado',
      message: 'Ajuste a busca ou escolha outro filtro.',
    });
  }
  if (dashboardFlow) {
    return Object.freeze({
      title: `Nenhuma ${dashboardFlow === 'income' ? 'receita' : 'despesa'} realizada`,
      message: `A Principal não possui essa composição em ${calendarMonthLabel(period)}.`,
    });
  }
  if (filter === 'income') return Object.freeze({ title: 'Nenhuma receita no período', message: 'Não há entradas para este filtro.' });
  if (filter === 'expense') return Object.freeze({ title: 'Nenhuma despesa no período', message: 'Não há saídas para este filtro.' });
  if (filter === 'card') return Object.freeze({ title: 'Nenhum lançamento de cartão', message: 'Não há movimentos com origem em cartão neste período.' });
  return Object.freeze({
    title: `Nenhum movimento em ${calendarMonthLabel(period)}`,
    message: 'Quando houver lançamentos confirmados, eles aparecerão aqui.',
  });
}

export default function TransactionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<RouteParams>();
  const intent = useMemo(
    () => parseDashboardTransactionsIntent(params),
    [params.flow, params.month, params.origin, params.year],
  );
  const nextIntentKey = intentKey(intent);
  const [appliedIntentKey, setAppliedIntentKey] = useState('');
  const { period, setPeriod } = useFinancialPeriod();
  const activePeriod = intent && appliedIntentKey !== nextIntentKey ? intent.period : period;
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext, activePeriod);
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [filter, setFilter] = useState<TransactionFilter>('all');
  const [dashboardOrigin, setDashboardOrigin] = useState(false);
  const [query, setQuery] = useState('');
  const [monthSelectorExpanded, setMonthSelectorExpanded] = useState(false);
  const [selection, setSelection] = useState<TransactionSelection | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!intent || appliedIntentKey === nextIntentKey) return;
    if (!sameCalendarMonth(period, intent.period)) setPeriod(intent.period);
    setFilter(intent.flow);
    setDashboardOrigin(intent.origin === 'dashboard');
    setAppliedIntentKey(nextIntentKey);
  }, [appliedIntentKey, intent, nextIntentKey, period, setPeriod]);

  useEffect(() => {
    setSelection(null);
  }, [accessContext?.generation, accessContext?.resourceOwnerId, activePeriod.month, activePeriod.year]);

  const dashboardFlow = dashboardOrigin
    && (filter === 'income' || filter === 'expense')
    ? filter
    : null;
  const catalog = useMemo(() => buildTransactionsCatalog({
    transactions: data?.transactions ?? [],
    accounts: data?.accounts ?? [],
    cards: data?.cards ?? [],
    now: data?.financialAsOfDate ?? '1970-01-01',
  }), [data]);
  const model = useMemo(() => selectTransactionsReadModel({
    allItems: catalog,
    filter,
    query: deferredQuery,
    dashboardFlow,
  }), [catalog, dashboardFlow, deferredQuery, filter]);
  const selectionScopeKey = [
    accessContext?.environment ?? 'none',
    accessContext?.actingUserId ?? 'none',
    accessContext?.resourceOwnerId ?? 'none',
    accessContext?.generation ?? 'none',
    calendarMonthKey(activePeriod),
  ].join(':');
  const selectedItem = resolveTransactionSelection(model.allItems, selection, selectionScopeKey);

  const updateRouteContext = (
    nextPeriod: CalendarMonth,
    nextFilter: TransactionFilter,
    origin?: DashboardTransactionsOrigin,
  ) => {
    const [year, month] = calendarMonthKey(nextPeriod).split('-');
    router.setParams({ year, month, flow: nextFilter, origin: origin ?? '' });
  };

  const changePeriod = (nextPeriod: CalendarMonth) => {
    setPeriod(nextPeriod);
    updateRouteContext(nextPeriod, filter, dashboardOrigin ? 'dashboard' : undefined);
  };

  const changeFilter = (nextFilter: TransactionFilter) => {
    if (nextFilter === filter) return;
    setFilter(nextFilter);
    setDashboardOrigin(false);
    updateRouteContext(activePeriod, nextFilter);
  };

  if (loading && !data) {
    return (
      <Screen scroll={false}>
        <StateView loading title="Carregando lançamentos" message={`Atualizando ${calendarMonthLabel(activePeriod)}.`} />
      </Screen>
    );
  }
  if (error && !data) {
    return (
      <Screen scroll={false}>
        <StateView
          tone="error"
          title="Não foi possível carregar"
          message={error}
          action={<AppButton label="Tentar novamente" onPress={refresh} />}
        />
      </Screen>
    );
  }
  if (!data) return null;

  const empty = emptyCopy(activePeriod, filter, deferredQuery, dashboardFlow);
  const countLabel = `${model.visibleItems.length} ${model.visibleItems.length === 1 ? 'lançamento' : 'lançamentos'}`;
  const contextLabel = dashboardOrigin
    ? dashboardFlow
      ? `Composição realizada da Principal · ${dashboardFlow === 'income' ? 'Receitas' : 'Despesas'}`
      : 'Período herdado da Principal'
    : '';

  const header = (
    <View style={styles.header}>
      <PageHeader title="Lançamentos" description="Resumo, composição e origem do período." />
      <MonthSelector
        period={activePeriod}
        onChange={changePeriod}
        expanded={monthSelectorExpanded}
        onExpandedChange={setMonthSelectorExpanded}
      />
      <TransactionsSummary
        cashFlow={data.metrics.monthlyCashFlow}
        income={data.metrics.realizedIncome}
        expense={data.metrics.realizedExpense}
      />
      <SearchField
        label="Buscar lançamentos"
        value={query}
        onChangeText={setQuery}
        placeholder="Nome, categoria ou origem"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <View accessibilityRole="toolbar" accessibilityLabel="Filtros de lançamentos" style={styles.filters}>
        {filters.map((item) => (
          <FilterChip
            key={item.key}
            label={item.label}
            selected={item.key === filter}
            onPress={() => changeFilter(item.key)}
          />
        ))}
      </View>
      <View style={styles.listContext}>
        <Text accessibilityLiveRegion="polite" style={styles.count}>{countLabel}</Text>
        {contextLabel ? <Text style={styles.context}>{contextLabel}</Text> : null}
      </View>
    </View>
  );

  return (
    <Screen scroll={false}>
      <SectionList<TransactionListItem, TransactionDateSection>
        style={styles.list}
        sections={model.sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => <TransactionDateHeader title={section.title} />}
        renderItem={({ item, index, section }) => (
          <TransactionListRow
            item={item}
            first={index === 0}
            last={index === section.data.length - 1}
            onPress={() => setSelection(createTransactionSelection(item.id, selectionScopeKey))}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={<StateView title={empty.title} message={empty.message} />}
        ListFooterComponent={model.visibleItems.length ? <Text style={styles.updated}>Atualizado às {new Date(data.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}.</Text> : null}
        contentContainerStyle={[styles.listContent, !model.visibleItems.length && styles.listContentEmpty]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.action.text} />}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
      />
      <TransactionDetailSheet item={selectedItem} onClose={() => setSelection(null)} />
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    header: { gap: spacing.md, paddingBottom: spacing.xs },
    list: { flex: 1 },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    listContext: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.xs },
    count: { ...textStyles.caption, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiSemiBold },
    context: { ...textStyles.caption, color: tokens.action.text },
    listContent: { paddingBottom: spacing.xxl },
    listContentEmpty: { flexGrow: 1 },
    updated: { ...textStyles.caption, alignSelf: 'center', color: tokens.text.secondary, paddingVertical: spacing.xl, textAlign: 'center' },
  });
}
