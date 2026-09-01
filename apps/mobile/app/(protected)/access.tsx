import { useMemo } from 'react';
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
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { componentTokens, primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';

export default function AccessScreen() {
  const {
    bootstrapState,
    entitlements,
    errorMessage,
    retryBootstrap,
    startTrial,
    signOut,
  } = useAuth();
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const experience = entitlements ? resolveExperience(entitlements) : 'no_access';
  const notice = entitlements ? trialNotice(entitlements) : '';
  const checkFailed = bootstrapState === 'RECOVERABLE_ERROR';
  const title = checkFailed
    ? 'Não foi possível verificar seu acesso'
    : experience === 'knowledge' ? 'Seu acesso é ao Conhecimento' : 'Acesso financeiro indisponível';
  const description = checkFailed
    ? 'Sua sessão permanece protegida. Verifique a conexão e tente novamente.'
    : experience === 'trial_expired'
    ? 'Seu período de teste terminou. Seus dados permanecem protegidos.'
    : experience === 'knowledge'
      ? 'A área financeira APP não está incluída no acesso atual.'
      : 'Não encontramos uma licença APP ativa para esta conta.';

  return (
    <Screen variant="stack" contentStyle={styles.content}>
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
        <AppButton label="Verificar novamente" onPress={async () => { await retryBootstrap(); }} />
        {appEnvironment.enableTrialStart ? (
          <AppButton label="Ativar teste gratuito" variant="secondary" onPress={async () => { await startTrial(); }} />
        ) : null}
        <AppButton label="Sair desta conta" variant="ghost" onPress={signOut} />
      </View>
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) { return StyleSheet.create({
  content: { justifyContent: 'center', minHeight: '100%', maxWidth: componentTokens.screen.readableMaxWidth, width: '100%', alignSelf: 'center' },
  brand: { alignItems: 'center' },
  card: { gap: spacing.xs },
  cardTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiSemiBold },
  cardText: { ...textStyles.bodySmall, color: tokens.text.secondary },
  actions: { gap: spacing.sm },
}); }
