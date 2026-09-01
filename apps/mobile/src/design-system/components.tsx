import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  type KeyboardTypeOptions,
  Modal,
  Platform,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  forwardRef,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from 'react';

import { AppIcon, type AppIconName } from './icons';
import { useResponsiveLayout } from './responsive';
import { useReducedMotion } from './system';
import { useAvioraTheme } from './theme-provider';
import {
  componentTokens,
  dynamicType,
  primitives,
  spacing,
  textStyles,
  themeTokens,
} from './tokens';

export type ScreenVariant = 'tab' | 'stack' | 'modal' | 'auth';

type ScreenProps = PropsWithChildren<{
  variant?: ScreenVariant;
  scroll?: boolean;
  keyboardAware?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  edgeToEdgeTop?: boolean;
  testID?: string;
}>;

export function Screen({
  children,
  variant = 'tab',
  scroll = true,
  keyboardAware = variant === 'auth' || variant === 'modal',
  refreshControl,
  contentStyle,
  edgeToEdgeTop = false,
  testID,
}: ScreenProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const shellClearance = variant === 'tab'
    ? componentTokens.quickAction.contentClearance
    : primitives.space.none;
  const bottomPadding = componentTokens.screen.bottomPadding + shellClearance + insets.bottom;
  const containerStyle = [
    styles.screenContent,
    {
      paddingHorizontal: layout.horizontalPadding,
      paddingBottom: bottomPadding,
      maxWidth: layout.contentMaxWidth,
    },
    variant === 'tab' && styles.tabContent,
    variant === 'auth' && styles.authContent,
    contentStyle,
  ];
  const content = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={containerStyle}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
      contentInsetAdjustmentBehavior="never"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[containerStyle, styles.flex]}>{children}</View>
  );

  return (
    <SafeAreaView testID={testID} style={styles.safe} edges={edgeToEdgeTop ? ['left', 'right'] : ['top', 'left', 'right']}>
      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={variant === 'modal' ? insets.top : primitives.space.none}
        >
          {content}
        </KeyboardAvoidingView>
      ) : content}
    </SafeAreaView>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const styles = useStyles();
  const { tokens } = useAvioraTheme();
  const crestSize = compact ? componentTokens.brand.crestCompact : componentTokens.brand.crest;
  return (
    <View accessibilityLabel="AVIORA Gestão Financeira" style={[styles.brand, compact && styles.brandCompact]}>
      <LinearGradient
        colors={[tokens.brand.accent, primitives.color.gold[700]]}
        style={[styles.brandCrest, { width: crestSize, height: crestSize, borderRadius: crestSize / 2 }]}
      >
        <View style={styles.brandInner}>
          <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={[styles.brandLetter, compact && styles.brandLetterCompact]}>A</Text>
        </View>
      </LinearGradient>
      {!compact ? (
        <View style={styles.brandCopy}>
          <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={styles.brandName}>AVIORA</Text>
          <Text style={styles.brandSubtitle}>GESTÃO FINANCEIRA</Text>
        </View>
      ) : null}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = Readonly<{
  label: string;
  onPress(): void | Promise<void>;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: AppIconName;
  accessibilityHint?: string;
}>;

export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  accessibilityHint,
}: ButtonProps) {
  const styles = useStyles();
  const { tokens } = useAvioraTheme();
  const reducedMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const blocked = disabled || loading;
  const press = async () => {
    if (blocked) return;
    await Haptics.selectionAsync().catch(() => undefined);
    await onPress();
  };
  const foreground = variant === 'primary' ? tokens.action.onPrimary : variant === 'danger' ? tokens.status.riskText : variant === 'ghost' ? tokens.action.text : tokens.text.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => { void press(); }}
      style={({ pressed }) => [styles.button, styles[`button_${variant}`], focused && styles.controlFocused, pressed && !blocked && (reducedMotion ? styles.buttonPressedReduced : styles.buttonPressed), blocked && styles.buttonDisabled]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.buttonContent}>
          {icon ? <AppIcon name={icon} size={primitives.size.icon.sm} color={foreground} /> : null}
          <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

