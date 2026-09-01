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
}: Readonly<{
  period: CalendarMonth;
  onChange(period: CalendarMonth): void;
  expanded: boolean;
  onExpandedChange(expanded: boolean): void;
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
  const userIsDragging = useRef(false);
  const momentumActive = useRef(false);
  const settleFrame = useRef<number | null>(null);
  const contentWidth = Math.min(width, layout.contentMaxWidth) - (layout.horizontalPadding * 2);
  const availableWidth = Math.max(280, contentWidth);
  const itemWidth = Math.max(128, Math.min(180, availableWidth * 0.38));
  const interval = itemWidth + spacing.sm;
  const sidePadding = Math.max(0, (availableWidth - itemWidth) / 2);

  useEffect(() => {
    if (selectedIndex < 0) return;
    list.current?.scrollToIndex({ index: selectedIndex, animated: !reducedMotion });
  }, [interval, reducedMotion, selectedIndex]);

  useEffect(() => () => {
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
  }, []);

  const selectFromOffset = (offset: number) => {
    if (!userIsDragging.current) return;
    userIsDragging.current = false;
    const index = Math.max(0, Math.min(months.length - 1, Math.round(offset / interval)));
    const next = months[index];
    if (next && !sameCalendarMonth(next, period)) onChange(next);
  };

  const finishDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.x;
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
    settleFrame.current = requestAnimationFrame(() => {
      settleFrame.current = null;
      if (!momentumActive.current) selectFromOffset(offset);
    });
  };

  const finishMomentum = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    momentumActive.current = false;
    if (settleFrame.current !== null) {
      cancelAnimationFrame(settleFrame.current);
      settleFrame.current = null;
    }
    selectFromOffset(event.nativeEvent.contentOffset.x);
  };

  const move = (offset: number) => {
    const next = shiftCalendarMonth(period, offset);
    if (months.some((item) => sameCalendarMonth(item, next))) onChange(next);
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
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      >
        <AppIcon name="calendar" size={primitives.size.icon.sm} color={tokens.text.secondary} />
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
            userIsDragging.current = true;
            momentumActive.current = false;
            if (settleFrame.current !== null) {
              cancelAnimationFrame(settleFrame.current);
              settleFrame.current = null;
            }
          }}
          onScrollEndDrag={finishDrag}
          onMomentumScrollBegin={() => {
            momentumActive.current = true;
            if (settleFrame.current !== null) {
              cancelAnimationFrame(settleFrame.current);
              settleFrame.current = null;
            }
          }}
          onMomentumScrollEnd={finishMomentum}
          onScrollToIndexFailed={({ index }) => list.current?.scrollToOffset({ offset: interval * index, animated: false })}
          showsHorizontalScrollIndicator={false}
          snapToAlignment="start"
          snapToInterval={interval}
          renderItem={({ item }) => {
            const selected = sameCalendarMonth(item, period);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={calendarMonthLabel(item)}
                accessibilityHint="Seleciona este mês para o panorama. Use o botão do período para recolher a lista."
                accessibilityState={{ selected }}
                onPress={() => onChange(item)}
                style={({ pressed }) => [
                  styles.month,
                  { width: itemWidth, marginRight: spacing.sm },
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
    container: { gap: spacing.sm },
    trigger: { minHeight: primitives.size.touch.comfortable, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: primitives.radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border.default, backgroundColor: tokens.background.surface },
    triggerPressed: { opacity: primitives.opacity.pressed },
    title: { ...textStyles.section, color: tokens.text.primary, textAlign: 'center' },
    titleYear: { ...textStyles.bodySmall, color: tokens.text.secondary },
    month: { minHeight: primitives.size.touch.comfortable, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: primitives.radius.pill, borderWidth: primitives.size.border.thin, borderColor: tokens.border.default, backgroundColor: tokens.background.surface },
    monthSelected: { borderWidth: primitives.size.border.strong, borderColor: tokens.action.primary, backgroundColor: tokens.background.surfaceMuted },
    monthPressed: { opacity: primitives.opacity.pressed },
    monthText: { ...textStyles.body, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiSemiBold, textAlign: 'center' },
    monthTextSelected: { color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold },
    yearText: { ...textStyles.caption, color: tokens.text.secondary },
    yearTextSelected: { color: tokens.action.text },
  });
}
