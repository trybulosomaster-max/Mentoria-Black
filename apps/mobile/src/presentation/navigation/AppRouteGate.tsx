import { Redirect, type Href } from 'expo-router';
import type { PropsWithChildren } from 'react';

import { useAuth } from '../../core/auth/AuthProvider';
import { resolveRouteDecision, type RouteScope } from '../../domain/bootstrap/app-bootstrap';
import { BootstrapExperience } from '../bootstrap/BootstrapExperience';

export function AppRouteGate({ scope, children }: PropsWithChildren<{ scope: RouteScope }>) {
  const { bootstrapState, session, errorMessage, retryBootstrap } = useAuth();
  const decision = resolveRouteDecision(bootstrapState, scope, Boolean(session));

  if (decision.kind === 'pending') return <BootstrapExperience state={bootstrapState} />;
  if (decision.kind === 'error') {
    return (
      <BootstrapExperience
        state="RECOVERABLE_ERROR"
        message={errorMessage}
        onRetry={async () => { await retryBootstrap(); }}
      />
    );
  }
  if (decision.kind === 'redirect') return <Redirect href={decision.href as Href} />;
  return children ?? null;
}
