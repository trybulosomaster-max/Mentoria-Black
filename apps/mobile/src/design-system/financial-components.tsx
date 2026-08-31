import { type PropsWithChildren, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, ProgressBar, StatusPill, type StatusTone } from './components';
import { AppIcon, type AppIconName } from './icons';
import { useAvioraTheme } from './theme-provider';
import { componentTokens, dynamicType, primitives, spacing, textStyles, type ThemeTokens } from './tokens';

type MetricTone = 'neutral' | 'positive' | 'risk' | 'brand';

export function FinancialMetric({ label, value, helper, tone = 'neutral', emphasized = false }: { label: string; value: string; helper?: string; tone?: MetricTone; emphasized?: boolean }) {
  const styles = useFinancialStyles();
  return (
    <View accessible accessibilityLabel={[label, value, helper].filter(Boolean).join('. ')} style={[styles.metric, emphasized && styles.metricEmphasized]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={[emphasized ? styles.metricValueXL : styles.metricValue, styles[`metricTone_${tone}`]]}>{value}</Text>
      {helper ? <Text style={styles.metricHelper}>{helper}</Text> : null}
    </View>
  );
}

export function MetricGroup({ children }: PropsWithChildren) {
  const styles = useFinancialStyles();
  return <View style={styles.metricGroup}>{children}</View>;
}

export function TransactionRow({ title, meta, amount, status, tone, category }: { title: string; meta: string; amount: string; status: string; tone: StatusTone; category?: string }) {
  const styles = useFinancialStyles();
  const amountTone = amount.trim().startsWith('-') ? styles.amountRisk : styles.amountPositive;
  return (
    <Card accessibilityLabel={`${title}. ${meta}. ${amount}. ${status}`} style={styles.rowCard}>
      <View style={styles.rowTop}>
        <View style={styles.rowCopy}>
          <Text numberOfLines={2} style={styles.rowTitle}>{title}</Text>
          <Text style={styles.rowMeta}>{meta}</Text>
        </View>
        <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={[styles.rowAmount, amountTone]}>{amount}</Text>
      </View>
      <View style={styles.badges}>
        <StatusPill label={status} tone={tone} />
        {category ? <StatusPill label={category} /> : null}
      </View>
    </Card>
  );
}

export function PlanningRow({ label, value, percentage }: { label: string; value: string; percentage: number }) {
  const styles = useFinancialStyles();
  return (
    <View accessible accessibilityLabel={`${label}. ${value}. ${percentage.toFixed(0)} por cento da receita planejada.`} style={styles.planningRow}>
      <View style={styles.rowTop}><Text style={styles.rowTitle}>{label}</Text><Text style={styles.planningValue}>{value}</Text></View>
      <ProgressBar value={percentage} label={`${label} da receita planejada`} />
      <Text style={styles.rowMeta}>{percentage.toFixed(1).replace('.', ',')}% da receita planejada</Text>
    </View>
  );
}

export function AssetRow({ icon = 'wallet', title, subtitle, value, status, statusTone = 'neutral' }: { icon?: AppIconName; title: string; subtitle: string; value: string; status?: string; statusTone?: StatusTone }) {
  const styles = useFinancialStyles();
  const { tokens } = useAvioraTheme();
  return (
    <Card accessibilityLabel={`${title}. ${subtitle}. ${value}${status ? `. ${status}` : ''}`} style={styles.assetCard}>
      <View style={styles.rowTop}>
        <View style={styles.assetIdentity}>
          <View style={styles.assetIcon}><AppIcon name={icon} size={primitives.size.icon.sm} color={tokens.brand.accent} /></View>
          <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowMeta}>{subtitle}</Text></View>
        </View>
        <Text style={styles.assetValue}>{value}</Text>
      </View>
      {status ? <StatusPill label={status} tone={statusTone} /> : null}
    </Card>
  );
}

export function ChartCard({ title, period, summary, hasData = false, children }: PropsWithChildren<{ title: string; period: string; summary: string; hasData?: boolean }>) {
  const styles = useFinancialStyles();
  const { tokens } = useAvioraTheme();
  return (
    <Card accessibilityLabel={`${title}. ${period}. ${summary}`} style={styles.chartCard}>
      <View style={styles.rowTop}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowMeta}>{period}</Text></View><AppIcon name="report" color={tokens.brand.accent} /></View>
      {hasData ? children : (
        <View style={styles.chartEmpty}>
          <View style={styles.chartGuide}><View style={styles.chartActual} /><View style={styles.chartProjected} /></View>
          <Text style={styles.chartEmptyTitle}>Série temporal indisponível</Text>
          <Text style={styles.rowMeta}>{summary}</Text>
        </View>
      )}
    </Card>
  );
}

