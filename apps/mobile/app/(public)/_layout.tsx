import { Stack } from 'expo-router';

import { useReducedMotion } from '../../src/design-system/system';
import { AppRouteGate } from '../../src/presentation/navigation/AppRouteGate';

export default function PublicLayout() {
  const reducedMotion = useReducedMotion();
  return (
    <AppRouteGate scope="public">
      <Stack screenOptions={{ headerShown: false, animation: reducedMotion ? 'none' : 'slide_from_right' }} />
    </AppRouteGate>
  );
}
