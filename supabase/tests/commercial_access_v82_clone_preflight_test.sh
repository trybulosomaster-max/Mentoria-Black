#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
baseline="$repo_root/supabase/migrations/20260820161844_local_v81_structural_baseline.sql"
v82_one="$repo_root/supabase/migrations/20260820161846_add_v82_structured_financial_operations.sql"
v82_two="$repo_root/supabase/migrations/20260820195658_structure_recurring_financial_operations_v82.sql"
v82_three="$repo_root/supabase/migrations/20260821205630_reconcile_v82_production_access_contract.sql"
commercial="$repo_root/supabase/migrations/20260822212119_commercial_access_v1.sql"
commercial_tests="$repo_root/supabase/tests/commercial_access_v1_test.sql"
v82_financial_tests="$repo_root/supabase/tests/v82_financial_integrity_test.sql"
v82_recurring_tests="$repo_root/supabase/tests/v82_recurring_operations_test.sql"
suffix="${BASHPID:-$$}"
normal_db="mb_commercial_v82_normal_${suffix}"
legacy_db="mb_commercial_v82_legacy_${suffix}"
partial_db="mb_commercial_v82_partial_${suffix}"
collision_db="mb_commercial_v82_collision_${suffix}"
function_drift_db="mb_commercial_v82_function_drift_${suffix}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-commercial-v82.XXXXXX")"
pgtap_assertions=0
shell_assertions=0

cleanup(){
  for database in "$normal_db" "$legacy_db" "$partial_db" "$collision_db" "$function_drift_db"; do
    case "$database" in mb_commercial_v82_*) docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1 || true;; esac
  done
  case "$tmp_dir" in "${TMPDIR:-/tmp}"/mb-commercial-v82.*) rm -rf "$tmp_dir";; esac
}
trap cleanup EXIT

docker inspect "$db_container" >/dev/null
[[ "$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" == "$project_id" ]]
psql_db(){ local database="$1";shift;docker exec -i "$db_container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"; }
apply_file(){ psql_db "$1" < "$2" >/dev/null; }
assert_sql(){ local actual;actual="$(psql_db "$1" -Atqc "$2")";[[ "$actual" == "$3" ]]||{ echo "$4: expected '$3', got '$actual'" >&2;exit 1;};shell_assertions=$((shell_assertions+1)); }
run_pgtap(){
  local database="$1" file="$2" output
  output="$tmp_dir/$(basename "$file").${database}.tap"
  psql_db "$database" < "$file" >"$output"
  if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' "$output";then sed -n '1,240p' "$output" >&2;exit 1;fi
  local count;count="$(rg -c '^[[:space:]]*ok [0-9]+' "$output")";[[ "$count" -gt 0 ]];pgtap_assertions=$((pgtap_assertions+count))
}

create_v82_clone(){
  local database="$1"
  case "$database" in mb_commercial_v82_*) ;; *) echo "unsafe clone name" >&2;exit 1;; esac
  docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create schema auth;
create schema extensions;
create schema supabase_migrations;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
insert into supabase_migrations.schema_migrations(version,name) values('20260820000000','v81_production_checkpoint');
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,extensions to anon,authenticated;
grant select on auth.users to authenticated;
SQL
  apply_file "$database" "$baseline"
  psql_db "$database" >/dev/null <<'SQL'
