-- LOCAL/DISPOSABLE pgTAP SUITE — NEVER TARGET A LINKED OR REMOTE PROJECT.

begin;
create extension if not exists pgtap;
select no_plan();

select ok(
  (select bool_and(relrowsecurity)
   from pg_class
   where oid in (
     'public.card_installment_series'::regclass,
     'public.card_billing_cycles'::regclass,
     'public.card_invoice_payments'::regclass,
     'public.card_payment_allocations'::regclass,
     'public.card_account_settlements'::regclass,
     'public.card_purchase_credits'::regclass
   )),
  'all six shadow tables retain RLS'
);
select is(
  (select count(*)
   from pg_policies
   where schemaname='public'
     and tablename in (
       'card_installment_series','card_billing_cycles',
       'card_invoice_payments','card_payment_allocations',
       'card_account_settlements','card_purchase_credits'
     )
     and qual ilike '%has_active_access%IS TRUE%'),
  6::bigint,
  'all six ownership policies fail closed with APP access IS TRUE'
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
      and (
        privilege.grantee=0
        or privilege.grantee in (
          'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid
        )
      )
      and privilege.privilege_type='EXECUTE'
  ),
  'all eight public mutators remain dormant'
);
select has_function(
  'billing_private','guard_card_purchase_temporal_v1',array[]::text[],
  'structured purchase temporal trigger exists'
);
select has_function(
  'billing_private','guard_card_payment_temporal_v1',array[]::text[],
  'payment ledger temporal trigger exists'
);
select ok(
  has_function_privilege(
    'authenticated','public.get_my_card_billing_summary_as_of_v1(uuid,date)','execute'
  ),
  'authenticated retains the hardened read adapter'
);

insert into auth.users(id,email) values
  ('e1000000-0000-4000-8000-000000000001','temporal-app@example.invalid'),
  ('e1000000-0000-4000-8000-000000000002','temporal-null@example.invalid');
insert into public.synthetic_access(user_id,app,knowledge,access_kind) values
  ('e1000000-0000-4000-8000-000000000001',true,false,'APP');
insert into public.cards(id,user_id,name,"limit",closing_day,due_day) values
  ('e1100000-0000-4000-8000-000000000101','e1000000-0000-4000-8000-000000000001','Temporal card',5000,10,20);
insert into public.accounts(
  id,user_id,name,opening_balance,statement_balance,balance_as_of
) values (
  'e1200000-0000-4000-8000-000000000201',
  'e1000000-0000-4000-8000-000000000001',
  'Temporal account',5000,5000,
  (statement_timestamp() at time zone 'America/Sao_Paulo')::date-2
);

select set_config(
  'request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true
);
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    gen_random_uuid(),'e1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'No entitlement',10,'realizado',null,null,null,null,null,null
  )$$,
  '42501',null,'NULL commercial predicate fails closed'
);

select set_config(
  'request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true
);
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    'e1400000-0000-4000-8000-000000000401',
    'e1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date+1,
    'Future realized',100,'realizado',null,null,null,null,null,null
  )$$,
  '22023',null,'realized one-off writer rejects future purchase_date'
);
select throws_ok(
  $$select public.create_my_card_installment_series_v1(
    'e1400000-0000-4000-8000-000000000402',
    'e1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date+1,
    'Future realized installments',100,2,'realizado',null,null
  )$$,
  '22023',null,'realized installment writer rejects future purchase_date'
);

select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'e1400000-0000-4000-8000-000000000403',
    'e1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date-1,
    'Past scheduled',100,'pendente',null,null,null,null,null,null
  )$$,
  'past scheduled purchase is structured'
);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'e1400000-0000-4000-8000-000000000404',
    'e1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date+1,
    'Future scheduled',200,'pendente',null,null,null,null,null,null
  )$$,
  'future scheduled commitment remains structurally allowed'
);
select results_eq(
  $$select coalesce(sum(scheduled_purchase_amount),0),coalesce(sum(known_commitment_amount),0)
    from public.get_my_card_billing_summary_as_of_v1(
      'e1100000-0000-4000-8000-000000000101',
      (statement_timestamp() at time zone 'America/Sao_Paulo')::date
    )$$,
  $$values (100::numeric,100::numeric)$$,
  'as-of billing excludes purchases after position_as_of'
);

select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'e1400000-0000-4000-8000-000000000405',
    'e1100000-0000-4000-8000-000000000101',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,
    'Current realized',100,'realizado',null,null,null,null,null,null
  )$$,
  'current realized purchase is structured'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions
     where operation_id='e1400000-0000-4000-8000-000000000405'),
    'e1200000-0000-4000-8000-000000000201',100,
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date-1,
    'e1500000-0000-4000-8000-000000000501'
  )$$,
  '23514',null,'payment wrapper cannot predate an eligible purchase'
);
select throws_ok(
  $$insert into public.card_invoice_payments(
      user_id,billing_cycle_id,source_account_id,entry_kind,amount,effective_date,operation_id
    ) values (
      'e1000000-0000-4000-8000-000000000001',
      (select card_billing_cycle_id from public.transactions
       where operation_id='e1400000-0000-4000-8000-000000000405'),
      'e1200000-0000-4000-8000-000000000201','payment',100,
      (statement_timestamp() at time zone 'America/Sao_Paulo')::date-1,
      'e1500000-0000-4000-8000-000000000502'
    )$$,
  '23514',null,'payment ledger trigger independently enforces purchase chronology'
);

select ok(
  not has_function_privilege(
    'authenticated','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'
  ),
  'payment mutator remains revoked after temporal tests'
);

select * from finish();
rollback;
