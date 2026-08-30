import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import {
  AppButton,
  Card,
  InlineNotice,
  PageHeader,
  Screen,
  TextField,
} from '../../src/design-system/components';
import { spacing } from '../../src/design-system/tokens';

export default function RecoverScreen() {
  const { requestPasswordReset, configurationRequired } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const submit = async () => {
    setLoading(true);
    setNotice(null);
    const result = await requestPasswordReset(email);
    setLoading(false);
    setNotice({ ok: result.ok, message: result.message ?? '' });
  };

  return (
    <Screen contentStyle={styles.content}>
      <PageHeader
        eyebrow="Recuperação segura"
        title="Redefina sua senha"
        description="Enviaremos um link para o e-mail cadastrado."
      />
      <Card style={styles.form}>
        <TextField
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        {notice ? (
          <InlineNotice
            title={notice.ok ? 'Verifique seu e-mail' : 'Não foi possível enviar'}
            message={notice.message}
            tone={notice.ok ? 'info' : 'error'}
          />
        ) : null}
        <AppButton
          label="Enviar link"
          loading={loading}
          disabled={!email.trim() || configurationRequired}
          onPress={submit}
        />
      </Card>
      <AppButton label="Voltar para entrar" variant="ghost" onPress={() => router.replace('/(public)/sign-in')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', minHeight: '100%', maxWidth: 520, width: '100%', alignSelf: 'center' },
  form: { gap: spacing.md },
});
