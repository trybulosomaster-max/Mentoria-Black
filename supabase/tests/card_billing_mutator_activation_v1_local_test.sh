#!/usr/bin/env bash
set -euo pipefail

# Local-only disposable validation. It resolves only the exact Docker container
# labelled for this workspace and never accepts a URL, token or linked project.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
v81="$repo_root/supabase/migrations/20260820161844_local_v81_structural_baseline.sql"
v82="$repo_root/supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql"
shadow="$repo_root/supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql"
activation="$repo_root/supabase/migrations/20260828173831_aviora_card_billing_mutator_activation_v1.sql"
revocation="$repo_root/supabase/migrations/20260828182643_revoke_card_billing_mutators_pending_review.sql"
temporal="$repo_root/supabase/migrations/20260828183342_harden_card_billing_temporal_contracts_v1.sql"
rollback="$repo_root/supabase/rollback/rollback_20260828173831_aviora_card_billing_mutator_activation_v1.sql"
temporal_rollback="$repo_root/supabase/rollback/rollback_20260828183342_harden_card_billing_temporal_contracts_v1.sql"
pgtap_suite="$repo_root/supabase/tests/card_billing_mutator_activation_v1_test.sql"
project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
task_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/aviora-card-activation-v1.XXXXXX")"
suffix="${BASHPID:-$$}"
normal_db="mb_card_activation_v1_normal_${suffix}"
empty_db="mb_card_activation_v1_empty_${suffix}"
drift_db="mb_card_activation_v1_drift_${suffix}"
rls_db="mb_card_activation_v1_rls_${suffix}"
future_drift_db="mb_card_activation_v1_future_${suffix}"
payment_drift_db="mb_card_activation_v1_payment_${suffix}"
rollback_used_db="mb_card_activation_v1_rollback_${suffix}"
assertions=0

for command_name in docker rg node; do
  command -v "$command_name" >/dev/null || {
    echo "required local command not found: $command_name" >&2
    exit 1
  }
done
for file in "$v81" "$v82" "$shadow" "$activation" "$revocation" "$temporal" "$rollback" "$temporal_rollback" "$pgtap_suite"; do
  [[ -f "$file" ]] || { echo "required test artifact missing: $file" >&2; exit 1; }
done

docker inspect "$db_container" >/dev/null 2>&1 || {
  echo "local Supabase database container not found: $db_container" >&2
  exit 1
}
[[ "$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" == "$project_id" ]] || {
  echo 'refusing database container from another local project' >&2
  exit 1
}

cleanup(){
  for database in "$normal_db" "$empty_db" "$drift_db" "$rls_db" "$future_drift_db" "$payment_drift_db" "$rollback_used_db"; do
    case "$database" in
      mb_card_activation_v1_*)
        docker exec "$db_container" dropdb -U postgres --if-exists --force "$database" >/dev/null 2>&1 || true
        ;;
    esac
  done
  case "$task_tmp_dir" in
    "${TMPDIR:-/tmp}"/aviora-card-activation-v1.*) rm -rf "$task_tmp_dir" ;;
  esac
}
trap cleanup EXIT

psql_db(){
  local database="$1"; shift
  docker exec -i "$db_container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"
}
apply_file(){
  local database="$1" file="$2"
  psql_db "$database" < "$file" >/dev/null
}
assert_sql(){
  local database="$1" sql="$2" expected="$3" label="$4" actual
  actual="$(psql_db "$database" -Atqc "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label: expected '$expected', got '$actual'" >&2
    exit 1
  fi
  assertions=$((assertions+1))
}
assert_file_fails(){
  local database="$1" file="$2" pattern="$3" label="$4"
  local output="$task_tmp_dir/${label//[^a-zA-Z0-9_-]/_}.err"
  if psql_db "$database" -v VERBOSITY=verbose < "$file" >"$output" 2>&1; then
    echo "$label: command unexpectedly succeeded" >&2
    exit 1
  fi
  if ! rg -q "$pattern" "$output"; then
    echo "$label: expected error pattern not found" >&2
    sed -n '1,180p' "$output" >&2
    exit 1
  fi
  assertions=$((assertions+1))
}

