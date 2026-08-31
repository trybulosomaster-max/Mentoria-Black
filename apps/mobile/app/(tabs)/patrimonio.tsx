import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import {
  Card,
  InlineNotice,
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
import { formatDate, formatMoney } from '../../src/lib/format';

export default function NetWorthScreen() {
  const { accessContext } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(accessContext);
  if (loading && !data) return <Screen scroll={false}><StateView loading title="Carregando patrimônio" message="Consultando contas, cartões e metas." /></Screen>;
  if (error && !data) return <Screen scroll={false}><StateView title="Falha ao carregar" message={error} /></Screen>;
  if (!data) return null;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.gold} />}>
      <PageHeader
        title="Patrimônio"
        description="Valores informados e estruturas cadastradas, sem estimativas silenciosas."
      />

      <InlineNotice
        title="Leitura conservadora"
        message="O total de contas usa somente snapshots conciliados. Limite de cartão não é tratado como patrimônio nem como saldo disponível."
        tone="info"
      />

      <SectionTitle title={`Contas (${data.accounts.length})`} />
      {data.accounts.length ? data.accounts.map((account) => (
        <Card key={account.id} style={styles.itemCard}>
          <View style={commonStyles.between}>
            <View style={styles.copy}>
              <Text style={styles.title}>{account.name}</Text>
              <Text style={styles.meta}>{account.institution || account.account_type}</Text>
            </View>
            <Text style={styles.value}>{account.statement_balance === null ? 'Não informado' : formatMoney(account.statement_balance)}</Text>
          </View>
          <View style={commonStyles.wrap}>
            <Pill label={account.account_type || 'Conta'} />
            <Pill
              label={account.balance_as_of ? `Saldo em ${formatDate(account.balance_as_of)}` : 'Sem data de saldo'}
              tone={account.statement_balance === null ? 'warning' : 'positive'}
            />
          </View>
        </Card>
      )) : <Card><Text style={styles.empty}>Nenhuma conta cadastrada.</Text></Card>}

      <SectionTitle title={`Cartões (${data.cards.length})`} />
      {data.cards.length ? data.cards.map((card) => (
        <Card key={card.id} style={styles.itemCard}>
          <View style={commonStyles.between}>
            <View style={styles.copy}>
              <Text style={styles.title}>{card.name}</Text>
              <Text style={styles.meta}>{[card.institution, card.brand].filter(Boolean).join(' • ') || 'Cartão'}</Text>
            </View>
            <View style={styles.end}>
              <Text style={styles.caption}>Limite configurado</Text>
              <Text style={styles.value}>{formatMoney(card.limit)}</Text>
            </View>
          </View>
          <Text style={styles.meta}>Fechamento: dia {card.closing_day ?? '—'} • Vencimento: dia {card.due_day ?? '—'}</Text>
        </Card>
      )) : <Card><Text style={styles.empty}>Nenhum cartão cadastrado.</Text></Card>}

      <SectionTitle title={`Metas (${data.goals.length})`} />
      {data.goals.length ? data.goals.map((goal) => {
        const progress = goal.target > 0 ? Math.max(0, Math.min(100, (goal.current / goal.target) * 100)) : 0;
        return (
          <Card key={goal.id} style={styles.itemCard}>
            <View style={commonStyles.between}>
              <View style={styles.copy}>
                <Text style={styles.title}>{goal.name}</Text>
                <Text style={styles.meta}>{goal.deadline ? `Prazo: ${formatDate(goal.deadline)}` : 'Sem prazo definido'}</Text>
              </View>
              <Text style={styles.value}>{progress.toFixed(0)}%</Text>
            </View>
            <ProgressBar value={progress} label={`Progresso da meta ${goal.name}`} />
            <Text style={styles.meta}>{formatMoney(goal.current)} de {formatMoney(goal.target)}</Text>
          </Card>
        );
      }) : <Card><Text style={styles.empty}>Nenhuma meta cadastrada.</Text></Card>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  itemCard: { gap: spacing.sm },
  copy: { flex: 1, minWidth: spacing.none, gap: spacing.xxs },
  title: { ...textStyles.body, color: semantic.text.primary, fontFamily: primitives.typography.family.uiExtraBold },
  meta: { ...textStyles.caption, color: semantic.text.secondary },
  caption: { ...textStyles.caption, color: semantic.text.subtle, textAlign: 'right' },
  value: { ...textStyles.moneyM, color: semantic.text.accent, textAlign: 'right' },
  end: { alignItems: 'flex-end', gap: spacing.xxs },
  empty: { ...textStyles.bodySmall, color: semantic.text.secondary, textAlign: 'center', padding: spacing.lg },
});
