# Mentoria Black V82 — local database contract

This directory is local-first. Nothing here has been pushed to a remote Supabase project.

## Baseline classification

- Confirmed from the previously recorded catalog audit: columns, primary keys, legacy account/card foreign keys, goal ownership keys, status/type checks, and row ownership for `accounts`, `cards`, `goals`, `assets`, `liabilities`, `recurring`, and `transactions`.
- Local approximation: only the seven tables needed for Stage 12 are reproduced. Unrelated product, payment, category, planning, import, profile, and snapshot objects are deliberately excluded.
- New V82 structure: composite ownership foreign keys, structural series IDs, operation/reversal IDs, base dates, partial unique indexes, shape checks, and atomic ledger RPCs.

The baseline contains no remote rows and no personal data.

## Compatibility and backfill

All new relationship fields are nullable. Existing ambiguous rows remain valid until reviewed.

Classification rules for a future controlled backfill:

1. Keep an existing structural ID when ownership and the referenced row agree.
2. Infer a recurrence only when the legacy note contains one unambiguous rule ID and its date matches the occurrence.
3. Infer an installment only when every parsed installment has a consistent purchase identity, total count, number, owner, and date sequence.
4. Leave conflicts, incomplete text, reused descriptions, and multiple candidates as `NULL`.
5. Never infer `balance_as_of`, `opening_value`, or `value_as_of` from transaction history.
6. Never add historical transactions to `statement_balance` or `current_value` without a trusted base date.

Before deployment, run read-only diagnostics for zero amounts, invalid legacy ownership, duplicate recurrence candidates, duplicate installment candidates, and existing operation identifiers. No constraint should be validated until those counts are zero or explicitly reconciled.

## Atomic operations

The V82 financial functions are `SECURITY INVOKER`, require an authenticated user, validate ownership, and insert canonical ledger rows:

- `create_transfer_v82`: source account to destination account.
- `create_investment_v82`: source account to asset.
- `create_rescue_v82`: asset to destination account.
- `reverse_structured_operation_v82`: creates the inverse operation and links it to the original.
- `create_investment_entry_v82`: routes the common investment form through the canonical investment operation while preserving optional UI metadata atomically.
- `materialize_recurring_occurrences_v82`: locks the authenticated user's eligible series, validates explicit ownership links, materializes all occurrences in one transaction, records the series/date identity, and advances schedules only after the batch succeeds.

They do not mutate manual account/asset snapshots. Atomicity comes from one PostgreSQL transaction and one canonical row representing both conceptual legs. `(user_id, operation_id)` provides idempotency; the same ID with different payload is rejected.

Structured recurring operations use nullable `source_account_id`, `destination_account_id`, and `asset_id` columns. Composite ownership foreign keys and `NOT VALID` type-shape checks preserve ambiguous legacy rows without inferring links, while rejecting incomplete new investment, transfer, and rescue rules. Materialized occurrences are idempotent on `(user_id, recurring_series_id, recurring_occurrence_date)`.

Both V82 migrations are now listed, in order, in the production allowlist. They were
reconciled locally for atomic execution, semantic retry and explicit drift failure.
This is preparation only: neither file has been applied to production. Follow
`supabase/production/README.md`; the local baseline remains prohibited remotely.

## Product decisions intentionally deferred

- Liability amortization, principal versus interest, and payment allocation.
- Realized gain/loss, income distributions, valuation changes, and cost-basis accounting.
- Whether a structured operation may be physically deleted after it has been reversed.
- The date and evidence required to promote manual snapshots into reconstruction bases.
- Resolution of legacy English defaults (`categories.kind = expense`, `recurring.type = expense`) before hardening their constraints.

Gross rescue value is not income. Investment is not consumption expense. Gain/loss must be a separate future patrimonial event.

## Controlled deployment plan — separate authorization required

1. Take a platform backup and schema snapshot through an approved operational process.
2. Run the read-only production preflight, then build a clean production migration set
   from `supabase/production-migrations.manifest`. The local baseline is not eligible,
   has a guard, and must never run against an existing application schema. Default
   `supabase db push` or `migration up --linked` from this worktree is prohibited.
3. Run read-only preflight diagnostics and archive aggregate counts only.
4. Apply nullable columns and supporting unique ownership constraints.
5. Add composite foreign keys and checks as `NOT VALID` so legacy rows are not scanned during the first deploy; new writes are still protected.
6. Add partial unique indexes and `SECURITY INVOKER` RPCs with restricted grants.
7. Deploy consumers that can write structural IDs while retaining legacy reads.
8. Backfill only unequivocal rows in small, auditable batches.
9. Reconcile account/asset bases per user and date.
10. Validate constraints individually after diagnostics pass.
11. Promote through Beta before production consumers are enabled.

## Rollback plan

Rollback is application-first:

1. Disable V82 writers and return consumers to legacy fields.
2. Revoke RPC execution if a write-path defect exists.
3. Keep nullable columns and successfully written structural IDs; do not delete financial data.
4. Drop only unvalidated checks/FKs or new indexes that cause an operational problem.
5. Restore prior policies from the reviewed schema snapshot if policy behavior changes.
6. Do not drop `operation_id` or reversal links after V82 writes exist; retain them for audit and idempotency.

The local baseline can be recreated independently by resetting to the first migration version. That test is destructive only to the disposable local database.

The real-concurrency gate is `supabase/tests/v82_operation_id_concurrency_test.sh`. It targets only the Docker container labelled for this local CLI project, creates synthetic `.invalid` fixtures, runs two simultaneous transfer requests with the same `operation_id`, and removes those fixtures afterward.

## Credential hygiene

`supabase/.temp`, local environment files, connection material, generated keys, and database dumps must never be committed. A temporary credential printed during an earlier CLI dry run must be treated as exposed and never reused; expiration or revocation should be confirmed through the approved platform mechanism without replaying it.
