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
kiwify_contract="$repo_root/supabase/migrations/20260823104202_install_kiwify_webhook_v2_contract.sql"
knowledge="$repo_root/supabase/migrations/20260823000450_knowledge_area_v1.sql"
editorial="$repo_root/supabase/migrations/20260823012822_extend_knowledge_editorial_contract_v1.sql"
commercial_tests="$repo_root/supabase/tests/commercial_access_v1_test.sql"
remote_preflight="$repo_root/supabase/production/preflight_commercial_access_v2.sql"
source_document="${MB_KNOWLEDGE_PARTS_1_4:-$repo_root/.local-content/mentoria-black-partes-1-a-4.canonical-v2.json}"
suffix="${BASHPID:-$$}"
upgrade_db="mb_kiwify_upgrade_${suffix}"
partial_db="mb_kiwify_partial_${suffix}"
drift_db="mb_kiwify_drift_${suffix}"
absent_db="mb_kiwify_absent_${suffix}"
full_gate_db="mb_knowledge_parts_1_4_production_gate_${suffix}"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mb-kiwify-upgrade.XXXXXX")"
assertions=0

cleanup(){
  for database in "$upgrade_db" "$partial_db" "$drift_db" "$absent_db" "$full_gate_db"; do
    case "$database" in mb_kiwify_*|mb_knowledge_parts_1_4_production_gate_*) docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null 2>&1 || true;; esac
  done
  case "$tmp_dir" in "${TMPDIR:-/tmp}"/mb-kiwify-upgrade.*) rm -rf "$tmp_dir";; esac
}
trap cleanup EXIT

docker inspect "$db_container" >/dev/null
[[ "$(docker inspect "$db_container" --format '{{index .Config.Labels "com.supabase.cli.project"}}')" == "$project_id" ]]
[[ -f "$source_document" ]]
psql_db(){ local database="$1";shift;docker exec -i "$db_container" psql -U postgres -d "$database" -X -v ON_ERROR_STOP=1 "$@"; }
apply_file(){ psql_db "$1" <"$2" >/dev/null; }
assert_sql(){ local actual;actual="$(psql_db "$1" -Atqc "$2")";[[ "$actual" == "$3" ]]||{ echo "$4: expected '$3', got '$actual'" >&2;exit 1;};assertions=$((assertions+1)); }

create_v82_clone(){
  local database="$1"
  case "$database" in mb_kiwify_*) ;; *) echo "unsafe clone name" >&2;exit 1;; esac
  docker exec "$db_container" dropdb -U postgres --if-exists "$database" >/dev/null
  docker exec "$db_container" createdb -U postgres -T template0 "$database"
  psql_db "$database" >/dev/null <<'SQL'
create schema auth;
create schema extensions;
create schema vault;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
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
create table public.categories(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),name text not null,kind text default 'expense');
create table public.monthly_plans(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),year integer not null,month integer not null,revenue numeric not null default 0);
alter table public.categories enable row level security;
alter table public.monthly_plans enable row level security;
create policy categories_own_rows on public.categories for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy monthly_plans_own_rows on public.monthly_plans for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant all privileges on table public.accounts,public.cards,public.categories,public.goals,public.assets,public.liabilities,public.recurring,public.transactions,public.monthly_plans to anon,authenticated;
SQL
  apply_file "$database" "$v82_one"
  apply_file "$database" "$v82_two"
  apply_file "$database" "$v82_three"
}

create_kiwify_fixture(){
  local database="$1"
  create_v82_clone "$database"
  psql_db "$database" >/dev/null <<'SQL'
insert into auth.users(id,email,email_confirmed_at) values
 ('91000000-0000-4000-8000-000000000001','legacy-owner@example.invalid',now()),
 ('92000000-0000-4000-8000-000000000002','future-trial@example.invalid',now()),
 ('93000000-0000-4000-8000-000000000003','other-user@example.invalid',now()),
 ('98000000-0000-4000-8000-000000000008','kiwify-app@example.invalid',now());
insert into public.accounts(id,user_id,name) values('91100000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Synthetic legacy account');

create table public.products(
 id uuid primary key default gen_random_uuid(),name text not null,slug text not null unique,
 description text,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.access_grants(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),product_id uuid not null references public.products(id),
 status text not null default 'active',source text not null default 'manual',external_customer_id text,external_purchase_id text,
 started_at timestamptz not null default now(),expires_at timestamptz,revoked_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint access_grants_user_product_key unique(user_id,product_id),
 constraint access_grants_source_check check(source in('manual','kiwify')),
 constraint access_grants_status_check check(status in('active','suspended','revoked','expired'))
);
create table public.payment_events(
 id uuid primary key default gen_random_uuid(),provider text not null default 'kiwify',event_id text not null,event_type text not null,user_id uuid references auth.users(id) on delete set null,
 external_customer_id text,external_purchase_id text,payload jsonb not null,processed boolean not null default false,
 processed_at timestamptz,created_at timestamptz not null default now(),
 constraint payment_events_provider_check check(provider='kiwify'),
 constraint payment_events_provider_event_key unique(provider,event_id)
);
alter table public.products enable row level security;
alter table public.access_grants enable row level security;
alter table public.payment_events enable row level security;
create policy products_select_active on public.products for select to authenticated using(active=true);
create policy access_grants_select_own on public.access_grants for select to authenticated using(user_id=auth.uid());
create policy payment_events_no_client_access on public.payment_events for all to anon,authenticated using(false) with check(false);
grant select on public.products,public.access_grants to authenticated;

create function public.has_active_access(p_product_slug text default 'mentoria-black') returns boolean
language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.access_grants g join public.products p on p.id=g.product_id
  where g.user_id=auth.uid() and p.slug=p_product_slug and g.status='active'
    and (g.expires_at is null or g.expires_at>now()))
