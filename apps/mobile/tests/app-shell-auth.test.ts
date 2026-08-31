import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BOOTSTRAP_STATES,
  bootstrapIsPending,
  resolveBootstrapState,
  resolveRouteDecision,
} from '../src/domain/bootstrap/app-bootstrap.ts';

async function source(relative: string): Promise<string> {
  return readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
}

test('máquina de bootstrap expõe somente os seis estados congelados', () => {
  assert.deepEqual([...BOOTSTRAP_STATES], [
    'BOOTING',
    'UNAUTHENTICATED',
    'AUTHENTICATED_CHECKING_ACCESS',
    'AUTHORIZED',
    'UNAUTHORIZED',
    'RECOVERABLE_ERROR',
  ]);
  assert.equal(resolveBootstrapState('booting'), 'BOOTING');
  assert.equal(resolveBootstrapState('configuration-required'), 'UNAUTHENTICATED');
  assert.equal(resolveBootstrapState('anonymous'), 'UNAUTHENTICATED');
  assert.equal(resolveBootstrapState('loading-access'), 'AUTHENTICATED_CHECKING_ACCESS');
  assert.equal(resolveBootstrapState('granted'), 'AUTHORIZED');
  assert.equal(resolveBootstrapState('denied'), 'UNAUTHORIZED');
  assert.equal(resolveBootstrapState('error'), 'RECOVERABLE_ERROR');
});

test('bootstrap pendente não libera conteúdo público ou privado', () => {
  for (const state of ['BOOTING', 'AUTHENTICATED_CHECKING_ACCESS'] as const) {
    assert.equal(bootstrapIsPending(state), true);
    for (const scope of ['entry', 'public', 'access', 'shell'] as const) {
      assert.deepEqual(resolveRouteDecision(state, scope, true), { kind: 'pending' });
    }
  }
});

test('rota não autenticada só renderiza a experiência pública', () => {
  assert.deepEqual(resolveRouteDecision('UNAUTHENTICATED', 'entry', false), {
    kind: 'redirect', href: '/(public)/welcome',
  });
  assert.deepEqual(resolveRouteDecision('UNAUTHENTICATED', 'public', false), { kind: 'render' });
  assert.deepEqual(resolveRouteDecision('UNAUTHENTICATED', 'shell', false), {
    kind: 'redirect', href: '/(public)/sign-in',
  });
});

test('Auth autorizado entra no shell e Auth sem entitlement falha fechado', () => {
  assert.deepEqual(resolveRouteDecision('AUTHORIZED', 'shell', true), { kind: 'render' });
  assert.deepEqual(resolveRouteDecision('AUTHORIZED', 'public', true), {
    kind: 'redirect', href: '/(tabs)',
  });
  assert.deepEqual(resolveRouteDecision('UNAUTHORIZED', 'shell', true), {
    kind: 'redirect', href: '/(protected)/access',
  });
  assert.deepEqual(resolveRouteDecision('UNAUTHORIZED', 'access', true), { kind: 'render' });
  assert.deepEqual(resolveRouteDecision('AUTHORIZED', 'shell', false), {
    kind: 'redirect', href: '/(public)/sign-in',
  });
  assert.deepEqual(resolveRouteDecision('UNAUTHORIZED', 'entry', false), { kind: 'error' });
});

test('erro recuperável preserva o gate e oferece rota segura', () => {
  assert.deepEqual(resolveRouteDecision('RECOVERABLE_ERROR', 'entry', false), { kind: 'error' });
  assert.deepEqual(resolveRouteDecision('RECOVERABLE_ERROR', 'shell', false), {
    kind: 'redirect', href: '/(public)/welcome',
  });
  assert.deepEqual(resolveRouteDecision('RECOVERABLE_ERROR', 'shell', true), {
    kind: 'redirect', href: '/(protected)/access',
  });
});

test('guard central governa entrada, Auth, entitlement e shell', async () => {
  const [entry, publicLayout, accessLayout, tabsLayout, guard] = await Promise.all([
    source('app/index.tsx'),
    source('app/(public)/_layout.tsx'),
    source('app/(protected)/_layout.tsx'),
    source('app/(tabs)/_layout.tsx'),
    source('src/presentation/navigation/AppRouteGate.tsx'),
  ]);
  assert.match(entry, /AppRouteGate scope="entry"/);
  assert.match(publicLayout, /AppRouteGate scope="public"/);
  assert.match(accessLayout, /AppRouteGate scope="access"/);
  assert.match(tabsLayout, /AppRouteGate scope="shell"/);
  assert.match(guard, /resolveRouteDecision/);
});

test('login, entitlement, logout e retry permanecem nos contratos oficiais', async () => {
  const auth = await source('src/core/auth/AuthProvider.tsx');
  assert.match(auth, /auth\.signInWithPassword/);
  assert.match(auth, /rpc\('get_my_entitlements'\)/);
  assert.match(auth, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(auth, /retryBootstrap/);
  assert.doesNotMatch(auth, /message: error\.message/);
});

test('troca A→B limpa a apresentação antes de carregar a nova identidade', async () => {
  const [auth, snapshot] = await Promise.all([
    source('src/core/auth/AuthProvider.tsx'),
    source('src/features/read-models/use-mobile-snapshot.ts'),
  ]);
  assert.match(auth, /entitlementGeneration/);
  assert.match(auth, /activeUserId/);
  assert.match(auth, /bindValueToIdentity/);
  assert.match(auth, /valueForActiveIdentity/);
  assert.match(auth, /setBoundEntitlements\(null\)/);
  assert.match(auth, /effectivePhase/);
  assert.match(auth, /resolveBootstrapState\(effectivePhase\)/);
  assert.match(auth, /restoreGeneration/);
  assert.match(auth, /restoreGeneration === entitlementGeneration\.current/);
  assert.match(snapshot, /activeIdentity/);
  assert.match(snapshot, /requestGeneration/);
  assert.match(snapshot, /state\.identityKey === identityKey/);
  assert.match(snapshot, /visibleState/);
});

test('development mantém adapter transitório e production continua fail-closed', async () => {
  const [environment, client, storage] = await Promise.all([
    source('src/core/config/env.ts'),
    source('src/core/supabase/client.ts'),
    source('src/infrastructure/storage/supabase-auth-storage.ts'),
  ]);
  assert.match(environment, /Storage de sessão nativo seguro é obrigatório/);
  assert.match(client, /createTransitionalSupabaseAuthStorage/);
  assert.match(storage, /environment.*auth.*FOUNDATION_SCHEMA_VERSION/s);
});
