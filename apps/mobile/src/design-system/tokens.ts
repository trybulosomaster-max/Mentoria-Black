export const colors = Object.freeze({
  background: '#050505',
  backgroundElevated: '#090909',
  surface: '#0D0D0D',
  surfaceRaised: '#121212',
  surfacePressed: '#181818',
  border: '#2B2B2B',
  borderStrong: '#454545',
  text: '#F5F5F5',
  textMuted: '#A6A6A6',
  textSubtle: '#777777',
  gold: '#C9A227',
  goldBright: '#E4C55B',
  goldDark: '#8F741F',
  positive: '#9ACA9D',
  negative: '#E2A0A0',
  warning: '#DFC878',
  info: '#AAB9D1',
  overlay: 'rgba(0, 0, 0, 0.72)',
  transparent: 'transparent',
} as const);

export const spacing = Object.freeze({
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const);

export const radius = Object.freeze({
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const);

export const typography = Object.freeze({
  display: 30,
  title: 24,
  section: 18,
  body: 15,
  bodySmall: 13,
  caption: 11,
  lineHeightBody: 22,
} as const);

export const touch = Object.freeze({
  minimum: 44,
  comfortable: 48,
} as const);

export const shadows = Object.freeze({
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    elevation: 7,
  },
} as const);
