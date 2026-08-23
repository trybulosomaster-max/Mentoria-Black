#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="$repo_root/supabase/migrations/20260823022320_reconcile_beta_v82_rls_policy_contract.sql"
db_host="127.0.0.1"
db_port="54322"
db_user="postgres"
db_password="postgres"
normal_db="mb_rls_contract_normal"
drift_db="mb_rls_contract_drift"

export PGPASSWORD="$db_password"

cleanup() {
  dropdb --if-exists --force -h "$db_host" -p "$db_port" -U "$db_user" "$normal_db" >/dev/null 2>&1 || true
  dropdb --if-exists --force -h "$db_host" -p "$db_port" -U "$db_user" "$drift_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

setup_fixture() {
  local database="$1"
  createdb -h "$db_host" -p "$db_port" -U "$db_user" "$database"
  psql -X -v ON_ERROR_STOP=1 -h "$db_host" -p "$db_port" -U "$db_user" -d "$database" >/dev/null <<'SQL'
create schema auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $fixture$
declare
  v_table text;
begin
  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    execute format('create table public.%I (id text primary key, user_id uuid not null)', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'create policy %I on public.%I as permissive for all to authenticated '
      'using (((select auth.uid()) is not null) and ((select auth.uid()) = user_id)) '
      'with check (((select auth.uid()) is not null) and ((select auth.uid()) = user_id))',
      v_table || '_own_rows', v_table
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_table);
    execute format(
      'insert into public.%I(id,user_id) values ($1,$2),($3,$4)', v_table
    ) using 'a', '00000000-0000-0000-0000-00000000000a'::uuid,
            'b', '00000000-0000-0000-0000-00000000000b'::uuid;
  end loop;
end
$fixture$;
SQL
}

assert_scalar() {
  local database="$1"
  local sql="$2"
  local expected="$3"
  local label="$4"
  local actual
  actual="$(psql -X -A -t -v ON_ERROR_STOP=1 -h "$db_host" -p "$db_port" -U "$db_user" -d "$database" -c "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s: expected %s, got %s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

setup_fixture "$normal_db"
psql -X -v ON_ERROR_STOP=1 -h "$db_host" -p "$db_port" -U "$db_user" -d "$normal_db" -f "$migration" >/dev/null
assert_scalar "$normal_db" "select count(*) from pg_policies where schemaname='public' and policyname='mb_v82_own_rows'" "9" "canonical policies"
assert_scalar "$normal_db" "select count(*) from pg_policies where schemaname='public' and policyname like '%\\_own\\_rows' escape '\\' and policyname<>'mb_v82_own_rows'" "0" "legacy policies removed"
assert_scalar "$normal_db" "select count(*) from pg_policies where schemaname='public' and cmd='ALL' and roles=array['authenticated']::name[] and permissive='PERMISSIVE' and qual=with_check" "9" "policy semantics preserved"
assert_scalar "$normal_db" "select sum(rows) from (select count(*) rows from accounts union all select count(*) from cards union all select count(*) from categories union all select count(*) from goals union all select count(*) from assets union all select count(*) from liabilities union all select count(*) from recurring union all select count(*) from transactions union all select count(*) from monthly_plans) s" "18" "row counts preserved"

# A second execution must be a semantic no-op.
psql -X -v ON_ERROR_STOP=1 -h "$db_host" -p "$db_port" -U "$db_user" -d "$normal_db" -f "$migration" >/dev/null
assert_scalar "$normal_db" "select count(*) from pg_policies where schemaname='public' and policyname='mb_v82_own_rows'" "9" "retry is idempotent"

# Real role checks run in a transaction and leave no rows behind.
psql -X -v ON_ERROR_STOP=1 -h "$db_host" -p "$db_port" -U "$db_user" -d "$normal_db" >/dev/null <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true);
do $rls$
declare
  v_table text;
  v_count bigint;
begin
  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    execute format('select count(*) from public.%I',v_table) into v_count;
    if v_count <> 1 then raise exception 'owner visibility failed for %',v_table; end if;

    execute format('insert into public.%I(id,user_id) values ($1,$2)',v_table)
      using 'owner-insert','00000000-0000-0000-0000-00000000000a'::uuid;

    begin
      execute format('insert into public.%I(id,user_id) values ($1,$2)',v_table)
        using 'cross-insert','00000000-0000-0000-0000-00000000000b'::uuid;
      raise exception 'cross-user insert unexpectedly succeeded for %',v_table;
    exception when insufficient_privilege then null;
    end;

    begin
      execute format('update public.%I set user_id=$1 where id=$2',v_table)
        using '00000000-0000-0000-0000-00000000000b'::uuid,'a';
      raise exception 'cross-user reassignment unexpectedly succeeded for %',v_table;
    exception when insufficient_privilege then null;
    end;

    execute format('delete from public.%I where id=$1',v_table) using 'owner-insert';
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception 'owner delete failed for %',v_table; end if;

    execute format('delete from public.%I where id=$1',v_table) using 'b';
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception 'cross-user delete unexpectedly succeeded for %',v_table; end if;
  end loop;
end
$rls$;
rollback;
SQL

# A failure after an earlier rename must roll the entire migration back.
setup_fixture "$drift_db"
psql -X -v ON_ERROR_STOP=1 -h "$db_host" -p "$db_port" -U "$db_user" -d "$drift_db" >/dev/null <<'SQL'
create policy unexpected_policy on public.cards for select to authenticated using (true);
SQL
if psql -X -v ON_ERROR_STOP=1 -h "$db_host" -p "$db_port" -U "$db_user" -d "$drift_db" -f "$migration" >/dev/null 2>&1; then
  printf 'policy-set drift unexpectedly succeeded\n' >&2
  exit 1
fi
assert_scalar "$drift_db" "select count(*) from pg_policies where schemaname='public' and policyname='mb_v82_own_rows'" "0" "partial rename rolled back"
assert_scalar "$drift_db" "select count(*) from pg_policies where schemaname='public' and policyname in ('accounts_own_rows','cards_own_rows','categories_own_rows','goals_own_rows','assets_own_rows','liabilities_own_rows','recurring_own_rows','transactions_own_rows','monthly_plans_own_rows')" "9" "legacy set preserved after rollback"

printf 'beta V82 RLS policy contract: 9 tables; rename, retry, RLS and rollback passed\n'
