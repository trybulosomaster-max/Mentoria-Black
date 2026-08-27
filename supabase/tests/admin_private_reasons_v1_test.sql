begin;
create extension if not exists pgtap;
select no_plan();

select has_function(
  'admin_private', 'redact_public_admin_reason_v1', array[]::text[],
  'private write-time redaction trigger function exists'
);
select trigger_is(
  'public', 'access_grants', 'redact_public_admin_reason_v1',
  'admin_private', 'redact_public_admin_reason_v1',
  'public entitlement ledger has the private-reason redaction trigger'
);
select ok(
  exists (
    select 1 from pg_constraint constraint_row
    where constraint_row.conrelid='public.access_grants'::regclass
      and constraint_row.conname='access_grants_admin_reason_private_check'
      and constraint_row.convalidated
  ),
  'validated constraint makes public administrative-reason privacy an invariant'
);

select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000004'),
  null::text,
  'migration sanitizes a pre-existing active administrative grant reason'
);
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000005'),
  null::text,
  'migration sanitizes a pre-existing revoked administrative grant reason'
);
select is(
  (select reason from admin_private.admin_audit_events
   where request_id='b1000000-0000-4000-8000-000000000011'),
  'Internal active reason before privacy migration',
  'private immutable audit preserves the pre-migration grant reason'
);
select is(
  (select reason from admin_private.admin_audit_events
   where request_id='b1000000-0000-4000-8000-000000000013'),
  'Internal revocation reason before privacy migration',
  'private immutable audit preserves the pre-migration revocation reason'
);
select is(
  (select granted_reason from admin_private.admin_license_grant_trace_v1
   where grant_id=(select id from public.access_grants
     where user_id='a1000000-0000-4000-8000-000000000004')),
  'Internal active reason before privacy migration',
  'administrative trace reads the grant reason from private audit'
);
select is(
  (select revoked_reason from admin_private.admin_license_grant_trace_v1
   where grant_id=(select id from public.access_grants
     where user_id='a1000000-0000-4000-8000-000000000005')),
  'Internal revocation reason before privacy migration',
  'administrative trace reads the revocation reason from private audit'
);
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000010' and source='manual'),
  null::text,
  'migration also sanitizes the supported legacy admin namespace'
);
select is(
  (select reason from public.commercial_admin_audit
   where target_user_id='a1000000-0000-4000-8000-000000000010'
     and action='grant'),
  'Legacy internal grant reason before privacy migration',
  'closed legacy audit preserves the pre-migration grant reason'
);
select is(
  (select reason from public.commercial_admin_audit
   where target_user_id='a1000000-0000-4000-8000-000000000010'
     and action='revoke'),
  'Legacy internal revocation reason before privacy migration',
  'closed legacy audit preserves the pre-migration revocation reason'
);

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000004';
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000004'),
  null::text,
  'target CUSTOMER reads no internal grant reason from its own public row'
);
select ok(
  (public.get_my_entitlements()->'app'->>'has_access')::boolean,
  'target CUSTOMER keeps its APP entitlement after reason redaction'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000010';
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000010' and source='manual'),
  null::text,
  'legacy admin target reads no internal revocation reason from its public row'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000005';
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000005'),
  null::text,
  'revoked CUSTOMER reads no internal revocation reason from its public history row'
);
reset role;

select is(
  (select grant_row->'granted'->>'reason'
   from jsonb_array_elements(public.admin_get_user_access_v1(
     'a1000000-0000-4000-8000-000000000001',
     'a1000000-0000-4000-8000-000000000004'
   )->'grants') grant_row),
  'Internal active reason before privacy migration',
  'OWNER keeps authorized visibility of the private grant reason'
);
select is(
  (select grant_row->'revoked'->>'reason'
   from jsonb_array_elements(public.admin_get_user_access_v1(
     'a1000000-0000-4000-8000-000000000001',
     'a1000000-0000-4000-8000-000000000005'
   )->'grants') grant_row),
  'Internal revocation reason before privacy migration',
  'OWNER keeps authorized visibility of the private revocation reason'
);
select is(
  (select grant_row->'granted'->>'actor_user_id'
   from jsonb_array_elements(public.admin_get_user_access_v1(
     'a1000000-0000-4000-8000-000000000002',
     'a1000000-0000-4000-8000-000000000004'
   )->'grants') grant_row),
  'a1000000-0000-4000-8000-000000000001',
  'authorized STAFF trace preserves the canonical granting actor'
);
select throws_ok($$select public.admin_get_user_access_v1(
  'a1000000-0000-4000-8000-000000000003',
  'a1000000-0000-4000-8000-000000000004'
)$$,'42501','administrative permission denied','STAFF without licenses.read cannot expand trace access');
select throws_ok($$select public.admin_get_user_access_v1(
  'a1000000-0000-4000-8000-000000000004',
  'a1000000-0000-4000-8000-000000000004'
)$$,'42501','administrative access denied','CUSTOMER cannot call the administrative trace RPC');

