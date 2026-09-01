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

type FlowButtonGlyphProps = Readonly<{
  flow: 'income' | 'expense';
  styles: ReturnType<typeof createStyles>;
  tokens: ThemeTokens;
}>;

function FlowButtonGlyph({ flow, styles, tokens }: FlowButtonGlyphProps) {
  const income = flow === 'income';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.flowButton}
    >
      <View style={styles.flowGlassInset} />
      <AppIcon
        name={income ? 'arrow-up' : 'arrow-down'}
        size={primitives.size.icon.lg}
        color={income ? tokens.status.positiveText : tokens.status.riskText}
      />
    </View>
  );
}

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
  const reflow = fontScale >= dynamicType.metricReflowFontScale || width < 380;

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

      <View style={styles.heroDivider} />

      <View style={[styles.shortcuts, reflow && styles.shortcutsReflow]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Receitas realizadas. ${incomeValue.accessibilityLabel}.`}
          accessibilityHint="Abre Lançamentos neste período com o filtro de receitas."
          onPress={onIncomePress}
          style={({ pressed }) => [styles.shortcut, reflow && styles.shortcutReflow, pressed && (reducedMotion ? styles.pressedReduced : styles.pressed)]}
        >
          <FlowButtonGlyph flow="income" styles={styles} tokens={tokens} />
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
          <FlowButtonGlyph flow="expense" styles={styles} tokens={tokens} />
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
    hero: { gap: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, backgroundColor: tokens.background.surface },
    balance: { alignItems: 'center', gap: spacing.xxs },
    balanceLabel: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center' },
    balanceValue: { ...textStyles.moneyXL, maxWidth: '100%', color: tokens.text.primary, textAlign: 'center' },
    heroDivider: { width: '100%', height: StyleSheet.hairlineWidth, backgroundColor: tokens.border.default },
    shortcuts: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', gap: spacing.sm },
    shortcutsReflow: { flexDirection: 'column' },
    shortcut: { minHeight: primitives.size.touch.comfortable, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.xxs, paddingVertical: spacing.sm, borderRadius: primitives.radius.md },
    shortcutReflow: { width: '100%', minHeight: primitives.size.touch.comfortable },
    flowButton: { width: primitives.size.touch.default, height: primitives.size.touch.default, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: primitives.radius.md, borderWidth: primitives.size.border.thin, borderColor: tokens.border.strong, backgroundColor: tokens.background.surfaceMuted, ...tokens.elevation.card },
    flowGlassInset: { position: 'absolute', inset: 0, borderRadius: primitives.radius.md, backgroundColor: tokens.background.surface, opacity: primitives.opacity.subtle },
    shortcutCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: spacing.xxs },
    shortcutLabel: { ...textStyles.caption, color: tokens.text.secondary, textTransform: 'uppercase', letterSpacing: primitives.typography.letterSpacing.label },
    shortcutValue: { ...textStyles.moneyM, flexShrink: 1 },
    incomeValue: { color: tokens.status.positiveText },
    expenseValue: { color: tokens.status.riskText },
    pressed: { opacity: primitives.opacity.pressed, transform: [{ scale: primitives.motion.pressedScale }] },
    pressedReduced: { opacity: primitives.opacity.pressed },
  });
}
