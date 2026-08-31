import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { BootstrapState } from '../../domain/bootstrap/app-bootstrap';
import { AppButton, BrandMark, Screen } from '../../design-system/components';
import { componentTokens, semantic, spacing, textStyles } from '../../design-system/tokens';

type Props = Readonly<{
  state: BootstrapState;
  message?: string;
  onRetry?(): void | Promise<void>;
}>;

export function BootstrapExperience({ state, message, onRetry }: Props) {
  const failed = state === 'RECOVERABLE_ERROR';
  return (
    <Screen variant="auth" scroll={false} contentStyle={styles.content} testID="bootstrap-experience">
      <BrandMark />
      <View accessibilityLiveRegion="polite" style={styles.status}>
        {!failed ? <ActivityIndicator size="large" color={semantic.action.primary} /> : null}
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

const styles = StyleSheet.create({
  content: { justifyContent: 'center', minHeight: '100%' },
  status: { alignItems: 'center', gap: spacing.sm, width: '100%' },
  title: { ...textStyles.section, color: semantic.text.primary, textAlign: 'center' },
  message: { ...textStyles.body, color: semantic.text.secondary, textAlign: 'center', maxWidth: componentTokens.dialog.maxWidth },
  action: { width: '100%', maxWidth: componentTokens.dialog.maxWidth, marginTop: spacing.sm },
});
