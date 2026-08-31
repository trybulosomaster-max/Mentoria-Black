import type { AppEnvironmentName } from '../../domain/foundation/environment.ts';
import { FOUNDATION_SCHEMA_VERSION } from '../../domain/foundation/api-compatibility.ts';
import type { AuthSessionRecord, AuthSessionRepositoryPort, SecureStoragePort } from '../../ports/foundation-ports.ts';

function sessionKey(environment: AppEnvironmentName): string {
  return `aviora:${environment}:session:v${FOUNDATION_SCHEMA_VERSION}`;
}

function validSession(value: unknown, now: number): value is AuthSessionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.userId === 'string'
    && source.userId.length > 0
    && typeof source.accessToken === 'string'
    && source.accessToken.length > 0
    && typeof source.refreshToken === 'string'
    && source.refreshToken.length > 0
    && typeof source.expiresAt === 'string'
    && Date.parse(source.expiresAt) > now;
}

export function createSessionVault(
  storage: SecureStoragePort,
  environment: AppEnvironmentName,
  clock: () => number = Date.now,
): AuthSessionRepositoryPort {
  const key = sessionKey(environment);
  return Object.freeze({
    async restore() {
      const raw = await storage.get(key);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!validSession(parsed, clock())) {
          await storage.remove(key);
          return null;
        }
        return Object.freeze({ ...parsed });
      } catch {
        await storage.remove(key);
        return null;
      }
    },
    async persist(session) {
      if (!validSession(session, clock())) throw new TypeError('Sessão inválida ou expirada.');
      await storage.set(key, JSON.stringify(session));
    },
    async clear() {
      await storage.remove(key);
    },
  });
}
