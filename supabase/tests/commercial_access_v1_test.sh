#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260822212119_commercial_access_v1.sql"
test_sql="$repo_root/supabase/tests/commercial_access_v1_test.sql"
suffix="${BASHPID:-$$}"
normal_db="mb_commercial_v1_normal_${suffix}"
partial_db="mb_commercial_v1_partial_${suffix}"
drift_db="mb_commercial_v1_drift_${suffix}"
concurrent_db="mb_commercial_v1_concurrent_${suffix}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-commercial-v1.XXXXXX")"

cleanup(){
  for database in "$normal_db" "$partial_db" "$drift_db" "$concurrent_db"; do
    case "$database" in mb_commercial_v1_*) docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1 || true;; esac
  done
  case "$tmp_dir" in "${TMPDIR:-/tmp}"/mb-commercial-v1.*) rm -rf "$tmp_dir";; esac
}
trap cleanup EXIT

docker inspect "$db_container" >/dev/null
[[ "$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" == "$project_id" ]]

psql_db(){ docker exec -i "$db_container" psql -U postgres -d "$1" -X -v ON_ERROR_STOP=1 "${@:2}"; }
apply_file(){ psql_db "$1" < "$2" >/dev/null; }
assert_sql(){
  local actual
  actual="$(psql_db "$1" -Atqc "$2")"
  [[ "$actual" == "$3" ]] || { echo "$4: expected '$3', got '$actual'" >&2; exit 1; }
}

create_base(){
  local database="$1"
  docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated;

do $tables$
declare v_table text;
begin
  foreach v_table in array array['accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans'] loop
    execute format('create table public.%I(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),name text)',v_table);
    execute format('alter table public.%I enable row level security',v_table);
    execute format('create policy mb_v82_own_rows on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',v_table);
    execute format('grant select,insert,update,delete on public.%I to authenticated',v_table);
  end loop;
end
$tables$;
SQL
}

create_base "$normal_db"
apply_file "$normal_db" "$migration"
test_output="$(psql_db "$normal_db" < "$test_sql")"
if rg -q 'not ok [0-9]+' <<<"$test_output"; then
  echo "$test_output" >&2
  exit 1
fi
test_assertions="$(rg -c 'ok [0-9]+ -' <<<"$test_output")"

create_base "$partial_db"
awk '{print; if(index($0,"create table public.access_grants")){armed=1} else if(armed&&/^\);$/){print "select 1/0;";armed=0}}' "$migration" > "$tmp_dir/partial.sql"
if apply_file "$partial_db" "$tmp_dir/partial.sql" 2>/dev/null; then
  echo "partial migration injection unexpectedly succeeded" >&2; exit 1
fi
assert_sql "$partial_db" "select count(*) from information_schema.tables where table_schema='public' and table_name in ('products','access_grants','payment_events')" "0" "transactional rollback"
apply_file "$partial_db" "$migration"

create_base "$drift_db"
psql_db "$drift_db" -qc "create table public.products(id uuid primary key)" >/dev/null
if apply_file "$drift_db" "$migration" 2>"$tmp_dir/drift.err"; then
  echo "existing incompatible object unexpectedly accepted" >&2; exit 1
fi
rg -q 'reconcile it explicitly' "$tmp_dir/drift.err"
assert_sql "$drift_db" "select count(*) from information_schema.tables where table_schema='public' and table_name='access_grants'" "0" "drift failure leaves no partial schema"

create_base "$concurrent_db"
apply_file "$concurrent_db" "$migration"
psql_db "$concurrent_db" -qc "insert into auth.users(id,email,email_confirmed_at) values ('f0000000-0000-4000-8000-000000000006','race@example.invalid',now())" >/dev/null
for run in 1 2; do
  psql_db "$concurrent_db" -qc "begin; set local role authenticated; set local request.jwt.claim.sub='f0000000-0000-4000-8000-000000000006'; select * from public.start_my_app_trial(); commit" >"$tmp_dir/race-${run}.out" &
done
wait
assert_sql "$concurrent_db" "select count(*) from public.product_trials where user_id='f0000000-0000-4000-8000-000000000006'" "1" "concurrent start creates one trial"
assert_sql "$concurrent_db" "select count(*) from public.access_grants where user_id='f0000000-0000-4000-8000-000000000006' and access_type='trial'" "1" "concurrent start creates one grant"
psql_db "$concurrent_db" >/dev/null <<'SQL'
insert into auth.users(id,email,email_confirmed_at) values ('f0000000-0000-4000-8000-000000000007','event-race@example.invalid',now());
insert into public.billing_orders(id,user_id,offer_id,provider,environment,status,external_payment_id,paid_through)
select 'f1000000-0000-4000-8000-000000000007','f0000000-0000-4000-8000-000000000007',id,'asaas','sandbox','pending','pay-event-race',clock_timestamp()+interval '30 days'
from public.commercial_offers where code='APP_MONTHLY';
insert into public.payment_events(id,provider,environment,external_event_id,event_type,payload_hash,external_payment_id)
values ('f2000000-0000-4000-8000-000000000007','asaas','sandbox','evt-event-race','PAYMENT_CONFIRMED',repeat('7',64),'pay-event-race');
SQL
for run in 1 2; do
  psql_db "$concurrent_db" -Atqc "select public.process_payment_event_v1('f2000000-0000-4000-8000-000000000007')" >"$tmp_dir/event-race-${run}.out" &
done
wait
assert_sql "$concurrent_db" "select count(*) from public.billing_order_grants where order_id='f1000000-0000-4000-8000-000000000007'" "1" "concurrent event processing creates one linked grant"
assert_sql "$concurrent_db" "select processing_attempts from public.payment_events where id='f2000000-0000-4000-8000-000000000007'" "1" "event replay observes processed state without a second mutation"

echo "commercial access v2 SQL: ${test_assertions} pgTAP assertions; normal, RLS/trial/admin/events, trial/event concurrency, partial rollback and drift refusal passed"
