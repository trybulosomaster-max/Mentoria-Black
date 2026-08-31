import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isThemePreference, resolveTheme, THEME_PREFERENCES } from '../src/design-system/theme-contract.ts';
import { themeTokens } from '../src/design-system/tokens.ts';

test('resolve System para a aparência suportada pelo dispositivo', () => {
  assert.equal(resolveTheme('system', 'light'), 'light');
  assert.equal(resolveTheme('system', 'dark'), 'dark');
  assert.equal(resolveTheme('system', null), 'light');
});

test('preferência explícita prevalece sobre o sistema', () => {
  assert.equal(resolveTheme('light', 'dark'), 'light');
  assert.equal(resolveTheme('dark', 'light'), 'dark');
});

test('runtime contém somente System, Light e Dark', () => {
  assert.deepEqual(THEME_PREFERENCES, ['system', 'light', 'dark']);
  assert.equal(isThemePreference('system'), true);
  assert.equal(isThemePreference('light'), true);
  assert.equal(isThemePreference('dark'), true);
  assert.equal(isThemePreference('editorial'), false);
});

test('tokens A e C correspondem ao freeze canônico', () => {
  assert.equal(themeTokens.light.id, 'aviora-light-a');
  assert.equal(themeTokens.light.background.canvas, '#F7F3EC');
  assert.equal(themeTokens.light.background.surface, '#FFFCF7');
  assert.equal(themeTokens.light.text.primary, '#17212B');
  assert.equal(themeTokens.light.brand.accent, '#C4A56B');
  assert.equal(themeTokens.dark.id, 'aviora-dark-c');
  assert.equal(themeTokens.dark.background.canvas, '#0E1822');
  assert.equal(themeTokens.dark.background.surface, '#152635');
  assert.equal(themeTokens.dark.text.primary, '#E7E0D5');
  assert.equal(themeTokens.dark.brand.accent, '#C4A56B');
});

test('A e C mantêm a mesma estrutura sem árvore temática paralela', () => {
  assert.deepEqual(Object.keys(themeTokens.light), Object.keys(themeTokens.dark));
  for (const group of ['background', 'text', 'border', 'brand', 'status', 'chart', 'navigation', 'focus'] as const) {
    assert.deepEqual(Object.keys(themeTokens.light[group]), Object.keys(themeTokens.dark[group]));
  }
});

test('provider persiste preferência local e observa aparência do sistema', async () => {
  const source = await readFile(new URL('../src/design-system/theme-provider.tsx', import.meta.url), 'utf8');
  assert.match(source, /localStorage\?\.setItem\(THEME_PREFERENCE_STORAGE_KEY/);
  assert.match(source, /Appearance\.addChangeListener/);
  assert.match(source, /resolveTheme\(preference, systemScheme\)/);
  assert.doesNotMatch(source, /supabase|database|remote/i);
});

test('primeiro conteúdo visível aguarda a resolução do tema', async () => {
  const source = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(source, /fontsReady && bootstrapReady && themeReady/);
  assert.match(source, /<ThemeProvider>/);
});
