#!/usr/bin/env bash
set -euo pipefail

# Local-only disposable validation for the unapplied Card Billing V1 candidate.
# It targets only the exact Docker container labelled for this local CLI project,
# reads no DB URL/token, creates isolated databases, and drops them on exit.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql"
rollback="$repo_root/supabase/rollback/rollback_20260828130535_aviora_card_billing_backend_v1.sql"
pgtap_suite="$repo_root/supabase/tests/card_billing_backend_v1_test.sql"
project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
task_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/aviora-card-billing-v1.XXXXXX")"
suffix="${BASHPID:-$$}"
normal_db="mb_card_billing_v1_normal_${suffix}"
empty_db="mb_card_billing_v1_empty_${suffix}"
drift_db="mb_card_billing_v1_drift_${suffix}"
shape_db="mb_card_billing_v1_shape_${suffix}"
shell_assertions=0

for command_name in docker rg; do
  command -v "$command_name" >/dev/null || {
    echo "required local command not found: $command_name" >&2
    exit 1
  }
done

docker inspect "$db_container" >/dev/null 2>&1 || {
  echo "local Supabase database container not found: $db_container" >&2
  exit 1
}
container_project="$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')"
if [[ "$container_project" != "$project_id" ]]; then
  echo 'refusing database container from another local project' >&2
  exit 1
fi

cleanup(){
  for database in "$normal_db" "$empty_db" "$drift_db" "$shape_db"; do
    case "$database" in
      mb_card_billing_v1_*)
        docker exec "$db_container" dropdb -U postgres \
          --if-exists --force "$database" \
          >/dev/null 2>&1 || true
        ;;
    esac
  done
  case "$task_tmp_dir" in
    "${TMPDIR:-/tmp}"/aviora-card-billing-v1.*) rm -rf "$task_tmp_dir" ;;
  esac
}
trap cleanup EXIT

psql_db(){
  local database="$1"
  shift
  docker exec -i "$db_container" psql -U postgres -d "$database" \
    -X -v ON_ERROR_STOP=1 "$@"
}

apply_file(){
  local database="$1"
  local file="$2"
  psql_db "$database" < "$file" >/dev/null
}

assert_sql(){
  local database="$1"
  local sql="$2"
  local expected="$3"
  local label="$4"
  local actual
  actual="$(psql_db "$database" -Atqc "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label: expected '$expected', got '$actual'" >&2
    exit 1
  fi
  shell_assertions=$((shell_assertions+1))
}

assert_file_fails(){
  local database="$1"
  local file="$2"
  local pattern="$3"
  local label="$4"
  local output="$task_tmp_dir/${label//[^a-zA-Z0-9_-]/_}.err"
  if psql_db "$database" < "$file" >"$output" 2>&1; then
    echo "$label: command unexpectedly succeeded" >&2
    exit 1
  fi
  if ! rg -q "$pattern" "$output"; then
    echo "$label: expected error pattern not found" >&2
    sed -n '1,120p' "$output" >&2
    exit 1
  fi
  shell_assertions=$((shell_assertions+1))
}

assert_sql_fails(){
  local database="$1"
  local sql="$2"
  local pattern="$3"
  local label="$4"
  local output="$task_tmp_dir/${label//[^a-zA-Z0-9_-]/_}.err"
  if psql_db "$database" -qc "$sql" >"$output" 2>&1; then
    echo "$label: SQL unexpectedly succeeded" >&2
    exit 1
  fi
  if ! rg -q "$pattern" "$output"; then
    echo "$label: expected error pattern not found" >&2
    sed -n '1,120p' "$output" >&2
    exit 1
  fi
  shell_assertions=$((shell_assertions+1))
}

