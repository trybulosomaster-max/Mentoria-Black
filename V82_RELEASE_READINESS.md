# Mentoria Black V82 — release readiness and GO/NO-GO

This document consolidates the local V82 implementation. It authorizes neither a
remote database operation nor an application deployment.

## Scope and dependency map

| Area | Canonical source | Consumers | State |
|---|---|---|---|
| Status, dates and financial effects | `js/financial-core.js` | Planning, reports, health, accounts | Canonical and tested |
| Virtual recurrence and reconciliation | `js/recurrence-projection.js` | Goals, planning, reports | Canonical and tested |
| Long-term goals | `js/goal-projection.js`, `js/goals-integration.js` | Goals page and Dashboard goals | Integrated |
| Planning | `js/planning-integration.js` | Planning page, Dashboard planning, Dashboard financial adapter | Integrated |
| Reports | `js/reports-integration.js` | Reports page/export | Integrated |
| Dashboard financial KPIs | `js/dashboard-financial-integration.js` | Dashboard month KPIs | Integrated |
| Reserve and health | `js/health-integration.js` | Reserve and Health pages | Integrated; legacy ledger retained |
| Accounts and net worth | `js/accounts-networth-integration.js` | Tests only | Parallel model; no UI/write integration |
| Structured writes | V82 SQL RPCs | No frontend consumer yet | Local only |

Migrated consumers reuse modules rather than copying financial rules into the
renderer. Legacy `MBFinance`, `periodTx()` and `totals()` remain for unmigrated V81
surfaces. Two intentional semantic boundaries remain:

- annual revenue evolution still uses `revenueYear()`/V81 and combines persisted
  forecast with realized values;
- card summaries still use `periodTx()`/`cardSummary()` and have no structured
  invoice-payment contract.

These boundaries are release limitations, not alternate canonical engines.

## Local baseline and production migration boundary

- `20260820161844_local_v81_structural_baseline.sql` is local-only and must never
  be included in a remote migration chain. Its guard rejects an existing app schema.
- `20260820161846_add_v82_structured_financial_operations.sql` followed by
  `20260820195658_structure_recurring_financial_operations_v82.sql` is the reviewed
  production chain. Both files are atomic, retryable and reject semantic drift.
- `supabase/production-migrations.manifest` is the reviewed allowlist. A future
  deploy must build a clean environment-specific migration chain from that manifest
  after reconciling the remote migration history.
- Running default `supabase db push` from this worktree is prohibited because the
  local baseline intentionally remains in `supabase/migrations` for reproducible
  local resets.

## Pending `NOT VALID` constraints

All remain enforceable for new rows while legacy rows await diagnostics.

| Constraint | Objective | Possible legacy violation / diagnostic | Transition | Risk |
|---|---|---|---|---|
| `recurring_account_user_fkey` | Same-owner recurring account | Cross-user or missing account; anti-join by `(account_id,user_id)` | May remain unvalidated | High |
| `recurring_card_user_fkey` | Same-owner recurring card | Cross-user or missing card; anti-join by `(card_id,user_id)` | May remain unvalidated | High |
| `transactions_account_user_fkey` | Same-owner legacy account | Cross-user or missing account; anti-join | May remain unvalidated | High |
| `transactions_card_user_fkey` | Same-owner card | Cross-user or missing card; anti-join | May remain unvalidated | High |
| `transactions_source_account_user_fkey` | Same-owner source account | Populated structural rows with invalid owner; anti-join | May remain unvalidated | High |
| `transactions_destination_account_user_fkey` | Same-owner destination | Populated structural rows with invalid owner; anti-join | May remain unvalidated | High |
| `transactions_asset_user_fkey` | Same-owner asset | Populated structural rows with invalid owner; anti-join | May remain unvalidated | High |
| `transactions_liability_user_fkey` | Same-owner liability | Populated structural rows with invalid owner; anti-join | May remain unvalidated | High |
| `transactions_recurring_series_user_fkey` | Same-owner recurring series | Backfill linked to another/missing rule; anti-join | May remain unvalidated | High |
| `transactions_reversal_user_fkey` | Same-owner original operation | Invalid/missing/cross-user reversal target; anti-join | May remain unvalidated | Critical |
| `transactions_amount_positive_v82` | Positive input amount | Count `amount <= 0` and classify adjustments | May remain unvalidated | Medium |
| `transactions_transfer_shape_v82` | Complete distinct accounts | Transfers without both structural accounts or same account | May remain unvalidated | High |
| `transactions_investment_shape_v82` | Account-to-asset shape | Investments without source/asset IDs | May remain unvalidated | High |
| `transactions_rescue_shape_v82` | Asset-to-account shape | Rescues without asset/destination IDs | May remain unvalidated | High |
| `transactions_recurring_identity_v82` | Series always has date | Series ID without occurrence date | May remain unvalidated | Medium |
| `transactions_installment_identity_v82` | Series and positive installment number | Partial/zero installment identity | May remain unvalidated | Medium |
| `transactions_reversal_not_self_v82` | No self reversal | `reversal_of_id = id` | Should validate before writers | High |
| `transactions_status_check` | Canonical persisted statuses or NULL | Noncanonical aliases/unknown strings; group counts by status | May remain unvalidated during alias migration | High |

