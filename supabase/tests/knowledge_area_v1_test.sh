#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
commercial="$repo_root/supabase/migrations/20260822212119_commercial_access_v1.sql"
knowledge="$repo_root/supabase/migrations/20260823000450_knowledge_area_v1.sql"
seed="$repo_root/supabase/knowledge/seed.mock.sql"
tests="$repo_root/supabase/tests/knowledge_area_v1_test.sql"
suffix="${BASHPID:-$$}"
normal_db="mb_knowledge_v1_normal_${suffix}"
partial_db="mb_knowledge_v1_partial_${suffix}"
drift_db="mb_knowledge_v1_drift_${suffix}"
policy_drift_db="mb_knowledge_v1_policy_drift_${suffix}"
function_drift_db="mb_knowledge_v1_function_drift_${suffix}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-knowledge-v1.XXXXXX")"
shell_assertions=0

cleanup(){
  for database in "$normal_db" "$partial_db" "$drift_db" "$policy_drift_db" "$function_drift_db";do
    case "$database" in mb_knowledge_v1_*) docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1||true;;esac
  done
  case "$tmp_dir" in "${TMPDIR:-/tmp}"/mb-knowledge-v1.*) rm -rf "$tmp_dir";;esac
}
trap cleanup EXIT
docker inspect "$db_container" >/dev/null
[[ "$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" == "$project_id" ]]
psql_db(){ local database="$1";shift;docker exec -i "$db_container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"; }
apply_file(){ psql_db "$1" < "$2" >/dev/null; }
assert_sql(){ local actual;actual="$(psql_db "$1" -Atqc "$2")";[[ "$actual" == "$3" ]]||{ echo "$4: expected '$3', got '$actual'" >&2;exit 1;};shell_assertions=$((shell_assertions+1)); }
create_base(){
  local database="$1"
  docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
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
  apply_file "$database" "$commercial"
}

create_base "$normal_db"
apply_file "$normal_db" "$knowledge"
apply_file "$normal_db" "$seed"
psql_db "$normal_db" -qc "create extension if not exists plpgsql_check" >/dev/null
assert_sql "$normal_db" "select count(*) from unnest(array['public.search_my_knowledge_v1(text,integer)'::regprocedure,'public.save_my_knowledge_progress_v1(uuid,uuid,numeric,uuid,boolean)'::regprocedure,'public.set_my_knowledge_bookmark_v1(uuid,uuid,uuid,boolean)'::regprocedure]) function_oid cross join lateral plpgsql_check_function_tb(function_oid) check_result where check_result.level in('error','fatal')" "0" "plpgsql_check finds no Knowledge RPC errors"
assert_sql "$normal_db" "select count(*) from pg_indexes where schemaname='public' and indexname='knowledge_sections_search_idx' and indexdef like '%USING gin%'" "1" "full-text search uses a GIN index"
assert_sql "$normal_db" "select count(*) from pg_policies where schemaname='public' and tablename='knowledge_sections' and policyname='knowledge_sections_entitled_read' and qual like '%has_active_access(''KNOWLEDGE''::text)%'" "1" "section entitlement predicate is statement-constant"
output="$tmp_dir/knowledge.tap"
psql_db "$normal_db" < "$tests" > "$output"
if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' "$output";then sed -n '1,240p' "$output" >&2;exit 1;fi
pgtap_assertions="$(rg -c '^[[:space:]]*ok [0-9]+' "$output")"
counts="$(psql_db "$normal_db" -Atqc "select concat_ws(',',(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))")"
apply_file "$normal_db" "$knowledge"
assert_sql "$normal_db" "select concat_ws(',',(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))" "$counts" "retry preserves rows"

create_base "$partial_db"
awk '{print;if(index($0,"create table if not exists public.knowledge_chapters")){armed=1}else if(armed&&/^\);$/){print "select 1/0;";armed=0}}' "$knowledge" > "$tmp_dir/partial.sql"
if apply_file "$partial_db" "$tmp_dir/partial.sql" 2>/dev/null;then echo 'partial migration unexpectedly succeeded' >&2;exit 1;fi
assert_sql "$partial_db" "select count(*) from information_schema.tables where table_schema='public' and table_name like 'knowledge_%'" "0" "partial failure is atomic"
apply_file "$partial_db" "$knowledge"

create_base "$drift_db"
psql_db "$drift_db" -qc "create table public.knowledge_publications(id uuid primary key)" >/dev/null
if apply_file "$drift_db" "$knowledge" 2>"$tmp_dir/drift.err";then echo 'schema drift unexpectedly accepted' >&2;exit 1;fi
rg -q 'unknown or partial schema' "$tmp_dir/drift.err"
assert_sql "$drift_db" "select count(*) from information_schema.tables where table_schema='public' and table_name='knowledge_parts'" "0" "drift refuses partial schema"

create_base "$policy_drift_db"
apply_file "$policy_drift_db" "$knowledge"
psql_db "$policy_drift_db" -qc "drop policy knowledge_sections_entitled_read on public.knowledge_sections;create policy knowledge_sections_entitled_read on public.knowledge_sections for select to authenticated using(true)" >/dev/null
if apply_file "$policy_drift_db" "$knowledge" 2>"$tmp_dir/policy-drift.err";then echo 'policy drift unexpectedly accepted' >&2;exit 1;fi
rg -q 'policy semantics differ' "$tmp_dir/policy-drift.err"

create_base "$function_drift_db"
apply_file "$function_drift_db" "$knowledge"
psql_db "$function_drift_db" -qc "create or replace function public.knowledge_section_metadata_valid_v1(p_metadata jsonb) returns boolean language sql immutable security invoker set search_path=pg_catalog as 'select true'" >/dev/null
if apply_file "$function_drift_db" "$knowledge" 2>"$tmp_dir/function-drift.err";then echo 'function drift unexpectedly accepted' >&2;exit 1;fi
rg -q 'function semantics differ' "$tmp_dir/function-drift.err"

echo "knowledge area v1 SQL: ${pgtap_assertions} pgTAP + ${shell_assertions} shell assertions; RLS A/B, retry, rollback and drift refusal passed"
