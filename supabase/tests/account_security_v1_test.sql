begin;
create extension if not exists pgtap;
select no_plan();

select has_table('admin_private', 'admin_password_recovery_rate_windows', 'hourly recovery windows are durable');
select has_table('admin_private', 'admin_password_recovery_rate_requests', 'recovery rate admissions are idempotent');
select has_table('admin_private', 'admin_password_recovery_requests', 'recovery dispatch reservations are durable');
select is((select count(*) from admin_private.admin_permission_catalog), 9::bigint, 'permission catalog contains nine account/admin permissions');
select is((select count(*) from admin_private.admin_permission_catalog where enabled), 8::bigint, 'only implemented permissions are enabled');
select is((select count(*) from admin_private.admin_permission_catalog where staff_assignable), 6::bigint, 'password recovery is the sixth STAFF-assignable permission');
select ok((select enabled and staff_assignable from admin_private.admin_permission_catalog where permission_key='users.password_recovery'), 'password recovery is enabled and STAFF assignable');
select ok((select not enabled and not staff_assignable from admin_private.admin_permission_catalog where permission_key='users.sessions_revoke'), 'third-party session revoke is reserved and inactive');

select ok(exists(
  select 1
  from pg_indexes i
  where i.schemaname='admin_private'
    and i.tablename='admin_rate_limit_requests'
    and i.indexname='admin_rate_limit_requests_window_fk_idx'
    and i.indexdef like '%(actor_user_id, bucket, window_started_at)%'
), 'the prior rate-limit foreign key has its exact covering index');

select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'admin_private.admin_password_recovery_rate_windows'::regclass,
  'admin_private.admin_password_recovery_rate_requests'::regclass,
  'admin_private.admin_password_recovery_requests'::regclass
)), 'all new private tables have RLS defense in depth');
select is((select count(*) from pg_policies where schemaname='admin_private'), 0::bigint, 'private account-security tables expose no policies');
select is((select count(*) from information_schema.role_table_grants where table_schema='admin_private' and grantee in ('anon','authenticated','service_role')), 0::bigint, 'no Data API role has direct account-security table privileges');

select ok((select prosecdef from pg_proc where oid='public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)'::regprocedure), 'prepare recovery is SECURITY DEFINER');
select ok((select prosecdef from pg_proc where oid='public.admin_complete_password_recovery_v1(uuid,uuid,uuid,text,text,text)'::regprocedure), 'complete recovery is SECURITY DEFINER');
select is((select proconfig[1] from pg_proc where oid='public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)'::regprocedure), 'search_path=pg_catalog', 'prepare recovery pins search_path');
select is((select proconfig[1] from pg_proc where oid='public.admin_complete_password_recovery_v1(uuid,uuid,uuid,text,text,text)'::regprocedure), 'search_path=pg_catalog', 'complete recovery pins search_path');
select ok(not has_function_privilege('authenticated','public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)','EXECUTE'), 'authenticated cannot call recovery prepare directly');
select ok(not has_function_privilege('authenticated','public.admin_complete_password_recovery_v1(uuid,uuid,uuid,text,text,text)','EXECUTE'), 'authenticated cannot forge recovery completion');
select ok(has_function_privilege('service_role','public.admin_prepare_password_recovery_v1(uuid,uuid,text,uuid,text)','EXECUTE'), 'service role can call recovery prepare');
select ok(has_function_privilege('service_role','public.admin_complete_password_recovery_v1(uuid,uuid,uuid,text,text,text)','EXECUTE'), 'service role can call recovery completion');

select is((
  select count(*)
  from information_schema.columns c
  where c.table_schema='admin_private'
    and c.table_name like 'admin_password_recovery%'
    and c.column_name ~ '(password|token|jwt|reset_url|email)'
), 0::bigint, 'no recovery table has a password, token, JWT, reset URL, or email column');

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('31000000-0000-4000-8000-000000000001','account-owner@example.invalid',clock_timestamp(),'{}'),
 ('31000000-0000-4000-8000-000000000002','account-staff@example.invalid',clock_timestamp(),'{}'),
 ('31000000-0000-4000-8000-000000000003','account-staff-two@example.invalid',clock_timestamp(),'{}'),
 ('31000000-0000-4000-8000-000000000004','account-customer@example.invalid',clock_timestamp(),'{}'),
 ('31000000-0000-4000-8000-000000000005','account-customer-two@example.invalid',clock_timestamp(),'{}'),
 ('31000000-0000-4000-8000-000000000006','account-customer-three@example.invalid',clock_timestamp(),'{}'),
 ('31000000-0000-4000-8000-000000000007','account-customer-four@example.invalid',clock_timestamp(),'{}'),
 ('31000000-0000-4000-8000-000000000008','account-customer-five@example.invalid',clock_timestamp(),'{}');

