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
} from 'react';

import { AppIcon, type AppIconName } from './icons';
import { useResponsiveLayout } from './responsive';
import { useReducedMotion } from './system';
import {
  colors,
  componentTokens,
  dynamicType,
  primitives,
  semantic,
  shadows,
  spacing,
  textStyles,
} from './tokens';

export type ScreenVariant = 'tab' | 'stack' | 'modal' | 'auth';

type ScreenProps = PropsWithChildren<{
  variant?: ScreenVariant;
  scroll?: boolean;
  keyboardAware?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function Screen({
  children,
  variant = 'tab',
  scroll = true,
  keyboardAware = variant === 'auth' || variant === 'modal',
  refreshControl,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const bottomPadding = componentTokens.screen.bottomPadding + insets.bottom;
  const containerStyle = [
    styles.screenContent,
    {
      paddingHorizontal: layout.horizontalPadding,
      paddingBottom: bottomPadding,
      maxWidth: layout.contentMaxWidth,
    },
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
    <SafeAreaView testID={testID} style={styles.safe} edges={['top', 'left', 'right']}>
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
  const crestSize = compact ? componentTokens.brand.crestCompact : componentTokens.brand.crest;
  return (
    <View accessibilityLabel="AVIORA Gestão Financeira" style={[styles.brand, compact && styles.brandCompact]}>
      <LinearGradient
        colors={[semantic.text.accent, semantic.action.primaryPressed]}
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
  const blocked = disabled || loading;
  const press = async () => {
    if (blocked) return;
    await Haptics.selectionAsync().catch(() => undefined);
    await onPress();
  };
  const foreground = variant === 'primary' ? semantic.text.inverse : variant === 'danger' ? semantic.status.negative : variant === 'ghost' ? semantic.text.accent : semantic.text.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={() => { void press(); }}
      style={({ pressed }) => [styles.button, styles[`button_${variant}`], pressed && !blocked && styles.buttonPressed, blocked && styles.buttonDisabled]}
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => { void onPress(); }}
      hitSlop={spacing.xxs}
      style={({ pressed }) => [styles.iconButton, styles[`iconButton_${variant}`], pressed && !disabled && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      <AppIcon name={icon} color={variant === 'danger' ? semantic.status.negative : semantic.text.secondary} />
    </Pressable>
  );
}

type FieldProps = TextInputProps & Readonly<{
  label: string;
  helper?: string;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
}>;

export const TextField = forwardRef<TextInput, FieldProps>(function TextField({ label, helper, error, ...inputProps }, ref) {
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
        placeholderTextColor={semantic.text.subtle}
        selectionColor={semantic.action.primary}
        style={[styles.input, inputProps.multiline && styles.inputMultiline, Boolean(error) && styles.inputError, inputProps.style]}
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

export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField({ label = 'Buscar', ...inputProps }, ref) {
  return (
    <View style={styles.searchField}>
      <AppIcon name="search" size={primitives.size.icon.sm} color={semantic.text.subtle} />
      <TextInput
        {...inputProps}
        ref={ref}
        accessibilityLabel={label}
        allowFontScaling={dynamicType.enabled}
        maxFontSizeMultiplier={dynamicType.maxFontSizeMultiplier}
        placeholderTextColor={semantic.text.subtle}
        selectionColor={semantic.action.primary}
        style={[styles.searchInput, inputProps.style]}
      />
    </View>
  );
});

type CardProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'raised';
  accessibilityLabel?: string;
}>;

export function Card({ children, style, tone = 'default', accessibilityLabel }: CardProps) {
  return <View accessibilityLabel={accessibilityLabel} style={[styles.card, tone === 'raised' && styles.cardRaised, style]}>{children}</View>;
}

export function MetricCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <Card style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text adjustsFontSizeToFit maxFontSizeMultiplier={dynamicType.moneyMaxFontSizeMultiplier} numberOfLines={1} style={styles.metricValue}>{value}</Text>
      {helper ? <Text style={styles.metricHelper}>{helper}</Text> : null}
    </Card>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <View style={styles.pageHeader}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <View style={styles.pageTitleRow}>
        <Text accessibilityRole="header" style={styles.pageTitle}>{title}</Text>
        {action}
      </View>
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

export type StatusTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'gold' | 'info';

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <View accessibilityLabel={`${label}, estado`} style={[styles.pill, styles[`pill_${tone}`]]}>
      <Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{label}</Text>
    </View>
  );
}

/** @deprecated Use StatusPill in new code. */
export const Pill = StatusPill;

export function FilterChip({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.filterChip, selected && styles.filterChipSelected, pressed && !disabled && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

type NoticeTone = 'info' | 'warning' | 'error' | 'success';
const noticeIcon: Readonly<Record<NoticeTone, AppIconName>> = { info: 'info', warning: 'warning', error: 'error', success: 'success' };

export function InlineNotice({ title, message, tone = 'info' }: { title: string; message: string; tone?: NoticeTone }) {
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
  const stateIcon: AppIconName = tone === 'error' ? 'error' : tone === 'offline' ? 'warning' : 'info';
  return (
    <View accessibilityLiveRegion="polite" style={styles.stateView}>
      {loading ? <ActivityIndicator size="large" color={semantic.action.primary} /> : <AppIcon name={stateIcon} size={primitives.size.icon.xl} color={semantic.text.accent} />}
      <Text accessibilityRole="header" style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateMessage}>{message}</Text>
      {action ? <View style={styles.stateAction}>{action}</View> : null}
    </View>
  );
}

export function ProgressBar({ value, label, showValue = false }: { value: number; label: string; showValue?: boolean }) {
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
  return <View accessibilityElementsHidden style={styles.divider} />;
}

export const commonStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  muted: { color: semantic.text.secondary },
  positive: { color: semantic.status.positive },
  negative: { color: semantic.status.negative },
  money: textStyles.moneyM,
});

const borderWidth = primitives.size.border.thin;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: semantic.bg.base },
  screenContent: { width: '100%', alignSelf: 'center', paddingTop: spacing.md, gap: spacing.md },
  authContent: { justifyContent: 'center' },
  brand: { alignItems: 'center', gap: spacing.sm },
  brandCompact: { gap: spacing.none },
  brandCrest: { padding: componentTokens.brand.crestBorder, ...shadows.card },
  brandInner: { flex: 1, borderRadius: primitives.radius.pill, backgroundColor: semantic.bg.base, alignItems: 'center', justifyContent: 'center', borderWidth, borderColor: semantic.action.primaryPressed },
  brandLetter: { color: semantic.text.accent, fontFamily: primitives.typography.family.brandBold, fontSize: componentTokens.brand.letter },
  brandLetterCompact: { fontSize: componentTokens.brand.letterCompact },
  brandCopy: { alignItems: 'center', gap: spacing.xxs },
  brandName: { ...textStyles.brand, color: semantic.text.accent },
  brandSubtitle: { color: semantic.text.primary, fontFamily: primitives.typography.family.uiSemiBold, fontSize: componentTokens.brand.subtitle, letterSpacing: primitives.typography.letterSpacing.brand },
  button: { minHeight: componentTokens.button.minHeight, borderRadius: componentTokens.button.radius, paddingHorizontal: componentTokens.button.horizontalPadding, alignItems: 'center', justifyContent: 'center', borderWidth },
  button_primary: { backgroundColor: semantic.action.primary, borderColor: semantic.action.primary },
  button_secondary: { backgroundColor: semantic.action.secondary, borderColor: semantic.border.strong },
  button_ghost: { backgroundColor: primitives.color.transparent, borderColor: primitives.color.transparent },
  button_danger: { backgroundColor: semantic.status.negativeSurface, borderColor: semantic.status.negativeBorder },
  buttonPressed: { opacity: primitives.opacity.pressed, transform: [{ scale: primitives.motion.pressedScale }] },
  buttonDisabled: { opacity: primitives.opacity.disabled },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  buttonText: { ...textStyles.buttonLabel, textAlign: 'center' },
  iconButton: { width: componentTokens.iconButton.size, height: componentTokens.iconButton.size, borderRadius: componentTokens.iconButton.radius, alignItems: 'center', justifyContent: 'center', borderWidth },
  iconButton_default: { backgroundColor: semantic.surface.raised, borderColor: semantic.border.default },
  iconButton_ghost: { backgroundColor: primitives.color.transparent, borderColor: primitives.color.transparent },
  iconButton_danger: { backgroundColor: semantic.status.negativeSurface, borderColor: semantic.status.negativeBorder },
  field: { gap: spacing.xs },
  fieldLabel: { ...textStyles.caption, color: semantic.text.secondary, fontFamily: primitives.typography.family.uiBold, letterSpacing: primitives.typography.letterSpacing.label },
  input: { minHeight: componentTokens.input.minHeight, borderRadius: componentTokens.input.radius, borderWidth, borderColor: semantic.border.strong, backgroundColor: semantic.bg.elevated, color: semantic.text.primary, paddingHorizontal: spacing.md, ...textStyles.body },
  inputMultiline: { minHeight: componentTokens.input.multilineMinHeight, paddingTop: spacing.md, textAlignVertical: 'top' },
  inputError: { borderColor: semantic.status.negative },
  fieldHelp: { ...textStyles.caption, color: semantic.text.secondary },
  fieldHelpError: { color: semantic.status.negative },
  searchField: { minHeight: componentTokens.input.minHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: componentTokens.input.radius, borderWidth, borderColor: semantic.border.strong, backgroundColor: semantic.bg.elevated, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, minWidth: spacing.none, color: semantic.text.primary, paddingVertical: spacing.xs, ...textStyles.body },
  card: { backgroundColor: semantic.surface.default, borderWidth, borderColor: semantic.border.default, borderRadius: componentTokens.card.radius, padding: componentTokens.card.padding, ...shadows.card },
  cardRaised: { backgroundColor: semantic.surface.raised, borderColor: semantic.border.strong },
  metricCard: { minWidth: componentTokens.card.metricMinWidth, flexGrow: 1, flexBasis: componentTokens.card.metricMinWidth, gap: spacing.xs },
  metricLabel: { ...textStyles.caption, color: semantic.text.secondary, fontFamily: primitives.typography.family.uiBold, letterSpacing: primitives.typography.letterSpacing.label },
  metricValue: { ...textStyles.moneyL, color: semantic.text.primary },
  metricHelper: { ...textStyles.caption, color: semantic.text.subtle },
  pageHeader: { gap: spacing.xs, marginBottom: spacing.xs },
  pageTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  eyebrow: { ...textStyles.caption, color: semantic.text.accent, fontFamily: primitives.typography.family.uiExtraBold, letterSpacing: primitives.typography.letterSpacing.eyebrow },
  pageTitle: { ...textStyles.title, flexShrink: 1, color: semantic.text.primary },
  pageDescription: { ...textStyles.body, color: semantic.text.secondary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { ...textStyles.section, flexShrink: 1, color: semantic.text.primary },
  pill: { alignSelf: 'flex-start', borderRadius: componentTokens.chip.radius, borderWidth, paddingHorizontal: componentTokens.chip.horizontalPadding, paddingVertical: spacing.xxs },
  pill_neutral: { borderColor: semantic.border.strong, backgroundColor: semantic.surface.raised },
  pill_positive: { borderColor: semantic.status.positiveBorder, backgroundColor: semantic.status.positiveSurface },
  pill_warning: { borderColor: semantic.status.warningBorder, backgroundColor: semantic.status.warningSurface },
  pill_negative: { borderColor: semantic.status.negativeBorder, backgroundColor: semantic.status.negativeSurface },
  pill_gold: { borderColor: semantic.action.primaryPressed, backgroundColor: primitives.color.gold[900] },
  pill_info: { borderColor: semantic.status.infoBorder, backgroundColor: semantic.status.infoSurface },
  pillText: { ...textStyles.caption, fontFamily: primitives.typography.family.uiBold },
  pillText_neutral: { color: semantic.text.secondary },
  pillText_positive: { color: semantic.status.positive },
  pillText_warning: { color: semantic.status.warning },
  pillText_negative: { color: semantic.status.negative },
  pillText_gold: { color: semantic.text.accent },
  pillText_info: { color: semantic.status.info },
  filterChip: { minHeight: componentTokens.chip.minHeight, justifyContent: 'center', borderRadius: componentTokens.chip.radius, borderWidth, borderColor: semantic.border.default, backgroundColor: semantic.surface.default, paddingHorizontal: componentTokens.chip.horizontalPadding },
  filterChipSelected: { borderColor: semantic.border.focus, backgroundColor: primitives.color.gold[900] },
  filterChipText: { ...textStyles.bodySmall, color: semantic.text.secondary, fontFamily: primitives.typography.family.uiSemiBold },
  filterChipTextSelected: { color: semantic.text.accent },
  notice: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: componentTokens.notice.radius, borderWidth, padding: componentTokens.notice.padding, gap: spacing.sm },
  notice_info: { borderColor: semantic.status.infoBorder, backgroundColor: semantic.status.infoSurface },
  notice_warning: { borderColor: semantic.status.warningBorder, backgroundColor: semantic.status.warningSurface },
  notice_error: { borderColor: semantic.status.negativeBorder, backgroundColor: semantic.status.negativeSurface },
  notice_success: { borderColor: semantic.status.positiveBorder, backgroundColor: semantic.status.positiveSurface },
  noticeIcon_info: { color: semantic.status.info },
  noticeIcon_warning: { color: semantic.status.warning },
  noticeIcon_error: { color: semantic.status.negative },
  noticeIcon_success: { color: semantic.status.positive },
  noticeCopy: { flex: 1, gap: spacing.xs },
  noticeTitle: { ...textStyles.bodySmall, color: semantic.text.primary, fontFamily: primitives.typography.family.uiExtraBold },
  noticeMessage: { ...textStyles.bodySmall, color: semantic.text.secondary },
  stateView: { flex: 1, minHeight: componentTokens.screen.stateMinHeight, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  stateTitle: { ...textStyles.section, color: semantic.text.primary, textAlign: 'center' },
  stateMessage: { ...textStyles.body, color: semantic.text.secondary, textAlign: 'center', maxWidth: componentTokens.dialog.maxWidth },
  stateAction: { width: '100%', maxWidth: componentTokens.dialog.maxWidth, gap: spacing.sm },
  progressGroup: { gap: spacing.xs },
  progressTrack: { height: componentTokens.progress.height, borderRadius: componentTokens.progress.radius, backgroundColor: semantic.surface.pressed, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: componentTokens.progress.radius, backgroundColor: semantic.action.primary },
  progressLabel: { ...textStyles.caption, color: semantic.text.secondary, textAlign: 'right' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: semantic.overlay.default },
  dialogAlignment: { justifyContent: 'center', padding: spacing.md },
  sheet: { width: '100%', maxWidth: componentTokens.sheet.maxWidth, alignSelf: 'center', borderTopLeftRadius: componentTokens.sheet.radius, borderTopRightRadius: componentTokens.sheet.radius, borderWidth, borderColor: semantic.border.strong, backgroundColor: semantic.surface.raised, padding: componentTokens.sheet.padding, gap: spacing.md, ...shadows.overlay },
  dialog: { width: '100%', maxWidth: componentTokens.dialog.maxWidth, alignSelf: 'center', borderRadius: componentTokens.dialog.radius, borderWidth, borderColor: semantic.border.strong, backgroundColor: semantic.surface.raised, padding: componentTokens.dialog.padding, gap: spacing.md, ...shadows.overlay },
  overlayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  overlayTitle: { ...textStyles.section, flex: 1, color: semantic.text.primary },
  overlayBody: { gap: spacing.md },
  overlayActions: { gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: semantic.border.default, width: '100%' },
});
