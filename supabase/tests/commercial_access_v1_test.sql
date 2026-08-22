begin;
create extension if not exists pgtap;
select no_plan();

select is((select count(*) from public.products where product_kind='entitlement'),2::bigint,'APP and KNOWLEDGE are grantable');
select is((select count(*) from public.product_components pc join public.products p on p.id=pc.bundle_product_id where p.code='COMPLETE'),2::bigint,'COMPLETE expands to two grants');
select is((select count(*) from public.commercial_offers where active),0::bigint,'offers remain inactive until commercial configuration');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.products'::regclass,'public.product_trials'::regclass,'public.access_grants'::regclass,
  'public.billing_customers'::regclass,'public.billing_orders'::regclass,
  'public.billing_subscriptions'::regclass,'public.payment_events'::regclass
)),'commercial tables have RLS');
select ok(not (select prosecdef from pg_proc where oid='public.get_my_entitlements()'::regprocedure),'entitlement resolver is security invoker');
select ok(not (select prosecdef from pg_proc where oid='public.has_active_access(text)'::regprocedure),'access predicate is security invoker');
select ok((select prosecdef from pg_proc where oid='public.start_my_app_trial()'::regprocedure),'trial starter is the narrow security definer');
select is((select proconfig[1] from pg_proc where oid='public.start_my_app_trial()'::regprocedure),'search_path=pg_catalog','trial starter search_path is controlled');
select is((select count(*) from information_schema.role_table_grants where table_schema='public' and table_name in ('product_trials','access_grants','billing_customers','billing_orders','billing_subscriptions','payment_events') and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')),0::bigint,'clients have no commercial write grants');

insert into auth.users(id,email,email_confirmed_at) values
  ('a0000000-0000-4000-8000-000000000001','commercial-a@example.invalid',null),
  ('b0000000-0000-4000-8000-000000000002','commercial-b@example.invalid',now()),
  ('c0000000-0000-4000-8000-000000000003','commercial-c@example.invalid',now()),
  ('d0000000-0000-4000-8000-000000000004','commercial-admin@example.invalid',now());

set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select throws_ok($$select * from public.start_my_app_trial()$$,'42501',null,'unconfirmed email cannot start trial');
reset role;
update auth.users set email_confirmed_at=clock_timestamp() where id='a0000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select is((select trial_state from public.start_my_app_trial()),'active','confirmed first access starts trial');
select ok(public.has_active_access('APP'),'trial grants APP access');
select ok(not public.has_active_access('KNOWLEDGE'),'trial does not grant KNOWLEDGE');
select is((select count(*) from public.product_trials),1::bigint,'user sees exactly one own trial');
select is((select count(*) from public.access_grants),1::bigint,'user sees exactly one own grant');
select is((select trial_state from public.start_my_app_trial()),'active','trial start is idempotent');
reset role;

select is((select extract(epoch from (expires_at-started_at))::bigint from public.product_trials where user_id='a0000000-0000-4000-8000-000000000001'),604800::bigint,'trial lasts exactly 168 hours');

insert into public.accounts(id,user_id,name) values
  ('aa000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Synthetic A'),
  ('bb000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','Synthetic B');

set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.accounts),1::bigint,'trial user reads only own financial row');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002';
select ok(not public.has_active_access('APP'),'user without grant has no APP access');
select is((select count(*) from public.accounts),0::bigint,'user without grant cannot load financial rows');
select is((select count(*) from public.access_grants),0::bigint,'user B cannot read user A grants');
select throws_ok($$insert into public.access_grants(user_id,product_id,access_type,source_provider) select 'b0000000-0000-4000-8000-000000000002',id,'paid','asaas' from public.products where code='APP'$$,'42501',null,'client cannot self-grant');
reset role;

update public.product_trials set started_at=statement_timestamp()-interval '167 hours 59 minutes',expires_at=statement_timestamp()+interval '1 minute' where user_id='a0000000-0000-4000-8000-000000000001';
update public.access_grants set starts_at=statement_timestamp()-interval '167 hours 59 minutes',expires_at=statement_timestamp()+interval '1 minute' where user_id='a0000000-0000-4000-8000-000000000001' and access_type='trial';
set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select ok(public.has_active_access('APP'),'trial is active at 167h59');
reset role;

