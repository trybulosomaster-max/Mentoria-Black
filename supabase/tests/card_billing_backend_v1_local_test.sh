#!/usr/bin/env bash
set -euo pipefail

# Local-only disposable validation. It resolves only the exact Docker container
# labelled for this local Supabase CLI project and never accepts a URL/token.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
v81="$repo_root/supabase/migrations/20260820161844_local_v81_structural_baseline.sql"
v82="$repo_root/supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql"
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
  command -v "$command_name" >/dev/null || { echo "required local command not found: $command_name" >&2; exit 1; }
done
for file in "$v81" "$v82" "$migration" "$rollback" "$pgtap_suite"; do
  [[ -f "$file" ]] || { echo "required test artifact missing: $file" >&2; exit 1; }
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
      mb_card_billing_v1_*) docker exec "$db_container" dropdb -U postgres --if-exists --force "$database" >/dev/null 2>&1 || true ;;
    esac
  done
  case "$task_tmp_dir" in
    "${TMPDIR:-/tmp}"/aviora-card-billing-v1.*) rm -rf "$task_tmp_dir" ;;
  esac
}
trap cleanup EXIT

psql_db(){
  local database="$1"; shift
  docker exec -i "$db_container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"
}
apply_file(){ local database="$1" file="$2"; psql_db "$database" < "$file" >/dev/null; }

assert_sql(){
  local database="$1" sql="$2" expected="$3" label="$4" actual
  actual="$(psql_db "$database" -Atqc "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label: expected '$expected', got '$actual'" >&2
    exit 1
  fi
  shell_assertions=$((shell_assertions+1))
}

assert_file_fails(){
  local database="$1" file="$2" pattern="$3" label="$4"
  local output="$task_tmp_dir/${label//[^a-zA-Z0-9_-]/_}.err"
  if psql_db "$database" < "$file" >"$output" 2>&1; then
    echo "$label: command unexpectedly succeeded" >&2; exit 1
  fi
  if ! rg -q "$pattern" "$output"; then
    echo "$label: expected error pattern not found" >&2; sed -n '1,160p' "$output" >&2; exit 1
  fi
  shell_assertions=$((shell_assertions+1))
}

assert_sql_fails(){
  local database="$1" sql="$2" pattern="$3" label="$4"
  local output="$task_tmp_dir/${label//[^a-zA-Z0-9_-]/_}.err"
  if psql_db "$database" -qc "$sql" >"$output" 2>&1; then
    echo "$label: SQL unexpectedly succeeded" >&2; exit 1
  fi
  if ! rg -q "$pattern" "$output"; then
    echo "$label: expected error pattern not found" >&2; sed -n '1,160p' "$output" >&2; exit 1
  fi
  shell_assertions=$((shell_assertions+1))
}

create_v82_clone(){
  local database="$1"
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable set search_path=pg_catalog
as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
SQL
  apply_file "$database" "$v81"
  apply_file "$database" "$v82"
}

for database in "$normal_db" "$empty_db" "$drift_db" "$shape_db"; do
  create_v82_clone "$database"
done

# Legacy rows are present before installation. No heuristic may associate them.
psql_db "$normal_db" >/dev/null <<'SQL'
insert into auth.users(id,email)
values ('c2000000-0000-4000-8000-000000000001','legacy-card@example.invalid');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day)
values ('c2000000-0000-4000-8000-000000000101','c2000000-0000-4000-8000-000000000001','Legacy card',5000,20,30);
insert into public.accounts(id,user_id,name,opening_balance,statement_balance)
values ('c2000000-0000-4000-8000-000000000201','c2000000-0000-4000-8000-000000000001','Legacy account',5000,5000);
insert into public.transactions(id,user_id,transaction_date,purchase_date,description,amount,card_id,transaction_type,status,note)
values (
  'c2000000-0000-4000-8000-000000000401','c2000000-0000-4000-8000-000000000001',
  '2026-08-20','2026-08-10','Legacy purchase',1000,
  'c2000000-0000-4000-8000-000000000101','despesa','realizado','Parcelado 1/2'
);
SQL

