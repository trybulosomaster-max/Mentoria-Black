import { Tabs } from 'expo-router';
import { type ColorValue, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FinancialPeriodProvider } from '../../src/application/period/financial-period-provider';
import { AppIcon, type AppIconName } from '../../src/design-system/icons';
import { componentTokens, dynamicType, textStyles } from '../../src/design-system/tokens';
import { useAvioraTheme } from '../../src/design-system/theme-provider';
import { AppRouteGate } from '../../src/presentation/navigation/AppRouteGate';

const icon = (name: AppIconName) => ({ color, size }: { color: ColorValue; size: number }) => (
  <AppIcon name={name} color={color} size={size} />
);

const label = (title: string) => ({ color }: { color: ColorValue }) => (
  <Text maxFontSizeMultiplier={dynamicType.tabLabelMaxFontSizeMultiplier} numberOfLines={2} style={[styles.tabLabel, { color }]}>{title}</Text>
);

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const { tokens } = useAvioraTheme();
  const tabLabelScale = Math.min(fontScale, dynamicType.tabLabelMaxFontSizeMultiplier);
  const scaledLabelAllowance = Math.ceil(Math.max(0, tabLabelScale - 1) * 20);

  return (
    <AppRouteGate scope="shell">
      <FinancialPeriodProvider>
        <Tabs
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: tokens.navigation.selected,
          tabBarInactiveTintColor: tokens.navigation.unselected,
          tabBarStyle: [styles.tabBar, {
            height: componentTokens.tab.height + scaledLabelAllowance + insets.bottom,
            paddingBottom: componentTokens.tab.bottomPadding + insets.bottom,
            borderTopColor: tokens.border.default,
            backgroundColor: tokens.navigation.background,
          }],
          tabBarLabelStyle: styles.tabLabel,
          tabBarItemStyle: styles.tabItem,
          tabBarIconStyle: styles.tabIcon,
          sceneStyle: { backgroundColor: tokens.background.canvas },
        }}
        >
          <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('home'), tabBarLabel: label('Início') }} />
          <Tabs.Screen name="lancamentos" options={{ title: 'Lançamentos', tabBarIcon: icon('transactions'), tabBarLabel: label('Lançamentos') }} />
          <Tabs.Screen name="planejamento" options={{ title: 'Planejamento', tabBarIcon: icon('planning'), tabBarLabel: label('Planejamento') }} />
          <Tabs.Screen name="patrimonio" options={{ title: 'Patrimônio', tabBarIcon: icon('patrimony'), tabBarLabel: label('Patrimônio') }} />
          <Tabs.Screen name="mais" options={{ title: 'Mais', tabBarIcon: icon('more'), tabBarLabel: label('Mais') }} />
        </Tabs>
      </FinancialPeriodProvider>
    </AppRouteGate>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    paddingTop: componentTokens.tab.topPadding,
  },
  tabLabel: {
    ...textStyles.tabLabel,
    maxWidth: '100%',
    textAlign: 'center',
  },
  tabItem: {
    minWidth: 0,
    paddingHorizontal: 0,
  },
  tabIcon: {
    marginBottom: -2,
  },
});
