begin;
create extension if not exists pgtap;
select no_plan();

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
  ('61000000-0000-4000-8000-000000000001','password-owner@example.invalid',clock_timestamp(),'{}'),
  ('61000000-0000-4000-8000-000000000002','password-staff@example.invalid',clock_timestamp(),'{}'),
  ('61000000-0000-4000-8000-000000000003','password-customer@example.invalid',clock_timestamp(),'{}'),
  ('61000000-0000-4000-8000-000000000004','password-customer-two@example.invalid',clock_timestamp(),'{}'),
  ('61000000-0000-4000-8000-000000000005','password-owner-two@example.invalid',clock_timestamp(),'{}'),
  ('61000000-0000-4000-8000-000000000006','password-staff-two@example.invalid',clock_timestamp(),'{}'),
  ('61000000-0000-4000-8000-000000000007','password-customer-three@example.invalid',clock_timestamp(),'{}'),
  ('61000000-0000-4000-8000-000000000008','password-customer-four@example.invalid',clock_timestamp(),'{}');

select is(
  public.admin_bootstrap_first_owner_v1(
    '61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',
    'Bootstrap OWNER para política de senhas',repeat('1',64)
  )->>'role','OWNER','OWNER fixture is bootstrapped through the protected RPC'
);
select is(
  public.admin_add_staff_v1(
    '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002',
    array[]::text[],'Adicionar STAFF sem permissão granular de recovery',
    '62000000-0000-4000-8000-000000000002',repeat('2',64)
  )->>'role','STAFF','STAFF fixture starts without granular permissions'
);
select is(
  public.admin_add_staff_v1(
    '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000006',
    array[]::text[],'Adicionar segundo STAFF para proteção de alvo',
    '62000000-0000-4000-8000-000000000003',repeat('3',64)
  )->>'role','STAFF','second STAFF fixture exists'
);
select set_config('aviora.owner_bootstrap_authorized','on',true);
insert into admin_private.admin_members(
  user_id,role,status,created_by,created_via,updated_by
) values (
  '61000000-0000-4000-8000-000000000005','OWNER','active',
  null,'bootstrap',null
);
select set_config('aviora.owner_bootstrap_authorized','',true);

select ok((select enabled and not staff_assignable from admin_private.admin_permission_catalog where permission_key='users.password_recovery'),'password recovery remains enabled but is no longer STAFF-assignable');
select ok(not (select enabled or staff_assignable from admin_private.admin_permission_catalog where permission_key='users.sessions_revoke'),'third-party session revoke remains reserved and inactive');
select ok('users.password_recovery'=any(admin_private.effective_permissions_v1('61000000-0000-4000-8000-000000000002')),'active STAFF receives recovery as a base effective capability');
select is((select count(*) from admin_private.admin_member_permissions where user_id='61000000-0000-4000-8000-000000000002' and permission_key='users.password_recovery'),0::bigint,'base recovery does not require a permission-assignment row');

select lives_ok($$select public.admin_search_users_v1('61000000-0000-4000-8000-000000000002','customer',20,null,null)$$,'STAFF can locate CUSTOMER users without users.read');
select ok(not ((public.admin_search_users_v1('61000000-0000-4000-8000-000000000002','password',50,null,null)->'users') @> '[{"user_id":"61000000-0000-4000-8000-000000000001"}]'::jsonb),'STAFF search never enumerates OWNER');
select ok(not ((public.admin_search_users_v1('61000000-0000-4000-8000-000000000002','password',50,null,null)->'users') @> '[{"user_id":"61000000-0000-4000-8000-000000000006"}]'::jsonb),'STAFF search never enumerates another STAFF');

select lives_ok($$select public.admin_prepare_password_recovery_v1(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003',
  'Recuperação OWNER para CUSTOMER','62000000-0000-4000-8000-000000000011',repeat('a',64)
)$$,'OWNER recovery to CUSTOMER is allowed');
select lives_ok($$select public.admin_prepare_password_recovery_v1(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002',
  'Recuperação OWNER para STAFF','62000000-0000-4000-8000-000000000012',repeat('b',64)
)$$,'OWNER recovery to STAFF is allowed');
select throws_ok($$select public.admin_prepare_password_recovery_v1(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005',
  'Tentativa sobre outro OWNER','62000000-0000-4000-8000-000000000013',repeat('c',64)
)$$,'42501','OWNER password recovery is self-service only','OWNER cannot administratively recover another OWNER');
select lives_ok($$select public.admin_prepare_password_recovery_v1(
  '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000004',
  'Recuperação STAFF para CUSTOMER','62000000-0000-4000-8000-000000000014',repeat('d',64)
)$$,'STAFF recovery to CUSTOMER is a base role capability');
select throws_ok($$select public.admin_prepare_password_recovery_v1(
  '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002',
  'Tentativa STAFF contra si','62000000-0000-4000-8000-000000000015',repeat('e',64)
)$$,'42501','administrative password recovery cannot target self','STAFF recovery to self is denied');
select throws_ok($$select public.admin_prepare_password_recovery_v1(
  '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000006',
  'Tentativa STAFF contra STAFF','62000000-0000-4000-8000-000000000016',repeat('f',64)
)$$,'42501','STAFF can request recovery only for CUSTOMER users','STAFF recovery to STAFF is denied');
select throws_ok($$select public.admin_prepare_password_recovery_v1(
  '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001',
  'Tentativa STAFF contra OWNER','62000000-0000-4000-8000-000000000017',repeat('0',64)
)$$,'42501','OWNER password recovery is self-service only','STAFF recovery to OWNER is denied');
select throws_ok($$select public.admin_prepare_password_recovery_v1(
  '61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000004',
  'Tentativa CUSTOMER administrativa','62000000-0000-4000-8000-000000000018',repeat('1',64)
)$$,'42501','administrative access denied','CUSTOMER has no administrative recovery capability');