apply_file "$normal_db" "$migration"
assert_sql "$normal_db" "select concat_ws('|',transaction_date,coalesce(card_billing_cycle_id::text,'NULL'),coalesce(installment_total::text,'NULL')) from public.transactions where id='c2000000-0000-4000-8000-000000000401'" '2026-08-20|NULL|NULL' 'migration performs SAFE_NO_BACKFILL and preserves legacy transaction_date'
assert_file_fails "$normal_db" "$migration" 'objects already exist; semantic reconciliation is required' 'migration-rerun-drift'
assert_sql "$normal_db" "select count(*) from public.card_billing_cycles" '0' 'failed rerun leaves installed schema unchanged'

pgtap_output="$task_tmp_dir/card-billing.tap"
if ! psql_db "$normal_db" < "$pgtap_suite" >"$pgtap_output" 2>&1; then
  echo 'pgTAP execution failed before completion' >&2
  sed -n '1,240p' "$pgtap_output" >&2
  echo '--- pgTAP tail ---' >&2; tail -160 "$pgtap_output" >&2
  exit 1
fi
if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' "$pgtap_output"; then
  rg -n '^[[:space:]]*(not ok|# Looks like you failed)' "$pgtap_output" >&2
  echo '--- pgTAP tail ---' >&2; tail -200 "$pgtap_output" >&2
  exit 1
fi
pgtap_assertions="$(rg -c '^[[:space:]]*ok [0-9]+' "$pgtap_output")"
if [[ "$pgtap_assertions" -lt 100 ]]; then
  echo "expected broad pgTAP coverage, got $pgtap_assertions assertions" >&2
  exit 1
fi

# Artifact remains dormant after the rolled-back pgTAP grant.
assert_sql "$normal_db" "select has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute')" 'f' 'payment mutator remains dormant after test rollback'
assert_sql "$normal_db" "select has_function_privilege('authenticated','public.get_my_card_billing_summary_v1(uuid)','execute')" 't' 'summary reader remains available'

# Activate writers only in this disposable clone for concurrency/economic tests.
psql_db "$normal_db" >/dev/null <<'SQL'
grant execute on function public.structure_my_card_purchase_v1(uuid) to authenticated;
grant execute on function public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid) to authenticated;
grant execute on function public.reverse_my_card_payment_v1(uuid,uuid,date,text) to authenticated;
grant execute on function public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text) to authenticated;
grant execute on function public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text) to authenticated;

insert into auth.users(id,email)
values ('c2000000-0000-4000-8000-000000000002','concurrency-card@example.invalid');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day)
values ('c2000000-0000-4000-8000-000000000102','c2000000-0000-4000-8000-000000000002','Concurrency card',10000,20,30);
insert into public.accounts(id,user_id,name,opening_balance,statement_balance)
values ('c2000000-0000-4000-8000-000000000202','c2000000-0000-4000-8000-000000000002','Concurrency account',5000,5000);
insert into public.transactions(
  id,user_id,transaction_date,purchase_date,description,amount,card_id,transaction_type,status
) values
  ('c2000000-0000-4000-8000-000000000411','c2000000-0000-4000-8000-000000000002','2099-01-30','2099-01-10','Retry payment',700,'c2000000-0000-4000-8000-000000000102','despesa','realizado'),
  ('c2000000-0000-4000-8000-000000000412','c2000000-0000-4000-8000-000000000002','2099-02-28','2099-02-10','Overpay race',800,'c2000000-0000-4000-8000-000000000102','despesa','realizado'),
  ('c2000000-0000-4000-8000-000000000413','c2000000-0000-4000-8000-000000000002','2099-03-30','2099-03-10','Partial race',1000,'c2000000-0000-4000-8000-000000000102','despesa','realizado'),
  ('c2000000-0000-4000-8000-000000000414','c2000000-0000-4000-8000-000000000002','2099-04-30','2099-04-10','Credit race',1000,'c2000000-0000-4000-8000-000000000102','despesa','realizado'),
  ('c2000000-0000-4000-8000-000000000415','c2000000-0000-4000-8000-000000000002','2099-05-30','2099-05-10','Reversal race',600,'c2000000-0000-4000-8000-000000000102','despesa','realizado');

set role authenticated;
select set_config('request.jwt.claim.sub','c2000000-0000-4000-8000-000000000002',false);
select public.structure_my_card_purchase_v1('c2000000-0000-4000-8000-000000000411');
select public.structure_my_card_purchase_v1('c2000000-0000-4000-8000-000000000412');
select public.structure_my_card_purchase_v1('c2000000-0000-4000-8000-000000000413');
select public.structure_my_card_purchase_v1('c2000000-0000-4000-8000-000000000414');
select public.structure_my_card_purchase_v1('c2000000-0000-4000-8000-000000000415');
reset role;
SQL

