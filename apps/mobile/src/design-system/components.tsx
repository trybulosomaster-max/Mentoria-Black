import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  type KeyboardTypeOptions,
  Pressable,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PropsWithChildren, ReactElement, ReactNode } from 'react';

import { colors, radius, shadows, spacing, touch, typography } from './tokens';

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export function Screen({ children, scroll = true, refreshControl, contentStyle }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.screenContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, styles.flex, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <View accessibilityLabel="AVIORA Gestão Financeira" style={[styles.brand, compact && styles.brandCompact]}>
      <LinearGradient colors={[colors.goldBright, colors.goldDark]} style={[styles.brandCrest, compact && styles.brandCrestCompact]}>
        <View style={styles.brandInner}>
          <Text style={[styles.brandLetter, compact && styles.brandLetterCompact]}>A</Text>
        </View>
      </LinearGradient>
      {!compact && (
        <View style={styles.brandCopy}>
          <Text style={styles.brandName}>AVIORA</Text>
          <Text style={styles.brandSubtitle}>GESTÃO FINANCEIRA</Text>
        </View>
      )}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = {
  label: string;
  onPress(): void | Promise<void>;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
};

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
}: ButtonProps) {
  const blocked = disabled || loading;
  const press = async () => {
    if (blocked) return;
    await Haptics.selectionAsync().catch(() => undefined);
    await onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={() => { void press(); }}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        pressed && !blocked && styles.buttonPressed,
        blocked && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.background : colors.goldBright} />
      ) : (
        <Text style={[styles.buttonText, styles[`buttonText_${variant}`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  helper?: string;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
};

export function TextField({ label, helper, error, ...inputProps }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={colors.textSubtle}
        selectionColor={colors.gold}
        style={[styles.input, inputProps.multiline && styles.inputMultiline, Boolean(error) && styles.inputError]}
      />
      {Boolean(error || helper) && (
        <Text style={[styles.fieldHelp, Boolean(error) && styles.fieldHelpError]}>{error || helper}</Text>
      )}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function MetricCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <Card style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text adjustsFontSizeToFit numberOfLines={1} style={styles.metricValue}>{value}</Text>
      {helper ? <Text style={styles.metricHelper}>{helper}</Text> : null}
    </Card>
  );
}

export function PageHeader({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return (
    <View style={styles.pageHeader}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>
      {description ? <Text style={styles.pageDescription}>{description}</Text> : null}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'positive' | 'warning' | 'negative' | 'gold' }) {
  return (
    <View style={[styles.pill, styles[`pill_${tone}`]]}>
      <Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{label}</Text>
    </View>
  );
}

export function InlineNotice({ title, message, tone = 'info' }: { title: string; message: string; tone?: 'info' | 'warning' | 'error' }) {
  return (
    <View accessibilityRole="alert" style={[styles.notice, styles[`notice_${tone}`]]}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeMessage}>{message}</Text>
    </View>
  );
}

export function StateView({
  title,
  message,
  action,
  loading = false,
}: {
  title: string;
  message: string;
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <View style={styles.stateView}>
      {loading ? <ActivityIndicator size="large" color={colors.gold} /> : <BrandMark compact />}
      <Text accessibilityRole="header" style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {action ? <View style={styles.stateAction}>{action}</View> : null}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export const commonStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  muted: { color: colors.textMuted },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  screenContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  brand: { alignItems: 'center', gap: spacing.sm },
  brandCompact: { gap: 0 },
  brandCrest: {
    width: 92,
    height: 92,
    borderRadius: 46,
    padding: 2,
    ...shadows.card,
  },
  brandCrestCompact: { width: 54, height: 54, borderRadius: 27 },
  brandInner: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.goldDark,
  },
  brandLetter: { color: colors.goldBright, fontSize: 42, fontWeight: '800', letterSpacing: 1 },
  brandLetterCompact: { fontSize: 25 },
  brandCopy: { alignItems: 'center', gap: spacing.xxs },
  brandName: { color: colors.goldBright, fontSize: 28, fontWeight: '700', letterSpacing: 4 },
  brandSubtitle: { color: colors.text, fontSize: 10, fontWeight: '600', letterSpacing: 3 },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  button_primary: { backgroundColor: colors.gold, borderColor: colors.gold },
  button_secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong },
  button_ghost: { backgroundColor: colors.transparent, borderColor: colors.transparent },
  button_danger: { backgroundColor: '#1A1111', borderColor: '#653737' },
  buttonPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: typography.body, fontWeight: '800', textAlign: 'center' },
  buttonText_primary: { color: colors.background },
  buttonText_secondary: { color: colors.text },
  buttonText_ghost: { color: colors.goldBright },
  buttonText_danger: { color: colors.negative },
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.textMuted, fontSize: typography.caption, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.backgroundElevated,
    color: colors.text,
    paddingHorizontal: spacing.md,
    fontSize: typography.body,
  },
  inputMultiline: { minHeight: 112, paddingTop: spacing.md, textAlignVertical: 'top' },
  inputError: { borderColor: colors.negative },
  fieldHelp: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 16 },
  fieldHelpError: { color: colors.negative },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  metricCard: { minWidth: 158, flexGrow: 1, flexBasis: 158, gap: spacing.xs },
  metricLabel: { color: colors.textMuted, fontSize: typography.caption, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  metricHelper: { color: colors.textSubtle, fontSize: typography.caption, lineHeight: 16 },
  pageHeader: { gap: spacing.xs, marginBottom: spacing.xs },
  eyebrow: { color: colors.goldBright, fontSize: typography.caption, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  pageTitle: { color: colors.text, fontSize: typography.title, lineHeight: 31, fontWeight: '800' },
  pageDescription: { color: colors.textMuted, fontSize: typography.body, lineHeight: typography.lineHeightBody },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: typography.section, fontWeight: '800' },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  pill_neutral: { borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  pill_positive: { borderColor: '#3C5B42', backgroundColor: '#102015' },
  pill_warning: { borderColor: '#5A4927', backgroundColor: '#18150C' },
  pill_negative: { borderColor: '#6A3333', backgroundColor: '#1A1111' },
  pill_gold: { borderColor: colors.goldDark, backgroundColor: '#1A170C' },
  pillText: { fontSize: typography.caption, fontWeight: '700' },
  pillText_neutral: { color: colors.textMuted },
  pillText_positive: { color: colors.positive },
  pillText_warning: { color: colors.warning },
  pillText_negative: { color: colors.negative },
  pillText_gold: { color: colors.goldBright },
  notice: { borderRadius: radius.md, borderWidth: 1, padding: spacing.md, gap: spacing.xs },
  notice_info: { borderColor: '#33445A', backgroundColor: '#0C121A' },
  notice_warning: { borderColor: '#5A4927', backgroundColor: '#18150C' },
  notice_error: { borderColor: '#6A3333', backgroundColor: '#1A1111' },
  noticeTitle: { color: colors.text, fontSize: typography.bodySmall, fontWeight: '800' },
  noticeMessage: { color: colors.textMuted, fontSize: typography.bodySmall, lineHeight: 19 },
  stateView: { flex: 1, minHeight: 420, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  stateTitle: { color: colors.text, fontSize: typography.section, fontWeight: '800', textAlign: 'center' },
  stateMessage: { color: colors.textMuted, fontSize: typography.body, lineHeight: typography.lineHeightBody, textAlign: 'center', maxWidth: 420 },
  stateAction: { width: '100%', maxWidth: 360, gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, width: '100%' },
});