$$;
grant execute on function public.has_active_access(text) to authenticated;
create function public.get_kiwify_webhook_token() returns text
language sql security definer set search_path=public,vault as $$select null::text$$;
create function public.set_kiwify_webhook_token(p_token text) returns void
language plpgsql security definer set search_path=public,vault as $$begin perform length(p_token);end$$;
revoke all on function public.get_kiwify_webhook_token() from public,anon,authenticated;
revoke all on function public.set_kiwify_webhook_token(text) from public,anon,authenticated;
grant execute on function public.get_kiwify_webhook_token() to service_role;
grant execute on function public.set_kiwify_webhook_token(text) to service_role;

insert into public.products(id,name,slug,description) values('94000000-0000-4000-8000-000000000004','Legacy Mentoria Black','mentoria-black','Synthetic legacy product');
insert into public.access_grants(id,user_id,product_id,status,source,external_customer_id,external_purchase_id)
values('95000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000004','active','manual','customer-synthetic','purchase-synthetic');
insert into public.payment_events(id,event_id,event_type,user_id,external_customer_id,external_purchase_id,payload,processed,processed_at) values
 ('96000000-0000-4000-8000-000000000006','legacy-event-1','purchase_approved','91000000-0000-4000-8000-000000000001','customer-synthetic','purchase-synthetic',jsonb_build_object('fixture','legacy-one'),true,now()),
 ('97000000-0000-4000-8000-000000000007','legacy-event-2','subscription_renewed','91000000-0000-4000-8000-000000000001','customer-synthetic','purchase-synthetic',jsonb_build_object('fixture','legacy-two'),false,null);
SQL
}

create_kiwify_fixture "$upgrade_db"
# Exercise the exact legacy conflict/event contract in a rollback-only transaction.
psql_db "$upgrade_db" >/dev/null <<'SQL'
begin;
insert into public.payment_events(event_id,event_type,user_id,payload)
values('legacy-runtime-approved','purchase_approved','98000000-0000-4000-8000-000000000008','{"fixture":"approval"}')
on conflict(provider,event_id) do nothing;
insert into public.access_grants(user_id,product_id,status,source,external_purchase_id,expires_at)
select '98000000-0000-4000-8000-000000000008',id,'active','kiwify','legacy-runtime-purchase',now()+interval '30 days'
from public.products where slug='mentoria-black'
on conflict(user_id,product_id) do update set status='active',expires_at=excluded.expires_at;
-- Retry the same delivery and legacy grant upsert.
insert into public.payment_events(event_id,event_type,user_id,payload)
values('legacy-runtime-approved','purchase_approved','98000000-0000-4000-8000-000000000008','{"fixture":"approval"}')
on conflict(provider,event_id) do nothing;
insert into public.access_grants(user_id,product_id,status,source,external_purchase_id,expires_at)
select '98000000-0000-4000-8000-000000000008',id,'active','kiwify','legacy-runtime-purchase',now()+interval '60 days'
from public.products where slug='mentoria-black'
on conflict(user_id,product_id) do update set status='active',expires_at=excluded.expires_at;
do $legacy_writer_contract$
begin
  if (select count(*) from public.payment_events where event_id='legacy-runtime-approved')<>1
     or (select count(*) from public.access_grants where external_purchase_id='legacy-runtime-purchase')<>1 then
    raise exception 'legacy retry duplicated event or grant';
  end if;
  update public.access_grants set expires_at=now()+interval '90 days'
  where external_purchase_id='legacy-runtime-purchase';
  if not exists(select 1 from public.access_grants where external_purchase_id='legacy-runtime-purchase' and expires_at>now()+interval '89 days') then
    raise exception 'legacy renewal failed';
  end if;
  update public.access_grants set status='active' where external_purchase_id='legacy-runtime-purchase';
  if not exists(select 1 from public.access_grants where external_purchase_id='legacy-runtime-purchase' and status='active') then
    raise exception 'legacy cancellation changed access early';
  end if;
  update public.access_grants set status='revoked',revoked_at=now() where external_purchase_id='legacy-runtime-purchase';
  if not exists(select 1 from public.access_grants where external_purchase_id='legacy-runtime-purchase' and status='revoked') then
    raise exception 'legacy refund revocation failed';
  end if;
  update public.access_grants set status='active',revoked_at=null where external_purchase_id='legacy-runtime-purchase';
  update public.access_grants set status='revoked',revoked_at=now() where external_purchase_id='legacy-runtime-purchase';
  if not exists(select 1 from public.access_grants where external_purchase_id='legacy-runtime-purchase' and status='revoked') then
    raise exception 'legacy chargeback revocation failed';
  end if;
