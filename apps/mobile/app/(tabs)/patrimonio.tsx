import { useMemo } from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { Card, PageHeader, ProgressBar, Screen, SectionTitle, StateView } from '../../src/design-system/components';
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
  if (loading && !data) return <Screen scroll={false}><StateView loading title="Carregando patrimônio" message="Atualizando suas posições." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView tone="error" title="Falha ao carregar" message={error} /></Screen>;
  if (!data) return null;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.action.text} />}>
      <PageHeader eyebrow={data.period.label} title="Patrimônio" description="Contas, cartões e metas em uma visão clara." />
      <Text style={styles.contextNote}><Text style={styles.contextNoteStrong}>Visão atual. </Text>Apenas saldos confirmados entram no total; limites de cartão aparecem separadamente.</Text>

      <MetricGroup>
        <FinancialMetric label="Saldo atual" value={formatMoney(data.metrics.knownAccountBalance)} helper={`${data.metrics.accountsWithSnapshot} de ${data.metrics.accountsTotal} contas atualizadas`} emphasized />
        <FinancialMetric label="Metas" value={formatMoney(data.metrics.goalsSaved)} helper={`Objetivo: ${formatMoney(data.metrics.goalsTarget)}`} />
      </MetricGroup>

      <SectionTitle title={`Contas (${data.accounts.length})`} />
      {data.accounts.length ? data.accounts.map((account) => <AssetRow key={account.id} icon="wallet" title={account.name} subtitle={account.institution || account.account_type || 'Conta'} value={account.statement_balance === null ? 'Não informado' : formatMoney(account.statement_balance)} status={account.balance_as_of ? `Atualizado em ${formatDate(account.balance_as_of)}` : 'Sem atualização recente'} statusTone={account.statement_balance === null ? 'warning' : 'gold'} />) : <EmptyBlock title="Nenhuma conta disponível." message="Suas contas aparecerão aqui quando estiverem disponíveis." styles={styles} />}

      <SectionTitle title={`Cartões cadastrados (${data.cards.length})`} />
      {data.cards.length ? data.cards.map((card) => <AssetRow key={card.id} icon="card" title={card.name} subtitle={[card.institution, card.brand].filter(Boolean).join(' • ') || 'Cartão'} value={formatMoney(card.limit)} status={`Limite configurado • fecha dia ${card.closing_day ?? '—'} • vence dia ${card.due_day ?? '—'}`} statusTone="neutral" />) : <EmptyBlock title="Nenhum cartão disponível." message="Seus cartões aparecerão aqui quando estiverem disponíveis." styles={styles} />}

      <SectionTitle title={`Metas (${data.goals.length})`} />
      {data.goals.length ? data.goals.map((goal) => {
        const progress = goal.target > 0 ? Math.max(0, Math.min(100, (goal.current / goal.target) * 100)) : 0;
        return <Card key={goal.id} accessibilityLabel={`${goal.name}. ${formatMoney(goal.current)} de ${formatMoney(goal.target)}. ${progress.toFixed(0)} por cento.`} style={styles.goalCard}><Text style={styles.goalTitle}>{goal.name}</Text><Text style={styles.goalMeta}>{goal.deadline ? `Prazo: ${formatDate(goal.deadline)}` : 'Sem prazo definido'}</Text><ProgressBar value={progress} label={`Progresso da meta ${goal.name}`} showValue /><Text style={styles.goalMeta}>{formatMoney(goal.current)} de {formatMoney(goal.target)}</Text></Card>;
      }) : <EmptyBlock title="Nenhuma meta disponível." message="Suas metas aparecerão aqui quando estiverem disponíveis." styles={styles} />}
    </Screen>
  );
}

function EmptyBlock({ title, message, styles }: { title: string; message: string; styles: ReturnType<typeof createStyles> }) {
  return <Card><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{message}</Text></Card>;
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    contextNote: { ...textStyles.bodySmall, color: tokens.text.secondary, paddingHorizontal: spacing.xs }, contextNoteStrong: { color: tokens.text.primary, fontFamily: primitives.typography.family.uiSemiBold },
    goalCard: { gap: spacing.sm }, goalTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiSemiBold }, goalMeta: { ...textStyles.caption, color: tokens.text.secondary },
    emptyTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiSemiBold, textAlign: 'center' }, emptyText: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center', marginTop: spacing.xs },
  });
}