select lives_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003',
  'Suporte excepcional autorizado','63000000-0000-4000-8000-000000000001',repeat('2',64)
)$$,'OWNER direct reset of CUSTOMER is authorized');
select is(
  public.admin_complete_direct_password_reset_v1(
    '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003',
    '63000000-0000-4000-8000-000000000001',repeat('2',64),'succeeded',null
  )->>'result','succeeded','direct CUSTOMER reset can be completed after Auth Admin success'
);
select lives_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002',
  'Atendimento excepcional autorizado','63000000-0000-4000-8000-000000000002',repeat('3',64)
)$$,'OWNER direct reset of STAFF is authorized');
select throws_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005',
  'Atendimento excepcional autorizado','63000000-0000-4000-8000-000000000003',repeat('4',64)
)$$,'42501','OWNER password cannot be reset administratively','OWNER cannot directly reset another OWNER');
select throws_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000004',
  'Tentativa forjada do STAFF','63000000-0000-4000-8000-000000000004',repeat('5',64)
)$$,'42501','active OWNER access required for direct password reset','STAFF cannot directly reset CUSTOMER even via RPC');
select throws_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000006',
  'Tentativa forjada contra STAFF','63000000-0000-4000-8000-000000000005',repeat('6',64)
)$$,'42501','active OWNER access required for direct password reset','STAFF cannot directly reset STAFF');
select throws_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000004',
  'Tentativa forjada CUSTOMER','63000000-0000-4000-8000-000000000006',repeat('7',64)
)$$,'42501','active OWNER access required for direct password reset','CUSTOMER cannot directly reset anyone');

select is((select action from admin_private.admin_audit_events where request_id='63000000-0000-4000-8000-000000000001'),'users.password.reset_direct','direct reset writes a distinct audit action');
select is((select reason from admin_private.admin_audit_events where request_id='63000000-0000-4000-8000-000000000001'),'Suporte excepcional autorizado','audit stores only the administrative reason');
select is((select details from admin_private.admin_audit_events where request_id='63000000-0000-4000-8000-000000000001'),'{"actor_role":"OWNER","target_kind":"CUSTOMER"}'::jsonb,'audit details contain only non-secret role context');
select is((select response from admin_private.admin_operation_requests where request_id='63000000-0000-4000-8000-000000000001'),'{"ok":true,"reset":true,"result":"succeeded","request_id":"63000000-0000-4000-8000-000000000001","idempotent":false}'::jsonb,'operation response contains no password material');
select is((select payload_hash from admin_private.admin_operation_requests where request_id='63000000-0000-4000-8000-000000000001'),repeat('2',64),'operation persists only the caller-supplied metadata hash');
select ok(not exists(
  select 1 from information_schema.columns c
  where c.table_schema='admin_private' and c.table_name like 'admin_direct_password_reset%'
    and lower(c.column_name) ~ '(password|secret|token|credential|digest)'
),'direct reset schema has no secret-material column');

-- Actor limit: the first two calls above plus one new target fill 3/hour.
select lives_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000007',
  'Terceiro suporte excepcional','63000000-0000-4000-8000-000000000007',repeat('8',64)
)$$,'third OWNER direct-reset operation is admitted');
select is(
  public.admin_prepare_direct_password_reset_v1(
    '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000008',
    'Quarto suporte excepcional','63000000-0000-4000-8000-000000000008',repeat('9',64)
  )->'error'->>'code','rate_limited','fourth OWNER direct-reset operation is rate-limited in the hour'
);

-- Independent OWNER exercises the target limiter: two allowed, third denied.
select lives_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000008',
  'Primeiro suporte ao mesmo alvo','63000000-0000-4000-8000-000000000011',repeat('a',64)
)$$,'first target-scoped direct reset is admitted');
select lives_ok($$select public.admin_prepare_direct_password_reset_v1(
  '61000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000008',
  'Segundo suporte ao mesmo alvo','63000000-0000-4000-8000-000000000012',repeat('b',64)
)$$,'second target-scoped direct reset is admitted');
select is(
  public.admin_prepare_direct_password_reset_v1(
    '61000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000008',
    'Terceiro suporte ao mesmo alvo','63000000-0000-4000-8000-000000000013',repeat('c',64)
  )->'error'->>'code','rate_limited','third direct reset to one target is rate-limited in the hour'
);

select ok(not has_function_privilege('authenticated','public.admin_prepare_direct_password_reset_v1(uuid,uuid,text,uuid,text)','EXECUTE'),'authenticated browser cannot execute direct-reset prepare RPC');
select ok(not has_function_privilege('anon','public.admin_prepare_direct_password_reset_v1(uuid,uuid,text,uuid,text)','EXECUTE'),'anonymous browser cannot execute direct-reset prepare RPC');
select ok(has_function_privilege('service_role','public.admin_prepare_direct_password_reset_v1(uuid,uuid,text,uuid,text)','EXECUTE'),'service role retains the narrow direct-reset prepare capability');
select ok(not has_function_privilege('authenticated','public.admin_complete_direct_password_reset_v1(uuid,uuid,uuid,text,text,text)','EXECUTE'),'authenticated browser cannot execute direct-reset complete RPC');

select * from finish();
rollback;
