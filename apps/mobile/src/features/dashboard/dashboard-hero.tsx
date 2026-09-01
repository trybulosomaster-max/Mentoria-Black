import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Card, IconButton } from '../../design-system/components';
import { AppIcon } from '../../design-system/icons';
import { useReducedMotion } from '../../design-system/system';
import { useAvioraTheme } from '../../design-system/theme-provider';
import {
  dynamicType,
  primitives,
  spacing,
  textStyles,
  type ThemeTokens,
} from '../../design-system/tokens';
import {
  financialValuePresentation,
  UNAVAILABLE_FINANCIAL_VALUE,
} from './dashboard-contract';

type DashboardHeroProps = Readonly<{
  balance: string | null;
  income: string | null;
  expense: string | null;
  valuesVisible: boolean;
  onToggleValues(): void;
  onIncomePress(): void;
  onExpensePress(): void;
}>;

export function DashboardHero({
  balance,
  income,
  expense,
  valuesVisible,
  onToggleValues,
  onIncomePress,
  onExpensePress,
}: DashboardHeroProps) {
  const { fontScale, width } = useWindowDimensions();
  const { tokens } = useAvioraTheme();
  const reducedMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const unavailableValue = (value: string | null, label: string) => {
    if (value) return financialValuePresentation(value, valuesVisible);
    if (!valuesVisible) return financialValuePresentation(null, false);
    return Object.freeze({ text: UNAVAILABLE_FINANCIAL_VALUE, accessibilityLabel: label });
  };
  const balanceValue = unavailableValue(balance, 'Saldo ainda não informado');
  const incomeValue = unavailableValue(income, 'Sem receitas realizadas');
  const expenseValue = unavailableValue(expense, 'Sem despesas realizadas');
  const reflow = fontScale >= dynamicType.metricReflowFontScale || width < 360;

  return (
    <Card tone="raised" style={styles.hero}>
      <View style={styles.balance}>
        <Text style={styles.balanceLabel}>Saldo atual em contas</Text>
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`Saldo atual em contas. ${balanceValue.accessibilityLabel}.`}
        >
          <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={styles.balanceValue}>{balanceValue.text}</Text>
        </View>
        <IconButton
          icon={valuesVisible ? 'eye-off' : 'eye'}
          label={valuesVisible ? 'Ocultar valores da Principal' : 'Mostrar valores da Principal'}
          onPress={onToggleValues}
          variant="ghost"
        />
      </View>

      <View style={[styles.shortcuts, reflow && styles.shortcutsReflow]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Receitas realizadas. ${incomeValue.accessibilityLabel}.`}
          accessibilityHint="Abre Lançamentos neste período com o filtro de receitas."
          onPress={onIncomePress}
          style={({ pressed }) => [styles.shortcut, reflow && styles.shortcutReflow, pressed && (reducedMotion ? styles.pressedReduced : styles.pressed)]}
        >
          <View style={[styles.shortcutIcon, styles.incomeIcon]}><AppIcon name="trend-up" color={tokens.status.positiveText} /></View>
          <View style={styles.shortcutCopy}>
            <Text style={styles.shortcutLabel}>Receitas</Text>
            <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={[styles.shortcutValue, styles.incomeValue]}>{incomeValue.text}</Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Despesas realizadas. ${expenseValue.accessibilityLabel}.`}
          accessibilityHint="Abre Lançamentos neste período com o filtro de despesas."
          onPress={onExpensePress}
          style={({ pressed }) => [styles.shortcut, reflow && styles.shortcutReflow, pressed && (reducedMotion ? styles.pressedReduced : styles.pressed)]}
        >
          <View style={[styles.shortcutIcon, styles.expenseIcon]}><AppIcon name="trend-down" color={tokens.status.riskText} /></View>
          <View style={styles.shortcutCopy}>
            <Text style={styles.shortcutLabel}>Despesas</Text>
            <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={[styles.shortcutValue, styles.expenseValue]}>{expenseValue.text}</Text>
          </View>
        </Pressable>
      </View>
    </Card>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    hero: { gap: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, overflow: 'hidden' },
    balance: { alignItems: 'center', gap: spacing.xxs },
    balanceLabel: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center' },
    balanceValue: { ...textStyles.moneyXL, maxWidth: '100%', color: tokens.text.primary, textAlign: 'center' },
    shortcuts: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', gap: spacing.lg },
    shortcutsReflow: { flexDirection: 'column' },
    shortcut: { minHeight: 88, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, borderRadius: primitives.radius.md },
    shortcutReflow: { width: '100%', minHeight: primitives.size.touch.comfortable },
    shortcutIcon: { width: primitives.size.touch.minimum, height: primitives.size.touch.minimum, alignItems: 'center', justifyContent: 'center', borderRadius: primitives.radius.pill },
    incomeIcon: { backgroundColor: tokens.background.surface },
    expenseIcon: { backgroundColor: tokens.background.surface },
    shortcutCopy: { flexShrink: 1, minWidth: 0, alignItems: 'flex-start', gap: spacing.xxs },
    shortcutLabel: { ...textStyles.caption, color: tokens.text.secondary, textTransform: 'uppercase', letterSpacing: primitives.typography.letterSpacing.label },
    shortcutValue: { ...textStyles.moneyM, flexShrink: 1 },
    incomeValue: { color: tokens.status.positiveText },
    expenseValue: { color: tokens.status.riskText },
    pressed: { opacity: primitives.opacity.pressed, transform: [{ scale: primitives.motion.pressedScale }] },
    pressedReduced: { opacity: primitives.opacity.pressed },
  });
}
