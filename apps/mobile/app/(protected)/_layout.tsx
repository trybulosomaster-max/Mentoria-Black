import { Stack } from 'expo-router';

import { AppRouteGate } from '../../src/presentation/navigation/AppRouteGate';

export default function ProtectedLayout() {
  return (
    <AppRouteGate scope="access">
      <Stack screenOptions={{ headerShown: false }} />
    </AppRouteGate>
  );
}
