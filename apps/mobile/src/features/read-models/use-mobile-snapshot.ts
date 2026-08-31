import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccessContext } from '../../domain/foundation/access-context';
import { mobileFinancialReadRepository, type MobileSnapshot } from './mobile-read.repository';

export function useMobileSnapshot(context: AccessContext | null | undefined) {
  const identityKey = context
    ? `${context.environment}:${context.actingUserId}:${context.resourceOwnerId}:${context.generation}`
    : null;
  const [data, setData] = useState<MobileSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(context));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const activeIdentity = useRef<string | null>(identityKey);
  const requestGeneration = useRef(0);

  const load = useCallback(async (manual = false) => {
    const expectedIdentity = identityKey;
    const generation = ++requestGeneration.current;
    const requestIsCurrent = () => (
      generation === requestGeneration.current
      && activeIdentity.current === expectedIdentity
    );

    if (!context || !expectedIdentity) {
      if (requestIsCurrent()) {
        setData(null);
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }

    manual ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const snapshot = await mobileFinancialReadRepository.loadSnapshot(context);
      if (requestIsCurrent()) setData(snapshot);
    } catch (cause) {
      if (requestIsCurrent()) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados.');
      }
    } finally {
      if (requestIsCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [context, identityKey]);

  useEffect(() => {
    activeIdentity.current = identityKey;
    requestGeneration.current += 1;
    setData(null);
    setError('');
    void load(false);
    return () => {
      requestGeneration.current += 1;
    };
  }, [identityKey, load]);

  const refresh = useCallback(() => load(true), [load]);
  return { data, loading, refreshing, error, refresh } as const;
}