end
$legacy_writer_contract$;
rollback;
SQL
assertions=$((assertions+6))
node "$repo_root/scripts/prepare-knowledge-import-sql.js" --input "$source_document" --output "$tmp_dir/knowledge-import.sql" >/dev/null
[[ "$(node -e "const d=require(process.argv[1]);process.stdout.write(d.editorial_metadata.content_version)" "$source_document")" == "parts-1-4-v2" ]]
[[ "$(node -e "const d=require(process.argv[1]);process.stdout.write(d.editorial_metadata.canonical_hash)" "$source_document")" == "9c9d90e12ea90f36ea85da291091ab9bb49b76590d9638c856f936dd41a670ad" ]]
psql_db "$upgrade_db" <"$remote_preflight" >"$tmp_dir/remote-preflight.out"
rg -q 'KIWIFY_LEGACY_GO' "$tmp_dir/remote-preflight.out";assertions=$((assertions+1))
if rg -q '@example|customer-synthetic|purchase-synthetic|legacy-event' "$tmp_dir/remote-preflight.out";then
  echo "remote preflight exposed synthetic personal or payment identifiers" >&2;exit 1
fi
assertions=$((assertions+1))
awk '{print;if($0=="set local statement_timeout='\''2min'\'';"){print "update public.products set active=active;";injected=1}}END{if(!injected)exit 2}' "$remote_preflight" >"$tmp_dir/preflight-write-attempt.sql"
if psql_db "$upgrade_db" <"$tmp_dir/preflight-write-attempt.sql" >"$tmp_dir/preflight-write.out" 2>"$tmp_dir/preflight-write.err";then
  echo "read-only preflight write injection unexpectedly succeeded" >&2;exit 1
fi
rg -q 'read-only transaction' "$tmp_dir/preflight-write.err";assertions=$((assertions+1))
assert_sql "$upgrade_db" "select count(*) from products" "1" "preflight read-only transaction blocks injected writes"
payload_before="$(psql_db "$upgrade_db" -Atqc "select md5(string_agg(id::text||payload::text,'|' order by id)) from payment_events")"
product_legacy_before="$(psql_db "$upgrade_db" -Atqc "select md5(row_to_json(row_data)::text) from(select id,name,slug,description,active,created_at,updated_at from products) row_data")"
grant_legacy_before="$(psql_db "$upgrade_db" -Atqc "select md5(row_to_json(row_data)::text) from(select id,user_id,product_id,status,source,external_customer_id,external_purchase_id,started_at,expires_at,revoked_at,created_at,updated_at from access_grants) row_data")"
events_legacy_before="$(psql_db "$upgrade_db" -Atqc "select md5(string_agg(row_to_json(row_data)::text,'|' order by id)) from(select id,provider,event_id,event_type,user_id,external_customer_id,external_purchase_id,payload,processed,processed_at,created_at from payment_events order by id) row_data")"
kiwify_function_before="$(psql_db "$upgrade_db" -Atqc "select md5(pg_get_functiondef('public.set_kiwify_webhook_token(text)'::regprocedure))")"
apply_file "$upgrade_db" "$commercial"
apply_file "$upgrade_db" "$kiwify_contract"