create_base(){
  local database="$1"
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create schema auth;
create table auth.users(
  id uuid primary key,
  email text
);
create function auth.uid()
returns uuid
language sql stable
set search_path = pg_catalog
as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.accounts(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  opening_balance numeric not null default 0,
  constraint accounts_id_user_id_key unique(id, user_id)
);
create table public.cards(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  "limit" numeric not null default 0,
  closing_day integer,
  due_day integer,
  constraint cards_id_user_id_key unique(id, user_id)
);
create table public.transactions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  transaction_date date not null,
  description text not null,
  amount numeric not null check(amount >= 0),
  card_id uuid,
  transaction_type text not null default 'despesa',
  status text default 'realizado',
  note text,
  installment_series_id uuid,
  installment_number integer,
  constraint transactions_id_user_id_key unique(id, user_id),
  constraint transactions_card_user_fkey foreign key(card_id, user_id)
    references public.cards(id, user_id)
);

alter table public.accounts enable row level security;
alter table public.cards enable row level security;
alter table public.transactions enable row level security;
create policy accounts_own_rows on public.accounts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy cards_own_rows on public.cards for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy transactions_own_rows on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.accounts, public.cards, public.transactions to authenticated;
SQL
}

for database in "$normal_db" "$empty_db" "$drift_db" "$shape_db"; do
  create_base "$database"
done

# A legacy purchase exists before installation. It must not be inferred/backfilled.
psql_db "$normal_db" >/dev/null <<'SQL'
insert into auth.users(id,email)
values ('c1000000-0000-4000-8000-000000000001','legacy-card@example.invalid');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day)
values ('c1000000-0000-4000-8000-000000000101','c1000000-0000-4000-8000-000000000001','Legacy card',5000,20,30);
insert into public.accounts(id,user_id,name,opening_balance)
values ('c1000000-0000-4000-8000-000000000201','c1000000-0000-4000-8000-000000000001','Legacy account',5000);
insert into public.transactions(id,user_id,transaction_date,description,amount,card_id,transaction_type,status)
values ('c1000000-0000-4000-8000-000000000401','c1000000-0000-4000-8000-000000000001','2026-08-20','Legacy purchase',1000,'c1000000-0000-4000-8000-000000000101','despesa','realizado');
SQL

apply_file "$normal_db" "$migration"
assert_sql "$normal_db" "select concat_ws('|',transaction_date,coalesce(card_billing_cycle_id::text,'NULL')) from public.transactions where id='c1000000-0000-4000-8000-000000000401'" '2026-08-20|NULL' 'migration preserves legacy transaction_date and performs no backfill'
assert_file_fails "$normal_db" "$migration" 'objects already exist; semantic reconciliation is required' 'migration-rerun-drift'
assert_sql "$normal_db" "select count(*) from public.card_billing_cycles" '0' 'failed migration rerun leaves installed schema unchanged'

pgtap_output="$task_tmp_dir/card-billing.tap"
if ! psql_db "$normal_db" < "$pgtap_suite" >"$pgtap_output" 2>&1; then
  echo 'pgTAP execution failed before completion' >&2
  sed -n '1,220p' "$pgtap_output" >&2
  echo '--- pgTAP tail ---' >&2
  tail -120 "$pgtap_output" >&2
  exit 1
fi
if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' "$pgtap_output"; then
  rg -n '^[[:space:]]*(not ok|# Looks like you failed)' "$pgtap_output" >&2
  echo '--- pgTAP tail ---' >&2
  tail -160 "$pgtap_output" >&2
  exit 1
fi
pgtap_assertions="$(rg -c '^[[:space:]]*ok [0-9]+' "$pgtap_output")"
if [[ "$pgtap_assertions" -lt 50 ]]; then
  echo "expected broad pgTAP coverage, got $pgtap_assertions assertions" >&2
  exit 1
fi

assert_sql "$normal_db" "select has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,timestamptz,uuid)','execute')" 'f' 'payment mutator remains dormant'
assert_sql "$normal_db" "select has_function_privilege('authenticated','public.get_my_card_billing_summary_v1(uuid)','execute')" 't' 'summary reader is available'
assert_sql "$normal_db" "select has_table_privilege('authenticated','public.card_billing_shadow_comparison_v1','select')" 't' 'shadow comparator is readable through RLS'
assert_sql "$normal_db" "select to_regclass('public.card_limit_positions_v1') is null" 't' 'unapproved managed-limit view does not exist'

