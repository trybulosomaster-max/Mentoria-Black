import { router } from 'expo-router';

import { AppButton, Screen, StateView } from '../src/design-system/components';

export default function NotFoundScreen() {
  return (
    <Screen scroll={false}>
      <StateView
        title="Página não encontrada"
        message="Este caminho não existe ou ainda não está disponível nesta versão da AVIORA."
        action={<AppButton label="Voltar ao início" onPress={() => router.replace('/')} />}
      />
    </Screen>
  );
}
