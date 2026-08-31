import { useMemo } from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { Card, InlineNotice, PageHeader, ProgressBar, Screen, SectionTitle, StateView } from '../../src/design-system/components';
import { AssetRow, FinancialMetric, MetricGroup } from '../../src/design-system/financial-components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { formatDate, formatMoney } from '../../src/lib/format';

export default function NetWorthScreen() {
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext);
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (loading && !data) return <Screen scroll={false}><StateView loading title="Carregando patrimônio" message="Consultando contas, cartões e metas sob as regras de acesso." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView tone="error" title="Falha ao carregar" message={error} /></Screen>;
  if (!data) return null;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.brand.accent} />}>
      <PageHeader title="Patrimônio" description="Posições conhecidas e estruturas cadastradas, sem estimativas silenciosas." />
      <InlineNotice title="Leitura conservadora" message="O total conhecido considera somente snapshots de contas. Limite de cartão não é patrimônio, saldo disponível ou passivo." tone="info" />

      <MetricGroup>
        <FinancialMetric label="Saldo conhecido" value={formatMoney(data.metrics.knownAccountBalance)} helper={`${data.metrics.accountsWithSnapshot} de ${data.metrics.accountsTotal} contas com snapshot`} emphasized />
        <FinancialMetric label="Metas acumuladas" value={formatMoney(data.metrics.goalsSaved)} helper={`Objetivo registrado: ${formatMoney(data.metrics.goalsTarget)}`} />
      </MetricGroup>

      <SectionTitle title={`Contas (${data.accounts.length})`} />
      {data.accounts.length ? data.accounts.map((account) => <AssetRow key={account.id} icon="wallet" title={account.name} subtitle={account.institution || account.account_type || 'Conta'} value={account.statement_balance === null ? 'Não informado' : formatMoney(account.statement_balance)} status={account.balance_as_of ? `Snapshot em ${formatDate(account.balance_as_of)}` : 'Sem snapshot datado'} statusTone={account.statement_balance === null ? 'warning' : 'positive'} />) : <EmptyBlock title="Nenhuma conta retornada" message="Não há snapshots de contas para compor esta leitura." styles={styles} />}

      <SectionTitle title={`Cartões cadastrados (${data.cards.length})`} />
      {data.cards.length ? data.cards.map((card) => <AssetRow key={card.id} icon="card" title={card.name} subtitle={[card.institution, card.brand].filter(Boolean).join(' • ') || 'Cartão'} value={formatMoney(card.limit)} status={`Limite configurado • fecha dia ${card.closing_day ?? '—'} • vence dia ${card.due_day ?? '—'}`} statusTone="neutral" />) : <EmptyBlock title="Nenhum cartão retornado" message="Nenhuma estrutura de cartão foi encontrada para esta conta." styles={styles} />}

      <SectionTitle title={`Metas (${data.goals.length})`} />
      {data.goals.length ? data.goals.map((goal) => {
        const progress = goal.target > 0 ? Math.max(0, Math.min(100, (goal.current / goal.target) * 100)) : 0;
        return <Card key={goal.id} accessibilityLabel={`${goal.name}. ${formatMoney(goal.current)} de ${formatMoney(goal.target)}. ${progress.toFixed(0)} por cento.`} style={styles.goalCard}><Text style={styles.goalTitle}>{goal.name}</Text><Text style={styles.goalMeta}>{goal.deadline ? `Prazo: ${formatDate(goal.deadline)}` : 'Sem prazo definido'}</Text><ProgressBar value={progress} label={`Progresso da meta ${goal.name}`} showValue /><Text style={styles.goalMeta}>{formatMoney(goal.current)} de {formatMoney(goal.target)}</Text></Card>;
      }) : <EmptyBlock title="Nenhuma meta retornada" message="Não há metas reais para apresentar nesta leitura." styles={styles} />}

      <Card tone="raised" style={styles.gapCard}><Text style={styles.gapTitle}>Cobertura do read model</Text><Text style={styles.gapText}>Ativos, passivos e patrimônio líquido consolidado ainda não são fornecidos pelo contrato Mobile. O aplicativo não deduz nem preenche essas posições.</Text></Card>
    </Screen>
  );
}

function EmptyBlock({ title, message, styles }: { title: string; message: string; styles: ReturnType<typeof createStyles> }) {
  return <Card><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{message}</Text></Card>;
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    goalCard: { gap: spacing.sm }, goalTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold }, goalMeta: { ...textStyles.caption, color: tokens.text.secondary },
    emptyTitle: { ...textStyles.section, color: tokens.text.primary, textAlign: 'center' }, emptyText: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center', marginTop: spacing.xs },
    gapCard: { gap: spacing.xs }, gapTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold }, gapText: { ...textStyles.bodySmall, color: tokens.text.secondary },
  });
}
