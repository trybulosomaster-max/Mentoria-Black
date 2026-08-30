import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { AppButton, Screen, StateView } from '../../src/design-system/components';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string | string[]; next?: string | string[] }>();
  const { exchangeCode } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const code = Array.isArray(params.code) ? params.code[0] : params.code;
    const next = Array.isArray(params.next) ? params.next[0] : params.next;
    if (!code) {
      setError('O link não contém um código de autenticação válido.');
      return;
    }

    const run = async () => {
      const result = await exchangeCode(code);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace(next === 'update-password' ? '/(public)/update-password' : '/');
    };
    void run();
  }, [exchangeCode, params.code, params.next]);

  return (
    <Screen scroll={false}>
      <StateView
        loading={!error}
        title={error ? 'Link inválido' : 'Confirmando seu acesso'}
        message={error || 'Aguarde enquanto validamos o link com segurança.'}
        action={error ? <AppButton label="Voltar para entrar" onPress={() => router.replace('/(public)/sign-in')} /> : undefined}
      />
    </Screen>
  );
}
