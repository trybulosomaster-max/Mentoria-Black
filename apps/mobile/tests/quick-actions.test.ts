import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  isQuickActionId,
  QUICK_ACTION_IDS,
  QUICK_ACTIONS,
} from '../src/features/quick-actions/quick-action-contract.ts';
import { componentTokens } from '../src/design-system/tokens.ts';

async function source(relative: string): Promise<string> {
  return readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
}

test('contrato prepara exatamente quatro ações sem rota ou comando financeiro', () => {
  assert.deepEqual(QUICK_ACTION_IDS, ['income', 'card_purchase', 'transfer', 'expense']);
  assert.deepEqual(QUICK_ACTIONS.map((action) => action.label), [
    'Receitas',
    'Despesa Cartão',
    'Transferência',
    'Despesa',
  ]);
  assert.equal(new Set(QUICK_ACTIONS.map((action) => action.id)).size, 4);
  for (const action of QUICK_ACTIONS) {
    assert.equal(Object.isFrozen(action), true);
    assert.equal('route' in action, false);
    assert.equal('href' in action, false);
    assert.equal('command' in action, false);
  }
  assert.equal(Object.isFrozen(QUICK_ACTIONS), true);
  assert.equal(isQuickActionId('transfer'), true);
  assert.equal(isQuickActionId('investment'), false);
  assert.equal(isQuickActionId(null), false);
});

test('host global mantém cinco abas e não cria uma sexta rota', async () => {
  const layout = await source('app/(tabs)/_layout.tsx');
  assert.equal((layout.match(/<Tabs\.Screen\b/g) ?? []).length, 5);
  assert.equal((layout.match(/<QuickActionHost\b/g) ?? []).length, 1);
  for (const tab of ['Início', 'Lançamentos', 'Planejamento', 'Patrimônio', 'Mais']) {
    assert.match(layout, new RegExp(`title: '${tab}'`));
  }
  assert.match(layout, /<QuickActionHost tabBarHeight=\{tabBarHeight\} \/>/);
  assert.doesNotMatch(layout, /QuickActionHost[^>]*(?:handler|route|href)/);
});