type IconButtonProps = Readonly<{
  icon: AppIconName;
  label: string;
  onPress(): void | Promise<void>;
  variant?: 'default' | 'ghost' | 'danger';
  disabled?: boolean;
}>;

export function IconButton({ icon, label, onPress, variant = 'default', disabled = false }: IconButtonProps) {
  const styles = useStyles();
  const { tokens } = useAvioraTheme();
  const reducedMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={() => { void onPress(); }}
      hitSlop={spacing.xxs}
      style={({ pressed }) => [styles.iconButton, styles[`iconButton_${variant}`], focused && styles.controlFocused, pressed && !disabled && (reducedMotion ? styles.buttonPressedReduced : styles.buttonPressed), disabled && styles.buttonDisabled]}
    >
      <AppIcon name={icon} color={variant === 'danger' ? tokens.status.riskText : tokens.text.secondary} />
    </Pressable>
  );
}

type FieldProps = TextInputProps & Readonly<{
  label: string;
  helper?: string;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
}>;

export const TextField = forwardRef<TextInput, FieldProps>(function TextField({ label, helper, error, onBlur, onFocus, ...inputProps }, ref) {
  const styles = useStyles();
  const { tokens } = useAvioraTheme();
  const [focused, setFocused] = useState(false);
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <View style={styles.field}>
      <Text nativeID={`${id}-label`} style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={error || helper}
        aria-describedby={error || helper ? descriptionId : undefined}
        aria-invalid={Boolean(error)}
        allowFontScaling={dynamicType.enabled}
        maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        placeholderTextColor={tokens.text.secondary}
        selectionColor={tokens.action.text}
        style={[styles.input, inputProps.multiline && styles.inputMultiline, Boolean(error) && styles.inputError, inputProps.style, focused && styles.controlFocused]}
      />
      {error || helper ? (
        <Text
          nativeID={descriptionId}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
          style={[styles.fieldHelp, Boolean(error) && styles.fieldHelpError]}
        >
          {error || helper}
        </Text>
      ) : null}
    </View>
  );
});

type SearchFieldProps = Omit<FieldProps, 'label'> & Readonly<{ label?: string }>;

export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField({ label = 'Buscar', onBlur, onFocus, ...inputProps }, ref) {
  const styles = useStyles();
  const { tokens } = useAvioraTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.searchField}>
      <AppIcon name="search" size={primitives.size.icon.sm} color={tokens.text.secondary} />
      <TextInput
        {...inputProps}
        ref={ref}
        accessibilityLabel={label}
        allowFontScaling={dynamicType.enabled}
        maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        placeholderTextColor={tokens.text.secondary}
        selectionColor={tokens.action.text}
        style={[styles.searchInput, inputProps.style]}
      />
      {focused ? <View accessibilityElementsHidden pointerEvents="none" style={styles.searchFocusRing} /> : null}
    </View>
  );
});

type CardProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'raised';
  accessibilityLabel?: string;
}>;

export function Card({ children, style, tone = 'default', accessibilityLabel }: CardProps) {
  const styles = useStyles();
  return <View accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel} style={[styles.card, tone === 'raised' && styles.cardRaised, style]}>{children}</View>;
}

export function MetricCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  const styles = useStyles();
  return (
    <Card style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} style={styles.metricValue}>{value}</Text>
      {helper ? <Text style={styles.metricHelper}>{helper}</Text> : null}
    </Card>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.pageHeader}>
      {eyebrow ? <Text maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier} style={styles.eyebrow}>{eyebrow}</Text> : null}
      <View style={styles.pageTitleRow}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={dynamicType.headingMaxFontSizeMultiplier} style={styles.pageTitle}>{title}</Text>
        {action}
      </View>
      {description ? <Text maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier} style={styles.pageDescription}>{description}</Text> : null}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={dynamicType.headingMaxFontSizeMultiplier} style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export type StatusTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'gold' | 'info';

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  const styles = useStyles();
  return (
    <View accessibilityLabel={`${label}, estado`} style={[styles.pill, styles[`pill_${tone}`]]}>
      <Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{label}</Text>
    </View>
  );
}

