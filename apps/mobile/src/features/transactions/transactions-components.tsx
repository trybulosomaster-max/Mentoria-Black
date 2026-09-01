import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BottomSheet, Divider, StatusPill } from '../../design-system/components';
import { AppIcon, type AppIconName } from '../../design-system/icons';
import { useAvioraTheme } from '../../design-system/theme-provider';
import {
  dynamicType,
  primitives,
  spacing,
  textStyles,
  type ThemeTokens,
} from '../../design-system/tokens';
import { formatMoney } from '../../lib/format';
import type {
  TransactionAmountTone,
  TransactionListItem,
} from './transactions-read-model';

function itemIcon(item: TransactionListItem): AppIconName {
  if (item.isCard) return 'card';
  if (item.type === 'receita' || item.type === 'resgate') return 'arrow-up';
  if (item.type === 'despesa') return 'arrow-down';
  if (item.type === 'transferencia') return 'transfer';
  if (item.type === 'investimento') return 'patrimony';
  return 'transactions';
}

function toneColor(tokens: ThemeTokens, tone: TransactionAmountTone): string {
  if (tone === 'positive') return tokens.status.positiveText;
  if (tone === 'risk') return tokens.status.riskText;
  return tokens.text.primary;
}

export function TransactionsSummary({
  cashFlow,
  income,
  expense,
}: Readonly<{
  cashFlow: number;
  income: number;
  expense: number;
}>) {
  const { fontScale, width } = useWindowDimensions();
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const cashFlowTone: TransactionAmountTone = cashFlow > 0 ? 'positive' : cashFlow < 0 ? 'risk' : 'neutral';
  const reflow = width < 390 || fontScale >= dynamicType.metricReflowFontScale;
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={`Resumo realizado. Resultado ${formatMoney(cashFlow)}. Receitas ${formatMoney(income)}. Despesas ${formatMoney(expense)}.`}
      style={[styles.summary, reflow && styles.summaryReflow]}
    >
      <View style={styles.summaryPrimary}>
        <Text style={styles.metricLabel}>Resultado realizado</Text>
        <Text
          maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier}
          style={[styles.summaryValue, { color: toneColor(tokens, cashFlowTone) }]}
        >
          {formatMoney(cashFlow)}
        </Text>
      </View>
      <View style={styles.summaryMetric}>
        <Text style={styles.metricLabel}>Receitas</Text>
        <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={[styles.metricValue, styles.positive]}>
          {formatMoney(income)}
        </Text>
      </View>
      <View style={styles.summaryMetric}>
        <Text style={styles.metricLabel}>Despesas</Text>
        <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={[styles.metricValue, styles.risk]}>
          {formatMoney(expense)}
        </Text>
      </View>
    </View>
  );
}

export function TransactionDateHeader({ title }: { title: string }) {
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View style={styles.dateHeader}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={dynamicType.headingMaxFontSizeMultiplier} style={styles.dateTitle}>{title}</Text>
    </View>
  );
}

export function TransactionListRow({
  item,
  first,
  last,
  onPress,
}: Readonly<{
  item: TransactionListItem;
  first: boolean;
  last: boolean;
  onPress(): void;
}>) {
  const { fontScale, width } = useWindowDimensions();
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const reflow = width < 390 || fontScale >= dynamicType.metricReflowFontScale;
  const meta = [item.typeLabel, item.categoryLabel].filter(Boolean).join(' • ');
  const origin = [item.originLabel, item.installmentLabel].filter(Boolean).join(' • ');
  const amount = formatMoney(item.amount);
  const iconColor = toneColor(tokens, item.amountTone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.dateLabel, item.title, amount, meta, origin, item.statusLabel].filter(Boolean).join('. ')}
      accessibilityHint="Abre os detalhes deste lançamento."
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first && styles.rowFirst,
        last && styles.rowLast,
        reflow && styles.rowReflow,
        pressed && styles.rowPressed,
      ]}
    >
      <View accessibilityElementsHidden style={[styles.rowIcon, { borderColor: iconColor }]}>
        <AppIcon name={itemIcon(item)} size={primitives.size.icon.sm} color={iconColor} />
      </View>
      <View style={styles.rowCopy}>
        <Text maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier} style={styles.rowTitle}>{item.title}</Text>
        <Text maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier} style={styles.rowMeta}>{meta}</Text>
        {origin ? <Text maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier} style={styles.rowOrigin}>{origin}</Text> : null}
      </View>
      <View style={[styles.rowTrailing, reflow && styles.rowTrailingReflow]}>
        <Text
          maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier}
          style={[styles.rowAmount, { color: iconColor }, reflow && styles.rowAmountReflow]}
        >
          {amount}
        </Text>
        <Text style={[styles.rowStatus, styles[`status_${item.statusTone}`]]}>{item.statusLabel}</Text>
      </View>
    </Pressable>
  );
}

