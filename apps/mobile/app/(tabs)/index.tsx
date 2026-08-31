import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { appEnvironment } from '../../src/core/config/env';
import type { TransactionRow } from '../../src/core/supabase/database.types';
import {
  AppButton,
  Card,
  Divider,
  InlineNotice,
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
import { signedAmount, transactionStatus } from '../../src/features/transactions/transaction-presentation';
import { formatDate, formatMoney } from '../../src/lib/format';

function TransactionRowView({ transaction }: { transaction: TransactionRow }) {
  const status = transactionStatus(transaction);
  const amount = signedAmount(transaction);
  return (
    <View style={styles.listRow}>
      <View style={styles.listCopy}>
        <Text numberOfLines={1} style={styles.listTitle}>{transaction.description}</Text>
        <Text style={styles.listMeta}>{formatDate(transaction.transaction_date)} • {transaction.category || 'Sem categoria'}</Text>
      </View>
      <View style={styles.listEnd}>
        <Text style={[styles.amount, amount < 0 ? commonStyles.negative : commonStyles.positive]}>{formatMoney(amount)}</Text>
        <Pill label={status.label} tone={status.tone} />
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const { accessContext, user } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext);
  const firstName = String(user?.user_metadata?.full_name ?? user?.email ?? 'você').split(/[\s@]/)[0];

  if (loading && !data) {
    return <Screen scroll={false}><StateView loading title="Montando seu panorama" message="Carregando seus dados sob as regras de acesso da conta." /></Screen>;
  }
  if (error && !data) {
    return <Screen scroll={false}><StateView tone="error" title="Não foi possível carregar" message={error} action={<AppButton label="Tentar novamente" onPress={refresh} />} /></Screen>;
  }
  if (!data) return null;

  const latest = data.transactions.slice(0, 5);
  const goalsCoverage = data.metrics.goalsTarget > 0
    ? Math.min(100, (data.metrics.goalsSaved / data.metrics.goalsTarget) * 100)
    : 0;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.gold} />}>
      <PageHeader
        eyebrow={data.period.label}
        title={`Olá, ${firstName}`}
        description="Este é o retrato financeiro do período, sem misturar realizado e programado."
      />

      {appEnvironment.readOnly ? (
        <InlineNotice
          title="Fundação financeira em leitura"
          message="Nesta versão, o aplicativo consulta seus dados, mas não cria, altera ou exclui operações financeiras."
          tone="info"
        />
      ) : null}

      <View style={commonStyles.wrap}>
        <MetricCard label="Receitas realizadas" value={formatMoney(data.metrics.realizedIncome)} helper="Somente efetivado no mês" />
        <MetricCard label="Despesas realizadas" value={formatMoney(data.metrics.realizedExpense)} helper="Consumo efetivado no mês" />
        <MetricCard label="Investimentos" value={formatMoney(data.metrics.realizedInvestment)} helper="Aportes efetivados" />
        <MetricCard label="Fluxo disponível" value={formatMoney(data.metrics.monthlyCashFlow)} helper="Variação canônica do disponível" />
      </View>

      {data.metrics.unclassifiedTransactions > 0 ? (
        <InlineNotice
          title="Movimentos não incluídos nos totais"
          message={`${data.metrics.unclassifiedTransactions} lançamentos possuem status, tipo, valor ou vínculo insuficiente para cálculo canônico. Eles continuam visíveis em Lançamentos.`}
          tone="warning"
        />
      ) : null}

      {data.metrics.accountsTotal > 0 && data.metrics.accountsWithSnapshot < data.metrics.accountsTotal ? (
        <InlineNotice
          title="Cobertura parcial de saldos"
          message={`${data.metrics.accountsWithSnapshot} de ${data.metrics.accountsTotal} contas possuem saldo conciliado informado. O app não inventa os valores ausentes.`}
          tone="warning"
        />
      ) : null}

      <View style={commonStyles.wrap}>
        <MetricCard label="Saldos informados" value={formatMoney(data.metrics.knownAccountBalance)} helper="Somente contas com snapshot" />
        <MetricCard label="Limites configurados" value={formatMoney(data.metrics.configuredCardLimit)} helper="Não representa limite disponível" />
      </View>

      <SectionTitle title="Movimentos recentes" />
      <Card style={styles.listCard}>
        {latest.length ? latest.map((transaction, index) => (
          <View key={transaction.id}>
            <TransactionRowView transaction={transaction} />
            {index < latest.length - 1 ? <Divider /> : null}
          </View>
        )) : (
          <Text style={styles.empty}>Nenhum lançamento encontrado neste mês.</Text>
        )}
      </Card>

      <SectionTitle title="Metas" />
      <Card style={styles.goalCard}>
        <View style={commonStyles.between}>
          <View style={styles.listCopy}>
            <Text style={styles.goalTitle}>Progresso acumulado</Text>
            <Text style={styles.listMeta}>{data.goals.length} metas cadastradas</Text>
          </View>
          <Text style={styles.goalValue}>{formatMoney(data.metrics.goalsSaved)}</Text>
        </View>
        <ProgressBar value={goalsCoverage} label="Cobertura das metas" />
        <Text style={styles.listMeta}>Objetivo total: {formatMoney(data.metrics.goalsTarget)}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listCard: { paddingVertical: spacing.xs },
  listRow: { minHeight: spacing.huge + spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.sm },
  listCopy: { flex: 1, minWidth: spacing.none, gap: spacing.xxs },
  listTitle: { ...textStyles.body, color: semantic.text.primary, fontFamily: primitives.typography.family.uiBold },
  listMeta: { ...textStyles.caption, color: semantic.text.secondary },
  listEnd: { alignItems: 'flex-end', gap: spacing.xs },
  amount: textStyles.moneyM,
  empty: { ...textStyles.bodySmall, color: semantic.text.secondary, textAlign: 'center', padding: spacing.xl },
  goalCard: { gap: spacing.md },
  goalTitle: { ...textStyles.body, color: semantic.text.primary, fontFamily: primitives.typography.family.uiExtraBold },
  goalValue: { ...textStyles.moneyL, color: semantic.text.accent },
});
