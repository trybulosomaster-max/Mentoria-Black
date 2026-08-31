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
import { ReducedMotionProvider, useReducedMotion } from '../src/design-system/system';
import { ThemeProvider, useAvioraTheme } from '../src/design-system/theme-provider';
import { bootstrapIsPending } from '../src/domain/bootstrap/app-bootstrap';

void SplashScreen.preventAutoHideAsync();

function BootstrapGate({ fontsReady }: { fontsReady: boolean }) {
  const { bootstrapState } = useAuth();
  const { ready: themeReady } = useAvioraTheme();
  const bootstrapReady = !bootstrapIsPending(bootstrapState);

  useEffect(() => {
    if (fontsReady && bootstrapReady && themeReady) void SplashScreen.hideAsync();
  }, [bootstrapReady, fontsReady, themeReady]);

  return null;
}

function ThemedApplication({ fontsReady }: { fontsReady: boolean }) {
  const { resolvedTheme, tokens } = useAvioraTheme();
  const reducedMotion = useReducedMotion();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: tokens.background.canvas }}>
      <SafeAreaProvider>
        <AuthProvider>
          <BootstrapGate fontsReady={fontsReady} />
          <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: tokens.background.canvas }, animation: reducedMotion ? 'none' : 'fade' }} />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
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

  return <ThemeProvider><ReducedMotionProvider><ThemedApplication fontsReady={fontsReady} /></ReducedMotionProvider></ThemeProvider>;
}
