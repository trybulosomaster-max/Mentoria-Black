import type { CapabilityResolution } from './capability-registry.ts';
import type { AppEnvironmentName } from './environment.ts';

export type AccessRole = 'CUSTOMER' | 'STAFF' | 'OWNER' | null;

export type AccessContext = Readonly<{
  actingUserId: string;
  subjectUserId: string;
  resourceOwnerId: string;
  environment: AppEnvironmentName;
  role: AccessRole;
  entitlements: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  capabilities: ReadonlyMap<string, CapabilityResolution>;
  sessionExpiresAt: string;
  generation: number;
}>;

export type AccessContextInput = Readonly<{
  actingUserId: string;
  subjectUserId: string;
  resourceOwnerId: string;
  environment: AppEnvironmentName;
  role?: AccessRole;
  entitlements?: Iterable<string>;
  permissions?: Iterable<string>;
  capabilities?: Iterable<readonly [string, CapabilityResolution]>;
  sessionExpiresAt: string;
  generation: number;
}>;

export class InvalidAccessContextError extends Error {
  readonly code = 'INVALID_ACCESS_CONTEXT';
}

function identity(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new InvalidAccessContextError(`${field} é obrigatório.`);
  return normalized;
}

export function createAccessContext(input: AccessContextInput, now = Date.now()): AccessContext {
  const expiresAt = Date.parse(input.sessionExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new InvalidAccessContextError('Sessão ausente ou expirada.');
  }
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new InvalidAccessContextError('Geração de identidade inválida.');
  }

  return Object.freeze({
    actingUserId: identity(input.actingUserId, 'actingUserId'),
    subjectUserId: identity(input.subjectUserId, 'subjectUserId'),
    resourceOwnerId: identity(input.resourceOwnerId, 'resourceOwnerId'),
    environment: input.environment,
    role: input.role ?? null,
    entitlements: new Set(input.entitlements ?? []),
    permissions: new Set(input.permissions ?? []),
    capabilities: new Map(input.capabilities ?? []),
    sessionExpiresAt: new Date(expiresAt).toISOString(),
    generation: input.generation,
  });
}

export function ownsResource(context: AccessContext): boolean {
  return context.actingUserId === context.resourceOwnerId;
}
