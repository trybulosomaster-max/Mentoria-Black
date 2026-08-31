import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenFiles = ['index.tsx', 'lancamentos.tsx', 'planejamento.tsx', 'patrimonio.tsx', 'mais.tsx'] as const;

async function source(file: string) {
  return readFile(new URL(`../app/(tabs)/${file}`, import.meta.url), 'utf8');
}

test('Wave 1 permanece estritamente read-only', async () => {
  const privilegedCredentialPattern = new RegExp(['service', 'role'].join('_'));
  for (const file of screenFiles) {
    const content = await source(file);
    assert.doesNotMatch(content, /\.(?:insert|update|delete|upsert)\s*\(/, file);
    assert.doesNotMatch(content, /startTrial|supabaseAdmin/, file);
    assert.doesNotMatch(content, privilegedCredentialPattern, file);
  }
});

test('Dashboard usa componentes canônicos sem sintetizar gráfico ou valores', async () => {
  const content = await source('index.tsx');
  for (const component of ['FinancialMetric', 'MetricGroup', 'TransactionRow']) assert.match(content, new RegExp(`<${component}\\b`));
  assert.doesNotMatch(content, /<ChartCard\b/);
  assert.doesNotMatch(content, /4\.280|12\.480|7\.860|4\.620/);
});

test('Lançamentos, Planejamento e Patrimônio reutilizam primitives da Wave 1', async () => {
  assert.match(await source('lancamentos.tsx'), /<TransactionRow\b/);
  assert.match(await source('planejamento.tsx'), /<PlanningRow\b/);
  assert.match(await source('patrimonio.tsx'), /<AssetRow\b/);
});

test('Mais expõe somente System, Light e Dark com seleção acessível', async () => {
  const content = await source('mais.tsx');
  assert.match(content, /accessibilityRole="radiogroup"/);
  assert.match(content, /Sistema/);
  assert.match(content, /Patrimônio Sereno/);
  assert.match(content, /Noite Executiva/);
  assert.doesNotMatch(content, /Editorial Claro/);
});

test('Wave 1 não expõe linguagem interna de engenharia ao usuário', async () => {
  const forbiddenCopy = /esta onda|próxima onda|gates? próprios|read-only|contrato Mobile|backend Beta|cobertura do read model|snapshot conciliado|financeiro em leitura|somente leitura/i;
  for (const file of screenFiles) assert.doesNotMatch(await source(file), forbiddenCopy, file);
});

test('tab bar preserva os cinco rótulos completos em largura compacta', async () => {
  const layout = await readFile(new URL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
  for (const label of ['Início', 'Lançamentos', 'Planejamento', 'Patrimônio', 'Mais']) assert.match(layout, new RegExp(`title: '${label}'`));
  const tokens = await readFile(new URL('../src/design-system/tokens.ts', import.meta.url), 'utf8');
  assert.match(tokens, /tabLabel: textStyle\(\{[^}]*fontSize: 10/);
});

test('todas as superfícies Wave 1 consomem a mesma árvore temática', async () => {
  for (const file of screenFiles) {
    const content = await source(file);
    assert.match(content, /useAvioraTheme/);
    assert.doesNotMatch(content, /semantic\./);
  }
});
