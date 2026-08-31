import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import {
  Card,
  MetricCard,
  PageHeader,
  Pill,
  ProgressBar,
  Screen,
  SectionTitle,
  StateView,
  commonStyles,
} from '../../src/design-system/components';
import { colors, primitives, semantic, spacing, textStyles } from '../../src/design-system/tokens';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { formatMoney } from '../../src/lib/format';

const categories = [
  ['Despesas fixas', 'fixed_expenses'],
  ['Metas', 'goals'],
  ['Lazer', 'leisure'],
  ['Conhecimento', 'knowledge'],
  ['Conforto', 'comfort'],
  ['Investimentos', 'investments'],
] as const;

export default function PlanningScreen() {
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext);
  if (loading && !data) return <Screen scroll={false}><StateView loading title="Carregando planejamento" message="Consultando o plano mensal." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView title="Falha ao carregar" message={error} /></Screen>;
  if (!data) return null;

  const plan = data.monthlyPlan;
  const allocation = plan
    ? categories.reduce((total, [, key]) => total + Number(plan[key]), 0)
    : 0;
  const remaining = Number(plan?.revenue ?? 0) - allocation;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.gold} />}>
      <PageHeader
        eyebrow={data.period.label}
        title="Planejamento"
        description="Acompanhe a intenção do mês antes de transformar plano em realizado."
      />

      {!plan ? (
        <Card style={styles.emptyCard}>
          <Pill label="Sem plano mensal" tone="warning" />
          <Text style={styles.emptyTitle}>Nenhum planejamento foi encontrado para este período.</Text>
          <Text style={styles.emptyText}>A criação e edição continuarão na Web até o gate de escrita móvel.</Text>
        </Card>
      ) : (
        <>
          <View style={commonStyles.wrap}>
            <MetricCard label="Receita planejada" value={formatMoney(plan.revenue)} />
            <MetricCard label="Total distribuído" value={formatMoney(allocation)} />
            <MetricCard label="Ainda não distribuído" value={formatMoney(remaining)} helper={remaining < 0 ? 'Plano acima da receita' : 'Margem do planejamento'} />
          </View>

          <SectionTitle title="Distribuição do mês" />
          <Card style={styles.allocationCard}>
            {categories.map(([label, key], index) => {
              const value = Number(plan[key]);
              const percentage = plan.revenue > 0 ? Math.max(0, Math.min(100, (value / plan.revenue) * 100)) : 0;
              return (
                <View key={key} style={[styles.category, index > 0 && styles.categoryBorder]}>
                  <View style={commonStyles.between}>
                    <Text style={styles.categoryTitle}>{label}</Text>
                    <Text style={styles.categoryValue}>{formatMoney(value)}</Text>
                  </View>
                  <ProgressBar value={percentage} label={`${label} da receita planejada`} />
                  <Text style={styles.percentage}>{percentage.toFixed(1).replace('.', ',')}% da receita planejada</Text>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyCard: { alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { ...textStyles.section, color: semantic.text.primary },
  emptyText: { ...textStyles.bodySmall, color: semantic.text.secondary },
  allocationCard: { gap: spacing.none },
  category: { gap: spacing.xs, paddingVertical: spacing.md },
  categoryBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  categoryTitle: { ...textStyles.body, color: semantic.text.primary, fontFamily: primitives.typography.family.uiBold },
  categoryValue: { ...textStyles.moneyM, color: semantic.text.accent },
  percentage: { ...textStyles.caption, color: semantic.text.subtle },
});
