import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Card } from '../../design-system/components';
import { AppIcon, type AppIconName } from '../../design-system/icons';
import { useReducedMotion } from '../../design-system/system';
import { useAvioraTheme } from '../../design-system/theme-provider';
import {
  breakpoints,
  dynamicType,
  primitives,
  spacing,
  textStyles,
  type ThemeTokens,
} from '../../design-system/tokens';
import { formatDate, formatMoney } from '../../lib/format';
import { financialValuePresentation, UNAVAILABLE_FINANCIAL_VALUE } from './dashboard-contract';
import type { DashboardActivityItem } from './dashboard-read-model';

type DashboardActivityProps = Readonly<{
  scheduled: readonly DashboardActivityItem[];
  recent: readonly DashboardActivityItem[];
  valuesVisible: boolean;
  onViewAll(): void;
}>;

type ActivityRowProps = Readonly<{
  item: DashboardActivityItem;
  valuesVisible: boolean;
  isLast: boolean;
  reflow: boolean;
  styles: ReturnType<typeof createStyles>;
  tokens: ThemeTokens;
}>;

function transactionTone(item: DashboardActivityItem, tokens: ThemeTokens): string {
  if (item.tone === 'positive') return tokens.status.positiveText;
  if (item.tone === 'risk') return tokens.status.riskText;
  return tokens.text.primary;
}

function transactionIcon(item: DashboardActivityItem): AppIconName {
  if (item.tone === 'positive') return 'trend-up';
  if (item.tone === 'risk') return 'trend-down';
  return 'transactions';
}

function DashboardActivityRow({
  item,
  valuesVisible,
  isLast,
  reflow,
  styles,
  tokens,
}: ActivityRowProps) {
  const amount = item.amount === null
    ? financialValuePresentation(null, valuesVisible, UNAVAILABLE_FINANCIAL_VALUE)
    : financialValuePresentation(formatMoney(item.amount), valuesVisible);
  const tone = transactionTone(item, tokens);

  return (
    <View
      accessible
      accessibilityLabel={`${item.description}. ${item.typeLabel}. ${formatDate(item.financialDate)}. ${item.statusLabel}. ${amount.accessibilityLabel}.`}
      style={[styles.row, reflow && styles.rowReflow, !isLast && styles.rowDivider]}
    >
      <View accessibilityElementsHidden style={[styles.rowGlyph, { borderColor: tone }]}>
        <AppIcon
          name={transactionIcon(item)}
          size={primitives.size.icon.xs}
          color={tone}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{item.description}</Text>
        <Text style={styles.rowMeta}>{item.typeLabel} • {formatDate(item.financialDate)} • {item.statusLabel}</Text>
      </View>
      <Text
        maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier}
        style={[styles.rowAmount, reflow && styles.rowAmountReflow, { color: tone }]}
      >
        {amount.text}
      </Text>
    </View>
  );
}