docker exec "$db_container" dropdb -U postgres --if-exists "$full_gate_db" >/dev/null
docker exec "$db_container" createdb -U postgres -T "$upgrade_db" "$full_gate_db"
apply_file "$full_gate_db" "$knowledge"
apply_file "$full_gate_db" "$editorial"
apply_file "$full_gate_db" "$tmp_dir/knowledge-import.sql"
assert_sql "$full_gate_db" "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events),(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections),(select count(*) from knowledge_sections where access_level='sample'),(select count(*) from knowledge_sections where access_level='knowledge'))" "3,1,2,1,4,26,1469,67,1402" "faithful production chain preserves Kiwify and imports canonical Knowledge"
assert_sql "$full_gate_db" "select count(*) from knowledge_sections where coalesce(metadata->>'source_hash','')~'^[0-9a-f]{64}$'" "1469" "every imported section retains its source hash"
assert_sql "$full_gate_db" "select count(*) from pg_policies where schemaname='public' and tablename like 'knowledge_%'" "13" "Knowledge RLS policy contract is complete"
assert_sql "$full_gate_db" "select ((select enforced from commercial_enforcement_state where singleton)=false and (select count(*) from pg_policies where schemaname='public' and policyname='mb_v82_own_rows')=9)::text" "true" "financial enforcement remains disabled after the complete chain"
assert_sql "$full_gate_db" "select (to_regprocedure('public.set_kiwify_webhook_token(text)') is not null and (select count(*) from payment_events where provider='kiwify' and environment='legacy' and payload is not null)=2)::text" "true" "Kiwify RPC and historical payloads survive the complete chain"
apply_file "$full_gate_db" "$commercial"
apply_file "$full_gate_db" "$kiwify_contract"
apply_file "$full_gate_db" "$knowledge"
apply_file "$full_gate_db" "$editorial"
apply_file "$full_gate_db" "$tmp_dir/knowledge-import.sql"
assert_sql "$full_gate_db" "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events),(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))" "3,1,2,1,4,26,1469" "complete package retry is idempotent"
psql_db "$full_gate_db" >/dev/null <<'SQL'
begin;
do $rollback_gate$
declare v_publication_id uuid;v_parts integer;v_chapters integer;v_sections integer;
begin
  select id into strict v_publication_id from public.knowledge_publications where slug='mentoria-black' and version='parts-1-4-v2';
  select count(*) into v_parts from public.knowledge_parts where publication_id=v_publication_id;
  select count(*) into v_chapters from public.knowledge_chapters where publication_id=v_publication_id;
  select count(*) into v_sections from public.knowledge_sections section join public.knowledge_chapters chapter on chapter.id=section.chapter_id where chapter.publication_id=v_publication_id;
  if v_parts<>4 or v_chapters<>26 or v_sections<>1469 then
    raise exception 'selective rollback refuses content count drift' using errcode='P0001';
  end if;
  delete from public.knowledge_publications where id=v_publication_id;
end
$rollback_gate$;
commit;
SQL
assert_sql "$full_gate_db" "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events),(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))" "3,1,2,0,0,0,0" "selective Knowledge rollback preserves the reconciled commercial layer"
apply_file "$full_gate_db" "$tmp_dir/knowledge-import.sql"
assert_sql "$full_gate_db" "select concat_ws(',',(select count(*) from knowledge_publications),(select count(*) from knowledge_parts),(select count(*) from knowledge_chapters),(select count(*) from knowledge_sections))" "1,4,26,1469" "canonical Knowledge content reimports after selective rollback"

assert_sql "$upgrade_db" "select count(*) from products" "3" "catalog keeps APP and adds KNOWLEDGE/COMPLETE"
assert_sql "$upgrade_db" "select id::text||':'||code||':'||slug from products where id='94000000-0000-4000-8000-000000000004'" "94000000-0000-4000-8000-000000000004:APP:mentoria-black" "legacy product identity and slug are preserved"
assert_sql "$upgrade_db" "select count(*) from access_grants" "1" "legacy grant count is preserved"
assert_sql "$upgrade_db" "select id::text||':'||source||':'||access_type||':'||environment from access_grants" "95000000-0000-4000-8000-000000000005:manual:manual:legacy" "production-equivalent manual grant is enriched in place"
assert_sql "$upgrade_db" "select count(*) from payment_events" "2" "legacy event count is preserved"
assert_sql "$upgrade_db" "select count(*) from information_schema.columns where table_schema='public' and ((table_name='products' and column_name in('created_at','updated_at')) or (table_name='access_grants' and column_name in('created_at','updated_at')) or (table_name='payment_events' and column_name='created_at')) and is_nullable='NO'" "5" "production timestamp NOT NULL contracts are preserved"
assert_sql "$upgrade_db" "select md5(string_agg(id::text||payload::text,'|' order by id)) from payment_events" "$payload_before" "legacy raw payloads are byte-semantically preserved"
assert_sql "$upgrade_db" "select md5(row_to_json(row_data)::text) from(select id,name,slug,description,active,created_at,updated_at from products where id='94000000-0000-4000-8000-000000000004') row_data" "$product_legacy_before" "all legacy product fields are preserved"
assert_sql "$upgrade_db" "select md5(row_to_json(row_data)::text) from(select id,user_id,product_id,status,source,external_customer_id,external_purchase_id,started_at,expires_at,revoked_at,created_at,updated_at from access_grants where id='95000000-0000-4000-8000-000000000005') row_data" "$grant_legacy_before" "all legacy grant fields are preserved"
assert_sql "$upgrade_db" "select md5(string_agg(row_to_json(row_data)::text,'|' order by id)) from(select id,provider,event_id,event_type,user_id,external_customer_id,external_purchase_id,payload,processed,processed_at,created_at from payment_events where id in('96000000-0000-4000-8000-000000000006','97000000-0000-4000-8000-000000000007') order by id) row_data" "$events_legacy_before" "all legacy event fields are preserved"
assert_sql "$upgrade_db" "select count(*) from payment_events where environment='legacy' and external_event_id=event_id and payload_hash~'^[0-9a-f]{64}$'" "2" "legacy events receive canonical metadata"
assert_sql "$upgrade_db" "select md5(pg_get_functiondef('public.set_kiwify_webhook_token(text)'::regprocedure))" "$kiwify_function_before" "Kiwify Vault RPC body is unchanged"
assert_sql "$upgrade_db" "select has_function_privilege('authenticated','public.set_kiwify_webhook_token(text)','EXECUTE')" "f" "Kiwify secret RPC is not client-executable"
assert_sql "$upgrade_db" "set role authenticated;set request.jwt.claim.sub='91000000-0000-4000-8000-000000000001';select public.has_active_access()||':'||public.has_active_access('APP');reset role" "true:true" "legacy slug and V2 code both resolve access"
assert_sql "$upgrade_db" "set role authenticated;set request.jwt.claim.sub='91000000-0000-4000-8000-000000000001';select count(*) from access_grants;reset role" "1" "legacy owner reads own grant"
assert_sql "$upgrade_db" "set role authenticated;set request.jwt.claim.sub='93000000-0000-4000-8000-000000000003';select count(*) from access_grants;reset role" "0" "cross-user grant read is rejected"
assert_sql "$upgrade_db" "select count(*) from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='u' and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['user_id','product_id']::name[]" "0" "legacy user-product unique is removed"

