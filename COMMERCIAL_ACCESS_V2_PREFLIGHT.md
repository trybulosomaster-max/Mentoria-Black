# Commercial Access V2 — faithful V82 clone preflight

Status: local and disposable only. No hosted Supabase project, real identity, payment
credential, Asaas endpoint, `main`, Beta or visual branch is accessed by this test.

## Clone construction

`supabase/tests/commercial_access_v82_clone_preflight_test.sh` creates isolated
PostgreSQL databases from the local V81 structural fixture and then applies the exact
three versioned V82 production migrations, in order:

1. `20260820161846_add_v82_structured_financial_operations.sql`;
2. `20260820195658_structure_recurring_financial_operations_v82.sql`;
3. `20260821205630_reconcile_v82_production_access_contract.sql`.

The clone verifies the six V82 RPCs, nine canonical RLS policies and the 36 expected
authenticated CRUD grants. All users and finance rows are synthetic. No production
or Beta data is copied.

## Collision classification

- A — absent/safe to create: all Commercial Access tables, functions, constraints,
  policies and indexes in the versioned V82 clone.
- B — existing/equivalent: the nine V82 financial tables, their ownership columns,
  RLS state and canonical `mb_v82_own_rows` policies are preserved and reused during
  phase one.
- C — existing/compatible: Supabase Auth identity, `auth.uid()`, API roles and V82
  financial RPCs are consumed without replacement.
- D — incompatible/NO-GO: a synthetic incompatible `products` table and an
  incompatible `has_active_access(text)` function both abort before creating any
  partial Commercial Access object.

The Git tree contains no versioned Kiwify payment schema or function to merge. This
does not prove that an old hosted object is absent, so a future remote read-only
catalog preflight remains mandatory. The migration intentionally refuses any
canonical commercial object until its semantics are explicitly reconciled.

## Deployment phases and legacy safety

The migration is one transaction and leaves the nine V82 owner policies active.
Therefore a pre-existing V82 owner remains able to use their own data after the schema
migration, even before receiving an entitlement. A future authorized server must:

1. resolve each approved legacy owner administratively;
2. call `bootstrap_commercial_admin_v1` for the owner administrator and grant APP to
   every other explicitly authorized legacy owner;
3. verify grants and audit entries;
4. call `activate_commercial_enforcement_v1`;
5. verify all nine `mb_commercial_app_access` policies before deploying the frontend.

Activation refuses to proceed if any owner represented in any protected financial
table lacks active APP access. It also fails on policy drift. Rollback is
application-first through `rollback_commercial_enforcement_v1`, which restores V82
owner policies without deleting finance, trials, grants or billing history.

## Retry and failure behavior

- A failure anywhere inside the schema migration rolls back the whole transaction.
- Retrying that failed version against the unchanged pre-state succeeds.
- A successfully recorded migration version is never executed a second time by the
  migration runner; a direct manual rerun fails closed rather than masking drift.
- Trial start and event processing are concurrency-safe and idempotent.
- Events that arrive before a required grant link remain retryable and perform no
  partial commercial-state transition.

## Local acceptance

The clone suite covers V82 financial integrity, structured recurrence, Commercial
Access trial/admin/payment behavior, preservation of all nine legacy tables,
bootstrap-before-enforcement, expiry without deletion, policy rollback, migration
partial failure/retry, table/function drift refusal and indexed/RLS execution plans.
The focused SQL suite also covers concurrent trial and payment-event replay. Related
JavaScript and V82 regression suites must be green before this candidate can move to
an Asaas Sandbox preflight.