select lives_ok($$select public.admin_grant_customer_license_v1(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000006', array['APP','KNOWLEDGE'], 'monthly',
  'Post-migration monthly internal reason',
  'b1000000-0000-4000-8000-000000000021', repeat('d',64)
)$$,'OWNER can grant monthly APP and KNOWLEDGE after privacy hardening');
select is(
  (select count(*) from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000006'
     and administrative_reason is null),
  2::bigint,
  'new monthly administrative grants persist no public reason'
);
select is(
  (select count(*) from admin_private.admin_audit_events
   where request_id='b1000000-0000-4000-8000-000000000021'
     and reason='Post-migration monthly internal reason'),
  2::bigint,
  'new monthly grant reason remains private for both products'
);
select is(
  (select count(*) from admin_private.admin_audit_events
   where request_id='b1000000-0000-4000-8000-000000000021'
     and license_kind='monthly'),
  2::bigint,
  'monthly canonical kind is unchanged'
);

select lives_ok($$select public.admin_grant_customer_license_v1(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000007', array['APP'], 'annual',
  'Post-migration annual internal reason',
  'b1000000-0000-4000-8000-000000000022', repeat('e',64)
)$$,'annual administrative grant remains available');
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000007'),
  null::text,
  'annual administrative reason is private'
);
select is(
  (select license_kind from admin_private.admin_audit_events
   where request_id='b1000000-0000-4000-8000-000000000022'),
  'annual',
  'annual canonical kind remains private and correct'
);

select lives_ok($$select public.admin_grant_customer_license_v1(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000008', array['KNOWLEDGE'], 'lifetime',
  'Post-migration lifetime internal reason',
  'b1000000-0000-4000-8000-000000000023', repeat('f',64)
)$$,'lifetime administrative grant remains available to OWNER');
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000008'),
  null::text,
  'lifetime administrative reason is private'
);
select is(
  (select expires_at from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000008'),
  null::timestamptz,
  'lifetime entitlement keeps null expiration'
);

select lives_ok($$select public.admin_revoke_customer_license_v1(
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000006',
  (select grant_row.id from public.access_grants grant_row
   join public.products product on product.id=grant_row.product_id
   where grant_row.user_id='a1000000-0000-4000-8000-000000000006'
     and product.code='APP'),
  'Post-migration private revocation reason',
  'b1000000-0000-4000-8000-000000000024', repeat('0',64)
)$$,'authorized STAFF can revoke the intended administrative APP grant');
select is(
  (select administrative_reason from public.access_grants grant_row
   join public.products product on product.id=grant_row.product_id
   where grant_row.user_id='a1000000-0000-4000-8000-000000000006'
     and product.code='APP'),
  null::text,
  'new revocation reason is never copied back to the public row'
);
select is(
  (select reason from admin_private.admin_audit_events
   where request_id='b1000000-0000-4000-8000-000000000024'),
  'Post-migration private revocation reason',
  'new revocation reason remains in private immutable audit'
);
select is(
  (select revoked_by_user_id::text from admin_private.admin_license_grant_trace_v1 trace
   join public.access_grants grant_row on grant_row.id=trace.grant_id
   join public.products product on product.id=grant_row.product_id
   where grant_row.user_id='a1000000-0000-4000-8000-000000000006'
     and product.code='APP'),
  'a1000000-0000-4000-8000-000000000002',
  'private trace retains the responsible STAFF after revocation'
);

select is(
  (select count(*) from public.bootstrap_commercial_admin_v1(
    'a1000000-0000-4000-8000-000000000012',
    'a1000000-0000-4000-8000-000000000001',
    'Post-migration legacy bootstrap private reason'
  ) where created),
  2::bigint,
  'legacy bootstrap continues to create APP and KNOWLEDGE grants'
);
select is(
  (select count(*) from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000012'
     and administrative_reason is null),
  2::bigint,
  'legacy bootstrap writes no public administrative reason'
);
select is(
  (select count(*) from public.commercial_admin_audit
   where target_user_id='a1000000-0000-4000-8000-000000000012'
     and reason='Post-migration legacy bootstrap private reason'),
  3::bigint,
  'legacy bootstrap reason remains in its closed audit records'
);
select ok(
  public.admin_revoke_commercial_access_v1(
    (select grant_row.id from public.access_grants grant_row
     join public.products product on product.id=grant_row.product_id
     where grant_row.user_id='a1000000-0000-4000-8000-000000000012'
       and product.code='APP'),
    'a1000000-0000-4000-8000-000000000001',
    'Post-migration legacy private revocation reason'
  ),
  'legacy revocation remains functional after privacy hardening'
);
select is(
  (select administrative_reason from public.access_grants grant_row
   join public.products product on product.id=grant_row.product_id
   where grant_row.user_id='a1000000-0000-4000-8000-000000000012'
     and product.code='APP'),
  null::text,
  'legacy revocation writes no public administrative reason'
);
select is(
  (select reason from public.commercial_admin_audit
   where target_user_id='a1000000-0000-4000-8000-000000000012'
     and action='revoke'),
  'Post-migration legacy private revocation reason',
  'legacy revocation reason remains in closed audit'
);

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000009';
select is((select result from public.start_my_app_trial()),'started','CUSTOMER trial still starts normally');
select is(
  (public.get_my_entitlements()->'app'->>'access_type'),
  'trial',
  'trial entitlement remains unchanged by administrative privacy hardening'
);
reset role;

insert into public.access_grants(
  user_id,product_id,access_type,source,environment,status,started_at,expires_at,
  external_reference,external_purchase_id,administrative_reason
)
select 'a1000000-0000-4000-8000-000000000010',product.id,'paid','kiwify','production','active',
  clock_timestamp(),clock_timestamp()+interval '1 year','kiwify-private-reason-control',
  'kiwify-private-reason-control','Existing commercial compatibility value'
from public.products product where product.code='APP';
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000010'
     and source='kiwify'),
  'Existing commercial compatibility value',
  'non-administrative Kiwify/commercial rows are not rewritten'
);
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000010';
select ok(
  (public.get_my_entitlements()->'app'->>'has_access')::boolean,
  'Kiwify/commercial entitlement remains valid before administrative revocation'
);
reset role;
select ok(
  public.admin_revoke_commercial_access_v1(
    (select id from public.access_grants
     where user_id='a1000000-0000-4000-8000-000000000010'
       and source='kiwify'),
    'a1000000-0000-4000-8000-000000000001',
    'Kiwify support revocation stays private'
  ),
  'legacy administrative RPC can still revoke a Kiwify grant'
);
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000010'
     and source='kiwify'),
  null::text,
  'administrative revocation of a commercial grant exposes no reason publicly'
);
select is(
  (select reason from public.commercial_admin_audit
   where target_user_id='a1000000-0000-4000-8000-000000000010'
     and action='revoke'
   order by created_at desc limit 1),
  'Kiwify support revocation stays private',
  'commercial-grant revocation reason remains in closed administrative audit'
);
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000010';
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000010'
     and source='kiwify'),
  null::text,
  'commercial CUSTOMER cannot read the support revocation reason'
);
reset role;