alter table public.accounts alter column opening_balance type numeric(14,2);
alter table public.assets alter column current_value type numeric(14,2);
alter table public.recurring alter column amount type numeric(14,2);
alter table public.transactions alter column amount type numeric(14,2);
alter table public.recurring drop constraint recurring_id_user_id_key;
alter table public.transactions drop constraint transactions_id_user_id_key;
create table public.categories(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 name text not null,kind text default 'expense' check(kind in('receita','despesa','income','expense')),created_at timestamptz not null default now()
);
create table public.monthly_plans(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 year integer not null,month integer not null,revenue numeric not null default 0,created_at timestamptz not null default now()
);
alter table public.categories enable row level security;
alter table public.monthly_plans enable row level security;
create policy categories_own_rows on public.categories for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy monthly_plans_own_rows on public.monthly_plans for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy monthly_plans_own_rows_duplicate on public.monthly_plans for all to public using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy transactions_own_rows_duplicate on public.transactions for all to public using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant all privileges on table public.accounts,public.cards,public.categories,public.goals,public.assets,public.liabilities,public.recurring,public.transactions,public.monthly_plans to anon,authenticated;
SQL
  apply_file "$database" "$v82_one"
  apply_file "$database" "$v82_two"
  apply_file "$database" "$v82_three"
  psql_db "$database" -qc "insert into supabase_migrations.schema_migrations(version,name) values ('20260820161846','add_v82_structured_financial_operations'),('20260820195658','structure_recurring_financial_operations_v82'),('20260821205630','reconcile_v82_production_access_contract')" >/dev/null
  assert_sql "$database" "select count(*) from pg_proc where proname in ('create_transfer_v82','create_investment_v82','create_rescue_v82','reverse_structured_operation_v82','materialize_recurring_occurrences_v82','create_investment_entry_v82')" "6" "six V82 RPCs"
  assert_sql "$database" "select count(*) from pg_policies where schemaname='public' and policyname='mb_v82_own_rows'" "9" "nine canonical V82 policies"
  assert_sql "$database" "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and table_name in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')" "36" "V82 CRUD grants"
}

create_v82_clone "$normal_db"
run_pgtap "$normal_db" "$v82_financial_tests"
run_pgtap "$normal_db" "$v82_recurring_tests"
apply_file "$normal_db" "$commercial"
assert_sql "$normal_db" "select count(*) from pg_policies where schemaname='public' and policyname='mb_v82_own_rows'" "9" "commercial phase one preserves V82 policies"
psql_db "$normal_db" -qc "create extension if not exists plpgsql_check" >/dev/null
# The activation function is exercised below against all nine tables; plpgsql_check
# cannot resolve its dynamic format('public.%I', table_name) identifiers statically.
assert_sql "$normal_db" "set client_min_messages=warning; select count(*) from unnest(array[
  'public.start_my_app_trial()'::regprocedure,
  'public.admin_grant_commercial_access_v1(uuid,text[],text,timestamptz,uuid,text)'::regprocedure,
  'public.bootstrap_commercial_admin_v1(uuid,uuid,text)'::regprocedure,
  'public.admin_revoke_commercial_access_v1(uuid,uuid,text)'::regprocedure,
  'public.process_payment_event_v1(uuid)'::regprocedure,
  'public.rollback_commercial_enforcement_v1(uuid,text)'::regprocedure
]) function_oid cross join lateral plpgsql_check_function_tb(function_oid) check_result where check_result.level in ('error','fatal')" "0" "plpgsql_check finds no SQL errors"
run_pgtap "$normal_db" "$commercial_tests"
commercial_counts="$(psql_db "$normal_db" -Atqc "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events))")"
apply_file "$normal_db" "$commercial"
assert_sql "$normal_db" "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events))" "$commercial_counts" "semantic V2 retry changes no rows"

create_v82_clone "$legacy_db"
psql_db "$legacy_db" >/dev/null <<'SQL'
insert into auth.users(id,email,email_confirmed_at) values
 ('a1000000-0000-4000-8000-000000000001','legacy@example.invalid',now()),
 ('b1000000-0000-4000-8000-000000000002','future@example.invalid',now()),
 ('c1000000-0000-4000-8000-000000000003','trial@example.invalid',now()),
 ('d1000000-0000-4000-8000-000000000004','unconfirmed@example.invalid',null);