run_payment(){
  local database="$1" transaction_id="$2" amount="$3" operation_id="$4" effective_date="$5" output_file="$6"
  psql_db "$database" >"$output_file" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','c2000000-0000-4000-8000-000000000002',true);
select public.pay_my_card_invoice_v1(
  (select card_billing_cycle_id from public.transactions where id='$transaction_id'),
  'c2000000-0000-4000-8000-000000000202',$amount,'$effective_date','$operation_id'
);
commit;
SQL
}

run_credit(){
  local database="$1" transaction_id="$2" amount="$3" operation_id="$4" effective_date="$5" output_file="$6"
  psql_db "$database" >"$output_file" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','c2000000-0000-4000-8000-000000000002',true);
select public.credit_my_card_purchase_v1('$transaction_id',$amount,'$effective_date','$operation_id','concurrent synthetic credit');
commit;
SQL
}

wait_pair(){
  local pid_a="$1" pid_b="$2" label="$3" status_a=0 status_b=0
  wait "$pid_a" || status_a=$?
  wait "$pid_b" || status_b=$?
  printf '%s|%s' "$status_a" "$status_b" > "$task_tmp_dir/${label}.status"
}

# Two identical retries converge on one payment/allocation/settlement.
run_payment "$normal_db" 'c2000000-0000-4000-8000-000000000411' 700 'c2000000-0000-4000-8000-000000000501' '2099-01-31' "$task_tmp_dir/retry-a.log" & retry_a=$!
run_payment "$normal_db" 'c2000000-0000-4000-8000-000000000411' 700 'c2000000-0000-4000-8000-000000000501' '2099-01-31' "$task_tmp_dir/retry-b.log" & retry_b=$!
wait_pair "$retry_a" "$retry_b" retry
assert_sql "$normal_db" "select count(*) from public.card_invoice_payments where operation_id='c2000000-0000-4000-8000-000000000501'" '1' 'concurrent retry persists one payment'
assert_sql "$normal_db" "select count(*) from public.card_payment_allocations a join public.card_invoice_payments p on p.id=a.payment_entry_id where p.operation_id='c2000000-0000-4000-8000-000000000501'" '1' 'concurrent retry persists one allocation'
assert_sql "$normal_db" "select count(*) from public.card_account_settlements s join public.card_invoice_payments p on p.id=s.payment_entry_id where p.operation_id='c2000000-0000-4000-8000-000000000501'" '1' 'concurrent retry persists one settlement'
retry_status="$(<"$task_tmp_dir/retry.status")"
if [[ "$retry_status" != '0|0' ]]; then
  echo "identical retry expected two successes, got $retry_status" >&2
  sed -n '1,100p' "$task_tmp_dir/retry-a.log" >&2; sed -n '1,100p' "$task_tmp_dir/retry-b.log" >&2; exit 1
fi
shell_assertions=$((shell_assertions+1))

# Different full-payment operations race over the same outstanding amount.
run_payment "$normal_db" 'c2000000-0000-4000-8000-000000000412' 800 'c2000000-0000-4000-8000-000000000511' '2099-03-01' "$task_tmp_dir/overpay-a.log" & overpay_a=$!
run_payment "$normal_db" 'c2000000-0000-4000-8000-000000000412' 800 'c2000000-0000-4000-8000-000000000512' '2099-03-01' "$task_tmp_dir/overpay-b.log" & overpay_b=$!
wait_pair "$overpay_a" "$overpay_b" overpay
overpay_status="$(<"$task_tmp_dir/overpay.status")"
if [[ "$overpay_status" != '0|3' && "$overpay_status" != '3|0' ]]; then
  echo "overpayment race expected one success, got $overpay_status" >&2
  sed -n '1,100p' "$task_tmp_dir/overpay-a.log" >&2; sed -n '1,100p' "$task_tmp_dir/overpay-b.log" >&2; exit 1
