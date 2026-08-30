import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import {
  Card,
  InlineNotice,
  PageHeader,
  Pill,
  Screen,
  SectionTitle,
  StateView,
  commonStyles,
} from '../../src/design-system/components';
import { colors, spacing, typography } from '../../src/design-system/tokens';
import { useMobileSnapshot } from '../../src/features/read-models/use-mobile-snapshot';
import { formatDate, formatMoney } from '../../src/lib/format';

export default function NetWorthScreen() {
  const { user } = useAuth();
  const { data, loading, refreshing, error, refresh } = useMobileSnapshot(user?.id);
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
            <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
            <Text style={styles.meta}>{formatMoney(goal.current)} de {formatMoney(goal.target)}</Text>
          </Card>
        );
      }) : <Card><Text style={styles.empty}>Nenhuma meta cadastrada.</Text></Card>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  itemCard: { gap: spacing.sm },
  copy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  title: { color: colors.text, fontSize: typography.body, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 17 },
  caption: { color: colors.textSubtle, fontSize: typography.caption, textAlign: 'right' },
  value: { color: colors.goldBright, fontSize: typography.body, fontWeight: '800', textAlign: 'right' },
  end: { alignItems: 'flex-end', gap: spacing.xxs },
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.surfacePressed, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999, backgroundColor: colors.gold },
});