# Characterize dormant RPC idempotency and settlement arithmetic as the owner.
# This does not activate them for clients and does not satisfy the golden test.
psql_db "$normal_db" >/dev/null <<'SQL'
insert into public.card_billing_cycles(
  id,user_id,card_id,cycle_key,cycle_start_date,closing_date,due_date
) values
  ('c1000000-0000-4000-8000-000000000301','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000101','2099-01-01','2098-12-21','2099-01-20','2099-01-30'),
  ('c1000000-0000-4000-8000-000000000302','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000101','2099-02-01','2099-01-21','2099-02-20','2099-02-28'),
  ('c1000000-0000-4000-8000-000000000303','c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000101','2099-03-01','2099-02-21','2099-03-20','2099-03-30');
insert into public.transactions(
  id,user_id,transaction_date,description,amount,card_id,transaction_type,status,card_billing_cycle_id
) values
  ('c1000000-0000-4000-8000-000000000411','c1000000-0000-4000-8000-000000000001','2099-01-10','Dormant partial/full',1000,'c1000000-0000-4000-8000-000000000101','despesa','realizado','c1000000-0000-4000-8000-000000000301'),
  ('c1000000-0000-4000-8000-000000000412','c1000000-0000-4000-8000-000000000001','2099-02-10','Dormant retry race',700,'c1000000-0000-4000-8000-000000000101','despesa','realizado','c1000000-0000-4000-8000-000000000302'),
  ('c1000000-0000-4000-8000-000000000413','c1000000-0000-4000-8000-000000000001','2099-03-10','Dormant overpay race',800,'c1000000-0000-4000-8000-000000000101','despesa','realizado','c1000000-0000-4000-8000-000000000303');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.pay_my_card_invoice_v1(
  'c1000000-0000-4000-8000-000000000301',
  'c1000000-0000-4000-8000-000000000201',
  400,
  '2099-01-21T12:00:00Z',
  'c1000000-0000-4000-8000-000000000501'
);
SQL
assert_sql "$normal_db" "select concat_ws('|',outstanding_amount,paid_amount) from public.card_invoice_balances_v1 where id='c1000000-0000-4000-8000-000000000301'" '600|400' 'dormant partial payment arithmetic is consistent'

# Same operation/payload is retry-safe.
psql_db "$normal_db" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.pay_my_card_invoice_v1(
  'c1000000-0000-4000-8000-000000000301',
  'c1000000-0000-4000-8000-000000000201',
  400,
  '2099-01-21T12:00:00Z',
  'c1000000-0000-4000-8000-000000000501'
);
SQL
assert_sql "$normal_db" "select count(*) from public.card_invoice_payments where operation_id='c1000000-0000-4000-8000-000000000501'" '1' 'dormant retry returns one ledger row'
assert_sql_fails "$normal_db" "select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false); select public.pay_my_card_invoice_v1('c1000000-0000-4000-8000-000000000301','c1000000-0000-4000-8000-000000000201',601,'2099-01-22T12:00:00Z','c1000000-0000-4000-8000-000000000502');" 'payment exceeds invoice outstanding amount' 'dormant-overpayment'
assert_sql_fails "$normal_db" "select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false); select public.pay_my_card_invoice_v1('c1000000-0000-4000-8000-000000000301','c1000000-0000-4000-8000-000000000201',399,'2099-01-21T12:00:00Z','c1000000-0000-4000-8000-000000000501');" 'operation_id payload mismatch' 'dormant-idempotency-payload-mismatch'
assert_sql_fails "$normal_db" "select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000099',false); select public.pay_my_card_invoice_v1('c1000000-0000-4000-8000-000000000301','c1000000-0000-4000-8000-000000000201',1,'2099-01-22T12:00:00Z','c1000000-0000-4000-8000-000000000503');" 'query returned no rows' 'dormant-cross-user-payment'

