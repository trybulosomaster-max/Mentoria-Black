import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { BootstrapState } from '../../domain/bootstrap/app-bootstrap';
import { AppButton, BrandMark, Screen } from '../../design-system/components';
import { useAvioraTheme } from '../../design-system/theme-provider';
import { componentTokens, spacing, textStyles, type ThemeTokens } from '../../design-system/tokens';

type Props = Readonly<{
  state: BootstrapState;
  message?: string;
  onRetry?(): void | Promise<void>;
}>;

export function BootstrapExperience({ state, message, onRetry }: Props) {
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const failed = state === 'RECOVERABLE_ERROR';
  return (
    <Screen variant="auth" scroll={false} contentStyle={styles.content} testID="bootstrap-experience">
      <BrandMark />
      <View accessibilityLiveRegion="polite" style={styles.status}>
        {!failed ? <ActivityIndicator size="large" color={tokens.brand.accent} /> : null}
        <Text accessibilityRole="header" style={styles.title}>
          {failed ? 'Não foi possível iniciar' : 'Preparando sua AVIORA'}
        </Text>
        <Text style={styles.message}>
          {failed
            ? (message || 'Tivemos uma falha temporária ao restaurar sua sessão.')
            : 'Restaurando sua sessão e verificando seu acesso com segurança.'}
        </Text>
        {failed && onRetry ? (
          <View style={styles.action}>
            <AppButton label="Tentar novamente" onPress={onRetry} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) { return StyleSheet.create({
  content: { justifyContent: 'center', minHeight: '100%' },
  status: { alignItems: 'center', gap: spacing.sm, width: '100%' },
  title: { ...textStyles.section, color: tokens.text.primary, textAlign: 'center' },
  message: { ...textStyles.body, color: tokens.text.secondary, textAlign: 'center', maxWidth: componentTokens.dialog.maxWidth },
  action: { width: '100%', maxWidth: componentTokens.dialog.maxWidth, marginTop: spacing.sm },
}); }
