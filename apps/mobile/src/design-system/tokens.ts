import type { TextStyle, ViewStyle } from 'react-native';

/** Gate 0B token contract. Screens consume semantic or component tokens. */
export const primitives = Object.freeze({
  color: Object.freeze({
    neutral: Object.freeze({ 0: '#FFFFFF', 50: '#F5F5F5', 100: '#E8E8E8', 300: '#A6A6A6', 500: '#777777', 650: '#454545', 750: '#2B2B2B', 850: '#181818', 900: '#121212', 925: '#0D0D0D', 950: '#090909', 1000: '#050505' }),
    gold: Object.freeze({ 200: '#F1D98D', 300: '#E4C55B', 500: '#C9A227', 700: '#8F741F', 900: '#1A170C' }),
    green: Object.freeze({ 200: '#B8DDBA', 400: '#9ACA9D', 700: '#3C5B42', 900: '#102015' }),
    red: Object.freeze({ 200: '#F0B5B5', 400: '#E2A0A0', 700: '#6A3333', 900: '#1A1111' }),
    yellow: Object.freeze({ 200: '#E9D795', 400: '#DFC878', 700: '#5A4927', 900: '#18150C' }),
    blue: Object.freeze({ 200: '#C1CDE0', 400: '#AAB9D1', 700: '#33445A', 900: '#0C121A' }),
    blackAlpha: Object.freeze({ 32: 'rgba(0, 0, 0, 0.32)', 72: 'rgba(0, 0, 0, 0.72)' }),
    transparent: 'transparent',
  }),
  space: Object.freeze({ none: 0, xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, huge: 48 }),
  radius: Object.freeze({ none: 0, xs: 6, sm: 8, md: 12, lg: 16, xl: 22, pill: 999 }),
  size: Object.freeze({ border: Object.freeze({ thin: 1, strong: 2 }), icon: Object.freeze({ xs: 16, sm: 20, md: 24, lg: 28, xl: 32 }), touch: Object.freeze({ minimum: 44, default: 48, comfortable: 52 }) }),
  opacity: Object.freeze({ disabled: 0.5, pressed: 0.78, subtle: 0.72, opaque: 1 }),
  motion: Object.freeze({ duration: Object.freeze({ instant: 0, fast: 160, standard: 240, deliberate: 320 }), easing: Object.freeze({ standard: 'ease-in-out', enter: 'ease-out', exit: 'ease-in' }), pressedScale: 0.995 }),
  elevation: Object.freeze({
    none: Object.freeze({}) as Readonly<ViewStyle>,
    card: Object.freeze({ shadowColor: '#000000', shadowOffset: Object.freeze({ width: 0, height: 10 }), shadowOpacity: 0.32, shadowRadius: 24, elevation: 7 }) satisfies Readonly<ViewStyle>,
    overlay: Object.freeze({ shadowColor: '#000000', shadowOffset: Object.freeze({ width: 0, height: 16 }), shadowOpacity: 0.42, shadowRadius: 32, elevation: 12 }) satisfies Readonly<ViewStyle>,
  }),
  typography: Object.freeze({
    family: Object.freeze({ uiRegular: 'Inter_400Regular', uiSemiBold: 'Inter_600SemiBold', uiBold: 'Inter_700Bold', uiExtraBold: 'Inter_800ExtraBold', brandRegular: 'Syncopate_400Regular', brandBold: 'Syncopate_700Bold' }),
    size: Object.freeze({ caption: 12, bodySmall: 14, body: 16, section: 20, title: 26, display: 32 }),
    lineHeight: Object.freeze({ caption: 16, bodySmall: 20, body: 24, section: 26, title: 32, display: 38 }),
    letterSpacing: Object.freeze({ tight: -0.6, normal: 0, label: 0.6, eyebrow: 1.4, brand: 3 }),
  }),
} as const);

export const semantic = Object.freeze({
  bg: Object.freeze({ base: primitives.color.neutral[1000], elevated: primitives.color.neutral[950] }),
  surface: Object.freeze({ default: primitives.color.neutral[925], raised: primitives.color.neutral[900], pressed: primitives.color.neutral[850] }),
  text: Object.freeze({ primary: primitives.color.neutral[50], secondary: primitives.color.neutral[300], subtle: primitives.color.neutral[500], inverse: primitives.color.neutral[1000], accent: primitives.color.gold[300] }),
  border: Object.freeze({ default: primitives.color.neutral[750], strong: primitives.color.neutral[650], focus: primitives.color.gold[300] }),
  action: Object.freeze({ primary: primitives.color.gold[500], primaryPressed: primitives.color.gold[700], secondary: primitives.color.neutral[900], disabled: primitives.color.neutral[750] }),
  status: Object.freeze({
    positive: primitives.color.green[400], positiveSurface: primitives.color.green[900], positiveBorder: primitives.color.green[700],
    negative: primitives.color.red[400], negativeSurface: primitives.color.red[900], negativeBorder: primitives.color.red[700],
    warning: primitives.color.yellow[400], warningSurface: primitives.color.yellow[900], warningBorder: primitives.color.yellow[700],
    info: primitives.color.blue[400], infoSurface: primitives.color.blue[900], infoBorder: primitives.color.blue[700],
  }),
  overlay: Object.freeze({ default: primitives.color.blackAlpha[72] }),
  elevation: primitives.elevation,
  motion: primitives.motion,
} as const);

