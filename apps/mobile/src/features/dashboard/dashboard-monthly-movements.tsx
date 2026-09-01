import { useMemo, useState } from 'react';
import {
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { useAvioraTheme } from '../../design-system/theme-provider';
import {
  componentTokens,
  dynamicType,
  primitives,
  spacing,
  textStyles,
  type ThemeTokens,
} from '../../design-system/tokens';
import { formatMoney } from '../../lib/format';
import { HIDDEN_FINANCIAL_VALUE } from './dashboard-contract';
import type { DashboardDailyMovement } from './dashboard-read-model';

type DashboardMonthlyMovementsProps = Readonly<{
  periodLabel: string;
  movements: readonly DashboardDailyMovement[];
  valuesVisible: boolean;
}>;

type PlotPoint = Readonly<{ x: number; y: number; active: boolean }>;

const PLOT_HEIGHT = componentTokens.dashboard.chartHeight;
const PLOT_PADDING = componentTokens.dashboard.chartPadding;

function plotPoints(
  movements: readonly DashboardDailyMovement[],
  field: 'income' | 'expense',
  width: number,
  maximum: number,
): readonly PlotPoint[] {
  const usableWidth = Math.max(0, width - PLOT_PADDING * 2);
  const usableHeight = PLOT_HEIGHT - PLOT_PADDING * 2;
  const divisor = Math.max(1, movements.length - 1);
  return movements.map((movement, index) => ({
    x: PLOT_PADDING + (index / divisor) * usableWidth,
    y: PLOT_PADDING + (1 - movement[field] / maximum) * usableHeight,
    active: movement[field] > 0,
  }));
}

function segmentStyle(
  from: PlotPoint,
  to: PlotPoint,
  color: string,
  thickness: number,
): ViewStyle {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const length = Math.sqrt(deltaX ** 2 + deltaY ** 2);
  const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
  return {
    position: 'absolute',
    left: (from.x + to.x - length) / 2,
    top: (from.y + to.y - thickness) / 2,
    width: length,
    height: thickness,
    borderRadius: primitives.radius.pill,
    backgroundColor: color,
    transform: [{ rotate: `${angle}deg` }],
  };
}

function LineSeries({
  points,
  color,
  shape,
  thickness,
  styles,
}: Readonly<{
  points: readonly PlotPoint[];
  color: string;
  shape: 'circle' | 'square';
  thickness: number;
  styles: ReturnType<typeof createStyles>;
}>) {
  return (
    <>
      {points.slice(0, -1).map((point, index) => (
        <View
          key={`segment-${index}`}
          pointerEvents="none"
          style={segmentStyle(point, points[index + 1]!, color, thickness)}
        />
      ))}
      {points.map((point, index) => point.active ? (
        <View
          key={`point-${index}`}
          pointerEvents="none"
          style={[
            styles.plotPoint,
            shape === 'square' && styles.plotPointSquare,
            { left: point.x - componentTokens.dashboard.chartPointSize / 2, top: point.y - componentTokens.dashboard.chartPointSize / 2, backgroundColor: color },
          ]}
        />
      ) : null)}
    </>
  );
}

export function DashboardMonthlyMovements({
  periodLabel,
  movements,
  valuesVisible,
}: DashboardMonthlyMovementsProps) {
  const { tokens } = useAvioraTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [plotWidth, setPlotWidth] = useState(0);
  const maximum = Math.max(1, ...movements.flatMap((point) => [point.income, point.expense]));
  const incomePoints = plotPoints(movements, 'income', plotWidth, maximum);
  const expensePoints = plotPoints(movements, 'expense', plotWidth, maximum);
  const activeMovements = movements.filter((point) => point.income || point.expense);
  const firstReference = movements[0]?.day ?? null;
  const middleReference = movements.length > 2
    ? movements[Math.floor((movements.length - 1) / 2)]?.day ?? null
    : null;
  const lastReference = movements.length > 1 ? movements[movements.length - 1]?.day ?? null : null;
  const accessibleTemporalReferences = [firstReference, middleReference, lastReference]
    .filter((day): day is number => day !== null)
    .map((day) => `dia ${day}`)
    .join(', ');
  const accessibleEquivalent = valuesVisible
    ? activeMovements.map((point) => `Dia ${point.day}: receitas ${formatMoney(point.income)}; despesas ${formatMoney(point.expense)}`).join('. ')
    : 'Valores do gráfico ocultos';
  const onPlotLayout = (event: LayoutChangeEvent) => {
    setPlotWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>Movimentos do mês</Text>
          <Text style={styles.subtitle}>Receitas e despesas realizadas, dia a dia</Text>
        </View>
        <View accessible accessibilityLabel={`Dados realizados em ${periodLabel}`} style={styles.scope}>
          <Text style={styles.scopeText}>REALIZADO</Text>
        </View>
      </View>

      {!movements.length ? (
        <View accessibilityLiveRegion="polite" style={styles.emptyPlot}>
          <Text style={styles.emptyTitle}>Sem série realizada neste período</Text>
          <Text style={styles.emptyText}>O gráfico aparecerá quando houver receitas ou despesas oficiais.</Text>
        </View>
      ) : !valuesVisible ? (
        <View accessible accessibilityLabel="Valores do gráfico ocultos" style={styles.hiddenPlot}>
          <Text style={styles.hiddenValue}>{HIDDEN_FINANCIAL_VALUE}</Text>
          <Text style={styles.emptyText}>Movimentos ocultos neste dispositivo</Text>
        </View>
      ) : (
        <View style={styles.plotGroup}>
          <View
            accessible
            accessibilityLabel={`Movimentos do mês. Referências temporais: ${accessibleTemporalReferences}. ${accessibleEquivalent}.`}
            accessibilityRole="image"
            onLayout={onPlotLayout}
            style={styles.plot}
          >
            <View pointerEvents="none" style={[styles.gridLine, styles.gridLineTop]} />
            <View pointerEvents="none" style={[styles.gridLine, styles.gridLineMiddle]} />
            <View pointerEvents="none" style={[styles.gridLine, styles.gridLineBottom]} />
            {plotWidth > 0 ? (
              <>
                <LineSeries points={incomePoints} color={tokens.status.positiveText} shape="square" thickness={componentTokens.dashboard.incomeLineWidth} styles={styles} />
                <LineSeries points={expensePoints} color={tokens.status.riskText} shape="circle" thickness={componentTokens.dashboard.expenseLineWidth} styles={styles} />
              </>
            ) : null}
          </View>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={styles.temporalAxis}
          >
            <Text style={[styles.temporalReference, styles.temporalReferenceStart]}>
              {firstReference === null ? '' : `Dia ${firstReference}`}
            </Text>
            <Text style={[styles.temporalReference, styles.temporalReferenceMiddle]}>
              {middleReference === null ? '' : `Dia ${middleReference}`}
            </Text>
            <Text style={[styles.temporalReference, styles.temporalReferenceEnd]}>
              {lastReference === null ? '' : `Dia ${lastReference}`}
            </Text>
          </View>
        </View>
      )}

      <View accessible accessibilityLabel="Legenda. Linha espessa com marcadores quadrados: Receitas. Linha fina com marcadores circulares: Despesas." accessibilityRole="text" style={styles.legend}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.legendItem}>
          <View style={[styles.legendSquare, { backgroundColor: tokens.status.positiveText }]} />
          <Text style={styles.legendText}>Receitas</Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.legendItem}>
          <View style={[styles.legendCircle, { backgroundColor: tokens.status.riskText }]} />
          <Text style={styles.legendText}>Despesas</Text>
        </View>
      </View>
    </View>
  );
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    section: { gap: spacing.xl, overflow: 'hidden', paddingVertical: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.border.default },
    header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
    headerCopy: { minWidth: 0, flex: 1, gap: spacing.xs },
    title: { ...textStyles.section, color: tokens.text.primary },
    subtitle: { ...textStyles.bodySmall, color: tokens.text.secondary },
    scope: { alignItems: 'flex-end', justifyContent: 'center', paddingTop: spacing.xs },
    scopeText: { ...textStyles.caption, color: tokens.action.text, fontFamily: primitives.typography.family.uiSemiBold, letterSpacing: primitives.typography.letterSpacing.label },
    plotGroup: { gap: spacing.xs },
    plot: { position: 'relative', height: PLOT_HEIGHT, overflow: 'hidden' },
    gridLine: { position: 'absolute', right: 0, left: 0, height: StyleSheet.hairlineWidth, backgroundColor: tokens.chart.grid },
    gridLineTop: { top: PLOT_PADDING },
    gridLineMiddle: { top: PLOT_HEIGHT / 2 },
    gridLineBottom: { bottom: PLOT_PADDING },
    plotPoint: { position: 'absolute', width: componentTokens.dashboard.chartPointSize, height: componentTokens.dashboard.chartPointSize, borderRadius: componentTokens.dashboard.chartPointSize / 2 },
    plotPointSquare: { borderRadius: primitives.radius.none },
    emptyPlot: { minHeight: PLOT_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.xl },
    hiddenPlot: { minHeight: PLOT_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
    hiddenValue: { ...textStyles.moneyL, color: tokens.text.primary, letterSpacing: primitives.typography.letterSpacing.label },
    emptyTitle: { ...textStyles.body, color: tokens.text.primary, textAlign: 'center' },
    emptyText: { ...textStyles.bodySmall, color: tokens.text.secondary, textAlign: 'center' },
    temporalAxis: { minHeight: spacing.xl, flexDirection: 'row', alignItems: 'center', paddingHorizontal: PLOT_PADDING },
    temporalReference: { ...textStyles.caption, flex: 1, color: tokens.text.secondary },
    temporalReferenceStart: { textAlign: 'left' },
    temporalReferenceMiddle: { textAlign: 'center' },
    temporalReferenceEnd: { textAlign: 'right' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xl },
    legendItem: { minHeight: spacing.xxl, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    legendSquare: { width: spacing.xs + StyleSheet.hairlineWidth, height: spacing.xs + StyleSheet.hairlineWidth, borderRadius: primitives.radius.none },
    legendCircle: { width: spacing.xs + StyleSheet.hairlineWidth, height: spacing.xs + StyleSheet.hairlineWidth, borderRadius: primitives.radius.pill },
    legendText: { ...textStyles.caption, color: tokens.text.secondary },
  });
}
