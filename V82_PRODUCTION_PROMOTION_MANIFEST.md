# V82 Production Promotion Manifest

Status: controlled promotion executed on 22 August 2026; production post-flight and
non-destructive delivery smoke gates passed.

This document freezes the reviewed production inputs and the operational sequence. It
does not authorize or perform a database migration, Git merge, or production deploy.

## Immutable checkpoints

- Production Supabase project: `Mentoria Black` (`mwjqfzbpjmwiscvtxvfc`)
- Beta Supabase project: `Mentoria Black V82 Beta` (`amzgqfvyjaiaoohnbcfl`)
- Current V81 Git SHA: `0c82a679503ff14fb7ab634253c97c75b2f5f66b`
- Homologated functional V82 SHA: `13cb4d2e6c17743d8c08ade41e6e95e51dc35959`
- V81 safety tag: `v81-production-pre-v82` -> `0c82a679503ff14fb7ab634253c97c75b2f5f66b`
- V82 candidate tag: `v82-production-candidate` -> `13cb4d2e6c17743d8c08ade41e6e95e51dc35959`
- Documentation-only commits after the functional candidate do not change the
  homologated application payload. The promotion operator must inspect and accept
  every such commit before moving `main`.

## Backup and Auth gate

- Backup observed: `2026-08-22 06:13:54 UTC`
- Operational identifier: `PROD-PHYSICAL-20260822T061354Z`
- Type: `PHYSICAL`
- Status: available for restoration in the production Dashboard
- Restore control: present and manually confirmed; restoration was not executed
- Retention: seven daily backups under the Supabase Pro retention policy; earlier
  physical backups were also visible when this gate was confirmed
- Scope caveat: database backups cover the database; Storage API objects require a
  separate recovery plan if they are used by the application
- Restore method: choose the required production physical backup in **Database >
  Backups**, review the restore point and downtime warning, and confirm restoration
  only under separate incident authorization. Never test a restore over production.
- Leaked password protection: enabled in production Auth
- Security Advisor at gate close: `0 errors`, `0 warnings`, `0 suggestions`; the
  `auth_leaked_password_protection` warning is absent

## Approved migration chain

Apply exactly these files, cumulatively and in this order:

| Order | Migration | SHA-256 |
| --- | --- | --- |
| 1 | `20260820161846_add_v82_structured_financial_operations.sql` | `4676784a87862fdf6c046638ac970ae8bdd199d266ddf3f5805ff15e1fe2153f` |
| 2 | `20260820195658_structure_recurring_financial_operations_v82.sql` | `315d030541901f3d79273bde176e6f2533fbf135e46b3067763bc3c94cf64576` |
| 3 | `20260821205630_reconcile_v82_production_access_contract.sql` | `39ed7a5f9cad496cbf08c1f3eacf0d6800378b8f1d413ce3df9841bf979bf0e8` |

The previously frozen migration-1 checksum
`4a8b67b89d6987781241f389527fc13c414c42899b575d04f1584420f377f3ba`
is superseded and must not be used. Migrations 2 and 3 are byte-identical to their
previously reviewed versions. The new migration-1 checksum covers semantic reuse of
equivalent ownership keys and creation of the missing canonical transaction/recurring
keys before dependent FKs.

The local baseline `20260820161844_local_v81_structural_baseline.sql` is expressly
prohibited in production. No seed, fixture, Beta-only migration, generic `db push`,
`--linked`, `--include-all`, or repository-wide migration directory is allowed.

Every approved migration is explicitly transactional and acquires the same
transaction-scoped advisory lock before DDL:

```sql
pg_advisory_xact_lock(hashtextextended('mentoria-black:v82:production-chain', 0))
```

The lock serializes each migration transaction. A competing deployment, lock timeout,
statement timeout, semantic drift error, or checksum mismatch is an automatic stop.

## Reconciled V81 input and controlled cleanup prerequisite

The verified V81 pre-state accepts `numeric(14,2)` for the reviewed account, asset,
recurring and transaction amount fields, preserves their existing defaults and
nullability, accepts nullable `categories.kind DEFAULT 'expense'`, and expects the
compound transaction/recurring ownership keys to be absent. No value rewrite or
inferred relationship is permitted. Migration 3 changes only the future default of
`categories.kind` and `recurring.type` to `despesa`.