create_shadow_clone(){
  local database="$1"
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid()
returns uuid
language sql
stable
set search_path=pg_catalog
as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
SQL
  apply_file "$database" "$v81"
  apply_file "$database" "$v82"
  psql_db "$database" >/dev/null <<'SQL'
create table public.synthetic_access(
  user_id uuid primary key references auth.users(id),
  app boolean,
  knowledge boolean not null default false,
  expires_at timestamptz,
  access_kind text not null
);
alter table public.synthetic_access enable row level security;
create policy synthetic_access_read_own
  on public.synthetic_access for select to authenticated
  using ((select auth.uid())=user_id);
grant select on public.synthetic_access to authenticated;
create function public.has_active_access(p_product_slug text default 'mentoria-black')
returns boolean
language sql
stable
security invoker
set search_path=pg_catalog
as $$
  select case upper(trim(p_product_slug))
    when 'APP' then (
      select case
        when a.app is null then null
        when a.app is false then false
        when a.expires_at is not null and a.expires_at <= statement_timestamp() then false
        else true
      end
      from public.synthetic_access a where a.user_id=auth.uid()
    )
    when 'KNOWLEDGE' then coalesce((
      select a.knowledge from public.synthetic_access a where a.user_id=auth.uid()
    ),false)
    else false
  end
$$;
revoke all on function public.has_active_access(text) from public,anon,authenticated;
grant execute on function public.has_active_access(text) to authenticated;
SQL
  apply_file "$database" "$shadow"
}

for database in "$normal_db" "$empty_db" "$drift_db" "$rls_db" "$future_drift_db" "$payment_drift_db" "$rollback_used_db"; do
  create_shadow_clone "$database"
done

# A pre-existing ambiguous card transaction proves all forward migrations keep
# SAFE_NO_BACKFILL. It is deliberately unlinked and never inferred by note.
psql_db "$normal_db" >/dev/null <<'SQL'
insert into auth.users(id,email)
values ('d2000000-0000-4000-8000-000000000001','temporal-legacy@example.invalid');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day)
values ('d2100000-0000-4000-8000-000000000101','d2000000-0000-4000-8000-000000000001','Temporal legacy card',1000,10,20);
insert into public.transactions(
  id,user_id,transaction_date,purchase_date,description,amount,card_id,
  transaction_type,status,note
) values (
  'd2400000-0000-4000-8000-000000000401','d2000000-0000-4000-8000-000000000001',
  '2026-07-20','2026-07-01','Ambiguous historical installment',100,
  'd2100000-0000-4000-8000-000000000101','despesa','realizado','Parcelado 1/2'
);
SQL

apply_file "$normal_db" "$activation"
assert_sql "$normal_db" \
  "select concat_ws('|',has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'),has_function_privilege('anon','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'))" \
  't|f' \
  'reviewed activation exposes its authenticated writer before fail-closed revocation'
apply_file "$normal_db" "$revocation"
apply_file "$normal_db" "$temporal"
assert_sql "$normal_db" \
  "select concat_ws('|',has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'),has_function_privilege('anon','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'),has_function_privilege('authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'),to_regprocedure('billing_private.pay_my_card_invoice_shadow_impl_v1(uuid,uuid,numeric,date,uuid)') is not null)" \
  'f|f|t|t' \
  'temporal hardening preserves dormant public mutators'
assert_sql "$normal_db" \
  "select concat_ws('|',card_billing_cycle_id is null,installment_series_id is null,installment_total is null,operation_id is null,transaction_date,purchase_date) from public.transactions where id='d2400000-0000-4000-8000-000000000401'" \
  't|t|t|t|2026-07-20|2026-07-01' \
  'temporal hardening performs zero backfill and preserves historical competence'
assert_sql "$normal_db" \
  "select (select count(*) from public.card_installment_series)+(select count(*) from public.card_billing_cycles)+(select count(*) from public.card_invoice_payments)+(select count(*) from public.card_payment_allocations)+(select count(*) from public.card_account_settlements)+(select count(*) from public.card_purchase_credits)" \
  '0' \
  'temporal hardening creates no structured ledger rows during migration'

pgtap_output="$task_tmp_dir/card-activation.tap"
if ! psql_db "$normal_db" < "$pgtap_suite" >"$pgtap_output" 2>&1; then
  echo 'activation pgTAP execution failed before completion' >&2
  sed -n '1,260p' "$pgtap_output" >&2
  echo '--- pgTAP tail ---' >&2
  tail -180 "$pgtap_output" >&2
  exit 1
fi
if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' "$pgtap_output"; then
  rg -n '^[[:space:]]*(not ok|# Looks like you failed)' "$pgtap_output" >&2
  echo '--- pgTAP tail ---' >&2
  tail -220 "$pgtap_output" >&2
  exit 1
fi
pgtap_assertions="$(rg -c '^[[:space:]]*ok [0-9]+' "$pgtap_output")"
if [[ "$pgtap_assertions" -lt 80 ]]; then
  echo "expected targeted activation coverage, got $pgtap_assertions assertions" >&2
  exit 1
fi
for semantic_label in \
  'golden account is 5000 minus one neutral settlement = 4000' \
  'payment settlement reduces cash and never creates a second expense' \
  'golden economic expense remains exactly 1000'; do
  if ! rg -q "^[[:space:]]*ok [0-9]+ - ${semantic_label}$" "$pgtap_output"; then
    echo "missing mandatory golden pgTAP proof: ${semantic_label}" >&2
    exit 1
  fi
  assertions=$((assertions+1))