Validation order: ownership FKs and reversal safety first, structural shapes after
backfill, amount/status only after historical classification.

## Deferred accounting contracts

### Liabilities

Proposed future event contract:

- `principal_draw`: increases liability and availability;
- `principal_payment`: reduces account and principal, not a new consumption expense;
- `interest_charge` and `fee`: increase liability and are consumption/finance costs;
- `payment`: allocates a positive amount between principal, interest and fees;
- `adjustment`: explicit, reasoned correction;
- reversal: exact inverse event linked by `reversal_of_id` and protected by
  `(user_id, operation_id)`.

Residual balance is opening principal plus draws, accrued interest, fees and explicit
adjustments, less principal payments. This is a post-launch evolution while V82 keeps
liabilities manual. It becomes mandatory before advertising automatic debt amortization.

### Investment gain/loss

Gross rescue remains cash movement, not revenue. A future asset-event contract must
separate gross proceeds, carrying/cost basis, realized gain or loss, distributions,
fees and valuation-only changes. Valuation changes affect net worth but not cash;
realized gain/loss is recognized separately from the gross rescue. This does not block
current Beta if investment performance/tax accounting is explicitly out of scope. It
blocks any claim of automated return, P&L or tax reporting.

## Annual evolution and cards

- Annual evolution is still V81. It excludes cancelled rows but does not split
  realized, scheduled and virtual projection, and unknown statuses can enter. It is
  acceptable only in controlled Beta with its current “previstas + realizadas” label
  treated as legacy. It must be migrated or explicitly badged as legacy before a broad
  commercial production release.
- Card summaries aggregate card-linked expenses and investments through `periodTx()`.
  There is no structural link between original purchases, invoices and invoice payments,
  so automatic payment recognition could double count. Do not infer it by note. This is
  acceptable for controlled Beta as a known read-only limitation, but blocks a claim of
  canonical card accounting in production.

## Beta manual acceptance matrix

| Scenario | Action | Expected result / screens | Risk | Manual rollback |
|---|---|---|---|---|
| New user | Sign up, open all tabs without data | Empty states; Health is not evaluated; no artificial score | Medium | Delete isolated Beta user |
| Existing-data fixture | Import synthetic V81-compatible rows | Legacy nullable links load; canonical modules exclude unknown status | High | Restore isolated Beta snapshot |
| Long goal | Create 20+ year goal and monthly contribution rule | Goals and Dashboard split realized/programmed/projected with no fixed year ceiling | Medium | Remove synthetic goal/rule |
| Recurrence | Materialize one occurrence also projected virtually | Materialized row replaces matching virtual occurrence | High | Remove synthetic rule/rows |
| Installment | Add two similar purchases and one true duplicate | Legitimate purchases remain; exact installment duplicate is rejected/deduped | High | Remove synthetic series |
| Planning | Open current and future months | Planned/realized/programmed/projected/forecast remain separate | Medium | Revert Beta app commit |
| Reports | Filter month/year/range/type/category/status | Table, totals and export match active filters exactly | Medium | Revert Beta app commit |
| Dashboard | Compare KPIs with detailed pages | Goals and Planning match; financial KPIs show forecast separately | High | Revert Beta app commit |
| Reserve | Add contribution and withdrawal in isolated ledger | Only effective ledger entries alter real balance | Medium | Remove isolated local ledger entries |
| Health | Test zero, partial and complete data | No-data message or renormalized partial score; realized base only | Medium | Revert Beta app commit |
| Accounts | Compare opening base and effective movements | Calculated balance is explainable; no snapshot double count | Critical | Keep account model disabled |
| Transfer | Submit same operation twice | One canonical row; source/destination complete; net worth neutral | Critical | Reverse using a new operation ID |
| Investment | Move account to asset | One structured row; cash down, asset up, net worth neutral | Critical | Structured reversal |
| Rescue | Move asset to destination account | One structured row; not income; net worth neutral before gain/loss | Critical | Structured reversal with explicit category |

Mandatory real-world-equivalent fixtures:

- **Casamento:** target `R$ 50.000`, deadline `01/10/2031`, linked monthly rule.
  Verify realized, programmed, virtual projected, projected coverage, remaining
  unplanned, completion estimate and no materialized/virtual duplication.
