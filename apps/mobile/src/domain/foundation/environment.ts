export const APP_ENVIRONMENTS = Object.freeze(['development', 'beta', 'production'] as const);

export type AppEnvironmentName = (typeof APP_ENVIRONMENTS)[number];

export function normalizeEnvironment(value: unknown): AppEnvironmentName {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'production') return 'production';
  if (normalized === 'beta' || normalized === 'preview') return 'beta';
  return 'development';
}

export function environmentPartition(environment: AppEnvironmentName): string {
  if (!APP_ENVIRONMENTS.includes(environment)) throw new TypeError('Ambiente AVIORA inválido.');
  return `aviora:${environment}`;
}
