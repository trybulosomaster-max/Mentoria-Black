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
}>;

function FlowButtonGlyph({ flow, styles }: FlowButtonGlyphProps) {
  const income = flow === 'income';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.flowButton, income ? styles.incomeButton : styles.expenseButton]}
    >
      <View style={styles.flowGlassInset} />
      <View style={[styles.flowRing, income ? styles.incomeRing : styles.expenseRing]}>
        <Text
          allowFontScaling={false}
          style={[styles.currencyGlyph, income ? styles.incomeGlyph : styles.expenseGlyph]}
        >
          R$
        </Text>
      </View>
      <View style={styles.flowArrowMask}>
        <AppIcon
          name={income ? 'arrow-up' : 'arrow-down'}
          size={primitives.size.icon.sm}
          color={income ? primitives.color.green[200] : primitives.color.red[200]}
        />
      </View>
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
          <FlowButtonGlyph flow="income" styles={styles} />
          <View style={styles.shortcutCopy}>
            <Text style={[styles.shortcutLabel, styles.incomeLabel]}>Receitas</Text>
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
          <FlowButtonGlyph flow="expense" styles={styles} />
          <View style={styles.shortcutCopy}>
            <Text style={[styles.shortcutLabel, styles.expenseLabel]}>Despesas</Text>
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
    flowButton: { width: primitives.size.touch.comfortable, height: primitives.size.touch.comfortable, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: primitives.radius.md, borderWidth: primitives.size.border.thin, backgroundColor: primitives.color.neutral[950], ...tokens.elevation.card },
    incomeButton: { borderColor: tokens.status.positive, shadowColor: tokens.status.positive, shadowOffset: { width: primitives.space.none, height: primitives.space.none } },
    expenseButton: { borderColor: tokens.status.risk, shadowColor: tokens.status.risk, shadowOffset: { width: primitives.space.none, height: primitives.space.none } },
    flowGlassInset: { position: 'absolute', top: primitives.size.border.strong, right: primitives.size.border.strong, bottom: primitives.size.border.strong, left: primitives.size.border.strong, borderRadius: primitives.radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: primitives.color.neutral[650], backgroundColor: primitives.color.neutral[900] },
    flowRing: { width: primitives.size.icon.xl, height: primitives.size.icon.xl, alignItems: 'center', justifyContent: 'center', borderRadius: primitives.radius.pill, borderWidth: primitives.size.border.thin },
    incomeRing: { borderColor: primitives.color.green[200] },
    expenseRing: { borderColor: primitives.color.red[200] },
    currencyGlyph: { fontFamily: primitives.typography.family.uiSemiBold, fontSize: primitives.typography.size.bodySmall, lineHeight: primitives.typography.lineHeight.bodySmall, letterSpacing: primitives.typography.letterSpacing.tight, textAlign: 'center' },
    incomeGlyph: { color: primitives.color.green[200] },
    expenseGlyph: { color: primitives.color.red[200] },
    flowArrowMask: { position: 'absolute', right: spacing.xxs, bottom: spacing.xxs, width: primitives.size.icon.sm, height: primitives.size.icon.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: primitives.color.neutral[900] },
    shortcutCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: spacing.xxs },
    shortcutLabel: { ...textStyles.caption, color: tokens.text.secondary, textTransform: 'uppercase', letterSpacing: primitives.typography.letterSpacing.label },
    incomeLabel: { color: tokens.status.positiveText },
    expenseLabel: { color: tokens.status.riskText },
    shortcutValue: { ...textStyles.moneyM, flexShrink: 1 },
    incomeValue: { color: tokens.status.positiveText },
    expenseValue: { color: tokens.status.riskText },
    pressed: { opacity: primitives.opacity.pressed, transform: [{ scale: primitives.motion.pressedScale }] },
    pressedReduced: { opacity: primitives.opacity.pressed },
  });
}
