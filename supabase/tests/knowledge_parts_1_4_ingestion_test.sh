#!/usr/bin/env bash
set -euo pipefail

project_id="Mentoria-Black"
db_container="supabase_db_${project_id}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
commercial="$repo_root/supabase/migrations/20260822212119_commercial_access_v1.sql"
knowledge="$repo_root/supabase/migrations/20260823000450_knowledge_area_v1.sql"
editorial="$repo_root/supabase/migrations/20260823012822_extend_knowledge_editorial_contract_v1.sql"
access_tests="$repo_root/supabase/tests/knowledge_parts_1_4_access_test.sql"
source_document="${MB_KNOWLEDGE_PARTS_1_4:-$repo_root/.local-content/mentoria-black-partes-1-a-4.structured.json}"
suffix="${BASHPID:-$$}"
normal_db="mb_knowledge_parts_1_4_normal_${suffix}"
partial_db="mb_knowledge_parts_1_4_partial_${suffix}"
drift_db="mb_knowledge_parts_1_4_drift_${suffix}"
remote_db="mb_knowledge_remote_homologation_${suffix}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-knowledge-parts-1-4.XXXXXX")"
shell_assertions=0

cleanup(){
  for database in "$remote_db" "$drift_db" "$partial_db" "$normal_db";do
    case "$database" in mb_knowledge_parts_1_4_*|mb_knowledge_remote_homologation_*) docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1||true;;esac
  done
  case "$tmp_dir" in "${TMPDIR:-/tmp}"/mb-knowledge-parts-1-4.*) rm -rf "$tmp_dir";;esac
}
trap cleanup EXIT

[[ -f "$source_document" ]]
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

node "$repo_root/scripts/prepare-knowledge-import-sql.js" --input "$source_document" --output "$tmp_dir/import.sql" >/dev/null
expected_total="$(node -e "const d=require(process.argv[1]);console.log(d.parts.flatMap(p=>p.chapters.flatMap(c=>c.sections)).length)" "$source_document")"
expected_sample="$(node -e "const d=require(process.argv[1]);console.log(d.parts.flatMap(p=>p.chapters.flatMap(c=>c.sections)).filter(s=>s.access_level==='sample'||s.access_level==='public').length)" "$source_document")"

create_base "$normal_db"
psql_db "$normal_db" -qc "insert into auth.users(id,email,email_confirmed_at) select ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,format('synthetic-%s@example.invalid',n),now() from generate_series(1,6) n;insert into transactions(user_id,name) values('10000000-0000-0000-0000-000000000001','synthetic-preservation-row')" >/dev/null
apply_file "$normal_db" "$knowledge"
apply_file "$normal_db" "$editorial"
apply_file "$normal_db" "$editorial"
apply_file "$normal_db" "$tmp_dir/import.sql"
assert_sql "$normal_db" "select count(*) from transactions" "1" "financial fixture preserved after import"
assert_sql "$normal_db" "select concat_ws(',',(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))" "1,4,26,$expected_total" "canonical import counts"
assert_sql "$normal_db" "select count(*) from knowledge_sections where access_level in('public','sample')" "$expected_sample" "sample count"
apply_file "$normal_db" "$tmp_dir/import.sql"
assert_sql "$normal_db" "select concat_ws(',',(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))" "1,4,26,$expected_total" "import retry preserves counts"

psql_db "$normal_db" >/dev/null <<'SQL'
insert into access_grants(user_id,product_id,access_type,source,status,started_at,expires_at)
select '10000000-0000-0000-0000-000000000001',id,'trial','trial','active',now(),now()+interval '168 hours' from products where code='APP';
insert into access_grants(user_id,product_id,access_type,source,environment,status,started_at)
select grant_row.user_id,product.id,grant_row.access_type,grant_row.source,grant_row.environment,grant_row.status,now()
from (values
  ('10000000-0000-0000-0000-000000000002'::uuid,'KNOWLEDGE','lifetime','manual','legacy','active'),
  ('10000000-0000-0000-0000-000000000003'::uuid,'APP','lifetime','manual','legacy','active'),
  ('10000000-0000-0000-0000-000000000003'::uuid,'KNOWLEDGE','lifetime','manual','legacy','active'),
  ('10000000-0000-0000-0000-000000000004'::uuid,'KNOWLEDGE','lifetime','manual','legacy','revoked')
) grant_row(user_id,product_code,access_type,source,environment,status)
join products product on product.code=grant_row.product_code;
insert into access_grants(user_id,product_id,access_type,source,environment,status,started_at,expires_at,external_reference,external_subscription_id)
select '10000000-0000-0000-0000-000000000006',id,'paid','asaas','sandbox','active',now(),now()+interval '1 month','synthetic-app-paid','synthetic-subscription' from products where code='APP';
SQL