insert into accounts(id,user_id,name) values('a1100000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Legacy account');
insert into cards(id,user_id,name) values('a1200000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Legacy card');
insert into categories(id,user_id,name,kind) values('a1300000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Legacy category','despesa');
insert into goals(id,user_id,name,target,current) values('a1400000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Legacy goal',1000,100);
insert into assets(id,user_id,name) values('a1500000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Legacy asset');
insert into liabilities(id,user_id,name) values('a1600000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Legacy liability');
insert into recurring(id,user_id,name,type,amount,next_date) values('a1700000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Legacy recurring','despesa',10,current_date);
insert into transactions(id,user_id,transaction_date,description,amount,transaction_type,status) values('a1800000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',current_date,'Legacy transaction',10,'despesa','realizado');
insert into monthly_plans(id,user_id,year,month,revenue) values('a1900000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',2026,8,1000);
SQL
legacy_counts="$(psql_db "$legacy_db" -Atqc "select concat_ws(',',(select count(*) from accounts),(select count(*) from cards),(select count(*) from categories),(select count(*) from goals),(select count(*) from assets),(select count(*) from liabilities),(select count(*) from recurring),(select count(*) from transactions),(select count(*) from monthly_plans))")"
apply_file "$legacy_db" "$commercial"
assert_sql "$legacy_db" "select concat_ws(',',(select count(*) from accounts),(select count(*) from cards),(select count(*) from categories),(select count(*) from goals),(select count(*) from assets),(select count(*) from liabilities),(select count(*) from recurring),(select count(*) from transactions),(select count(*) from monthly_plans))" "$legacy_counts" "commercial migration preserves all financial counts"
assert_sql "$legacy_db" "set role authenticated;set request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';select count(*) from accounts;reset role" "1" "phase one never locks out an unbootstrapped legacy owner"
if psql_db "$legacy_db" -qc "select public.activate_commercial_enforcement_v1('a1000000-0000-4000-8000-000000000001','Premature activation')" 2>"$tmp_dir/legacy-block.err";then echo "activation without legacy grant unexpectedly succeeded" >&2;exit 1;fi
rg -q 'would lock 1 legacy owner' "$tmp_dir/legacy-block.err"
assert_sql "$legacy_db" "select enforced from public.commercial_enforcement_state" "f" "failed activation rolls back"
assert_sql "$legacy_db" "select count(*) from public.bootstrap_commercial_admin_v1('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Authorized legacy owner bootstrap') where created" "2" "legacy owner receives APP and KNOWLEDGE"
assert_sql "$legacy_db" "select public.activate_commercial_enforcement_v1('a1000000-0000-4000-8000-000000000001','Authorized post-bootstrap activation')" "t" "post-bootstrap activation succeeds"
assert_sql "$legacy_db" "select count(*) from pg_policies where schemaname='public' and policyname='mb_commercial_app_access'" "9" "nine entitlement policies active"
psql_db "$legacy_db" -qc "set enable_seqscan=off; explain(costs off) select exists(select 1 from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='a1000000-0000-4000-8000-000000000001' and p.code='APP' and g.status='active')" >"$tmp_dir/access-plan.txt"
rg -q 'access_grants_user_product_status_idx' "$tmp_dir/access-plan.txt"
psql_db "$legacy_db" -qc "set role authenticated; set request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001'; explain(costs off,verbose) select * from accounts" >"$tmp_dir/rls-plan.txt"
rg -q 'InitPlan' "$tmp_dir/rls-plan.txt"
shell_assertions=$((shell_assertions+2))
assert_sql "$legacy_db" "set role authenticated;set request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';select count(*) from accounts;reset role" "1" "legacy APP owner retains own finance"
assert_sql "$legacy_db" "set role authenticated;set request.jwt.claim.sub='b1000000-0000-4000-8000-000000000002';select count(*) from accounts;reset role" "0" "future user without APP is blocked"
assert_sql "$legacy_db" "set role authenticated;set request.jwt.claim.sub='d1000000-0000-4000-8000-000000000004';select result from start_my_app_trial();reset role" "not_eligible" "unconfirmed user cannot start trial"
assert_sql "$legacy_db" "set role authenticated;set request.jwt.claim.sub='c1000000-0000-4000-8000-000000000003';select result from start_my_app_trial();reset role" "started" "confirmed user starts trial"
psql_db "$legacy_db" -qc "insert into accounts(id,user_id,name) values('c1100000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000003','Trial data')" >/dev/null
assert_sql "$legacy_db" "set role authenticated;set request.jwt.claim.sub='c1000000-0000-4000-8000-000000000003';select count(*) from accounts;reset role" "1" "active trial reads own finance"
psql_db "$legacy_db" -qc "update product_trials set started_at=statement_timestamp()-interval '168 hours',expires_at=statement_timestamp() where user_id='c1000000-0000-4000-8000-000000000003';update access_grants set started_at=statement_timestamp()-interval '168 hours',expires_at=statement_timestamp() where user_id='c1000000-0000-4000-8000-000000000003' and access_type='trial'" >/dev/null
assert_sql "$legacy_db" "set role authenticated;set request.jwt.claim.sub='c1000000-0000-4000-8000-000000000003';select count(*) from accounts;reset role" "0" "trial blocks at 168 hours"
assert_sql "$legacy_db" "set role authenticated;set request.jwt.claim.sub='c1000000-0000-4000-8000-000000000003';select result from start_my_app_trial();reset role" "already_used" "expired trial never restarts"
assert_sql "$legacy_db" "select count(*) from accounts where user_id='c1000000-0000-4000-8000-000000000003'" "1" "trial expiry preserves rows"
assert_sql "$legacy_db" "select public.rollback_commercial_enforcement_v1('a1000000-0000-4000-8000-000000000001','Verified application rollback')" "t" "enforcement rollback"
assert_sql "$legacy_db" "select count(*) from pg_policies where schemaname='public' and policyname='mb_v82_own_rows'" "9" "rollback restores V82 ownership"

