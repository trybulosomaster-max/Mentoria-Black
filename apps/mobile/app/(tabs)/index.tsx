import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';

import { useFinancialPeriod } from '../../src/application/period/financial-period-provider';
import { useAuth } from '../../src/core/auth/AuthProvider';
import { AppButton, Card, InlineNotice, Screen, SectionTitle, StateView } from '../../src/design-system/components';
import { TransactionRow } from '../../src/design-system/financial-components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';
import { dashboardTransactionsHref, financialValuePresentation, type DashboardShortcutFlow } from '../../src/features/dashboard/dashboard-contract';
import { DashboardHero } from '../../src/features/dashboard/dashboard-hero';
import { MonthSelector } from '../../src/features/dashboard/month-selector';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { signedAmount, transactionStatus, transactionTypeLabel } from '../../src/features/transactions/transaction-presentation';
import { calendarMonthLabel, formatDate, formatMoney } from '../../src/lib/format';

export default function DashboardScreen() {
  const router = useRouter();
  const { period, setPeriod } = useFinancialPeriod();
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext, period);
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [valuesVisible, setValuesVisible] = useState(true);
  const [monthSelectorExpanded, setMonthSelectorExpanded] = useState(false);
  const periodLabel = calendarMonthLabel(period);
  const periodSelector = (
    <MonthSelector
      period={period}
      onChange={setPeriod}
      expanded={monthSelectorExpanded}
      onExpandedChange={setMonthSelectorExpanded}
    />
  );

  const openTransactions = (flow: DashboardShortcutFlow) => {
    router.push(dashboardTransactionsHref(period, flow));
  };

  if (loading && !data) {
    return <Screen>{periodSelector}<StateView loading title={`Preparando ${periodLabel}`} message="Atualizando seu panorama financeiro." /></Screen>;
  }
  if (error && !data) {
    return <Screen>{periodSelector}<StateView tone="error" title="Não foi possível carregar" message={error} action={<AppButton label="Tentar novamente" onPress={refresh} />} /></Screen>;
  }
  if (!data) return <Screen>{periodSelector}<StateView title="Panorama indisponível" message="Tente atualizar novamente." /></Screen>;

  const latest = data.transactions.slice(0, 4);
  const commitments = data.transactions.filter((transaction) => transactionStatus(transaction).label === 'Programado').slice(0, 3);
  const hasMonthlyMovements = data.transactions.length > 0;
  const hasKnownAccountBalance = data.metrics.accountsWithSnapshot > 0;
  const isFinanciallyEmpty = !hasMonthlyMovements && !hasKnownAccountBalance;
  const presentedMoney = (value: number) => financialValuePresentation(formatMoney(value), valuesVisible).text;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.action.primary} />}>
      {periodSelector}

      <DashboardHero
        balance={hasKnownAccountBalance ? formatMoney(data.metrics.knownAccountBalance) : null}
        income={hasMonthlyMovements ? formatMoney(data.metrics.realizedIncome) : null}
        expense={hasMonthlyMovements ? formatMoney(data.metrics.realizedExpense) : null}
        valuesVisible={valuesVisible}
        onToggleValues={() => setValuesVisible((current) => !current)}
        onIncomePress={() => openTransactions('income')}
        onExpensePress={() => openTransactions('expense')}
      />

      {!hasMonthlyMovements ? (
        <Card style={styles.heroEmpty}>
          <Text style={styles.eyebrow}>MOVIMENTOS DO MÊS</Text>
          <Text accessibilityRole="header" style={styles.emptyTitle}>{isFinanciallyEmpty ? 'Seu panorama começa aqui.' : 'Nenhum lançamento neste período.'}</Text>
          <Text style={styles.emptyText}>Quando houver dados oficiais, eles aparecerão aqui sem estimativas artificiais.</Text>
        </Card>
      ) : null}

      {data.metrics.unclassifiedTransactions > 0 ? <InlineNotice title="Há pendências para revisar" message={`${data.metrics.unclassifiedTransactions} ${data.metrics.unclassifiedTransactions === 1 ? 'lançamento precisa' : 'lançamentos precisam'} de classificação na versão oficial.`} tone="warning" /> : null}

      <SectionTitle title="Compromissos do período" />
      {commitments.length ? commitments.map((transaction) => {
        const status = transactionStatus(transaction);
        return <TransactionRow key={transaction.id} title={transaction.description} meta={`${transactionTypeLabel(transaction.transaction_type)} • ${formatDate(transaction.transaction_date)}`} amount={presentedMoney(signedAmount(transaction))} status={status.label} tone={status.tone} category={transaction.category || 'Sem categoria'} />;
      }) : <Card><Text style={styles.emptyList}>Nenhum compromisso neste período.</Text></Card>}

      <SectionTitle title="Movimentos recentes" />
      {latest.length ? latest.map((transaction) => {
        const status = transactionStatus(transaction);
        return <TransactionRow key={transaction.id} title={transaction.description} meta={`${transactionTypeLabel(transaction.transaction_type)} • ${formatDate(transaction.transaction_date)}`} amount={presentedMoney(signedAmount(transaction))} status={status.label} tone={status.tone} category={transaction.category || 'Sem categoria'} />;
      }) : <Card><Text style={styles.emptyList}>Nenhum lançamento neste mês.</Text></Card>}

      {!isFinanciallyEmpty ? <Card tone="raised" style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Cobertura do panorama</Text>
        <Text style={styles.summaryText}>{data.metrics.accountsWithSnapshot} de {data.metrics.accountsTotal} contas possuem saldo informado.</Text>
        <Text style={styles.updated}>Atualizado às {new Date(data.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}.</Text>
      </Card> : null}
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    heroEmpty: { gap: spacing.xs, paddingVertical: spacing.lg },
    eyebrow: { ...textStyles.caption, color: tokens.action.text, letterSpacing: primitives.typography.letterSpacing.eyebrow },
    emptyTitle: { ...textStyles.section, color: tokens.text.primary },
    emptyText: { ...textStyles.bodySmall, color: tokens.text.secondary },
    emptyList: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center', paddingVertical: spacing.sm },
    summaryCard: { gap: spacing.sm },
    summaryTitle: { ...textStyles.section, color: tokens.text.primary },
    summaryText: { ...textStyles.body, color: tokens.text.secondary },
    updated: { ...textStyles.caption, color: tokens.text.secondary },
  });
}
