import { useEffect, useMemo, useRef } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppIcon } from '../../design-system/icons';
import { useResponsiveLayout } from '../../design-system/responsive';
import { useAvioraTheme } from '../../design-system/theme-provider';
import {
  componentTokens,
  dynamicType,
  primitives,
  spacing,
  textStyles,
  type ThemeTokens,
} from '../../design-system/tokens';
import { useReducedMotion } from '../../design-system/system';
import {
  calendarMonthKey,
  calendarMonthLabel,
  calendarMonthName,
  currentMonthWindow,
  sameCalendarMonth,
  shiftCalendarMonth,
  type CalendarMonth,
} from '../../lib/format';
import {
  INITIAL_MONTH_SNAP_STATE,
  transitionMonthSnap,
  type MonthSnapEvent,
} from './month-selector-snap';

const MONTHS_BEFORE = 18;
const MONTHS_AFTER = 18;

function monthSequence(anchor: CalendarMonth): readonly CalendarMonth[] {
  return Object.freeze(Array.from(
    { length: MONTHS_BEFORE + MONTHS_AFTER + 1 },
    (_, index) => shiftCalendarMonth(anchor, index - MONTHS_BEFORE),
  ));
}

export function MonthSelector({
  period,
  onChange,
  expanded,
  onExpandedChange,
  embedded = false,
}: Readonly<{
  period: CalendarMonth;
  onChange(period: CalendarMonth): void;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
  embedded?: boolean;
}>) {
  const { width } = useWindowDimensions();
  const layout = useResponsiveLayout();
  const { tokens } = useAvioraTheme();
  const reducedMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const anchor = useMemo<CalendarMonth>(() => {
    const current = currentMonthWindow();
    return Object.freeze({ year: current.year, month: current.month });
  }, []);
  const months = useMemo(() => {
    const aroundCurrentMonth = monthSequence(anchor);
    return aroundCurrentMonth.some((item) => sameCalendarMonth(item, period))
      ? aroundCurrentMonth
      : monthSequence(period);
  }, [anchor, period.month, period.year]);
  const selectedIndex = months.findIndex((item) => sameCalendarMonth(item, period));
  const list = useRef<FlatList<CalendarMonth>>(null);
  const snapState = useRef(INITIAL_MONTH_SNAP_STATE);
  const contentWidth = Math.min(width, layout.contentMaxWidth) - (layout.horizontalPadding * 2);
  const availableWidth = Math.max(280, contentWidth);
  const itemWidth = Math.max(128, Math.min(180, availableWidth * 0.38));
  const interval = itemWidth + spacing.xs;
  const sidePadding = Math.max(0, (availableWidth - itemWidth) / 2);

  useEffect(() => {
    if (selectedIndex < 0) return;
    list.current?.scrollToIndex({ index: selectedIndex, animated: !reducedMotion });
  }, [interval, reducedMotion, selectedIndex]);

  useEffect(() => {
    if (!expanded) snapState.current = INITIAL_MONTH_SNAP_STATE;
  }, [expanded]);

  const applySnapEvent = (event: MonthSnapEvent) => {
    const transition = transitionMonthSnap(snapState.current, event);
    snapState.current = transition.state;
    if (transition.commitIndex === null) return;
    const next = months[transition.commitIndex];
    if (next && !sameCalendarMonth(next, period)) onChange(next);
  };

  const move = (offset: number) => {
    const next = shiftCalendarMonth(period, offset);
    if (months.some((item) => sameCalendarMonth(item, next))) {
      snapState.current = INITIAL_MONTH_SNAP_STATE;
      onChange(next);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Período financeiro: ${calendarMonthLabel(period)}`}
        accessibilityHint={expanded ? 'Recolhe a lista de meses.' : 'Expande a lista de meses. Também permite avançar ou voltar pelo ajuste acessível.'}
        accessibilityState={{ expanded }}
        accessibilityActions={[
          { name: 'decrement', label: 'Mês anterior' },
          { name: 'increment', label: 'Próximo mês' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'decrement') move(-1);
          if (event.nativeEvent.actionName === 'increment') move(1);
        }}
        onPress={() => onExpandedChange(!expanded)}
        style={({ pressed }) => [styles.trigger, embedded && styles.triggerEmbedded, pressed && styles.triggerPressed]}
      >
        {!embedded ? <AppIcon name="calendar" size={primitives.size.icon.sm} color={tokens.text.secondary} /> : null}
        <Text accessibilityRole="header" maxFontSizeMultiplier={dynamicType.headingMaxFontSizeMultiplier} style={styles.title}>
          {calendarMonthName(period)} <Text style={styles.titleYear}>{period.year}</Text>
        </Text>
        <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={primitives.size.icon.sm} color={tokens.text.secondary} />
      </Pressable>

      {expanded ? (
        <FlatList
          ref={list}
          horizontal
          data={months}
          keyExtractor={calendarMonthKey}
          initialScrollIndex={Math.max(0, selectedIndex)}
          getItemLayout={(_, index) => ({ length: interval, offset: interval * index, index })}
          contentContainerStyle={{ paddingHorizontal: sidePadding }}
          decelerationRate="fast"
          disableIntervalMomentum
          onScrollBeginDrag={() => {
            applySnapEvent({ type: 'drag-begin' });
          }}
          onScrollEndDrag={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            applySnapEvent({
              type: 'drag-end',
              offset: event.nativeEvent.contentOffset.x,
              targetOffset: event.nativeEvent.targetContentOffset?.x,
              velocityX: event.nativeEvent.velocity?.x,
              interval,
              itemCount: months.length,
            });
          }}
          onMomentumScrollBegin={() => {
            applySnapEvent({ type: 'momentum-begin' });
          }}
          onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            applySnapEvent({
              type: 'momentum-end',
              offset: event.nativeEvent.contentOffset.x,
              interval,
              itemCount: months.length,
            });
          }}
          onScrollToIndexFailed={({ index }) => list.current?.scrollToOffset({ offset: interval * index, animated: false })}
          showsHorizontalScrollIndicator={false}
          snapToAlignment="start"
          snapToInterval={interval}
          renderItem={({ item, index }) => {
            const selected = sameCalendarMonth(item, period);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={calendarMonthLabel(item)}
                accessibilityHint="Seleciona este mês para o panorama. Use o botão do período para recolher a lista."
                accessibilityState={{ selected }}
                onPress={() => {
                  snapState.current = INITIAL_MONTH_SNAP_STATE;
                  list.current?.scrollToIndex({ index, animated: !reducedMotion });
                  if (!sameCalendarMonth(item, period)) onChange(item);
                }}
                style={({ pressed }) => [
                  styles.month,
                  { width: itemWidth, marginRight: spacing.xs },
                  selected && styles.monthSelected,
                  pressed && styles.monthPressed,
                ]}
              >
                <Text maxFontSizeMultiplier={dynamicType.headingMaxFontSizeMultiplier} style={[styles.monthText, selected && styles.monthTextSelected]}>
                  {calendarMonthName(item)}
                </Text>
                <Text style={[styles.yearText, selected && styles.yearTextSelected]}>{item.year}</Text>
              </Pressable>
            );
          }}
        />
      ) : null}
    </View>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { gap: spacing.xs },
    trigger: { minHeight: primitives.size.touch.comfortable, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: primitives.radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border.default, backgroundColor: tokens.background.surface },
    triggerEmbedded: { borderColor: tokens.border.strong, backgroundColor: primitives.color.transparent },
    triggerPressed: { opacity: primitives.opacity.pressed },
    title: { ...textStyles.section, color: tokens.text.primary, textAlign: 'center' },
    titleYear: { ...textStyles.bodySmall, color: tokens.text.secondary },
    month: { minHeight: primitives.size.touch.comfortable, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: primitives.radius.pill, borderWidth: primitives.size.border.thin, borderColor: tokens.action.text, backgroundColor: tokens.action.primary, opacity: componentTokens.periodSelector.inactiveOpacity },
    monthSelected: { zIndex: 1, borderWidth: primitives.size.border.strong, borderColor: tokens.action.onPrimary, backgroundColor: tokens.action.primary, opacity: primitives.opacity.opaque, ...tokens.elevation.card },
    monthPressed: { opacity: primitives.opacity.pressed },
    monthText: { ...textStyles.body, color: tokens.action.onPrimary, fontFamily: primitives.typography.family.uiSemiBold, textAlign: 'center' },
    monthTextSelected: { color: tokens.action.onPrimary, fontFamily: primitives.typography.family.uiSemiBold },
    yearText: { ...textStyles.caption, color: tokens.action.onPrimary },
    yearTextSelected: { color: tokens.action.onPrimary },
  });
}
