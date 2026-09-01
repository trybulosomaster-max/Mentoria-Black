import type { TextStyle, ViewStyle } from 'react-native';

/**
 * AVIORA Visual V2, evolved by the approved private-banking direction.
 * A, B and C share one functional tree; only palette and atmosphere change.
 */
export const primitives = Object.freeze({
  color: Object.freeze({
    neutral: Object.freeze({ 0: '#FCFAF6', 50: '#F4EFE6', 100: '#EDE5D8', 300: '#A7A7A2', 500: '#666A64', 650: '#454545', 750: '#3A3A38', 850: '#242424', 900: '#181818', 925: '#111111', 950: '#0D0D0D', 1000: '#000000' }),
    gold: Object.freeze({ 200: '#D8C08E', 300: '#CDB27B', 500: '#C9A127', 700: '#9D824E', 900: '#2B281F' }),
    green: Object.freeze({ 200: '#9BCAB7', 400: '#72B197', 700: '#236B53', 900: '#12382B' }),
    red: Object.freeze({ 200: '#D9A1A4', 400: '#CB8185', 700: '#B85258', 900: '#45272B' }),
    yellow: Object.freeze({ 200: '#E6D293', 400: '#C8AA55', 700: '#876F2E', 900: '#3B321D' }),
    blue: Object.freeze({ 200: '#9DBBDD', 400: '#6D9BC7', 700: '#376EA6', 900: '#203A54' }),
    blackAlpha: Object.freeze({ 32: 'rgba(0, 0, 0, 0.32)', 72: 'rgba(0, 0, 0, 0.72)' }),
    transparent: 'transparent',
  }),
  space: Object.freeze({ none: 0, xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, huge: 48 }),
  radius: Object.freeze({ none: 0, xs: 12, sm: 12, md: 14, lg: 16, xl: 20, pill: 999 }),
  size: Object.freeze({ border: Object.freeze({ thin: 1, strong: 2 }), icon: Object.freeze({ xs: 16, sm: 20, md: 24, lg: 28, xl: 32 }), touch: Object.freeze({ minimum: 44, default: 48, comfortable: 52 }) }),
  opacity: Object.freeze({ disabled: 0.5, pressed: 0.78, subtle: 0.72, opaque: 1 }),
  motion: Object.freeze({ duration: Object.freeze({ instant: 0, fast: 160, standard: 240, deliberate: 320 }), easing: Object.freeze({ standard: 'ease-in-out', enter: 'ease-out', exit: 'ease-in' }), pressedScale: 0.995 }),
  typography: Object.freeze({
    family: Object.freeze({ uiRegular: 'Inter_400Regular', uiSemiBold: 'Inter_600SemiBold', brandRegular: 'Syncopate_400Regular', brandBold: 'Syncopate_700Bold' }),
    size: Object.freeze({ caption: 12, bodySmall: 14, button: 15, body: 16, section: 18, title: 26, display: 36 }),
    lineHeight: Object.freeze({ caption: 16, bodySmall: 20, button: 20, body: 24, section: 24, title: 32, display: 42 }),
    letterSpacing: Object.freeze({ tight: -0.6, normal: 0, label: 0.5, eyebrow: 1.4, brand: 3 }),
  }),
} as const);

export type ResolvedTheme = 'serene' | 'white' | 'dark';
/** `brand.accent` is decorative. Text and interactive controls must use `action`.
 * `border.default` separates non-essential surfaces; controls use `border.strong`. */
export type ThemeTokens = Readonly<{
  id: 'aviora-light-a' | 'aviora-white-b' | 'aviora-dark-c';
  background: Readonly<{ canvas: string; surface: string; surfaceMuted: string }>;
  text: Readonly<{ primary: string; secondary: string; secondaryOnMuted: string; inverse: string }>;
  border: Readonly<{ default: string; strong: string }>;
  brand: Readonly<{ accent: string }>;
  action: Readonly<{ primary: string; onPrimary: string; text: string }>;
  status: Readonly<{ positive: string; positiveText: string; onPositive: string; risk: string; riskText: string; onRisk: string; warning: string; info: string }>;
  chart: Readonly<{ actual: string; projected: string; grid: string; projectionDash: readonly [number, number] }>;
  navigation: Readonly<{ background: string; selectedBackground: string; selected: string; unselected: string }>;
  focus: Readonly<{ ring: string; offset: number }>;
  overlay: string;
  elevation: Readonly<{ card: Readonly<ViewStyle>; overlay: Readonly<ViewStyle> }>;
}>;

