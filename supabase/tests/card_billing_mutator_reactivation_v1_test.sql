-- LOCAL/DISPOSABLE pgTAP SUITE — NEVER TARGET A LINKED OR REMOTE PROJECT.

begin;
create extension if not exists pgtap;
select no_plan();

-- Exactly the six UI-facing writers are executable by authenticated. The two
-- lower-level structuring writers deliberately remain dormant.
select results_eq(
  $$with expected(signature) as (values
      ('public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)'),
      ('public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)'),
      ('public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)'),
      ('public.reverse_my_card_payment_v1(uuid,uuid,date,text)'),
      ('public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)'),
      ('public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)')
    )
    select count(*) filter (where has_function_privilege('authenticated',signature,'execute')),
           count(*) filter (where has_function_privilege('anon',signature,'execute')),
           count(*) filter (where has_function_privilege('service_role',signature,'execute'))
    from expected$$,
  $$values (6::bigint,0::bigint,0::bigint)$$,
  'reactivation grants exactly six UI writers only to authenticated'
);
select results_eq(
  $$select count(*) filter (where has_function_privilege('authenticated',signature,'execute')),
           count(*) filter (where has_function_privilege('anon',signature,'execute')),
           count(*) filter (where has_function_privilege('service_role',signature,'execute'))
    from (values
      ('public.structure_my_card_purchase_v1(uuid)'),
      ('public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)')
    ) dormant(signature)$$,
  $$values (0::bigint,0::bigint,0::bigint)$$,
  'two lower-level structuring writers remain dormant for every client role'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) privilege
    where n.nspname='public'
      and p.proname in (
        'structure_my_card_purchase_v1','create_my_card_installment_series_v1',
        'create_my_card_installment_series_with_metadata_v1','create_my_card_purchase_v1',
        'pay_my_card_invoice_v1','reverse_my_card_payment_v1',
        'credit_my_card_purchase_v1','reverse_my_card_purchase_credit_v1'
      )
      and privilege.grantee=0
      and privilege.privilege_type='EXECUTE'
  ),
  'no reactivated writer inherits EXECUTE through PUBLIC'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='billing_private'
      and p.proname like '%pre_temporal_v1'
      and (
        has_function_privilege('anon',p.oid,'execute')
        or has_function_privilege('authenticated',p.oid,'execute')
        or has_function_privilege('service_role',p.oid,'execute')
      )
  ),
  'private pre-temporal implementations remain inaccessible'
);
select ok(
  not has_schema_privilege('anon','billing_private','usage')
    and not has_schema_privilege('authenticated','billing_private','usage')
    and not has_schema_privilege('service_role','billing_private','usage'),
  'billing_private remains isolated after public writer reactivation'
);
select ok(
  has_function_privilege(
    'authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'
  ),
  'authenticated read adapter remains executable'
);

insert into auth.users(id,email) values
  ('f1000000-0000-4000-8000-000000000001','reactivation-a@example.invalid'),
  ('f1000000-0000-4000-8000-000000000002','reactivation-b@example.invalid'),
  ('f1000000-0000-4000-8000-000000000003','reactivation-expired@example.invalid'),
  ('f1000000-0000-4000-8000-000000000004','reactivation-no-app@example.invalid'),
  ('f1000000-0000-4000-8000-000000000005','reactivation-disabled@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,expires_at,access_kind) values
  ('f1000000-0000-4000-8000-000000000001',true,false,null,'APP'),
  ('f1000000-0000-4000-8000-000000000002',true,false,null,'APP'),
  ('f1000000-0000-4000-8000-000000000003',true,false,statement_timestamp()-interval '1 day','EXPIRED'),
  ('f1000000-0000-4000-8000-000000000005',false,false,null,'DISABLED');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day) values
  ('f1100000-0000-4000-8000-000000000101','f1000000-0000-4000-8000-000000000001','User A card',5000,10,20),
  ('f1100000-0000-4000-8000-000000000102','f1000000-0000-4000-8000-000000000002','User B card',5000,10,20),
  ('f1100000-0000-4000-8000-000000000103','f1000000-0000-4000-8000-000000000003','Expired card',5000,10,20),
  ('f1100000-0000-4000-8000-000000000104','f1000000-0000-4000-8000-000000000004','No APP card',5000,10,20),
  ('f1100000-0000-4000-8000-000000000105','f1000000-0000-4000-8000-000000000005','Disabled card',5000,10,20);
