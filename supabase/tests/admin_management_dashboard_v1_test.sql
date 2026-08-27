begin;
create extension if not exists pgtap;
select no_plan();

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  ('71000000-0000-4000-8000-000000000001','dashboard-owner@example.invalid',clock_timestamp(),'{"name":"Olivia Owner"}'),
  ('71000000-0000-4000-8000-000000000002','dashboard-staff@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000003','dual@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000004','annual@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000005','lifetime@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000006','trial-active@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000007','trial-eligible@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000008','trial-overridden@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000009','commercial@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000010','unknown@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000011','revoked@example.invalid',clock_timestamp(),'{}'),
  ('71000000-0000-4000-8000-000000000012','no-access@example.invalid',clock_timestamp(),'{}');

select is(public.admin_bootstrap_first_owner_v1(
  '71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  'Bootstrap OWNER do painel gerencial',repeat('1',64)
)->>'role','OWNER','OWNER fixture is active');
select is(public.admin_add_staff_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',
  array['users.read','licenses.read','licenses.grant','licenses.revoke'],
  'Adicionar STAFF para histórico gerencial','72000000-0000-4000-8000-000000000002',repeat('2',64)
)->>'role','STAFF','STAFF fixture is active');

select lives_ok($$select public.admin_grant_customer_license_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',
  array['APP','KNOWLEDGE'],'monthly','APP e Knowledge mensais sem duplicar cliente',
  '72000000-0000-4000-8000-000000000011',repeat('a',64)
)$$,'OWNER grants two monthly product licenses');
select lives_ok($$select public.admin_grant_customer_license_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000004',
  array['APP'],'annual','Licença anual ativa para o painel',
  '72000000-0000-4000-8000-000000000012',repeat('b',64)
)$$,'OWNER grants an annual license');
select lives_ok($$select public.admin_grant_customer_license_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000005',
  array['KNOWLEDGE'],'lifetime','Licença vitalícia ativa para o painel',
  '72000000-0000-4000-8000-000000000013',repeat('c',64)
)$$,'OWNER grants a lifetime license');
select lives_ok($$select public.admin_grant_customer_license_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000008',
  array['APP'],'monthly','Licença que substitui trial efetivo',
  '72000000-0000-4000-8000-000000000014',repeat('d',64)
)$$,'non-trial entitlement is available for trial precedence');
select lives_ok($$select public.admin_grant_customer_license_v1(
  '71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000011',
  array['APP'],'monthly','Concessão STAFF para histórico revogado',
  '72000000-0000-4000-8000-000000000015',repeat('e',64)
)$$,'STAFF grant supplies an actor-email fallback fixture');
select lives_ok($$select public.admin_revoke_customer_license_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000011',
  (select id from public.access_grants where external_reference='aviora-admin:v1:72000000-0000-4000-8000-000000000015:APP'),
  'Revogação OWNER preservada no histórico','72000000-0000-4000-8000-000000000016',repeat('f',64)
)$$,'OWNER revokes the STAFF-created administrative grant');

insert into public.product_trials(user_id,product_id,state,origin,started_at,expires_at)
select fixture.user_id,product.id,fixture.state,'dashboard_test',
  case when fixture.state='eligible' then null else statement_timestamp()-interval '1 day' end,
  case when fixture.state='eligible' then null else statement_timestamp()-interval '1 day'+interval '168 hours' end
from (values
  ('71000000-0000-4000-8000-000000000006'::uuid,'active'),
  ('71000000-0000-4000-8000-000000000007'::uuid,'eligible'),
  ('71000000-0000-4000-8000-000000000008'::uuid,'active')
) fixture(user_id,state)
join public.products product on product.code='APP';

insert into public.access_grants(user_id,product_id,access_type,source,status,started_at,expires_at,external_reference)
select fixture.user_id,product.id,'trial','trial','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '6 days',fixture.reference
from (values
  ('71000000-0000-4000-8000-000000000006'::uuid,'trial:dashboard-active'),
  ('71000000-0000-4000-8000-000000000008'::uuid,'trial:dashboard-overridden')
) fixture(user_id,reference)
join public.products product on product.code='APP';