Before any migration, exactly four objectively audited incompatible test transactions
were required to be exported to a restricted file outside Git and deleted in one
transaction by their exact locked IDs. Required and observed aggregate counts are:

| Object | Before | After |
| --- | ---: | ---: |
| `transactions` | 183 | 179 |
| `recurring` | 15 | 15 |
| `goals` | 4 | 4 |
| `accounts` | 1 | 1 |
| `cards` | 1 | 1 |
| `assets` | 0 | 0 |
| `liabilities` | 0 | 0 |
| Auth users | 3 | 3 |

The execution record may contain only cleanup time, count `4`, aggregate before/after
counts, restricted-export SHA-256, backup availability, post-cleanup preflight result,
and Advisor result. It must never contain row IDs, descriptions, notes, values, or user
identifiers. Any deviation rolls back and blocks promotion.

### Controlled cleanup execution record

- Committed at: `2026-08-22 15:23:22 UTC`
- Transactions deleted: `4`
- Technical reason: incompatible, non-reconstructible V82 test transactions; no
  account/asset/endpoint relationship was inferred
- Counts: `transactions 183 -> 179`; `recurring 15 -> 15`; `goals 4 -> 4`;
  `accounts 1 -> 1`; `cards 1 -> 1`; `assets 0 -> 0`; `liabilities 0 -> 0`;
  Auth users `3 -> 3`
- Restricted export SHA-256:
  `6e7e8c275e3ca21b20b94f4c05b09c2701706f3d3a924fd72addbdf051e79683`
- Physical backup gate: `PROD-PHYSICAL-20260822T061354Z` remained available
- Post-cleanup read-only preflight: `GO`
- Post-cleanup Security Advisor: `0` findings
- No migration, schema, Auth, RLS, grant, frontend, `main`, or Beta change was included
  in the cleanup transaction

## Preconditions for the separately authorized window

1. Reconfirm the backup above is still available and record the newest completed
   restore point without viewing its contents.
2. Reconfirm production ref `mwjqfzbpjmwiscvtxvfc` and reject Beta ref
   `amzgqfvyjaiaoohnbcfl`.
3. Reconfirm the V81 and V82 tags, `main`, `origin/main`, candidate branch, remote
   candidate branch, and a clean working tree.
4. Recompute all three SHA-256 values and compare them byte-for-byte with this file.
5. Re-run `supabase/production/preflight_v82.sql` in a read-only transaction. Only
   `MB_V82_PREFLIGHT_RESULT=GO` and exit status zero permit continuation.
6. Confirm leaked-password protection remains enabled and Security Advisor has no
   security findings.
7. Confirm the production frontend rollback artifact built from
   `v81-production-pre-v82` is available before any database change.
8. Use a newly issued, session-only production database URL entered without terminal
   echo. Reject any URL that does not contain the production ref; unset it immediately
   after the database phase. Never store it in Git, `.env`, a report, or shell history.

## Controlled promotion sequence — do not run without separate authorization

### A-C. Freeze, identity, and lock preparation

1. Confirm backup, project refs, SHAs, tags, clean Git state, migration checksums, Auth
   protection, and the read-only preflight.
2. Create an empty disposable work directory outside the repository. Stage only the
   approved migration files, cumulatively. Never alter the reviewed source files.
3. Do not obtain an unrelated global lock. Each approved file must acquire the common
   transaction-scoped advisory lock shown above before performing DDL.

Example preparation, with no production write by itself:

```sh
task_chain_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-v82-production.XXXXXX")"
mkdir -p "$task_chain_dir/supabase/migrations"
install -m 0600 \
  supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql \
  "$task_chain_dir/supabase/migrations/"
```

### D-I. Apply and validate one migration at a time

For each step, `MB_V82_PRODUCTION_DB_URL` must be a session-only credential for
`mwjqfzbpjmwiscvtxvfc`. The commands below are reserved for the separately authorized
promotion window.