# Full settlement, append-only reversal, credit and credit reversal are
# characterized only through owner execution while all client grants stay off.
psql_db "$normal_db" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.pay_my_card_invoice_v1(
  'c1000000-0000-4000-8000-000000000301',
  'c1000000-0000-4000-8000-000000000201',
  600,
  '2099-01-22T12:00:00Z',
  'c1000000-0000-4000-8000-000000000504'
);
SQL
assert_sql "$normal_db" "select concat_ws('|',outstanding_amount,paid_amount) from public.card_invoice_balances_v1 where id='c1000000-0000-4000-8000-000000000301'" '0|1000' 'dormant full payment closes arithmetic balance'

psql_db "$normal_db" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.reverse_my_card_payment_v1(
  (select id from public.card_invoice_payments where operation_id='c1000000-0000-4000-8000-000000000504'),
  'c1000000-0000-4000-8000-000000000505',
  '2099-01-23T12:00:00Z',
  'synthetic payment reversal'
);
SQL
assert_sql "$normal_db" "select concat_ws('|',outstanding_amount,paid_amount) from public.card_invoice_balances_v1 where id='c1000000-0000-4000-8000-000000000301'" '600|400' 'payment reversal compensates without deleting original'
psql_db "$normal_db" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.reverse_my_card_payment_v1(
  (select id from public.card_invoice_payments where operation_id='c1000000-0000-4000-8000-000000000504'),
  'c1000000-0000-4000-8000-000000000505',
  '2099-01-23T12:00:00Z',
  'synthetic payment reversal'
);
SQL
assert_sql "$normal_db" "select count(*) from public.card_invoice_payments where operation_id='c1000000-0000-4000-8000-000000000505'" '1' 'payment reversal retry is idempotent'
assert_sql_fails "$normal_db" "select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false); select public.reverse_my_card_payment_v1((select id from public.card_invoice_payments where operation_id='c1000000-0000-4000-8000-000000000504'),'c1000000-0000-4000-8000-000000000506','2099-01-24T12:00:00Z','second payment reversal');" 'card_invoice_payments_single_reversal_uidx' 'dormant-duplicate-payment-reversal'

psql_db "$normal_db" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.credit_my_card_purchase_v1(
  'c1000000-0000-4000-8000-000000000411',
  100,
  '2099-01-24T12:00:00Z',
  'c1000000-0000-4000-8000-000000000601',
  'synthetic purchase credit'
);
SQL
assert_sql "$normal_db" "select concat_ws('|',outstanding_amount,credited_amount) from public.card_invoice_balances_v1 where id='c1000000-0000-4000-8000-000000000301'" '500|100' 'purchase credit reduces dormant invoice balance'
psql_db "$normal_db" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.credit_my_card_purchase_v1(
  'c1000000-0000-4000-8000-000000000411',
  100,
  '2099-01-24T12:00:00Z',
  'c1000000-0000-4000-8000-000000000601',
  'synthetic purchase credit'
);
SQL
assert_sql "$normal_db" "select count(*) from public.card_purchase_credits where operation_id='c1000000-0000-4000-8000-000000000601'" '1' 'purchase credit retry is idempotent'
assert_sql_fails "$normal_db" "select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false); select public.credit_my_card_purchase_v1('c1000000-0000-4000-8000-000000000411',901,'2099-01-25T12:00:00Z','c1000000-0000-4000-8000-000000000604','excess synthetic credit');" 'purchase credit exceeds original purchase amount' 'dormant-overcredit'