select is(public.admin_bootstrap_first_owner_v1(
  '31000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'Account security OWNER bootstrap', repeat('a',64)
)->>'role','OWNER','test OWNER bootstrap succeeds');

select is(
  admin_private.effective_permissions_v1('31000000-0000-4000-8000-000000000001') @> array['users.password_recovery'],
  true,
  'OWNER implicitly receives enabled password recovery'
);
select is(
  admin_private.effective_permissions_v1('31000000-0000-4000-8000-000000000001') @> array['users.sessions_revoke'],
  false,
  'OWNER does not receive reserved third-party session revoke'
);
select throws_ok(
  $$select admin_private.assert_actor_permission_v1(
    '31000000-0000-4000-8000-000000000001','users.sessions_revoke'
  )$$,
  '42501',
  'administrative permission is not enabled',
  'reserved sessions-revoke permission is denied even to OWNER'
);

select is(
  public.admin_add_staff_v1(
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
    array['users.read','users.password_recovery'],
    'Authorize recovery support STAFF',
    '32000000-0000-4000-8000-000000000002',repeat('b',64)
  )->>'role',
  'STAFF',
  'OWNER can assign password recovery to STAFF'
);
select is(
  public.admin_add_staff_v1(
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000003',
    array['users.read'],
    'Add second STAFF for target protection',
    '32000000-0000-4000-8000-000000000003',repeat('c',64)
  )->>'role',
  'STAFF',
  'second STAFF fixture is active'
);
select throws_ok(
  $$select public.admin_set_staff_permissions_v1(
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
    array['users.sessions_revoke'],
    'Reserved permission must stay unavailable',
    '32000000-0000-4000-8000-000000000004',repeat('d',64)
  )$$,
  '22023',
  'one or more STAFF permissions are invalid or not assignable',
  'OWNER cannot assign reserved sessions revoke to STAFF'
);

select ok((public.admin_consume_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001',
  'users.password_recovery',
  '32500000-0000-4000-8000-000000000001',repeat('e',64)
)->>'allowed')::boolean,'shared mutation limiter admits password recovery');
select is((select action from admin_private.admin_rate_limit_requests where request_id='32500000-0000-4000-8000-000000000001'),'users.password_recovery','shared limiter persists the recovery action receipt');

select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000004',
    'authorization: Bearer secret-value',
    '32900000-0000-4000-8000-000000000001',repeat('f',64)
  )$$,
  '22023','password recovery reason contains forbidden secret material','Bearer material cannot enter a recovery reason'
);
select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000004',
    'Reset https://example.invalid/reset?code=sensitive',
    '32900000-0000-4000-8000-000000000002',repeat('f',64)
  )$$,
  '22023','password recovery reason contains forbidden secret material','reset URLs containing a code cannot enter a recovery reason'
);
select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000004',
    'JWT abcdefgh.ijklmnop.qrstuvwx',
    '32900000-0000-4000-8000-000000000003',repeat('f',64)
  )$$,
  '22023','password recovery reason contains forbidden secret material','JWT-like material cannot enter a recovery reason'
);
select is((select count(*) from admin_private.admin_password_recovery_requests where request_id::text like '32900000-%'),0::bigint,'rejected secret material is never persisted');

