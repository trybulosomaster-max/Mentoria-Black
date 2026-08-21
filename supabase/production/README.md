# V82 production migration runbook

This runbook prepares a production change but does not authorize it. Never run the
local V81 baseline, Beta fixtures, seeds, tests, or a generic `db push` remotely.

## Reviewed chain

Apply exactly, and only, this order:

1. `20260820161846_add_v82_structured_financial_operations.sql`
2. `20260820195658_structure_recurring_financial_operations_v82.sql`
3. `20260821205630_reconcile_v82_production_access_contract.sql`

All three files acquire the same transaction-scoped advisory lock, set bounded lock and
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
| Table/column grants | Nine private frontend tables | Any state, including known excessive V81 grants | No `PUBLIC`/`anon`; `authenticated` has only `SELECT`, `INSERT`, `UPDATE`, `DELETE`; no column ACL | Migration 3 revokes all API-role grants then restores exact CRUD in one transaction; retry verifies the final ACL |
| RLS/policies | Ownership policies on nine private frontend tables | One or more policies, only if every API-facing expression is provably owner-only and combined CRUD coverage already exists | One `mb_v82_own_rows` policy per table, `TO authenticated`, explicit `USING` + `WITH CHECK`, `(select auth.uid())=user_id` | Equivalent duplicates/direct calls are consolidated atomically; broader/custom/restrictive semantics fail before any mutation |
| Future defaults | `categories.kind`, `recurring.type` | Exact legacy `expense` or reconciled `despesa` default | `despesa` default; historical rows unchanged | Retry accepts the final default; any other existing default fails as drift |
| Vocabulary checks | Category kind and recurring type | Missing or exact reviewed check | Reviewed `NOT VALID` checks | Legacy English rows remain; incompatible same-name constraint or validated-state drift fails |
| Recovery helpers | `pg_temp.mb_v82_*` | Absent or session-local | Session-local only | Disappear with the connection; never become public API objects |

All new relationship fields remain nullable. `NOT VALID` avoids scanning or rejecting
ambiguous legacy rows during deployment, while PostgreSQL still enforces the checks
and foreign keys for new or changed rows.

## Pre-flight and application

Client prerequisite on macOS (client libraries and `psql` only; no PostgreSQL server
or service is installed):

```sh
brew install libpq
brew link --force libpq
psql --version
```

1. Take the approved platform backup and record the production project ref.
   Before the change window, enable leaked-password protection in production Auth and
   record the Security Advisor result. This is a platform Auth setting, not SQL, and is
   therefore intentionally outside the migration files.
2. Obtain a newly issued read-only production database URL from the Supabase Dashboard
   **Connect** panel, using an approved administrator channel. Confirm the project shown
   in the Dashboard is `mwjqfzbpjmwiscvtxvfc`. Do not retrieve it from chat, shell
   history, an old `.env`, the linked CLI project, or a previously exposed credential.
3. Paste it without terminal echo into a session-only variable. The following gate does
   not print the value and rejects the Beta ref or any URL that does not contain the
   production ref:

   ```sh
   read -rs 'MB_V82_PRODUCTION_DB_URL?Temporary production DB URL: '
   export MB_V82_PRODUCTION_DB_URL
   case "$MB_V82_PRODUCTION_DB_URL" in
     *amzgqfvyjaiaoohnbcfl*) unset MB_V82_PRODUCTION_DB_URL; return 1 ;;
     *mwjqfzbpjmwiscvtxvfc*) ;;
     *) unset MB_V82_PRODUCTION_DB_URL; return 1 ;;
   esac
   ```

   Use this in an interactive `zsh` session so `return 1` stops the sourced/pasted
   gate. Never place the URL in `.env`, a command file, Git, logs, clipboard history,
   or a report.
4. Confirm the client and run only the reviewed read-only pre-flight:

   ```sh
   psql --version
   psql "$MB_V82_PRODUCTION_DB_URL" -X -v ON_ERROR_STOP=1 \
     -f supabase/production/preflight_v82.sql
   preflight_status=$?
   unset MB_V82_PRODUCTION_DB_URL
   test -z "${MB_V82_PRODUCTION_DB_URL+x}"
   ```

   `MB_V82_PREFLIGHT_RESULT=GO` plus exit status zero is the only passing result.
   `NO-GO`, a SQL error, timeout, missing identity gate, or nonzero exit status blocks
   promotion. Archive only `MB_V82_PREFLIGHT_REPORT`, which contains aggregate counts
   and technical object names. The script itself uses a repeatable-read, read-only
   transaction and rolls it back.
5. Compare remote migration history with `supabase/production-migrations.manifest`.
   No V82 version may be recorded unless its corresponding catalog state is complete.
6. Build an empty chain directory:

   ```sh
   task_chain_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-v82-production.XXXXXX")"
   node scripts/prepare-production-migrations.js "$task_chain_dir/supabase/migrations"
   ```

7. Under a separately approved production window, apply the clean directory with a
   production-specific database URL held only in the process environment:

   ```sh
   supabase migration up --db-url "$MB_V82_PRODUCTION_DB_URL" --workdir "$task_chain_dir" --yes
   ```

   Do not use `--linked`, `db push`, `--include-all`, or the repository migration
   directory. Verify the target ref independently before supplying the URL.
8. Re-list migration history and run catalog-only postchecks for columns, constraints,
   indexes, RPC properties, privileges and RLS. Deploy the V82 frontend only after all
   three versions are recorded and postchecks pass.

## Retry and partial-state detection

- SQL failure inside either file rolls back that entire file; rerun the same reviewed
  file after correcting the cause.
- If DDL committed but the migration-history acknowledgement was interrupted, compare
  catalog state and history, then rerun the same file. Its guards verify the existing
  objects and restore grants without duplicating schema objects.
- A `partial-compatible-or-drift` preflight result requires rerunning the relevant file;
  its semantic checks decide whether the subset is recoverable or incompatible.
- Migration 3 first proves every existing API-facing policy is owner-only and already
  covers CRUD. It refuses to consolidate a broader, restrictive, custom-role or
  incomplete policy. Excess grants and equivalent duplicate policies are known,
  recoverable pre-state; any failure rolls back their reconciliation atomically.
- Never mark history as applied merely because some columns exist. Only repair history
  after the complete catalog contract and file SHA are independently verified.

## Rollback

Database rollback is application-first and non-destructive:

1. Roll the frontend back to V81 and stop V82 writers.
2. Run `supabase/production/rollback_v82_writers.sql` only under separate approval to
   revoke the six V82 RPCs from API roles.
3. Preserve all structural columns, IDs, constraints and financial rows for audit.
   Keep migration 3's least-privilege grants and owner-only policies: they remain
   compatible with the V81 frontend and are security hardening, not V82 data writers.
4. Restore execution by rerunning the reviewed migrations after the defect is fixed.
5. Do not drop `operation_id`, recurrence identity, reversal links or user data.

The local recovery test proves atomic rollback, normal retry, compatible partial state,
incompatible drift rejection, writer-disable rollback, grant restoration and pgTAP:

```sh
bash supabase/tests/v82_production_migration_recovery_test.sh
```

The dedicated pre-flight test proves a compatible V81 `GO`, explicit `NO-GO` for
column drift, incorrect FK, cross-user references, zero amount, incompatible recurring
legacy, partial V82 state and incompatible RPC, plus enforcement of read-only mode:

```sh
bash supabase/tests/v82_production_preflight_test.sh
```
