import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { appEnvironment, configurationMessage } from '../../src/core/config/env';
import {
  AppButton,
  BrandMark,
  Card,
  InlineNotice,
  Screen,
} from '../../src/design-system/components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { componentTokens, primitives, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';

const benefits = [
  ['Visão clara', 'Realizado, programado e patrimônio sem misturar conceitos.'],
  ['Uma única conta', 'Os mesmos dados e acessos da AVIORA Web.'],
  ['Proteção por padrão', 'Leitura financeira nesta fundação, sem alterações silenciosas.'],
] as const;

export default function WelcomeScreen() {
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <Screen variant="auth" contentStyle={styles.content}>
      <View style={styles.hero}>
        <BrandMark />
        <Text accessibilityRole="header" style={styles.title}>Sua vida financeira, com direção.</Text>
        <Text style={styles.subtitle}>
          A experiência AVIORA preparada para iPhone, iPad e Android.
        </Text>
      </View>

      {!appEnvironment.configured ? (
        <InlineNotice
          title="Ambiente ainda não configurado"
          message={configurationMessage()}
          tone="warning"
        />
      ) : null}

      <Card style={styles.benefitsCard}>
        {benefits.map(([title, description]) => (
          <View key={title} style={styles.benefit}>
            <View style={styles.bullet} />
            <View style={styles.benefitCopy}>
              <Text style={styles.benefitTitle}>{title}</Text>
              <Text style={styles.benefitDescription}>{description}</Text>
            </View>
          </View>
        ))}
      </Card>

      <View style={styles.actions}>
        <AppButton label="Entrar na minha conta" onPress={() => router.push('/(public)/sign-in')} />
        {appEnvironment.enableSignup ? (
          <AppButton
            label="Criar conta"
            variant="secondary"
            onPress={() => router.push('/(public)/sign-up')}
          />
        ) : null}
      </View>

      <Text style={styles.footnote}>
        Fundação móvel V1 • ambiente {appEnvironment.name} • financeiro {appEnvironment.readOnly ? 'somente leitura' : 'habilitado'}
      </Text>
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) { return StyleSheet.create({
  content: { justifyContent: 'center', minHeight: '100%' },
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  title: { ...textStyles.title, color: tokens.text.primary, textAlign: 'center', maxWidth: componentTokens.screen.stateMinHeight },
  subtitle: { ...textStyles.body, color: tokens.text.secondary, textAlign: 'center', maxWidth: componentTokens.dialog.maxWidth },
  benefitsCard: { gap: spacing.md },
  benefit: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: { width: spacing.xs, height: spacing.xs, borderRadius: primitives.radius.pill, backgroundColor: tokens.brand.accent, marginTop: primitives.radius.xs },
  benefitCopy: { flex: 1, gap: spacing.xxs },
  benefitTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiExtraBold },
  benefitDescription: { ...textStyles.bodySmall, color: tokens.text.secondary },
  actions: { gap: spacing.sm },
  footnote: { ...textStyles.caption, color: tokens.text.secondary, textAlign: 'center' },
}); }