const lightElevation = Object.freeze({ card: Object.freeze({ shadowColor: '#252722', shadowOffset: Object.freeze({ width: 0, height: 2 }), shadowOpacity: 0.035, shadowRadius: 8, elevation: 1 }) satisfies Readonly<ViewStyle>, overlay: Object.freeze({ shadowColor: '#252722', shadowOffset: Object.freeze({ width: 0, height: 12 }), shadowOpacity: 0.16, shadowRadius: 28, elevation: 9 }) satisfies Readonly<ViewStyle> });
const whiteElevation = Object.freeze({ card: Object.freeze({ shadowColor: '#1E2420', shadowOffset: Object.freeze({ width: 0, height: 2 }), shadowOpacity: 0.025, shadowRadius: 6, elevation: 1 }) satisfies Readonly<ViewStyle>, overlay: Object.freeze({ shadowColor: '#1E2420', shadowOffset: Object.freeze({ width: 0, height: 10 }), shadowOpacity: 0.12, shadowRadius: 24, elevation: 8 }) satisfies Readonly<ViewStyle> });
const darkElevation = Object.freeze({ card: Object.freeze({ shadowColor: '#000000', shadowOffset: Object.freeze({ width: 0, height: 3 }), shadowOpacity: 0.2, shadowRadius: 10, elevation: 2 }) satisfies Readonly<ViewStyle>, overlay: Object.freeze({ shadowColor: '#000000', shadowOffset: Object.freeze({ width: 0, height: 16 }), shadowOpacity: 0.42, shadowRadius: 32, elevation: 12 }) satisfies Readonly<ViewStyle> });

export const themeTokens = Object.freeze({
  serene: Object.freeze({ id: 'aviora-light-a', background: Object.freeze({ canvas: '#F4EFE6', surface: '#FCFAF6', surfaceMuted: '#EDE5D8' }), text: Object.freeze({ primary: '#252722', secondary: '#66665F', secondaryOnMuted: '#5E605A', inverse: '#FCFAF6' }), border: Object.freeze({ default: '#D9D0C2', strong: '#77786F' }), brand: Object.freeze({ accent: '#C9A127' }), action: Object.freeze({ primary: '#C9A127', onPrimary: '#0D0D0D', text: '#765B2D' }), status: Object.freeze({ positive: '#315E4A', positiveText: '#315E4A', onPositive: '#FCFAF6', risk: '#9C4B4F', riskText: '#914247', onRisk: '#FCFAF6', warning: '#765F27', info: '#66665F' }), chart: Object.freeze({ actual: '#765B2D', projected: '#9B7D4E', grid: '#D9D0C2', projectionDash: Object.freeze([5, 5]) as readonly [number, number] }), navigation: Object.freeze({ background: '#FCFAF6', selectedBackground: '#EDE5D8', selected: '#765B2D', unselected: '#66665F' }), focus: Object.freeze({ ring: '#765B2D', offset: 2 }), overlay: 'rgba(8, 9, 8, 0.72)', elevation: lightElevation }) satisfies ThemeTokens,
  white: Object.freeze({ id: 'aviora-white-b', background: Object.freeze({ canvas: '#FAFAF8', surface: '#FFFFFF', surfaceMuted: '#F1F3F0' }), text: Object.freeze({ primary: '#1E2420', secondary: '#606760', secondaryOnMuted: '#565E57', inverse: '#FFFFFF' }), border: Object.freeze({ default: '#E0E4DF', strong: '#6C756E' }), brand: Object.freeze({ accent: '#C9A127' }), action: Object.freeze({ primary: '#C9A127', onPrimary: '#0D0D0D', text: '#705426' }), status: Object.freeze({ positive: '#17654D', positiveText: '#155F49', onPositive: '#FFFFFF', risk: '#A34349', riskText: '#963B42', onRisk: '#FFFFFF', warning: '#765F27', info: '#606760' }), chart: Object.freeze({ actual: '#705426', projected: '#9A753F', grid: '#E0E4DF', projectionDash: Object.freeze([5, 5]) as readonly [number, number] }), navigation: Object.freeze({ background: '#FFFFFF', selectedBackground: '#F1F3F0', selected: '#705426', unselected: '#606760' }), focus: Object.freeze({ ring: '#705426', offset: 2 }), overlay: 'rgba(8, 9, 8, 0.64)', elevation: whiteElevation }) satisfies ThemeTokens,
  dark: Object.freeze({ id: 'aviora-dark-c', background: Object.freeze({ canvas: '#0D0D0D', surface: '#181818', surfaceMuted: '#242424' }), text: Object.freeze({ primary: '#F0ECE3', secondary: '#A7A7A2', secondaryOnMuted: '#B4B4AF', inverse: '#0D0D0D' }), border: Object.freeze({ default: '#3A3A38', strong: '#767672' }), brand: Object.freeze({ accent: '#C9A127' }), action: Object.freeze({ primary: '#C9A127', onPrimary: '#0D0D0D', text: '#C9A127' }), status: Object.freeze({ positive: '#2D8063', positiveText: '#72B197', onPositive: '#FFFFFF', risk: '#AA585D', riskText: '#D18488', onRisk: '#FFFFFF', warning: '#C1A568', info: '#A0A09A' }), chart: Object.freeze({ actual: '#C9A127', projected: '#C1A568', grid: '#3A3A38', projectionDash: Object.freeze([5, 5]) as readonly [number, number] }), navigation: Object.freeze({ background: '#111111', selectedBackground: '#202020', selected: '#C9A127', unselected: '#A7A7A2' }), focus: Object.freeze({ ring: '#C9A127', offset: 2 }), overlay: 'rgba(0, 0, 0, 0.78)', elevation: darkElevation }) satisfies ThemeTokens,
} as const);