insert into public.access_grants(
  user_id,product_id,access_type,source,environment,status,started_at,expires_at,
  external_reference,granted_by,administrative_reason
)
select 'a1000000-0000-4000-8000-000000000011',product.id,'manual','manual','legacy','active',
  clock_timestamp(),clock_timestamp()+interval '1 year','legacy:manual:privacy-control',
  'a1000000-0000-4000-8000-000000000001','Existing legacy compatibility value'
from public.products product where product.code='KNOWLEDGE';
select is(
  (select administrative_reason from public.access_grants
   where user_id='a1000000-0000-4000-8000-000000000011'),
  'Existing legacy compatibility value',
  'non-canonical legacy manual rows remain compatible'
);

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';
select is(
  (public.get_my_entitlements()->'internal_access'->>'active')::boolean,
  true,
  'OWNER internal access remains active without a commercial grant'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000002';
select is(
  (public.get_my_entitlements()->'internal_access'->>'active')::boolean,
  true,
  'STAFF internal access remains active without a commercial grant'
);
reset role;
select ok(
  (select relrowsecurity from pg_class where oid='public.access_grants'::regclass),
  'access_grants RLS remains enabled'
);
select is(
  (select count(*) from pg_policies
   where schemaname='public' and tablename='access_grants'),
  1::bigint,
  'privacy hardening does not add or broaden access_grants policies'
);
select ok(
  has_table_privilege('authenticated','public.access_grants','SELECT')
  and not has_table_privilege('authenticated','public.access_grants','INSERT')
  and not has_table_privilege('authenticated','public.access_grants','UPDATE')
  and not has_table_privilege('authenticated','public.access_grants','DELETE'),
  'authenticated access_grants privileges remain read-only'
);
select ok(
  not has_table_privilege('authenticated','admin_private.admin_audit_events','SELECT'),
  'CUSTOMER cannot read the private audit source of administrative reasons'
);
select ok(
  not has_table_privilege('authenticated','public.commercial_admin_audit','SELECT'),
  'CUSTOMER cannot read the closed legacy administrative audit source'
);
select is(
  (select status from public.access_grants grant_row
   join public.products product on product.id=grant_row.product_id
   where grant_row.user_id='a1000000-0000-4000-8000-000000000006'
     and product.code='APP'),
  'revoked',
  'revoked administrative grants remain available as immutable history'
);

select * from finish();
rollback;
