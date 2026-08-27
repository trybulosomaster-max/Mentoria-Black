begin;
create extension if not exists pgtap;
select no_plan();

select has_schema('admin_private', 'administrative objects use a dedicated private schema');
select has_table('admin_private', 'admin_members', 'admin membership table exists');
select has_table('admin_private', 'admin_permission_catalog', 'permission catalog exists');
select has_table('admin_private', 'admin_member_permissions', 'relational STAFF permissions exist');
select has_table('admin_private', 'admin_audit_events', 'immutable administrative audit exists');
select has_table('admin_private', 'admin_operation_requests', 'idempotency ledger exists');
select has_table('admin_private', 'admin_rate_limit_windows', 'durable PostgreSQL rate limit windows exist');
select has_table('admin_private', 'admin_rate_limit_requests', 'mutation rate admissions are idempotent');
select is((select count(*) from admin_private.admin_permission_catalog), 7::bigint, 'permission catalog has seven v1 permissions');
select is((select count(*) from admin_private.admin_permission_catalog where staff_assignable), 5::bigint, 'only five permissions are STAFF assignable');
select is((select count(*) from admin_private.admin_permission_catalog where permission_key in ('staff.read','staff.manage') and not staff_assignable), 2::bigint, 'staff management permissions are OWNER-only');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'admin_private.admin_members'::regclass,
  'admin_private.admin_permission_catalog'::regclass,
  'admin_private.admin_member_permissions'::regclass,
  'admin_private.admin_audit_events'::regclass,
  'admin_private.admin_operation_requests'::regclass,
  'admin_private.admin_rate_limit_windows'::regclass,
  'admin_private.admin_rate_limit_requests'::regclass
)), 'all administrative tables have RLS defense in depth');
select is((select count(*) from pg_policies where schemaname = 'admin_private'), 0::bigint, 'private tables have no client policies');
select is((select count(*) from information_schema.role_table_grants where table_schema='admin_private' and grantee in ('anon','authenticated','service_role')), 0::bigint, 'no Data API role has direct table privileges');
select ok(not has_schema_privilege('authenticated','admin_private','USAGE'), 'authenticated cannot resolve the private schema');
select ok(not has_schema_privilege('service_role','admin_private','USAGE'), 'service role is restricted to public RPCs, not private tables');

select ok((select prosecdef from pg_proc where oid='public.get_my_admin_context_v1()'::regprocedure), 'self context is a narrow security definer');
select is((select proconfig[1] from pg_proc where oid='public.get_my_admin_context_v1()'::regprocedure), 'search_path=pg_catalog', 'self context has pinned search_path');
select ok(has_function_privilege('authenticated','public.get_my_admin_context_v1()','EXECUTE'), 'authenticated can resolve only its own context');
select ok(not has_function_privilege('anon','public.get_my_admin_context_v1()','EXECUTE'), 'anon cannot resolve admin context');
select ok(not (select prosecdef from pg_proc where oid='public.has_active_access(text)'::regprocedure), 'access predicate remains security invoker');
select ok(not (select prosecdef from pg_proc where oid='public.get_my_entitlements()'::regprocedure), 'entitlement resolver remains security invoker');
select ok((select prosecdef from pg_proc where oid='public.start_my_app_trial()'::regprocedure), 'trial starter remains narrow security definer');

select ok(not has_function_privilege('authenticated','public.admin_bootstrap_first_owner_v1(uuid,uuid,text,text)','EXECUTE'), 'authenticated cannot bootstrap OWNER');
select ok(not has_function_privilege('authenticated','public.admin_search_users_v1(uuid,text,integer,timestamptz,uuid)','EXECUTE'), 'authenticated cannot enumerate users through privileged RPC');
select ok(not has_function_privilege('authenticated','public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)','EXECUTE'), 'authenticated cannot directly grant licenses');
select ok(not has_function_privilege('authenticated','public.admin_revoke_customer_license_v1(uuid,uuid,uuid,text,uuid,text)','EXECUTE'), 'authenticated cannot directly revoke licenses');
select ok(not has_function_privilege('authenticated','public.admin_add_staff_v1(uuid,uuid,text[],text,uuid,text)','EXECUTE'), 'authenticated cannot add STAFF');
select ok(not has_function_privilege('authenticated','public.admin_record_audit_event_v1(uuid,uuid,text,text,text,text,text,text,text,jsonb,uuid,text)','EXECUTE'), 'authenticated cannot forge audit events');
select ok(not has_function_privilege('authenticated','public.admin_consume_rate_limit_v1(uuid,text,uuid,text)','EXECUTE'), 'authenticated cannot manipulate durable rate counters');
select ok(has_function_privilege('service_role','public.admin_grant_customer_license_v1(uuid,uuid,text[],text,text,uuid,text)','EXECUTE'), 'service role can call the protected grant RPC');
select ok(has_function_privilege('service_role','public.admin_record_audit_event_v1(uuid,uuid,text,text,text,text,text,text,text,jsonb,uuid,text)','EXECUTE'), 'service role can record denied or failed attempts');
select ok(has_function_privilege('service_role','public.admin_consume_rate_limit_v1(uuid,text,uuid,text)','EXECUTE'), 'service role can consume the protected rate limiter');
select is((select count(*) from pg_proc where pronamespace='public'::regnamespace and proname = any(array[
  'admin_bootstrap_first_owner_v1','admin_get_user_access_v1','admin_search_users_v1',
  'admin_grant_customer_license_v1','admin_revoke_customer_license_v1','admin_list_staff_v1',
  'admin_add_staff_v1','admin_set_staff_permissions_v1','admin_set_staff_status_v1',
  'admin_list_audit_v1','admin_touch_last_access_v1','admin_record_audit_event_v1',
  'admin_consume_rate_limit_v1'
]) and prosecdef), 13::bigint, 'thirteen privileged administrative RPCs are security definers');
select ok((select bool_and(proconfig @> array['search_path=pg_catalog']) from pg_proc where pronamespace='public'::regnamespace and proname like 'admin_%_v1'), 'all administrative RPCs pin search_path');

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('11000000-0000-4000-8000-000000000001','admin-test-owner@example.invalid',clock_timestamp(),'{}'),
 ('11000000-0000-4000-8000-000000000002','admin-test-staff@example.invalid',clock_timestamp(),'{}'),
 ('11000000-0000-4000-8000-000000000003','admin-test-staff-two@example.invalid',clock_timestamp(),'{}'),
 ('11000000-0000-4000-8000-000000000004','admin-test-customer@example.invalid',clock_timestamp(),'{}'),
 ('11000000-0000-4000-8000-000000000005','admin-test-both@example.invalid',clock_timestamp(),'{}'),
 ('11000000-0000-4000-8000-000000000006','admin-test-trial@example.invalid',clock_timestamp(),'{}'),
 ('11000000-0000-4000-8000-000000000007','admin-test-paid@example.invalid',clock_timestamp(),'{}'),
 ('11000000-0000-4000-8000-000000000008','admin-test-atomic@example.invalid',clock_timestamp(),'{}');

