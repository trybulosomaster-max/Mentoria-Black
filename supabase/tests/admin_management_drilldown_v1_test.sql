begin;
create extension if not exists pgtap;
select no_plan();

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at) values
  ('91000000-0000-4000-8000-000000000001','owner@example.invalid',clock_timestamp(),'{"name":"Olivia"}',clock_timestamp()-interval '9 days'),
  ('91000000-0000-4000-8000-000000000002','staff@example.invalid',clock_timestamp(),'{}',clock_timestamp()-interval '8 days'),
  ('91000000-0000-4000-8000-000000000003','monthly@example.invalid',clock_timestamp(),'{}',clock_timestamp()-interval '7 days'),
  ('91000000-0000-4000-8000-000000000004','annual@example.invalid',clock_timestamp(),'{}',clock_timestamp()-interval '6 days'),
  ('91000000-0000-4000-8000-000000000005','lifetime@example.invalid',clock_timestamp(),'{}',clock_timestamp()-interval '5 days'),
  ('91000000-0000-4000-8000-000000000006','trial@example.invalid',clock_timestamp(),'{}',clock_timestamp()-interval '4 days'),
  ('91000000-0000-4000-8000-000000000007','commercial@example.invalid',clock_timestamp(),'{}',clock_timestamp()-interval '3 days'),
  ('91000000-0000-4000-8000-000000000008','unknown@example.invalid',clock_timestamp(),'{}',clock_timestamp()-interval '2 days'),
  ('91000000-0000-4000-8000-000000000009','empty@example.invalid',clock_timestamp(),'{}',clock_timestamp()-interval '1 day');

select is(public.admin_bootstrap_first_owner_v1(
  '91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
  'Bootstrap OWNER do drill-down',repeat('1',64)
)->>'role','OWNER','OWNER fixture is active');
select is(public.admin_add_staff_v1(
  '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
  array['users.read','licenses.read'],'Adicionar STAFF negativo ao drill-down',
  '92000000-0000-4000-8000-000000000002',repeat('2',64)
)->>'role','STAFF','STAFF fixture is active');

select lives_ok($$select public.admin_grant_customer_license_v1(
  '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003',
  array['APP','KNOWLEDGE'],'monthly','Duas licenças mensais do mesmo cliente',
  '92000000-0000-4000-8000-000000000011',repeat('a',64)
)$$,'monthly APP plus KNOWLEDGE fixture is granted');
select lives_ok($$select public.admin_grant_customer_license_v1(
  '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000004',
  array['APP'],'annual','Licença anual do drill-down',
  '92000000-0000-4000-8000-000000000012',repeat('b',64)
)$$,'annual fixture is granted');
select lives_ok($$select public.admin_grant_customer_license_v1(
  '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005',
  array['KNOWLEDGE'],'lifetime','Licença vitalícia do drill-down',
  '92000000-0000-4000-8000-000000000013',repeat('c',64)
)$$,'lifetime fixture is granted');

insert into public.product_trials(user_id,product_id,state,origin,started_at,expires_at)
select '91000000-0000-4000-8000-000000000006',product.id,'active','drilldown_test',
  statement_timestamp()-interval '1 day',statement_timestamp()+interval '6 days'
from public.products product where product.code='APP';
insert into public.access_grants(user_id,product_id,access_type,source,status,started_at,expires_at,external_reference)
select '91000000-0000-4000-8000-000000000006',product.id,'trial','trial','active',
  clock_timestamp()-interval '1 day',clock_timestamp()+interval '6 days','trial:drilldown'
from public.products product where product.code='APP';

update public.commercial_offers set provider='asaas',active=true where code='APP_MONTHLY';
insert into public.billing_orders(id,user_id,offer_id,provider,environment,status,external_reference,paid_through)
select '93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000007',offer.id,
  'asaas','sandbox','confirmed','mbo_AdminDrilldownFixture_000001',clock_timestamp()+interval '20 days'
