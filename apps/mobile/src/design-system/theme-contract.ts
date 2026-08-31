import type { ResolvedTheme } from './tokens.ts';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark'] as const);
export const THEME_PREFERENCE_STORAGE_KEY = 'aviora:appearance:v2';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.includes(value as ThemePreference);
}

export function resolveTheme(preference: ThemePreference, systemScheme: 'light' | 'dark' | null | undefined): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}