psql_db "$upgrade_db" >/dev/null <<'SQL'
update public.commercial_offers set provider='kiwify',external_offer_id='offer-app-monthly',active=true where code='APP_MONTHLY';
update public.commercial_offers set provider='kiwify',external_offer_id='offer-knowledge',active=true where code='KNOWLEDGE_LIFETIME';
update public.commercial_offers set provider='kiwify',external_offer_id='offer-complete',active=true where code='COMPLETE_MONTHLY';
SQL
assert_sql "$upgrade_db" "set role service_role;select public.get_kiwify_webhook_contract_v2();reset role" "commercial_access_v2_kiwify_webhook_v1" "dual writer detects the explicit V2 contract"
assert_sql "$upgrade_db" "set role service_role;select public.resolve_kiwify_product_v2(null,'Mentoria Black');reset role" "APP" "legacy product name maps only to APP"
assert_sql "$upgrade_db" "set role service_role;select public.resolve_kiwify_product_v2('offer-knowledge','ignored');reset role" "KNOWLEDGE" "configured Kiwify offer maps to KNOWLEDGE"
assert_sql "$upgrade_db" "set role service_role;select public.resolve_kiwify_product_v2('offer-complete','ignored');reset role" "COMPLETE" "configured Kiwify offer maps to COMPLETE"

assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-app-approved','purchase_approved','activate','98000000-0000-4000-8000-000000000008','APP','customer-app','purchase-app-1','subscription-app-1',statement_timestamp()+interval '30 days',repeat('1',64))->>'status';reset role" "processed" "Kiwify APP approval is processed"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-app-approved','purchase_approved','activate','98000000-0000-4000-8000-000000000008','APP','customer-app','purchase-app-1','subscription-app-1',statement_timestamp()+interval '30 days',repeat('1',64))->>'duplicate';reset role" "true" "same Kiwify event is idempotent"
assert_sql "$upgrade_db" "select count(*) from access_grants g join products p on p.id=g.product_id where g.user_id='98000000-0000-4000-8000-000000000008' and p.code='APP' and g.source='kiwify' and g.status='active'" "1" "APP approval creates one active Kiwify grant"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-app-renewal','subscription_renewed','renewal','98000000-0000-4000-8000-000000000008','APP','customer-app','purchase-app-2','subscription-app-1',statement_timestamp()+interval '60 days',repeat('2',64))->>'status';reset role" "processed" "renewal updates the eligible APP grant"
assert_sql "$upgrade_db" "select count(*) from access_grants g join products p on p.id=g.product_id where g.user_id='98000000-0000-4000-8000-000000000008' and p.code='APP' and g.source='kiwify' and g.status='active'" "1" "renewal does not duplicate active APP grants"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-app-partial','purchase_partially_refunded','partial_refund',null,null,null,'purchase-app-2','subscription-app-1',null,repeat('3',64))->>'status';reset role" "administrative_review" "partial refund requires administrative review"
assert_sql "$upgrade_db" "select status from access_grants where source='kiwify' and external_subscription_id='subscription-app-1'" "active" "partial refund does not change the grant"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-app-late','subscription_late','late',null,null,null,'purchase-app-1','subscription-app-1',null,repeat('4',64))->>'status';reset role" "processed" "late subscription enters grace"
assert_sql "$upgrade_db" "select (status='grace_period' and grace_until>statement_timestamp())::text from access_grants where source='kiwify' and external_subscription_id='subscription-app-1'" "true" "APP grace remains available for 72 hours"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-app-cancel','subscription_canceled','cancel',null,null,null,'purchase-app-1','subscription-app-1',statement_timestamp()+interval '45 days',repeat('5',64))->>'status';reset role" "processed" "cancellation preserves the paid period"
assert_sql "$upgrade_db" "select (expires_at>statement_timestamp() and status='active')::text from access_grants where source='kiwify' and external_subscription_id='subscription-app-1'" "true" "cancellation keeps APP active until expiry"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-app-expire','subscription_expired','expire',null,null,null,'purchase-app-1','subscription-app-1',null,repeat('6',64))->>'status';reset role" "processed" "expiration is processed"
assert_sql "$upgrade_db" "select status from access_grants where source='kiwify' and external_subscription_id='subscription-app-1'" "expired" "expiration blocks only the APP grant"

assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-complete-approved','purchase_approved','activate','91000000-0000-4000-8000-000000000001','COMPLETE','customer-complete','purchase-complete-1','subscription-complete-1',statement_timestamp()+interval '30 days',repeat('7',64))->>'status';reset role" "processed" "COMPLETE approval is atomic"
assert_sql "$upgrade_db" "select string_agg(p.code||':'||g.access_type||':'||g.status,',' order by p.code) from access_grants g join products p on p.id=g.product_id where g.user_id='91000000-0000-4000-8000-000000000001' and g.source='kiwify' and g.external_reference='purchase-complete-1'" "APP:paid:active,KNOWLEDGE:lifetime:active" "COMPLETE creates independent APP and KNOWLEDGE grants"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-complete-cancel','subscription_canceled','cancel',null,null,null,'purchase-complete-1','subscription-complete-1',statement_timestamp()+interval '20 days',repeat('8',64))->>'status';reset role" "processed" "COMPLETE cancellation is processed"
assert_sql "$upgrade_db" "select status from access_grants g join products p on p.id=g.product_id where g.external_reference='purchase-complete-1' and p.code='KNOWLEDGE'" "active" "COMPLETE cancellation preserves KNOWLEDGE lifetime"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-complete-chargeback','chargeback','chargeback',null,null,null,'purchase-complete-1','subscription-complete-1',null,repeat('9',64))->>'status';reset role" "processed" "chargeback is processed"
assert_sql "$upgrade_db" "select string_agg(p.code||':'||g.status,',' order by p.code) from access_grants g join products p on p.id=g.product_id where g.external_reference='purchase-complete-1'" "APP:chargeback,KNOWLEDGE:chargeback" "initial COMPLETE chargeback revokes both linked grants"

assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-knowledge-approved','purchase_approved','activate','93000000-0000-4000-8000-000000000003','KNOWLEDGE','customer-knowledge','purchase-knowledge-1',null,null,repeat('a',64))->>'status';reset role" "processed" "KNOWLEDGE purchase grants lifetime access"
assert_sql "$upgrade_db" "select access_type||':'||status from access_grants g join products p on p.id=g.product_id where g.external_reference='purchase-knowledge-1' and p.code='KNOWLEDGE'" "lifetime:active" "KNOWLEDGE is independent from APP"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-knowledge-refund','purchase_refunded','refund',null,null,null,'purchase-knowledge-1',null,null,repeat('b',64))->>'status';reset role" "processed" "full refund is processed"
assert_sql "$upgrade_db" "select status from access_grants where external_reference='purchase-knowledge-1'" "refunded" "full refund revokes the linked KNOWLEDGE grant"
assert_sql "$upgrade_db" "set role service_role;select process_kiwify_webhook_event_v2('kw-out-of-order','subscription_canceled','cancel',null,null,null,'purchase-unknown','subscription-unknown',null,repeat('c',64))->>'status';reset role" "administrative_review" "out-of-order event fails closed for review"
assert_sql "$upgrade_db" "select count(*) from payment_events where provider='kiwify' and environment='production' and external_event_id like 'kw-%' and payload is not null" "0" "new V2 Kiwify events never persist raw payloads"
assert_sql "$upgrade_db" "select count(*) from (select user_id,product_id,count(*) from access_grants where source='kiwify' and status in('active','grace_period') group by user_id,product_id having count(*)>1) duplicate" "0" "no conflicting active Kiwify grants exist"

# Restore the base test contract: the synthetic Kiwify mappings exercise the
# writer, but no commercial offer remains enabled without approved pricing.
psql_db "$upgrade_db" -qc "update public.commercial_offers set active=false where provider='kiwify'" >/dev/null

