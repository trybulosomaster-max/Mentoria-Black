import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { MIN_PASSWORD_LENGTH } from '../../src/features/auth/password-policy';
import {
  AppButton,
  Card,
  InlineNotice,
  PageHeader,
  Screen,
  TextField,
} from '../../src/design-system/components';
import { AppIcon } from '../../src/design-system/icons';
import { componentTokens, primitives, semantic, spacing, textStyles, touch } from '../../src/design-system/tokens';

export default function SignUpScreen() {
  const { signUp, configurationRequired } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; title: string; message: string } | null>(null);

  const submit = async () => {
    setLoading(true);
    setNotice(null);
    const result = await signUp({ name, email, password, confirmation, termsAccepted });
    setLoading(false);
    if (!result.ok) {
      setNotice({ tone: 'error', title: 'Revise os dados', message: result.message });
      return;
    }
    setNotice({ tone: 'info', title: 'Cadastro recebido', message: result.message ?? 'Confira seu e-mail.' });
  };

  return (
    <Screen variant="auth" contentStyle={styles.content}>
      <PageHeader
        eyebrow="Fase beta"
        title="Crie sua conta"
        description="O cadastro segue a política vigente da AVIORA Web."
      />

      <Card style={styles.form}>
        <TextField label="Nome" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
        <TextField
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextField
          label="Senha"
          helper={`Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <TextField
          label="Confirmar senha"
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: termsAccepted }}
          onPress={() => setTermsAccepted((value) => !value)}
          style={({ pressed }) => [styles.terms, pressed && styles.pressed]}
        >
          <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
            {termsAccepted ? <AppIcon name="success" size={primitives.size.icon.sm} color={semantic.text.inverse} /> : null}
          </View>
          <Text style={styles.termsText}>
            Li e concordo com os Termos de Uso e a Política de Privacidade vigentes.
          </Text>
        </Pressable>

        {configurationRequired ? (
          <InlineNotice title="Configuração necessária" message="Conecte o ambiente Beta antes do cadastro." tone="warning" />
        ) : null}
        {notice ? <InlineNotice title={notice.title} message={notice.message} tone={notice.tone} /> : null}

        <AppButton
          label="Criar minha conta"
          loading={loading}
          disabled={configurationRequired}
          onPress={submit}
        />
      </Card>

      <AppButton label="Já tenho conta" variant="secondary" onPress={() => router.replace('/(public)/sign-in')} />
      <AppButton label="Voltar" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { maxWidth: componentTokens.screen.readableMaxWidth, width: '100%', alignSelf: 'center' },
  form: { gap: spacing.md },
  terms: { minHeight: touch.comfortable, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  pressed: { opacity: primitives.opacity.pressed },
  checkbox: { width: primitives.size.icon.md, height: primitives.size.icon.md, borderRadius: primitives.radius.sm, borderWidth: primitives.size.border.thin, borderColor: semantic.border.strong, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: semantic.action.primary, borderColor: semantic.action.primary },
  termsText: { ...textStyles.bodySmall, flex: 1, color: semantic.text.secondary },
});
