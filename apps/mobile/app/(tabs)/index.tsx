import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useFinancialPeriod } from '../../src/application/period/financial-period-provider';
import { useAuth } from '../../src/core/auth/AuthProvider';
import { AppButton, InlineNotice, Screen, StateView } from '../../src/design-system/components';
import { useResponsiveLayout } from '../../src/design-system/responsive';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';
import { DashboardActivity } from '../../src/features/dashboard/dashboard-activity';
import { dashboardTransactionsHref, type DashboardShortcutFlow } from '../../src/features/dashboard/dashboard-contract';
import { DashboardHero } from '../../src/features/dashboard/dashboard-hero';
import { DashboardMonthlyMovements } from '../../src/features/dashboard/dashboard-monthly-movements';
import { MonthSelector } from '../../src/features/dashboard/month-selector';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { calendarMonthLabel, formatMoney } from '../../src/lib/format';

export default function DashboardScreen() {
  const router = useRouter();
  const { period, setPeriod } = useFinancialPeriod();
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext, period);
  const layout = useResponsiveLayout();
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

  const openAllTransactions = () => {
    router.push('/(tabs)/lancamentos');
  };

  if (loading && !data) {
    return <Screen>{periodSelector}<StateView loading title={`Preparando ${periodLabel}`} message="Atualizando seu panorama financeiro." /></Screen>;
  }
  if (error && !data) {
    return <Screen>{periodSelector}<StateView tone="error" title="Não foi possível carregar" message={error} action={<AppButton label="Tentar novamente" onPress={refresh} />} /></Screen>;
  }
  if (!data) return <Screen>{periodSelector}<StateView title="Panorama indisponível" message="Tente atualizar novamente." /></Screen>;

  const hasMonthlyMovements = data.transactions.length > 0;
  const hasKnownAccountBalance = data.metrics.accountsWithSnapshot > 0;
  const balanceHelper = hasKnownAccountBalance
    ? `${data.metrics.accountsWithSnapshot} de ${data.metrics.accountsTotal} ${data.metrics.accountsTotal === 1 ? 'conta possui' : 'contas possuem'} saldo informado`
    : 'Saldo de contas ainda não informado';
  const balanceLabel = data.metrics.accountBalanceIsCurrent
    ? 'Saldo atual em contas'
    : 'Saldo informado em contas';

  return (
    <Screen
      contentStyle={styles.screenContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={tokens.action.primary} />}
    >
      <View style={[styles.topPanel, { paddingHorizontal: layout.horizontalPadding }]}>
        <LinearGradient
          colors={[tokens.background.surface, tokens.background.surfaceMuted]}
          end={{ x: 0.85, y: 1 }}
          pointerEvents="none"
          start={{ x: 0.15, y: 0 }}
          style={styles.topPanelBackdrop}
        />
        <MonthSelector
          period={period}
          onChange={setPeriod}
          expanded={monthSelectorExpanded}
          onExpandedChange={setMonthSelectorExpanded}
          embedded
        />
        <DashboardHero
          balance={hasKnownAccountBalance ? formatMoney(data.metrics.knownAccountBalance) : null}
          balanceLabel={balanceLabel}
          balanceHelper={balanceHelper}
          income={hasMonthlyMovements ? formatMoney(data.metrics.realizedIncome) : null}
          expense={hasMonthlyMovements ? formatMoney(data.metrics.realizedExpense) : null}
          valuesVisible={valuesVisible}
          onToggleValues={() => setValuesVisible((current) => !current)}
          onIncomePress={() => openTransactions('income')}
          onExpensePress={() => openTransactions('expense')}
        />
      </View>

      <View style={[styles.body, { paddingHorizontal: layout.horizontalPadding }]}>
        {data.metrics.unclassifiedTransactions > 0 ? <InlineNotice title="Há pendências para revisar" message={`${data.metrics.unclassifiedTransactions} ${data.metrics.unclassifiedTransactions === 1 ? 'lançamento precisa' : 'lançamentos precisam'} de classificação na versão oficial.`} tone="warning" /> : null}

        <DashboardMonthlyMovements
          periodLabel={data.period.label}
          movements={data.dashboard.realizedDailyMovements}
          valuesVisible={valuesVisible}
        />
        <DashboardActivity
          scheduled={data.dashboard.scheduledTransactions}
          recent={data.dashboard.recentTransactions}
          valuesVisible={valuesVisible}
          onViewAll={openAllTransactions}
        />
        <Text style={styles.updated}>Atualizado às {new Date(data.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}.</Text>
      </View>
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    screenContent: { gap: primitives.space.none, paddingTop: primitives.space.none, paddingHorizontal: primitives.space.none },
    topPanel: { position: 'relative', overflow: 'hidden', gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.border.default, borderBottomLeftRadius: primitives.radius.xl, borderBottomRightRadius: primitives.radius.xl, backgroundColor: tokens.background.surface },
    topPanelBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    body: { gap: spacing.md, paddingTop: spacing.md },
    updated: { ...textStyles.caption, alignSelf: 'center', color: tokens.text.secondary, textAlign: 'center' },
  });
}
