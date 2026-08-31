export const FOUNDATION_SCHEMA_VERSION = 1;
export const FOUNDATION_INTEGRITY_VERSION = 1;
export const MOBILE_APP_VERSION = '0.1.0';

export type VersionedDto<T> = Readonly<{
  schemaVersion: number;
  minimumAppVersion?: string;
  data: T;
}> & Readonly<Record<string, unknown>>;

export function readVersionedDto<T>(value: unknown, expectedSchemaVersion: number): VersionedDto<T> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== expectedSchemaVersion || !('data' in source)) return null;
  if (source.minimumAppVersion !== undefined && typeof source.minimumAppVersion !== 'string') return null;
  return source as VersionedDto<T>;
}