done

assert_sql "$normal_db" \
  "select concat_ws('|',has_function_privilege('authenticated','public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)','execute'),has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'))" \
  'f|f' \
  'transactional test activation rolls back and leaves mutators dormant'

# A second application is drift, never an idempotent silent rewrite.
assert_file_fails "$normal_db" "$activation" \
  'complete approved shadow schema|shadow mutator drift|objects already exist' \
  'activation-rerun-drift'
assert_sql "$normal_db" \
  "select has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute')" \
  'f' \
  'failed rerun leaves temporal mutators dormant'

# Empty activation rollback restores the dormant shadow contract exactly enough
# to permit a clean activation retry.
apply_file "$empty_db" "$activation"
apply_file "$empty_db" "$rollback"
assert_sql "$empty_db" \
  "select concat_ws('|',to_regprocedure('public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)') is not null,has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'),to_regprocedure('public.get_my_card_billing_summary_as_of_v1(uuid,date)') is null)" \
  't|f|t' \
  'empty rollback restores dormant public surface'
apply_file "$empty_db" "$activation"
assert_sql "$empty_db" \
  "select has_function_privilege('authenticated','public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)','execute')" \
  't' \
  'rolled-back empty installation can activate cleanly again'

# Drifted privilege fails before any rename or grant.
psql_db "$drift_db" -qc \
  "grant execute on function public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid) to authenticated" >/dev/null
assert_file_fails "$drift_db" "$activation" 'shadow mutator drift' 'activation-privilege-drift'
assert_sql "$drift_db" \
  "select concat_ws('|',to_regprocedure('public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)') is not null,to_regprocedure('billing_private.pay_my_card_invoice_shadow_impl_v1(uuid,uuid,numeric,date,uuid)') is null)" \
  't|t' \
  'drift refusal leaves function topology untouched'

# Temporal preflight fails atomically when any required shadow table loses RLS.
apply_file "$rls_db" "$activation"
apply_file "$rls_db" "$revocation"
psql_db "$rls_db" -qc 'alter table public.card_billing_cycles disable row level security' >/dev/null
assert_file_fails "$rls_db" "$temporal" \
  'card billing temporal hardening requires RLS on all shadow tables' \
  'temporal-rls-disabled-preflight'
assert_sql "$rls_db" \
  "select concat_ws('|',not (select relrowsecurity from pg_class where oid='public.card_billing_cycles'::regclass),to_regprocedure('billing_private.guard_card_purchase_temporal_v1()') is null,to_regprocedure('public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)') is not null,has_function_privilege('authenticated','public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)','execute'),has_function_privilege('authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'))" \
  't|t|t|f|t' \
  'RLS preflight failure leaves topology and dormant grants unchanged'

# A persisted linked realized purchase in the future is historical drift, not
# something the forward hardening migration may silently rewrite.
apply_file "$future_drift_db" "$activation"
psql_db "$future_drift_db" >/dev/null <<'SQL'
insert into auth.users(id,email)
values ('d7000000-0000-4000-8000-000000000001','future-drift@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,access_kind)
values ('d7000000-0000-4000-8000-000000000001',true,false,'APP');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day)
values ('d7100000-0000-4000-8000-000000000101','d7000000-0000-4000-8000-000000000001','Future drift card',1000,10,20);
set role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000001',false);
select public.create_my_card_purchase_v1(
  'd7400000-0000-4000-8000-000000000401',
  'd7100000-0000-4000-8000-000000000101',
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date+1,
  'Persisted future realized drift',100,'realizado',null,null,null,null,null,null
);
reset role;
SQL
apply_file "$future_drift_db" "$revocation"
assert_file_fails "$future_drift_db" "$temporal" \
  'P0001: temporal hardening refuses persisted realized purchase chronology drift' \
  'temporal-future-purchase-drift'
assert_sql "$future_drift_db" \
  "select concat_ws('|',(select count(*) from public.transactions where operation_id='d7400000-0000-4000-8000-000000000401' and card_billing_cycle_id is not null and purchase_date>(statement_timestamp() at time zone 'America/Sao_Paulo')::date),to_regprocedure('billing_private.guard_card_purchase_temporal_v1()') is null,to_regprocedure('billing_private.create_my_card_purchase_pre_temporal_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)') is null,to_regprocedure('public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)') is not null,has_function_privilege('authenticated','public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)','execute'),has_function_privilege('authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'))" \
  '1|t|t|t|f|t' \
  'future-purchase drift failure is atomic and preserves dormant topology'

