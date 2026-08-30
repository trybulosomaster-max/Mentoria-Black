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
import { componentTokens, spacing } from '../../src/design-system/tokens';

export default function UpdatePasswordScreen() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    if (password !== confirmation) {
      setMessage('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    setMessage('');
    const result = await updatePassword(password);
    setLoading(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.replace('/');
  };

  return (
    <Screen variant="auth" contentStyle={styles.content}>
      <PageHeader title="Crie uma nova senha" description="Depois da atualização, você voltará à sua conta." />
      <Card style={styles.form}>
        <TextField label="Nova senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
        <TextField label="Confirmar senha" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoComplete="new-password" />
        {message ? <InlineNotice title="Revise a senha" message={message} tone="error" /> : null}
        <AppButton label="Atualizar senha" loading={loading} disabled={!password || !confirmation} onPress={submit} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', minHeight: '100%', maxWidth: componentTokens.dialog.maxWidth, width: '100%', alignSelf: 'center' },
  form: { gap: spacing.md },
});
