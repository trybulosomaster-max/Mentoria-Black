import type { AccessContext } from '../domain/foundation/access-context.ts';
import type { AppEnvironmentName } from '../domain/foundation/environment.ts';

export type SecureStoragePort = Readonly<{
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}>;

export type CacheReadRequest = Readonly<{
  environment: AppEnvironmentName;
  userId: string;
  schemaVersion: number;
  queryKey: string;
  entitlementVersion: string;
  integrityVersion: number;
  now: number;
}>;

export type PrivateCacheEnvelope<T> = Readonly<{
  environment: AppEnvironmentName;
  userId: string;
  schemaVersion: number;
  queryKey: string;
  entitlementVersion: string;
  fetchedAt: number;
  expiresAt: number;
  integrityVersion: number;
  payload: T;
}>;

export type PrivateCachePort = Readonly<{
  read<T>(request: CacheReadRequest): Promise<T | null>;
  write<T>(envelope: PrivateCacheEnvelope<T>): Promise<void>;
  purgeIdentity(environment: AppEnvironmentName, userId: string): Promise<void>;
  purgeAll(): Promise<void>;
}>;

export type AuthSessionRecord = Readonly<{
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}>;

export type AuthSessionRepositoryPort = Readonly<{
  restore(): Promise<AuthSessionRecord | null>;
  persist(session: AuthSessionRecord): Promise<void>;
  clear(): Promise<void>;
}>;

export type EntitlementRepositoryPort<T> = Readonly<{
  load(context: AccessContext): Promise<T>;
}>;

export type FinancialReadRepositoryPort<T> = Readonly<{
  loadSnapshot(context: AccessContext): Promise<T>;
}>;

export type AuthDeepLinkPort = Readonly<{
  callback(): string;
  passwordRecovery(): string;
}>;

export type LifecycleState = 'foreground' | 'background';
export type LifecyclePort = Readonly<{
  current(): LifecycleState;
  subscribe(listener: (state: LifecycleState) => void): () => void;
}>;

export type ObservabilityAttributes = Readonly<{
  appVersion?: string;
  build?: string;
  environment?: AppEnvironmentName;
  platform?: string;
  route?: string;
  capability?: string;
  durationMs?: number;
  correlationId?: string;
  errorCode?: string;
  connectivity?: string;
  cache?: 'hit' | 'miss' | 'discarded';
}>;

export type ObservabilityPort = Readonly<{
  record(name: string, attributes: ObservabilityAttributes & Readonly<Record<string, unknown>>): void;
}>;