export const componentTokens = Object.freeze({
  screen: Object.freeze({ compactPadding: primitives.space.md, mediumPadding: primitives.space.xl, expandedPadding: primitives.space.xxl, bottomPadding: primitives.space.xxxl, contentMaxWidth: 1120, readableMaxWidth: 760, stateMinHeight: 420 }),
  button: Object.freeze({ minHeight: primitives.size.touch.default, radius: primitives.radius.md, horizontalPadding: primitives.space.md }),
  iconButton: Object.freeze({ size: primitives.size.touch.default, radius: primitives.radius.pill, iconSize: primitives.size.icon.md }),
  input: Object.freeze({ minHeight: primitives.size.touch.default, multilineMinHeight: 112, radius: primitives.radius.md }),
  card: Object.freeze({ radius: primitives.radius.lg, padding: primitives.space.md, metricMinWidth: 158 }),
  tab: Object.freeze({ height: 72, iconSize: primitives.size.icon.md, topPadding: primitives.space.xs, bottomPadding: primitives.space.sm }),
  chip: Object.freeze({ minHeight: primitives.size.touch.minimum, radius: primitives.radius.pill, horizontalPadding: primitives.space.sm }),
  notice: Object.freeze({ radius: primitives.radius.md, padding: primitives.space.md, iconSize: primitives.size.icon.sm }),
  progress: Object.freeze({ height: primitives.space.xs, radius: primitives.radius.pill }),
  sheet: Object.freeze({ radius: primitives.radius.xl, padding: primitives.space.lg, maxWidth: 720 }),
  dialog: Object.freeze({ radius: primitives.radius.lg, padding: primitives.space.lg, maxWidth: 520 }),
  brand: Object.freeze({ crest: 92, crestCompact: 54, crestBorder: 2, letter: 42, letterCompact: 25, wordmark: 28, subtitle: 10 }),
  avatar: Object.freeze({ size: 56 }),
} as const);

const textStyle = (style: TextStyle): Readonly<TextStyle> => Object.freeze(style);
const type = primitives.typography;

export const textStyles = Object.freeze({
  display: textStyle({ fontFamily: type.family.uiExtraBold, fontSize: type.size.display, lineHeight: type.lineHeight.display, letterSpacing: type.letterSpacing.tight }),
  title: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.title, lineHeight: type.lineHeight.title, letterSpacing: type.letterSpacing.tight }),
  section: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.section, lineHeight: type.lineHeight.section, letterSpacing: type.letterSpacing.normal }),
  body: textStyle({ fontFamily: type.family.uiRegular, fontSize: type.size.body, lineHeight: type.lineHeight.body, letterSpacing: type.letterSpacing.normal }),
  bodySmall: textStyle({ fontFamily: type.family.uiRegular, fontSize: type.size.bodySmall, lineHeight: type.lineHeight.bodySmall, letterSpacing: type.letterSpacing.normal }),
  caption: textStyle({ fontFamily: type.family.uiRegular, fontSize: type.size.caption, lineHeight: type.lineHeight.caption, letterSpacing: type.letterSpacing.normal }),
  moneyXL: textStyle({ fontFamily: type.family.uiExtraBold, fontSize: type.size.display, lineHeight: type.lineHeight.display, fontVariant: ['tabular-nums'] }),
  moneyL: textStyle({ fontFamily: type.family.uiExtraBold, fontSize: type.size.title, lineHeight: type.lineHeight.title, fontVariant: ['tabular-nums'] }),
  moneyM: textStyle({ fontFamily: type.family.uiBold, fontSize: type.size.body, lineHeight: type.lineHeight.body, fontVariant: ['tabular-nums'] }),
  buttonLabel: textStyle({ fontFamily: type.family.uiBold, fontSize: 15, lineHeight: 20, letterSpacing: type.letterSpacing.normal }),
  tabLabel: textStyle({ fontFamily: type.family.uiSemiBold, fontSize: 11, lineHeight: 14, letterSpacing: type.letterSpacing.normal }),
  brand: textStyle({ fontFamily: type.family.brandRegular, fontSize: componentTokens.brand.wordmark, lineHeight: 34, letterSpacing: type.letterSpacing.brand }),
} as const);

export const dynamicType = Object.freeze({ enabled: true, maxFontSizeMultiplier: 2, moneyMaxFontSizeMultiplier: 1.6 });
export const breakpoints = Object.freeze({ compactMin: 320, mediumMin: 600, expandedMin: 840 });

export const colors = Object.freeze({
  background: semantic.bg.base, backgroundElevated: semantic.bg.elevated,
  surface: semantic.surface.default, surfaceRaised: semantic.surface.raised, surfacePressed: semantic.surface.pressed,
  border: semantic.border.default, borderStrong: semantic.border.strong,
  text: semantic.text.primary, textMuted: semantic.text.secondary, textSubtle: semantic.text.subtle,
  gold: semantic.action.primary, goldBright: semantic.text.accent, goldDark: semantic.action.primaryPressed,
  positive: semantic.status.positive, negative: semantic.status.negative, warning: semantic.status.warning, info: semantic.status.info,
  overlay: semantic.overlay.default, transparent: primitives.color.transparent,
} as const);
export const spacing = primitives.space;
export const radius = primitives.radius;
export const touch = Object.freeze({ minimum: primitives.size.touch.minimum, comfortable: primitives.size.touch.default });
export const shadows = Object.freeze({ card: semantic.elevation.card, overlay: semantic.elevation.overlay });

/** @deprecated New code uses textStyles. */
export const typography = Object.freeze({ display: type.size.display, title: type.size.title, section: type.size.section, body: type.size.body, bodySmall: type.size.bodySmall, caption: type.size.caption, lineHeightBody: type.lineHeight.body } as const);
