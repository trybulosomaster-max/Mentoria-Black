#!/usr/bin/env bash
set -euo pipefail

# Local-only disposable validation for the reviewed writer reactivation. This
# harness never accepts a URL, token, linked project or remote command.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
v81="$repo_root/supabase/migrations/20260820161844_local_v81_structural_baseline.sql"
v82="$repo_root/supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql"
shadow="$repo_root/supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql"
activation="$repo_root/supabase/migrations/20260828173831_aviora_card_billing_mutator_activation_v1.sql"
revocation="$repo_root/supabase/migrations/20260828182643_revoke_card_billing_mutators_pending_review.sql"
temporal="$repo_root/supabase/migrations/20260828183342_harden_card_billing_temporal_contracts_v1.sql"
reactivation="$repo_root/supabase/migrations/20260828190138_reactivate_card_billing_mutators_v1.sql"
reactivation_rollback="$repo_root/supabase/rollback/rollback_20260828190138_reactivate_card_billing_mutators_v1.sql"
pgtap_suite="$repo_root/supabase/tests/card_billing_mutator_reactivation_v1_test.sql"
static_suite="$repo_root/tests/card-billing-mutator-reactivation.test.js"
project_id='Mentoria-Black'
db_container="supabase_db_${project_id}"
task_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/aviora-card-reactivation-v1.XXXXXX")"
suffix="${BASHPID:-$$}"
normal_db="mb_card_reactivation_v1_normal_${suffix}"
empty_db="mb_card_reactivation_v1_empty_${suffix}"
private_drift_db="mb_card_reactivation_v1_private_drift_${suffix}"
trigger_disabled_db="mb_card_reactivation_v1_trigger_disabled_${suffix}"
trigger_misattached_db="mb_card_reactivation_v1_trigger_misattached_${suffix}"
trigger_event_db="mb_card_reactivation_v1_trigger_event_${suffix}"
rogue_grant_db="mb_card_reactivation_v1_rogue_grant_${suffix}"
rollback_rogue_db="mb_card_reactivation_v1_rollback_rogue_${suffix}"
shell_assertions=0

for command_name in docker rg node; do
  command -v "$command_name" >/dev/null || {
    echo "required local command not found: $command_name" >&2
    exit 1
  }
done
for file in "$v81" "$v82" "$shadow" "$activation" "$revocation" "$temporal" \
  "$reactivation" "$reactivation_rollback" "$pgtap_suite" "$static_suite"; do
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
  local exit_code=$?
  for database in "$normal_db" "$empty_db" "$private_drift_db" \
    "$trigger_disabled_db" "$trigger_misattached_db" "$trigger_event_db" \
    "$rogue_grant_db" "$rollback_rogue_db"; do
    case "$database" in
      mb_card_reactivation_v1_*)
        docker exec "$db_container" dropdb -U postgres --if-exists --force "$database" >/dev/null 2>&1 || true
        ;;
    esac
  done
  case "$task_tmp_dir" in
    "${TMPDIR:-/tmp}"/aviora-card-reactivation-v1.*) rm -rf "$task_tmp_dir" ;;
  esac
  exit "$exit_code"
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
  shell_assertions=$((shell_assertions+1))
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
    sed -n '1,220p' "$output" >&2
    exit 1
  fi
  shell_assertions=$((shell_assertions+1))
}