select is(
  public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000004',
    'OWNER requested customer recovery',
    '33000000-0000-4000-8000-000000000001',repeat('1',64)
  )->>'target_email',
  'account-customer@example.invalid',
  'OWNER prepare returns target email only to the server-side caller'
);
select is((select status from admin_private.admin_password_recovery_requests where request_id='33000000-0000-4000-8000-000000000001'),'prepared','prepare reserves a minimal dispatch record');
select is((select count(*) from admin_private.admin_audit_events where request_id='33000000-0000-4000-8000-000000000001'),0::bigint,'prepare does not falsely audit delivery before Auth responds');
select ok(position('account-customer@example.invalid' in coalesce((select to_jsonb(r)::text from admin_private.admin_password_recovery_requests r where request_id='33000000-0000-4000-8000-000000000001'),''))=0,'target email is not persisted in recovery reservation');

select ok((public.admin_complete_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000004',
  '33000000-0000-4000-8000-000000000001',repeat('1',64),
  'succeeded',null
)->>'requested')::boolean,'official Auth delivery success completes the reservation');
select is((select status from admin_private.admin_password_recovery_requests where request_id='33000000-0000-4000-8000-000000000001'),'succeeded','successful delivery status is durable');
select is((select action from admin_private.admin_audit_events where request_id='33000000-0000-4000-8000-000000000001'),'user.password_recovery.requested','recovery uses the required audit action');
select is((select permission_key from admin_private.admin_audit_events where request_id='33000000-0000-4000-8000-000000000001'),'users.password_recovery','recovery audit names its permission');
select is((select result from admin_private.admin_audit_events where request_id='33000000-0000-4000-8000-000000000001'),'succeeded','successful recovery request is audited');
select ok(position('account-customer@example.invalid' in coalesce((select response::text from admin_private.admin_operation_requests where request_id='33000000-0000-4000-8000-000000000001'),''))=0,'operation response never stores target email');
select ok(position('token' in coalesce((select details::text from admin_private.admin_audit_events where request_id='33000000-0000-4000-8000-000000000001'),''))=0,'audit contains no recovery token field');

select ok((public.admin_prepare_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'OWNER requested recovery for own account',
  '33000000-0000-4000-8000-000000000009',repeat('a',64)
)->>'send_required')::boolean,'OWNER may use the administrative recovery path for self');
select is(public.admin_complete_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000009',repeat('a',64),
  'failed','delivery_failed'
)->>'result','failed','OWNER self-recovery completion remains auditable');
select ok((public.admin_prepare_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000003',
  'OWNER requested recovery for STAFF account',
  '33000000-0000-4000-8000-000000000010',repeat('b',64)
)->>'send_required')::boolean,'OWNER may request recovery for STAFF');
select is(public.admin_complete_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000003',
  '33000000-0000-4000-8000-000000000010',repeat('b',64),
  'failed','delivery_failed'
)->>'result','failed','OWNER-to-STAFF recovery completion remains auditable');

select ok((public.admin_prepare_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000004',
  'OWNER requested customer recovery',
  '33000000-0000-4000-8000-000000000001',repeat('1',64)
)->>'idempotent')::boolean,'completed prepare retry is idempotent');
select ok(not (public.admin_prepare_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000004',
  'OWNER requested customer recovery',
  '33000000-0000-4000-8000-000000000001',repeat('1',64)
)->>'send_required')::boolean,'completed retry never sends a second recovery email');
select ok((public.admin_complete_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000004',
  '33000000-0000-4000-8000-000000000001',repeat('1',64),
  'succeeded',null
)->>'idempotent')::boolean,'completion retry is idempotent');
select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000004',
    'OWNER requested customer recovery',
    '33000000-0000-4000-8000-000000000001',repeat('2',64)
  )$$,
  '22023','idempotency request conflict','same request ID with a different payload is denied'
);

select is(
  public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000005',
    'STAFF requested CUSTOMER recovery',
    '33000000-0000-4000-8000-000000000002',repeat('3',64)
  )->>'target_email',
  'account-customer-two@example.invalid',
  'authorized STAFF can prepare recovery for another CUSTOMER'
);
select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000002',
    'STAFF attempted administrative self recovery',
    '33000000-0000-4000-8000-000000000003',repeat('4',64)
  )$$,
  '42501','STAFF cannot request administrative recovery for self','STAFF administrative self recovery is denied'
);
select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000001',
    'STAFF attempted OWNER recovery',
    '33000000-0000-4000-8000-000000000004',repeat('5',64)
  )$$,
  '42501','STAFF can request recovery only for CUSTOMER users','OWNER is protected from STAFF recovery actions'
);
select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000003',
    'STAFF attempted peer STAFF recovery',
    '33000000-0000-4000-8000-000000000005',repeat('6',64)
  )$$,
  '42501','STAFF can request recovery only for CUSTOMER users','peer STAFF is protected from STAFF recovery actions'
);
select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000004',
    '31000000-0000-4000-8000-000000000005',
    'CUSTOMER attempted administrative recovery',
    '33000000-0000-4000-8000-000000000006',repeat('7',64)
  )$$,
  '42501','administrative access denied','CUSTOMER cannot use administrative recovery'
);