# A payment dated before an otherwise valid realized purchase is a separate
# chronology branch and receives its own clone/proof.
apply_file "$payment_drift_db" "$activation"
psql_db "$payment_drift_db" >/dev/null <<'SQL'
insert into auth.users(id,email)
values ('d7000000-0000-4000-8000-000000000002','payment-drift@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,access_kind)
values ('d7000000-0000-4000-8000-000000000002',true,false,'APP');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day)
values ('d7100000-0000-4000-8000-000000000102','d7000000-0000-4000-8000-000000000002','Payment drift card',1000,10,20);
insert into public.accounts(id,user_id,name,opening_balance,statement_balance,balance_as_of)
values (
  'd7200000-0000-4000-8000-000000000202','d7000000-0000-4000-8000-000000000002',
  'Payment drift account',5000,5000,
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date-2
);
set role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000002',false);
select public.create_my_card_purchase_v1(
  'd7400000-0000-4000-8000-000000000402',
  'd7100000-0000-4000-8000-000000000102',
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
  'Valid purchase with retroactive payment',100,'realizado',null,null,null,null,null,null
);
select public.pay_my_card_invoice_v1(
  (select card_billing_cycle_id from public.transactions
    where operation_id='d7400000-0000-4000-8000-000000000402'),
  'd7200000-0000-4000-8000-000000000202',100,
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date-1,
  'd7500000-0000-4000-8000-000000000502'
);
reset role;
SQL
apply_file "$payment_drift_db" "$revocation"
assert_file_fails "$payment_drift_db" "$temporal" \
  'P0001: temporal hardening refuses persisted payment chronology drift' \
  'temporal-payment-chronology-drift'
assert_sql "$payment_drift_db" \
  "select concat_ws('|',(select count(*) from public.card_invoice_payments where operation_id='d7500000-0000-4000-8000-000000000502'),to_regprocedure('billing_private.guard_card_payment_temporal_v1()') is null,to_regprocedure('billing_private.pay_my_card_invoice_pre_temporal_v1(uuid,uuid,numeric,date,uuid)') is null,to_regprocedure('public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)') is not null,has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'),has_function_privilege('authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'))" \
  '1|t|t|t|f|t' \
  'payment-chronology drift failure is atomic and preserves dormant topology'

# Once any structured linkage exists, temporal rollback must lock the complete
# ledger surface, fail closed and preserve hardened topology/grants.
apply_file "$rollback_used_db" "$activation"
apply_file "$rollback_used_db" "$revocation"
apply_file "$rollback_used_db" "$temporal"
psql_db "$rollback_used_db" >/dev/null <<'SQL'
insert into auth.users(id,email)
values ('d7000000-0000-4000-8000-000000000003','rollback-used@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,access_kind)
values ('d7000000-0000-4000-8000-000000000003',true,false,'APP');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day)
values ('d7100000-0000-4000-8000-000000000103','d7000000-0000-4000-8000-000000000003','Rollback used card',1000,10,20);
grant execute on function public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)
  to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000003',false);
select public.create_my_card_purchase_v1(
  'd7400000-0000-4000-8000-000000000403',
  'd7100000-0000-4000-8000-000000000103',
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
  'Structured rollback guard row',100,'realizado',null,null,null,null,null,null
);
reset role;
revoke execute on function public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)
  from authenticated;
SQL
assert_file_fails "$rollback_used_db" "$temporal_rollback" \
  'P0001: refusing temporal hardening rollback after use; use application-first forward repair' \
  'temporal-rollback-after-use'
assert_sql "$rollback_used_db" \
  "select concat_ws('|',(select count(*) from public.transactions where operation_id='d7400000-0000-4000-8000-000000000403' and card_billing_cycle_id is not null),to_regprocedure('billing_private.guard_card_purchase_temporal_v1()') is not null,to_regprocedure('billing_private.create_my_card_purchase_pre_temporal_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)') is not null,to_regprocedure('public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)') is not null,has_function_privilege('authenticated','public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)','execute'),has_function_privilege('authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'))" \
  '1|t|t|t|f|t' \
  'failed temporal rollback preserves hardened topology, data and dormant grants'

# Static contract test covers remote-command/secret/Visual-freeze invariants.
node "$repo_root/tests/card-billing-mutator-activation.test.js"

echo "CARD_BILLING_MUTATOR_ACTIVATION_LOCAL=PASS"
echo "PGTAP_ASSERTIONS=${pgtap_assertions}"
echo "SHELL_ASSERTIONS=${assertions}"
echo "SAFE_NO_BACKFILL=PASS"
echo "BALANCE_AS_OF_UI_INTEGRATION=PASS"
echo "GOLDEN_ACCOUNTING_TEST=PASS"