select is(
  (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','me'
  )->>'remaining')::integer,
  119,
  'me admits the first request in its 120-per-minute bucket'
);
do $rate_me$
begin
  for i in 2..119 loop
    perform public.admin_consume_rate_limit_v1(
      '11000000-0000-4000-8000-000000000008','me'
    );
  end loop;
end
$rate_me$;
select ok(
  (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','me'
  )->>'allowed')::boolean,
  'me admits the request exactly at its limit'
);
select ok(
  not (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','me'
  )->>'allowed')::boolean,
  'me denies the request over 120 per minute'
);
select ok(
  not (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','me'
  )->>'allowed')::boolean,
  'additional requests remain denied in the exhausted window'
);
select is(
  (select count(*) from admin_private.admin_audit_events event
   where event.actor_user_id='11000000-0000-4000-8000-000000000008'
     and event.action='rate_limit.denied'
     and event.details->>'bucket'='me'),
  1::bigint,
  'rate-limit denial audit is coalesced once per actor, bucket, and window'
);

do $rate_search$
begin
  for i in 1..29 loop
    perform public.admin_consume_rate_limit_v1(
      '11000000-0000-4000-8000-000000000008','users.search'
    );
  end loop;
end
$rate_search$;
select ok(
  (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','users.search'
  )->>'allowed')::boolean,
  'users.search admits request 30'
);
select ok(
  not (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','users.search'
  )->>'allowed')::boolean,
  'users.search denies request 31'
);

do $rate_reads$
begin
  for i in 1..59 loop
    perform public.admin_consume_rate_limit_v1(
      '11000000-0000-4000-8000-000000000008','licenses.get'
    );
  end loop;
end
$rate_reads$;
select ok(
  (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','staff.list'
  )->>'allowed')::boolean,
  'other read actions share and admit request 60'
);
select ok(
  not (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','audit.list'
  )->>'allowed')::boolean,
  'the shared other-read bucket denies request 61'
);

do $rate_mutations$
declare v_request_id uuid;
begin
  for i in 1..9 loop
    v_request_id := (
      '23000000-0000-4000-8000-' || lpad(i::text, 12, '0')
    )::uuid;
    perform public.admin_consume_rate_limit_v1(
      '11000000-0000-4000-8000-000000000008','licenses.grant',
      v_request_id,repeat('1',64)
    );
  end loop;
end
$rate_mutations$;
select ok(
  (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','staff.add',
    '23000000-0000-4000-8000-000000000010',repeat('2',64)
  )->>'allowed')::boolean,
  'mutations share and admit request 10'
);
select ok(
  not (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','licenses.revoke',
    '23000000-0000-4000-8000-000000000011',repeat('3',64)
  )->>'allowed')::boolean,
  'the shared mutation bucket denies request 11'
);
select is(
  (admin_private.consume_admin_rate_limit_v1(
    '11000000-0000-4000-8000-000000000008','users.search',null,null,
    date_trunc('minute',clock_timestamp()) + interval '1 minute'
  )->>'count')::integer,
  1,
  'a new minute window starts with a fresh counter'
);
select ok(
  (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000004','users.search'
  )->>'allowed')::boolean,
  'rate windows are independent per actor'
);
select ok(
  (public.admin_consume_rate_limit_v1(
    '11000000-0000-4000-8000-000000000004','licenses.get'
  )->>'allowed')::boolean,
  'rate windows are independent per bucket'
);

