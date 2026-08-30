import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  breakpoints,
  componentTokens,
  dynamicType,
  primitives,
  semantic,
  textStyles,
} from '../src/design-system/tokens.ts';
import {
  resolveResponsiveLayout,
  resolveResponsiveMode,
} from '../src/design-system/responsive-contract.ts';

test('expõe as três camadas obrigatórias de tokens', () => {
  assert.deepEqual(Object.keys(primitives.color).slice(0, 6), ['neutral', 'gold', 'green', 'red', 'yellow', 'blue']);
  assert.equal(semantic.bg.base, primitives.color.neutral[1000]);
  assert.equal(semantic.action.primary, primitives.color.gold[500]);
  assert.ok(componentTokens.button.minHeight >= 44);
  assert.ok(componentTokens.iconButton.size >= 44);
  assert.ok(componentTokens.input.minHeight >= 44);
});

test('congela tipografia escalável e números tabulares', () => {
  assert.match(String(textStyles.body.fontFamily), /^Inter_/);
  assert.match(String(textStyles.brand.fontFamily), /^Syncopate_/);
  assert.deepEqual(textStyles.moneyM.fontVariant, ['tabular-nums']);
  assert.equal(dynamicType.enabled, true);
  assert.ok(dynamicType.maxFontSizeMultiplier >= 2);
});

test('resolve Compact, Medium e Expanded nas fronteiras congeladas', () => {
  assert.equal(resolveResponsiveMode(breakpoints.compactMin), 'compact');
  assert.equal(resolveResponsiveMode(breakpoints.mediumMin - 1), 'compact');
  assert.equal(resolveResponsiveMode(breakpoints.mediumMin), 'medium');
  assert.equal(resolveResponsiveMode(breakpoints.expandedMin - 1), 'medium');
  assert.equal(resolveResponsiveMode(breakpoints.expandedMin), 'expanded');
  assert.equal(resolveResponsiveLayout(390).columns, 1);
  assert.equal(resolveResponsiveLayout(768).columns, 8);
  assert.equal(resolveResponsiveLayout(1024).columns, 12);
});

test('mantém o contrato canônico de ícones vetoriais', async () => {
  const source = await readFile(new URL('../src/design-system/icons.tsx', import.meta.url), 'utf8');
  for (const name of ['home', 'transactions', 'planning', 'patrimony', 'more', 'search', 'filter', 'wallet', 'knowledge', 'security', 'success', 'error']) {
    assert.match(source, new RegExp(`\\b${name}:|'${name}':`));
  }
  assert.match(source, /@expo\/vector-icons\/Ionicons/);
});

test('expõe Screen variants e todos os componentes fundamentais', async () => {
  const source = await readFile(new URL('../src/design-system/components.tsx', import.meta.url), 'utf8');
  for (const variant of ['tab', 'stack', 'modal', 'auth']) assert.match(source, new RegExp(`'${variant}'`));
  for (const component of ['AppButton', 'IconButton', 'TextField', 'SearchField', 'Card', 'MetricCard', 'StatusPill', 'FilterChip', 'InlineNotice', 'StateView', 'Divider', 'PageHeader', 'SectionTitle', 'ProgressBar', 'BottomSheet', 'Dialog']) {
    assert.match(source, new RegExp(`export (?:function|const) ${component}\\b`));
  }
  assert.doesNotMatch(source, /<Text\b[^>]*\bonPress=/);
});