psql_db "$normal_db" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.reverse_my_card_purchase_credit_v1(
  (select id from public.card_purchase_credits where operation_id='c1000000-0000-4000-8000-000000000601'),
  'c1000000-0000-4000-8000-000000000602',
  '2099-01-25T12:00:00Z',
  'synthetic credit reversal'
);
SQL
assert_sql "$normal_db" "select concat_ws('|',outstanding_amount,credited_amount) from public.card_invoice_balances_v1 where id='c1000000-0000-4000-8000-000000000301'" '600|0' 'credit reversal compensates without deleting original'
psql_db "$normal_db" >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false);
select public.reverse_my_card_purchase_credit_v1(
  (select id from public.card_purchase_credits where operation_id='c1000000-0000-4000-8000-000000000601'),
  'c1000000-0000-4000-8000-000000000602',
  '2099-01-25T12:00:00Z',
  'synthetic credit reversal'
);
SQL
assert_sql "$normal_db" "select count(*) from public.card_purchase_credits where operation_id='c1000000-0000-4000-8000-000000000602'" '1' 'credit reversal retry is idempotent'
assert_sql_fails "$normal_db" "select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',false); select public.reverse_my_card_purchase_credit_v1((select id from public.card_purchase_credits where operation_id='c1000000-0000-4000-8000-000000000601'),'c1000000-0000-4000-8000-000000000603','2099-01-26T12:00:00Z','second credit reversal');" 'card_purchase_credits_single_reversal_uidx' 'dormant-duplicate-credit-reversal'

run_payment(){
  local database="$1"
  local cycle_id="$2"
  local amount="$3"
  local operation_id="$4"
  local output_file="$5"
  psql_db "$database" >"$output_file" 2>&1 <<SQL
begin;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select (public.pay_my_card_invoice_v1(
  '$cycle_id',
  'c1000000-0000-4000-8000-000000000201',
  $amount,
  '2099-02-21T12:00:00Z',
  '$operation_id'
)).id;
commit;
SQL
}

# Concurrent retry with the same operation_id must converge to one row.
run_payment "$normal_db" 'c1000000-0000-4000-8000-000000000302' 700 'c1000000-0000-4000-8000-000000000521' "$task_tmp_dir/retry-a.log" &
retry_a_pid=$!
run_payment "$normal_db" 'c1000000-0000-4000-8000-000000000302' 700 'c1000000-0000-4000-8000-000000000521' "$task_tmp_dir/retry-b.log" &
retry_b_pid=$!
retry_a_status=0
retry_b_status=0
wait "$retry_a_pid" || retry_a_status=$?
wait "$retry_b_pid" || retry_b_status=$?
if [[ "$retry_a_status" -ne 0 || "$retry_b_status" -ne 0 ]]; then
  echo 'dormant concurrent retry failed' >&2
  sed -n '1,80p' "$task_tmp_dir/retry-a.log" >&2
  sed -n '1,80p' "$task_tmp_dir/retry-b.log" >&2
  exit 1
fi
shell_assertions=$((shell_assertions+1))
assert_sql "$normal_db" "select count(*) from public.card_invoice_payments where operation_id='c1000000-0000-4000-8000-000000000521'" '1' 'concurrent retry persists one row'

# Concurrent full payments with different operations: exactly one may succeed.
run_payment "$normal_db" 'c1000000-0000-4000-8000-000000000303' 800 'c1000000-0000-4000-8000-000000000531' "$task_tmp_dir/race-a.log" &
race_a_pid=$!
run_payment "$normal_db" 'c1000000-0000-4000-8000-000000000303' 800 'c1000000-0000-4000-8000-000000000532' "$task_tmp_dir/race-b.log" &
race_b_pid=$!
race_a_status=0
race_b_status=0
wait "$race_a_pid" || race_a_status=$?
wait "$race_b_pid" || race_b_status=$?
if [[ $(( (race_a_status == 0 ? 1 : 0) + (race_b_status == 0 ? 1 : 0) )) -ne 1 ]]; then
  echo "dormant payment race expected one success; got statuses $race_a_status/$race_b_status" >&2
  sed -n '1,80p' "$task_tmp_dir/race-a.log" >&2
  sed -n '1,80p' "$task_tmp_dir/race-b.log" >&2
  exit 1
fi
if ! rg -q 'payment exceeds invoice outstanding amount' "$task_tmp_dir/race-a.log" "$task_tmp_dir/race-b.log"; then
  echo 'dormant payment race loser did not fail closed as overpayment' >&2
  exit 1
fi
shell_assertions=$((shell_assertions+1))
assert_sql "$normal_db" "select count(*) from public.card_invoice_payments where billing_cycle_id='c1000000-0000-4000-8000-000000000303' and entry_kind='payment'" '1' 'different-operation race cannot overpay'

