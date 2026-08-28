#!/usr/bin/env bash
set -euo pipefail

# Local-only disposable validation. No URL, token, linked project or remote
# command is accepted by this harness.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container='supabase_db_Mentoria-Black'
database="mb_card_temporal_v1_${BASHPID:-$$}"
purchase_drift_database="mb_card_temporal_purchase_drift_v1_${BASHPID:-$$}"
payment_drift_database="mb_card_temporal_payment_drift_v1_${BASHPID:-$$}"
used_rollback_database="mb_card_temporal_used_rollback_v1_${BASHPID:-$$}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/aviora-card-temporal-v1.XXXXXX")"

cleanup(){
  local exit_code=$?
  for disposable_database in "$database" "$purchase_drift_database" "$payment_drift_database" "$used_rollback_database"; do
    case "$disposable_database" in
      mb_card_temporal_v1_*|mb_card_temporal_purchase_drift_v1_*|mb_card_temporal_payment_drift_v1_*|mb_card_temporal_used_rollback_v1_*)
        docker exec "$container" dropdb -U postgres --if-exists --force "$disposable_database" >/dev/null 2>&1 || true
        ;;
    esac
  done
  case "$tmp_dir" in
    "${TMPDIR:-/tmp}"/aviora-card-temporal-v1.*) rm -rf "$tmp_dir" ;;
  esac
  exit "$exit_code"
}
trap cleanup EXIT

