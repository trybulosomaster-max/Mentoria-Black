import { useMemo } from 'react';
import { RefreshControl, StyleSheet, Text } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { Card, InlineNotice, PageHeader, Screen, SectionTitle, StateView, StatusPill } from '../../src/design-system/components';
import { FinancialMetric, MetricGroup, PlanningRow } from '../../src/design-system/financial-components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { formatMoney } from '../../src/lib/format';

const categories = [['Despesas fixas', 'fixed_expenses'], ['Metas', 'goals'], ['Lazer', 'leisure'], ['Conhecimento', 'knowledge'], ['Conforto', 'comfort'], ['Investimentos', 'investments']] as const;

export default function PlanningScreen() {
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext);
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  if (loading && !data) return <Screen scroll={false}><StateView loading title="Carregando planejamento" message="Consultando o plano mensal sob as regras de acesso da conta." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView tone="error" title="Falha ao carregar" message={error} /></Screen>;
  if (!data) return null;

  const plan = data.monthlyPlan;
  const allocation = plan ? categories.reduce((total, [, key]) => total + Number(plan[key]), 0) : 0;
  const remaining = Number(plan?.revenue ?? 0) - allocation;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.brand.accent} />}>
      <PageHeader eyebrow={data.period.label} title="Planejamento" description="Distribuição aprovada para o mês, apresentada sem converter intenção em fato realizado." />
      {!plan ? (
        <Card tone="raised" style={styles.emptyCard}>
          <StatusPill label="Sem plano mensal" tone="warning" />
          <Text style={styles.emptyTitle}>Nenhum planejamento foi retornado.</Text>
          <Text style={styles.emptyText}>O estado é informativo. A criação e a edição permanecem indisponíveis nesta onda read-only.</Text>
        </Card>
      ) : (
        <>
          <MetricGroup>
            <FinancialMetric label="Receita planejada" value={formatMoney(plan.revenue)} helper="Intenção do mês" emphasized />
            <FinancialMetric label="Total distribuído" value={formatMoney(allocation)} helper="Soma das categorias planejadas" />
            <FinancialMetric label="A distribuir" value={formatMoney(remaining)} helper={remaining < 0 ? 'Plano acima da receita' : 'Margem ainda não distribuída'} tone={remaining < 0 ? 'risk' : 'neutral'} />
          </MetricGroup>
          <InlineNotice title="Sem mistura de estados" message="O contrato Mobile atual fornece o plano mensal, mas ainda não entrega consumo por categoria, projetado ou previsão. Esses valores não foram calculados na interface." tone="info" />
          <SectionTitle title="Distribuição planejada" />
          <Card style={styles.allocationCard}>{categories.map(([label, key]) => {
            const value = Number(plan[key]);
            const percentage = plan.revenue > 0 ? Math.max(0, Math.min(100, (value / plan.revenue) * 100)) : 0;
            return <PlanningRow key={key} label={label} value={formatMoney(value)} percentage={percentage} />;
          })}</Card>
          <Card tone="raised" style={styles.legendCard}>
            <Text style={styles.legendTitle}>Semântica preservada</Text>
            <Text style={styles.legendText}>Planejado descreve intenção. Realizado, Programado, Projetado e Previsão continuarão separados quando seus read models canônicos estiverem disponíveis.</Text>
          </Card>
        </>
      )}
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    emptyCard: { alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xl },
    emptyTitle: { ...textStyles.section, color: tokens.text.primary },
    emptyText: { ...textStyles.bodySmall, color: tokens.text.secondary },
    allocationCard: { gap: spacing.none },
    legendCard: { gap: spacing.xs },
    legendTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold },
    legendText: { ...textStyles.bodySmall, color: tokens.text.secondary },
  });
}
