import test from 'node:test';
import assert from 'node:assert/strict';

import { createAccessContext, InvalidAccessContextError, ownsResource } from '../src/domain/foundation/access-context.ts';
import {
  FOUNDATION_CAPABILITIES,
  resolveCapability,
  type CapabilityResolutionInput,
} from '../src/domain/foundation/capability-registry.ts';
import {
  FOUNDATION_INTEGRITY_VERSION,
  FOUNDATION_SCHEMA_VERSION,
  readVersionedDto,
} from '../src/domain/foundation/api-compatibility.ts';
import { normalizeEnvironment } from '../src/domain/foundation/environment.ts';
import { MOBILE_STATE_CLASSIFICATION } from '../src/domain/foundation/state-classification.ts';
import { IdentityRuntime, StaleAccessContextError } from '../src/application/foundation/identity-runtime.ts';
import { createSessionVault } from '../src/application/foundation/session-vault.ts';
import { MemoryPrivateCache } from '../src/infrastructure/cache/memory-private-cache.ts';
import { createRedactedObservability } from '../src/infrastructure/observability/redacted-observability.ts';
import type { SecureStoragePort } from '../src/ports/foundation-ports.ts';

const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const FUTURE = '2026-08-30T13:00:00.000Z';

function capabilityInput(overrides: Partial<CapabilityResolutionInput> = {}): CapabilityResolutionInput {
  return {
    appVersion: '0.1.0',
    platform: 'ios',
    environment: 'beta',
    entitlements: new Set(),
    permissions: new Set(),
    featureFlags: {},
    ...overrides,
  };
}

function contextInput(userId: string) {
  return {
    actingUserId: userId,
    subjectUserId: userId,
    resourceOwnerId: userId,
    environment: 'beta' as const,
    sessionExpiresAt: FUTURE,
    entitlements: ['APP'],
    permissions: [],
  };
}

function cacheEnvelope(userId: string, payload: unknown, entitlementVersion = 'app:v1') {
  return {
    environment: 'beta' as const,
    userId,
    schemaVersion: FOUNDATION_SCHEMA_VERSION,
    queryKey: 'dashboard:month',
    entitlementVersion,
    fetchedAt: NOW,
    expiresAt: NOW + 60_000,
    integrityVersion: FOUNDATION_INTEGRITY_VERSION,
    payload,
  };
}

function cacheRequest(userId: string, entitlementVersion = 'app:v1') {
  return {
    environment: 'beta' as const,
    userId,
    schemaVersion: FOUNDATION_SCHEMA_VERSION,
    queryKey: 'dashboard:month',
    entitlementVersion,
    integrityVersion: FOUNDATION_INTEGRITY_VERSION,
    now: NOW + 1,
  };
}

test('AccessContext diferencia ator, sujeito e proprietário', () => {
  const own = createAccessContext({ ...contextInput('A'), generation: 1 }, NOW);
  assert.equal(ownsResource(own), true);

  const delegated = createAccessContext({
    ...contextInput('A'),
    subjectUserId: 'B',
    resourceOwnerId: 'B',
    generation: 2,
  }, NOW);
  assert.equal(delegated.actingUserId, 'A');
  assert.equal(delegated.resourceOwnerId, 'B');
  assert.equal(ownsResource(delegated), false);
});

test('AccessContext falha fechado sem identidade ou com sessão expirada', () => {
  assert.throws(
    () => createAccessContext({ ...contextInput(''), generation: 1 }, NOW),
    InvalidAccessContextError,
  );
  assert.throws(
    () => createAccessContext({ ...contextInput('A'), sessionExpiresAt: '2026-08-30T11:59:59.000Z', generation: 1 }, NOW),
    /expirada/,
  );
});

test('CapabilityRegistry é default-deny e não confunde flag, entitlement e permission', () => {
  assert.equal(resolveCapability(FOUNDATION_CAPABILITIES, 'missing', capabilityInput()).available, false);
  assert.equal(resolveCapability(FOUNDATION_CAPABILITIES, 'financial.read', capabilityInput()).reason, 'not_entitled');
  assert.equal(resolveCapability(FOUNDATION_CAPABILITIES, 'financial.read', capabilityInput({
    entitlements: new Set(['APP']),
  })).available, true);
  assert.equal(resolveCapability(FOUNDATION_CAPABILITIES, 'administration.read', capabilityInput({
    entitlements: new Set(['APP']),
  })).reason, 'not_permitted');
  assert.equal(resolveCapability(FOUNDATION_CAPABILITIES, 'administration.read', capabilityInput({
    permissions: new Set(['administration:read']),
  })).available, true);
  assert.equal(resolveCapability(FOUNDATION_CAPABILITIES, 'financial.write', capabilityInput({
    featureFlags: { financialWrites: true },
  })).reason, 'not_entitled');
  assert.equal(resolveCapability(FOUNDATION_CAPABILITIES, 'financial.write', capabilityInput({
    entitlements: new Set(['APP']),
    permissions: new Set(['financial:write']),
    featureFlags: { financialWrites: false },
  })).reason, 'disabled');
});

