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
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-commercial-v1.XXXXXX")"

cleanup(){
  for database in "$normal_db" "$partial_db" "$drift_db"; do
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
apply_file "$normal_db" "$test_sql"

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

echo "commercial access v1 SQL: normal, RLS/trial/entitlements, partial rollback and drift refusal passed"