assert_sql "$upgrade_db" "set role authenticated;set request.jwt.claim.sub='92000000-0000-4000-8000-000000000002';select result from start_my_app_trial();reset role" "started" "trial is accepted after Kiwify upgrade"
psql_db "$upgrade_db" -qc "update product_trials set state='expired',started_at=statement_timestamp()-interval '168 hours',expires_at=statement_timestamp() where user_id='92000000-0000-4000-8000-000000000002';update access_grants set status='expired',started_at=statement_timestamp()-interval '168 hours',expires_at=statement_timestamp() where user_id='92000000-0000-4000-8000-000000000002' and access_type='trial';insert into access_grants(user_id,product_id,access_type,source,environment,status,external_reference,external_subscription_id,expires_at) select '92000000-0000-4000-8000-000000000002',id,'paid','asaas','sandbox','active','synthetic-paid-after-trial','sub-synthetic',statement_timestamp()+interval '30 days' from products where code='APP'" >/dev/null
assert_sql "$upgrade_db" "select count(*) from access_grants g join products p on p.id=g.product_id where g.user_id='92000000-0000-4000-8000-000000000002' and p.code='APP'" "2" "expired trial and later paid grant coexist"
assert_sql "$upgrade_db" "set role authenticated;set request.jwt.claim.sub='92000000-0000-4000-8000-000000000002';select public.has_active_access('APP');reset role" "t" "paid grant authorizes after trial history"

psql_db "$upgrade_db" -qc "insert into payment_events(provider,environment,external_event_id,event_type,payload_hash) values('asaas','sandbox','same-event','PAYMENT_CONFIRMED',repeat('a',64)),('asaas','production','same-event','PAYMENT_CONFIRMED',repeat('b',64));insert into payment_events(provider,event_id,event_type,payload) values('kiwify','legacy-writer-event','purchase_approved',jsonb_build_object('fixture','new-legacy-writer'));insert into access_grants(user_id,product_id,status,source,external_customer_id,external_purchase_id) select '93000000-0000-4000-8000-000000000003',id,'active','kiwify','customer-new-synthetic','purchase-new-synthetic' from products where code='APP'" >/dev/null
assert_sql "$upgrade_db" "select count(*) from payment_events where provider='asaas' and external_event_id='same-event'" "2" "same provider event id is isolated by environment"
assert_sql "$upgrade_db" "select count(*) from payment_events where provider='asaas' and payload is null" "2" "new events require no raw payload"
assert_sql "$upgrade_db" "select environment||':'||(payload_hash~'^[0-9a-f]{64}$')::text from payment_events where event_id='legacy-writer-event'" "production:true" "legacy Kiwify insert contract remains normalized"
psql_db "$upgrade_db" -qc "update payment_events set processed=true,processed_at=clock_timestamp() where event_id='legacy-writer-event'" >/dev/null
assert_sql "$upgrade_db" "select status||':'||processed::text from payment_events where event_id='legacy-writer-event'" "processed:true" "legacy Kiwify processed update stays synchronized"
assert_sql "$upgrade_db" "select g.source||':'||g.access_type||':'||g.environment||':'||(g.external_reference=g.external_purchase_id)::text from access_grants g join products p on p.id=g.product_id where g.user_id='93000000-0000-4000-8000-000000000003' and p.code='APP'" "kiwify:paid:production:true" "legacy Kiwify grant insert contract remains normalized"
if psql_db "$upgrade_db" -qc "insert into payment_events(provider,environment,external_event_id,event_type,payload_hash) values('asaas','sandbox','same-event','PAYMENT_RECEIVED',repeat('c',64))" 2>"$tmp_dir/replay.err";then echo "same-environment replay unexpectedly succeeded" >&2;exit 1;fi
rg -q 'duplicate key value' "$tmp_dir/replay.err";assertions=$((assertions+1))

test_output="$(psql_db "$upgrade_db" <"$commercial_tests")"
if rg -q '^[[:space:]]*(not ok|# Looks like you failed)' <<<"$test_output";then echo "$test_output" >&2;exit 1;fi
pgtap_count="$(rg -c 'ok [0-9]+ -' <<<"$test_output")"

counts_before_retry="$(psql_db "$upgrade_db" -Atqc "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events))")"
apply_file "$upgrade_db" "$commercial"
apply_file "$upgrade_db" "$kiwify_contract"
assert_sql "$upgrade_db" "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events))" "$counts_before_retry" "semantic V2 retry preserves every row"
psql_db "$upgrade_db" -qc "drop index access_grants_one_trial_uidx;create unique index access_grants_one_trial_uidx on access_grants(id)" >/dev/null
if apply_file "$upgrade_db" "$commercial" 2>"$tmp_dir/v2-index-drift.err";then echo "semantic retry accepted an incompatible V2 index" >&2;exit 1;fi
rg -q 'V2 unique-index semantics differ' "$tmp_dir/v2-index-drift.err";assertions=$((assertions+1))
assert_sql "$upgrade_db" "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events))" "$counts_before_retry" "V2 drift refusal changes no rows"

