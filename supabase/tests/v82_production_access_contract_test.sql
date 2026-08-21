begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select results_eq($$
  select count(*) from information_schema.role_table_grants
  where table_schema='public' and grantee='anon'
    and table_name in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans')
$$,'values (0::bigint)','anon has no direct private-table grants');

select results_eq($$
  select count(*) from information_schema.role_table_grants
  where table_schema='public' and grantee='authenticated'
    and table_name in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans')
    and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
$$,'values (0::bigint)','authenticated has no TRUNCATE, REFERENCES or TRIGGER');

select results_eq($$
  select count(*) from information_schema.role_table_grants
  where table_schema='public' and grantee='authenticated'
    and table_name in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans')
    and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
$$,'values (36::bigint)','authenticated has exactly CRUD on nine private tables');

select results_eq($$
  select count(*) from pg_policies
  where schemaname='public'
    and tablename in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans')
    and policyname='mb_v82_own_rows' and roles=array['authenticated']::name[] and cmd='ALL'
    and regexp_replace(lower(qual),'[[:space:]()]','','g')='selectauth.uidasuid=user_id'
    and regexp_replace(lower(with_check),'[[:space:]()]','','g')='selectauth.uidasuid=user_id'
$$,'values (9::bigint)','nine canonical optimized ownership policies exist');

select results_eq($$
  select count(*) from pg_policies
  where schemaname='public'
    and tablename in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans')
    and (regexp_replace(lower(coalesce(qual,'')),'[[:space:]()]','','g')='auth.uid=user_id'
      or regexp_replace(lower(coalesce(with_check,'')),'[[:space:]()]','','g')='auth.uid=user_id')
$$,'values (0::bigint)','direct per-row auth.uid policy calls were removed');

select results_eq($$
  select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans')
    and c.relrowsecurity
$$,'values (9::bigint)','RLS remains enabled on all reconciled tables');

select is((
  select pg_get_expr(d.adbin,d.adrelid) from pg_attribute a
  join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.categories'::regclass and a.attname='kind'
),$d$'despesa'::text$d$,'categories.kind future default is despesa');

select is((
  select pg_get_expr(d.adbin,d.adrelid) from pg_attribute a
  join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.recurring'::regclass and a.attname='type'
),$d$'despesa'::text$d$,'recurring.type future default is despesa');

select results_eq($$
  select count(*) from pg_constraint
  where conname in ('categories_kind_v82','recurring_type_v82') and not convalidated
$$,'values (2::bigint)','future vocabulary checks preserve legacy as NOT VALID');

insert into auth.users(id,email) values
  ('71111111-1111-4111-8111-111111111111','access-a@example.invalid'),
  ('72222222-2222-4222-8222-222222222222','access-b@example.invalid');
insert into public.categories(id,user_id,name,kind) values
  ('71000000-0000-4000-8000-000000000001','71111111-1111-4111-8111-111111111111','A category','despesa'),
  ('72000000-0000-4000-8000-000000000001','72222222-2222-4222-8222-222222222222','B category','despesa');
insert into public.monthly_plans(id,user_id,year,month) values
  ('71000000-0000-4000-8000-000000000002','71111111-1111-4111-8111-111111111111',2026,8),
  ('72000000-0000-4000-8000-000000000002','72222222-2222-4222-8222-222222222222',2026,8);

set local role authenticated;
set local "request.jwt.claim.sub"='71111111-1111-4111-8111-111111111111';
select results_eq('select count(*) from categories','values (1::bigint)','A reads only own categories');
select results_eq('select count(*) from monthly_plans','values (1::bigint)','A reads only own monthly plans');
select results_eq($$with changed as (update categories set name='blocked' where user_id='72222222-2222-4222-8222-222222222222' returning 1) select count(*) from changed$$,'values (0::bigint)','A cannot update B category');
select results_eq($$with removed as (delete from monthly_plans where user_id='72222222-2222-4222-8222-222222222222' returning 1) select count(*) from removed$$,'values (0::bigint)','A cannot delete B monthly plan');
select throws_ok($$insert into categories(user_id,name) values('72222222-2222-4222-8222-222222222222','Cross owner')$$,'42501',null,'A cannot insert B category');
select throws_ok($$insert into monthly_plans(user_id,year,month) values('72222222-2222-4222-8222-222222222222',2027,1)$$,'42501',null,'A cannot insert B monthly plan');

reset role;
set local role anon;
select throws_ok($$select count(*) from public.transactions$$,'42501',null,'anon cannot select private transactions table');

select * from finish();
rollback;
