#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
commercial_migration="$repo_root/supabase/migrations/20260822212119_commercial_access_v1.sql"
admin_migration="$repo_root/supabase/migrations/20260826163317_admin_access_control_v1.sql"
security_migration="$repo_root/supabase/migrations/20260826184604_account_security_v1.sql"
duration_migration="$repo_root/supabase/migrations/20260826212109_admin_license_durations_v1.sql"
password_migration="$repo_root/supabase/migrations/20260826222112_admin_password_management_v1.sql"
dashboard_migration="$repo_root/supabase/migrations/20260826233601_admin_management_dashboard_v1.sql"
drilldown_migration="$repo_root/supabase/migrations/20260827121925_admin_management_drilldown_v1.sql"
privacy_migration="$repo_root/supabase/migrations/20260827162533_admin_private_reasons_v1.sql"
privacy_tests="$repo_root/supabase/tests/admin_private_reasons_v1_test.sql"
suffix="${BASHPID:-$$}"
database="aviora_admin_private_reasons_v1_${suffix}"

cleanup() {
  case "$database" in
    aviora_admin_private_reasons_v1_*)
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
returns uuid language sql stable as $$
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
      'name text)', v_table
    );
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'create policy mb_v82_own_rows on public.%I for all to authenticated '
      'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      v_table
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_table);
  end loop;
end
$tables$;
SQL

psql_db < "$commercial_migration" >/dev/null
psql_db < "$admin_migration" >/dev/null
psql_db < "$security_migration" >/dev/null
psql_db < "$duration_migration" >/dev/null
psql_db < "$password_migration" >/dev/null
psql_db < "$dashboard_migration" >/dev/null
psql_db < "$drilldown_migration" >/dev/null

# These fixtures deliberately predate the privacy migration so its idempotent
# cleanup path is exercised in addition to the write-time trigger.
psql_db >/dev/null <<'SQL'
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001','owner@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000002','staff@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000003','limited@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000004','active@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000005','revoked@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000006','monthly@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000007','annual@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000008','lifetime@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000009','trial@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000010','commercial@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000011','legacy@example.invalid',clock_timestamp(),'{}'),
  ('a1000000-0000-4000-8000-000000000012','bootstrap@example.invalid',clock_timestamp(),'{}');

select public.admin_bootstrap_first_owner_v1(
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'Bootstrap OWNER privacy fixture', repeat('1',64)
);
select public.admin_add_staff_v1(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  array['users.read','licenses.read','licenses.grant','licenses.revoke'],
  'Authorized STAFF privacy fixture',
  'b1000000-0000-4000-8000-000000000002', repeat('2',64)
);
select public.admin_add_staff_v1(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000003',
  array['users.read'],
  'Limited STAFF privacy fixture',
  'b1000000-0000-4000-8000-000000000003', repeat('3',64)
);
select public.admin_grant_customer_license_v1(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000004', array['APP'], 'monthly',
  'Internal active reason before privacy migration',
  'b1000000-0000-4000-8000-000000000011', repeat('a',64)
);
select public.admin_grant_customer_license_v1(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000005', array['KNOWLEDGE'], 'annual',
  'Internal grant reason before revocation',
  'b1000000-0000-4000-8000-000000000012', repeat('b',64)
);
select public.admin_revoke_customer_license_v1(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000005',
  (select id from public.access_grants where user_id='a1000000-0000-4000-8000-000000000005'),
  'Internal revocation reason before privacy migration',
  'b1000000-0000-4000-8000-000000000013', repeat('c',64)
);
select * from public.admin_grant_commercial_access_v1(
  'a1000000-0000-4000-8000-000000000010', array['APP'], 'manual',
  clock_timestamp()+interval '1 day',
  'a1000000-0000-4000-8000-000000000001',
  'Legacy internal grant reason before privacy migration'
);
select public.admin_revoke_commercial_access_v1(
  (select id from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000010' and source='manual'),
  'a1000000-0000-4000-8000-000000000001',
  'Legacy internal revocation reason before privacy migration'
);
SQL

psql_db < "$privacy_migration" >/dev/null
test_output="$(psql_db < "$privacy_tests")"

if rg -n '^[[:space:]]*(not ok|# Looks like you failed)' <<<"$test_output" >/dev/null; then
  printf '%s\n' "$test_output" >&2
  exit 1
fi
if ! rg -q '^[[:space:]]*ok [0-9]+' <<<"$test_output"; then
  printf '%s\n' "$test_output" >&2
  echo "admin private reasons pgTAP produced no successful assertions" >&2
  exit 1
fi

assertions="$(rg -c '^[[:space:]]*ok [0-9]+' <<<"$test_output")"
echo "AVIORA admin private reasons: ${assertions} pgTAP assertions passed in an isolated local database"