create extension if not exists dblink;
select dblink_connect('rate_setup', 'dbname=' || current_database());
select dblink_exec('rate_setup', $sql$
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
  values(
    '11000000-0000-4000-8000-000000000009',
    'admin-test-concurrency@example.invalid',clock_timestamp(),'{}'
  ) on conflict (id) do nothing
$sql$);
select dblink_exec('rate_setup', $sql$
  insert into admin_private.admin_rate_limit_windows(
    actor_user_id,bucket,window_started_at,request_count,request_limit
  ) values(
    '11000000-0000-4000-8000-000000000009','users.search',
    '2099-01-01 00:00:00+00',29,30
  ) on conflict (actor_user_id,bucket,window_started_at) do update
    set request_count=29,request_limit=30
$sql$);
select dblink_disconnect('rate_setup');
select dblink_connect('rate_a', 'dbname=' || current_database());
select dblink_connect('rate_b', 'dbname=' || current_database());
select dblink_send_query('rate_a', $sql$
  select admin_private.consume_admin_rate_limit_v1(
    '11000000-0000-4000-8000-000000000009','users.search',null,null,
    '2099-01-01 00:00:30+00'
  )
$sql$);
select dblink_send_query('rate_b', $sql$
  select admin_private.consume_admin_rate_limit_v1(
    '11000000-0000-4000-8000-000000000009','users.search',null,null,
    '2099-01-01 00:00:30+00'
  )
$sql$);
create temporary table rate_concurrency_results(result jsonb) on commit drop;
insert into rate_concurrency_results(result)
select result from dblink_get_result('rate_a') as response(result jsonb);
insert into rate_concurrency_results(result)
select result from dblink_get_result('rate_b') as response(result jsonb);
select is(
  (select count(*) from rate_concurrency_results where (result->>'allowed')::boolean),
  1::bigint,
  'concurrent requests atomically admit only the remaining slot'
);
select is(
  (select request_count from admin_private.admin_rate_limit_windows
   where actor_user_id='11000000-0000-4000-8000-000000000009'
     and bucket='users.search' and window_started_at='2099-01-01 00:00:00+00'),
  30,
  'concurrent updates never exceed the durable window limit'
);
select dblink_disconnect('rate_a');
select dblink_disconnect('rate_b');

set local role authenticated;
set local request.jwt.claim.sub='11000000-0000-4000-8000-000000000004';
select is(public.get_my_admin_context_v1()->>'status','customer','CUSTOMER receives a safe empty context');
select ok(not (public.get_my_admin_context_v1()->>'is_admin')::boolean,'CUSTOMER is not an administrator');
select is(jsonb_array_length(public.get_my_admin_context_v1()->'permissions'),0,'CUSTOMER has no permissions');
select is((public.get_my_entitlements()->>'access_basis'),'none','CUSTOMER without access has a top-level none basis');
select throws_ok($$select public.admin_search_users_v1('11000000-0000-4000-8000-000000000004','admin-test-',20,null,null)$$,'42501',null,'browser cannot bypass service-only ACL');
reset role;

select is(
  public.admin_bootstrap_first_owner_v1(
    '11000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'Initial AVIORA owner bootstrap', repeat('a',64)
  )->>'role',
  'OWNER',
  'first OWNER bootstrap succeeds without commercial grants'
);
select ok((public.admin_bootstrap_first_owner_v1(
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'Initial AVIORA owner bootstrap', repeat('a',64)
)->>'idempotent')::boolean,'same OWNER bootstrap request is idempotent');
select throws_ok($$select public.admin_bootstrap_first_owner_v1(
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'Changed bootstrap payload', repeat('b',64)
)$$,'22023','idempotency request conflict','same request id with a different payload is denied');
select throws_ok($$select public.admin_bootstrap_first_owner_v1(
  '11000000-0000-4000-8000-000000000007',
  '21000000-0000-4000-8000-000000000002',
  'Second owner is forbidden', repeat('c',64)
)$$,'42501','the first OWNER has already been bootstrapped','a second bootstrap cannot create another OWNER');
select is((select count(*) from admin_private.admin_members where role='OWNER'),1::bigint,'exactly one OWNER exists');
select is((select count(*) from public.access_grants where user_id='11000000-0000-4000-8000-000000000001'),0::bigint,'OWNER bootstrap creates no commercial grant');

set local role authenticated;
set local request.jwt.claim.sub='11000000-0000-4000-8000-000000000001';
select ok((public.get_my_admin_context_v1()->>'is_admin')::boolean,'active OWNER receives admin context');
select is(public.get_my_admin_context_v1()->>'role','OWNER','OWNER role is returned to self');
select is(jsonb_array_length(public.get_my_admin_context_v1()->'permissions'),7,'OWNER receives every permission implicitly');
select ok(public.has_active_access('APP') and public.has_active_access('KNOWLEDGE'),'OWNER has derived APP and KNOWLEDGE access');
select is((public.get_my_entitlements()->'app'->>'access_basis'),'internal','OWNER APP entitlement is explicitly internal');
select is((public.get_my_entitlements()->'knowledge'->>'access_basis'),'internal','OWNER KNOWLEDGE entitlement is explicitly internal');
select is((public.get_my_entitlements()->>'access_basis'),'internal','OWNER-only entitlement has a top-level internal basis');
select is((select result from public.start_my_app_trial()),'internal_access','internal OWNER access does not start a trial');
reset role;
select is((select count(*) from public.product_trials where user_id='11000000-0000-4000-8000-000000000001'),0::bigint,'OWNER consumes no trial');