/** @deprecated Use StatusPill in new code. */
export const Pill = StatusPill;

export function FilterChip({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress(): void; disabled?: boolean }) {
  const styles = useStyles();
  const reducedMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={({ pressed }) => [styles.filterChip, selected && styles.filterChipSelected, focused && styles.controlFocused, pressed && !disabled && (reducedMotion ? styles.buttonPressedReduced : styles.buttonPressed), disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

type NoticeTone = 'info' | 'warning' | 'error' | 'success';
const noticeIcon: Readonly<Record<NoticeTone, AppIconName>> = { info: 'info', warning: 'warning', error: 'error', success: 'success' };

export function InlineNotice({ title, message, tone = 'info' }: { title: string; message: string; tone?: NoticeTone }) {
  const styles = useStyles();
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : 'summary'} style={[styles.notice, styles[`notice_${tone}`]]}>
      <AppIcon name={noticeIcon[tone]} size={componentTokens.notice.iconSize} color={styles[`noticeIcon_${tone}`].color} />
      <View style={styles.noticeCopy}>
        <Text style={styles.noticeTitle}>{title}</Text>
        <Text style={styles.noticeMessage}>{message}</Text>
      </View>
    </View>
  );
}

type StateTone = 'empty' | 'error' | 'offline';

export function StateView({ title, message, action, loading = false, tone = 'empty' }: { title: string; message: string; action?: ReactNode; loading?: boolean; tone?: StateTone }) {
  const styles = useStyles();
  const { tokens } = useAvioraTheme();
  const stateIcon: AppIconName = tone === 'error' ? 'error' : tone === 'offline' ? 'warning' : 'info';
  return (
    <View accessibilityLiveRegion="polite" style={styles.stateView}>
      {loading ? <ActivityIndicator size="large" color={tokens.action.text} /> : <AppIcon name={stateIcon} size={primitives.size.icon.xl} color={tokens.action.text} />}
      <Text accessibilityRole="header" maxFontSizeMultiplier={dynamicType.headingMaxFontSizeMultiplier} style={styles.stateTitle}>{title}</Text>
      <Text maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier} style={styles.stateMessage}>{message}</Text>
      {action ? <View style={styles.stateAction}>{action}</View> : null}
    </View>
  );
}

