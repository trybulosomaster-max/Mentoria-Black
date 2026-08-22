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
  "mb_v82_recovery_real_legacy_${suffix}"
  "mb_v82_recovery_constraint_drift_${suffix}"
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

run_preflight_go() {
  local database="$1"
  local output="$task_tmp_dir/${database}.preflight-go"
  if ! psql_db "$database" < "$preflight_sql" >"$output" 2>&1; then
    sed -n '1,220p' "$output" >&2
    echo "expected preflight GO" >&2
    exit 1
  fi
  rg -q 'MB_V82_PREFLIGHT_RESULT=GO' "$output"
}

run_preflight_no_go() {
  local database="$1" expected="$2"
  local output="$task_tmp_dir/${database}.preflight-no-go"
  if psql_db "$database" < "$preflight_sql" >"$output" 2>&1; then
    echo "expected preflight NO-GO: $expected" >&2
    exit 1
  fi
  if ! rg -q 'MB_V82_PREFLIGHT_RESULT=NO-GO' "$output" || ! rg -q "$expected" "$output"; then
    sed -n '1,220p' "$output" >&2
    echo "preflight NO-GO missing expected diagnostic: $expected" >&2
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
alter table public.accounts alter column opening_balance type numeric(14,2);
alter table public.assets alter column current_value type numeric(14,2);
alter table public.recurring alter column amount type numeric(14,2);
alter table public.transactions alter column amount type numeric(14,2);
alter table public.recurring drop constraint recurring_id_user_id_key;
alter table public.transactions drop constraint transactions_id_user_id_key;
create table public.categories(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text default 'expense' check (kind in ('receita','despesa','income','expense')),
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
psql_db "$compatible_db" >/dev/null <<'SQL'
alter table public.accounts add column balance_as_of date;
alter table public.transactions add constraint legacy_transactions_owner_unique unique(id,user_id);
alter table public.recurring add constraint legacy_recurring_owner_unique unique(id,user_id);
SQL
apply_file "$compatible_db" "$migration_one"
assert_sql "$compatible_db" "select count(*) from pg_constraint where conrelid='public.transactions'::regclass and conname='transactions_id_user_id_key' and pg_get_constraintdef(oid)='UNIQUE (id, user_id)'" "1" "equivalent transaction ownership constraint reused"
assert_sql "$compatible_db" "select count(*) from pg_constraint where conrelid='public.recurring'::regclass and conname='recurring_id_user_id_key' and pg_get_constraintdef(oid)='UNIQUE (id, user_id)'" "1" "equivalent recurring ownership constraint reused"
assert_sql "$compatible_db" "select count(*) from pg_constraint where conname in ('legacy_transactions_owner_unique','legacy_recurring_owner_unique')" "0" "equivalent constraints renamed canonically"
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

real_legacy_db="${databases[9]}"
create_v81_database "$real_legacy_db"
psql_db "$real_legacy_db" >/dev/null <<'SQL'
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000001','synthetic-a@example.invalid'),
  ('00000000-0000-0000-0000-000000000002','synthetic-b@example.invalid'),
  ('00000000-0000-0000-0000-000000000003','synthetic-c@example.invalid');
insert into public.accounts(id,user_id,name)
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Synthetic account');
insert into public.cards(id,user_id,name)
values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Synthetic card');
insert into public.categories(id,user_id,name,kind)
values ('21000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Synthetic nullable legacy kind',null);
insert into public.goals(user_id,name)
select '00000000-0000-0000-0000-000000000001',format('Synthetic goal %s',n)
from generate_series(1,4) n;
insert into public.recurring(user_id,name,type,amount,frequency)
select '00000000-0000-0000-0000-000000000001',format('Synthetic recurring %s',n),'expense',100,'monthly'
from generate_series(1,15) n;
insert into public.transactions(user_id,transaction_date,description,amount,transaction_type,status)
select '00000000-0000-0000-0000-000000000001',current_date,format('Synthetic ordinary %s',n),100,'despesa','realizado'
from generate_series(1,179) n;
insert into public.transactions(id,user_id,transaction_date,description,amount,transaction_type,status,account_id) values
  ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',current_date,'Synthetic pending investment 1',100,'investimento','pendente','10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',current_date,'Synthetic pending investment 2',100,'investimento','pendente','10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001',current_date,'Synthetic realized investment',100,'investimento','realizado',null),
  ('30000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001',current_date,'Synthetic realized transfer',100,'transferencia','realizado',null);
SQL
assert_sql "$real_legacy_db" "select count(*) from public.transactions" "183" "real legacy fixture transaction count"
assert_sql "$real_legacy_db" "select count(*) from public.transactions where transaction_type in ('investimento','transferencia','resgate')" "4" "real legacy candidate count"
run_preflight_no_go "$real_legacy_db" 'legacy:transactions_incompatible_v82_shape'
rg -q '"transactions_incompatible_v82_shape_count": 4' "$task_tmp_dir/${real_legacy_db}.preflight-no-go"

synthetic_export="$task_tmp_dir/real-legacy-four.csv"
psql_db "$real_legacy_db" -c "copy (select * from public.transactions where id in ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000004') order by id) to stdout with (format csv,header true)" >"$synthetic_export"
chmod 600 "$synthetic_export"
[[ -s "$synthetic_export" ]]
[[ "$(stat -f '%Lp' "$synthetic_export")" == "600" ]]
shasum -a 256 "$synthetic_export" >/dev/null

psql_db "$real_legacy_db" >/dev/null <<'SQL'
begin;
create temporary table mb_v82_cleanup_ids(id uuid primary key) on commit drop;
insert into mb_v82_cleanup_ids(id)
select id from public.transactions
where id in (
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000004'
)
for update;
do $cleanup$
declare v_count bigint;
begin
  select count(*) into v_count from mb_v82_cleanup_ids;
  if v_count<>4 then raise exception 'controlled cleanup requires exactly four locked IDs'; end if;
  if (select count(*) from public.transactions)<>183 then raise exception 'unexpected transaction pre-count'; end if;
  if (select count(*) from public.recurring)<>15
     or (select count(*) from public.goals)<>4
     or (select count(*) from public.accounts)<>1
     or (select count(*) from public.cards)<>1
     or (select count(*) from public.assets)<>0
     or (select count(*) from public.liabilities)<>0
     or (select count(*) from auth.users)<>3 then
    raise exception 'protected table pre-count mismatch';
  end if;
end
$cleanup$;
do $delete$
declare v_deleted bigint;
begin
  delete from public.transactions t using mb_v82_cleanup_ids c where t.id=c.id;
  get diagnostics v_deleted=row_count;
  if v_deleted<>4 then raise exception 'controlled cleanup deleted % rows, expected four',v_deleted; end if;
  if (select count(*) from public.transactions)<>179 then raise exception 'unexpected transaction post-count'; end if;
  if (select count(*) from public.recurring)<>15
     or (select count(*) from public.goals)<>4
     or (select count(*) from public.accounts)<>1
     or (select count(*) from public.cards)<>1
     or (select count(*) from public.assets)<>0
     or (select count(*) from public.liabilities)<>0
     or (select count(*) from auth.users)<>3 then
    raise exception 'protected table post-count mismatch';
  end if;
end
$delete$;
commit;
SQL
assert_sql "$real_legacy_db" "select count(*) from public.transactions" "179" "controlled cleanup post-count"
assert_sql "$real_legacy_db" "select count(*) from public.transactions where transaction_type in ('investimento','transferencia','resgate')" "0" "controlled cleanup leaves no incompatible structured legacy"
run_preflight_go "$real_legacy_db"
apply_file "$real_legacy_db" "$migration_one"
assert_sql "$real_legacy_db" "select count(*) from pg_constraint where conname in ('transactions_id_user_id_key','recurring_id_user_id_key') and pg_get_constraintdef(oid)='UNIQUE (id, user_id)'" "2" "migration one installs ownership keys before dependent FKs"
assert_sql "$real_legacy_db" "select string_agg(format_type(a.atttypid,a.atttypmod),',' order by a.attrelid::regclass::text,a.attname) from pg_attribute a where (a.attrelid,a.attname) in (('public.accounts'::regclass,'opening_balance'),('public.assets'::regclass,'current_value'),('public.recurring'::regclass,'amount'),('public.transactions'::regclass,'amount'))" "numeric(14,2),numeric(14,2),numeric(14,2),numeric(14,2)" "migration one preserves V81 numeric typmods"
assert_sql "$real_legacy_db" "select count(*) from public.transactions" "179" "migration one preserves cleaned transaction rows"
apply_file "$real_legacy_db" "$migration_two"
apply_file "$real_legacy_db" "$migration_three"
assert_sql "$real_legacy_db" "select count(*) from public.categories where id='21000000-0000-0000-0000-000000000001' and kind is null" "1" "migration three does not rewrite nullable historical category kind"
assert_sql "$real_legacy_db" "select count(*) from public.recurring where type='expense'" "15" "migration three does not rewrite historical recurring type"
assert_sql "$real_legacy_db" "select pg_get_expr(d.adbin,d.adrelid) from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.categories'::regclass and a.attname='kind'" "'despesa'::text" "migration three changes only the future category default"
psql_db "$real_legacy_db" -qc "insert into supabase_migrations.schema_migrations(version,name) values ('20260820161846','add_v82_structured_financial_operations'),('20260820195658','structure_recurring_financial_operations_v82'),('20260821205630','reconcile_v82_production_access_contract')" >/dev/null
run_preflight_go "$real_legacy_db"
apply_file "$real_legacy_db" "$migration_one"
apply_file "$real_legacy_db" "$migration_two"
apply_file "$real_legacy_db" "$migration_three"
if psql_db "$real_legacy_db" -qc "insert into public.transactions(user_id,transaction_date,description,amount,transaction_type,status) values ('00000000-0000-0000-0000-000000000001',current_date,'Incomplete investment must fail',100,'investimento','realizado')" >/dev/null 2>&1; then
  echo "incomplete structured transaction unexpectedly succeeded" >&2
  exit 1
fi
if psql_db "$real_legacy_db" -qc "insert into public.recurring(user_id,name,type,amount) values ('00000000-0000-0000-0000-000000000001','Incomplete rescue must fail','resgate',100)" >/dev/null 2>&1; then
  echo "incomplete structured recurring rule unexpectedly succeeded" >&2
  exit 1
fi

constraint_drift_db="${databases[10]}"
create_v81_database "$constraint_drift_db"
psql_db "$constraint_drift_db" -qc "alter table public.transactions add constraint transactions_id_user_id_key unique(user_id,id)" >/dev/null
if apply_file "$constraint_drift_db" "$migration_one" 2>/dev/null; then
  echo "incompatible ownership constraint drift unexpectedly succeeded" >&2
  exit 1
fi
assert_sql "$constraint_drift_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='operation_id'" "0" "ownership drift failure rolls back all V82 writes"

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

echo "v82 production migration recovery: 15 scenarios and ${pgtap_assertions} pgTAP assertions passed"