1. Apply migration 1 from the disposable workdir:

   ```sh
   supabase migration up --db-url "$MB_V82_PRODUCTION_DB_URL" \
     --workdir "$task_chain_dir" --yes
   ```

2. Validate migration 1 by rerunning the read-only catalog gate:

   ```sh
   psql "$MB_V82_PRODUCTION_DB_URL" -X -v ON_ERROR_STOP=1 \
     -f supabase/production/preflight_v82.sql
   ```

   Required state: migration 1 history/catalog `complete`, migrations 2 and 3
   `pending`, no blockers, and `MB_V82_PREFLIGHT_RESULT=GO`.

3. Stage migration 2 beside migration 1, apply pending migrations with the same
   `supabase migration up` command, and rerun the preflight. Required state: migrations
   1 and 2 `complete`, migration 3 `pending`, no blockers, and `GO`.

   ```sh
   install -m 0600 \
     supabase/migrations/20260820195658_structure_recurring_financial_operations_v82.sql \
     "$task_chain_dir/supabase/migrations/"
   ```

4. Stage migration 3 beside migrations 1 and 2, apply pending migrations, and rerun
   the preflight. Required state: all three history/catalog states `complete`, no
   blockers, and `GO`.

   ```sh
   install -m 0600 \
     supabase/migrations/20260821205630_reconcile_v82_production_access_contract.sql \
     "$task_chain_dir/supabase/migrations/"
   ```

5. Post-flight must additionally confirm the reviewed columns, compound ownership
   FKs, `NOT VALID` legacy-preserving constraints, indexes, RLS policies, grants,
   `SECURITY INVOKER` RPCs, controlled `search_path`, migration history, zero partial
   catalog state, and a clean Security Advisor. Archive only aggregate counts and
   technical object names.

6. Unset the database URL and remove the disposable workdir after evidence is safely
   recorded:

   ```sh
   unset MB_V82_PRODUCTION_DB_URL
   case "$task_chain_dir" in
     "${TMPDIR:-/tmp}"/mb-v82-production.*) rm -rf -- "$task_chain_dir" ;;
     *) return 1 ;;
   esac
   ```

### J-M. Git, frontend, and smoke test

Only after the database post-flight is `GO`:

1. Reconfirm that `origin/main` still equals the V81 safety tag and review every commit
   between `v82-production-candidate` and `origin/beta/v82`; only approved gate
   documentation may follow the functional candidate.
2. Fast-forward `main` to the approved remote candidate branch; never force-push:

   ```sh
   git fetch origin --prune --tags
   git switch main
   git merge --ff-only origin/beta/v82
   git push origin main
   ```

3. Build and deploy the official frontend only from the resulting `main`. Confirm the
   artifact references production `mwjqfzbpjmwiscvtxvfc`, contains no Beta ref, no
   administrative key, no credential, and no unreviewed file.
4. Run minimal non-destructive smoke tests: application load, production project ref,
   Auth login/logout with a separately approved non-real smoke account, Dashboard,
   navigation, read paths, structured-operation UI availability, browser console and
   network errors. Do not create or mutate real financial data during smoke testing.

## Automatic stop criteria

Stop immediately before the next step if any of these occurs:

- production/Beta identity ambiguity or a project-ref mismatch;
- backup unavailable, incomplete, outside retention, or Restore control unavailable;
- Git SHA, tag, branch, working-tree, manifest, or migration checksum mismatch;
- leaked-password protection disabled or any Security Advisor finding;
- preflight/post-flight `NO-GO`, nonzero exit, timeout, unexpected count, history/catalog
  mismatch, partial state, cross-user reference, incompatible legacy row, or drift;
- advisory-lock or statement-lock timeout;
- any migration other than the three approved files becomes pending;
- any migration fails, or expected objects/grants/RLS/RPC properties do not match;
- production frontend artifact references Beta, exposes a secret, or differs from the
  reviewed candidate;
- smoke-test Auth, RLS, RPC, console, network, or core-navigation failure.

No automatic retry is allowed until the failure is classified. A transactional file
may be retried only after confirming its rollback or its complete compatible catalog
state with the approved preflight and unchanged checksum.

## Application-first rollback