fi
rg -q 'payment exceeds invoice outstanding amount' "$task_tmp_dir/overpay-a.log" "$task_tmp_dir/overpay-b.log" || {
  echo 'overpayment race loser did not fail closed' >&2; exit 1;
}
shell_assertions=$((shell_assertions+2))
assert_sql "$normal_db" "select count(*) from public.card_invoice_payments p join public.transactions t on t.card_billing_cycle_id=p.billing_cycle_id where t.id='c2000000-0000-4000-8000-000000000412' and p.entry_kind='payment'" '1' 'overpayment race persists one payment'

# Independent partial payments serialize and settle exactly to zero.
run_payment "$normal_db" 'c2000000-0000-4000-8000-000000000413' 400 'c2000000-0000-4000-8000-000000000521' '2099-03-31' "$task_tmp_dir/partial-a.log" & partial_a=$!
run_payment "$normal_db" 'c2000000-0000-4000-8000-000000000413' 600 'c2000000-0000-4000-8000-000000000522' '2099-03-31' "$task_tmp_dir/partial-b.log" & partial_b=$!
wait_pair "$partial_a" "$partial_b" partial
partial_status="$(<"$task_tmp_dir/partial.status")"
if [[ "$partial_status" != '0|0' ]]; then
  echo "partial race expected two successes, got $partial_status" >&2
  sed -n '1,100p' "$task_tmp_dir/partial-a.log" >&2; sed -n '1,100p' "$task_tmp_dir/partial-b.log" >&2; exit 1
fi
shell_assertions=$((shell_assertions+1))
assert_sql "$normal_db" "select outstanding_amount::numeric from public.card_invoice_balances_v1 where id=(select card_billing_cycle_id from public.transactions where id='c2000000-0000-4000-8000-000000000413')" '0.00' 'concurrent partial payments settle exactly'

# Credit 200 and payment 800 commute under the cycle lock and never overpay.
run_credit "$normal_db" 'c2000000-0000-4000-8000-000000000414' 200 'c2000000-0000-4000-8000-000000000531' '2099-05-01' "$task_tmp_dir/credit-race-a.log" & credit_race_a=$!
run_payment "$normal_db" 'c2000000-0000-4000-8000-000000000414' 800 'c2000000-0000-4000-8000-000000000532' '2099-05-01' "$task_tmp_dir/credit-race-b.log" & credit_race_b=$!
wait_pair "$credit_race_a" "$credit_race_b" credit-race
credit_race_status="$(<"$task_tmp_dir/credit-race.status")"
if [[ "$credit_race_status" != '0|0' ]]; then
  echo "credit/payment race expected two successes, got $credit_race_status" >&2
  sed -n '1,100p' "$task_tmp_dir/credit-race-a.log" >&2; sed -n '1,100p' "$task_tmp_dir/credit-race-b.log" >&2; exit 1
fi
shell_assertions=$((shell_assertions+1))
assert_sql "$normal_db" "select concat_ws('|',outstanding_amount,credit_balance,settlement_state) from public.card_invoice_balances_v1 where id=(select card_billing_cycle_id from public.transactions where id='c2000000-0000-4000-8000-000000000414')" '0.00|0.00|settled' 'concurrent credit and payment settle deterministically'

# Reversal retry with the same key is deterministic and append-only.
run_payment "$normal_db" 'c2000000-0000-4000-8000-000000000415' 600 'c2000000-0000-4000-8000-000000000541' '2099-05-31' "$task_tmp_dir/reversal-setup.log"
run_reversal(){
  local operation_id="$1" output_file="$2"
  psql_db "$normal_db" >"$output_file" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','c2000000-0000-4000-8000-000000000002',true);
select public.reverse_my_card_payment_v1(
  (select id from public.card_invoice_payments where operation_id='c2000000-0000-4000-8000-000000000541'),
  '$operation_id','2099-06-01','concurrent reversal'
);
commit;
SQL
}
run_reversal 'c2000000-0000-4000-8000-000000000542' "$task_tmp_dir/reversal-a.log" & reversal_a=$!
run_reversal 'c2000000-0000-4000-8000-000000000542' "$task_tmp_dir/reversal-b.log" & reversal_b=$!
wait_pair "$reversal_a" "$reversal_b" reversal
reversal_status="$(<"$task_tmp_dir/reversal.status")"
if [[ "$reversal_status" != '0|0' ]]; then
  echo "reversal retry expected two successes, got $reversal_status" >&2
  sed -n '1,100p' "$task_tmp_dir/reversal-a.log" >&2; sed -n '1,100p' "$task_tmp_dir/reversal-b.log" >&2; exit 1
