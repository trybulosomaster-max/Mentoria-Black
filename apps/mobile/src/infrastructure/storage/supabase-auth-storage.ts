import 'expo-sqlite/localStorage/install';

import type { AppEnvironmentName } from '../../domain/foundation/environment';
import { FOUNDATION_SCHEMA_VERSION } from '../../domain/foundation/api-compatibility';

/**
 * Adapter transitório para homologação interna. Ele fica isolado da UI e é
 * explicitamente proibido em produção até a implementação nativa do
 * SecureStoragePort em gate próprio.
 */
export function createTransitionalSupabaseAuthStorage(environment: AppEnvironmentName) {
  const prefix = `aviora:${environment}:auth:v${FOUNDATION_SCHEMA_VERSION}:`;
  return Object.freeze({
    getItem: (key: string) => globalThis.localStorage.getItem(`${prefix}${key}`),
    setItem: (key: string, value: string) => globalThis.localStorage.setItem(`${prefix}${key}`, value),
    removeItem: (key: string) => globalThis.localStorage.removeItem(`${prefix}${key}`),
  });
}