1. Stop the production deploy and restore the V81 frontend artifact built from
   `v81-production-pre-v82`. This is the first response even when V82 schema already
   committed.
2. Preserve V82 columns, identifiers, constraints, indexes, policies, grants, migration
   history, and financial rows. Do not run destructive down migrations or infer a data
   backfill during the incident.
3. If V82 write entry points must be disabled, obtain separate approval and execute:

   ```sh
   psql "$MB_V82_PRODUCTION_DB_URL" -X -v ON_ERROR_STOP=1 \
     -f supabase/production/rollback_v82_writers.sql
   ```

   This script acquires the common advisory lock and revokes API execution from these
   V82 writers while preserving data and schema:
   `create_transfer_v82`, `create_investment_v82`, `create_rescue_v82`,
   `reverse_structured_operation_v82`, `materialize_recurring_occurrences_v82`, and
   `create_investment_entry_v82`.
4. Restore RPC execution only by rerunning the unchanged, checksum-verified approved
   migrations after the defect is fixed and a new promotion authorization is granted.
5. If `main` already moved, do not reset or force-push it. Keep serving the V81 artifact
   immediately, then prepare a reviewed revert commit for Git history.
6. Use the confirmed physical backup only for database corruption or an unrecoverable
   migration incident, under separate restore authorization and planned downtime.

## Return to V81 and Beta cleanup

- The immediate application return point is the artifact and source identified by
  `v81-production-pre-v82`; the production database remains forward-compatible and its
  security hardening is preserved.
- Keep the V82 Beta online during the rollback/stability window.
- After commercial acceptance and the defined stability window, separately authorize:
  revocation of temporary Beta sessions/credentials, removal of synthetic Beta users,
  removal of obsolete Beta Auth redirects, retirement of the Beta frontend, and Beta
  project archival or deletion only after any required evidence is retained.
- Never remove the Beta, its users, or backups as part of the promotion command.

## Confidentiality assertion

This manifest contains no password, token, authenticated connection string,
`service_role` credential, publishable key, personal data, or financial data.

## Execution record — 22 August 2026

- Authorized candidate: `beta/v82` at
  `c4a757dda90d3f32271b0d3bd2fb565d3c7368d7`
- V81 return point: `0c82a679503ff14fb7ab634253c97c75b2f5f66b`
- Production release configuration commit:
  `b00736aa26b18f5311cd51279de1af12f828317c`
- Production merge commit: `de55cc1c77dec85ca354c327fe533b85bbdff576`
- GitHub Pages build: `1168058276`, completed at `2026-08-22T15:52:49Z`
- Official URL: `https://trybulosomaster-max.github.io/Mentoria-Black/`
- Applied migration history, in order:
  `20260820161846`, `20260820195658`, `20260821205630`
- Every migration passed an independent read-only catalog/history gate before the
  next migration was started; the final preflight result was `GO`.
- Final protected counts: transactions `179`, recurring `15`, goals `4`, accounts
  `1`, cards `1`, assets `0`, liabilities `0`, Auth users `3`.
- Final integrity counts: incompatible structured transactions `0`, cross-user
  references `0`, duplicate operation identities `0`, duplicate recurring
  occurrences `0`.
- Transactional rollback-only production tests passed for owner isolation,
  cross-user rejection, transfer, investment, rescue, reversal, UI investment
  wrapper, recurring materialization and idempotency. Synthetic residue: `0`.
- Security Advisor after promotion: `0` findings. Performance Advisor reported only
  non-blocking optimization notices (`36 INFO`, `38 WARN`); no promotion-time
  refactor was attempted.
- Official active artifact: `16` files, byte-identical to the reviewed local
  artifact; production project ref only; no Beta ref, administrative secret,
  authenticated database URL, synthetic user or unknown script.
- Delivery smoke: HTTPS `200`, official title/manifest/cache, Auth health/settings
  `200`, and anonymous access to a private financial table rejected (`401`). The
  functional modules are byte-identical to the Safari/mobile-homologated candidate.
  No connected browser session was available, so no credential-bearing interactive
  login or real-data view was attempted; no real financial data was mutated.
- Rollback was not invoked. The physical backup remains untouched and the Beta
  project, Beta branch and Beta site remain available.
