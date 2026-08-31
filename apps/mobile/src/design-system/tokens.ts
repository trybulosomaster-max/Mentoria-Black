import type { TextStyle, ViewStyle } from 'react-native';

/**
 * AVIORA Visual V2.
 * A/C preserve the AVIORA-VISUAL-V2-A-C-2026 freeze. B is the later,
 * explicitly approved Branco Executivo expansion. All themes share one tree.
 */
export const primitives = Object.freeze({
  color: Object.freeze({
    neutral: Object.freeze({ 0: '#FFFCF7', 50: '#F7F3EC', 100: '#EFE8DD', 300: '#A6B2BD', 500: '#65717C', 650: '#3A5668', 750: '#294254', 850: '#1B3041', 900: '#152635', 925: '#10202D', 950: '#0E1822', 1000: '#0E1822' }),
    gold: Object.freeze({ 200: '#D8C08E', 300: '#CDB27B', 500: '#C4A56B', 700: '#9D824E', 900: '#2B281F' }),
    green: Object.freeze({ 200: '#8BC5AD', 400: '#59A388', 700: '#2D8A68', 900: '#173A30' }),
    red: Object.freeze({ 200: '#D9A1A4', 400: '#CB8185', 700: '#B85258', 900: '#45272B' }),
    yellow: Object.freeze({ 200: '#E6D293', 400: '#C8AA55', 700: '#876F2E', 900: '#3B321D' }),
    blue: Object.freeze({ 200: '#9DBBDD', 400: '#6D9BC7', 700: '#376EA6', 900: '#203A54' }),
    blackAlpha: Object.freeze({ 32: 'rgba(14, 24, 34, 0.32)', 72: 'rgba(14, 24, 34, 0.72)' }),
    transparent: 'transparent',
  }),
  space: Object.freeze({ none: 0, xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, huge: 48 }),
  radius: Object.freeze({ none: 0, xs: 12, sm: 12, md: 14, lg: 16, xl: 20, pill: 999 }),
  size: Object.freeze({ border: Object.freeze({ thin: 1, strong: 2 }), icon: Object.freeze({ xs: 16, sm: 20, md: 24, lg: 28, xl: 32 }), touch: Object.freeze({ minimum: 44, default: 48, comfortable: 52 }) }),
  opacity: Object.freeze({ disabled: 0.5, pressed: 0.78, subtle: 0.72, opaque: 1 }),
  motion: Object.freeze({ duration: Object.freeze({ instant: 0, fast: 160, standard: 240, deliberate: 320 }), easing: Object.freeze({ standard: 'ease-in-out', enter: 'ease-out', exit: 'ease-in' }), pressedScale: 0.995 }),
  typography: Object.freeze({
    family: Object.freeze({ uiRegular: 'Inter_400Regular', uiSemiBold: 'Inter_600SemiBold', uiBold: 'Inter_700Bold', uiExtraBold: 'Inter_800ExtraBold', brandRegular: 'Syncopate_400Regular', brandBold: 'Syncopate_700Bold' }),
    size: Object.freeze({ caption: 12, bodySmall: 14, button: 15, body: 16, section: 18, title: 24, display: 32 }),
    lineHeight: Object.freeze({ caption: 16, bodySmall: 20, button: 20, body: 24, section: 24, title: 30, display: 38 }),
    letterSpacing: Object.freeze({ tight: -0.4, normal: 0, label: 0.4, eyebrow: 1.2, brand: 3 }),
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
  status: Readonly<{ positive: string; positiveText: string; risk: string; riskText: string; warning: string; info: string }>;
  chart: Readonly<{ actual: string; projected: string; grid: string; projectionDash: readonly [number, number] }>;
  navigation: Readonly<{ background: string; selectedBackground: string; selected: string; unselected: string }>;
  focus: Readonly<{ ring: string; offset: number }>;
  overlay: string;
  elevation: Readonly<{ card: Readonly<ViewStyle>; overlay: Readonly<ViewStyle> }>;
}>;

const lightElevation = Object.freeze({ card: Object.freeze({ shadowColor: '#17212B', shadowOffset: Object.freeze({ width: 0, height: 3 }), shadowOpacity: 0.06, shadowRadius: 10, elevation: 1 }) satisfies Readonly<ViewStyle>, overlay: Object.freeze({ shadowColor: '#17212B', shadowOffset: Object.freeze({ width: 0, height: 12 }), shadowOpacity: 0.18, shadowRadius: 28, elevation: 9 }) satisfies Readonly<ViewStyle> });
const whiteElevation = Object.freeze({ card: Object.freeze({ shadowColor: '#263543', shadowOffset: Object.freeze({ width: 0, height: 2 }), shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }) satisfies Readonly<ViewStyle>, overlay: Object.freeze({ shadowColor: '#263543', shadowOffset: Object.freeze({ width: 0, height: 10 }), shadowOpacity: 0.14, shadowRadius: 24, elevation: 8 }) satisfies Readonly<ViewStyle> });
const darkElevation = Object.freeze({ card: Object.freeze({ shadowColor: '#0E1822', shadowOffset: Object.freeze({ width: 0, height: 4 }), shadowOpacity: 0.16, shadowRadius: 12, elevation: 2 }) satisfies Readonly<ViewStyle>, overlay: Object.freeze({ shadowColor: '#0E1822', shadowOffset: Object.freeze({ width: 0, height: 16 }), shadowOpacity: 0.38, shadowRadius: 32, elevation: 12 }) satisfies Readonly<ViewStyle> });

export const themeTokens = Object.freeze({
  serene: Object.freeze({ id: 'aviora-light-a', background: Object.freeze({ canvas: '#F7F3EC', surface: '#FFFCF7', surfaceMuted: '#EFE8DD' }), text: Object.freeze({ primary: '#17212B', secondary: '#5D6974', secondaryOnMuted: '#5D6974', inverse: '#F7F3EC' }), border: Object.freeze({ default: '#DED5C9', strong: '#8E8173' }), brand: Object.freeze({ accent: '#C4A56B' }), action: Object.freeze({ primary: '#7A6226', onPrimary: '#FFFCF7', text: '#7A6226' }), status: Object.freeze({ positive: '#1E7157', positiveText: '#1E7157', risk: '#A74449', riskText: '#A74449', warning: '#7A6226', info: '#35699E' }), chart: Object.freeze({ actual: '#7A6226', projected: '#376EA6', grid: '#DED5C9', projectionDash: Object.freeze([5, 5]) as readonly [number, number] }), navigation: Object.freeze({ background: '#FFFCF7', selectedBackground: '#EFE8DD', selected: '#17212B', unselected: '#65717C' }), focus: Object.freeze({ ring: '#376EA6', offset: 2 }), overlay: 'rgba(14, 24, 34, 0.72)', elevation: lightElevation }) satisfies ThemeTokens,
  white: Object.freeze({ id: 'aviora-white-b', background: Object.freeze({ canvas: '#FEFDFC', surface: '#FFFFFF', surfaceMuted: '#F6F7F7' }), text: Object.freeze({ primary: '#263543', secondary: '#65717C', secondaryOnMuted: '#5D6974', inverse: '#263543' }), border: Object.freeze({ default: '#E6E8E9', strong: '#859096' }), brand: Object.freeze({ accent: '#B58D46' }), action: Object.freeze({ primary: '#80681E', onPrimary: '#FFFFFF', text: '#80681E' }), status: Object.freeze({ positive: '#277F84', positiveText: '#216D72', risk: '#C66A5D', riskText: '#A84D43', warning: '#80681E', info: '#5A478F' }), chart: Object.freeze({ actual: '#277F84', projected: '#6B5AA7', grid: '#E6E8E9', projectionDash: Object.freeze([5, 5]) as readonly [number, number] }), navigation: Object.freeze({ background: '#FFFFFF', selectedBackground: '#F6F7F7', selected: '#263543', unselected: '#65717C' }), focus: Object.freeze({ ring: '#216D72', offset: 2 }), overlay: 'rgba(38, 53, 67, 0.60)', elevation: whiteElevation }) satisfies ThemeTokens,
  dark: Object.freeze({ id: 'aviora-dark-c', background: Object.freeze({ canvas: '#0E1822', surface: '#152635', surfaceMuted: '#1B3041' }), text: Object.freeze({ primary: '#E7E0D5', secondary: '#A6B2BD', secondaryOnMuted: '#A6B2BD', inverse: '#0E1822' }), border: Object.freeze({ default: '#294254', strong: '#607D90' }), brand: Object.freeze({ accent: '#C4A56B' }), action: Object.freeze({ primary: '#C4A56B', onPrimary: '#0E1822', text: '#C4A56B' }), status: Object.freeze({ positive: '#2D8A68', positiveText: '#59A388', risk: '#BC5B61', riskText: '#CB8185', warning: '#C8AA55', info: '#6D9BC7' }), chart: Object.freeze({ actual: '#C4A56B', projected: '#6D9BC7', grid: '#294254', projectionDash: Object.freeze([5, 5]) as readonly [number, number] }), navigation: Object.freeze({ background: '#10202D', selectedBackground: '#1B3041', selected: '#C4A56B', unselected: '#A6B2BD' }), focus: Object.freeze({ ring: '#6D9BC7', offset: 2 }), overlay: 'rgba(14, 24, 34, 0.72)', elevation: darkElevation }) satisfies ThemeTokens,
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
  brand: Object.freeze({ crest: 92, crestCompact: 54, crestBorder: 2, letter: 42, letterCompact: 25, wordmark: 28, subtitle: 10 }), avatar: Object.freeze({ size: 56 }),
} as const);

const textStyle = (style: TextStyle): Readonly<TextStyle> => Object.freeze(style);
const type = primitives.typography;
export const textStyles = Object.freeze({
  // The frozen line-height scale remains available above for fixed-size exports.
  // Runtime text uses the native leading so Dynamic Type can reflow without a
  // fixed line box clipping scaled glyphs on iOS or Android.
  display: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.display, letterSpacing: type.letterSpacing.tight }),
  title: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.title, letterSpacing: type.letterSpacing.tight }),
  section: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.section }),
  body: textStyle({ fontFamily: type.family.uiRegular, fontSize: type.size.body }),
  bodySmall: textStyle({ fontFamily: type.family.uiRegular, fontSize: type.size.bodySmall }),
  caption: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: type.size.caption }),
  moneyXL: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.display, fontVariant: ['tabular-nums'] }),
  moneyL: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.title, fontVariant: ['tabular-nums'] }),
  moneyM: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.body, fontVariant: ['tabular-nums'] }),
  buttonLabel: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.button }),
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
