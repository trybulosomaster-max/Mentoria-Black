import { Redirect, Tabs } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { Screen, StateView } from '../../src/design-system/components';
import { colors, spacing, typography } from '../../src/design-system/tokens';

const icon = (glyph: string) => ({ color }: { color: string }) => (
  <Text style={[styles.icon, { color }]}>{glyph}</Text>
);

export default function TabsLayout() {
  const { phase, session, financialAccess } = useAuth();

  if (phase === 'booting' || phase === 'loading-access') {
    return (
      <Screen scroll={false}>
        <StateView loading title="Carregando" message="Verificando sua sessão e seu acesso." />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/(public)/sign-in" />;
  if (!financialAccess) return <Redirect href="/(protected)/access" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.goldBright,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('⌂') }} />
      <Tabs.Screen name="lancamentos" options={{ title: 'Lançamentos', tabBarIcon: icon('≡') }} />
      <Tabs.Screen name="planejamento" options={{ title: 'Planejamento', tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="patrimonio" options={{ title: 'Patrimônio', tabBarIcon: icon('◇') }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais', tabBarIcon: icon('•••') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: 72,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabLabel: { fontSize: 10, fontWeight: '700' },
  icon: { fontSize: typography.section, fontWeight: '800' },
});
