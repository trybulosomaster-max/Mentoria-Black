import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccessContext } from '../../domain/foundation/access-context';
import { mobileFinancialReadRepository, type MobileSnapshot } from './mobile-read.repository.ts';

type SnapshotState = Readonly<{
  identityKey: string | null;
  data: MobileSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
}>;

function emptyState(identityKey: string | null, loading: boolean): SnapshotState {
  return { identityKey, data: null, loading, refreshing: false, error: '' };
}

export function useMobileSnapshot(context: AccessContext | null | undefined) {
  const identityKey = context
    ? `${context.environment}:${context.actingUserId}:${context.resourceOwnerId}:${context.generation}`
    : null;
  const [state, setState] = useState<SnapshotState>(() => emptyState(identityKey, Boolean(context)));
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
        setState(emptyState(expectedIdentity, false));
      }
      return;
    }

    setState((current) => current.identityKey === expectedIdentity
      ? { ...current, loading: manual ? current.loading : true, refreshing: manual, error: '' }
      : emptyState(expectedIdentity, true));
    try {
      const snapshot = await mobileFinancialReadRepository.loadSnapshot(context);
      if (requestIsCurrent()) {
        setState({ identityKey: expectedIdentity, data: snapshot, loading: false, refreshing: false, error: '' });
      }
    } catch (cause) {
      if (requestIsCurrent()) {
        setState({
          identityKey: expectedIdentity,
          data: null,
          loading: false,
          refreshing: false,
          error: cause instanceof Error ? cause.message : 'Não foi possível carregar os dados.',
        });
      }
    }
  }, [context, identityKey]);

  useEffect(() => {
    activeIdentity.current = identityKey;
    requestGeneration.current += 1;
    setState(emptyState(identityKey, Boolean(context)));
    void load(false);
    return () => {
      requestGeneration.current += 1;
    };
  }, [identityKey, load]);

  const refresh = useCallback(() => load(true), [load]);
  const visibleState = state.identityKey === identityKey
    ? state
    : emptyState(identityKey, Boolean(context));
  return { ...visibleState, refresh } as const;
}