create_kiwify_fixture "$partial_db"
awk '{print;if($0=="$reconcile_payment_events$;"){print "select 1/0;";injected=1}}END{if(!injected)exit 2}' "$commercial" >"$tmp_dir/partial.sql"
if apply_file "$partial_db" "$tmp_dir/partial.sql" 2>/dev/null;then echo "partial Kiwify upgrade unexpectedly succeeded" >&2;exit 1;fi
assert_sql "$partial_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='products' and column_name='code'" "0" "partial upgrade rolls back schema evolution"
assert_sql "$partial_db" "select concat_ws(',',(select count(*) from products),(select count(*) from access_grants),(select count(*) from payment_events))" "1,1,2" "partial upgrade rolls back all data changes"

create_kiwify_fixture "$drift_db"
psql_db "$drift_db" -qc "create policy unexpected_products_read on products for select to authenticated using(true)" >/dev/null
if psql_db "$drift_db" <"$remote_preflight" >"$tmp_dir/remote-policy-drift.out" 2>"$tmp_dir/remote-policy-drift.err";then echo "remote preflight accepted duplicate policy drift" >&2;exit 1;fi
rg -q 'unexpected or duplicate legacy policy' "$tmp_dir/remote-policy-drift.err";assertions=$((assertions+1))
if apply_file "$drift_db" "$commercial" 2>"$tmp_dir/policy-drift.err";then echo "migration accepted duplicate policy drift" >&2;exit 1;fi
rg -q 'unexpected or duplicate legacy policy' "$tmp_dir/policy-drift.err";assertions=$((assertions+1))
psql_db "$drift_db" -qc "drop policy unexpected_products_read on products" >/dev/null
psql_db "$drift_db" -qc "alter table products add column unknown_commercial_flag boolean" >/dev/null
if psql_db "$drift_db" <"$remote_preflight" >"$tmp_dir/remote-drift.out" 2>"$tmp_dir/remote-drift.err";then echo "remote preflight accepted Kiwify drift" >&2;exit 1;fi
rg -q 'products shape drift' "$tmp_dir/remote-drift.err";assertions=$((assertions+1))
if apply_file "$drift_db" "$commercial" 2>"$tmp_dir/drift.err";then echo "unknown Kiwify drift unexpectedly accepted" >&2;exit 1;fi
rg -q 'public.products columns differ' "$tmp_dir/drift.err";assertions=$((assertions+1))
assert_sql "$drift_db" "select count(*) from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='access_type'" "0" "drift NO-GO creates no partial V2 columns"

# Exact Beta-style state: Commercial V2 exists but no legacy Kiwify Vault RPCs.
create_v82_clone "$absent_db"
apply_file "$absent_db" "$commercial"
psql_db "$absent_db" >/dev/null <<'SQL'
create table vault.secrets(
  id uuid primary key default gen_random_uuid(),secret text not null,name text unique,description text
);
create view vault.decrypted_secrets as select id,secret as decrypted_secret,name,description from vault.secrets;
create function vault.create_secret(new_secret text,new_name text,new_description text,new_key_id uuid default null)
returns uuid language plpgsql as $$declare v_id uuid;begin insert into vault.secrets(secret,name,description) values(new_secret,new_name,new_description) returning id into v_id;return v_id;end$$;
create function vault.update_secret(secret_id uuid,new_secret text,new_name text,new_description text,new_key_id uuid default null)
returns void language plpgsql as $$begin update vault.secrets set secret=new_secret,name=new_name,description=new_description where id=secret_id;end$$;
SQL
apply_file "$absent_db" "$kiwify_contract"
assert_sql "$absent_db" "select (to_regprocedure('public.get_kiwify_webhook_token()') is not null and to_regprocedure('public.set_kiwify_webhook_token(text)') is not null)::text" "true" "Beta-style installation creates the guarded Vault contract"
if psql_db "$absent_db" -v ON_ERROR_STOP=1 -qc "set role service_role;select public.set_kiwify_webhook_token(repeat('w',31));reset role" 2>"$tmp_dir/weak-v2-token.err";then
  echo "V2 setter accepted a token shorter than 32 characters" >&2
  exit 1
fi
rg -q 'invalid webhook token' "$tmp_dir/weak-v2-token.err";assertions=$((assertions+1))
assert_sql "$absent_db" "set role service_role;with configured as (select public.set_kiwify_webhook_token(repeat('s',32))) select length(public.get_kiwify_webhook_token()) from configured;reset role" "32" "Beta-style Vault token remains server-only and retrievable"
assert_sql "$absent_db" "select (not has_function_privilege('authenticated','public.get_kiwify_webhook_token()','EXECUTE') and not has_function_privilege('authenticated','public.set_kiwify_webhook_token(text)','EXECUTE'))::text" "true" "clients cannot read or rotate the Kiwify token"
apply_file "$absent_db" "$kiwify_contract"
assert_sql "$absent_db" "select count(*) from vault.secrets where name='kiwify_webhook_token'" "1" "Beta-style contract retry preserves the configured token"

echo "commercial Kiwify upgrade: ${pgtap_count} pgTAP + ${assertions} shell assertions; 1/1/2 legacy rows preserved"