test('Quick Add abre e fecha com haptic, safe area e Reduce Motion', async () => {
  const host = await source('src/features/quick-actions/quick-action-host.tsx');
  assert.match(host, /tabBarHeight \+ spacing\.xs/);
  assert.equal(componentTokens.quickAction.triggerSize, 56);
  assert.equal(componentTokens.quickAction.actionSize, 48);
  assert.equal(componentTokens.quickAction.slotWidth, 104);
  assert.equal(componentTokens.quickAction.slotHeight, 100);
  assert.ok(componentTokens.quickAction.contentClearance >= componentTokens.quickAction.triggerSize + 16);
  assert.match(host, /const TRIGGER_SIZE = componentTokens\.quickAction\.triggerSize/);
  assert.match(host, /const ACTION_SIZE = componentTokens\.quickAction\.actionSize/);
  assert.match(host, /accessibilityLabel="Abrir ações rápidas"/);
  assert.match(host, /accessibilityLabel="Fechar ações rápidas"/);
  assert.match(host, /accessibilityViewIsModal/);
  assert.match(host, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(host, /useReducedMotion\(\)/);
  assert.match(host, /if \(reducedMotion\)[\s\S]*?progress\.setValue\(1\)/);
  assert.match(host, /Animated\.timing\(progress/);
  assert.match(host, /ImpactFeedbackStyle\.Light/);
  assert.match(host, /outputRange: \['0deg', '45deg'\]/);
  assert.match(host, /keyboardDidShow/);
  assert.match(host, /!visible && !keyboardVisible/);
  assert.doesNotMatch(host, /<Modal\b|\bModal,/);
});

test('ações flutuam diretamente no overlay, sem card, e permanecem estritamente read-only', async () => {
  const [host, contract] = await Promise.all([
    source('src/features/quick-actions/quick-action-host.tsx'),
    source('src/features/quick-actions/quick-action-contract.ts'),
  ]);
  const combined = `${host}\n${contract}`;
  assert.match(host, /const enabled = Boolean\(handlers\[action\.id\]\)/);
  assert.match(host, /disabled=\{!enabled\}/);
  assert.match(host, /Fluxo ainda não conectado/);
  assert.match(host, /styles\.actionOrbit/);
  assert.match(host, /function radialTarget/);
  assert.match(host, /const upperPair = action\.id === 'income' \|\| action\.id === 'card_purchase'/);
  assert.match(host, /const rightSide = action\.id === 'card_purchase' \|\| action\.id === 'expense'/);
  assert.match(host, /x: rightSide \? horizontalOffset : -horizontalOffset/);
  assert.match(host, /y: verticalOffset/);
  assert.match(host, /action\.id === 'card_purchase' \? 'Despesa\\nCartão'/);
  assert.match(host, /maxFontSizeMultiplier=\{dynamicType\.tabLabelMaxFontSizeMultiplier\}/);
  assert.match(host, /styles\.actionLabelBox/);
  assert.match(host, /actionLabelBox: \{[\s\S]*?minHeight: primitives\.typography\.lineHeight\.button \* 2[\s\S]*?alignItems: 'center'/);
  assert.match(host, /actionLabel: \{[\s\S]*?width: '100%'[\s\S]*?alignSelf: 'center'[\s\S]*?textAlign: 'center'/);
  assert.match(host, /outputRange: \[0, target\.x\]/);
  assert.match(host, /outputRange: \[0, target\.y\]/);
  assert.match(host, /outputRange: \[0\.72, 1\]/);
  const actionOrbit = host.match(/actionOrbit: \{([\s\S]*?)\n    \},/)?.[1] ?? '';
  assert.doesNotMatch(actionOrbit, /backgroundColor|borderColor|borderWidth|borderRadius|elevation|shadow/);
  assert.doesNotMatch(host, /actionGrid|actionField|pendingLabel|Em breve|<Modal\b|\bModal,/);
  assert.doesNotMatch(combined, /expo-router|supabase|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/i);
});

test('shell reserva uma zona inferior única para o FAB sem offsets por tela', async () => {
  const [components, home, transactions, more, planning, patrimony] = await Promise.all([
    source('src/design-system/components.tsx'),
    source('app/(tabs)/index.tsx'),
    source('app/(tabs)/lancamentos.tsx'),
    source('app/(tabs)/mais.tsx'),
    source('app/(tabs)/planejamento.tsx'),
    source('app/(tabs)/patrimonio.tsx'),
  ]);
  assert.match(components, /variant === 'tab'[\s\S]*?componentTokens\.quickAction\.contentClearance/);
  assert.match(components, /componentTokens\.screen\.bottomPadding \+ shellClearance \+ insets\.bottom/);
  for (const screen of [home, transactions, more, planning, patrimony]) {
    assert.match(screen, /<Screen\b/);
    assert.doesNotMatch(screen, /quickAction.*(?:padding|offset|inset)|fab.*(?:padding|offset|inset)/i);
  }
});

test('Quick Add permanece fail-closed mesmo com as quatro ações visíveis', async () => {
  const [layout, host, contract, accessContext, capabilityRegistry] = await Promise.all([
    source('app/(tabs)/_layout.tsx'),
    source('src/features/quick-actions/quick-action-host.tsx'),
    source('src/features/quick-actions/quick-action-contract.ts'),
    source('src/application/foundation/access-context-factory.ts'),
    source('src/domain/foundation/capability-registry.ts'),
  ]);
  const boundary = `${layout}\n${host}\n${contract}`;
  assert.match(layout, /<QuickActionHost tabBarHeight=\{tabBarHeight\} \/>/);
  assert.doesNotMatch(layout, /QuickActionHost[^>]*(?:handlers|route|href|command)/);
  assert.match(host, /handlers = EMPTY_HANDLERS/);
  assert.match(host, /if \(!handler\) return/);
  assert.match(host, /disabled=\{!enabled\}/);
  assert.match(accessContext, /permissions = new Set<string>\(\)/);
  assert.match(accessContext, /financialWrites: false/);
  assert.match(capabilityRegistry, /'financial\.write'[\s\S]*?requiredPermission: 'financial:write'/);
  assert.doesNotMatch(boundary, /@supabase\/supabase-js|\.from\s*\(|\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(|fetch\s*\(|axios|XMLHttpRequest/i);
});

test('geometria compacta preserva respiro entre atalhos em telas menores', async () => {
  const host = await source('src/features/quick-actions/quick-action-host.tsx');
  assert.match(host, /componentTokens\.quickAction\.sideOffsetXMax/);
  assert.match(host, /componentTokens\.quickAction\.sideOffsetXMin/);

  const slotWidth = componentTokens.quickAction.slotWidth;
  const slotHeight = componentTokens.quickAction.slotHeight;
  const iconRadius = componentTokens.quickAction.actionSize / 2;
  const bounds = (x: number, y: number) => ({
    left: x - (slotWidth / 2),
    right: x + (slotWidth / 2),
    top: y - iconRadius,
    bottom: y - iconRadius + slotHeight,
  });
  const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );

  for (const width of [280, 320, 375, 390, 430]) {
    const sideRadius = Math.min(
      componentTokens.quickAction.sideOffsetXMax,
      Math.max(componentTokens.quickAction.sideOffsetXMin, (width - slotWidth - 8) / 2),
    );
    const items = [
      bounds(-componentTokens.quickAction.topOffsetX, componentTokens.quickAction.topOffsetY),
      bounds(componentTokens.quickAction.topOffsetX, componentTokens.quickAction.topOffsetY),
      bounds(-sideRadius, componentTokens.quickAction.sideOffsetY),
      bounds(sideRadius, componentTokens.quickAction.sideOffsetY),
    ];
    assert.equal(items[0].left, -items[1].right);
    assert.equal(items[0].right, -items[1].left);
    assert.equal(items[0].top, items[1].top);
    assert.equal(items[0].bottom, items[1].bottom);
    assert.equal(items[2].left, -items[3].right);
    assert.equal(items[2].right, -items[3].left);
    assert.equal(items[2].top, items[3].top);
    assert.equal(items[2].bottom, items[3].bottom);
    for (let left = 0; left < items.length; left += 1) {
      for (let right = left + 1; right < items.length; right += 1) {
        assert.equal(overlaps(items[left], items[right]), false, `atalhos ${left}/${right} colidem em ${width}px`);
      }
    }
    assert.ok((width / 2) + items[2].left >= 4, `atalho esquerdo corta em ${width}px`);
    assert.ok((width / 2) + items[3].right <= width - 4, `atalho direito corta em ${width}px`);
  }
});