update public.commercial_offers
set provider='asaas',active=true
where code='APP_MONTHLY';
insert into public.billing_orders(
  id,user_id,offer_id,provider,environment,status,external_reference,paid_through
)
select '73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000009',
  offer.id,'asaas','sandbox','confirmed','mbo_DashboardMonthlyFixture_001',clock_timestamp()+interval '20 days'
from public.commercial_offers offer where offer.code='APP_MONTHLY';
insert into public.access_grants(
  id,user_id,product_id,access_type,source,environment,status,started_at,expires_at,external_reference
)
select '73000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000009',
  product.id,'paid','asaas','sandbox','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','order:dashboard:APP'
from public.products product where product.code='APP';
insert into public.billing_order_grants(order_id,grant_id,product_id)
select '73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002',product.id
from public.products product where product.code='APP';
insert into public.access_grants(
  id,user_id,product_id,access_type,source,environment,status,started_at,expires_at,external_reference
)
select '73000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000009',
  product.id,'lifetime','kiwify','production','active',clock_timestamp()-interval '1 day',null,'dashboard-kiwify-lifetime'
from public.products product where product.code='KNOWLEDGE';
insert into public.access_grants(
  id,user_id,product_id,access_type,source,environment,status,started_at,expires_at,external_reference
)
select '73000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000010',
  product.id,'paid','partner_unknown','sandbox','active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','unknown-dashboard-grant'
from public.products product where product.code='APP';

select throws_ok($$select public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000002',null,null,50
)$$,'42501','OWNER access required','active STAFF cannot read global management metrics by forged RPC');
select throws_ok($$select public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000003',null,null,50
)$$,'42501','OWNER access required','CUSTOMER cannot read global management metrics');
select lives_ok($$select public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001',null,null,50
)$$,'OWNER can read the global management dashboard');

create temporary table dashboard_result as
select public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001',null,null,50
) as payload;

select is((select (payload->'metrics'->>'accounts')::bigint from dashboard_result),12::bigint,'accounts count Auth users, not licenses');
select is((select (payload->'metrics'->>'active_clients')::bigint from dashboard_result),7::bigint,'APP plus KNOWLEDGE count each active client once');
select is((select (payload->'metrics'->>'monthly_licenses')::bigint from dashboard_result),4::bigint,'monthly licenses use canonical admin or commercial interval provenance');
select is((select (payload->'metrics'->>'annual_licenses')::bigint from dashboard_result),1::bigint,'annual licenses remain distinct');
select is((select (payload->'metrics'->>'lifetime_licenses')::bigint from dashboard_result),2::bigint,'lifetime includes canonical manual and recognized commercial lifetime');
select is((select (payload->'metrics'->>'trial_active')::bigint from dashboard_result),1::bigint,'only an effective active trial is counted');
select is((select (payload->'metrics'->'manual_commercial'->>'manual')::bigint from dashboard_result),5::bigint,'manual count requires AVIORA administrative provenance');
select is((select (payload->'metrics'->'manual_commercial'->>'commercial')::bigint from dashboard_result),2::bigint,'recognized billing/Kiwify grants are commercial');
select is((select (payload->'metrics'->'manual_commercial'->>'unknown')::bigint from dashboard_result),1::bigint,'unknown providers remain explicitly unclassified');
select is((select (payload->'metrics'->'expiring_30_days'->>'grants')::bigint from dashboard_result),4::bigint,'30-day expiry counts active grants and excludes lifetime/revoked');
select is((select (payload->'metrics'->'expiring_30_days'->>'users')::bigint from dashboard_result),4::bigint,'30-day expiry also reports unique users');
select is((select count(*) from jsonb_array_elements((select payload->'manual_activity' from dashboard_result)) row where row->>'current_status'='revoked'),1::bigint,'revoked grant remains in manual history but not active metrics');
select is((select row->>'granted_by_email' from jsonb_array_elements((select payload->'manual_activity' from dashboard_result)) row where row->>'grant_id'=(select id::text from public.access_grants where external_reference='aviora-admin:v1:72000000-0000-4000-8000-000000000015:APP')),'dashboard-staff@example.invalid','missing actor name falls back to durable actor email data');
select is((select row->>'revoked_by_name' from jsonb_array_elements((select payload->'manual_activity' from dashboard_result)) row where row->>'grant_id'=(select id::text from public.access_grants where external_reference='aviora-admin:v1:72000000-0000-4000-8000-000000000015:APP')),'Olivia Owner','revocation identifies the responsible OWNER');

