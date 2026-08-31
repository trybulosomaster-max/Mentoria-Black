import { Stack } from 'expo-router';

import { AppRouteGate } from '../../src/presentation/navigation/AppRouteGate';

export default function PublicLayout() {
  return (
    <AppRouteGate scope="public">
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
    </AppRouteGate>
  );
}