export function PermissionBadge({ label }: { label: string }) {
  return <StatusPill label={label} tone="info" />;
}

export function ThemeRadioRow({ label, helper, selected, onPress }: { label: string; helper: string; selected: boolean; onPress(): void }) {
  const styles = useFinancialStyles();
  const { tokens } = useAvioraTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={`Aparência: ${label}`} accessibilityHint={helper} accessibilityState={{ checked: selected, selected }} onPress={onPress} style={({ pressed }) => [styles.themeRow, selected && styles.themeRowSelected, pressed && styles.themeRowPressed]}>
      <View style={styles.rowCopy}><Text style={styles.rowTitle}>{label}</Text><Text style={styles.rowMeta}>{helper}</Text></View>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <AppIcon name="success" size={primitives.size.icon.xs} color={tokens.text.inverse} /> : null}</View>
    </Pressable>
  );
}

function useFinancialStyles() {
  const { tokens } = useAvioraTheme();
  return useMemo(() => createStyles(tokens), [tokens]);
}

function createStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    metric: { minWidth: componentTokens.card.metricMinWidth, flexGrow: 1, flexBasis: componentTokens.card.metricMinWidth, gap: spacing.xs, padding: spacing.md, borderWidth: primitives.size.border.thin, borderColor: tokens.border.default, borderRadius: primitives.radius.lg, backgroundColor: tokens.background.surface },
    metricEmphasized: { flexBasis: '100%', minHeight: 132, justifyContent: 'center', padding: spacing.xl, backgroundColor: tokens.background.surfaceMuted, borderColor: tokens.border.strong, ...tokens.elevation.card },
    metricLabel: { ...textStyles.caption, color: tokens.text.secondary, textTransform: 'uppercase', letterSpacing: primitives.typography.letterSpacing.label },
    metricValue: { ...textStyles.moneyL, color: tokens.text.primary }, metricValueXL: { ...textStyles.moneyXL, color: tokens.text.primary }, metricHelper: { ...textStyles.caption, color: tokens.text.secondary },
    metricTone_neutral: { color: tokens.text.primary }, metricTone_positive: { color: tokens.status.positiveText }, metricTone_risk: { color: tokens.status.riskText }, metricTone_brand: { color: tokens.brand.accent },
    metricGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    rowCard: { gap: spacing.sm }, rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm }, rowCopy: { flex: 1, minWidth: 0, gap: spacing.xxs }, rowTitle: { ...textStyles.body, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold }, rowMeta: { ...textStyles.caption, color: tokens.text.secondary }, rowAmount: { ...textStyles.moneyM, textAlign: 'right' }, amountPositive: { color: tokens.status.positiveText }, amountRisk: { color: tokens.status.riskText }, badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    planningRow: { gap: spacing.xs, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.border.default }, planningValue: { ...textStyles.moneyM, color: tokens.text.primary },
    assetCard: { gap: spacing.sm }, assetIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, assetIcon: { width: primitives.size.touch.minimum, height: primitives.size.touch.minimum, borderRadius: primitives.radius.md, backgroundColor: tokens.background.surfaceMuted, alignItems: 'center', justifyContent: 'center' }, assetValue: { ...textStyles.moneyM, color: tokens.text.primary, textAlign: 'right' },
    chartCard: { gap: spacing.md }, chartEmpty: { minHeight: 148, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: primitives.radius.md, backgroundColor: tokens.background.surfaceMuted }, chartGuide: { width: '100%', gap: spacing.xs }, chartActual: { height: primitives.size.border.strong, backgroundColor: tokens.chart.actual }, chartProjected: { height: primitives.size.border.strong, borderTopWidth: primitives.size.border.strong, borderStyle: 'dashed', borderColor: tokens.chart.projected }, chartEmptyTitle: { ...textStyles.bodySmall, color: tokens.text.primary, fontFamily: primitives.typography.family.uiBold },
    themeRow: { minHeight: primitives.size.touch.default, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: primitives.size.border.thin, borderColor: tokens.border.default, borderRadius: primitives.radius.md, backgroundColor: tokens.background.surface }, themeRowSelected: { borderColor: tokens.focus.ring, backgroundColor: tokens.background.surfaceMuted }, themeRowPressed: { opacity: primitives.opacity.pressed }, radio: { width: primitives.size.icon.md, height: primitives.size.icon.md, borderRadius: primitives.radius.pill, borderWidth: primitives.size.border.strong, borderColor: tokens.border.strong, alignItems: 'center', justifyContent: 'center' }, radioSelected: { backgroundColor: tokens.focus.ring, borderColor: tokens.focus.ring },
  });
}
