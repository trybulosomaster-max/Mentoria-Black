#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
baseline="$repo_root/supabase/migrations/20260820161844_local_v81_structural_baseline.sql"
migration_one="$repo_root/supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql"
migration_two="$repo_root/supabase/migrations/20260820195658_structure_recurring_financial_operations_v82.sql"
migration_three="$repo_root/supabase/migrations/20260821205630_reconcile_v82_production_access_contract.sql"
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
  "mb_v82_recovery_partial_three_${suffix}"
  "mb_v82_recovery_access_compatible_${suffix}"
  "mb_v82_recovery_access_drift_${suffix}"
  "mb_v82_recovery_policy_drift_${suffix}"
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
create schema supabase_migrations;
create table auth.users(id uuid primary key,email text);
create table supabase_migrations.schema_migrations(
  version text primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations(version,name)
values ('20260820000000','v81_production_checkpoint');
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon,authenticated;
grant usage on schema extensions to anon,authenticated;
grant select on auth.users to authenticated;
SQL
  apply_file "$database" "$baseline"
  psql_db "$database" >/dev/null <<'SQL'
create table public.categories(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'expense' check (kind in ('receita','despesa','income','expense')),
  created_at timestamptz not null default now()
);
create table public.monthly_plans(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null,
  revenue numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
alter table public.monthly_plans enable row level security;
create policy categories_own_rows on public.categories for all to authenticated
  using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy monthly_plans_own_rows on public.monthly_plans for all to authenticated
  using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy monthly_plans_own_rows_duplicate on public.monthly_plans for all to public
  using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy transactions_own_rows_duplicate on public.transactions for all to public
  using (auth.uid()=user_id) with check (auth.uid()=user_id);
grant all privileges on table public.accounts,public.cards,public.categories,public.goals,
  public.assets,public.liabilities,public.recurring,public.transactions,public.monthly_plans
  to anon,authenticated;
SQL
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
apply_file "$normal_db" "$migration_three"
psql_db "$normal_db" -qc "insert into supabase_migrations.schema_migrations(version,name) values ('20260820161846','add_v82_structured_financial_operations'),('20260820195658','structure_recurring_financial_operations_v82'),('20260821205630','reconcile_v82_production_access_contract')" >/dev/null
apply_file "$normal_db" "$preflight_sql"
apply_file "$normal_db" "$migration_one"
apply_file "$normal_db" "$migration_two"
apply_file "$normal_db" "$migration_three"
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

partial_three_db="${databases[5]}"
create_v81_database "$partial_three_db"
apply_file "$partial_three_db" "$migration_one"
apply_file "$partial_three_db" "$migration_two"
inject_failure "$migration_three" 'recovery-test-checkpoint: migration-3-mid' "$task_tmp_dir/migration-three-fails.sql"
if apply_file "$partial_three_db" "$task_tmp_dir/migration-three-fails.sql" 2>/dev/null; then
  echo "migration three failure injection unexpectedly succeeded" >&2
  exit 1
fi
assert_sql "$partial_three_db" "select has_table_privilege('anon','public.transactions','truncate')" "t" "migration three atomic grant rollback"
assert_sql "$partial_three_db" "select count(*) from pg_policies where schemaname='public' and tablename='transactions'" "2" "migration three atomic policy rollback"
assert_sql "$partial_three_db" "select pg_get_expr(d.adbin,d.adrelid) from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.recurring'::regclass and a.attname='type'" "'expense'::text" "migration three atomic default rollback"
apply_file "$partial_three_db" "$migration_three"

access_compatible_db="${databases[6]}"
create_v81_database "$access_compatible_db"
apply_file "$access_compatible_db" "$migration_one"
apply_file "$access_compatible_db" "$migration_two"
psql_db "$access_compatible_db" -qc "alter table public.categories alter column kind set default 'despesa'; alter table public.recurring alter column type set default 'despesa'" >/dev/null
apply_file "$access_compatible_db" "$migration_three"

access_drift_db="${databases[7]}"
create_v81_database "$access_drift_db"
apply_file "$access_drift_db" "$migration_one"
apply_file "$access_drift_db" "$migration_two"
psql_db "$access_drift_db" -qc "alter table public.recurring alter column type set default 'misterio'" >/dev/null
if apply_file "$access_drift_db" "$migration_three" 2>/dev/null; then
  echo "incompatible access/default drift unexpectedly succeeded" >&2
  exit 1
fi
assert_sql "$access_drift_db" "select has_table_privilege('anon','public.transactions','truncate')" "t" "access drift failure changes no grants"

policy_drift_db="${databases[8]}"
create_v81_database "$policy_drift_db"
apply_file "$policy_drift_db" "$migration_one"
apply_file "$policy_drift_db" "$migration_two"
psql_db "$policy_drift_db" -qc "drop policy transactions_own_rows_duplicate on public.transactions; create policy transactions_own_rows_duplicate on public.transactions for select to public using (true)" >/dev/null
if apply_file "$policy_drift_db" "$migration_three" 2>/dev/null; then
  echo "unsafe policy drift unexpectedly succeeded" >&2
  exit 1
fi
assert_sql "$policy_drift_db" "select count(*) from pg_policies where schemaname='public' and tablename='transactions' and qual='true'" "1" "unsafe policy drift remains untouched"

apply_file "$normal_db" "$rollback_sql"
assert_sql "$normal_db" "select has_function_privilege('authenticated','public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','execute')" "f" "writer rollback revoke"
assert_sql "$normal_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='operation_id'" "1" "writer rollback preserves schema"
apply_file "$normal_db" "$migration_one"
apply_file "$normal_db" "$migration_two"
assert_sql "$normal_db" "select has_function_privilege('authenticated','public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','execute')" "t" "retry restores reviewed grant"
assert_sql "$normal_db" "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans')" "0" "anon has no private table grants"
assert_sql "$normal_db" "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and table_name in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans') and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')" "0" "authenticated excessive grants removed"
assert_sql "$normal_db" "select count(*) from pg_policies where schemaname='public' and tablename in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans') and policyname='mb_v82_own_rows'" "9" "canonical owner policies installed"

run_pgtap "$normal_db" "$repo_root/supabase/tests/v82_financial_integrity_test.sql"
run_pgtap "$normal_db" "$repo_root/supabase/tests/v82_recurring_operations_test.sql"
run_pgtap "$normal_db" "$repo_root/supabase/tests/v82_production_access_contract_test.sql"

echo "v82 production migration recovery: 13 scenarios and ${pgtap_assertions} pgTAP assertions passed"
