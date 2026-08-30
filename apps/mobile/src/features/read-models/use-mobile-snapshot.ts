import { useCallback, useEffect, useRef, useState } from 'react';

import { loadMobileSnapshot, type MobileSnapshot } from './mobile-read.repository';

export function useMobileSnapshot(userId: string | null | undefined) {
  const [data, setData] = useState<MobileSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const activeUserId = useRef<string | null>(userId ?? null);
  const requestGeneration = useRef(0);

  const load = useCallback(async (manual = false) => {
    const expectedUserId = userId ?? null;
    const generation = ++requestGeneration.current;
    const requestIsCurrent = () => (
      generation === requestGeneration.current
      && activeUserId.current === expectedUserId
    );

    if (!expectedUserId) {
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
      const snapshot = await loadMobileSnapshot(expectedUserId);
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
  }, [userId]);

  useEffect(() => {
    activeUserId.current = userId ?? null;
    requestGeneration.current += 1;
    setData(null);
    setError('');
    void load(false);
    return () => {
      requestGeneration.current += 1;
    };
  }, [load, userId]);

  const refresh = useCallback(() => load(true), [load]);
  return { data, loading, refreshing, error, refresh } as const;
}