select ok((public.admin_add_staff_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000002',
  array['users.read','licenses.read','licenses.grant','licenses.revoke','audit.read'],
  'Add licensed support operator',
  '21000000-0000-4000-8000-000000000010',repeat('d',64)
)->>'status')='active','OWNER adds active STAFF');
select ok((public.admin_add_staff_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000003',
  array[]::text[],
  'Add restricted support operator',
  '21000000-0000-4000-8000-000000000011',repeat('e',64)
)->>'status')='active','OWNER can add STAFF with deny-by-default permissions');
select ok((public.admin_consume_rate_limit_v1(
  '11000000-0000-4000-8000-000000000001','me'
)->>'allowed')::boolean,'active OWNER is governed by the durable actor rate limiter');
select ok((public.admin_consume_rate_limit_v1(
  '11000000-0000-4000-8000-000000000002','me'
)->>'allowed')::boolean,'active STAFF is governed by the same durable actor rate limiter');
select throws_ok($$select public.admin_add_staff_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000007',
  array['staff.manage'],
  'Invalid staff permission',
  '21000000-0000-4000-8000-000000000012',repeat('f',64)
)$$,'22023','one or more STAFF permissions are invalid or not assignable','staff.manage is never assignable to STAFF');
select throws_ok($$insert into admin_private.admin_member_permissions(user_id,permission_key,granted_by) values(
  '11000000-0000-4000-8000-000000000002','staff.read','11000000-0000-4000-8000-000000000001'
)$$,'42501','permission cannot be assigned to STAFF in v1','table trigger also rejects OWNER-only permission assignment');

set local role authenticated;
set local request.jwt.claim.sub='11000000-0000-4000-8000-000000000002';
select ok((public.get_my_admin_context_v1()->>'is_admin')::boolean,'active STAFF receives admin context');
select is(public.get_my_admin_context_v1()->>'role','STAFF','STAFF role is returned to self');
select is(jsonb_array_length(public.get_my_admin_context_v1()->'permissions'),5,'STAFF sees only explicitly assigned permissions');
select is((select result from public.start_my_app_trial()),'internal_access','active STAFF does not consume a commercial trial');
select is((public.get_my_entitlements()->'app'->>'access_basis'),'internal','STAFF internal access is distinguished');
reset role;
select is((select count(*) from public.product_trials where user_id='11000000-0000-4000-8000-000000000002'),0::bigint,'STAFF consumes no trial');

select throws_ok($$select public.admin_add_staff_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000007',array[]::text[],
  'STAFF cannot add STAFF','21000000-0000-4000-8000-000000000013',repeat('1',64)
)$$,'42501','OWNER access required','STAFF cannot manage other STAFF');
select throws_ok($$select public.admin_list_staff_v1(
  '11000000-0000-4000-8000-000000000002',50,null,null
)$$,'42501','administrative permission denied','STAFF cannot list employees in v1');
select throws_ok($$select public.admin_set_staff_permissions_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',array['users.read'],
  'Self change denied','21000000-0000-4000-8000-000000000014',repeat('2',64)
)$$,'42501','OWNER access required','STAFF cannot change its own permissions');

select throws_ok($$select public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',array['APP'],'annual',
  'Self license denied','21000000-0000-4000-8000-000000000020',repeat('3',64)
)$$,'42501','STAFF cannot manage their own license','STAFF self-license is denied in the database');
select throws_ok($$select public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001',
  'Self revoke denied','21000000-0000-4000-8000-000000000023',repeat('3',64)
)$$,'42501','STAFF cannot manage their own license','STAFF self-revocation is denied before grant lookup');
select throws_ok($$select public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002',
  'OWNER revoke denied','21000000-0000-4000-8000-000000000024',repeat('3',64)
)$$,'42501','STAFF can only manage CUSTOMER licenses','STAFF cannot revoke an OWNER license');
select throws_ok($$select public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000003',
  'STAFF revoke denied','21000000-0000-4000-8000-000000000025',repeat('3',64)
)$$,'42501','STAFF can only manage CUSTOMER licenses','STAFF cannot revoke another STAFF license');
select ok((public.admin_record_audit_event_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',
  'licenses.grant','licenses.grant','APP','annual','Self license denied','denied','self_license_denied',
  jsonb_build_object('safe_context','test'),
  '21000000-0000-4000-8000-000000000020',repeat('3',64)
)->>'recorded')::boolean,'server audit finalizes a denied mutation request');
select ok((public.admin_record_audit_event_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',
  'licenses.grant','licenses.grant','APP','annual','Self license denied','denied','self_license_denied',
  jsonb_build_object('safe_context','test'),
  '21000000-0000-4000-8000-000000000020',repeat('3',64)
)->>'idempotent')::boolean,'same denied mutation retry returns the persisted result');
select throws_ok($$select public.admin_record_audit_event_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000002',
  'licenses.grant','licenses.grant','APP','annual','Changed denied payload','denied','self_license_denied',
  '{}'::jsonb,'21000000-0000-4000-8000-000000000020',repeat('4',64)
)$$,'22023','idempotency request conflict','failed request ID cannot be reused with a different payload');
select throws_ok($$select public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000001',array['APP'],'annual',
  'OWNER target denied','21000000-0000-4000-8000-000000000021',repeat('4',64)
)$$,'42501','STAFF can only manage CUSTOMER licenses','STAFF cannot target OWNER');
select throws_ok($$select public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000003',array['APP'],'annual',
  'STAFF target denied','21000000-0000-4000-8000-000000000022',repeat('5',64)
)$$,'42501','STAFF can only manage CUSTOMER licenses','STAFF cannot target another STAFF');
select throws_ok($$select public.admin_get_user_access_v1(
  '11000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001'
)$$,'42501','STAFF can only manage CUSTOMER licenses','STAFF cannot inspect OWNER license details');

