# Mentoria Black Commercial Access V2 — local proposal

Status: implementation and tests are local only. This document authorizes no remote
migration, Auth change, webhook registration, checkout, billing, merge or deploy.

Proposed migration: `20260822212119_commercial_access_v1.sql`  
SHA-256: `12c0824b59d1933214b66a4085923439765f30f432ceb917c1bedb814d01052a`

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

Future promotion procedure (never run from the browser): an approved administrator
backend resolves the owner's Auth UUID, calls `bootstrap_commercial_admin_v1(target,
actor, reason)` once, verifies two lifetime grants, then verifies the corresponding
audit rows. The function is idempotent, contains no hardcoded identity and ordinary
authenticated users cannot execute it. The caller must retain the external admin
authorization evidence; being the target is not itself authorization.

## Payment pipeline

The Sandbox Edge Function follows:

`authenticate -> ingest -> hash -> unique store -> transactional processor -> status`.

Raw webhook payloads are not stored. `(provider, environment, external_event_id)` is
unique. `process_payment_event_v1()` is backend-only, locks an event, resolves a
server-created order, links grants through `billing_order_grants`, and is retry-safe.
Unmatched/malformed commercial state becomes `failed` with a retry time. Duplicate
processed events are no-ops.

Policy implemented locally:

- confirmed/received: activate or renew linked grants;
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

The nine financial tables require both `(select auth.uid()) = user_id` and a live APP
entitlement. KNOWLEDGE-only, expired APP, anonymous and cross-user callers are denied.
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

Remote promotion later requires a read-only catalog preflight for any unversioned
Kiwify objects, backup, explicit migration approval, owner bootstrap authorization,
Sandbox acceptance and a separate production rollout plan.