create_shadow_clone(){
  local database="$1"
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid()
returns uuid language sql stable set search_path=pg_catalog
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

apply_full_sequence(){
  local database="$1"
  apply_file "$database" "$activation"
  apply_file "$database" "$revocation"
  apply_file "$database" "$temporal"
  apply_file "$database" "$reactivation"
}
apply_dormant_sequence(){
  local database="$1"
  apply_file "$database" "$activation"
  apply_file "$database" "$revocation"
  apply_file "$database" "$temporal"
}

acl_query="with expected(signature,ui) as (values
 ('public.structure_my_card_purchase_v1(uuid)',false),
 ('public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)',false),
 ('public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)',true),
 ('public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',true),
 ('public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',true),
 ('public.reverse_my_card_payment_v1(uuid,uuid,date,text)',true),
 ('public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)',true),
 ('public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)',true)
) select concat_ws('|',
 count(*) filter(where ui and has_function_privilege('authenticated',signature,'execute')),
 count(*) filter(where not ui and has_function_privilege('authenticated',signature,'execute')),
 count(*) filter(where has_function_privilege('anon',signature,'execute')),
 count(*) filter(where has_function_privilege('service_role',signature,'execute')),
 (select count(*) from expected e join pg_proc p on p.oid=to_regprocedure(e.signature)
   cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   where a.grantee=0 and a.privilege_type='EXECUTE')) from expected"

create_shadow_clone "$normal_db"
create_shadow_clone "$empty_db"
create_shadow_clone "$private_drift_db"
create_shadow_clone "$trigger_disabled_db"
create_shadow_clone "$trigger_misattached_db"
create_shadow_clone "$trigger_event_db"
create_shadow_clone "$rogue_grant_db"
create_shadow_clone "$rollback_rogue_db"
apply_full_sequence "$normal_db"
apply_full_sequence "$empty_db"

assert_sql "$normal_db" "$acl_query" '6|0|0|0|0' \
  'reactivation exposes six UI writers and keeps two low-level writers dormant'
assert_sql "$normal_db" \
  "select concat_ws('|',has_function_privilege('authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'),has_schema_privilege('authenticated','billing_private','usage'),(select count(*) from pg_trigger where not tgisinternal and tgenabled='O' and tgname=any(array['card_billing_cycles_calendar_guard_v1','card_billing_cycles_immutable_v1','card_installment_series_immutable_v1','transactions_guard_card_cycle_v1','transactions_guard_linked_card_delete_v1','card_invoice_payments_guard_insert_v1','card_payment_allocations_guard_insert_v1','card_account_settlements_guard_insert_v1','card_purchase_credits_guard_insert_v1','card_invoice_payments_append_only_v1','card_payment_allocations_append_only_v1','card_account_settlements_append_only_v1','card_purchase_credits_append_only_v1','transactions_guard_card_purchase_temporal_v1','card_invoice_payments_guard_temporal_v1'])))" \
  't|f|15' \
  'reader, private schema and temporal guard topology survive reactivation'

tap_output="$task_tmp_dir/reactivation.tap"
if ! psql_db "$normal_db" < "$pgtap_suite" >"$tap_output" 2>&1; then
  echo 'reactivation pgTAP execution failed before completion' >&2
  sed -n '1,320p' "$tap_output" >&2
  echo '--- pgTAP tail ---' >&2
  tail -220 "$tap_output" >&2
  exit 1
fi
if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' "$tap_output"; then
  rg -n '^[[:space:]]*(not ok|# Looks like you failed)' "$tap_output" >&2
  tail -240 "$tap_output" >&2
  exit 1
fi
pgtap_assertions="$(rg -c '^[[:space:]]*ok [0-9]+' "$tap_output")"
[[ "$pgtap_assertions" -ge 25 ]] || {
  echo "expected at least 25 reactivation assertions, got $pgtap_assertions" >&2
  exit 1
}

assert_sql "$normal_db" "$acl_query" '6|0|0|0|0' \
  'pgTAP rollback preserves exact reactivation ACL'
assert_file_fails "$normal_db" "$reactivation" \
  'requires a dormant reviewed wrapper' \
  'reactivation-rerun-fails-closed'
assert_sql "$normal_db" "$acl_query" '6|0|0|0|0' \
  'failed duplicate reactivation is atomic'

