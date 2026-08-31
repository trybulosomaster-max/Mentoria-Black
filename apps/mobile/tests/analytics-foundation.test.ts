import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canAdvanceDrilldown,
  createMetricRegistry,
  DRILLDOWN_LEVELS,
  FINANCIAL_SERIES_PRESENTATION,
  metricRegistry,
  type AnalyticsState,
  type MetricEnvelope,
} from '../src/domain/analytics/analytics-contracts.ts';

test('estados analíticos distinguem partial e stale de success', () => {
  const states: readonly AnalyticsState<readonly number[]>[] = [
    { status: 'loading' },
    { status: 'empty', reason: 'Sem fatos canônicos no período.' },
    { status: 'partial', data: [1], asOf: '2026-08-31', missing: ['projection'] },
    { status: 'stale', data: [1], asOf: '2026-08-30', staleSince: '2026-08-31' },
    { status: 'error', code: 'READ_MODEL_UNAVAILABLE', recoverable: true },
    { status: 'unauthorized' },
    { status: 'success', data: [1], asOf: '2026-08-31' },
  ];
  assert.deepEqual(states.map((state) => state.status), ['loading', 'empty', 'partial', 'stale', 'error', 'unauthorized', 'success']);
});

test('registry nasce vazio e rejeita definição duplicada', () => {
  assert.equal(metricRegistry.definitions.length, 0);
  const definition = { metricId: 'canonical.example', metricVersion: 1, unit: 'BRL', currency: 'BRL', format: 'currency', allowedComparisons: ['none'], requiredPermissions: [], drilldownAvailable: false } as const;
  assert.throws(() => createMetricRegistry([definition, definition]), /Duplicate metric definition/);
});

test('contrato de métrica carrega autoridade e qualidade sem calcular valor', () => {
  const metric: MetricEnvelope = {
    metricId: 'canonical.example', metricVersion: 1, asOf: '2026-08-31',
    period: { start: '2026-08-01', end: '2026-08-31', timezone: 'America/Sao_Paulo', label: 'Agosto de 2026' },
    scope: { resourceOwnerId: 'owner-redacted' }, series: [],
    quality: { status: 'partial', asOf: '2026-08-31', notes: ['Read model incompleto.'] },
    drilldown: { available: false }, accessibility: { summary: 'Sem série canônica disponível.', equivalent: 'text' },
  };
  assert.equal(metric.quality.status, 'partial');
  assert.equal(metric.series.length, 0);
});

test('drill-down segue Resumo, Comparação, Composição e Evidência', () => {
  assert.deepEqual(DRILLDOWN_LEVELS, ['summary', 'comparison', 'composition', 'evidence']);
  assert.equal(canAdvanceDrilldown('summary', 'comparison'), true);
  assert.equal(canAdvanceDrilldown('summary', 'composition'), false);
  assert.equal(canAdvanceDrilldown('evidence', 'summary'), false);
});

test('realizado, programado, projetado e previsão possuem texto, traço e forma próprios', () => {
  const values = Object.values(FINANCIAL_SERIES_PRESENTATION);
  assert.equal(new Set(values.map((value) => value.label)).size, 4);
  assert.equal(FINANCIAL_SERIES_PRESENTATION.realized.lineStyle, 'solid');
  assert.equal(FINANCIAL_SERIES_PRESENTATION.projected.lineStyle, 'dashed');
  assert.notEqual(FINANCIAL_SERIES_PRESENTATION.realized.marker, FINANCIAL_SERIES_PRESENTATION.projected.marker);
});

test('fundação analítica é pura, sem Supabase, rede, fórmula ou dados demonstrativos', async () => {
  const source = await readFile(new URL('../src/domain/analytics/analytics-contracts.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /supabase|fetch\(|axios|insert\(|update\(|delete\(|upsert\(/i);
  assert.doesNotMatch(source, /reduce\(|realized\s*[-+*/]|projected\s*[-+*/]/i);
  assert.doesNotMatch(source, /4\.280|12\.480|7\.860|4\.620/);
});

test('ChartCard exige pergunta, estado e equivalente acessível e não desenha série vazia falsa', async () => {
  const source = await readFile(new URL('../src/design-system/financial-components.tsx', import.meta.url), 'utf8');
  assert.match(source, /question: string/);
  assert.match(source, /state: AnalyticsStateName/);
  assert.match(source, /accessibilityEquivalent: string/);
  assert.match(source, /state === 'partial' \|\| state === 'stale'/);
  assert.doesNotMatch(source, /chartGuide/);
});
