#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
baseline="$repo_root/supabase/migrations/20260820161844_local_v81_structural_baseline.sql"
preflight="$repo_root/supabase/production/preflight_v82.sql"
task_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-v82-preflight.XXXXXX")"
suffix="${BASHPID:-$$}"
databases=(
  "mb_v82_preflight_go_${suffix}"
  "mb_v82_preflight_column_${suffix}"
  "mb_v82_preflight_fk_${suffix}"
  "mb_v82_preflight_cross_user_${suffix}"
  "mb_v82_preflight_zero_${suffix}"
  "mb_v82_preflight_recurring_${suffix}"
  "mb_v82_preflight_partial_${suffix}"
  "mb_v82_preflight_rpc_${suffix}"
  "mb_v82_preflight_readonly_${suffix}"
)

cleanup() {
  for database in "${databases[@]}"; do
    if [[ "$database" == mb_v82_preflight_* ]]; then
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
  echo "refusing unexpected Docker project" >&2
  exit 1
fi

psql_db() {
  local database="$1"
  shift
  docker exec -i "$db_container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"
}

create_v81_database() {
  local database="$1"
  if [[ "$database" != mb_v82_preflight_* ]]; then
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
  psql_db "$database" < "$baseline" >/dev/null
  psql_db "$database" >/dev/null <<'SQL'
create table public.categories(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  name text not null,kind text not null default 'expense' check(kind in ('receita','despesa','income','expense'))
);
create table public.monthly_plans(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  year integer not null,month integer not null
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

run_go() {
  local database="$1"
  local output="$task_tmp_dir/${database}.out"
  if ! psql_db "$database" < "$preflight" >"$output" 2>&1; then
    sed -n '1,220p' "$output" >&2
    echo "compatible V81 preflight unexpectedly failed" >&2
    exit 1
  fi
  rg -q 'MB_V82_PREFLIGHT_RESULT=GO' "$output"
}

run_no_go() {
  local database="$1" expected="$2"
  local output="$task_tmp_dir/${database}.out"
  if psql_db "$database" < "$preflight" >"$output" 2>&1; then
    echo "NO-GO scenario unexpectedly passed: $expected" >&2
    exit 1
  fi
  if ! rg -q 'MB_V82_PREFLIGHT_RESULT=NO-GO' "$output" || ! rg -q "$expected" "$output"; then
    sed -n '1,220p' "$output" >&2
    echo "NO-GO output missing expected diagnostic: $expected" >&2
    exit 1
  fi
}

go_db="${databases[0]}"
create_v81_database "$go_db"
run_go "$go_db"

column_db="${databases[1]}"
create_v81_database "$column_db"
psql_db "$column_db" -qc "alter table public.transactions alter column status set not null" >/dev/null
run_no_go "$column_db" 'column:transactions.status:incompatible_contract'

fk_db="${databases[2]}"
create_v81_database "$fk_db"
psql_db "$fk_db" -qc "alter table public.recurring drop constraint recurring_account_id_fkey; alter table public.recurring add constraint recurring_account_id_fkey foreign key(account_id) references public.cards(id) on delete set null" >/dev/null
run_no_go "$fk_db" 'legacy_constraint:recurring.recurring_account_id_fkey:incompatible'

cross_user_db="${databases[3]}"
create_v81_database "$cross_user_db"
psql_db "$cross_user_db" >/dev/null <<'SQL'
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000001','synthetic-a@example.invalid'),
  ('00000000-0000-0000-0000-000000000002','synthetic-b@example.invalid');
insert into public.accounts(id,user_id,name)
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Synthetic A');
insert into public.transactions(user_id,transaction_date,description,amount,account_id)
values ('00000000-0000-0000-0000-000000000002',current_date,'Synthetic cross-user',10,'10000000-0000-0000-0000-000000000001');
SQL
run_no_go "$cross_user_db" 'ownership:transactions.account_id:cross_user'

zero_db="${databases[4]}"
create_v81_database "$zero_db"
psql_db "$zero_db" >/dev/null <<'SQL'
insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000001','synthetic@example.invalid');
insert into public.transactions(user_id,transaction_date,description,amount)
values ('00000000-0000-0000-0000-000000000001',current_date,'Synthetic zero',0);
SQL
run_no_go "$zero_db" 'legacy:transactions_nonpositive_amount'

recurring_db="${databases[5]}"
create_v81_database "$recurring_db"
psql_db "$recurring_db" >/dev/null <<'SQL'
insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000001','synthetic@example.invalid');
insert into public.recurring(user_id,name,type,amount)
values ('00000000-0000-0000-0000-000000000001','Synthetic investment','investment',100);
SQL
run_no_go "$recurring_db" 'legacy:recurring_incompatible_v82_shape'

partial_db="${databases[6]}"
create_v81_database "$partial_db"
psql_db "$partial_db" -qc "alter table public.accounts add column balance_as_of date" >/dev/null
run_no_go "$partial_db" 'migration_1:partial_or_incompatible_catalog_state'

rpc_db="${databases[7]}"
create_v81_database "$rpc_db"
psql_db "$rpc_db" >/dev/null <<'SQL'
create function public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)
returns public.transactions language sql security definer
as $$select null::public.transactions$$;
SQL
run_no_go "$rpc_db" 'rpc:create_transfer_v82:incompatible_contract_or_grants'

readonly_db="${databases[8]}"
create_v81_database "$readonly_db"
awk '{print; if ($0=="set local lock_timeout='\''5s'\'';") {print "insert into public.accounts(user_id,name) values (gen_random_uuid(),'\''must fail'\'');"; injected=1}} END {if(!injected) exit 2}' "$preflight" > "$task_tmp_dir/preflight-write-attempt.sql"
if psql_db "$readonly_db" < "$task_tmp_dir/preflight-write-attempt.sql" >"$task_tmp_dir/readonly.out" 2>&1; then
  echo "write attempt unexpectedly succeeded in read-only preflight" >&2
  exit 1
fi
rg -q 'cannot execute INSERT in a read-only transaction' "$task_tmp_dir/readonly.out"

echo "v82 production preflight: GO plus 8 explicit NO-GO/read-only scenarios passed"
