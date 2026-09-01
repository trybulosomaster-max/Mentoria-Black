import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { createAccessContext, type AccessContext } from '../src/domain/foundation/access-context.ts';
import {
  bindValueToIdentity,
  valueForActiveIdentity,
  type IdentityBoundValue,
} from '../src/domain/foundation/identity-bound-value.ts';
import {
  FOUNDATION_INTEGRITY_VERSION,
  FOUNDATION_SCHEMA_VERSION,
} from '../src/domain/foundation/api-compatibility.ts';
import { MemoryPrivateCache } from '../src/infrastructure/cache/memory-private-cache.ts';
import { calendarMonthKey, type CalendarMonth } from '../src/lib/format.ts';

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}>;

type SyntheticSnapshot = Readonly<{
  generatedAt: string;
  financialAsOfDate: string;
  period: Readonly<{ year: number; month: number; label: string }>;
  metrics: Readonly<Record<string, number>>;
  transactions: readonly unknown[];
  accounts: readonly unknown[];
  cards: readonly unknown[];
  goals: readonly unknown[];
  monthlyPlan: null;
  dashboard: Readonly<{
    realizedDailyMovements: readonly Readonly<{
      date: string;
      day: number;
      income: number;
      expense: number;
    }>[];
    scheduledTransactions: readonly Readonly<{
      id: string;
      description: string;
      financialDate: string;
      typeLabel: string;
      statusLabel: 'Programado';
      tone: 'neutral';
      amount: number;
    }>[];
    recentTransactions: readonly Readonly<{
      id: string;
      description: string;
      financialDate: string;
      typeLabel: string;
      statusLabel: 'Realizado';
      tone: 'positive';
      amount: number;
    }>[];
  }>;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function snapshot(owner: string, period: CalendarMonth = { year: 2026, month: 8 }): SyntheticSnapshot {
  const financialDate = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
  return Object.freeze({
    generatedAt: `owner:${owner}`,
    financialAsOfDate: financialDate,
    period: Object.freeze({ year: period.year, month: period.month, label: calendarMonthKey(period) }),
    metrics: Object.freeze({
      realizedIncome: 0,
      realizedExpense: 0,
      realizedInvestment: 0,
      monthlyCashFlow: 0,
      unclassifiedTransactions: 0,
      knownAccountBalance: 0,
      accountsWithSnapshot: 0,
      accountsTotal: 0,
      configuredCardLimit: 0,
      goalsSaved: 0,
      goalsTarget: 0,
    }),
    transactions: Object.freeze([]),
    accounts: Object.freeze([]),
    cards: Object.freeze([]),
    goals: Object.freeze([]),
    monthlyPlan: null,
    dashboard: Object.freeze({
      realizedDailyMovements: Object.freeze([
        Object.freeze({ date: `owner:${owner}`, day: 1, income: 100, expense: 0 }),
      ]),
      scheduledTransactions: Object.freeze([
        Object.freeze({
          id: `scheduled:${owner}`,
          description: `owner:${owner}`,
          financialDate,
          typeLabel: 'Receita',
          statusLabel: 'Programado',
          tone: 'neutral',
          amount: 100,
        }),
      ]),
      recentTransactions: Object.freeze([
        Object.freeze({
          id: `recent:${owner}`,
          description: `owner:${owner}`,
          financialDate,
          typeLabel: 'Receita',
          statusLabel: 'Realizado',
          tone: 'positive',
          amount: 100,
        }),
      ]),
    }),
  });
}

const pendingLoads = new Map<string, Deferred<SyntheticSnapshot>[]>();
const loadCalls: string[] = [];
const controlledRepository = Object.freeze({
  loadSnapshot(context: AccessContext, _period?: CalendarMonth): Promise<SyntheticSnapshot> {
    const owner = context.resourceOwnerId;
    loadCalls.push(owner);
    const request = deferred<SyntheticSnapshot>();
    const queue = pendingLoads.get(owner) ?? [];
    queue.push(request);
    pendingLoads.set(owner, queue);
    return request.promise;
  },
});

mock.module(new URL('../src/features/read-models/mobile-read.repository.ts', import.meta.url).href, {
  exports: { mobileFinancialReadRepository: controlledRepository },
});

const { useMobileSnapshot } = await import('../src/features/read-models/use-mobile-snapshot.ts');

function context(owner: string, generation: number): AccessContext {
  return createAccessContext({
    actingUserId: owner,
    subjectUserId: owner,
    resourceOwnerId: owner,
    environment: 'beta',
    role: 'CUSTOMER',
    entitlements: ['APP'],
    permissions: [],
    capabilities: [],
    sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    generation,
  });
}

type RenderEvidence = Readonly<{
  activeOwner: string | null;
  snapshotOwner: string | null;
  snapshotPeriod: string | null;
  dashboardMovementOwner: string | null;
  dashboardScheduledOwner: string | null;
  dashboardRecentOwner: string | null;
  entitlementOwner: string | null;
  loading: boolean;
}>;

type ProbeProps = Readonly<{
  context: AccessContext | null;
  entitlement: IdentityBoundValue<Readonly<{ owner: string }>> | null;
  period?: CalendarMonth;
  evidence: RenderEvidence[];
}>;

function Probe({ context: activeContext, entitlement, period, evidence }: ProbeProps): ReactElement | null {
  const result = useMobileSnapshot(activeContext, period);
  const entitlementValue = valueForActiveIdentity(entitlement, activeContext?.actingUserId ?? null);
  evidence.push(Object.freeze({
    activeOwner: activeContext?.actingUserId ?? null,
    snapshotOwner: result.data?.generatedAt.replace('owner:', '') ?? null,
    snapshotPeriod: result.data ? `${result.data.period.year}-${String(result.data.period.month).padStart(2, '0')}` : null,
    dashboardMovementOwner: result.data?.dashboard.realizedDailyMovements[0]?.date.replace('owner:', '') ?? null,
    dashboardScheduledOwner: result.data?.dashboard.scheduledTransactions[0]?.description.replace('owner:', '') ?? null,
    dashboardRecentOwner: result.data?.dashboard.recentTransactions[0]?.description.replace('owner:', '') ?? null,
    entitlementOwner: entitlementValue?.owner ?? null,
    loading: result.loading,
  }));
  return null;
}

function installMinimalDom() {
  const noop = () => undefined;
  class FakeNode {}
  class FakeElement extends FakeNode {}
  class FakeHTMLElement extends FakeElement {}
  class FakeHTMLIFrameElement extends FakeHTMLElement {}
  const windowValue: Record<string, unknown> = {
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeHTMLElement,
    HTMLIFrameElement: FakeHTMLIFrameElement,
    addEventListener: noop,
    removeEventListener: noop,
    getSelection: () => null,
  };
  const documentValue: Record<string, unknown> = {
    nodeType: 9,
    addEventListener: noop,
    removeEventListener: noop,
    activeElement: null,
    defaultView: windowValue,
  };
  const container = Object.assign(new FakeHTMLElement(), {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: documentValue,
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    insertBefore: noop,
    removeChild: noop,
    firstChild: null,
    lastChild: null,
    textContent: '',
  });
  documentValue.documentElement = container;
  documentValue.body = container;
  windowValue.document = documentValue;

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    window: windowValue,
    document: documentValue,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeHTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  return {
    container: container as unknown as Element,
    restore() {
      Object.assign(globalThis, {
        window: previous.window,
        document: previous.document,
        Node: previous.Node,
        Element: previous.Element,
        HTMLElement: previous.HTMLElement,
        IS_REACT_ACT_ENVIRONMENT: previous.actEnvironment,
      });
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForLoad(owner: string, ordinal: number): Promise<Deferred<SyntheticSnapshot>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const request = pendingLoads.get(owner)?.[ordinal];
    if (request) return request;
    await flush();
  }
  throw new Error(`Leitura ${ordinal + 1} de ${owner} não foi iniciada.`);
}

async function render(root: Root, props: ProbeProps): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe, props));
    await Promise.resolve();
  });
}