export function TransactionDetailSheet({
  item,
  onClose,
}: Readonly<{
  item: TransactionListItem | null;
  onClose(): void;
}>) {
  const { height } = useWindowDimensions();
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const amountColor = item ? toneColor(tokens, item.amountTone) : tokens.text.primary;
  return (
    <BottomSheet visible={Boolean(item)} title="Detalhe do lançamento" onClose={onClose}>
      {item ? (
        <ScrollView
          style={{ maxHeight: height * 0.68 }}
          contentContainerStyle={styles.detailContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            accessible
            accessibilityLabel={`${item.title}. ${formatMoney(item.amount)}. ${item.statusLabel}.`}
            style={styles.detailSummary}
          >
            <Text maxFontSizeMultiplier={dynamicType.headingMaxFontSizeMultiplier} style={styles.detailTitle}>{item.title}</Text>
            <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={[styles.detailAmount, { color: amountColor }]}>{formatMoney(item.amount)}</Text>
            <StatusPill label={item.statusLabel} tone={item.statusTone} />
          </View>
          <Divider />
          <Text accessibilityRole="header" style={styles.detailSectionTitle}>Composição</Text>
          <View style={styles.detailFields}>
            {item.detailComposition.map((field, index) => (
              <View key={`${field.label}:${index}`}>
                {index ? <Divider /> : null}
                <View accessible accessibilityLabel={`${field.label}. ${field.value}.`} style={styles.detailField}>
                  <Text style={styles.detailLabel}>{field.label}</Text>
                  <Text maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier} style={styles.detailValue}>{field.value}</Text>
                </View>
              </View>
            ))}
          </View>
          {item.detailOrigin.length ? (
            <>
              <Text accessibilityRole="header" style={styles.detailSectionTitle}>Origem</Text>
              <View style={styles.detailFields}>
                {item.detailOrigin.map((field, index) => (
                  <View key={`${field.label}:${index}`}>
                    {index ? <Divider /> : null}
                    <View accessible accessibilityLabel={`${field.label}. ${field.value}.`} style={styles.detailField}>
                      <Text style={styles.detailLabel}>{field.label}</Text>
                      <Text maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier} style={styles.detailValue}>{field.value}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    summary: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border.default },
    summaryReflow: { flexDirection: 'column', gap: spacing.sm },
    summaryPrimary: { flexGrow: 2, flexShrink: 1, minWidth: 132, gap: spacing.xxs },
    summaryMetric: { flexGrow: 1, flexShrink: 1, minWidth: 92, gap: spacing.xxs },
    metricLabel: { ...textStyles.caption, color: tokens.text.secondary },
    summaryValue: { ...textStyles.moneyL },
    metricValue: { ...textStyles.moneyM },
    positive: { color: tokens.status.positiveText },
    risk: { color: tokens.status.riskText },
    dateHeader: { paddingTop: spacing.md, paddingBottom: spacing.xs, backgroundColor: tokens.background.canvas },
    dateTitle: { ...textStyles.bodySmall, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiSemiBold },
    row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border.default, backgroundColor: tokens.background.surface },
    rowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: primitives.radius.lg, borderTopRightRadius: primitives.radius.lg },
    rowLast: { borderBottomLeftRadius: primitives.radius.lg, borderBottomRightRadius: primitives.radius.lg },
    rowReflow: { flexWrap: 'wrap', alignItems: 'flex-start' },
    rowPressed: { opacity: primitives.opacity.pressed, backgroundColor: tokens.background.surfaceMuted },
    rowIcon: { width: primitives.size.touch.minimum, height: primitives.size.touch.minimum, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: primitives.radius.pill, borderWidth: StyleSheet.hairlineWidth, backgroundColor: tokens.background.surfaceMuted },
    rowCopy: { flex: 1, minWidth: 132, gap: spacing.xxs },
    rowTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiSemiBold },
    rowMeta: { ...textStyles.caption, color: tokens.text.secondary },
    rowOrigin: { ...textStyles.caption, color: tokens.text.secondaryOnMuted },
    rowTrailing: { minWidth: 112, flexShrink: 1, alignItems: 'flex-end', gap: spacing.xxs },
    rowTrailingReflow: { width: '100%', paddingLeft: primitives.size.touch.minimum + spacing.sm, alignItems: 'flex-start' },
    rowAmount: { ...textStyles.moneyM, textAlign: 'right' },
    rowAmountReflow: { textAlign: 'left' },
    rowStatus: { ...textStyles.caption, textAlign: 'right' },
    status_neutral: { color: tokens.text.secondary },
    status_positive: { color: tokens.status.positiveText },
    status_warning: { color: tokens.status.warning },
    status_negative: { color: tokens.status.riskText },
    status_gold: { color: tokens.action.text },
    detailContent: { gap: spacing.md, paddingBottom: spacing.md },
    detailSummary: { gap: spacing.xs },
    detailTitle: { ...textStyles.section, color: tokens.text.primary },
    detailAmount: { ...textStyles.moneyL },
    detailSectionTitle: { ...textStyles.bodySmall, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiSemiBold },
    detailFields: { gap: primitives.space.none },
    detailField: { gap: spacing.xs, paddingVertical: spacing.sm },
    detailLabel: { ...textStyles.caption, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiSemiBold },
    detailValue: { ...textStyles.body, color: tokens.text.primary },
  });
}
