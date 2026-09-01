import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Card, IconButton } from '../../design-system/components';
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

const FLOW_ASSETS = Object.freeze({
  income: require('../../../assets/dashboard/income-brl-premium-v1.png'),
  expense: require('../../../assets/dashboard/expense-brl-premium-v1.png'),
});

function FlowButtonGlyph({ flow, styles }: FlowButtonGlyphProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.flowAssetFrame}
    >
      <Image
        accessible={false}
        fadeDuration={primitives.motion.duration.instant}
        resizeMode="contain"
        source={FLOW_ASSETS[flow]}
        style={styles.flowAsset}
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
      <LinearGradient
        colors={[tokens.background.surfaceMuted, tokens.background.surface]}
        end={{ x: 0.9, y: 1 }}
        pointerEvents="none"
        start={{ x: 0.1, y: 0 }}
        style={styles.heroBackdrop}
      />
      <View accessibilityElementsHidden pointerEvents="none" style={styles.heroHighlight} />
      <View style={styles.balance}>
        <View style={styles.balanceHeader}>
          <Text style={styles.balanceLabel}>Saldo atual em contas</Text>
          <IconButton
            icon={valuesVisible ? 'eye-off' : 'eye'}
            label={valuesVisible ? 'Ocultar valores da Principal' : 'Mostrar valores da Principal'}
            onPress={onToggleValues}
            variant="ghost"
          />
        </View>
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`Saldo atual em contas. ${balanceValue.accessibilityLabel}.`}
        >
          <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={styles.balanceValue}>{balanceValue.text}</Text>
        </View>
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

        {!reflow ? <View accessibilityElementsHidden style={styles.shortcutDivider} /> : null}

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
    hero: { position: 'relative', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, backgroundColor: tokens.background.surface },
    heroBackdrop: { position: 'absolute', top: primitives.space.none, right: primitives.space.none, bottom: primitives.space.none, left: primitives.space.none, borderRadius: primitives.radius.lg },
    heroHighlight: { position: 'absolute', top: primitives.space.none, right: spacing.lg, left: spacing.lg, height: StyleSheet.hairlineWidth, borderRadius: primitives.radius.pill, backgroundColor: tokens.brand.accent, opacity: primitives.opacity.subtle },
    balance: { alignItems: 'stretch', gap: spacing.xs },
    balanceHeader: { minHeight: primitives.size.touch.default, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    balanceLabel: { ...textStyles.bodySmall, flex: 1, color: tokens.text.secondary, textAlign: 'left' },
    balanceValue: { ...textStyles.moneyXL, maxWidth: '100%', color: tokens.text.primary, textAlign: 'left' },
    heroDivider: { width: '100%', height: StyleSheet.hairlineWidth, backgroundColor: tokens.border.default },
    shortcuts: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', gap: spacing.xs },
    shortcutsReflow: { flexDirection: 'column' },
    shortcut: { minHeight: primitives.size.touch.comfortable, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.xxs, paddingVertical: spacing.sm, borderRadius: primitives.radius.md },
    shortcutReflow: { width: '100%', minHeight: primitives.size.touch.comfortable },
    shortcutDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: spacing.xs, backgroundColor: tokens.border.default },
    flowAssetFrame: { width: primitives.size.touch.comfortable + spacing.xs, height: primitives.size.touch.comfortable + spacing.xs, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
    flowAsset: { width: '100%', height: '100%' },
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