test('React montado nunca entrega snapshot, dashboard ou entitlement de A ao contexto B', async () => {
  pendingLoads.clear();
  loadCalls.length = 0;
  const dom = installMinimalDom();
  const root = createRoot(dom.container);
  const evidence: RenderEvidence[] = [];
  const contextA = context('A', 1);
  const contextB = context('B', 2);
  const contextASecondSession = context('A', 3);
  const entitlementA = bindValueToIdentity('A', Object.freeze({ owner: 'A' }));
  const entitlementB = bindValueToIdentity('B', Object.freeze({ owner: 'B' }));

  try {
    await render(root, { context: contextA, entitlement: entitlementA, evidence });
    const firstA = await waitForLoad('A', 0);
    await act(async () => { firstA.resolve(snapshot('A')); await firstA.promise; });
    assert.equal(evidence.at(-1)?.snapshotOwner, 'A');
    assert.equal(evidence.at(-1)?.dashboardMovementOwner, 'A');
    assert.equal(evidence.at(-1)?.dashboardScheduledOwner, 'A');
    assert.equal(evidence.at(-1)?.dashboardRecentOwner, 'A');
    assert.equal(evidence.at(-1)?.entitlementOwner, 'A');

    const beforeB = evidence.length;
    await render(root, { context: contextB, entitlement: entitlementA, evidence });
    const firstB = await waitForLoad('B', 0);
    const transitionToB = evidence.slice(beforeB);
    assert.ok(transitionToB.some((frame) => frame.activeOwner === 'B' && frame.loading));
    assert.ok(transitionToB.every((frame) => frame.activeOwner !== 'B' || frame.snapshotOwner !== 'A'));
    assert.ok(transitionToB.every((frame) => frame.activeOwner !== 'B' || frame.dashboardMovementOwner !== 'A'));
    assert.ok(transitionToB.every((frame) => frame.activeOwner !== 'B' || frame.dashboardScheduledOwner !== 'A'));
    assert.ok(transitionToB.every((frame) => frame.activeOwner !== 'B' || frame.dashboardRecentOwner !== 'A'));
    assert.ok(transitionToB.every((frame) => frame.activeOwner !== 'B' || frame.entitlementOwner !== 'A'));

    await render(root, { context: contextB, entitlement: entitlementB, evidence });
    assert.equal(evidence.at(-1)?.snapshotOwner, null);
    assert.equal(evidence.at(-1)?.dashboardMovementOwner, null);
    assert.equal(evidence.at(-1)?.dashboardScheduledOwner, null);
    assert.equal(evidence.at(-1)?.dashboardRecentOwner, null);
    assert.equal(evidence.at(-1)?.entitlementOwner, 'B');
    await act(async () => { firstB.resolve(snapshot('B')); await firstB.promise; });
    assert.equal(evidence.at(-1)?.snapshotOwner, 'B');
    assert.equal(evidence.at(-1)?.dashboardMovementOwner, 'B');
    assert.equal(evidence.at(-1)?.dashboardScheduledOwner, 'B');
    assert.equal(evidence.at(-1)?.dashboardRecentOwner, 'B');

    await render(root, { context: null, entitlement: entitlementB, evidence });
    assert.deepEqual(evidence.at(-1), {
      activeOwner: null,
      snapshotOwner: null,
      snapshotPeriod: null,
      dashboardMovementOwner: null,
      dashboardScheduledOwner: null,
      dashboardRecentOwner: null,
      entitlementOwner: null,
      loading: false,
    });

    const beforeReturnToA = evidence.length;
    await render(root, { context: contextASecondSession, entitlement: entitlementB, evidence });
    const secondA = await waitForLoad('A', 1);
    const transitionToA = evidence.slice(beforeReturnToA);
    assert.ok(transitionToA.every((frame) => frame.activeOwner !== 'A' || frame.snapshotOwner !== 'B'));
    assert.ok(transitionToA.every((frame) => frame.activeOwner !== 'A' || frame.dashboardMovementOwner !== 'B'));
    assert.ok(transitionToA.every((frame) => frame.activeOwner !== 'A' || frame.dashboardScheduledOwner !== 'B'));
    assert.ok(transitionToA.every((frame) => frame.activeOwner !== 'A' || frame.dashboardRecentOwner !== 'B'));
    assert.ok(transitionToA.every((frame) => frame.activeOwner !== 'A' || frame.entitlementOwner !== 'B'));
    await render(root, { context: contextASecondSession, entitlement: entitlementA, evidence });
    await act(async () => { secondA.resolve(snapshot('A')); await secondA.promise; });
    assert.equal(evidence.at(-1)?.snapshotOwner, 'A');
    assert.equal(evidence.at(-1)?.dashboardMovementOwner, 'A');
    assert.equal(evidence.at(-1)?.dashboardScheduledOwner, 'A');
    assert.equal(evidence.at(-1)?.dashboardRecentOwner, 'A');

    const beforeSameOwner = loadCalls.length;
    await render(root, { context: contextASecondSession, entitlement: entitlementA, evidence });
    assert.equal(loadCalls.length, beforeSameOwner);
    assert.equal(evidence.at(-1)?.snapshotOwner, 'A');

    for (const frame of evidence) {
      if (!frame.activeOwner) {
        assert.equal(frame.snapshotOwner, null);
        assert.equal(frame.dashboardMovementOwner, null);
        assert.equal(frame.dashboardScheduledOwner, null);
        assert.equal(frame.dashboardRecentOwner, null);
        assert.equal(frame.entitlementOwner, null);
        continue;
      }
      assert.ok(frame.snapshotOwner === null || frame.snapshotOwner === frame.activeOwner);
      assert.ok(frame.dashboardMovementOwner === null || frame.dashboardMovementOwner === frame.activeOwner);
      assert.ok(frame.dashboardScheduledOwner === null || frame.dashboardScheduledOwner === frame.activeOwner);
      assert.ok(frame.dashboardRecentOwner === null || frame.dashboardRecentOwner === frame.activeOwner);
      assert.ok(frame.entitlementOwner === null || frame.entitlementOwner === frame.activeOwner);
    }
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

test('troca de período oculta sincronamente o snapshot anterior do mesmo owner', async () => {
  pendingLoads.clear();
  loadCalls.length = 0;
  const dom = installMinimalDom();
  const root = createRoot(dom.container);
  const evidence: RenderEvidence[] = [];
  const ownerContext = context('A', 10);
  const entitlement = bindValueToIdentity('A', Object.freeze({ owner: 'A' }));
  const august = Object.freeze({ year: 2026, month: 8 });
  const september = Object.freeze({ year: 2026, month: 9 });

  try {
    await render(root, { context: ownerContext, entitlement, period: august, evidence });
    const augustLoad = await waitForLoad('A', 0);
    await act(async () => { augustLoad.resolve(snapshot('A', august)); await augustLoad.promise; });
    assert.equal(evidence.at(-1)?.snapshotPeriod, '2026-08');

    const beforeSeptember = evidence.length;
    await render(root, { context: ownerContext, entitlement, period: september, evidence });
    const septemberLoad = await waitForLoad('A', 1);
    const transition = evidence.slice(beforeSeptember);
    assert.ok(transition.some((frame) => frame.activeOwner === 'A' && frame.loading));
    assert.ok(transition.every((frame) => frame.snapshotPeriod !== '2026-08'));

    await act(async () => { septemberLoad.resolve(snapshot('A', september)); await septemberLoad.promise; });
    assert.equal(evidence.at(-1)?.snapshotOwner, 'A');
    assert.equal(evidence.at(-1)?.snapshotPeriod, '2026-09');
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

test('cache privado mantém partição de owner e purge sem leitura cruzada', async () => {
  const now = Date.now();
  const cache = new MemoryPrivateCache();
  await cache.write({
    environment: 'beta',
    userId: 'A',
    schemaVersion: FOUNDATION_SCHEMA_VERSION,
    queryKey: 'mobile-snapshot',
    entitlementVersion: 'app:v1',
    fetchedAt: now,
    expiresAt: now + 60_000,
    integrityVersion: FOUNDATION_INTEGRITY_VERSION,
    payload: Object.freeze({ owner: 'A' }),
  });
  const request = {
    environment: 'beta' as const,
    schemaVersion: FOUNDATION_SCHEMA_VERSION,
    queryKey: 'mobile-snapshot',
    entitlementVersion: 'app:v1',
    integrityVersion: FOUNDATION_INTEGRITY_VERSION,
    now: now + 1,
  };
  assert.equal(await cache.read({ ...request, userId: 'B' }), null);
  await cache.purgeIdentity('beta', 'A');
  assert.equal(await cache.read({ ...request, userId: 'A' }), null);
});
