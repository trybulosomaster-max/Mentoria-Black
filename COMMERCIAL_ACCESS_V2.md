# Mentoria Black Commercial Access V2 — local proposal

Status: implementation and tests are local only. This document authorizes no remote
migration, Auth change, webhook registration, checkout, billing, merge or deploy.

Proposed migration: `20260822212119_commercial_access_v1.sql`

SHA-256: `6117a48991d2652c17af94fa55be20315ca43bda015cf68d0d6cd2324eaa00cc` (the former
`4b9934b7e9431fabe96c219b02221bc794611035afdc675deb4a922eecb1cfad`
is superseded by the Kiwify reconciliation).

## Remote Kiwify legacy reconciliation

The read-only production inventory established an unversioned legacy contract with
exactly one `products` row, one `access_grants` row, two `payment_events` rows,
`has_active_access(text)` and `set_kiwify_webhook_token(text)`. The migration now
classifies its pre-state before any schema write:

- **A — absent:** creates Commercial Access V2 on a clean V82 schema;
- **B — exact Kiwify legacy:** evolves those three tables in place;
- **C — equivalent V2:** permits a semantic retry only with the V2 schema marker,
  required tables/functions/indexes and the pre-enforcement V82 policies intact;
- **D — partial, unknown or incompatible:** raises `NO-GO` and the transaction writes
  nothing.

For state B, the legacy product UUID, slug, display fields and row are preserved. The
existing `mentoria-black` slug is mapped in place to the APP entitlement only because
the read-only gate proves it is the single expected mapping candidate. The migration
does not rename it or infer any other historical product. KNOWLEDGE and COMPLETE are
then added; COMPLETE remains a bundle whose valid acquisition creates independent APP
and KNOWLEDGE grants.

`access_grants.source` remains the single provider/origin field, avoiding a duplicate
provider concept. It accepts `manual`, `trial`, `kiwify`, `asaas`, `hotmart`, `eduzz`
and future lowercase provider codes. The existing Kiwify/manual row is enriched in
place with `access_type` and `environment=legacy`; customer and purchase references
are retained. The old `UNIQUE (user_id, product_id)` is replaced with focused unique
indexes: one trial ever per identity/product, provider-reference idempotency, and one
live subscription per user/product/provider/environment. An expired trial and a later
paid grant can therefore coexist without deleting history.

`payment_events` keeps both historical rows and their raw `payload` unchanged. They
receive `environment=legacy`, `external_event_id=event_id`, a SHA-256 payload hash and
canonical processing metadata. The raw payload column becomes nullable only for new
events; new adapters store a hash and technical identifiers, not a raw financial
payload. Idempotency moves from `(provider,event_id)` to
`(provider,environment,external_event_id)`, so equal Sandbox and production event IDs
do not collide while replay inside one environment is rejected. A compatibility
trigger normalizes the old Kiwify event insert shape. `has_active_access(text)` keeps
its signature, default slug and boolean behavior while understanding V2 states;
`get_my_entitlements()` is the richer resolver.

The body and search path of `set_kiwify_webhook_token(text)` are preserved. Its client
execution is removed; it remains backend-only and is not an Asaas dependency. No
Vault secret is read or moved.

The deployed Kiwify writer is not versioned in this repository. Plain legacy inserts
are covered by compatibility tests, but an external writer using
`ON CONFLICT (user_id,product_id)` must be updated before a production migration,
because that broad unique constraint is intentionally retired to preserve grant
history. A future read-only production/Edge inventory must prove the writer's conflict
contract. This is a production-promotion gate, not a blocker for local or Asaas
Sandbox work.

## Functional contract

One Supabase Auth user owns one Mentoria Black identity and any number of independent
product entitlements. `APP` and `KNOWLEDGE` are grantable. `COMPLETE` is only a catalog
bundle and expands to two grants: a period-bound paid APP grant and a lifetime
KNOWLEDGE grant. Normal APP cancellation keeps access through `paid_through` and does
not revoke KNOWLEDGE. A full refund or chargeback changes every grant linked to that
acquisition to a non-access state. A partial refund is placed in
`administrative_review` and changes no grant automatically.

The APP trial is exactly 168 server hours, has no grace period, and starts only in
`start_my_app_trial()` after a confirmed user logs in. The RPC accepts no user or
expiry, locks per `auth.uid()`, and returns `started`, `already_active`, `already_used`
or `not_eligible`. Browser, PWA, logout and local storage state cannot restart it.

`get_my_entitlements()` is a `SECURITY INVOKER` resolver. It returns APP and KNOWLEDGE
independently with `has_access`, `source`, `access_type`, state, expiry, grace,
server-derived trial seconds and commercial state. It never accepts a user ID.

## Frontend gate

After Auth, `index.html` calls the trial starter and entitlement resolver before the
first `load()`. Financial queries and recurring materialization run only when APP is
authorized by the database. Otherwise the user sees the paywall or the KNOWLEDGE-only
placeholder. Trial expiry leaves all financial rows untouched. Checkout buttons call
an offline mock adapter and cannot create a charge.

