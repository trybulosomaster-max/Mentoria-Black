import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import {
  Card,
  MetricCard,
  PageHeader,
  Pill,
  Screen,
  SectionTitle,
  StateView,
  commonStyles,
} from '../../src/design-system/components';
import { colors, spacing, typography } from '../../src/design-system/tokens';
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
  const { user } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(user?.id);
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
                  <View accessibilityLabel={`${label}: ${Math.round(percentage)}% da receita`} style={styles.track}>
                    <View style={[styles.fill, { width: `${percentage}%` }]} />
                  </View>
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
  emptyTitle: { color: colors.text, fontSize: typography.section, fontWeight: '800' },
  emptyText: { color: colors.textMuted, fontSize: typography.bodySmall, lineHeight: 20 },
  allocationCard: { gap: 0 },
  category: { gap: spacing.xs, paddingVertical: spacing.md },
  categoryBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  categoryTitle: { color: colors.text, fontSize: typography.body, fontWeight: '700' },
  categoryValue: { color: colors.goldBright, fontSize: typography.bodySmall, fontWeight: '800' },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.surfacePressed, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.gold, borderRadius: 999 },
  percentage: { color: colors.textSubtle, fontSize: typography.caption },
});
