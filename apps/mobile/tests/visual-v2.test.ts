import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isThemePreference, migrateThemePreference, resolveTheme, THEME_PREFERENCES } from '../src/design-system/theme-contract.ts';
import { dynamicType, textStyles, themeTokens } from '../src/design-system/tokens.ts';

function relativeLuminance(hex: string) {
  assert.match(hex, /^#[0-9A-F]{6}$/i, `cor hexadecimal inválida: ${hex}`);
  const channels = hex.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  return channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
}

function contrast(foreground: string, background: string) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function assertContrastAtLeast(role: string, foreground: string, background: string, minimum: number) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= minimum, `${role}: ${foreground} sobre ${background} resulta em ${ratio.toFixed(2)}:1; mínimo ${minimum}:1`);
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
  for (const group of ['background', 'text', 'border', 'brand', 'action', 'status', 'chart', 'navigation', 'focus'] as const) {
    assert.deepEqual(Object.keys(themeTokens.serene[group]), Object.keys(themeTokens.white[group]));
    assert.deepEqual(Object.keys(themeTokens.serene[group]), Object.keys(themeTokens.dark[group]));
  }
});

test('texto normal preserva 4,5:1 em cada superfície realmente utilizada', () => {
  for (const tokens of [themeTokens.serene, themeTokens.white, themeTokens.dark]) {
    const surfaces = Object.entries(tokens.background);
    for (const [surface, background] of surfaces) {
      assertContrastAtLeast(`${tokens.id}: texto principal/${surface}`, tokens.text.primary, background, 4.5);
      assertContrastAtLeast(`${tokens.id}: texto secundário/${surface}`, tokens.text.secondary, background, 4.5);
      assertContrastAtLeast(`${tokens.id}: ação textual/${surface}`, tokens.action.text, background, 4.5);
      assertContrastAtLeast(`${tokens.id}: status positivo/${surface}`, tokens.status.positiveText, background, 4.5);
      assertContrastAtLeast(`${tokens.id}: status negativo/${surface}`, tokens.status.riskText, background, 4.5);
      assertContrastAtLeast(`${tokens.id}: status de aviso/${surface}`, tokens.status.warning, background, 4.5);
      assertContrastAtLeast(`${tokens.id}: status informativo/${surface}`, tokens.status.info, background, 4.5);
    }
    assertContrastAtLeast(`${tokens.id}: conteúdo do botão primário`, tokens.action.onPrimary, tokens.action.primary, 4.5);
    assertContrastAtLeast(`${tokens.id}: tab selecionada`, tokens.navigation.selected, tokens.navigation.background, 4.5);
    assertContrastAtLeast(`${tokens.id}: tab não selecionada`, tokens.navigation.unselected, tokens.navigation.background, 4.5);
  }
});

test('ações, controles, foco, seleção e séries essenciais preservam 3:1', () => {
  for (const tokens of [themeTokens.serene, themeTokens.white, themeTokens.dark]) {
    const surfaces = Object.entries(tokens.background);
    for (const [surface, background] of surfaces) {
      assertContrastAtLeast(`${tokens.id}: limite forte/${surface}`, tokens.border.strong, background, 3);
      assertContrastAtLeast(`${tokens.id}: foco/${surface}`, tokens.focus.ring, background, 3);
      assertContrastAtLeast(`${tokens.id}: ação preenchida/${surface}`, tokens.action.primary, background, 3);
      assertContrastAtLeast(`${tokens.id}: seleção/${surface}`, tokens.action.primary, background, 3);
      assertContrastAtLeast(`${tokens.id}: borda positiva/${surface}`, tokens.status.positive, background, 3);
      assertContrastAtLeast(`${tokens.id}: borda negativa/${surface}`, tokens.status.risk, background, 3);
      assertContrastAtLeast(`${tokens.id}: borda de aviso/${surface}`, tokens.status.warning, background, 3);
      assertContrastAtLeast(`${tokens.id}: borda informativa/${surface}`, tokens.status.info, background, 3);
    }
    for (const [surface, background] of Object.entries({ surface: tokens.background.surface, surfaceMuted: tokens.background.surfaceMuted })) {
      assertContrastAtLeast(`${tokens.id}: série realizada/${surface}`, tokens.chart.actual, background, 3);
      assertContrastAtLeast(`${tokens.id}: série projetada/${surface}`, tokens.chart.projected, background, 3);
    }
  }
});