fi
shell_assertions=$((shell_assertions+1))
assert_sql "$normal_db" "select count(*) from public.card_invoice_payments where operation_id='c2000000-0000-4000-8000-000000000542'" '1' 'concurrent reversal retry persists one compensating entry'

# Duplicate settlement marker is rejected by the one-to-one constraint.
assert_sql_fails "$normal_db" "insert into public.card_account_settlements(user_id,payment_entry_id) select user_id,id from public.card_invoice_payments where operation_id='c2000000-0000-4000-8000-000000000501'" 'card_account_settlements_payment_key' 'duplicate-settlement'

# Economic golden: the view projection debits cash, never consumption twice.
assert_sql "$normal_db" "select 5000+sum(account_delta) from public.card_account_settlement_effects_v1 where operation_id='c2000000-0000-4000-8000-000000000501'" '4300.00' 'account effect follows payment exactly once'
assert_sql "$normal_db" "select sum(consumption_expense_delta) from public.card_account_settlement_effects_v1 where operation_id='c2000000-0000-4000-8000-000000000501'" '0' 'settlement is never a second expense'

# Remove temporary activation before readiness assertion.
psql_db "$normal_db" >/dev/null <<'SQL'
revoke execute on function public.structure_my_card_purchase_v1(uuid) from authenticated;
revoke execute on function public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid) from authenticated;
revoke execute on function public.reverse_my_card_payment_v1(uuid,uuid,date,text) from authenticated;
revoke execute on function public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text) from authenticated;
revoke execute on function public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text) from authenticated;
SQL
assert_sql "$normal_db" "select has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute')" 'f' 'temporary payment grant is removed'

echo 'GOLDEN_ACCOUNTING_TEST=PASS: purchase remains one economic expense; settlement effect debits only its account'

# Rollback refuses any persisted structured data.
assert_file_fails "$normal_db" "$rollback" 'refusing destructive rollback' 'rollback-nonempty-ledger'
assert_sql "$normal_db" "select to_regclass('public.card_billing_cycles') is not null" 't' 'failed destructive rollback preserves schema'

# Empty installation can be removed safely and precisely.
apply_file "$empty_db" "$migration"
apply_file "$empty_db" "$rollback"
assert_sql "$empty_db" "select to_regclass('public.card_billing_cycles') is null" 't' 'empty rollback removes cycles'
assert_sql "$empty_db" "select to_regclass('public.card_installment_series') is null" 't' 'empty rollback removes installment series'
assert_sql "$empty_db" "select to_regclass('public.card_account_settlements') is null" 't' 'empty rollback removes settlements'
assert_sql "$empty_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='transactions' and column_name in ('card_billing_cycle_id','installment_total')" '0' 'empty rollback removes both additive columns'
assert_sql "$empty_db" "select to_regnamespace('billing_private') is null" 't' 'empty rollback removes private schema'

# Namespace drift and V82 shape drift fail before partial creation.
psql_db "$drift_db" -qc 'create schema billing_private' >/dev/null
assert_file_fails "$drift_db" "$migration" 'billing_private already exists' 'migration-private-schema-drift'
assert_sql "$drift_db" "select to_regclass('public.card_billing_cycles') is null" 't' 'namespace drift failure is atomic'

psql_db "$shape_db" -qc 'alter table public.cards alter column closing_day type bigint' >/dev/null
assert_file_fails "$shape_db" "$migration" 'base column contract drift; reconcile schema before migration' 'migration-column-shape-drift'
assert_sql "$shape_db" "select data_type from information_schema.columns where table_schema='public' and table_name='cards' and column_name='closing_day'" 'bigint' 'shape drift failure preserves source schema'
assert_sql "$shape_db" "select to_regclass('public.card_billing_cycles') is null" 't' 'shape drift creates no billing artifacts'
assert_sql "$shape_db" "select to_regnamespace('billing_private') is null" 't' 'shape drift leaves no private namespace'

echo 'CARD_BILLING_BACKEND_READY_FOR_BETA_APPROVAL'
echo "card billing backend local clone: ${pgtap_assertions} pgTAP + ${shell_assertions} shell assertions; V81/V82 clone, calendar, RLS, golden, concurrency and rollback passed"
