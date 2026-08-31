export const BOOTSTRAP_STATES = Object.freeze([
  'BOOTING',
  'UNAUTHENTICATED',
  'AUTHENTICATED_CHECKING_ACCESS',
  'AUTHORIZED',
  'UNAUTHORIZED',
  'RECOVERABLE_ERROR',
] as const);

export type BootstrapState = (typeof BOOTSTRAP_STATES)[number];

export type BootstrapSignal =
  | 'booting'
  | 'configuration-required'
  | 'anonymous'
  | 'loading-access'
  | 'granted'
  | 'denied'
  | 'error';

export type RouteScope = 'entry' | 'public' | 'access' | 'shell';
export type AppRoute = '/(public)/welcome' | '/(public)/sign-in' | '/(protected)/access' | '/(tabs)';

export type RouteDecision =
  | Readonly<{ kind: 'render' | 'pending' | 'error' }>
  | Readonly<{ kind: 'redirect'; href: AppRoute }>;

export function resolveBootstrapState(signal: BootstrapSignal): BootstrapState {
  switch (signal) {
    case 'booting': return 'BOOTING';
    case 'loading-access': return 'AUTHENTICATED_CHECKING_ACCESS';
    case 'granted': return 'AUTHORIZED';
    case 'denied': return 'UNAUTHORIZED';
    case 'error': return 'RECOVERABLE_ERROR';
    case 'configuration-required':
    case 'anonymous':
      return 'UNAUTHENTICATED';
  }
}

export function bootstrapIsPending(state: BootstrapState): boolean {
  return state === 'BOOTING' || state === 'AUTHENTICATED_CHECKING_ACCESS';
}

export function resolveRouteDecision(
  state: BootstrapState,
  scope: RouteScope,
  hasSession: boolean,
): RouteDecision {
  if (bootstrapIsPending(state)) return { kind: 'pending' };

  if ((state === 'AUTHORIZED' || state === 'UNAUTHORIZED') && !hasSession) {
    if (scope === 'entry') return { kind: 'error' };
    return scope === 'public' ? { kind: 'render' } : { kind: 'redirect', href: '/(public)/sign-in' };
  }

  if (state === 'AUTHORIZED') {
    return scope === 'shell' ? { kind: 'render' } : { kind: 'redirect', href: '/(tabs)' };
  }

  if (state === 'UNAUTHORIZED') {
    return scope === 'access' ? { kind: 'render' } : { kind: 'redirect', href: '/(protected)/access' };
  }

  if (state === 'RECOVERABLE_ERROR') {
    if (hasSession) {
      return scope === 'access' ? { kind: 'render' } : { kind: 'redirect', href: '/(protected)/access' };
    }
    if (scope === 'entry') return { kind: 'error' };
    return scope === 'public' ? { kind: 'render' } : { kind: 'redirect', href: '/(public)/welcome' };
  }

  if (scope === 'public') return { kind: 'render' };
  return { kind: 'redirect', href: scope === 'entry' ? '/(public)/welcome' : '/(public)/sign-in' };
}