- **Viagem JP:** linked recurrence and an explicit deadline/horizon. Verify the same
  fields. If the real goal has no deadline, record that long projection requires an
  explicit horizon rather than inventing one.

Do not copy personal production rows into Beta. Recreate equivalent synthetic fixtures.

## Beta plan — do not execute here

1. Use branch `beta/v82` created from the reviewed V82 consolidation commit.
2. Use a separate Beta URL and an isolated Supabase project/database.
3. Apply a clean baseline appropriate to that isolated database, then only the reviewed
   V82 production-eligible migration candidate.
4. Use synthetic data; never clone personal production data.
5. Restrict access to named testers and identify the UI as `V82 BETA`.
6. Run automated tests, then the manual matrix above on desktop and mobile.
7. Monitor browser errors, Auth failures, RLS denials, RPC conflicts and duplicate IDs.
8. Roll back application-first to the prior Beta commit; revoke RPC execution if needed;
   retain audit rows rather than deleting financial history.

Suggested URL, subject to hosting audit: a provider-generated branch preview such as
`v82-beta.<approved-host>`; never reuse the production domain.

## Production plan — do not execute here

1. Confirm the previously exposed temporary database credential is expired/revoked
   through the approved administrative channel, without replaying it.
2. Take and verify backup/snapshot recovery.
3. Run explicitly authorized read-only diagnostics for all 18 constraints, duplicate
   IDs, grants and remote migration history.
4. Build a clean production chain from `supabase/production-migrations.manifest`; never
   include the local baseline.
5. Apply nullable columns, ownership keys/FKs, indexes, RLS/grants and RPCs in reviewed
   batches.
6. Validate ownership A/B and RPC idempotency in the target environment.
7. Complete isolated Beta acceptance, including Casamento and Viagem JP equivalents.
8. Backfill only unequivocal structural links in small, auditable batches.
9. Activate V82 consumers gradually; accounts/net-worth writes remain feature-flagged.
10. Validate constraints progressively after diagnostics are clean.
11. Migrate/badge annual evolution and define the card payment contract before claiming
    full canonical coverage.
12. Promote application, monitor errors and reconciliation metrics, and keep rollback
    application-first.

Rollback never starts by deleting data: disable V82 writers/consumers, revoke RPC
execution if needed, preserve structural IDs for audit, remove only problematic
unvalidated constraints/indexes, and restore reviewed policies from the snapshot.

## GO/NO-GO matrix

| Item | Status | Blocker? | Evidence | Required action |
|---|---|---:|---|---|
| JavaScript regression | Ready | No | 17 suites / 1,176 assertions | Keep mandatory in CI |
| Local database tests | Ready | No | pgTAP plus concurrency test | Keep local gate |
| RLS | Locally ready | Production yes | A/B tests; `(select auth.uid())` policies | Audit remote grants/policies |
| Composite ownership | Locally ready | Production yes | Cross-user FK tests | Diagnose legacy before validation |
| Atomicity | Locally ready | No for Beta | One canonical row per RPC | Target-environment validation |
| Idempotency | Locally ready | No for Beta | Unique index, sequential and concurrent retry | Monitor conflicts |
| Temporary credential | Unconfirmed | Yes for remote operations | Prior CLI incident | Confirm expiry/revocation |
| Production migration set | Locally reconciled | Remote pre-flight required | Ordered allowlist, recovery test and runbook exclude baseline | Run approved read-only pre-flight, backup and controlled window |
| Rollback | Designed/local-tested | Production yes | Baseline reset and application-first plan | Rehearse in isolated Beta |
| Liabilities | Manual only | Scope-dependent | No automatic amortization | Implement before claiming automation |
| Investment gain/loss | Deferred | Scope-dependent | Gross rescue separated from income | Implement before P&L/tax claims |
| Cards | Legacy limitation | Yes for full canonical production | No invoice/payment structural contract | Define model; do not use note heuristic |
| Annual evolution | Legacy limitation | Yes for broad production | V81 combined series | Migrate or badge explicitly |
| Beta environment | Planned, not deployed | Yes before manual acceptance | Isolated plan above | Provision separately and run matrix |
| Real cases | Fixture coverage only | Yes before production | Long-goal automated tests | Manual Casamento/Viagem JP Beta run |
| Secret scan | Ready | No | No effective credential pattern committed | Keep pre-commit scan |
| Publication | Not performed | Yes | Production/main untouched | Separate authorization after gates |

## Decision

The code and local database contract are suitable for an isolated, controlled Beta.
Production remains NO-GO until credential hygiene, remote read-only diagnostics,
isolated Beta acceptance, annual evolution, card semantics and migration-history
reconciliation are resolved.

**Release classification: BETA-GO only; PRODUCTION NO-GO.**