tap_output="$tmp_dir/access.tap"
psql_db "$normal_db" -v expected_total="$expected_total" -v expected_sample="$expected_sample" < "$access_tests" > "$tap_output"
if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' "$tap_output";then sed -n '1,260p' "$tap_output" >&2;exit 1;fi
pgtap_assertions="$(rg -c '^[[:space:]]*ok [0-9]+' "$tap_output")"

docker exec "$db_container" createdb -U postgres -T "$normal_db" "$drift_db"
psql_db "$drift_db" -qc "update knowledge_sections set content=jsonb_build_object('text','synthetic drift') where id=(select id from knowledge_sections order by id limit 1)" >/dev/null
if apply_file "$drift_db" "$tmp_dir/import.sql" 2>"$tmp_dir/drift.err";then echo 'incompatible content drift unexpectedly accepted' >&2;exit 1;fi
rg -q 'section contract drift' "$tmp_dir/drift.err"
shell_assertions=$((shell_assertions+1))

create_base "$partial_db"
apply_file "$partial_db" "$knowledge"
awk '{print;if($0 ~ /alter table public.knowledge_sections add constraint knowledge_sections_type_check/){armed=1}else if(armed&&/^\);$/){print "select 1/0;";armed=0}}' "$editorial" > "$tmp_dir/editorial-partial.sql"
if apply_file "$partial_db" "$tmp_dir/editorial-partial.sql" 2>/dev/null;then echo 'partial editorial migration unexpectedly succeeded' >&2;exit 1;fi
assert_sql "$partial_db" "select count(*) from pg_constraint where conrelid='knowledge_sections'::regclass and conname='knowledge_sections_type_check' and pg_get_constraintdef(oid) like '%subheading%'" "0" "partial editorial migration rolls back"
apply_file "$partial_db" "$editorial"
assert_sql "$partial_db" "select count(*) from pg_constraint where conrelid='knowledge_sections'::regclass and conname='knowledge_sections_type_check' and pg_get_constraintdef(oid) like '%exercise_black%'" "1" "editorial migration resumes after rollback"

content_version="$(node -e "console.log(require(process.argv[1]).editorial_metadata.content_version)" "$source_document")"
if [[ "$content_version" == "parts-1-4-v2" ]];then
  canonical_hash="$(node -e "console.log(require(process.argv[1]).editorial_metadata.canonical_hash)" "$source_document")"
  node "$repo_root/scripts/prepare-knowledge-import-sql.js" --input "$source_document" --output "$tmp_dir/remote-import.sql" \
    --target remote-beta --project-ref amzgqfvyjaiaoohnbcfl --canonical-hash "$canonical_hash" >/dev/null
  node "$repo_root/scripts/prepare-knowledge-homologation-rollback-sql.js" --input "$source_document" --output "$tmp_dir/remote-rollback.sql" \
    --project-ref amzgqfvyjaiaoohnbcfl >/dev/null
  create_base "$remote_db"
  apply_file "$remote_db" "$knowledge"
  apply_file "$remote_db" "$editorial"
  apply_file "$remote_db" "$tmp_dir/remote-import.sql"
  assert_sql "$remote_db" "select concat_ws(',',(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))" "1,4,26,$expected_total" "remote homologation import counts"
  apply_file "$remote_db" "$tmp_dir/remote-rollback.sql"
  assert_sql "$remote_db" "select concat_ws(',',(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections),(select count(*) from products))" "0,0,0,0,3" "remote homologation rollback preserves commercial schema"
  apply_file "$remote_db" "$tmp_dir/remote-import.sql"
  assert_sql "$remote_db" "select concat_ws(',',(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))" "1,4,26,$expected_total" "remote homologation final reimport counts"
fi

echo "knowledge parts 1-4 local clone: ${pgtap_assertions} pgTAP + ${shell_assertions} shell assertions; import, retry, rollback, drift, RLS and search passed"
