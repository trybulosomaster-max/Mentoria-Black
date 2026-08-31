/**
 * Presentation contracts for canonical analytics.
 *
 * They never calculate, fetch or persist financial truth. Producers must supply
 * server-approved read models; presentation only describes how to render them.
 */

export type AnalyticsStateName = 'loading' | 'empty' | 'partial' | 'stale' | 'error' | 'unauthorized' | 'success';

export type AnalyticsState<T> =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'empty'; reason: string }>
  | Readonly<{ status: 'partial'; data: T; asOf: string; missing: readonly string[] }>
  | Readonly<{ status: 'stale'; data: T; asOf: string; staleSince: string }>
  | Readonly<{ status: 'error'; code: string; recoverable: boolean }>
  | Readonly<{ status: 'unauthorized' }>
  | Readonly<{ status: 'success'; data: T; asOf: string }>;

export type MetricUnit = 'BRL' | 'percentage' | 'count' | 'months' | 'ratio';
export type MetricComparison = 'previous_period' | 'budget' | 'target' | 'none';
export type FinancialSeriesKind = 'realized' | 'scheduled' | 'projected' | 'forecast';

export type MetricPeriod = Readonly<{
  start: string;
  end: string;
  timezone: string;
  label: string;
}>;

export type MetricScope = Readonly<{
  resourceOwnerId: string;
  accountIds?: readonly string[];
  categoryIds?: readonly string[];
}>;

export type MetricSeriesPoint = Readonly<{
  key: string;
  label: string;
  value: number;
  kind: FinancialSeriesKind;
}>;

export type MetricQuality = Readonly<{
  status: 'complete' | 'partial' | 'stale';
  asOf: string;
  notes: readonly string[];
}>;

export type MetricDrilldown = Readonly<{
  available: boolean;
  nextLevel?: DrilldownLevel;
  routeKey?: string;
}>;

export type MetricAccessibility = Readonly<{
  summary: string;
  equivalent: 'list' | 'table' | 'text';
}>;

export type MetricEnvelope = Readonly<{
  metricId: string;
  metricVersion: number;
  asOf: string;
  period: MetricPeriod;
  scope: MetricScope;
  series: readonly MetricSeriesPoint[];
  comparison?: Readonly<{ kind: MetricComparison; value: number }>;
  quality: MetricQuality;
  drilldown: MetricDrilldown;
  accessibility: MetricAccessibility;
}>;

export type MetricDefinition = Readonly<{
  metricId: string;
  metricVersion: number;
  unit: MetricUnit;
  currency?: 'BRL';
  format: 'currency' | 'percentage' | 'integer' | 'decimal' | 'duration';
  allowedComparisons: readonly MetricComparison[];
  requiredPermissions: readonly string[];
  drilldownAvailable: boolean;
}>;

export type MetricRegistry = Readonly<{
  definitions: readonly MetricDefinition[];
  find(metricId: string, metricVersion: number): MetricDefinition | undefined;
}>;

export function createMetricRegistry(definitions: readonly MetricDefinition[]): MetricRegistry {
  const index = new Map<string, MetricDefinition>();
  for (const definition of definitions) {
    const key = `${definition.metricId}@${definition.metricVersion}`;
    if (index.has(key)) throw new Error(`Duplicate metric definition: ${key}`);
    index.set(key, Object.freeze({ ...definition }));
  }
  const frozen = Object.freeze([...index.values()]);
  return Object.freeze({ definitions: frozen, find: (metricId: string, metricVersion: number) => index.get(`${metricId}@${metricVersion}`) });
}

/** Intentionally empty until a canonical read model owns each metric. */
export const metricRegistry = createMetricRegistry([]);

export const DRILLDOWN_LEVELS = Object.freeze(['summary', 'comparison', 'composition', 'evidence'] as const);
export type DrilldownLevel = (typeof DRILLDOWN_LEVELS)[number];

export function canAdvanceDrilldown(from: DrilldownLevel, to: DrilldownLevel): boolean {
  return DRILLDOWN_LEVELS.indexOf(to) === DRILLDOWN_LEVELS.indexOf(from) + 1;
}

export type AnalyticsQuery = Readonly<{
  search?: string;
  filters: Readonly<Record<string, readonly string[]>>;
  orderBy?: Readonly<{ key: string; direction: 'ascending' | 'descending' }>;
}>;

/** A list on compact layouts and a table where width/accessibility allow it. */
export type AnalyticsCollection<T> = Readonly<{
  state: AnalyticsState<readonly T[]>;
  query: AnalyticsQuery;
  visualEquivalent: 'list' | 'table';
  preservesAllFields: true;
  drilldown?: MetricDrilldown;
}>;

export const FINANCIAL_SERIES_PRESENTATION = Object.freeze({
  realized: Object.freeze({ label: 'Realizado', lineStyle: 'solid', marker: 'circle' }),
  scheduled: Object.freeze({ label: 'Programado', lineStyle: 'dotted', marker: 'square' }),
  projected: Object.freeze({ label: 'Projetado', lineStyle: 'dashed', marker: 'diamond' }),
  forecast: Object.freeze({ label: 'Previsão', lineStyle: 'dashed', marker: 'triangle' }),
} as const satisfies Record<FinancialSeriesKind, Readonly<{ label: string; lineStyle: 'solid' | 'dotted' | 'dashed'; marker: 'circle' | 'square' | 'diamond' | 'triangle' }>>);