# Golden accounting activation is deliberately unmet: the hidden ledger has not
# debited the account. Keeping this assertion makes accidental activation fail.
assert_sql "$normal_db" "select opening_balance from public.accounts where id='c1000000-0000-4000-8000-000000000201'" '5000' 'account settlement integration is still absent'
assert_sql "$normal_db" "select count(*) from public.transactions where user_id='c1000000-0000-4000-8000-000000000001'" '4' 'dormant payments create no second economic transactions'
echo 'GOLDEN_ACCOUNTING_ACTIVATION_BLOCKED: purchase 1000 is economic once, but account 5000 remains 5000 until approved settlement integration'
echo 'CARD_BILLING_BETA_READINESS=HOLD'

# Rollback must refuse any persisted cycle, even without a payment/credit.
assert_file_fails "$normal_db" "$rollback" 'refusing destructive rollback' 'rollback-nonempty-cycle'
assert_sql "$normal_db" "select to_regclass('public.card_billing_cycles') is not null" 't' 'failed destructive rollback preserves installed schema'

# Empty installation can be removed safely.
apply_file "$empty_db" "$migration"
apply_file "$empty_db" "$rollback"
assert_sql "$empty_db" "select to_regclass('public.card_billing_cycles') is null" 't' 'empty rollback removes billing tables'
assert_sql "$empty_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='card_billing_cycle_id'" '0' 'empty rollback removes transition column'
assert_sql "$empty_db" "select to_regnamespace('billing_private') is null" 't' 'empty rollback removes only its private schema'

# Namespace drift is a fail-closed preflight and leaves no partial objects.
psql_db "$drift_db" -qc 'create schema billing_private' >/dev/null
assert_file_fails "$drift_db" "$migration" 'billing_private already exists' 'migration-private-schema-drift'
assert_sql "$drift_db" "select to_regclass('public.card_billing_cycles') is null" 't' 'drift failure is atomic'
assert_sql "$drift_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='card_billing_cycle_id'" '0' 'drift failure leaves transaction schema untouched'

# Base-shape drift must fail before creating any billing artifact. Exercise both
# the canonical transaction_date type and a required NOT NULL invariant.
psql_db "$shape_db" -qc "alter table public.transactions alter column transaction_date type timestamptz using transaction_date::timestamp at time zone 'UTC'" >/dev/null
assert_file_fails "$shape_db" "$migration" 'base column contract drift; reconcile schema before migration' 'migration-transaction-date-type-drift'
assert_sql "$shape_db" "select data_type from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='transaction_date'" 'timestamp with time zone' 'type-drift failure preserves incompatible source schema'
assert_sql "$shape_db" "select to_regclass('public.card_billing_cycles') is null" 't' 'type-drift failure creates no billing tables'
assert_sql "$shape_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='card_billing_cycle_id'" '0' 'type-drift failure adds no transition column'

psql_db "$shape_db" -qc "alter table public.transactions alter column transaction_date type date using transaction_date::date; alter table public.transactions alter column transaction_date drop not null" >/dev/null
assert_file_fails "$shape_db" "$migration" 'base column contract drift; reconcile schema before migration' 'migration-transaction-date-nullability-drift'
assert_sql "$shape_db" "select is_nullable from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='transaction_date'" 'YES' 'nullability-drift failure preserves incompatible source schema'
assert_sql "$shape_db" "select to_regclass('public.card_billing_cycles') is null" 't' 'nullability-drift failure creates no billing tables'
assert_sql "$shape_db" "select to_regnamespace('billing_private') is null" 't' 'shape-drift failures leave no private namespace'

echo 'PRODUCT_DECISION_REQUIRED: closing boundary/timezone, allocation model, managed limit, installments, credits-after-payment and retention remain intentionally untested as product contracts'
echo "card billing backend local clone: ${pgtap_assertions} pgTAP + ${shell_assertions} shell assertions; shadow mode and dormant RPC characterization passed"
