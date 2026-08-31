import { useMemo } from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { Card, InlineNotice, PageHeader, Screen, SectionTitle, StateView, StatusPill } from '../../src/design-system/components';
import { FinancialMetric, MetricGroup, PlanningRow } from '../../src/design-system/financial-components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { formatMoney } from '../../src/lib/format';

const categories = [['Despesas fixas', 'fixed_expenses'], ['Metas', 'goals'], ['Lazer', 'leisure'], ['Conhecimento', 'knowledge'], ['Conforto', 'comfort'], ['Investimentos', 'investments']] as const;

export default function PlanningScreen() {
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext);
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (loading && !data) return <Screen scroll={false}><StateView loading title="Carregando planejamento" message="Atualizando seu plano mensal." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView tone="error" title="Falha ao carregar" message={error} /></Screen>;
  if (!data) return null;

  const plan = data.monthlyPlan;
  const allocation = plan ? categories.reduce((total, [, key]) => total + Number(plan[key]), 0) : 0;
  const remaining = Number(plan?.revenue ?? 0) - allocation;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.action.primary} />}>
      <PageHeader eyebrow={data.period.label} title="Planejamento" description="Sua distribuição mensal em um só lugar." />
      {!plan ? (
        <Card tone="raised" style={styles.emptyCard}>
          <StatusPill label="Sem planejamento" tone="warning" />
          <Text style={styles.emptyTitle}>Você ainda não possui planejamento para este mês.</Text>
          <Text style={styles.emptyText}>Quando houver um plano, ele aparecerá aqui.</Text>
        </Card>
      ) : (
        <>
          <MetricGroup>
            <FinancialMetric label="Receita planejada" value={formatMoney(plan.revenue)} helper="Intenção do mês" emphasized />
            <FinancialMetric label="Total distribuído" value={formatMoney(allocation)} helper="Soma das categorias planejadas" />
            <FinancialMetric label="A distribuir" value={formatMoney(remaining)} helper={remaining < 0 ? 'Plano acima da receita' : 'Margem ainda não distribuída'} tone={remaining < 0 ? 'risk' : 'neutral'} />
          </MetricGroup>
          <InlineNotice title="Valores do mês" message="Planejado representa o que você definiu para o período." tone="info" />
          <SectionTitle title="Distribuição planejada" />
          <Card style={styles.allocationCard}>{categories.map(([label, key]) => {
            const value = Number(plan[key]);
            const percentage = plan.revenue > 0 ? Math.max(0, Math.min(100, (value / plan.revenue) * 100)) : 0;
            return <PlanningRow key={key} label={label} value={formatMoney(value)} percentage={percentage} />;
          })}</Card>
        </>
      )}
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    emptyCard: { alignItems: 'flex-start', gap: spacing.xs, paddingVertical: spacing.lg },
    emptyTitle: { ...textStyles.section, color: tokens.text.primary },
    emptyText: { ...textStyles.bodySmall, color: tokens.text.secondary },
    allocationCard: { gap: spacing.none },
  });
}