export function DashboardActivity({
  scheduled,
  recent,
  valuesVisible,
  onViewAll,
}: DashboardActivityProps) {
  const { width, fontScale } = useWindowDimensions();
  const { tokens } = useAvioraTheme();
  const reducedMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const columns = width >= breakpoints.mediumMin && fontScale < dynamicType.metricReflowFontScale;
  const rowReflow = fontScale >= dynamicType.metricReflowFontScale || width < 380;
  const visibleScheduled = scheduled.slice(0, 2);
  const visibleRecent = recent.slice(0, 3);

  return (
    <View style={[styles.grid, columns && styles.gridColumns]}>
      <Card tone="raised" style={[styles.card, columns && styles.cardColumn]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderCopy}>
            <Text accessibilityRole="header" style={styles.cardTitle}>Programados do período</Text>
            <Text style={styles.cardSubtitle}>
              {scheduled.length} {scheduled.length === 1 ? 'item previsto' : 'itens previstos'}
            </Text>
          </View>
          <View accessibilityElementsHidden style={styles.headerIcon}>
            <AppIcon name="calendar" size={primitives.size.icon.sm} color={tokens.status.warning} />
          </View>
        </View>
        {visibleScheduled.length ? visibleScheduled.map((item, index) => (
          <DashboardActivityRow
            key={item.id}
            item={item}
            valuesVisible={valuesVisible}
            isLast={index === visibleScheduled.length - 1}
            reflow={rowReflow}
            styles={styles}
            tokens={tokens}
          />
        )) : (
          <View accessibilityLiveRegion="polite" style={styles.empty}>
            <Text style={styles.emptyTitle}>Nenhum lançamento programado</Text>
            <Text style={styles.emptyText}>Não há itens programados neste período.</Text>
          </View>
        )}
      </Card>

      <Card tone="raised" style={[styles.card, columns && styles.cardColumn]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderCopy}>
            <Text accessibilityRole="header" style={styles.cardTitle}>Movimentos recentes</Text>
            <Text style={styles.cardSubtitle}>Últimos lançamentos do período</Text>
          </View>
          <View accessibilityElementsHidden style={styles.headerIcon}>
            <AppIcon name="transactions" size={primitives.size.icon.sm} color={tokens.status.info} />
          </View>
        </View>
        {visibleRecent.length ? visibleRecent.map((item, index) => (
          <DashboardActivityRow
            key={item.id}
            item={item}
            valuesVisible={valuesVisible}
            isLast={index === visibleRecent.length - 1}
            reflow={rowReflow}
            styles={styles}
            tokens={tokens}
          />
        )) : (
          <View accessibilityLiveRegion="polite" style={styles.empty}>
            <Text style={styles.emptyTitle}>Nenhum lançamento recente</Text>
            <Text style={styles.emptyText}>Os movimentos oficiais aparecerão aqui.</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ver todos os lançamentos deste período"
          onPress={onViewAll}
          style={({ pressed }) => [
            styles.viewAll,
            pressed && (reducedMotion ? styles.pressedReduced : styles.pressed),
          ]}
        >
          <Text style={styles.viewAllText}>Ver todos</Text>
          <AppIcon name="chevron-right" size={primitives.size.icon.xs} color={tokens.action.text} />
        </Pressable>
      </Card>
    </View>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    grid: { gap: spacing.sm },
    gridColumns: { flexDirection: 'row', alignItems: 'stretch' },
    card: { gap: spacing.sm, padding: spacing.lg },
    cardColumn: { minWidth: 0, flex: 1 },
    cardHeader: { minHeight: primitives.size.touch.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    cardHeaderCopy: { minWidth: 0, flex: 1, gap: spacing.xxs },
    cardTitle: { ...textStyles.section, color: tokens.text.primary },
    cardSubtitle: { ...textStyles.bodySmall, color: tokens.text.secondary },
    headerIcon: { width: primitives.size.touch.minimum, height: primitives.size.touch.minimum, alignItems: 'center', justifyContent: 'center', borderRadius: primitives.radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border.default, backgroundColor: tokens.background.surfaceMuted },
    row: { minHeight: primitives.size.touch.default, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
    rowReflow: { alignItems: 'flex-start' },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.border.default },
    rowGlyph: { width: primitives.size.touch.minimum, height: primitives.size.touch.minimum, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: primitives.radius.pill, borderWidth: StyleSheet.hairlineWidth, backgroundColor: tokens.background.surfaceMuted },
    rowCopy: { minWidth: primitives.size.touch.comfortable * 2 + spacing.lg, flex: 1, gap: spacing.xxs },
    rowTitle: { ...textStyles.bodySmall, color: tokens.text.primary, fontFamily: primitives.typography.family.uiSemiBold },
    rowMeta: { ...textStyles.caption, color: tokens.text.secondary },
    rowAmount: { ...textStyles.moneyM, maxWidth: '100%', flexShrink: 1, textAlign: 'right' },
    rowAmountReflow: { width: '100%', paddingLeft: primitives.size.touch.minimum + spacing.sm, textAlign: 'left' },
    empty: { minHeight: 92, justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
    emptyTitle: { ...textStyles.body, color: tokens.text.primary },
    emptyText: { ...textStyles.bodySmall, color: tokens.text.secondary },
    viewAll: { minHeight: primitives.size.touch.minimum, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: 'auto', paddingHorizontal: spacing.sm, borderRadius: primitives.radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border.default, backgroundColor: tokens.background.surfaceMuted },
    viewAllText: { ...textStyles.buttonLabel, color: tokens.action.text },
    pressed: { opacity: primitives.opacity.pressed, transform: [{ scale: primitives.motion.pressedScale }] },
    pressedReduced: { opacity: primitives.opacity.pressed },
  });
}