select is(jsonb_array_length(public.admin_search_users_v1(
  '11000000-0000-4000-8000-000000000001','admin-test-',20,null,null
)->'users'),9,'OWNER user search can see all matching users');
select is(jsonb_array_length(public.admin_search_users_v1(
  '11000000-0000-4000-8000-000000000002','admin-test-',20,null,null
)->'users'),6,'STAFF user search excludes all administrative members');
select is(jsonb_array_length(public.admin_search_users_v1(
  '11000000-0000-4000-8000-000000000001','%__',20,null,null
)->'users'),0,'search treats SQL wildcard characters as literal text');
select throws_ok($$select public.admin_search_users_v1(
  '11000000-0000-4000-8000-000000000001','ab',20,null,null
)$$,'22023','user search requires at least 3 characters','short searches cannot enumerate users');

select ok((public.admin_consume_rate_limit_v1(
  '11000000-0000-4000-8000-000000000002','licenses.grant',
  '21000000-0000-4000-8000-000000000030',repeat('6',64)
)->>'allowed')::boolean,'first mutation request consumes one rate-limit slot');
select is(jsonb_array_length(public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000004',array['APP'],'annual',
  'Annual APP support license','21000000-0000-4000-8000-000000000030',repeat('6',64)
)->'grants'),1,'authorized STAFF grants annual APP to another CUSTOMER');
select ok((
  select g.expires_at = g.started_at + interval '1 year'
    and g.access_type='manual' and g.source='manual'
    and g.external_reference like 'aviora-admin:v1:%'
  from public.access_grants g
  join public.products p on p.id=g.product_id
  where g.user_id='11000000-0000-4000-8000-000000000004' and p.code='APP'
), 'annual expiry is calculated server-side and grant provenance is canonical');
select ok((public.admin_consume_rate_limit_v1(
  '11000000-0000-4000-8000-000000000002','licenses.grant',
  '21000000-0000-4000-8000-000000000030',repeat('6',64)
)->>'idempotent_replay')::boolean,'completed mutation retry is recognized after consuming a new rate slot');
select throws_ok($$select public.admin_consume_rate_limit_v1(
  '11000000-0000-4000-8000-000000000002','licenses.grant',
  '21000000-0000-4000-8000-000000000030',repeat('7',64)
)$$,'22023','idempotency request conflict','rate limiter rejects request ID reuse with a different payload hash');
select is((
  select sum(request_count)::integer from admin_private.admin_rate_limit_windows
  where actor_user_id='11000000-0000-4000-8000-000000000002'
    and bucket='mutations'
),2,'first request and its idempotent retry each consume a durable rate slot');
select ok((public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000004',array['APP'],'annual',
  'Annual APP support license','21000000-0000-4000-8000-000000000030',repeat('6',64)
)->>'idempotent')::boolean,'completed grant retry returns the prior response');
select is((select count(*) from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='11000000-0000-4000-8000-000000000004' and p.code='APP'),1::bigint,'idempotent retry creates no duplicate grant');
do $mutation_replays$
declare v_rate jsonb; v_business jsonb;
begin
  for i in 1..8 loop
    v_rate := public.admin_consume_rate_limit_v1(
      '11000000-0000-4000-8000-000000000002','licenses.grant',
      '21000000-0000-4000-8000-000000000030',repeat('6',64)
    );
    if not (v_rate->>'allowed')::boolean
       or not (v_rate->>'idempotent_replay')::boolean then
      raise exception 'expected admitted idempotent replay before mutation limit';
    end if;
    v_business := public.admin_grant_customer_license_v1(
      '11000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000004',array['APP'],'annual',
      'Annual APP support license','21000000-0000-4000-8000-000000000030',repeat('6',64)
    );
    if not (v_business->>'idempotent')::boolean then
      raise exception 'business mutation replay was not idempotent';
    end if;
  end loop;
end
$mutation_replays$;
select is((
  select sum(request_count)::integer from admin_private.admin_rate_limit_windows
  where actor_user_id='11000000-0000-4000-8000-000000000002'
    and bucket='mutations'
),10,'ten calls with one request ID consume the complete mutation quota');
select ok(not (public.admin_consume_rate_limit_v1(
  '11000000-0000-4000-8000-000000000002','licenses.grant',
  '21000000-0000-4000-8000-000000000030',repeat('6',64)
)->>'allowed')::boolean,'the eleventh idempotent replay is rate limited');
select is((select count(*) from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='11000000-0000-4000-8000-000000000004' and p.code='APP'),1::bigint,'rate-limited replay leaves exactly one business grant');
select throws_ok($$select public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000004',array['APP'],'annual',
  'Changed request payload','21000000-0000-4000-8000-000000000030',repeat('7',64)
)$$,'22023','idempotency request conflict','same request ID with a different hash is denied');

