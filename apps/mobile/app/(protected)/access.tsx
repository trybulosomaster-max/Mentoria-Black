import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { appEnvironment } from '../../src/core/config/env';
import { resolveExperience, trialNotice } from '../../src/domain/access/access-contract';
import {
  AppButton,
  BrandMark,
  Card,
  InlineNotice,
  PageHeader,
  Screen,
} from '../../src/design-system/components';
import { colors, spacing, typography } from '../../src/design-system/tokens';

export default function AccessScreen() {
  const {
    session,
    entitlements,
    financialAccess,
    errorMessage,
    refreshEntitlements,
    startTrial,
    signOut,
  } = useAuth();

  if (!session) return <Redirect href="/(public)/sign-in" />;
  if (financialAccess) return <Redirect href="/(tabs)" />;

  const experience = entitlements ? resolveExperience(entitlements) : 'no_access';
  const notice = entitlements ? trialNotice(entitlements) : '';
  const title = experience === 'knowledge' ? 'Seu acesso é ao Conhecimento' : 'Acesso financeiro indisponível';
  const description = experience === 'trial_expired'
    ? 'Seu período de teste terminou. Seus dados permanecem protegidos.'
    : experience === 'knowledge'
      ? 'A área financeira APP não está incluída no acesso atual.'
      : 'Não encontramos uma licença APP ativa para esta conta.';

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.brand}><BrandMark compact /></View>
      <PageHeader eyebrow="Conta protegida" title={title} description={description} />

      {notice ? <InlineNotice title="Teste gratuito" message={notice} tone="info" /> : null}
      {errorMessage ? <InlineNotice title="Falha de verificação" message={errorMessage} tone="error" /> : null}

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>O que acontece com seus dados?</Text>
        <Text style={styles.cardText}>
          Nenhum dado foi excluído. A autorização é conferida no servidor e o aplicativo não contorna o gate comercial.
        </Text>
      </Card>

      <View style={styles.actions}>
        <AppButton label="Verificar novamente" onPress={async () => { await refreshEntitlements(); }} />
        {appEnvironment.enableTrialStart ? (
          <AppButton label="Ativar teste gratuito" variant="secondary" onPress={async () => { await startTrial(); }} />
        ) : null}
        <AppButton label="Sair desta conta" variant="ghost" onPress={signOut} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', minHeight: '100%', maxWidth: 540, width: '100%', alignSelf: 'center' },
  brand: { alignItems: 'center' },
  card: { gap: spacing.xs },
  cardTitle: { color: colors.text, fontSize: typography.body, fontWeight: '800' },
  cardText: { color: colors.textMuted, fontSize: typography.bodySmall, lineHeight: 20 },
  actions: { gap: spacing.sm },
});
