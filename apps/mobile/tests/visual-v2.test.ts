import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isThemePreference, migrateThemePreference, resolveTheme, THEME_PREFERENCES } from '../src/design-system/theme-contract.ts';
import { themeTokens } from '../src/design-system/tokens.ts';

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  return channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
}

function contrast(foreground: string, background: string) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('resolve System para a aparência suportada pelo dispositivo', () => {
  assert.equal(resolveTheme('system', 'light'), 'serene');
  assert.equal(resolveTheme('system', 'dark'), 'dark');
  assert.equal(resolveTheme('system', null), 'serene');
});

test('preferência explícita prevalece sobre o sistema', () => {
  assert.equal(resolveTheme('serene', 'dark'), 'serene');
  assert.equal(resolveTheme('white', 'dark'), 'white');
  assert.equal(resolveTheme('dark', 'light'), 'dark');
});

test('runtime contém System e os três temas A, B e C', () => {
  assert.deepEqual(THEME_PREFERENCES, ['system', 'serene', 'white', 'dark']);
  assert.equal(isThemePreference('system'), true);
  assert.equal(isThemePreference('serene'), true);
  assert.equal(isThemePreference('white'), true);
  assert.equal(isThemePreference('dark'), true);
  assert.equal(isThemePreference('light'), false);
  assert.equal(isThemePreference('editorial'), false);
});

test('preferência Light anterior migra para Sereno sem introduzir tema legado', () => {
  assert.equal(migrateThemePreference('light'), 'serene');
  assert.equal(migrateThemePreference('serene'), 'serene');
  assert.equal(migrateThemePreference('white'), 'white');
  assert.equal(migrateThemePreference('unknown'), null);
});

test('tokens A e C preservam o freeze e B materializa Branco Executivo', () => {
  assert.equal(themeTokens.serene.id, 'aviora-light-a');
  assert.equal(themeTokens.serene.background.canvas, '#F7F3EC');
  assert.equal(themeTokens.serene.background.surface, '#FFFCF7');
  assert.equal(themeTokens.serene.text.primary, '#17212B');
  assert.equal(themeTokens.serene.brand.accent, '#C4A56B');
  assert.equal(themeTokens.white.id, 'aviora-white-b');
  assert.equal(themeTokens.white.background.canvas, '#FEFDFC');
  assert.equal(themeTokens.white.background.surface, '#FFFFFF');
  assert.equal(themeTokens.white.text.primary, '#263543');
  assert.equal(themeTokens.white.status.positive, '#277F84');
  assert.equal(themeTokens.white.status.risk, '#C66A5D');
  assert.equal(themeTokens.white.chart.projected, '#6B5AA7');
  assert.equal(themeTokens.dark.id, 'aviora-dark-c');
  assert.equal(themeTokens.dark.background.canvas, '#0E1822');
  assert.equal(themeTokens.dark.background.surface, '#152635');
  assert.equal(themeTokens.dark.text.primary, '#E7E0D5');
  assert.equal(themeTokens.dark.brand.accent, '#C4A56B');
});

test('A, B e C mantêm a mesma estrutura sem árvore temática paralela', () => {
  assert.deepEqual(Object.keys(themeTokens.serene), Object.keys(themeTokens.white));
  assert.deepEqual(Object.keys(themeTokens.serene), Object.keys(themeTokens.dark));
  for (const group of ['background', 'text', 'border', 'brand', 'status', 'chart', 'navigation', 'focus'] as const) {
    assert.deepEqual(Object.keys(themeTokens.serene[group]), Object.keys(themeTokens.white[group]));
    assert.deepEqual(Object.keys(themeTokens.serene[group]), Object.keys(themeTokens.dark[group]));
  }
});

test('texto principal e secundário preservam contraste AA nas superfícies canônicas', () => {
  for (const tokens of [themeTokens.serene, themeTokens.white, themeTokens.dark]) {
    assert.ok(contrast(tokens.text.primary, tokens.background.canvas) >= 4.5);
    assert.ok(contrast(tokens.text.primary, tokens.background.surface) >= 4.5);
    assert.ok(contrast(tokens.text.secondary, tokens.background.canvas) >= 4.5);
    assert.ok(contrast(tokens.text.secondary, tokens.background.surface) >= 4.5);
  }
  assert.ok(contrast(themeTokens.white.brand.accent, themeTokens.white.background.surface) >= 3);
  assert.ok(contrast(themeTokens.white.status.positiveText, themeTokens.white.background.surface) >= 4.5);
  assert.ok(contrast(themeTokens.white.status.riskText, themeTokens.white.background.surface) >= 4.5);
});

test('provider persiste preferência local e observa aparência do sistema', async () => {
  const source = await readFile(new URL('../src/design-system/theme-provider.tsx', import.meta.url), 'utf8');
  assert.match(source, /localStorage\?\.setItem\(THEME_PREFERENCE_STORAGE_KEY/);
  assert.match(source, /LEGACY_THEME_PREFERENCE_STORAGE_KEY/);
  assert.match(source, /migrateThemePreference/);
  assert.match(source, /useColorScheme\(\)/);
  assert.match(source, /resolveTheme\(preference, systemScheme\)/);
  assert.doesNotMatch(source, /supabase|database|remote/i);
});

test('primeiro conteúdo visível aguarda a resolução do tema', async () => {
  const source = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(source, /fontsReady && bootstrapReady && themeReady/);
  assert.match(source, /<ThemeProvider>/);
});