select is(public.admin_set_staff_status_v1(
  '31000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000003',
  'disabled','Disable STAFF for recovery regression',
  '33000000-0000-4000-8000-000000000007',repeat('8',64)
)->>'result','succeeded','OWNER can disable the second STAFF fixture');
select throws_ok(
  $$select public.admin_prepare_password_recovery_v1(
    '31000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000006',
    'Disabled STAFF attempted recovery',
    '33000000-0000-4000-8000-000000000008',repeat('9',64)
  )$$,
  '42501','administrative access denied','disabled STAFF immediately loses recovery permission'
);

select ok((public.admin_complete_password_recovery_v1(
  '31000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000005',
  '33000000-0000-4000-8000-000000000002',repeat('3',64),
  'failed','delivery_failed'
)->'error'->>'code')='delivery_failed','provider failure is reduced to a stable generic code');
select is((select result from admin_private.admin_audit_events where request_id='33000000-0000-4000-8000-000000000002'),'failed','failed recovery dispatch is audited');
select throws_ok(
  $$select public.admin_complete_password_recovery_v1(
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000005',
    '33000000-0000-4000-8000-000000000002',repeat('3',64),
    'failed','provider said user token=secret'
  )$$,
  '22023','password recovery error code is invalid','provider messages cannot enter the audit error code'
);

-- Direct deterministic-clock tests prove the stricter fixed-hour limiter.
select ok((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000006',
  '34000000-0000-4000-8000-000000000001',repeat('a',64),'2099-01-01 00:00:01+00'
)->>'allowed')::boolean,'recovery actor request one is allowed');
select ok((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000007',
  '34000000-0000-4000-8000-000000000002',repeat('b',64),'2099-01-01 00:00:02+00'
)->>'allowed')::boolean,'recovery actor request two is allowed');
select ok((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000008',
  '34000000-0000-4000-8000-000000000003',repeat('c',64),'2099-01-01 00:00:03+00'
)->>'allowed')::boolean,'recovery actor request three is allowed');
select ok((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000006',
  '34000000-0000-4000-8000-000000000004',repeat('d',64),'2099-01-01 00:00:04+00'
)->>'allowed')::boolean,'recovery actor request four is allowed');
select ok((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000007',
  '34000000-0000-4000-8000-000000000005',repeat('e',64),'2099-01-01 00:00:05+00'
)->>'allowed')::boolean,'recovery actor request five is allowed');
select ok(not (admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000008',
  '34000000-0000-4000-8000-000000000006',repeat('f',64),'2099-01-01 00:00:06+00'
)->>'allowed')::boolean,'recovery actor request six is denied for the hour');
select is((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000008',
  '34000000-0000-4000-8000-000000000007',repeat('7',64),'2099-01-01 00:00:07+00'
)->>'target_count')::integer,2,'second actor has an independent actor quota while sharing target protection');
select ok((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000008',
  '34000000-0000-4000-8000-000000000008',repeat('8',64),'2099-01-01 00:00:08+00'
)->>'allowed')::boolean,'target request three is allowed across independent actors');
select ok(not (admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000005','31000000-0000-4000-8000-000000000008',
  '34000000-0000-4000-8000-000000000010',repeat('0',64),'2099-01-01 00:00:09+00'
)->>'allowed')::boolean,'target request four is denied across independent actors');
select ok((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000008',
  '34000000-0000-4000-8000-000000000009',repeat('9',64),'2099-01-01 01:00:00+00'
)->>'allowed')::boolean,'new hourly window restores recovery quota');
select ok((admin_private.consume_password_recovery_rate_limit_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000008',
  '34000000-0000-4000-8000-000000000009',repeat('9',64),'2099-01-01 01:10:00+00'
)->>'idempotent_replay')::boolean,'repeated recovery request ID does not consume a second quota slot');
select throws_ok(
  $$select admin_private.consume_password_recovery_rate_limit_v1(
    '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000008',
    '34000000-0000-4000-8000-000000000009',repeat('0',64),'2099-01-01 01:10:00+00'
  )$$,
  '22023','idempotency request conflict','hourly limiter rejects changed payload for the same request ID'
);
select is((select count(*) from admin_private.admin_audit_events where action='rate_limit.denied' and permission_key='users.password_recovery' and details->>'bucket'='password_recovery'),2::bigint,'actor and target hourly denials are each coalesced to one audit event');

