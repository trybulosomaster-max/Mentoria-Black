begin;
create extension if not exists pgtap;
select no_plan();

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  ('51000000-0000-4000-8000-000000000001','duration-owner@example.invalid',clock_timestamp(),'{}'),
  ('51000000-0000-4000-8000-000000000002','duration-staff@example.invalid',clock_timestamp(),'{}'),
  ('51000000-0000-4000-8000-000000000003','duration-customer-monthly@example.invalid',clock_timestamp(),'{}'),
  ('51000000-0000-4000-8000-000000000004','duration-customer-annual@example.invalid',clock_timestamp(),'{}'),
  ('51000000-0000-4000-8000-000000000005','duration-customer-lifetime@example.invalid',clock_timestamp(),'{}'),
  ('51000000-0000-4000-8000-000000000006','duration-customer-staff-monthly@example.invalid',clock_timestamp(),'{}'),
  ('51000000-0000-4000-8000-000000000007','duration-customer-staff-annual@example.invalid',clock_timestamp(),'{}');

select is(
  public.admin_bootstrap_first_owner_v1(
    '51000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    'Bootstrap OWNER para teste de durações', repeat('1',64)
  )->>'role',
  'OWNER',
  'fixture OWNER is bootstrapped through the protected RPC'
);

select is(
  public.admin_add_staff_v1(
    '51000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000002',
    array['users.read','licenses.read','licenses.grant','licenses.revoke'],
    'Adicionar STAFF para teste de durações',
    '52000000-0000-4000-8000-000000000002', repeat('2',64)
  )->>'role',
  'STAFF',
  'fixture STAFF receives the existing granular license permissions'
);

select lives_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000003',array['APP'],'monthly',
  'Concessão mensal pelo OWNER','52000000-0000-4000-8000-000000000011',repeat('a',64)
)$$,'OWNER can grant a monthly license');

select is(
  (select access_type from public.access_grants
   where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000011:APP'),
  'manual','monthly uses the compatible manual access type'
);
select ok(
  (select expires_at = started_at + interval '1 month'
   from public.access_grants
   where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000011:APP'),
  'monthly expires at exactly one PostgreSQL calendar month from its start'
);
select ok((public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000003',array['APP'],'monthly',
  'Concessão mensal pelo OWNER','52000000-0000-4000-8000-000000000011',repeat('a',64)
)->>'idempotent')::boolean,'monthly grant retry returns the cached idempotent response');
select is(
  (select count(*) from public.access_grants
   where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000011:APP'),
  1::bigint,'monthly idempotent retry never duplicates the grant'
);

select lives_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000004',array['APP'],'annual',
  'Concessão anual pelo OWNER','52000000-0000-4000-8000-000000000012',repeat('b',64)
)$$,'OWNER can grant an annual license');
select ok(
  (select access_type='manual' and expires_at = started_at + interval '1 year'
   from public.access_grants
   where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000012:APP'),
  'annual remains manual and expires at exactly one calendar year'
);

select lives_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000005',array['APP'],'lifetime',
  'Concessão vitalícia pelo OWNER','52000000-0000-4000-8000-000000000013',repeat('c',64)
)$$,'OWNER can grant a lifetime license');
select ok(
  (select access_type='lifetime' and expires_at is null
   from public.access_grants
   where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000013:APP'),
  'lifetime remains lifetime with no artificial expiration'
);

select lives_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000006',array['KNOWLEDGE'],'monthly',
  'Concessão mensal pelo STAFF','52000000-0000-4000-8000-000000000014',repeat('d',64)
)$$,'STAFF with licenses.grant can grant monthly');
select lives_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000007',array['KNOWLEDGE'],'annual',
  'Concessão anual pelo STAFF','52000000-0000-4000-8000-000000000015',repeat('e',64)
)$$,'STAFF with licenses.grant can grant annual');
select throws_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000007',array['APP'],'lifetime',
  'Tentativa vitalícia pelo STAFF','52000000-0000-4000-8000-000000000016',repeat('f',64)
)$$,'42501','STAFF cannot grant lifetime licenses','backend denies STAFF lifetime even on a direct RPC call');