/** Legacy aliases for pure contracts. Runtime UI consumes ThemeProvider. */
export const semantic = Object.freeze({
  bg: Object.freeze({ base: themeTokens.dark.background.canvas, elevated: themeTokens.dark.background.surface }),
  surface: Object.freeze({ default: themeTokens.dark.background.surface, raised: themeTokens.dark.background.surfaceMuted, pressed: themeTokens.dark.background.surfaceMuted }),
  text: Object.freeze({ primary: themeTokens.dark.text.primary, secondary: themeTokens.dark.text.secondary, subtle: themeTokens.dark.text.secondary, inverse: themeTokens.dark.action.onPrimary, accent: themeTokens.dark.action.text }),
  border: Object.freeze({ default: themeTokens.dark.border.default, strong: themeTokens.dark.border.strong, focus: themeTokens.dark.focus.ring }),
  action: Object.freeze({ primary: themeTokens.dark.action.primary, primaryPressed: primitives.color.gold[700], secondary: themeTokens.dark.background.surfaceMuted, disabled: themeTokens.dark.border.default }),
  status: Object.freeze({ positive: themeTokens.dark.status.positiveText, positiveSurface: themeTokens.dark.background.surfaceMuted, positiveBorder: themeTokens.dark.status.positive, negative: themeTokens.dark.status.riskText, negativeSurface: themeTokens.dark.background.surfaceMuted, negativeBorder: themeTokens.dark.status.risk, warning: themeTokens.dark.status.warning, warningSurface: themeTokens.dark.background.surfaceMuted, warningBorder: themeTokens.dark.status.warning, info: themeTokens.dark.status.info, infoSurface: themeTokens.dark.background.surfaceMuted, infoBorder: themeTokens.dark.status.info }),
  overlay: Object.freeze({ default: themeTokens.dark.overlay }), elevation: themeTokens.dark.elevation, motion: primitives.motion,
} as const);