update public.product_trials set started_at=statement_timestamp()-interval '168 hours',expires_at=statement_timestamp() where user_id='a0000000-0000-4000-8000-000000000001';
update public.access_grants set starts_at=statement_timestamp()-interval '168 hours',expires_at=statement_timestamp() where user_id='a0000000-0000-4000-8000-000000000001' and access_type='trial';
set local role authenticated;
set local request.jwt.claim.sub='a0000000-0000-4000-8000-000000000001';
select ok(not public.has_active_access('APP'),'trial is blocked at 168 hours');
select is((public.get_my_entitlements()->'trial'->>'state'),'expired','resolver derives expired state from server time');
reset role;

insert into public.access_grants(user_id,product_id,access_type,source_provider,status,external_reference)
select 'b0000000-0000-4000-8000-000000000002',id,'paid','asaas','active','sandbox:paid-b'
from public.products where code='APP';
set local role authenticated;
set local request.jwt.claim.sub='b0000000-0000-4000-8000-000000000002';
select is((select trial_state from public.start_my_app_trial()),'converted','existing customer does not receive a later trial');
select ok(public.has_active_access('APP'),'paid APP grant is active');
reset role;

insert into public.access_grants(user_id,product_id,access_type,source_provider,status,external_reference)
select 'c0000000-0000-4000-8000-000000000003',id,'lifetime','kiwify','active','legacy:knowledge-c'
from public.products where code='KNOWLEDGE';
set local role authenticated;
set local request.jwt.claim.sub='c0000000-0000-4000-8000-000000000003';
select ok(public.has_active_access('KNOWLEDGE'),'provider-neutral Kiwify lifetime grant is reusable');
select ok(not public.has_active_access('APP'),'KNOWLEDGE-only user does not receive APP');
reset role;

select throws_ok($$insert into public.access_grants(user_id,product_id,access_type,source_provider,status,external_reference) select 'c0000000-0000-4000-8000-000000000003',id,'paid','asaas','active','invalid:bundle' from public.products where code='COMPLETE'$$,'23514',null,'bundle cannot be stored as opaque grant');
select throws_ok($$insert into public.access_grants(user_id,product_id,access_type,source_provider,status) select 'c0000000-0000-4000-8000-000000000003',id,'manual','manual','active' from public.products where code='APP'$$,'23514',null,'manual grant requires administrator audit');

insert into public.access_grants(user_id,product_id,access_type,source_provider,status,granted_by,administrative_reason)
select 'c0000000-0000-4000-8000-000000000003',id,'manual','manual','active','d0000000-0000-4000-8000-000000000004','Synthetic courtesy'
from public.products where code='APP';
set local role authenticated;
set local request.jwt.claim.sub='c0000000-0000-4000-8000-000000000003';
select ok(public.has_active_access('APP') and public.has_active_access('KNOWLEDGE'),'manual APP plus lifetime KNOWLEDGE resolves COMPLETE experience');
reset role;

insert into public.payment_events(provider,environment,external_event_id,event_type,payload_hash)
values ('asaas','sandbox','evt_synthetic_unique','PAYMENT_RECEIVED',repeat('a',64));
select throws_ok($$insert into public.payment_events(provider,environment,external_event_id,event_type,payload_hash) values ('asaas','sandbox','evt_synthetic_unique','PAYMENT_RECEIVED',repeat('a',64))$$,'23505',null,'duplicate provider event is rejected');

select is((select count(*) from pg_policies where schemaname='public' and tablename in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans') and policyname='mb_commercial_app_access'),9::bigint,'all V82 private tables use entitlement-aware policy');

set local role anon;
select throws_ok($$select public.get_my_entitlements()$$,'42501',null,'anon cannot resolve entitlements');
reset role;

select * from finish();
rollback;
