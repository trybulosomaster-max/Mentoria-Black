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

The four V82 functions are `SECURITY INVOKER`, require an authenticated user, validate ownership, and insert one canonical ledger row:

- `create_transfer_v82`: source account to destination account.
- `create_investment_v82`: source account to asset.
- `create_rescue_v82`: asset to destination account.
- `reverse_structured_operation_v82`: creates the inverse operation and links it to the original.

They do not mutate manual account/asset snapshots. Atomicity comes from one PostgreSQL transaction and one canonical row representing both conceptual legs. `(user_id, operation_id)` provides idempotency; the same ID with different payload is rejected.

## Product decisions intentionally deferred

- Liability amortization, principal versus interest, and payment allocation.
- Realized gain/loss, income distributions, valuation changes, and cost-basis accounting.
- Whether a structured operation may be physically deleted after it has been reversed.
- The date and evidence required to promote manual snapshots into reconstruction bases.
- Resolution of legacy English defaults (`categories.kind = expense`, `recurring.type = expense`) before hardening their constraints.

Gross rescue value is not income. Investment is not consumption expense. Gain/loss must be a separate future patrimonial event.

## Future deployment plan — do not execute from this branch

1. Take a platform backup and schema snapshot through an approved operational process.
2. Build a production migration set that excludes the local baseline, or explicitly register the reviewed baseline version as already applied. The baseline has a guard and must never run against an existing application schema.
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

## Credential hygiene

`supabase/.temp`, local environment files, connection material, generated keys, and database dumps must never be committed. A temporary credential printed during an earlier CLI dry run must be treated as exposed and never reused; expiration or revocation should be confirmed through the approved platform mechanism without replaying it.