insert into public.accounts(id,user_id,name,opening_balance,statement_balance,balance_as_of) values
  ('f1200000-0000-4000-8000-000000000201','f1000000-0000-4000-8000-000000000001','User A account',5000,5000,(statement_timestamp() at time zone 'America/Sao_Paulo')::date-1),
  ('f1200000-0000-4000-8000-000000000202','f1000000-0000-4000-8000-000000000002','User B account',5000,5000,(statement_timestamp() at time zone 'America/Sao_Paulo')::date-1);

set local role authenticated;

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select is(public.has_active_access('APP'),false,'expired APP fixture resolves false');
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    gen_random_uuid(),'f1100000-0000-4000-8000-000000000103',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'Expired attempt',10,'realizado',null,null,null,null,null,null
  )$$,
  '42501','active APP access required','expired APP cannot call reactivated writer'
);

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000004',true);
select is(public.has_active_access('APP'),null::boolean,'missing APP fixture resolves NULL');
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    gen_random_uuid(),'f1100000-0000-4000-8000-000000000104',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'No APP attempt',10,'realizado',null,null,null,null,null,null
  )$$,
  '42501','active APP access required','missing APP cannot call reactivated writer'
);
select throws_ok(
  $$select * from public.get_my_card_billing_summary_as_of_v1(
    'f1100000-0000-4000-8000-000000000104',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  )$$,
  '42501','active APP access required','missing APP cannot call billing reader'
);

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000005',true);
select is(public.has_active_access('APP'),false,'disabled APP fixture resolves false');
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    gen_random_uuid(),'f1100000-0000-4000-8000-000000000105',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'Disabled attempt',10,'realizado',null,null,null,null,null,null
  )$$,
  '42501','active APP access required','disabled APP cannot call reactivated writer'
);

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select throws_ok(
  $$select public.structure_my_card_purchase_v1(gen_random_uuid())$$,
  '42501',null,'authenticated cannot execute dormant direct structuring writer'
);
select throws_ok(
  $$select public.create_my_card_installment_series_v1(
    gen_random_uuid(),'f1100000-0000-4000-8000-000000000101',current_date,
    'Dormant writer',20,2,'realizado',null,null
  )$$,
  '42501',null,'authenticated cannot execute dormant non-metadata installment writer'
);
select lives_ok(
  $$select public.create_my_card_installment_series_with_metadata_v1(
    'f1400000-0000-4000-8000-000000000403',
    'f1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'User A installments',60,2,'realizado',null,null,'Cartão',null,null,null
  )$$,
  'active APP user can call reactivated metadata installment writer'
);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'f1400000-0000-4000-8000-000000000401',
    'f1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date-40,
    'User A purchase',100,'realizado',null,null,null,null,null,null
  )$$,
  'active APP user can call reactivated purchase writer'
);
select lives_ok(
  $$select public.credit_my_card_purchase_v1(
    (select id from public.transactions
     where operation_id='f1400000-0000-4000-8000-000000000401'),
    20,(statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'f1600000-0000-4000-8000-000000000601','User A credit'
  )$$,
  'active APP user can call reactivated credit writer'
);
select set_config(
  'aviora_test.victim_cycle',
  (select card_billing_cycle_id::text from public.transactions
   where operation_id='f1400000-0000-4000-8000-000000000401'),
  true
);
select set_config(
  'aviora_test.victim_transaction',
  (select id::text from public.transactions
   where operation_id='f1400000-0000-4000-8000-000000000401'),
  true
);
select set_config(
  'aviora_test.victim_credit',
  (select id::text from public.card_purchase_credits
   where operation_id='f1600000-0000-4000-8000-000000000601'),
  true
);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    current_setting('aviora_test.victim_cycle')::uuid,
    'f1200000-0000-4000-8000-000000000201',80,
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'f1500000-0000-4000-8000-000000000501'
  )$$,
  'active APP user can call reactivated payment writer'
);
select set_config(
  'aviora_test.victim_payment',
  (select id::text from public.card_invoice_payments
   where operation_id='f1500000-0000-4000-8000-000000000501'),
  true
);
select results_eq(
  $$select account_delta,consumption_expense_delta
    from public.card_account_settlement_effects_v1
    where operation_id='f1500000-0000-4000-8000-000000000501'$$,
  $$values (-80::numeric,0::numeric)$$,
  'reactivated payment remains a neutral settlement, not a second expense'
);
select lives_ok(
  $$select public.reverse_my_card_payment_v1(
    current_setting('aviora_test.victim_payment')::uuid,
    'f1600000-0000-4000-8000-000000000602',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'User A payment reversal'
  )$$,
  'active APP user can call reactivated payment reversal writer'
);
select lives_ok(
  $$select public.reverse_my_card_purchase_credit_v1(
    current_setting('aviora_test.victim_credit')::uuid,
    'f1600000-0000-4000-8000-000000000603',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'User A credit reversal'
  )$$,
  'active APP user can call reactivated credit reversal writer'
);

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'f1400000-0000-4000-8000-000000000402',
    'f1100000-0000-4000-8000-000000000102',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'User B purchase',50,'realizado',null,null,null,null,null,null
  )$$,
  'second active APP user can operate own card'
);
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    gen_random_uuid(),'f1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'Cross-user card attempt',10,'realizado',null,null,null,null,null,null
  )$$,
  '23503','card not found','user B cannot create a purchase on user A card'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    current_setting('aviora_test.victim_cycle')::uuid,
    'f1200000-0000-4000-8000-000000000202',1,
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    gen_random_uuid()
  )$$,
  '42501','billing cycle not found','user B cannot pay user A cycle with own account'
);
select throws_ok(
  $$select public.create_my_card_installment_series_with_metadata_v1(
    gen_random_uuid(),'f1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'Cross-user installments',100,2,'realizado',null,null,null,null,null,null
  )$$,
  '23503',null,'user B cannot create installments on user A card'
);
select throws_ok(
  $$select public.credit_my_card_purchase_v1(
    current_setting('aviora_test.victim_transaction')::uuid,1,
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    gen_random_uuid(),'Cross-user credit'
  )$$,
  'P0002',null,'user B cannot credit user A transaction by explicit UUID'
);
select throws_ok(
  $$select public.reverse_my_card_payment_v1(
    current_setting('aviora_test.victim_payment')::uuid,gen_random_uuid(),
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'Cross-user payment reversal'
  )$$,
  '42501','payment not found','user B cannot reverse user A payment by explicit UUID'
);
select throws_ok(
  $$select public.reverse_my_card_purchase_credit_v1(
    current_setting('aviora_test.victim_credit')::uuid,gen_random_uuid(),
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'Cross-user credit reversal'
  )$$,
  'P0002',null,'user B cannot reverse user A credit by explicit UUID'
);
select results_eq(
  $$select count(*) from public.get_my_card_billing_summary_as_of_v1(
    'f1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  )$$,
  array[0::bigint],
  'user B receives no billing summary rows for user A card'
);
select results_eq(
  $$select count(*) from public.card_billing_cycles
    where id=current_setting('aviora_test.victim_cycle')::uuid$$,
  array[0::bigint],
  'RLS hides user A cycle from user B'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    null,null,current_date,'Anon',10,'realizado',null,null,null,null,null,null
  )$$,
  '42501',null,'anon cannot execute reactivated purchase writer'
);
reset role;

set local role service_role;
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    null,null,current_date,'Service role',10,'realizado',null,null,null,null,null,null
  )$$,
  '42501',null,'service_role cannot execute reactivated purchase writer'
);
reset role;

select * from finish();
rollback;