# Operational rollback is ACL-only: persistent structured history survives
# while every client writer returns to the dormant state.
psql_db "$normal_db" >/dev/null <<'SQL'
insert into auth.users(id,email)
values ('f9000000-0000-4000-8000-000000000001','reactivation-persisted@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,expires_at,access_kind)
values ('f9000000-0000-4000-8000-000000000001',true,false,null,'APP');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day)
values ('f9100000-0000-4000-8000-000000000101','f9000000-0000-4000-8000-000000000001','Persisted card',1000,10,20);
set role authenticated;
select set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000001',false);
select public.create_my_card_purchase_v1(
  'f9400000-0000-4000-8000-000000000401',
  'f9100000-0000-4000-8000-000000000101',
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
  'Persisted structured purchase',100,'realizado',null,null,null,null,null,null
);
reset role;
SQL
apply_file "$normal_db" "$reactivation_rollback"
assert_sql "$normal_db" "$acl_query" '0|0|0|0|0' \
  'reactivation rollback returns all eight writers to dormant ACL'
assert_sql "$normal_db" \
  "select concat_ws('|',(select count(*) from public.transactions where operation_id='f9400000-0000-4000-8000-000000000401' and card_billing_cycle_id is not null),has_function_privilege('authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'),to_regprocedure('billing_private.guard_card_purchase_temporal_v1()') is not null)" \
  '1|t|t' \
  'ACL rollback preserves structured data, readers and temporal topology'

# An empty installation can be disabled, reactivated once, and disabled again
# without changing any object topology or exposing the two low-level writers.
apply_file "$empty_db" "$reactivation_rollback"
assert_sql "$empty_db" "$acl_query" '0|0|0|0|0' \
  'empty rollback makes every writer dormant'
apply_file "$empty_db" "$reactivation"
assert_sql "$empty_db" "$acl_query" '6|0|0|0|0' \
  'empty rollback permits one clean reviewed reactivation'
apply_file "$empty_db" "$reactivation_rollback"
assert_sql "$empty_db" "$acl_query" '0|0|0|0|0' \
  'second operational revoke returns the empty clone to dormant'

# Each security preflight branch gets an independent disposable clone. A
# failure must precede every ACL transition and leave the injected drift plus
# the dormant public surface untouched for diagnosis.
apply_dormant_sequence "$private_drift_db"
psql_db "$private_drift_db" >/dev/null <<'SQL'
create or replace function billing_private.clamped_month_day_v1(
  p_month date,
  p_day integer
)
returns date
language sql
immutable
strict
set search_path=pg_catalog
as $$select p_month$$;
SQL
assert_file_fails "$private_drift_db" "$reactivation" \
  'refuses private implementation drift' \
  'reactivation-private-body-drift'
assert_sql "$private_drift_db" \
  "select concat_ws('|',md5(pg_get_functiondef('billing_private.clamped_month_day_v1(date,integer)'::regprocedure))<>'ac4b732d72acda32cfcfbfe22943fda2',has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'))" \
  't|f' \
  'private-body drift refusal is atomic and leaves writers dormant'

apply_dormant_sequence "$trigger_disabled_db"
psql_db "$trigger_disabled_db" -qc \
  'alter table public.transactions disable trigger transactions_guard_card_purchase_temporal_v1' >/dev/null
assert_file_fails "$trigger_disabled_db" "$reactivation" \
  'requires every billing guard enabled' \
  'reactivation-disabled-trigger-drift'
assert_sql "$trigger_disabled_db" \
  "select concat_ws('|',(select tgenabled from pg_trigger where tgrelid='public.transactions'::regclass and tgname='transactions_guard_card_purchase_temporal_v1'),has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'))" \
  'D|f' \
  'disabled-trigger refusal is atomic and leaves writers dormant'

apply_dormant_sequence "$trigger_misattached_db"
psql_db "$trigger_misattached_db" >/dev/null <<'SQL'
drop trigger transactions_guard_card_purchase_temporal_v1 on public.transactions;
create trigger transactions_guard_card_purchase_temporal_v1
before insert or update on public.card_billing_cycles
for each row execute function billing_private.guard_card_purchase_temporal_v1();
SQL
assert_file_fails "$trigger_misattached_db" "$reactivation" \
  'requires every billing guard enabled' \
  'reactivation-misattached-trigger-drift'
