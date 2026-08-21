# V82 production migration runbook

This runbook prepares a production change but does not authorize it. Never run the
local V81 baseline, Beta fixtures, seeds, tests, or a generic `db push` remotely.

## Reviewed chain

Apply exactly, and only, this order:

1. `20260820161846_add_v82_structured_financial_operations.sql`
2. `20260820195658_structure_recurring_financial_operations_v82.sql`

Both files acquire the same transaction-scoped advisory lock, set bounded lock and
statement timeouts, and commit all DDL atomically. A SQL error rolls the whole file
back. Reapplying a completed file is supported: compatible objects are verified and
retained, functions are replaced only after their signature/body/security contract
matches, and grants are restored to the reviewed state.

## Object reconciliation contract

For every row below, “missing” means create it, “compatible” means retain/verify it,
and “incompatible” means raise `V82 schema drift` and roll the whole migration back.

| Class | Objects | Expected before | Expected after | Partial/retry behavior |
|---|---|---|---|---|
| Nullable columns | `accounts.balance_as_of`; `assets.opening_value`, `assets.value_as_of`; transaction structural IDs/dates/numbers; recurring source/destination/asset IDs | Missing or exact nullable type with no default | Exact nullable `date`, `numeric`, `uuid`, or `integer` type | Exact existing columns are accepted; wrong type, `NOT NULL`, or default fails safely |
| Ownership unique keys | `accounts_id_user_id_key`, `cards_id_user_id_key`, `assets_id_user_id_key`, `liabilities_id_user_id_key` | Missing or exact `UNIQUE(id,user_id)` | Exact validated unique constraint | Compatible key is retained; other definition under the reviewed name fails |
| Retired legacy FKs | `transactions_account_id_fkey`, `transactions_card_id_fkey`, `recurring_account_id_fkey`, `recurring_card_id_fkey` | Exact single-column V81 FK or already absent | Absent, replaced by compound ownership FK | Exact legacy FK is dropped; absence is recoverable; incompatible same-name FK fails |
| Compound transaction FKs | Account, card, source, destination, asset, liability, recurring series, reversal | Missing or exact reviewed definition | `(resource_id,user_id)` FK, `NOT VALID`, reviewed delete action | Compatible unvalidated FK is retained; validated or different target/action fails |
| Compound recurring FKs | Legacy account/card plus structured source/destination/asset | Missing or exact reviewed definition | `(resource_id,user_id)` FK, `NOT VALID` | Same as transaction ownership FKs |
| Transaction checks | Positive amount, transfer/investment/rescue shape, recurrence/installment identity, no self-reversal, status | Missing, exact V81 status check, or exact V82 check | Reviewed `NOT VALID` checks | Old status check is replaced only when exact; compatible V82 checks are retained; drift fails |
| Recurring checks | Positive amount and investment/transfer/rescue shapes | Missing or exact V82 check | Reviewed `NOT VALID` checks | Compatible check is retained; drift or unexpected validation state fails |
| Transaction indexes | Four unique identity indexes and four lookup indexes | Missing or exact index | Exact columns, uniqueness and partial predicate | Compatible index is retained; same-name index on different table/columns/predicate fails |
| Recurring indexes | Source, destination, asset and active schedule indexes | Missing or exact index | Exact columns and partial predicate | Compatible index is retained; same-name drift fails |
| RPCs | Four structured-operation RPCs, recurring materializer and investment-entry wrapper | Missing or exact reviewed body/signature/security contract | `plpgsql`, `SECURITY INVOKER`, controlled `search_path`, reviewed return shape | Missing RPC is created; exact RPC may be replaced; body/property/signature drift fails before replacement |
| RPC privileges | `anon`, `authenticated`, `PUBLIC` execution | Any state after RPC contract passes | `anon`/`PUBLIC` revoked; `authenticated` granted | `REVOKE`/`GRANT` are repeatable and verified before commit |
| RLS/policies | Existing V81 tables and policies | RLS enabled on all required tables | Unchanged | Preflight rejects disabled RLS; these migrations neither replace nor weaken policies |
| Recovery helpers | `pg_temp.mb_v82_*` | Absent or session-local | Session-local only | Disappear with the connection; never become public API objects |

All new relationship fields remain nullable. `NOT VALID` avoids scanning or rejecting
ambiguous legacy rows during deployment, while PostgreSQL still enforces the checks
and foreign keys for new or changed rows.

## Pre-flight and application

1. Take the approved platform backup and record the production project ref.
2. Run `supabase/production/preflight_v82.sql` through a read-only connection to the
   explicitly selected production database. Archive only its schema-state result.
3. Compare remote migration history with `supabase/production-migrations.manifest`.
   Neither V82 version may already be recorded unless its catalog state is complete.
4. Build an empty chain directory:

   ```sh
   task_chain_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-v82-production.XXXXXX")"
   node scripts/prepare-production-migrations.js "$task_chain_dir/supabase/migrations"
   ```

5. Under a separately approved production window, apply the clean directory with a
   production-specific database URL held only in the process environment:

   ```sh
   supabase migration up --db-url "$MB_V82_PRODUCTION_DB_URL" --workdir "$task_chain_dir" --yes
   ```

   Do not use `--linked`, `db push`, `--include-all`, or the repository migration
   directory. Verify the target ref independently before supplying the URL.
6. Re-list migration history and run catalog-only postchecks for columns, constraints,
   indexes, RPC properties, privileges and RLS. Deploy the V82 frontend only after both
   versions are recorded and postchecks pass.

## Retry and partial-state detection

- SQL failure inside either file rolls back that entire file; rerun the same reviewed
  file after correcting the cause.
- If DDL committed but the migration-history acknowledgement was interrupted, compare
  catalog state and history, then rerun the same file. Its guards verify the existing
  objects and restore grants without duplicating schema objects.
- A `partial-compatible-or-drift` preflight result requires rerunning the relevant file;
  its semantic checks decide whether the subset is recoverable or incompatible.
- Never mark history as applied merely because some columns exist. Only repair history
  after the complete catalog contract and file SHA are independently verified.

## Rollback

Database rollback is application-first and non-destructive:

1. Roll the frontend back to V81 and stop V82 writers.
2. Run `supabase/production/rollback_v82_writers.sql` only under separate approval to
   revoke the six V82 RPCs from API roles.
3. Preserve all structural columns, IDs, constraints and financial rows for audit.
4. Restore execution by rerunning the reviewed migrations after the defect is fixed.
5. Do not drop `operation_id`, recurrence identity, reversal links or user data.

The local recovery test proves atomic rollback, normal retry, compatible partial state,
incompatible drift rejection, writer-disable rollback, grant restoration and pgTAP:

```sh
bash supabase/tests/v82_production_migration_recovery_test.sh
```