test('capabilities futuras permanecem indisponíveis', () => {
  for (const key of ['OPEN_FINANCE', 'AI_IMPORT', 'SHARING', 'CROSS_DEVICE_NOTES']) {
    const resolved = resolveCapability(FOUNDATION_CAPABILITIES, key, capabilityInput({
      entitlements: new Set(['APP', 'KNOWLEDGE', 'COMPLETE']),
      permissions: new Set(['administration:read']),
    }));
    assert.equal(resolved.available, false);
    assert.equal(resolved.readWriteMode, 'unavailable');
  }
});

test('environment normaliza aliases sem misturar partições', () => {
  assert.equal(normalizeEnvironment('local'), 'development');
  assert.equal(normalizeEnvironment('preview'), 'beta');
  assert.equal(normalizeEnvironment('production'), 'production');
});

test('cache é particionado e invalida entitlement/schema incompatível', async () => {
  const cache = new MemoryPrivateCache();
  await cache.write(cacheEnvelope('A', { private: 'A' }));
  assert.deepEqual(await cache.read(cacheRequest('A')), { private: 'A' });
  assert.equal(await cache.read(cacheRequest('B')), null);
  assert.equal(await cache.read(cacheRequest('A', 'app:v2')), null);

  await cache.write(cacheEnvelope('A', { private: 'A2' }));
  assert.equal(await cache.read({ ...cacheRequest('A'), schemaVersion: 99 }), null);
  assert.equal(await cache.read(cacheRequest('A')), null);
});

test('logout e troca A→B removem cache e invalidam contexto anterior', async () => {
  const cache = new MemoryPrivateCache();
  const runtime = new IdentityRuntime(cache, () => NOW);
  const a = await runtime.activate(contextInput('A'));
  await cache.write(cacheEnvelope('A', { private: 'A' }));

  const b = await runtime.activate(contextInput('B'));
  assert.equal(runtime.isCurrent(a), false);
  assert.equal(runtime.isCurrent(b), true);
  assert.equal(await cache.read(cacheRequest('A')), null);
  assert.throws(() => runtime.requireCurrent(a), StaleAccessContextError);

  await cache.write(cacheEnvelope('B', { private: 'B' }));
  await runtime.logout();
  assert.equal(runtime.current(), null);
  assert.equal(await cache.read(cacheRequest('B')), null);
  assert.equal(runtime.isCurrent(b), false);
});

test('SecureStoragePort rejeita sessão expirada sem expor tokens', async () => {
  const values = new Map<string, string>();
  const storage: SecureStoragePort = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
  const vault = createSessionVault(storage, 'beta', () => NOW);
  await vault.persist({ userId: 'A', accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: FUTURE });
  assert.equal((await vault.restore())?.userId, 'A');
  await vault.clear();
  assert.equal(await vault.restore(), null);
  await assert.rejects(
    vault.persist({ userId: 'A', accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: '2026-08-30T11:00:00.000Z' }),
    /expirada/,
  );
});

test('observabilidade aplica allowlist e redige dados sensíveis', () => {
  const events: unknown[] = [];
  const observability = createRedactedObservability((event) => events.push(event));
  observability.record('cache load', {
    appVersion: '0.1.0',
    environment: 'beta',
    cache: 'hit',
    email: 'person@example.com',
    accessToken: 'secret-token',
    amount: 199.9,
    description: 'Compra privada',
    route: 'person@example.com',
  });
  assert.deepEqual(events, [{
    name: 'cache_load',
    attributes: { appVersion: '0.1.0', environment: 'beta', cache: 'hit' },
  }]);
});

test('DTO versionado tolera campos adicionais e rejeita schema incompatível', () => {
  const dto = readVersionedDto<{ ok: boolean }>({
    schemaVersion: 1,
    minimumAppVersion: '0.1.0',
    data: { ok: true },
    addedLater: 'ignored-by-consumer',
  }, 1);
  assert.equal(dto?.data.ok, true);
  assert.equal(readVersionedDto({ schemaVersion: 2, data: {} }, 1), null);
});

test('classifica estado sem transformar cache/local em verdade canônica', () => {
  assert.equal(MOBILE_STATE_CLASSIFICATION.financialFacts, 'CANONICAL_REMOTE');
  assert.equal(MOBILE_STATE_CLASSIFICATION.financialReadModels, 'REBUILDABLE_CACHE');
  assert.equal(MOBILE_STATE_CLASSIFICATION.reserveCurrent, 'DEVICE_LOCAL');
  assert.equal(MOBILE_STATE_CLASSIFICATION.session, 'SECRET');
});

test('repository boundary exige AccessContext e falha fechado para sharing não habilitado', async () => {
  const repository = {
    async loadSnapshot(context: ReturnType<typeof createAccessContext>) {
      if (!ownsResource(context)) throw new Error('sharing unavailable');
      return { owner: context.resourceOwnerId };
    },
  };
  const own = createAccessContext({ ...contextInput('A'), generation: 1 }, NOW);
  assert.deepEqual(await repository.loadSnapshot(own), { owner: 'A' });
  const delegated = createAccessContext({ ...contextInput('A'), resourceOwnerId: 'B', generation: 2 }, NOW);
  await assert.rejects(repository.loadSnapshot(delegated), /sharing unavailable/);
});