assert_sql "$trigger_misattached_db" \
  "select concat_ws('|',(select tgrelid='public.card_billing_cycles'::regclass from pg_trigger where tgname='transactions_guard_card_purchase_temporal_v1' and not tgisinternal),has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'))" \
  't|f' \
  'misattached-trigger refusal binds the guard to its exact relation'

# Name, relation, function and enabled state alone are insufficient: retain all
# four while weakening both timing and event coverage, then require the trigger
# definition fingerprint to reject the drift.
apply_dormant_sequence "$trigger_event_db"
psql_db "$trigger_event_db" >/dev/null <<'SQL'
drop trigger transactions_guard_card_purchase_temporal_v1 on public.transactions;
create trigger transactions_guard_card_purchase_temporal_v1
after insert on public.transactions
for each row execute function billing_private.guard_card_purchase_temporal_v1();
SQL
assert_file_fails "$trigger_event_db" "$reactivation" \
  'requires every billing guard enabled' \
  'reactivation-trigger-event-timing-drift'
assert_sql "$trigger_event_db" \
  "select concat_ws('|',(select tgrelid='public.transactions'::regclass and tgfoid='billing_private.guard_card_purchase_temporal_v1()'::regprocedure and tgenabled='O' and md5(pg_get_triggerdef(oid,true))<>'f39e57b663b50bc5dc349b8ee5d8aead' from pg_trigger where tgname='transactions_guard_card_purchase_temporal_v1' and not tgisinternal),has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'))" \
  't|f' \
  'trigger-definition drift is rejected despite matching name relation function and enabled state'

apply_dormant_sequence "$rogue_grant_db"
psql_db "$rogue_grant_db" -qc \
  'grant execute on function public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid) to dashboard_user' >/dev/null
assert_file_fails "$rogue_grant_db" "$reactivation" \
  'requires a dormant reviewed wrapper' \
  'reactivation-rogue-role-grant-drift'
assert_sql "$rogue_grant_db" \
  "select concat_ws('|',has_function_privilege('dashboard_user','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'),has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'))" \
  't|f' \
  'rogue-role grant refusal is atomic and does not activate authenticated'

# The operational rollback is fail-closed too: an unknown direct grant cannot
# survive unnoticed, and the failed transaction cannot partially revoke the
# previously approved authenticated ACL.
apply_full_sequence "$rollback_rogue_db"
psql_db "$rollback_rogue_db" -qc \
  'grant execute on function public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text) to dashboard_user' >/dev/null
assert_file_fails "$rollback_rogue_db" "$reactivation_rollback" \
  'revoke rollback postcondition failed' \
  'reactivation-rollback-rogue-role-grant'
assert_sql "$rollback_rogue_db" \
  "select concat_ws('|',has_function_privilege('dashboard_user','public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)','execute'),has_function_privilege('authenticated','public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)','execute'))" \
  't|t' \
  'failed rollback is atomic when an arbitrary role owns a direct grant'

node "$static_suite"

echo 'CARD_BILLING_MUTATOR_REACTIVATION_LOCAL=PASS'
echo "PGTAP_ASSERTIONS=${pgtap_assertions}"
echo "SHELL_ASSERTIONS=${shell_assertions}"
echo 'AUTHENTICATED_UI_WRITERS=6'
echo 'LOW_LEVEL_WRITERS_DORMANT=2'
echo 'PUBLIC_ANON_SERVICE_ROLE_DENIED=PASS'
echo 'APP_ACCESS_AND_IDOR=PASS'
echo 'ROLLBACK_TO_DORMANT=PASS'
echo 'PRIVATE_BODY_DRIFT_PREFLIGHT=PASS'
echo 'TRIGGER_BINDING_AND_ENABLED_PREFLIGHT=PASS'
echo 'TRIGGER_EVENT_TIMING_FINGERPRINT_PREFLIGHT=PASS'
echo 'ARBITRARY_ROLE_ACL_PREFLIGHT=PASS'
echo 'ROLLBACK_ARBITRARY_ROLE_FAIL_CLOSED=PASS'
