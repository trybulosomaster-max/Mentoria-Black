import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import {
  AppButton,
  BrandMark,
  Card,
  InlineNotice,
  PageHeader,
  Screen,
  TextField,
} from '../../src/design-system/components';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { componentTokens, spacing, textStyles, type ThemeTokens } from '../../src/design-system/tokens';

export default function SignInScreen() {
  const { signIn, configurationRequired } = useAuth();
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    setLoading(true);
    setMessage('');
    const result = await signIn(email, password);
    setLoading(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.replace('/');
  };

  return (
    <Screen variant="auth" contentStyle={styles.content}>
      <View style={styles.brand}><BrandMark compact /></View>
      <PageHeader
        eyebrow="Bem-vindo de volta"
        title="Entre na AVIORA"
        description="Use a mesma conta da versão Web."
      />

      {configurationRequired ? (
        <InlineNotice
          title="Configuração necessária"
          message="Defina as variáveis públicas do Supabase Beta antes de autenticar."
          tone="warning"
        />
      ) : null}

      <Card style={styles.form}>
        <TextField
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          placeholder="voce@exemplo.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          returnKeyType="next"
        />
        <TextField
          label="Senha"
          value={password}
          onChangeText={setPassword}
          placeholder="Sua senha"
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          returnKeyType="done"
          onSubmitEditing={() => { void submit(); }}
        />
        {message ? <InlineNotice title="Não foi possível entrar" message={message} tone="error" /> : null}
        <AppButton
          label="Entrar"
          loading={loading}
          disabled={!email.trim() || !password || configurationRequired}
          onPress={submit}
        />
        <AppButton
          label="Esqueci minha senha"
          variant="ghost"
          onPress={() => router.push('/(public)/recover')}
        />
      </Card>

      <View style={styles.bottom}>
        <Text style={styles.bottomText}>Ainda não possui conta?</Text>
        <AppButton label="Criar conta" variant="secondary" onPress={() => router.push('/(public)/sign-up')} />
        <AppButton label="Voltar" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function createStyles(tokens: ThemeTokens) { return StyleSheet.create({
  content: { justifyContent: 'center', minHeight: '100%', maxWidth: componentTokens.dialog.maxWidth, width: '100%', alignSelf: 'center' },
  brand: { alignItems: 'center', marginBottom: spacing.sm },
  form: { gap: spacing.md },
  bottom: { gap: spacing.sm },
  bottomText: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center' },
}); }