docker inspect "$container" >/dev/null 2>&1 || {
  echo "local Supabase database container not found: $container" >&2
  exit 1
}
[[ "$(docker inspect "$container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" == 'Mentoria-Black' ]] || {
  echo 'refusing database container from another local project' >&2
  exit 1
}

psql_db(){
  docker exec -i "$container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"
}
apply_file(){ psql_db < "$1" >/dev/null; }
psql_named(){
  local target_database="$1"
  shift
  docker exec -i "$container" psql -U postgres -d "$target_database" -X -v ON_ERROR_STOP=1 "$@"
}
assert_migration_fails(){
  local target_database="$1" pattern="$2" label="$3"
  local output="$tmp_dir/${label}.err"
  if psql_named "$target_database" < "$repo_root/supabase/migrations/20260828183342_harden_card_billing_temporal_contracts_v1.sql" >"$output" 2>&1; then
    echo "$label unexpectedly succeeded" >&2
    exit 1
  fi
  rg -q "$pattern" "$output" || {
    echo "$label did not fail with the expected drift guard" >&2
    sed -n '1,220p' "$output" >&2
    exit 1
  }
}

docker exec "$container" createdb -U postgres -T template0 "$database"
psql_db >/dev/null <<'SQL'
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid()
returns uuid language sql stable set search_path=pg_catalog
as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
SQL

apply_file "$repo_root/supabase/migrations/20260820161844_local_v81_structural_baseline.sql"
apply_file "$repo_root/supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql"
psql_db >/dev/null <<'SQL'
create table public.synthetic_access(
  user_id uuid primary key references auth.users(id),
  app boolean,
  knowledge boolean,
  access_kind text
);
alter table public.synthetic_access enable row level security;
create policy synthetic_access_read_own
  on public.synthetic_access for select to authenticated
  using ((select auth.uid())=user_id);
grant select on public.synthetic_access to authenticated;
create function public.has_active_access(p_product_slug text default 'mentoria-black')
returns boolean language sql stable security invoker set search_path=pg_catalog
as $$
  select case upper(trim(p_product_slug))
    when 'APP' then (select a.app from public.synthetic_access a where a.user_id=auth.uid())
    when 'KNOWLEDGE' then (select a.knowledge from public.synthetic_access a where a.user_id=auth.uid())
    else false
  end
$$;
revoke all on function public.has_active_access(text) from public,anon,authenticated;
grant execute on function public.has_active_access(text) to authenticated;
SQL

apply_file "$repo_root/supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql"
apply_file "$repo_root/supabase/migrations/20260828173831_aviora_card_billing_mutator_activation_v1.sql"
apply_file "$repo_root/supabase/migrations/20260828182643_revoke_card_billing_mutators_pending_review.sql"
apply_file "$repo_root/supabase/migrations/20260828183342_harden_card_billing_temporal_contracts_v1.sql"

tap_output="$tmp_dir/temporal.tap"
if ! psql_db < "$repo_root/supabase/tests/card_billing_temporal_hardening_v1_test.sql" >"$tap_output" 2>&1; then
  sed -n '1,300p' "$tap_output" >&2
  exit 1
fi
if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' "$tap_output"; then
  rg -n '^[[:space:]]*(not ok|# Looks like you failed)' "$tap_output" >&2
  tail -180 "$tap_output" >&2
  exit 1
fi
assertions="$(rg -c '^[[:space:]]*ok [0-9]+' "$tap_output")"
[[ "$assertions" -ge 15 ]] || {
  echo "expected at least 15 temporal assertions, got $assertions" >&2
  exit 1
}

# A used installation must reject rollback atomically and keep the hardened
# topology plus dormant grants intact.
docker exec "$container" createdb -U postgres -T "$database" "$used_rollback_database"
psql_named "$used_rollback_database" >/dev/null <<'SQL'
insert into auth.users(id,email) values
  ('e4000000-0000-4000-8000-000000000001','used-rollback@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,access_kind) values
  ('e4000000-0000-4000-8000-000000000001',true,false,'APP');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day) values
  ('e4100000-0000-4000-8000-000000000101','e4000000-0000-4000-8000-000000000001','Used rollback',1000,10,20);
select set_config('request.jwt.claim.sub','e4000000-0000-4000-8000-000000000001',false);
select public.create_my_card_purchase_v1(
  'e4400000-0000-4000-8000-000000000401',
  'e4100000-0000-4000-8000-000000000101',
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
  'Durable structured row',100,'realizado',null,null,null,null,null,null
);
SQL
rollback_error="$tmp_dir/used_rollback.err"
if psql_named "$used_rollback_database" < "$repo_root/supabase/rollback/rollback_20260828183342_harden_card_billing_temporal_contracts_v1.sql" >"$rollback_error" 2>&1; then
  echo 'used rollback unexpectedly succeeded' >&2
  exit 1
fi
rg -q 'refusing temporal hardening rollback after use' "$rollback_error" || {
  sed -n '1,220p' "$rollback_error" >&2
  exit 1
}
used_topology="$(psql_named "$used_rollback_database" -Atqc "select concat_ws('|',to_regprocedure('billing_private.guard_card_purchase_temporal_v1()') is not null,to_regprocedure('billing_private.guard_card_payment_temporal_v1()') is not null,to_regprocedure('billing_private.pay_my_card_invoice_pre_temporal_v1(uuid,uuid,numeric,date,uuid)') is not null,to_regprocedure('public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)') is not null,has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'))")"
[[ "$used_topology" == 't|t|t|t|f' ]] || {
  echo "failed used rollback changed topology or grants: $used_topology" >&2
  exit 1
}

# Empty/dormant rollback is supported and must not reactivate a writer.
apply_file "$repo_root/supabase/rollback/rollback_20260828183342_harden_card_billing_temporal_contracts_v1.sql"
result="$(psql_db -Atqc "select concat_ws('|',to_regprocedure('billing_private.guard_card_purchase_temporal_v1()') is null,has_function_privilege('authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'),to_regprocedure('public.get_my_card_billing_summary_as_of_v1(uuid,date)') is not null)")"
[[ "$result" == 't|f|t' ]] || {
  echo "rollback contract mismatch: $result" >&2
  exit 1
}

# Clone the empty post-rollback state to prove both persisted-drift preflight
# guards fail before any topology change.
docker exec "$container" createdb -U postgres -T "$database" "$purchase_drift_database"
psql_named "$purchase_drift_database" >/dev/null <<'SQL'
insert into auth.users(id,email) values
  ('e2000000-0000-4000-8000-000000000001','purchase-drift@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,access_kind) values
  ('e2000000-0000-4000-8000-000000000001',true,false,'APP');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day) values
  ('e2100000-0000-4000-8000-000000000101','e2000000-0000-4000-8000-000000000001','Purchase drift',1000,10,20);
select set_config('request.jwt.claim.sub','e2000000-0000-4000-8000-000000000001',false);
select public.create_my_card_purchase_v1(
  'e2400000-0000-4000-8000-000000000401',
  'e2100000-0000-4000-8000-000000000101',
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date+1,
  'Persisted future realized',100,'realizado',null,null,null,null,null,null
);
SQL
assert_migration_fails "$purchase_drift_database" \
  'refuses persisted realized purchase chronology drift' \
  'purchase_drift_preflight'

docker exec "$container" createdb -U postgres -T "$database" "$payment_drift_database"
psql_named "$payment_drift_database" >/dev/null <<'SQL'
insert into auth.users(id,email) values
  ('e3000000-0000-4000-8000-000000000001','payment-drift@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,access_kind) values
  ('e3000000-0000-4000-8000-000000000001',true,false,'APP');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day) values
  ('e3100000-0000-4000-8000-000000000101','e3000000-0000-4000-8000-000000000001','Payment drift',1000,10,20);
insert into public.accounts(id,user_id,name,opening_balance,statement_balance,balance_as_of) values
  ('e3200000-0000-4000-8000-000000000201','e3000000-0000-4000-8000-000000000001','Payment drift account',5000,5000,
   (statement_timestamp() at time zone 'America/Sao_Paulo')::date-2);
select set_config('request.jwt.claim.sub','e3000000-0000-4000-8000-000000000001',false);
select public.create_my_card_purchase_v1(
  'e3400000-0000-4000-8000-000000000401',
  'e3100000-0000-4000-8000-000000000101',
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
  'Persisted payment chronology',100,'realizado',null,null,null,null,null,null
);
select public.pay_my_card_invoice_v1(
  (select card_billing_cycle_id from public.transactions
   where operation_id='e3400000-0000-4000-8000-000000000401'),
  'e3200000-0000-4000-8000-000000000201',100,
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date-1,
  'e3500000-0000-4000-8000-000000000501'
);
SQL
assert_migration_fails "$payment_drift_database" \
  'refuses persisted payment chronology drift' \
  'payment_drift_preflight'

echo 'CARD_BILLING_TEMPORAL_HARDENING_LOCAL=PASS'
echo "PGTAP_ASSERTIONS=$assertions"
echo 'MUTATORS_DORMANT=PASS'
echo 'AS_OF_PURCHASE_DATE=PASS'
echo 'PAYMENT_PURCHASE_CHRONOLOGY=PASS'
echo 'PERSISTED_TEMPORAL_DRIFT_PREFLIGHT=PASS'
echo 'USED_ROLLBACK_FAIL_CLOSED=PASS'