select is(jsonb_array_length(public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000005',array['APP','KNOWLEDGE'],'lifetime',
  'Lifetime complete customer access','21000000-0000-4000-8000-000000000031',repeat('8',64)
)->'grants'),2,'APP plus KNOWLEDGE are granted atomically');
select is((select count(*) from public.access_grants g where g.user_id='11000000-0000-4000-8000-000000000005' and g.access_type='lifetime' and g.expires_at is null),2::bigint,'lifetime grants use null expiration, never 2099');
select is((select count(distinct split_part(g.external_reference,':',3)) from public.access_grants g where g.user_id='11000000-0000-4000-8000-000000000005'),1::bigint,'both product grants share the operation request provenance');

create function pg_temp.fail_atomic_knowledge_grant_v1()
returns trigger
language plpgsql
as $$
begin
  if new.user_id = '11000000-0000-4000-8000-000000000008'::uuid
     and exists (
       select 1 from public.products p
       where p.id = new.product_id and p.code = 'KNOWLEDGE'
     ) then
    raise exception 'synthetic KNOWLEDGE insert failure';
  end if;
  return new;
end
$$;
create trigger fail_atomic_knowledge_grant_v1
before insert on public.access_grants
for each row execute function pg_temp.fail_atomic_knowledge_grant_v1();
select throws_ok($$select public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000008',array['APP','KNOWLEDGE'],'annual',
  'Atomic rollback verification','21000000-0000-4000-8000-000000000034',repeat('4',64)
)$$,'P0001','synthetic KNOWLEDGE insert failure','failure on the second product aborts the combined grant operation');
drop trigger fail_atomic_knowledge_grant_v1 on public.access_grants;
select is((select count(*) from public.access_grants where user_id='11000000-0000-4000-8000-000000000008'),0::bigint,'APP insert rolls back when KNOWLEDGE fails in the same operation');
select is((select count(*) from admin_private.admin_operation_requests where request_id='21000000-0000-4000-8000-000000000034'),0::bigint,'failed transaction leaves no misleading succeeded idempotency row');

insert into public.access_grants(
  user_id,product_id,access_type,source,status,started_at,expires_at,
  external_reference,granted_by,administrative_reason
)
select '11000000-0000-4000-8000-000000000008',p.id,'manual','manual','active',
  clock_timestamp(),clock_timestamp()+interval '1 year',
  'aviora-admin:v1:21000000-0000-4000-8000-000000000099:APP',
  '11000000-0000-4000-8000-000000000001','Forged surface provenance test'
from public.products p where p.code='APP';
select throws_ok($$select public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000008',
  (select g.id from public.access_grants g where g.user_id='11000000-0000-4000-8000-000000000008'),
  'Must reject forged prefix','21000000-0000-4000-8000-000000000045',repeat('5',64)
)$$,'42501','only AVIORA administrative grants may be revoked here','canonical-looking prefix without operation and audit linkage cannot be revoked');
select is((select status from public.access_grants where user_id='11000000-0000-4000-8000-000000000008'),'active','forged-prefix grant remains untouched');

select is(jsonb_array_length(public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',array['APP'],'lifetime',
  'OWNER self-managed lifetime APP','21000000-0000-4000-8000-000000000033',repeat('0',64)
)->'grants'),1,'OWNER may administer its own commercial license explicitly');
select ok((public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  (select g.id from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='11000000-0000-4000-8000-000000000001' and p.code='APP'),
  'OWNER self-managed grant revoked','21000000-0000-4000-8000-000000000044',repeat('0',64)
)->>'revoked')::boolean,'OWNER may revoke its own AVIORA administrative grant');
select throws_ok($$select public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000007',array['APP','INVALID'],'lifetime',
  'Invalid atomic product set','21000000-0000-4000-8000-000000000032',repeat('9',64)
)$$,'22023','only APP and KNOWLEDGE may be licensed','invalid product prevents the whole operation');
select is((select count(*) from public.access_grants where user_id='11000000-0000-4000-8000-000000000007'),0::bigint,'failed atomic product set inserts zero grants');

select ok((public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000004',
  (select g.id from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='11000000-0000-4000-8000-000000000004' and p.code='APP'),
  'Customer no longer requires support access',
  '21000000-0000-4000-8000-000000000040',repeat('a',64)
)->>'revoked')::boolean,'STAFF revokes a specific AVIORA administrative grant');
select is((select status from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='11000000-0000-4000-8000-000000000004' and p.code='APP'),'revoked','administrative grant is marked revoked');
select ok((public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000004',
  (select g.id from public.access_grants g join public.products p on p.id=g.product_id where g.user_id='11000000-0000-4000-8000-000000000004' and p.code='APP'),
  'Customer no longer requires support access',
  '21000000-0000-4000-8000-000000000040',repeat('a',64)
)->>'idempotent')::boolean,'revocation retry is idempotent');

