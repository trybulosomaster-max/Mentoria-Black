#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
baseline="$repo_root/supabase/migrations/20260820161844_local_v81_structural_baseline.sql"
migration_one="$repo_root/supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql"
migration_two="$repo_root/supabase/migrations/20260820195658_structure_recurring_financial_operations_v82.sql"
rollback_sql="$repo_root/supabase/production/rollback_v82_writers.sql"
preflight_sql="$repo_root/supabase/production/preflight_v82.sql"
task_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-v82-prod-recovery.XXXXXX")"
suffix="${BASHPID:-$$}"
databases=(
  "mb_v82_recovery_normal_${suffix}"
  "mb_v82_recovery_partial_one_${suffix}"
  "mb_v82_recovery_partial_two_${suffix}"
  "mb_v82_recovery_compatible_${suffix}"
  "mb_v82_recovery_drift_${suffix}"
)
pgtap_assertions=0

cleanup() {
  for database in "${databases[@]}"; do
    if [[ "$database" == mb_v82_recovery_* ]]; then
      docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1 || true
    fi
  done
  rm -rf "$task_tmp_dir"
}
trap cleanup EXIT

if ! docker inspect "$db_container" >/dev/null 2>&1; then
  echo "local Supabase database container not found: $db_container" >&2
  exit 1
fi
container_project="$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')"
if [[ "$container_project" != "$project_id" ]]; then
  echo "refusing to run against an unexpected Docker project" >&2
  exit 1
fi

psql_db() {
  local database="$1"
  shift
  docker exec -i "$db_container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"
}

apply_file() {
  local database="$1" file="$2"
  psql_db "$database" < "$file" >/dev/null
}

assert_sql() {
  local database="$1" sql="$2" expected="$3" message="$4" actual
  actual="$(psql_db "$database" -Atqc "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    echo "$message: expected '$expected', got '$actual'" >&2
    exit 1
  fi
}

create_v81_database() {
  local database="$1"
  if [[ "$database" != mb_v82_recovery_* ]]; then
    echo "unsafe disposable database name" >&2
    exit 1
  fi
  docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create schema auth;
create schema extensions;
create table auth.users(id uuid primary key,email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated;
grant usage on schema extensions to anon,authenticated;
grant select on auth.users to authenticated;
SQL
  apply_file "$database" "$baseline"
}

inject_failure() {
  local source="$1" marker="$2" output="$3"
  awk -v marker="$marker" '{print; if(index($0,marker)){print "select 1/0;";found=1}} END{if(!found)exit 2}' "$source" > "$output"
}

run_pgtap() {
  local database="$1"
  local file="$2"
  local output="$task_tmp_dir/$(basename "$file").tap"
  psql_db "$database" < "$file" > "$output"
  if rg -n '^[[:space:]]*(not ok|# Looks like you failed)' "$output" >/dev/null; then
    echo "pgTAP failure in $(basename "$file")" >&2
    rg -n '^[[:space:]]*(not ok|# Looks like you failed)' "$output" >&2
    exit 1
  fi
  if ! rg -q '^[[:space:]]*ok [0-9]+' "$output"; then
    echo "pgTAP produced no successful assertions: $(basename "$file")" >&2
    exit 1
  fi
  pgtap_assertions=$((pgtap_assertions+$(rg -c '^[[:space:]]*ok [0-9]+' "$output")))
}

normal_db="${databases[0]}"
create_v81_database "$normal_db"
apply_file "$normal_db" "$preflight_sql"
apply_file "$normal_db" "$migration_one"
apply_file "$normal_db" "$migration_two"
apply_file "$normal_db" "$migration_one"
apply_file "$normal_db" "$migration_two"
assert_sql "$normal_db" "select count(*) from pg_proc where proname in ('create_transfer_v82','materialize_recurring_occurrences_v82')" "2" "normal/retry function state"

partial_one_db="${databases[1]}"
create_v81_database "$partial_one_db"
inject_failure "$migration_one" 'recovery-test-checkpoint: migration-1-mid' "$task_tmp_dir/migration-one-fails.sql"
if apply_file "$partial_one_db" "$task_tmp_dir/migration-one-fails.sql" 2>/dev/null; then
  echo "migration one failure injection unexpectedly succeeded" >&2
  exit 1
fi
assert_sql "$partial_one_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='accounts' and column_name='balance_as_of'" "0" "migration one atomic rollback"
apply_file "$partial_one_db" "$migration_one"
apply_file "$partial_one_db" "$migration_two"

partial_two_db="${databases[2]}"
create_v81_database "$partial_two_db"
apply_file "$partial_two_db" "$migration_one"
inject_failure "$migration_two" 'recovery-test-checkpoint: migration-2-mid' "$task_tmp_dir/migration-two-fails.sql"
if apply_file "$partial_two_db" "$task_tmp_dir/migration-two-fails.sql" 2>/dev/null; then
  echo "migration two failure injection unexpectedly succeeded" >&2
  exit 1
fi
assert_sql "$partial_two_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='recurring' and column_name='source_account_id'" "0" "migration two atomic rollback"
apply_file "$partial_two_db" "$migration_two"

compatible_db="${databases[3]}"
create_v81_database "$compatible_db"
psql_db "$compatible_db" -qc "alter table public.accounts add column balance_as_of date" >/dev/null
apply_file "$compatible_db" "$migration_one"
apply_file "$compatible_db" "$migration_two"

drift_db="${databases[4]}"
create_v81_database "$drift_db"
psql_db "$drift_db" -qc "alter table public.accounts add column balance_as_of text" >/dev/null
if apply_file "$drift_db" "$migration_one" 2>/dev/null; then
  echo "incompatible drift unexpectedly succeeded" >&2
  exit 1
fi
assert_sql "$drift_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='operation_id'" "0" "drift failure must roll back all V82 writes"

apply_file "$normal_db" "$rollback_sql"
assert_sql "$normal_db" "select has_function_privilege('authenticated','public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','execute')" "f" "writer rollback revoke"
assert_sql "$normal_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='operation_id'" "1" "writer rollback preserves schema"
apply_file "$normal_db" "$migration_one"
apply_file "$normal_db" "$migration_two"
assert_sql "$normal_db" "select has_function_privilege('authenticated','public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','execute')" "t" "retry restores reviewed grant"

run_pgtap "$normal_db" "$repo_root/supabase/tests/v82_financial_integrity_test.sql"
run_pgtap "$normal_db" "$repo_root/supabase/tests/v82_recurring_operations_test.sql"

echo "v82 production migration recovery: 9 scenarios and ${pgtap_assertions} pgTAP assertions passed"
