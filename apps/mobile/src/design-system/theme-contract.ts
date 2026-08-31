import type { ResolvedTheme } from './tokens.ts';

export type ThemePreference = 'system' | 'serene' | 'white' | 'dark';
export const THEME_PREFERENCES = Object.freeze(['system', 'serene', 'white', 'dark'] as const);
export const THEME_PREFERENCE_STORAGE_KEY = 'aviora:appearance:v3';
export const LEGACY_THEME_PREFERENCE_STORAGE_KEY = 'aviora:appearance:v2';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.includes(value as ThemePreference);
}

export function migrateThemePreference(value: unknown): ThemePreference | null {
  if (isThemePreference(value)) return value;
  if (value === 'light') return 'serene';
  return null;
}

export function resolveTheme(preference: ThemePreference, systemScheme: 'light' | 'dark' | null | undefined): ResolvedTheme {
  if (preference !== 'system') return preference;
  return systemScheme === 'dark' ? 'dark' : 'serene';
}