insert into public.access_grants(
  user_id,product_id,access_type,source,environment,status,started_at,expires_at,
  external_reference,external_purchase_id
)
select '11000000-0000-4000-8000-000000000007',p.id,'paid','asaas','sandbox','active',
  clock_timestamp(),clock_timestamp()+interval '30 days','paid-admin-test','paid-admin-test'
from public.products p where p.code='APP';
select throws_ok($$select public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000007',
  (select g.id from public.access_grants g where g.user_id='11000000-0000-4000-8000-000000000007'),
  'Must not revoke paid access','21000000-0000-4000-8000-000000000041',repeat('b',64)
)$$,'42501','only AVIORA administrative grants may be revoked here','paid/provider grant cannot be revoked by Administration');
select is((select status from public.access_grants where user_id='11000000-0000-4000-8000-000000000007'),'active','failed admin revoke preserves paid grant');

set local role authenticated;
set local request.jwt.claim.sub='11000000-0000-4000-8000-000000000006';
select is((select result from public.start_my_app_trial()),'started','ordinary CUSTOMER can still start trial');
reset role;
select throws_ok($$select public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000006',
  (select g.id from public.access_grants g where g.user_id='11000000-0000-4000-8000-000000000006' and g.access_type='trial'),
  'Must not revoke trial access','21000000-0000-4000-8000-000000000042',repeat('c',64)
)$$,'42501','only AVIORA administrative grants may be revoked here','trial grant cannot be revoked by Administration');
select is((select status from public.access_grants where user_id='11000000-0000-4000-8000-000000000006' and access_type='trial'),'active','failed admin revoke preserves trial');

insert into public.access_grants(
  user_id,product_id,access_type,source,status,started_at,expires_at,
  external_reference,granted_by,administrative_reason
)
select '11000000-0000-4000-8000-000000000007',p.id,'manual','manual','active',
  clock_timestamp(),clock_timestamp()+interval '1 day','admin:legacy-reference',
  '11000000-0000-4000-8000-000000000001','Legacy manual support'
from public.products p where p.code='KNOWLEDGE';
select throws_ok($$select public.admin_revoke_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000007',
  (select g.id from public.access_grants g where g.user_id='11000000-0000-4000-8000-000000000007' and g.access_type='manual'),
  'Must not revoke legacy manual access','21000000-0000-4000-8000-000000000043',repeat('d',64)
)$$,'42501','only AVIORA administrative grants may be revoked here','manual grant without canonical AVIORA prefix cannot be revoked');

insert into public.access_grants(
  user_id,product_id,access_type,source,environment,status,started_at,expires_at,
  external_reference,external_purchase_id
)
select '11000000-0000-4000-8000-000000000002',p.id,'paid','asaas','sandbox','active',
  clock_timestamp(),clock_timestamp()+interval '30 days','paid-admin-staff','paid-admin-staff'
from public.products p where p.code='APP';
set local role authenticated;
set local request.jwt.claim.sub='11000000-0000-4000-8000-000000000002';
select is((public.get_my_entitlements()->'app'->>'access_basis'),'internal_and_commercial','commercial and internal access remain distinguishable');
select is((public.get_my_entitlements()->>'access_basis'),'internal_and_commercial','combined access has a top-level internal-and-commercial basis');
reset role;
update public.access_grants
set status='grace_period', grace_until=clock_timestamp()+interval '2 days'
where user_id='11000000-0000-4000-8000-000000000002' and source='asaas';
set local role authenticated;
set local request.jwt.claim.sub='11000000-0000-4000-8000-000000000002';
select is((public.get_my_entitlements()->'app'->>'commercial_state'),'payment_attention','internal access does not mask commercial grace/payment attention semantics');
reset role;
update public.access_grants
set status='active', grace_until=null
where user_id='11000000-0000-4000-8000-000000000002' and source='asaas';

select is(public.admin_set_staff_status_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000002','disabled',
  'Employee access suspended','21000000-0000-4000-8000-000000000050',repeat('e',64)
)->>'status','disabled','OWNER disables STAFF without deleting user');
set local role authenticated;
set local request.jwt.claim.sub='11000000-0000-4000-8000-000000000002';
select ok(not (public.get_my_admin_context_v1()->>'is_admin')::boolean,'disabled STAFF immediately loses admin context');
select is((public.get_my_entitlements()->'app'->>'access_basis'),'commercial','disabled STAFF retains independent paid commercial license');
select is((public.get_my_entitlements()->>'access_basis'),'commercial','commercial-only access has a top-level commercial basis');
select ok(public.has_active_access('APP'),'disabled STAFF keeps legitimate commercial access');
reset role;
select is((select count(*) from public.access_grants where user_id='11000000-0000-4000-8000-000000000002' and source='asaas'),1::bigint,'disabling STAFF never deletes commercial grants');
select throws_ok($$select public.admin_search_users_v1(
  '11000000-0000-4000-8000-000000000002','admin-test-',20,null,null
)$$,'42501','administrative access denied','disabled STAFF is denied even with an unexpired JWT');

