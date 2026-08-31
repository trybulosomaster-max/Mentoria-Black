import type { NormalizedEntitlements } from '../../domain/access/access-contract.ts';
import {
  createAccessContext,
  type AccessContext,
  type AccessRole,
} from '../../domain/foundation/access-context.ts';
import {
  FOUNDATION_CAPABILITIES,
  resolveCapability,
  type MobilePlatform,
} from '../../domain/foundation/capability-registry.ts';
import type { AppEnvironmentName } from '../../domain/foundation/environment.ts';

function role(value: string | null): AccessRole {
  const normalized = value?.trim().toUpperCase();
  return normalized === 'CUSTOMER' || normalized === 'STAFF' || normalized === 'OWNER'
    ? normalized
    : null;
}

function entitlementCodes(entitlements: NormalizedEntitlements): ReadonlySet<string> {
  const codes = new Set<string>();
  if (entitlements.app.hasAccess || entitlements.internalAccess.app) codes.add('APP');
  if (entitlements.knowledge.hasAccess || entitlements.internalAccess.knowledge) codes.add('KNOWLEDGE');
  if (codes.has('APP') && codes.has('KNOWLEDGE')) codes.add('COMPLETE');
  return codes;
}

export function createSelfAccessContext(input: Readonly<{
  userId: string;
  sessionExpiresAt: string;
  entitlements: NormalizedEntitlements;
  environment: AppEnvironmentName;
  platform: MobilePlatform;
  appVersion: string;
  generation: number;
}>): AccessContext | null {
  const expiresAt = Date.parse(input.sessionExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const entitlements = entitlementCodes(input.entitlements);
  const permissions = new Set<string>();
  const capabilityInput = {
    appVersion: input.appVersion,
    platform: input.platform,
    environment: input.environment,
    entitlements,
    permissions,
    featureFlags: { financialWrites: false },
  } as const;
  const capabilities = Object.keys(FOUNDATION_CAPABILITIES).map((key) => [
    key,
    resolveCapability(FOUNDATION_CAPABILITIES, key, capabilityInput),
  ] as const);

  return createAccessContext({
    actingUserId: input.userId,
    subjectUserId: input.userId,
    resourceOwnerId: input.userId,
    environment: input.environment,
    role: role(input.entitlements.internalAccess.role),
    entitlements,
    permissions,
    capabilities,
    sessionExpiresAt: input.sessionExpiresAt,
    generation: Math.max(1, input.generation),
  });
}