The Knowledge screen is intentionally a placeholder. It models full access versus a
public sample, but contains no book content, chapter system or protected files yet.

## Administrative bootstrap and panel

The browser has no administrative database RPC permission and never receives a
`service_role` key. The local panel is a disabled contract shell until an authenticated
server adapter exists. Backend-only RPCs are granted solely to `service_role`:

- `admin_grant_commercial_access_v1(...)`;
- `admin_revoke_commercial_access_v1(...)`;
- `admin_get_commercial_access_v1(...)` (UUID administrativo, sem busca pública por e-mail);
- `bootstrap_commercial_admin_v1(...)`.

Future promotion procedure (never run from the browser) is deliberately phased.
**Phase A** evolves the catalog/ledger/event infrastructure while the nine V82 owner
policies remain active. **Phase B** has an approved administrator backend resolve the
owner Auth UUID, call `bootstrap_commercial_admin_v1(target, actor, reason)`, verify
the two lifetime grants and audit rows, and grant APP only to every other explicitly
authorized legacy data owner. **Phase C** verifies each grant and proves unchanged
legacy access. **Phase D** calls `activate_commercial_enforcement_v1(actor, reason)`.
Activation is transactional, takes an advisory lock, verifies the nine canonical V82
policies, refuses unsafe policy drift, and aborts if even one legacy data owner lacks
APP access. `rollback_commercial_enforcement_v1(actor, reason)` restores the canonical
V82 owner policies application-first without deleting commercial or financial rows.
Both transitions are idempotent and audit logged. The functions contain no hardcoded
identity and ordinary authenticated users cannot execute them. The caller must retain
the external admin authorization evidence; being the target is not itself authorization.

## Payment pipeline

The Sandbox Edge Function follows:

`authenticate -> ingest -> hash -> unique store -> transactional processor -> status`.

Raw webhook payloads are not stored for new events; only the two immutable Kiwify
legacy payloads remain. `(provider, environment, external_event_id)` is unique.
`process_payment_event_v1()` is backend-only, locks an event, resolves a
server-created order, links grants through `billing_order_grants`, and is retry-safe.
Unmatched/malformed commercial state becomes `failed` with a retry time. Duplicate
processed events are no-ops. An overdue, refund or chargeback arriving before its
canonical order-to-grant link remains retryable with `grant_link_not_found`; it does
not partially mutate the order and is reconciled after the confirmation event.

Policy implemented locally:

- confirmed/received: activate or renew linked grants;
- a confirmed APP purchase changes an active/expired trial to `converted`, retires
  the trial grant and preserves its original timestamps/history;
- overdue: APP grace ends exactly 72 hours after the paid period;
- normal subscription cancellation: no early revocation;
- full refund: revoke all grants from that order;
- partial refund: `administrative_review`, no automated grant change;
- chargeback: immediate non-access state for linked grants;
- capture refusal: no grant.

Offer rows remain inactive and contain no real prices or provider IDs. Checkout
creation stays mocked through the four named adapter methods requested for APP
monthly, APP annual, KNOWLEDGE and COMPLETE.

## RLS and threats

The migration initially preserves the nine canonical V82 ownership policies. After
the controlled legacy bootstrap, the nine financial tables require both
`(select auth.uid()) = user_id` and a live APP entitlement. KNOWLEDGE-only, expired
APP, anonymous and cross-user callers are denied.
Commercial tables use RLS; clients can read only their own trial/grants and have no
write grants. The resolver reads the caller's own rows, avoiding a policy recursion.
Narrow definer functions use `search_path = pg_catalog`, explicit table names and
revoked client execution.

This protects against modified frontends, direct REST calls, self-grants, altered
expiry, user-ID substitution, replay and duplicate processing. The privacy-first
anti-abuse boundary remains one confirmed Auth identity per trial. Detecting new
accounts under different emails would require a separately approved stable identifier
(verified phone, CPF or payment method); no fingerprint is collected.

## Before Asaas Sandbox

Can be completed without an Asaas account: local migration/RLS tests, UI/paywall,
admin server contract, event state machine, synthetic reconciliation and threat tests.
Still required for Sandbox integration: approved Sandbox account, API key in Edge
secret storage, separate strong webhook token, offer/product IDs and prices, server
checkout endpoint, webhook URL registration, signature/token validation exercise,
retry/reconciliation schedule and end-to-end Pix/card tests.

Remote promotion later requires `preflight_commercial_access_v2.sql`, a backup,
explicit migration approval, proof/update of the deployed Kiwify writer conflict
contract, authorization for every legacy owner grant, Sandbox acceptance and a
separate production rollout plan. The required sequence is: Phase A migration while
V82 policies remain active; Phase B grants; Phase C verification; Phase D enforcement;
then deploy the gated frontend. Never activate enforcement and then attempt bootstrap.
