import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { IconButton } from '../../design-system/components';
import { AppIcon } from '../../design-system/icons';
import { useReducedMotion } from '../../design-system/system';
import { useAvioraTheme } from '../../design-system/theme-provider';
import {
  componentTokens,
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
  balanceLabel: string;
  balanceHelper: string;
  income: string | null;
  expense: string | null;
  valuesVisible: boolean;
  onToggleValues(): void;
  onIncomePress(): void;
  onExpensePress(): void;
}>;

type PresentedValue = Readonly<{ text: string; accessibilityLabel: string }>;

type FlowShortcutProps = Readonly<{
  flow: 'income' | 'expense';
  label: string;
  value: PresentedValue;
  onPress(): void;
  styles: ReturnType<typeof createStyles>;
  tokens: ThemeTokens;
}>;

function FlowShortcut({
  flow,
  label,
  value,
  onPress,
  styles,
  tokens,
}: FlowShortcutProps) {
  const reducedMotion = useReducedMotion();
  const income = flow === 'income';
  const accent = income ? tokens.status.positive : tokens.status.risk;
  const onAccent = income ? tokens.status.onPositive : tokens.status.onRisk;
  const valueColor = income ? tokens.status.positiveText : tokens.status.riskText;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value.accessibilityLabel}.`}
      accessibilityHint={`Abre Lançamentos neste período com o filtro de ${label.toLocaleLowerCase('pt-BR')}.`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.flowShortcut,
        !income && styles.flowShortcutMirrored,
        pressed && (reducedMotion ? styles.pressedReduced : styles.pressed),
      ]}
    >
      <View accessibilityElementsHidden style={[styles.flowIndicator, { backgroundColor: accent }]}>
        <AppIcon
          name={income ? 'arrow-up' : 'arrow-down'}
          size={primitives.size.icon.sm}
          color={onAccent}
        />
      </View>
      <View style={[styles.flowCopy, !income && styles.flowCopyMirrored]}>
        <Text style={[styles.flowLabel, !income && styles.flowTextMirrored]}>{label}</Text>
        <Text
          maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier}
          style={[styles.flowValue, !income && styles.flowTextMirrored, { color: valueColor }]}
        >
          {value.text}
        </Text>
      </View>
    </Pressable>
  );
}

export function DashboardHero({
  balance,
  balanceLabel,
  balanceHelper,
  income,
  expense,
  valuesVisible,
  onToggleValues,
  onIncomePress,
  onExpensePress,
}: DashboardHeroProps) {
  const { fontScale, width } = useWindowDimensions();
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const unavailableValue = (value: string | null, label: string) => {
    if (value) return financialValuePresentation(value, valuesVisible);
    if (!valuesVisible) return financialValuePresentation(null, false);
    return Object.freeze({ text: UNAVAILABLE_FINANCIAL_VALUE, accessibilityLabel: label });
  };
  const balanceValue = unavailableValue(balance, 'Saldo ainda não informado');
  const incomeValue = unavailableValue(income, 'Sem receitas realizadas');
  const expenseValue = unavailableValue(expense, 'Sem despesas realizadas');
  const reflow = fontScale >= dynamicType.metricReflowFontScale || width < 350;

  return (
    <View style={styles.hero}>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`${balanceLabel}. ${balanceValue.accessibilityLabel}. ${balanceHelper}.`}
        style={styles.balance}
      >
        <Text style={styles.balanceLabel}>{balanceLabel}</Text>
        <Text
          maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier}
          style={styles.balanceValue}
        >
          {balanceValue.text}
        </Text>
      </View>
      <IconButton
        icon={valuesVisible ? 'eye-off' : 'eye'}
        label={valuesVisible ? 'Ocultar valores da Principal' : 'Mostrar valores da Principal'}
        onPress={onToggleValues}
        variant="ghost"
      />

      <View style={[styles.flows, reflow && styles.flowsReflow]}>
        <FlowShortcut
          flow="income"
          label="Receitas"
          value={incomeValue}
          onPress={onIncomePress}
          styles={styles}
          tokens={tokens}
        />
        <FlowShortcut
          flow="expense"
          label="Despesas"
          value={expenseValue}
          onPress={onExpensePress}
          styles={styles}
          tokens={tokens}
        />
      </View>
    </View>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    hero: { alignItems: 'center', gap: spacing.xl },
    balance: { maxWidth: '100%', alignItems: 'center', gap: spacing.xs },
    balanceLabel: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center' },
    balanceValue: { ...textStyles.moneyXL, maxWidth: '100%', color: tokens.text.primary, fontFamily: primitives.typography.family.uiRegular, textAlign: 'center' },
    flows: { width: '100%', flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', gap: spacing.xxl, paddingTop: spacing.md },
    flowsReflow: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.md },
    flowShortcut: { minWidth: 0, minHeight: primitives.size.touch.comfortable, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: spacing.md, paddingVertical: spacing.xs },
    flowShortcutMirrored: { flexDirection: 'row-reverse' },
    flowIndicator: { width: componentTokens.dashboard.flowIndicatorSize, height: componentTokens.dashboard.flowIndicatorSize, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: componentTokens.dashboard.flowIndicatorSize / 2 },
    flowCopy: { minWidth: 0, flex: 1, justifyContent: 'center', gap: primitives.space.none },
    flowCopyMirrored: { alignItems: 'flex-end' },
    flowTextMirrored: { textAlign: 'right' },
    flowLabel: { ...textStyles.bodySmall, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiRegular },
    flowValue: { ...textStyles.moneyM, flexShrink: 1, color: tokens.text.primary, fontSize: primitives.typography.size.section, letterSpacing: -0.2 },
    pressed: { opacity: primitives.opacity.pressed, transform: [{ scale: primitives.motion.pressedScale }] },
    pressedReduced: { opacity: primitives.opacity.pressed },
  });
}