-- Concurrent calls share PostgreSQL state across independent sessions. Start
-- from count four; exactly one of two calls may cross the actor limit.
create extension if not exists dblink;
select dblink_connect('recovery_setup', 'dbname=' || current_database());
select dblink_exec('recovery_setup', $sql$
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    ('35000000-0000-4000-8000-000000000001','concurrent-actor@example.invalid',clock_timestamp(),'{}'),
    ('35000000-0000-4000-8000-000000000002','concurrent-target-a@example.invalid',clock_timestamp(),'{}'),
    ('35000000-0000-4000-8000-000000000003','concurrent-target-b@example.invalid',clock_timestamp(),'{}')
  on conflict (id) do nothing
$sql$);
select dblink_exec('recovery_setup', $sql$
  insert into admin_private.admin_password_recovery_rate_windows(
    subject_kind,subject_user_id,window_started_at,request_count,request_limit
  ) values
    ('actor','35000000-0000-4000-8000-000000000001','2099-02-01 00:00:00+00',4,5),
    ('target','35000000-0000-4000-8000-000000000002','2099-02-01 00:00:00+00',0,3),
    ('target','35000000-0000-4000-8000-000000000003','2099-02-01 00:00:00+00',0,3)
  on conflict (subject_kind,subject_user_id,window_started_at) do update
  set request_count=excluded.request_count,request_limit=excluded.request_limit
$sql$);
select dblink_disconnect('recovery_setup');
select dblink_connect('recovery_one', 'dbname=' || current_database());
select dblink_connect('recovery_two', 'dbname=' || current_database());
select dblink_send_query('recovery_one', $sql$
  select admin_private.consume_password_recovery_rate_limit_v1(
    '35000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000002',
    '36000000-0000-4000-8000-000000000001',repeat('1',64),'2099-02-01 00:00:05+00'
  )::text
$sql$);
select dblink_send_query('recovery_two', $sql$
  select admin_private.consume_password_recovery_rate_limit_v1(
    '35000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000003',
    '36000000-0000-4000-8000-000000000002',repeat('2',64),'2099-02-01 00:00:05+00'
  )::text
$sql$);
create temporary table concurrent_recovery_results(result jsonb);
insert into concurrent_recovery_results select result::jsonb from dblink_get_result('recovery_one') as response(result text);
insert into concurrent_recovery_results select result::jsonb from dblink_get_result('recovery_two') as response(result text);
select is((select count(*) from concurrent_recovery_results where (result->>'allowed')::boolean),1::bigint,'concurrent recovery requests admit exactly one remaining actor slot');
select is((select count(*) from concurrent_recovery_results where not (result->>'allowed')::boolean),1::bigint,'concurrent recovery requests deny exactly one request beyond the actor limit');
select dblink_disconnect('recovery_one');
select dblink_disconnect('recovery_two');

set local role authenticated;
set local request.jwt.claim.sub='31000000-0000-4000-8000-000000000004';
select throws_ok($$select * from admin_private.admin_password_recovery_requests$$,'42501',null,'authenticated cannot read private recovery reservations');
select throws_ok($$select public.admin_prepare_password_recovery_v1(
  '31000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000004',
  'Browser attempted privileged recovery RPC','37000000-0000-4000-8000-000000000001',repeat('a',64)
)$$,'42501',null,'authenticated browser cannot execute prepare RPC');
reset role;

select * from finish();
rollback;
