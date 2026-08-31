import 'expo-sqlite/localStorage/install';
import * as SystemUI from 'expo-system-ui';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import { isThemePreference, resolveTheme, THEME_PREFERENCE_STORAGE_KEY, type ThemePreference } from './theme-contract';
import { themeTokens, type ResolvedTheme, type ThemeTokens } from './tokens';

type ThemeContextValue = Readonly<{ preference: ThemePreference; resolvedTheme: ResolvedTheme; tokens: ThemeTokens; ready: boolean; setPreference(preference: ThemePreference): void }>;
const ThemeContext = createContext<ThemeContextValue | null>(null);

function supportedScheme(value: ReturnType<typeof Appearance.getColorScheme>): 'light' | 'dark' | null {
  return value === 'dark' || value === 'light' ? value : null;
}

function storedPreference(): ThemePreference {
  try { const value = globalThis.localStorage?.getItem(THEME_PREFERENCE_STORAGE_KEY); return isThemePreference(value) ? value : 'system'; } catch { return 'system'; }
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference);
  const [systemScheme, setSystemScheme] = useState<'light' | 'dark' | null>(() => supportedScheme(Appearance.getColorScheme()));
  const resolvedTheme = resolveTheme(preference, systemScheme);
  const tokens = themeTokens[resolvedTheme];
  useEffect(() => { const subscription = Appearance.addChangeListener(({ colorScheme }) => setSystemScheme(supportedScheme(colorScheme))); return () => subscription.remove(); }, []);
  useEffect(() => { void SystemUI.setBackgroundColorAsync(tokens.background.canvas); }, [tokens.background.canvas]);
  const setPreference = useCallback((next: ThemePreference) => { setPreferenceState(next); try { globalThis.localStorage?.setItem(THEME_PREFERENCE_STORAGE_KEY, next); } catch { /* device preference is non-critical */ } }, []);
  const value = useMemo<ThemeContextValue>(() => ({ preference, resolvedTheme, tokens, ready: true, setPreference }), [preference, resolvedTheme, setPreference, tokens]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAvioraTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useAvioraTheme deve ser usado dentro de ThemeProvider.');
  return context;
}