export function ProgressBar({ value, label, showValue = false }: { value: number; label: string; showValue?: boolean }) {
  const styles = useStyles();
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <View style={styles.progressGroup}>
      <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(normalized) }} style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${normalized}%` }]} />
      </View>
      {showValue ? <Text style={styles.progressLabel}>{normalized.toFixed(0)}%</Text> : null}
    </View>
  );
}

type OverlayProps = PropsWithChildren<{ visible: boolean; title: string; onClose(): void; actions?: ReactNode }>;

export function BottomSheet({ visible, title, onClose, actions, children }: OverlayProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar painel" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: componentTokens.sheet.padding + insets.bottom }]}>
          <View style={styles.overlayHeader}>
            <Text accessibilityRole="header" style={styles.overlayTitle}>{title}</Text>
            <IconButton icon="close" label="Fechar" variant="ghost" onPress={onClose} />
          </View>
          <View style={styles.overlayBody}>{children}</View>
          {actions ? <View style={styles.overlayActions}>{actions}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function Dialog({ visible, title, onClose, actions, children }: OverlayProps) {
  const styles = useStyles();
  const reducedMotion = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.overlay, styles.dialogAlignment]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar diálogo" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.dialog}>
          <View style={styles.overlayHeader}>
            <Text accessibilityRole="header" style={styles.overlayTitle}>{title}</Text>
            <IconButton icon="close" label="Fechar" variant="ghost" onPress={onClose} />
          </View>
          <View style={styles.overlayBody}>{children}</View>
          {actions ? <View style={styles.overlayActions}>{actions}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function Divider() {
  const styles = useStyles();
  return <View accessibilityElementsHidden style={styles.divider} />;
}

export const commonStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  positive: { color: themeTokens.dark.status.positiveText },
  negative: { color: themeTokens.dark.status.riskText },
  money: textStyles.moneyM,
});

const borderWidth = primitives.size.border.thin;

function useStyles() {
  const { tokens } = useAvioraTheme();
  return useMemo(() => createStyles(tokens), [tokens]);
}

function createStyles(tokens: import('./tokens').ThemeTokens) {
  const surfaceBorderWidth = tokens.id === 'aviora-light-a' ? borderWidth : StyleSheet.hairlineWidth;
  return StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: tokens.background.canvas },
  screenContent: { width: '100%', alignSelf: 'center', paddingTop: spacing.md, gap: spacing.md },
  tabContent: { paddingTop: spacing.sm, gap: spacing.sm },
  authContent: { justifyContent: 'center' },
  brand: { alignItems: 'center', gap: spacing.sm },
  brandCompact: { gap: spacing.none },
  brandCrest: { padding: componentTokens.brand.crestBorder, ...tokens.elevation.card },
  brandInner: { flex: 1, borderRadius: primitives.radius.pill, backgroundColor: tokens.background.canvas, alignItems: 'center', justifyContent: 'center', borderWidth, borderColor: tokens.brand.accent },
  brandLetter: { color: tokens.action.text, fontFamily: primitives.typography.family.brandBold, fontSize: componentTokens.brand.letter },
  brandLetterCompact: { fontSize: componentTokens.brand.letterCompact },
  brandCopy: { alignItems: 'center', gap: spacing.xxs },
  brandName: { ...textStyles.brand, color: tokens.action.text },
  brandSubtitle: { color: tokens.text.primary, fontFamily: primitives.typography.family.uiSemiBold, fontSize: componentTokens.brand.subtitle, letterSpacing: primitives.typography.letterSpacing.brand },
  button: { minHeight: componentTokens.button.minHeight, borderRadius: componentTokens.button.radius, paddingHorizontal: componentTokens.button.horizontalPadding, alignItems: 'center', justifyContent: 'center', borderWidth },
  button_primary: { backgroundColor: tokens.action.primary, borderColor: tokens.action.text },
  button_secondary: { backgroundColor: tokens.background.surfaceMuted, borderColor: tokens.border.strong },
  button_ghost: { backgroundColor: primitives.color.transparent, borderColor: primitives.color.transparent },
  button_danger: { backgroundColor: tokens.background.surfaceMuted, borderColor: tokens.status.risk },
  buttonPressed: { opacity: primitives.opacity.pressed, transform: [{ scale: primitives.motion.pressedScale }] },
  buttonPressedReduced: { opacity: primitives.opacity.pressed },
  buttonDisabled: { opacity: primitives.opacity.disabled },
  controlFocused: { borderColor: tokens.focus.ring, borderWidth: primitives.size.border.strong },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  buttonText: { ...textStyles.buttonLabel, textAlign: 'center' },
  iconButton: { width: componentTokens.iconButton.size, height: componentTokens.iconButton.size, borderRadius: componentTokens.iconButton.radius, alignItems: 'center', justifyContent: 'center', borderWidth },
  iconButton_default: { backgroundColor: tokens.background.surfaceMuted, borderColor: tokens.border.strong },
  iconButton_ghost: { backgroundColor: primitives.color.transparent, borderColor: primitives.color.transparent },
  iconButton_danger: { backgroundColor: tokens.background.surfaceMuted, borderColor: tokens.status.risk },
  field: { gap: spacing.xs },
  fieldLabel: { ...textStyles.caption, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiSemiBold, letterSpacing: primitives.typography.letterSpacing.label },
  input: { minHeight: componentTokens.input.minHeight, borderRadius: componentTokens.input.radius, borderWidth, borderColor: tokens.border.strong, backgroundColor: tokens.background.surface, color: tokens.text.primary, paddingHorizontal: spacing.md, ...textStyles.body },
  inputMultiline: { minHeight: componentTokens.input.multilineMinHeight, paddingTop: spacing.md, textAlignVertical: 'top' },
  inputError: { borderColor: tokens.status.risk },
  fieldHelp: { ...textStyles.caption, color: tokens.text.secondary },
  fieldHelpError: { color: tokens.status.riskText },
  searchField: { minHeight: componentTokens.input.minHeight, position: 'relative', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: componentTokens.input.radius, borderWidth, borderColor: tokens.border.strong, backgroundColor: tokens.background.surface, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minWidth: spacing.none, color: tokens.text.primary, paddingVertical: spacing.xs, ...textStyles.body },
  searchFocusRing: { position: 'absolute', inset: 0, borderRadius: componentTokens.input.radius, borderWidth: primitives.size.border.strong, borderColor: tokens.focus.ring },
  card: { backgroundColor: tokens.background.surface, borderWidth: surfaceBorderWidth, borderColor: tokens.border.default, borderRadius: componentTokens.card.radius, padding: componentTokens.card.padding, ...tokens.elevation.card },
  cardRaised: { backgroundColor: tokens.background.surfaceMuted, borderColor: tokens.border.default },
  metricCard: { minWidth: componentTokens.card.metricMinWidth, flexGrow: 1, flexBasis: componentTokens.card.metricMinWidth, gap: spacing.xs },
  metricLabel: { ...textStyles.caption, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiSemiBold, letterSpacing: primitives.typography.letterSpacing.label },
  metricValue: { ...textStyles.moneyL, flexShrink: 1, color: tokens.text.primary },
  metricHelper: { ...textStyles.caption, color: tokens.text.secondary },
  pageHeader: { gap: spacing.xxs },
  pageTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  eyebrow: { ...textStyles.caption, color: tokens.action.text, fontFamily: primitives.typography.family.uiSemiBold, letterSpacing: primitives.typography.letterSpacing.eyebrow },
  pageTitle: { ...textStyles.title, flexGrow: 1, flexShrink: 1, flexBasis: 240, color: tokens.text.primary },
  pageDescription: { ...textStyles.bodySmall, color: tokens.text.secondary, maxWidth: componentTokens.screen.readableMaxWidth },
  sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { ...textStyles.section, flexGrow: 1, flexShrink: 1, flexBasis: 200, color: tokens.text.primary },
  pill: { alignSelf: 'flex-start', borderRadius: componentTokens.chip.radius, borderWidth: surfaceBorderWidth, paddingHorizontal: componentTokens.chip.horizontalPadding, paddingVertical: spacing.xxs },
  pill_neutral: { borderColor: tokens.border.strong, backgroundColor: tokens.background.surfaceMuted },
  pill_positive: { borderColor: tokens.status.positive, backgroundColor: tokens.background.surfaceMuted },
  pill_warning: { borderColor: tokens.status.warning, backgroundColor: tokens.background.surfaceMuted },
  pill_negative: { borderColor: tokens.status.risk, backgroundColor: tokens.background.surfaceMuted },
  pill_gold: { borderColor: tokens.action.text, backgroundColor: tokens.background.surfaceMuted },
  pill_info: { borderColor: tokens.status.info, backgroundColor: tokens.background.surfaceMuted },
  pillText: { ...textStyles.caption, fontFamily: primitives.typography.family.uiSemiBold },
  pillText_neutral: { color: tokens.text.secondary }, pillText_positive: { color: tokens.status.positiveText }, pillText_warning: { color: tokens.status.warning }, pillText_negative: { color: tokens.status.riskText }, pillText_gold: { color: tokens.action.text }, pillText_info: { color: tokens.status.info },
  filterChip: { minHeight: componentTokens.chip.minHeight, justifyContent: 'center', borderRadius: componentTokens.chip.radius, borderWidth, borderColor: tokens.border.strong, backgroundColor: tokens.background.surface, paddingHorizontal: componentTokens.chip.horizontalPadding },
  filterChipSelected: { borderColor: tokens.action.text, backgroundColor: tokens.background.surfaceMuted },
  filterChipText: { ...textStyles.bodySmall, color: tokens.text.secondary, fontFamily: primitives.typography.family.uiSemiBold },
  filterChipTextSelected: { color: tokens.text.primary },
  notice: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: componentTokens.notice.radius, borderWidth, padding: componentTokens.notice.padding, gap: spacing.sm },
  notice_info: { borderColor: tokens.status.info, backgroundColor: tokens.background.surfaceMuted }, notice_warning: { borderColor: tokens.status.warning, backgroundColor: tokens.background.surfaceMuted }, notice_error: { borderColor: tokens.status.risk, backgroundColor: tokens.background.surfaceMuted }, notice_success: { borderColor: tokens.status.positive, backgroundColor: tokens.background.surfaceMuted },
  noticeIcon_info: { color: tokens.status.info }, noticeIcon_warning: { color: tokens.status.warning }, noticeIcon_error: { color: tokens.status.riskText }, noticeIcon_success: { color: tokens.status.positiveText },
  noticeCopy: { flex: 1, gap: spacing.xs },
  noticeTitle: { ...textStyles.bodySmall, color: tokens.text.primary, fontFamily: primitives.typography.family.uiSemiBold }, noticeMessage: { ...textStyles.bodySmall, color: tokens.text.secondary },
  stateView: { flex: 1, minHeight: componentTokens.screen.stateMinHeight, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  stateTitle: { ...textStyles.section, color: tokens.text.primary, textAlign: 'center' }, stateMessage: { ...textStyles.body, color: tokens.text.secondary, textAlign: 'center', maxWidth: componentTokens.dialog.maxWidth },
  stateAction: { width: '100%', maxWidth: componentTokens.dialog.maxWidth, gap: spacing.sm },
  progressGroup: { gap: spacing.xs },
  progressTrack: { height: componentTokens.progress.height, borderRadius: componentTokens.progress.radius, backgroundColor: tokens.background.surfaceMuted, overflow: 'hidden' }, progressFill: { height: '100%', borderRadius: componentTokens.progress.radius, backgroundColor: tokens.action.text }, progressLabel: { ...textStyles.caption, color: tokens.text.secondary, textAlign: 'right' }, overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: tokens.overlay },
  dialogAlignment: { justifyContent: 'center', padding: spacing.md },
  sheet: { width: '100%', maxWidth: componentTokens.sheet.maxWidth, alignSelf: 'center', borderTopLeftRadius: componentTokens.sheet.radius, borderTopRightRadius: componentTokens.sheet.radius, borderWidth, borderColor: tokens.border.strong, backgroundColor: tokens.background.surfaceMuted, padding: componentTokens.sheet.padding, gap: spacing.md, ...tokens.elevation.overlay },
  dialog: { width: '100%', maxWidth: componentTokens.dialog.maxWidth, alignSelf: 'center', borderRadius: componentTokens.dialog.radius, borderWidth, borderColor: tokens.border.strong, backgroundColor: tokens.background.surfaceMuted, padding: componentTokens.dialog.padding, gap: spacing.md, ...tokens.elevation.overlay },
  overlayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  overlayTitle: { ...textStyles.section, flex: 1, color: tokens.text.primary },
  overlayBody: { gap: spacing.md },
  overlayActions: { gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: tokens.border.default, width: '100%' },
  });
}
