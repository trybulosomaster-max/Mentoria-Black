import { useMemo } from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { AppButton, Card, InlineNotice, PageHeader, Screen, SectionTitle, StateView } from '../../src/design-system/components';
import { FinancialMetric, MetricGroup, TransactionRow } from '../../src/design-system/financial-components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { signedAmount, transactionStatus, transactionTypeLabel } from '../../src/features/transactions/transaction-presentation';
import { formatDate, formatMoney } from '../../src/lib/format';

export default function DashboardScreen() {
  const { accessContext, user } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext);
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const firstName = String(user?.user_metadata?.full_name ?? user?.email ?? 'você').split(/[\s@]/)[0];

  if (loading && !data) return <Screen scroll={false}><StateView loading title="Preparando seu panorama" message="Atualizando suas informações." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView tone="error" title="Não foi possível carregar" message={error} action={<AppButton label="Tentar novamente" onPress={refresh} />} /></Screen>;
  if (!data) return null;

  const latest = data.transactions.slice(0, 4);
  const commitments = data.transactions.filter((transaction) => transactionStatus(transaction).label === 'Programado').slice(0, 3);
  const isFinanciallyEmpty = data.transactions.length === 0 && data.accounts.length === 0 && data.goals.length === 0;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.action.primary} />}>
      <PageHeader eyebrow={data.period.label} title={`Olá, ${firstName}`} description="Seu mês em um olhar." />

      {isFinanciallyEmpty ? (
        <Card style={styles.heroEmpty}>
          <Text style={styles.eyebrow}>PANORAMA DO MÊS</Text>
          <Text accessibilityRole="header" style={styles.emptyTitle}>Seu panorama começa aqui.</Text>
          <Text style={styles.emptyText}>Nenhum movimento financeiro neste período.</Text>
        </Card>
      ) : (
        <FinancialMetric label="Resultado realizado do mês" value={formatMoney(data.metrics.monthlyCashFlow)} helper="Receitas menos despesas e investimentos já realizados" tone={data.metrics.monthlyCashFlow < 0 ? 'risk' : 'neutral'} emphasized />
      )}

      <MetricGroup>
        <FinancialMetric label="Receitas" value={formatMoney(data.metrics.realizedIncome)} helper="Realizado" tone="positive" />
        <FinancialMetric label="Despesas" value={formatMoney(data.metrics.realizedExpense)} helper="Realizado" tone="risk" />
        <FinancialMetric label="Investido" value={formatMoney(data.metrics.realizedInvestment)} helper="Realizado" />
      </MetricGroup>

      {data.metrics.unclassifiedTransactions > 0 ? <InlineNotice title="Há pendências para revisar" message={`${data.metrics.unclassifiedTransactions} ${data.metrics.unclassifiedTransactions === 1 ? 'lançamento precisa' : 'lançamentos precisam'} de classificação na versão oficial.`} tone="warning" /> : null}

      <SectionTitle title="Próximos compromissos" />
      {commitments.length ? commitments.map((transaction) => {
        const status = transactionStatus(transaction);
        return <TransactionRow key={transaction.id} title={transaction.description} meta={`${transactionTypeLabel(transaction.transaction_type)} • ${formatDate(transaction.transaction_date)}`} amount={formatMoney(signedAmount(transaction))} status={status.label} tone={status.tone} category={transaction.category || 'Sem categoria'} />;
      }) : <Card><Text style={styles.emptyList}>Nenhum compromisso neste período.</Text></Card>}

      <SectionTitle title="Movimentos recentes" />
      {latest.length ? latest.map((transaction) => {
        const status = transactionStatus(transaction);
        return <TransactionRow key={transaction.id} title={transaction.description} meta={`${transactionTypeLabel(transaction.transaction_type)} • ${formatDate(transaction.transaction_date)}`} amount={formatMoney(signedAmount(transaction))} status={status.label} tone={status.tone} category={transaction.category || 'Sem categoria'} />;
      }) : <Card><Text style={styles.emptyList}>Nenhum lançamento neste mês.</Text></Card>}

      {!isFinanciallyEmpty ? <Card tone="raised" style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Visão geral</Text>
        <Text style={styles.summaryText}>{data.metrics.accountsWithSnapshot} de {data.metrics.accountsTotal} contas atualizadas. Metas somam {formatMoney(data.metrics.goalsSaved)} de {formatMoney(data.metrics.goalsTarget)}.</Text>
        <Text style={styles.updated}>Atualizado às {new Date(data.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</Text>
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
