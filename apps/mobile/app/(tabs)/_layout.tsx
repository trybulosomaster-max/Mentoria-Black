import { Redirect, Tabs } from 'expo-router';
import { type ColorValue, StyleSheet } from 'react-native';

import { useAuth } from '../../src/core/auth/AuthProvider';
import { Screen, StateView } from '../../src/design-system/components';
import { AppIcon, type AppIconName } from '../../src/design-system/icons';
import { colors, componentTokens, textStyles } from '../../src/design-system/tokens';

const icon = (name: AppIconName) => ({ color, size }: { color: ColorValue; size: number }) => (
  <AppIcon name={name} color={color} size={size} />
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
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="lancamentos" options={{ title: 'Lançamentos', tabBarIcon: icon('transactions') }} />
      <Tabs.Screen name="planejamento" options={{ title: 'Planejamento', tabBarIcon: icon('planning') }} />
      <Tabs.Screen name="patrimonio" options={{ title: 'Patrimônio', tabBarIcon: icon('patrimony') }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais', tabBarIcon: icon('more') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    height: componentTokens.tab.height,
    paddingTop: componentTokens.tab.topPadding,
    paddingBottom: componentTokens.tab.bottomPadding,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabLabel: textStyles.tabLabel,
});
