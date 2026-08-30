import { Redirect } from 'expo-router';

import { useAuth } from '../src/core/auth/AuthProvider';
import { Screen, StateView } from '../src/design-system/components';

export default function EntryRoute() {
  const { phase, session } = useAuth();

  if (phase === 'booting' || phase === 'loading-access') {
    return (
      <Screen scroll={false}>
        <StateView
          loading
          title="Preparando sua AVIORA"
          message="Restaurando a sessão e verificando seu acesso com segurança."
        />
      </Screen>
    );
  }

  if (!session || phase === 'configuration-required' || phase === 'anonymous') {
    return <Redirect href="/(public)/welcome" />;
  }

  if (phase === 'granted') return <Redirect href="/(tabs)" />;
  return <Redirect href="/(protected)/access" />;
}