from public.commercial_offers offer where offer.code='APP_MONTHLY';
insert into public.access_grants(id,user_id,product_id,access_type,source,environment,status,started_at,expires_at,external_reference)
select '93000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000007',product.id,
  'paid','asaas','sandbox','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','order:drilldown:APP'
from public.products product where product.code='APP';
insert into public.billing_order_grants(order_id,grant_id,product_id)
select '93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002',product.id
from public.products product where product.code='APP';
insert into public.access_grants(id,user_id,product_id,access_type,source,environment,status,started_at,expires_at,external_reference)
select '93000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000008',product.id,
  'paid','unknown_partner','sandbox','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','unknown:drilldown'
from public.products product where product.code='APP';

select throws_ok($$select public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000002','accounts',null,25,null,null
)$$,'42501','OWNER access required','STAFF forged drill-down is denied');
select throws_ok($$select public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000003','accounts',null,25,null,null
)$$,'42501','OWNER access required','CUSTOMER forged drill-down is denied');
select lives_ok($$select public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','accounts',null,25,null,null
)$$,'OWNER can read the bounded management drill-down');

select is(jsonb_array_length(public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','accounts',null,25,null,null
)->'items'),9,'accounts returns each Auth account once');
select is(jsonb_array_length(public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','active_clients',null,25,null,null
)->'items'),6,'active clients returns distinct users rather than grants');
select is((select jsonb_array_length(item->'access')
  from jsonb_array_elements(public.admin_list_management_drilldown_v1(
    '91000000-0000-4000-8000-000000000001','monthly',null,25,null,null
  )->'items') item where item->>'user_id'='91000000-0000-4000-8000-000000000003'),2,
  'monthly user contains both matching grants without duplicating the user');
select is((public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','annual',null,25,null,null
)->'items'->0->'access'->0->>'license_kind'),'annual','annual filter uses canonical license kind');
select is((public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','lifetime',null,25,null,null
)->'items'->0->'access'->0->>'license_kind'),'lifetime','lifetime filter uses canonical license kind');
select is((public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','trial_active',null,25,null,null
)->'items'->0->'trial'->>'state'),'active','trial filter only returns effective active trial');
select is(jsonb_array_length(public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','origin','manual',25,null,null
)->'items'),3,'manual origin contains only canonical AVIORA administrative grants');
select is(jsonb_array_length(public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','origin','commercial',25,null,null
)->'items'),1,'commercial origin contains only recognized billing grants');
select is(jsonb_array_length(public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','expiring_30_days',null,25,null,null
)->'items'),3,'30-day expiry excludes lifetime and calendar-month grants beyond the 30-day window');
select is(jsonb_array_length(public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','accounts',null,1,null,null
)->'items'),1,'limit one is enforced');
select ok((public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','accounts',null,1,null,null
)->'next_cursor') is not null,'bounded page returns a continuation cursor');
select throws_ok($$select public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','accounts',null,null,null,null
)$$,'22023','management drilldown limit must be between 1 and 50','explicit NULL limit fails closed');
select throws_ok($$select public.admin_list_management_drilldown_v1(
  '91000000-0000-4000-8000-000000000001','origin','unknown',25,null,null
)$$,'22023','management origin must be manual or commercial','unknown origin cannot be forced into a trusted classification');
select is(public.admin_consume_rate_limit_v1(
  '91000000-0000-4000-8000-000000000001','management.drilldown',null,null
)->>'bucket','reads','drill-down shares the durable bounded management read bucket');
select ok(not has_function_privilege('authenticated','public.admin_list_management_drilldown_v1(uuid,text,text,integer,timestamp with time zone,uuid)','EXECUTE'),'authenticated cannot call drill-down RPC directly');
select ok(has_function_privilege('service_role','public.admin_list_management_drilldown_v1(uuid,text,text,integer,timestamp with time zone,uuid)','EXECUTE'),'service_role retains the narrow drill-down capability');

select * from finish();
rollback;