select is(public.admin_set_staff_status_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000002','active',
  'Employee access restored','21000000-0000-4000-8000-000000000051',repeat('f',64)
)->>'status','active','OWNER can reactivate STAFF');
select is(jsonb_array_length(public.admin_set_staff_permissions_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000002',array['users.read','licenses.read'],
  'Restrict employee permissions','21000000-0000-4000-8000-000000000052',repeat('1',64)
)->'permissions'),2,'OWNER replaces STAFF permissions relationally');
select throws_ok($$select public.admin_grant_customer_license_v1(
  '11000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000004',array['APP'],'annual',
  'Permission was removed','21000000-0000-4000-8000-000000000053',repeat('2',64)
)$$,'42501','administrative permission denied','STAFF loses removed permission immediately');

select throws_ok($$update admin_private.admin_members set status='disabled',disabled_at=clock_timestamp(),disabled_by='11000000-0000-4000-8000-000000000001' where role='OWNER'$$,'42501','OWNER status cannot be changed in v1','OWNER cannot be disabled directly');
select throws_ok($$update admin_private.admin_members set role='OWNER' where user_id='11000000-0000-4000-8000-000000000003'$$,'42501','admin role transitions are not supported in v1','STAFF cannot be promoted by direct update');
select throws_ok($$delete from admin_private.admin_members where role='OWNER'$$,'42501','admin members cannot be deleted in v1','last OWNER cannot be deleted');
select is((select count(*) from admin_private.admin_members where role='OWNER' and status='active'),1::bigint,'one active OWNER remains');

select ok((public.admin_record_audit_event_v1(
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000004',
  'licenses.grant','licenses.grant','APP','annual','Synthetic denied attempt','denied','permission_denied',
  jsonb_build_object('safe_context','test'),
  '21000000-0000-4000-8000-000000000060',null
)->>'recorded')::boolean,'server layer can record a bounded denied attempt');
select ok((public.admin_record_audit_event_v1(
  '11000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000099',
  'licenses.grant','licenses.grant',null,'lifetime','Unknown target denied','denied','invalid_operation',
  jsonb_build_object('http_status',422,'product_codes',jsonb_build_array('APP','KNOWLEDGE')),
  '21000000-0000-4000-8000-000000000061',repeat('6',64)
)->>'recorded')::boolean,'unknown target denial is persisted without violating the Auth foreign key');
select ok((public.admin_record_audit_event_v1(
  '11000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000099',
  'licenses.grant','licenses.grant',null,'lifetime','Unknown target denied','denied','invalid_operation',
  jsonb_build_object('http_status',422,'product_codes',jsonb_build_array('APP','KNOWLEDGE')),
  '21000000-0000-4000-8000-000000000061',repeat('6',64)
)->>'idempotent')::boolean,'unknown target denial preserves failed-operation idempotency');
select is((select target_user_id from admin_private.admin_audit_events where request_id='21000000-0000-4000-8000-000000000061'),null::uuid,'unknown target is normalized to NULL in the audit foreign key');
select is((select details->>'attempted_target_user_id' from admin_private.admin_audit_events where request_id='21000000-0000-4000-8000-000000000061'),'99000000-0000-4000-8000-000000000099','attempted target UUID remains in bounded audit details');
select is((select details->'product_codes' from admin_private.admin_audit_events where request_id='21000000-0000-4000-8000-000000000061'),jsonb_build_array('APP','KNOWLEDGE'),'combined denied grant retains both requested product codes');
select is((select license_kind from admin_private.admin_audit_events where request_id='21000000-0000-4000-8000-000000000061'),'lifetime','denied grant retains the requested license kind');
select ok((select count(*) >= 1 from admin_private.admin_audit_events where action='licenses.grant' and result='denied'),'denied attempts remain in immutable audit');
select ok((select count(*) >= 2 from admin_private.admin_audit_events where action='licenses.grant' and result='succeeded'),'successful grants are audited atomically per product');
select ok((select count(*) >= 1 from admin_private.admin_audit_events where action='licenses.revoke' and result='succeeded'),'successful revocation is audited');
select ok((select count(*) >= 1 from admin_private.admin_audit_events where action='staff.permission.added' and permission_key='users.read'),'permission additions are individually auditable');
select ok((select count(*) >= 1 from admin_private.admin_audit_events where action='staff.permission.removed' and permission_key='licenses.grant'),'permission removals are individually auditable');
select ok((select count(*) >= 1 from admin_private.admin_audit_events where action='staff.disabled' and result='succeeded'),'STAFF deactivation is explicit in audit');
select is(jsonb_array_length(public.admin_list_audit_v1(
  '11000000-0000-4000-8000-000000000001',100,null,null,null,null
)->'events'),(select count(*)::integer from admin_private.admin_audit_events),'OWNER can list the complete audit page');
select is(jsonb_array_length(public.admin_list_staff_v1(
  '11000000-0000-4000-8000-000000000001',50,null,null
)->'staff'),2,'OWNER can list STAFF records without deleting history');
select ok((public.admin_touch_last_access_v1('11000000-0000-4000-8000-000000000001')->>'last_admin_access_at') is not null,'active admin last access can be touched server-side');

set local role authenticated;
set local request.jwt.claim.sub='11000000-0000-4000-8000-000000000004';
select throws_ok($$select * from admin_private.admin_members$$,'42501',null,'authenticated cannot read private membership table');
select throws_ok($$insert into admin_private.admin_members(user_id,role,status,created_via) values(gen_random_uuid(),'OWNER','active','bootstrap')$$,'42501',null,'authenticated cannot write private membership table');
reset role;

select * from finish();
rollback;