create_v82_clone "$partial_db"
awk '{print;if(index($0,"create table if not exists public.access_grants")){armed=1}else if(armed&&/^\);$/){print "select 1/0;";armed=0}}' "$commercial" >"$tmp_dir/partial.sql"
if apply_file "$partial_db" "$tmp_dir/partial.sql" 2>/dev/null;then echo "partial migration unexpectedly succeeded" >&2;exit 1;fi
assert_sql "$partial_db" "select count(*) from information_schema.tables where table_schema='public' and table_name in ('products','access_grants','payment_events')" "0" "partial failure is atomic"
apply_file "$partial_db" "$commercial"

create_v82_clone "$collision_db"
psql_db "$collision_db" -qc "create table public.products(id uuid primary key,code text unique)" >/dev/null
if apply_file "$collision_db" "$commercial" 2>"$tmp_dir/collision.err";then echo "table collision unexpectedly accepted" >&2;exit 1;fi
rg -q 'unknown or partial commercial schema' "$tmp_dir/collision.err"
assert_sql "$collision_db" "select count(*) from information_schema.tables where table_schema='public' and table_name='access_grants'" "0" "table collision is NO-GO without overwrite"

create_v82_clone "$function_drift_db"
psql_db "$function_drift_db" -qc "create function public.has_active_access(text) returns boolean language sql as 'select true'" >/dev/null
if apply_file "$function_drift_db" "$commercial" 2>"$tmp_dir/function-drift.err";then echo "function collision unexpectedly accepted" >&2;exit 1;fi
rg -q 'access RPC exists without commercial tables' "$tmp_dir/function-drift.err"
assert_sql "$function_drift_db" "select count(*) from information_schema.tables where table_schema='public' and table_name='products'" "0" "function drift is NO-GO without partial objects"

echo "commercial V2 faithful V82 clone: ${pgtap_assertions} pgTAP + ${shell_assertions} shell assertions passed"
