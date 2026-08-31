import { Tabs } from 'expo-router';
import { type ColorValue, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, type AppIconName } from '../../src/design-system/icons';
import { colors, componentTokens, textStyles } from '../../src/design-system/tokens';
import { AppRouteGate } from '../../src/presentation/navigation/AppRouteGate';

const icon = (name: AppIconName) => ({ color, size }: { color: ColorValue; size: number }) => (
  <AppIcon name={name} color={color} size={size} />
);

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <AppRouteGate scope="shell">
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: colors.goldBright,
          tabBarInactiveTintColor: colors.textSubtle,
          tabBarStyle: [styles.tabBar, {
            height: componentTokens.tab.height + insets.bottom,
            paddingBottom: componentTokens.tab.bottomPadding + insets.bottom,
          }],
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
    </AppRouteGate>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    paddingTop: componentTokens.tab.topPadding,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabLabel: textStyles.tabLabel,
});
