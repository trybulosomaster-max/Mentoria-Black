import type {
  CacheReadRequest,
  PrivateCacheEnvelope,
  PrivateCachePort,
} from '../../ports/foundation-ports.ts';

function identityPrefix(environment: string, userId: string): string {
  return `${environment}\u0000${userId}\u0000`;
}

function key(envelope: Pick<PrivateCacheEnvelope<unknown>, 'environment' | 'userId' | 'schemaVersion' | 'queryKey'>): string {
  return `${identityPrefix(envelope.environment, envelope.userId)}${envelope.schemaVersion}\u0000${envelope.queryKey}`;
}

export function createCacheEnvelope<T>(input: PrivateCacheEnvelope<T>): PrivateCacheEnvelope<T> {
  if (!input.userId.trim() || !input.queryKey.trim()) throw new TypeError('Partição e queryKey são obrigatórias.');
  if (input.expiresAt <= input.fetchedAt) throw new TypeError('Expiração de cache inválida.');
  return Object.freeze({ ...input });
}

export class MemoryPrivateCache implements PrivateCachePort {
  readonly #entries = new Map<string, PrivateCacheEnvelope<unknown>>();

  async read<T>(request: CacheReadRequest): Promise<T | null> {
    const cacheKey = key(request);
    const envelope = this.#entries.get(cacheKey);
    if (!envelope) {
      for (const [storedKey, stored] of this.#entries) {
        if (
          stored.environment === request.environment
          && stored.userId === request.userId
          && stored.queryKey === request.queryKey
          && stored.schemaVersion !== request.schemaVersion
        ) this.#entries.delete(storedKey);
      }
      return null;
    }

    const compatible = envelope.environment === request.environment
      && envelope.userId === request.userId
      && envelope.schemaVersion === request.schemaVersion
      && envelope.queryKey === request.queryKey
      && envelope.entitlementVersion === request.entitlementVersion
      && envelope.integrityVersion === request.integrityVersion
      && envelope.expiresAt > request.now;
    if (!compatible) {
      this.#entries.delete(cacheKey);
      return null;
    }
    return envelope.payload as T;
  }

  async write<T>(envelope: PrivateCacheEnvelope<T>): Promise<void> {
    const safe = createCacheEnvelope(envelope);
    this.#entries.set(key(safe), safe);
  }

  async purgeIdentity(environment: PrivateCacheEnvelope<unknown>['environment'], userId: string): Promise<void> {
    const prefix = identityPrefix(environment, userId);
    for (const cacheKey of this.#entries.keys()) {
      if (cacheKey.startsWith(prefix)) this.#entries.delete(cacheKey);
    }
  }

  async purgeAll(): Promise<void> {
    this.#entries.clear();
  }
}