select throws_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000003',
  '51000000-0000-4000-8000-000000000004',array['APP'],'monthly',
  'Tentativa de concessão pelo CUSTOMER','52000000-0000-4000-8000-000000000017',repeat('0',64)
)$$,'42501','administrative access denied','CUSTOMER remains unable to grant any license');

select is(
  (select license_kind from admin_private.admin_audit_events
   where grant_id=(select id from public.access_grants where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000011:APP')
     and action='licenses.grant'),
  'monthly','monthly grant audit persists its original kind'
);
select is(
  (select license_kind from admin_private.admin_audit_events
   where grant_id=(select id from public.access_grants where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000012:APP')
     and action='licenses.grant'),
  'annual','annual grant audit remains annual'
);
select is(
  (select license_kind from admin_private.admin_audit_events
   where grant_id=(select id from public.access_grants where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000013:APP')
     and action='licenses.grant'),
  'lifetime','lifetime grant audit remains lifetime'
);

select lives_ok($$select public.admin_revoke_customer_license_v1(
  '51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000003',
  (select id from public.access_grants where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000011:APP'),
  'Revogação do grant mensal','52000000-0000-4000-8000-000000000021',repeat('1',64)
)$$,'monthly administrative grant remains revocable');
select lives_ok($$select public.admin_revoke_customer_license_v1(
  '51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000004',
  (select id from public.access_grants where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000012:APP'),
  'Revogação do grant anual','52000000-0000-4000-8000-000000000022',repeat('2',64)
)$$,'annual administrative grant remains revocable');
select lives_ok($$select public.admin_revoke_customer_license_v1(
  '51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000005',
  (select id from public.access_grants where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000013:APP'),
  'Revogação do grant vitalício','52000000-0000-4000-8000-000000000023',repeat('3',64)
)$$,'lifetime administrative grant remains revocable');

select is(
  (select license_kind from admin_private.admin_audit_events
   where request_id='52000000-0000-4000-8000-000000000021' and action='licenses.revoke'),
  'monthly','monthly revocation reads the original grant audit kind'
);
select is(
  (select license_kind from admin_private.admin_audit_events
   where request_id='52000000-0000-4000-8000-000000000022' and action='licenses.revoke'),
  'annual','annual revocation reads the original grant audit kind'
);
select is(
  (select license_kind from admin_private.admin_audit_events
   where request_id='52000000-0000-4000-8000-000000000023' and action='licenses.revoke'),
  'lifetime','lifetime revocation reads the original grant audit kind'
);

select is(
  (select grant_row->>'license_kind'
   from jsonb_array_elements(public.admin_get_user_access_v1(
     '51000000-0000-4000-8000-000000000001',
     '51000000-0000-4000-8000-000000000003'
   )->'grants') grant_row
   where grant_row->>'grant_id'=(select id::text from public.access_grants where external_reference='aviora-admin:v1:52000000-0000-4000-8000-000000000011:APP')),
  'monthly','license listing exposes the durable monthly kind even after revocation'
);

select throws_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000002',array['APP'],'monthly',
  'Tentativa de licença própria STAFF','52000000-0000-4000-8000-000000000031',repeat('4',64)
)$$,'42501','STAFF cannot manage their own license','existing STAFF self-license protection remains intact');
select throws_ok($$select public.admin_grant_customer_license_v1(
  '51000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000001',array['APP'],'monthly',
  'Tentativa de atingir OWNER','52000000-0000-4000-8000-000000000032',repeat('5',64)
)$$,'42501','STAFF can only manage CUSTOMER licenses','existing OWNER target protection remains intact');

select ok(not has_function_privilege('authenticated','public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)','EXECUTE'),'browser role still cannot execute the grant RPC directly');
select ok(has_function_privilege('service_role','public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)','EXECUTE'),'service role retains the narrow grant RPC capability');

select * from finish();
rollback;
