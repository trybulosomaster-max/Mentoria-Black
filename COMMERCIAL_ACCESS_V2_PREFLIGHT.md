# Commercial Access V2 — faithful V82 clone preflight

Status: local and disposable only. No hosted Supabase project, real identity, payment
credential, Asaas endpoint, `main`, Beta or visual branch is accessed by this test.

Candidate: `20260822212119_commercial_access_v1.sql`

SHA-256: `6117a48991d2652c17af94fa55be20315ca43bda015cf68d0d6cd2324eaa00cc`; the prior
`4b9934b7e9431fabe96c219b02221bc794611035afdc675deb4a922eecb1cfad` is superseded.

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

- A — absent/safe to create: no canonical Commercial Access tables or functions exist.
- B — exact remote Kiwify legacy: `products`, `access_grants`, `payment_events`, their
  supplied columns/defaults/nullability, PK/unique/FK/CHECK contracts, three policies,
  RLS, `has_active_access(text)` and the definer Vault RPC all match the audited state.
- C — existing/equivalent V2: the V2 provenance marker, required tables, resolver and
  processor functions, indexes, and all nine pre-enforcement V82 policies match.
- D — incompatible/NO-GO: missing/extra legacy columns, wrong types/defaults/CHECKs,
  duplicate or permissive policies, invalid constraint indexes, function drift,
  partial V2 objects or unknown state abort before any migration write.

The dedicated fixture `commercial_access_kiwify_upgrade_test.sh` reproduces the remote
legacy state with synthetic data: 1 product, 1 grant and 2 Kiwify events. It proves the
three row identities and both historical payloads survive in place. The migration
maps only the single `mentoria-black` legacy product to APP, records both historical
event environments as `legacy`, preserves `set_kiwify_webhook_token(text)` byte-
semantically, and adds Asaas/other provider support without making Asaas depend on
Vault or Kiwify.

The future remote script `supabase/production/preflight_commercial_access_v2.sql`
begins a read-only transaction. It returns only technical names and aggregate counts;
it never selects UUIDs, emails, external customer/purchase IDs, or payload contents.
An injected-write test proves PostgreSQL rejects a write inside that script. It is a
mandatory gate, but is not executed against any remote project in this branch.

## Deployment phases and legacy safety

The migration is one transaction and uses four production phases. Phase A leaves the
nine V82 owner policies active, so existing owners keep their V82 access while the
commercial tables are reconciled. A future authorized server must then:

1. apply only Phase A after a successful read-only preflight and backup;
2. resolve each approved legacy owner administratively;
3. call `bootstrap_commercial_admin_v1` for the owner administrator and grant APP to
   every other explicitly authorized legacy owner;
4. verify grants, audit entries and unchanged owner access (Phase C);
5. call `activate_commercial_enforcement_v1` (Phase D);
6. verify all nine `mb_commercial_app_access` policies before deploying the frontend.

Activation refuses to proceed if any owner represented in any protected financial
table lacks active APP access. It also fails on policy drift. Rollback is
application-first through `rollback_commercial_enforcement_v1`, which restores V82
owner policies without deleting finance, trials, grants or billing history.

## Retry and failure behavior

- A failure anywhere inside the schema migration rolls back the whole transaction.
- Retrying that failed version against the unchanged pre-state succeeds.
- A direct retry of an equivalent V2 state is semantic and preserves every row; a
  provenance-marker, schema, policy, function or index mismatch fails closed.
- The broad legacy `UNIQUE (user_id,product_id)` is removed only after the exact B
  preflight and replaced with focused trial/provider/subscription uniqueness. This
  permits trial history plus a later paid grant.
- Historical events retain raw payloads; new events may not require one. The new
  uniqueness key is `(provider,environment,external_event_id)`, allowing the same ID
  in Sandbox and production but rejecting replay within one environment.
- Trial start and event processing are concurrency-safe and idempotent.
- Events that arrive before a required grant link remain retryable and perform no
  partial commercial-state transition.

## Local acceptance

The clone suites cover V82 financial integrity, structured recurrence, Commercial
Access trial/admin/payment behavior, preservation of all nine legacy tables, exact
Kiwify 1/1/2 upgrade with zero row loss, legacy payload/function preservation,
old-writer event normalization, Sandbox/production event isolation, replay rejection,
bootstrap-before-enforcement, expiry without deletion, policy rollback, migration
partial failure/retry, drift refusal, and indexed/RLS execution plans.

The deployed Kiwify webhook implementation is not versioned. The compatible legacy
insert shape is tested, but production promotion must first prove that the writer does
not depend on `ON CONFLICT (user_id,product_id)`, or deploy an approved writer update
before retiring that unique constraint. This remains a production-only gate; it does
not block an Asaas Sandbox integration.
