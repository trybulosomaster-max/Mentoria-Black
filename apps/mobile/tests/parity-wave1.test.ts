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

test('Dashboard usa componentes canônicos e declara gap de gráfico', async () => {
  const content = await source('index.tsx');
  for (const component of ['FinancialMetric', 'MetricGroup', 'TransactionRow', 'ChartCard']) assert.match(content, new RegExp(`<${component}\\b`));
  assert.match(content, /Nenhuma curva foi sintetizada/);
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

test('todas as superfícies Wave 1 consomem a mesma árvore temática', async () => {
  for (const file of screenFiles) {
    const content = await source(file);
    assert.match(content, /useAvioraTheme/);
    assert.doesNotMatch(content, /semantic\./);
  }
});