test('dourado decorativo não é reutilizado como texto ou ação incompatível', async () => {
  assert.notEqual(themeTokens.serene.brand.accent, themeTokens.serene.action.text);
  assert.notEqual(themeTokens.white.brand.accent, themeTokens.white.action.text);
  const components = await readFile(new URL('../src/design-system/components.tsx', import.meta.url), 'utf8');
  const financial = await readFile(new URL('../src/design-system/financial-components.tsx', import.meta.url), 'utf8');
  assert.match(components, /variant === 'primary' \? tokens\.action\.onPrimary/);
  assert.match(components, /button_primary: \{ backgroundColor: tokens\.action\.primary/);
  assert.match(components, /eyebrow: \{[^\n]*color: tokens\.action\.text/);
  assert.match(components, /pillText_gold: \{ color: tokens\.action\.text/);
  assert.match(components, /filterChipSelected: \{ borderColor: tokens\.action\.primary/);
  assert.match(financial, /metricTone_brand: \{ color: tokens\.action\.text/);
  assert.match(financial, /themeRowSelected: \{ borderColor: tokens\.action\.primary/);
  assert.doesNotMatch(components, /button_primary: \{[^\n]*tokens\.brand\.accent/);
  assert.doesNotMatch(components, /eyebrow: \{[^\n]*tokens\.brand\.accent/);
});

test('componentes interativos usam limites, foco e estado desabilitado sem ambiguidade', async () => {
  const components = await readFile(new URL('../src/design-system/components.tsx', import.meta.url), 'utf8');
  const financial = await readFile(new URL('../src/design-system/financial-components.tsx', import.meta.url), 'utf8');
  assert.match(components, /controlFocused: \{ borderColor: tokens\.focus\.ring/);
  assert.match(components, /input: \{[^\n]*borderColor: tokens\.border\.strong/);
  assert.match(components, /searchField: \{[^\n]*borderColor: tokens\.border\.strong/);
  assert.match(components, /filterChip: \{[^\n]*borderColor: tokens\.border\.strong/);
  assert.match(components, /accessibilityState=\{\{ disabled: blocked, busy: loading \}\}/);
  assert.match(components, /buttonDisabled: \{ opacity: primitives\.opacity\.disabled \}/);
  assert.match(financial, /themeRow: \{[^\n]*borderColor: tokens\.border\.strong/);
  assert.match(financial, /themeRowFocused: \{ borderColor: tokens\.focus\.ring/);
});

test('títulos, valores e linhas financeiras fazem reflow sem truncamento fixo', async () => {
  const components = await readFile(new URL('../src/design-system/components.tsx', import.meta.url), 'utf8');
  const financial = await readFile(new URL('../src/design-system/financial-components.tsx', import.meta.url), 'utf8');
  const tabs = await readFile(new URL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(components, /numberOfLines=\{1\} style=\{styles\.(?:metricValue|pageTitle|sectionTitle)\}/);
  assert.doesNotMatch(components, /adjustsFontSizeToFit[^>]*style=\{styles\.(?:metricValue|pageTitle|sectionTitle|stateTitle)\}/);
  assert.doesNotMatch(financial, /numberOfLines=\{2\} style=\{styles\.rowTitle\}/);
  assert.match(components, /pageTitleRow: \{[^\n]*flexWrap: 'wrap'/);
  assert.match(components, /sectionHeader: \{[^\n]*flexWrap: 'wrap'/);
  assert.match(financial, /rowTop: \{[^\n]*flexWrap: 'wrap'/);
  assert.match(financial, /fontScale >= dynamicType\.metricReflowFontScale && styles\.metricGroupReflow/);
  assert.match(financial, /metricGroupReflow: \{[^\n]*flexDirection: 'column', flexWrap: 'nowrap'/);
  assert.equal('lineHeight' in textStyles.body, false);
  assert.equal('lineHeight' in textStyles.title, false);
  assert.equal('lineHeight' in textStyles.moneyM, false);
  assert.match(tabs, /maxFontSizeMultiplier=\{dynamicType\.tabLabelMaxFontSizeMultiplier\}/);
  assert.doesNotMatch(tabs, /maxFontSizeMultiplier=\{1\}/);
  assert.match(tabs, /scaledLabelAllowance/);
  assert.match(tabs, /numberOfLines=\{2\}/);
  assert.ok(dynamicType.tabLabelMaxFontSizeMultiplier > 1);
  assert.ok(dynamicType.tabLabelMaxFontSizeMultiplier <= dynamicType.headingMaxFontSizeMultiplier);
  assert.ok(dynamicType.metricReflowFontScale <= 1.3);
});

test('Reduce Motion governa navegação, overlays e feedback de pressão', async () => {
  const system = await readFile(new URL('../src/design-system/system.ts', import.meta.url), 'utf8');
  const rootLayout = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  const publicLayout = await readFile(new URL('../app/(public)/_layout.tsx', import.meta.url), 'utf8');
  const components = await readFile(new URL('../src/design-system/components.tsx', import.meta.url), 'utf8');
  assert.match(system, /useState\(true\)/);
  assert.match(system, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(system, /reduceMotionChanged/);
  assert.match(rootLayout, /<ReducedMotionProvider>/);
  assert.match(rootLayout, /animation: reducedMotion \? 'none' : 'fade'/);
  assert.match(publicLayout, /animation: reducedMotion \? 'none' : 'slide_from_right'/);
  assert.match(components, /animationType=\{reducedMotion \? 'none' : 'slide'\}/);
  assert.match(components, /animationType=\{reducedMotion \? 'none' : 'fade'\}/);
  assert.match(components, /reducedMotion \? styles\.buttonPressedReduced : styles\.buttonPressed/);
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
