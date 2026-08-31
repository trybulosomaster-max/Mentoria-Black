import type { AppEnvironmentName } from './environment.ts';

export const READ_WRITE_MODES = Object.freeze(['unavailable', 'read', 'read_write'] as const);
export type ReadWriteMode = (typeof READ_WRITE_MODES)[number];
export type MobilePlatform = 'ios' | 'android';

export type CapabilityDefinition = Readonly<{
  exists: boolean;
  enabled: boolean;
  featureFlag?: string;
  requiredEntitlement?: string;
  requiredPermission?: string;
  platforms: readonly MobilePlatform[];
  minimumAppVersion: string;
  readWriteMode: ReadWriteMode;
}>;

export type CapabilityResolution = Readonly<{
  key: string;
  exists: boolean;
  enabled: boolean;
  entitled: boolean;
  permitted: boolean;
  platformSupported: boolean;
  minimumAppVersion: string | null;
  minimumVersionSatisfied: boolean;
  readWriteMode: ReadWriteMode;
  available: boolean;
  reason: 'available' | 'not_configured' | 'disabled' | 'not_entitled' | 'not_permitted' | 'unsupported_platform' | 'upgrade_required' | 'unavailable';
}>;

export type CapabilityResolutionInput = Readonly<{
  appVersion: string;
  platform: MobilePlatform;
  environment: AppEnvironmentName;
  entitlements: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  featureFlags: Readonly<Record<string, boolean>>;
}>;

export type CapabilityRegistry = Readonly<Record<string, CapabilityDefinition>>;

function versionParts(value: string): readonly number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function versionAtLeast(current: string, minimum: string): boolean {
  const currentParts = versionParts(current);
  const minimumParts = versionParts(minimum);
  if (!currentParts || !minimumParts) return false;
  for (let index = 0; index < 3; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (currentPart > minimumPart) return true;
    if (currentPart < minimumPart) return false;
  }
  return true;
}

function denied(key: string): CapabilityResolution {
  return Object.freeze({
    key,
    exists: false,
    enabled: false,
    entitled: false,
    permitted: false,
    platformSupported: false,
    minimumAppVersion: null,
    minimumVersionSatisfied: false,
    readWriteMode: 'unavailable',
    available: false,
    reason: 'not_configured',
  });
}

export function resolveCapability(
  registry: CapabilityRegistry,
  key: string,
  input: CapabilityResolutionInput,
): CapabilityResolution {
  const definition = registry[key];
  if (!definition) return denied(key);

  const enabled = definition.enabled
    && (!definition.featureFlag || input.featureFlags[definition.featureFlag] === true);
  const entitled = !definition.requiredEntitlement
    || input.entitlements.has(definition.requiredEntitlement);
  const permitted = !definition.requiredPermission
    || input.permissions.has(definition.requiredPermission);
  const platformSupported = definition.platforms.includes(input.platform);
  const minimumVersionSatisfied = versionAtLeast(input.appVersion, definition.minimumAppVersion);
  const available = definition.exists
    && enabled
    && entitled
    && permitted
    && platformSupported
    && minimumVersionSatisfied
    && definition.readWriteMode !== 'unavailable';

  let reason: CapabilityResolution['reason'] = 'available';
  if (!definition.exists || definition.readWriteMode === 'unavailable') reason = 'unavailable';
  else if (!enabled) reason = 'disabled';
  else if (!entitled) reason = 'not_entitled';
  else if (!permitted) reason = 'not_permitted';
  else if (!platformSupported) reason = 'unsupported_platform';
  else if (!minimumVersionSatisfied) reason = 'upgrade_required';

  return Object.freeze({
    key,
    exists: definition.exists,
    enabled,
    entitled,
    permitted,
    platformSupported,
    minimumAppVersion: definition.minimumAppVersion,
    minimumVersionSatisfied,
    readWriteMode: definition.readWriteMode,
    available,
    reason,
  });
}

const MOBILE_PLATFORMS = Object.freeze(['ios', 'android'] as const);

export const FOUNDATION_CAPABILITIES: CapabilityRegistry = Object.freeze({
  'financial.read': Object.freeze({
    exists: true,
    enabled: true,
    requiredEntitlement: 'APP',
    platforms: MOBILE_PLATFORMS,
    minimumAppVersion: '0.1.0',
    readWriteMode: 'read',
  }),
  'financial.write': Object.freeze({
    exists: true,
    enabled: true,
    featureFlag: 'financialWrites',
    requiredEntitlement: 'APP',
    requiredPermission: 'financial:write',
    platforms: MOBILE_PLATFORMS,
    minimumAppVersion: '0.1.0',
    readWriteMode: 'read_write',
  }),
  'administration.read': Object.freeze({
    exists: true,
    enabled: true,
    requiredPermission: 'administration:read',
    platforms: MOBILE_PLATFORMS,
    minimumAppVersion: '0.1.0',
    readWriteMode: 'read',
  }),
  OPEN_FINANCE: Object.freeze({
    exists: false,
    enabled: false,
    platforms: MOBILE_PLATFORMS,
    minimumAppVersion: '0.1.0',
    readWriteMode: 'unavailable',
  }),
  AI_IMPORT: Object.freeze({
    exists: false,
    enabled: false,
    platforms: MOBILE_PLATFORMS,
    minimumAppVersion: '0.1.0',
    readWriteMode: 'unavailable',
  }),
  SHARING: Object.freeze({
    exists: false,
    enabled: false,
    platforms: MOBILE_PLATFORMS,
    minimumAppVersion: '0.1.0',
    readWriteMode: 'unavailable',
  }),
  CROSS_DEVICE_NOTES: Object.freeze({
    exists: false,
    enabled: false,
    platforms: MOBILE_PLATFORMS,
    minimumAppVersion: '0.1.0',
    readWriteMode: 'unavailable',
  }),
});
