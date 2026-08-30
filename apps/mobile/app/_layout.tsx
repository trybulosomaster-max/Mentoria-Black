import 'react-native-gesture-handler';

import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Syncopate_400Regular, Syncopate_700Bold } from '@expo-google-fonts/syncopate';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../src/core/auth/AuthProvider';
import { semantic } from '../src/design-system/tokens';

void SplashScreen.preventAutoHideAsync();

function BootstrapGate({ fontsReady }: { fontsReady: boolean }) {
  const { phase } = useAuth();
  const bootstrapReady = phase !== 'booting' && phase !== 'loading-access';

  useEffect(() => {
    if (fontsReady && bootstrapReady) void SplashScreen.hideAsync();
  }, [bootstrapReady, fontsReady]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Syncopate_400Regular,
    Syncopate_700Bold,
  });
  const fontsReady = fontsLoaded || Boolean(fontError);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: semantic.bg.base }}>
      <SafeAreaProvider>
        <AuthProvider>
          <BootstrapGate fontsReady={fontsReady} />
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: semantic.bg.base },
              animation: 'fade',
            }}
          />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