select is(public.admin_set_staff_status_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','disabled',
  'Desativar STAFF após ações históricas','72000000-0000-4000-8000-000000000021',repeat('9',64)
)->>'status','disabled','STAFF is disabled without deleting history');
select is((select granted_by_status from admin_private.admin_license_grant_trace_v1 where grant_id=(select id from public.access_grants where external_reference='aviora-admin:v1:72000000-0000-4000-8000-000000000015:APP')),'disabled','disabled STAFF remains visible in grant history');

select is((select grant_row->'granted'->>'actor_email' from jsonb_array_elements(public.admin_get_user_access_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000011'
)->'grants') grant_row where grant_row->>'administrative'='true'),'dashboard-staff@example.invalid','per-user grant card receives the real grant actor');
select is((select grant_row->'revoked'->>'actor_name' from jsonb_array_elements(public.admin_get_user_access_v1(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000011'
)->'grants') grant_row where grant_row->>'administrative'='true'),'Olivia Owner','per-user revoked grant receives the real revocation actor');

-- More than 100 canonical manual activities make every limit boundary
-- observable. The RPC itself remains responsible for fail-closed validation;
-- callers cannot turn an explicit NULL into an unbounded LIMIT.
do $dashboard_activity_fixture$
declare
  v_index integer;
  v_request_id uuid;
begin
  for v_index in 1..111 loop
    v_request_id := (
      '74000000-0000-4000-8000-' || lpad(v_index::text, 12, '0')
    )::uuid;
    perform public.admin_grant_customer_license_v1(
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000012',
      array['APP'],
      'monthly',
      'Fixture de cardinalidade do painel gerencial',
      v_request_id,
      encode(digest('dashboard-activity-' || v_index::text, 'sha256'), 'hex')
    );
  end loop;
end
$dashboard_activity_fixture$;

select is(jsonb_array_length(public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001',null,null,1
)->'manual_activity'),1,'p_limit 1 is accepted and returns exactly one activity');
select is(jsonb_array_length(public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001',null,null,100
)->'manual_activity'),100,'p_limit 100 is accepted and caps a fixture larger than 100');
select is(jsonb_array_length(public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001'
)->'manual_activity'),50,'omitted p_limit keeps the bounded default of 50');
select throws_ok($$select public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001',null,null,0
)$$,'22023','management dashboard limit must be between 1 and 100','p_limit 0 is rejected');
select throws_ok($$select public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001',null,null,101
)$$,'22023','management dashboard limit must be between 1 and 100','p_limit 101 is rejected');
select throws_ok($$select public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001',null,null,null
)$$,'22023','management dashboard limit must be between 1 and 100','explicit NULL p_limit fails before the activity query can run without a bound');
select throws_ok($$select public.admin_get_management_dashboard_v1(
  '71000000-0000-4000-8000-000000000001',
  statement_timestamp() - interval '367 days',statement_timestamp(),1
)$$,'22023','management dashboard period is invalid','periods longer than 366 days remain rejected');

select is(public.admin_consume_rate_limit_v1(
  '71000000-0000-4000-8000-000000000001','management.dashboard',null,null
)->>'bucket','reads','management dashboard remains in the bounded read bucket');
select ok(not has_function_privilege('authenticated','public.admin_get_management_dashboard_v1(uuid,timestamp with time zone,timestamp with time zone,integer)','EXECUTE'),'authenticated cannot invoke the management RPC directly');
select ok(has_function_privilege('service_role','public.admin_get_management_dashboard_v1(uuid,timestamp with time zone,timestamp with time zone,integer)','EXECUTE'),'service_role retains the narrow management RPC capability');
select ok(not has_table_privilege('service_role','admin_private.admin_license_grant_trace_v1','SELECT'),'private provenance view is not exposed directly even to service_role');

select * from finish();
rollback;