export const componentTokens = Object.freeze({
  screen: Object.freeze({ compactPadding: primitives.space.md, mediumPadding: primitives.space.xl, expandedPadding: primitives.space.xxl, bottomPadding: primitives.space.xxxl, contentMaxWidth: 1120, readableMaxWidth: 760, stateMinHeight: 360 }),
  button: Object.freeze({ minHeight: primitives.size.touch.default, radius: primitives.radius.md, horizontalPadding: primitives.space.md }),
  iconButton: Object.freeze({ size: primitives.size.touch.default, radius: primitives.radius.pill, iconSize: primitives.size.icon.md }),
  input: Object.freeze({ minHeight: primitives.size.touch.default, multilineMinHeight: 112, radius: primitives.radius.md }),
  card: Object.freeze({ radius: primitives.radius.lg, padding: primitives.space.md, metricMinWidth: 104 }),
  tab: Object.freeze({ height: 68, iconSize: primitives.size.icon.md, topPadding: primitives.space.xs, bottomPadding: primitives.space.xs }),
  chip: Object.freeze({ minHeight: primitives.size.touch.minimum, radius: primitives.radius.pill, horizontalPadding: primitives.space.sm }),
  notice: Object.freeze({ radius: primitives.radius.md, padding: primitives.space.md, iconSize: primitives.size.icon.sm }),
  progress: Object.freeze({ height: primitives.space.xs, radius: primitives.radius.pill }),
  sheet: Object.freeze({ radius: primitives.radius.xl, padding: primitives.space.lg, maxWidth: 720 }),
  dialog: Object.freeze({ radius: primitives.radius.lg, padding: primitives.space.lg, maxWidth: 520 }),
  dashboard: Object.freeze({ flowIndicatorSize: 44, chartHeight: 144, chartPadding: 16, chartPointSize: 6, incomeLineWidth: 2, expenseLineWidth: 2 }),
  quickAction: Object.freeze({ triggerSize: 56, actionSize: 48, slotWidth: 96, slotHeight: 100, topOffsetX: 52, topOffsetY: -132, sideOffsetY: -24, sideOffsetXMin: 88, sideOffsetXMax: 108, overlayElevation: 30 }),
  brand: Object.freeze({ crest: 92, crestCompact: 54, crestBorder: 2, letter: 42, letterCompact: 25, wordmark: 28, subtitle: 10 }), avatar: Object.freeze({ size: 56 }),
} as const);

const textStyle = (style: TextStyle): Readonly<TextStyle> => Object.freeze(style);
const type = primitives.typography;
export const textStyles = Object.freeze({
  // The frozen line-height scale remains available above for fixed-size exports.
  // Runtime text uses the native leading so Dynamic Type can reflow without a
  // fixed line box clipping scaled glyphs on iOS or Android.
  display: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: type.size.display, letterSpacing: type.letterSpacing.tight }),
  title: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: type.size.title, letterSpacing: type.letterSpacing.tight }),
  section: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: type.size.section, letterSpacing: type.letterSpacing.tight }),
  body: textStyle({ fontFamily: type.family.uiRegular, fontSize: type.size.body }),
  bodySmall: textStyle({ fontFamily: type.family.uiRegular, fontSize: type.size.bodySmall }),
  caption: textStyle({ fontFamily: type.family.uiRegular, fontSize: type.size.caption }),
  moneyXL: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: type.size.display, letterSpacing: type.letterSpacing.tight, fontVariant: ['tabular-nums'] }),
  moneyL: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: type.size.title, letterSpacing: type.letterSpacing.tight, fontVariant: ['tabular-nums'] }),
  moneyM: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: type.size.body, fontVariant: ['tabular-nums'] }),
  buttonLabel: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: type.size.button }),
  tabLabel: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: 10, letterSpacing: -0.2 }),
  brand: textStyle({ fontFamily: type.family.brandRegular, fontSize: componentTokens.brand.wordmark, letterSpacing: type.letterSpacing.brand }),
} as const);

export const dynamicType = Object.freeze({ enabled: true, maxFontSizeMultiplier: 2, headingMaxFontSizeMultiplier: 1.4, moneyMaxFontSizeMultiplier: 1.6, tabLabelMaxFontSizeMultiplier: 1.2, metricReflowFontScale: 1.3 });
export const breakpoints = Object.freeze({ compactMin: 320, mediumMin: 600, expandedMin: 840 });
export const colors = Object.freeze({ background: semantic.bg.base, backgroundElevated: semantic.bg.elevated, surface: semantic.surface.default, surfaceRaised: semantic.surface.raised, surfacePressed: semantic.surface.pressed, border: semantic.border.default, borderStrong: semantic.border.strong, text: semantic.text.primary, textMuted: semantic.text.secondary, textSubtle: semantic.text.subtle, gold: semantic.action.primary, goldBright: semantic.text.accent, goldDark: semantic.action.primaryPressed, positive: semantic.status.positive, negative: semantic.status.negative, warning: semantic.status.warning, info: semantic.status.info, overlay: semantic.overlay.default, transparent: primitives.color.transparent } as const);
export const spacing = primitives.space;
export const radius = primitives.radius;
export const touch = Object.freeze({ minimum: primitives.size.touch.minimum, comfortable: primitives.size.touch.default });
export const shadows = Object.freeze({ card: semantic.elevation.card, overlay: semantic.elevation.overlay });
export const typography = Object.freeze({ display: type.size.display, title: type.size.title, section: type.size.section, body: type.size.body, bodySmall: type.size.bodySmall, caption: type.size.caption, lineHeightBody: type.lineHeight.body } as const);
