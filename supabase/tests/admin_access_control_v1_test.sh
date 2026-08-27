#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
commercial_migration="$repo_root/supabase/migrations/20260822212119_commercial_access_v1.sql"
admin_migration="$repo_root/supabase/migrations/20260826163317_admin_access_control_v1.sql"
admin_tests="$repo_root/supabase/tests/admin_access_control_v1_test.sql"
suffix="${BASHPID:-$$}"
database="aviora_admin_v1_${suffix}"

cleanup() {
  case "$database" in
    aviora_admin_v1_*)
      docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1 || true
      ;;
  esac
}
trap cleanup EXIT

docker inspect "$db_container" >/dev/null
[[ "$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" == "$project_id" ]]

psql_db() {
  docker exec -i "$db_container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"
}

psql_admin_db() {
  # supabase_admin is the local superuser provided inside the disposable
  # Supabase DB container. Use it only for the pgTAP transaction that opens
  # trusted local dblink sessions; no password or remote secret is embedded.
  docker exec -i "$db_container" psql -U supabase_admin -d "$database" -X -v ON_ERROR_STOP=1 "$@"
}

docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null
docker exec "$db_container" createdb -U postgres -T template0 "$database"

psql_db >/dev/null <<'SQL'
create schema auth;
create extension if not exists pgcrypto;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  last_sign_in_at timestamptz
);
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;

do $tables$
declare v_table text;
begin
  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    execute format(
      'create table public.%I('
      'id uuid primary key default gen_random_uuid(),'
      'user_id uuid not null references auth.users(id),'
      'name text)',
      v_table
    );
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'create policy mb_v82_own_rows on public.%I '
      'for all to authenticated '
      'using ((select auth.uid()) = user_id) '
      'with check ((select auth.uid()) = user_id)',
      v_table
    );
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      v_table
    );
  end loop;
end
$tables$;
SQL

psql_db < "$commercial_migration" >/dev/null
psql_db < "$admin_migration" >/dev/null
test_output="$(psql_admin_db < "$admin_tests")"

if rg -n '^[[:space:]]*(not ok|# Looks like you failed)' <<<"$test_output" >/dev/null; then
  printf '%s\n' "$test_output" >&2
  exit 1
fi
if ! rg -q '^[[:space:]]*ok [0-9]+' <<<"$test_output"; then
  printf '%s\n' "$test_output" >&2
  echo "admin pgTAP produced no successful assertions" >&2
  exit 1
fi

assertions="$(rg -c '^[[:space:]]*ok [0-9]+' <<<"$test_output")"
echo "AVIORA admin access control: ${assertions} pgTAP assertions passed in an isolated local database"
