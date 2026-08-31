import type { ObservabilityAttributes, ObservabilityPort } from '../../ports/foundation-ports.ts';

export type SafeObservabilityEvent = Readonly<{
  name: string;
  attributes: ObservabilityAttributes;
}>;

const ALLOWED_KEYS = Object.freeze([
  'appVersion',
  'build',
  'environment',
  'platform',
  'route',
  'capability',
  'durationMs',
  'correlationId',
  'errorCode',
  'connectivity',
  'cache',
] as const);

function safeScalar(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  if (/^(?:bearer\s+|eyJ[A-Za-z0-9_-]+\.|sb[_-]secret_)/i.test(value)) return false;
  return value.length <= 160;
}

export function redactObservabilityAttributes(
  attributes: Readonly<Record<string, unknown>>,
): ObservabilityAttributes {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    const value = attributes[key];
    if (safeScalar(value)) safe[key] = value;
  }
  return Object.freeze(safe) as ObservabilityAttributes;
}

export function createRedactedObservability(
  sink: (event: SafeObservabilityEvent) => void,
): ObservabilityPort {
  return Object.freeze({
    record(name, attributes) {
      sink(Object.freeze({
        name: name.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80),
        attributes: redactObservabilityAttributes(attributes),
      }));
    },
  });
}
