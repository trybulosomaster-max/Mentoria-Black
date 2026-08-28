-- LOCAL/DISPOSABLE pgTAP SUITE — NEVER TARGET A LINKED OR REMOTE PROJECT.

begin;
create extension if not exists pgtap;
select no_plan();

-- Activation surface and least privilege.
select has_function('public','create_my_card_purchase_v1',array[
  'uuid','uuid','date','text','numeric','text','text','text','text','text','uuid','text'
]);
select has_function('public','create_my_card_installment_series_with_metadata_v1',array[
  'uuid','uuid','date','text','numeric','integer','text','text','text','text','text','uuid','text'
]);
select has_function('public','get_my_card_billing_summary_as_of_v1',array['uuid','date']);
select has_function('public','get_my_card_account_positions_v1',array['uuid','date']);
select has_function('billing_private','pay_my_card_invoice_shadow_impl_v1',array['uuid','uuid','numeric','date','uuid']);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.structure_my_card_purchase_v1(uuid)',
    'execute'
  ),
  'temporal structure writer remains dormant pending separate reactivation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',
    'execute'
  ),
  'temporal one-off writer remains dormant pending separate reactivation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)',
    'execute'
  ),
  'temporal installment writer remains dormant pending separate reactivation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)',
    'execute'
  ),
  'temporal metadata installment writer remains dormant pending separate reactivation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',
    'execute'
  ),
  'temporal payment writer remains dormant pending separate reactivation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.reverse_my_card_payment_v1(uuid,uuid,date,text)',
    'execute'
  ),
  'temporal payment reversal remains dormant pending separate reactivation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)',
    'execute'
  ),
  'temporal purchase credit remains dormant pending separate reactivation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)',
    'execute'
  ),
  'temporal credit reversal remains dormant pending separate reactivation'
);
select ok(
  not has_function_privilege(
    'service_role',
    'billing_private.pay_my_card_invoice_shadow_impl_v1(uuid,uuid,numeric,date,uuid)',
    'execute'
  ),
  'service_role cannot call the hidden payment implementation'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',
    'execute'
  ),
  'anon cannot call payment'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',
    'execute'
  ),
  'anon cannot inherit PUBLIC execution on purchase writer'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'structure_my_card_purchase_v1',
        'create_my_card_purchase_v1',
        'create_my_card_installment_series_v1',
        'create_my_card_installment_series_with_metadata_v1',
        'pay_my_card_invoice_v1',
        'reverse_my_card_payment_v1',
        'credit_my_card_purchase_v1',
        'reverse_my_card_purchase_credit_v1'
      )
      and (
        not p.prosecdef
        or coalesce(array_to_string(p.proconfig, ','), '') <> 'search_path=pg_catalog'
      )
  ),
  'all public writers are SECURITY DEFINER with a pinned pg_catalog search_path'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'billing_private'
      and (
        p.proname like '%shadow_impl_v1'
        or p.proname like '%pre_temporal_v1'
      )
      and (
        has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute')
      )
  ),
  'all hidden implementations remain non-executable by clients and service_role'
);

select ok(
  (
    select count(*) = 6
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'card_installment_series','card_billing_cycles',
        'card_invoice_payments','card_payment_allocations',
        'card_account_settlements','card_purchase_credits'
      )
      and roles = array['authenticated']::name[]
      and qual ilike '%has_active_access%APP%is true%'
  ),
  'all six shadow-table SELECT policies require ownership and active APP access'
);
select ok(
  (
    select count(*) = 6
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in (
        'card_installment_series','card_billing_cycles',
        'card_invoice_payments','card_payment_allocations',
        'card_account_settlements','card_purchase_credits'
      )
      and c.relrowsecurity
  ),
  'all six temporal billing tables keep RLS enabled'
);
select ok(
  (select reloptions @> array['security_invoker=true'] from pg_class where oid='public.card_invoice_balances_v1'::regclass),
  'invoice view remains security_invoker'
);
select ok(
  (select reloptions @> array['security_invoker=true'] from pg_class where oid='public.card_managed_limit_positions_v1'::regclass),
  'managed-limit view remains security_invoker'
);

-- The migration intentionally leaves writers dormant. Grant them only inside
-- this disposable pgTAP transaction; the final ROLLBACK restores revocation.
grant execute on function public.structure_my_card_purchase_v1(uuid) to authenticated;
grant execute on function public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text) to authenticated;
grant execute on function public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text) to authenticated;
grant execute on function public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text) to authenticated;
grant execute on function public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid) to authenticated;
grant execute on function public.reverse_my_card_payment_v1(uuid,uuid,date,text) to authenticated;
grant execute on function public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text) to authenticated;
grant execute on function public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text) to authenticated;

-- Synthetic entitlement matrix. The shell fixture supplies the local-only
-- has_active_access implementation; no production contract is mocked in code.
insert into auth.users(id,email) values
  ('d3000000-0000-4000-8000-000000000001','app-user@example.invalid'),
  ('d3000000-0000-4000-8000-000000000002','knowledge-only@example.invalid'),
  ('d3000000-0000-4000-8000-000000000003','expired@example.invalid'),
  ('d3000000-0000-4000-8000-000000000004','owner@example.invalid'),
  ('d3000000-0000-4000-8000-000000000005','staff@example.invalid'),
  ('d3000000-0000-4000-8000-000000000006','other-app-user@example.invalid'),
  ('d3000000-0000-4000-8000-000000000007','null-app@example.invalid');

insert into public.synthetic_access(user_id,app,knowledge,expires_at,access_kind) values
  ('d3000000-0000-4000-8000-000000000001',true,false,null,'APP'),
  ('d3000000-0000-4000-8000-000000000002',false,true,null,'KNOWLEDGE'),
  ('d3000000-0000-4000-8000-000000000003',true,false,statement_timestamp()-interval '1 day','EXPIRED'),
  ('d3000000-0000-4000-8000-000000000004',true,true,null,'OWNER'),
  ('d3000000-0000-4000-8000-000000000005',true,false,null,'STAFF'),
  ('d3000000-0000-4000-8000-000000000006',true,false,null,'APP'),
  ('d3000000-0000-4000-8000-000000000007',null,false,null,'NULL_APP');

insert into public.cards(id,user_id,name,"limit",closing_day,due_day) values
  ('d3100000-0000-4000-8000-000000000101','d3000000-0000-4000-8000-000000000001','Golden card',5000,10,20),
  ('d3100000-0000-4000-8000-000000000102','d3000000-0000-4000-8000-000000000001','Scheduled card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000103','d3000000-0000-4000-8000-000000000001','Unsupported card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000104','d3000000-0000-4000-8000-000000000002','Knowledge card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000105','d3000000-0000-4000-8000-000000000003','Expired card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000106','d3000000-0000-4000-8000-000000000004','Owner card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000107','d3000000-0000-4000-8000-000000000005','Staff card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000108','d3000000-0000-4000-8000-000000000006','Other card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000109','d3000000-0000-4000-8000-000000000001','Credit and reversal card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000110','d3000000-0000-4000-8000-000000000001','Metadata installment card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000111','d3000000-0000-4000-8000-000000000001','Future scheduled card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000112','d3000000-0000-4000-8000-000000000001','Past purchase card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000113','d3000000-0000-4000-8000-000000000001','Same-day purchase card',1000,10,20),
  ('d3100000-0000-4000-8000-000000000114','d3000000-0000-4000-8000-000000000007','Null APP card',1000,10,20);

insert into public.accounts(id,user_id,name,opening_balance,statement_balance,balance_as_of) values
  ('d3200000-0000-4000-8000-000000000201','d3000000-0000-4000-8000-000000000001','Golden account',5000,5000,((statement_timestamp() at time zone 'America/Sao_Paulo')::date-1)),
  ('d3200000-0000-4000-8000-000000000202','d3000000-0000-4000-8000-000000000001','Missing snapshot',5000,5000,null),
  ('d3200000-0000-4000-8000-000000000203','d3000000-0000-4000-8000-000000000001','Snapshot boundary',5000,5000,(statement_timestamp() at time zone 'America/Sao_Paulo')::date),
  ('d3200000-0000-4000-8000-000000000204','d3000000-0000-4000-8000-000000000001','Old snapshot',5000,5000,((statement_timestamp() at time zone 'America/Sao_Paulo')::date-90)),
  ('d3200000-0000-4000-8000-000000000208','d3000000-0000-4000-8000-000000000006','Other account',5000,5000,((statement_timestamp() at time zone 'America/Sao_Paulo')::date-1));

insert into public.goals(id,user_id,name,target,current) values
  ('d3300000-0000-4000-8000-000000000301','d3000000-0000-4000-8000-000000000001','Synthetic goal',1000,0),
  ('d3300000-0000-4000-8000-000000000308','d3000000-0000-4000-8000-000000000006','Other goal',1000,0);

select set_config(
  'aviora_test.today',
  ((statement_timestamp() at time zone 'America/Sao_Paulo')::date)::text,
  true
);
select set_config(
  'aviora_test.purchase_date',
  ((statement_timestamp() at time zone 'America/Sao_Paulo')::date-45)::text,
  true
);

set local role authenticated;

-- APP NULL, false and expired all fail closed.
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000002',true);
select is(public.has_active_access('APP'),false,'APP=false is represented explicitly');
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000401',
    'd3100000-0000-4000-8000-000000000104',
    current_setting('aviora_test.purchase_date')::date,
    'Knowledge-only attempt',100,'realizado',null,null,null,null,null,null
  )$$,
  '42501','active APP access required','KNOWLEDGE-only does not authorize Cards mutation'
);
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000003',true);
select is(public.has_active_access('APP'),false,'expired APP access resolves false');
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000402',
    'd3100000-0000-4000-8000-000000000105',
    current_setting('aviora_test.purchase_date')::date,
    'Expired attempt',100,'realizado',null,null,null,null,null,null
  )$$,
  '42501','active APP access required','expired APP access does not authorize Cards mutation'
);
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000007',true);
select is(
  public.has_active_access('APP'),
  null::boolean,
  'synthetic APP predicate exposes the NULL edge instead of normalizing it'
);
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000411',
    'd3100000-0000-4000-8000-000000000114',
    current_setting('aviora_test.purchase_date')::date,
    'Null APP attempt',100,'realizado',null,null,null,null,null,null
  )$$,
  '42501','active APP access required','NULL APP access does not authorize Cards mutation'
);
select throws_ok(
  $$select * from public.get_my_card_billing_summary_as_of_v1(
    'd3100000-0000-4000-8000-000000000114',
    current_setting('aviora_test.today')::date
  )$$,
  '42501','active APP access required','NULL APP access does not authorize billing reads'
);

-- OWNER and STAFF are accepted only because the canonical access predicate
-- resolves APP for them; the billing RPC never inspects role metadata.
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000004',true);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000403',
    'd3100000-0000-4000-8000-000000000106',
    current_setting('aviora_test.purchase_date')::date,
    'Owner purchase',100,'realizado',null,null,null,null,null,null
  )$$,
  'OWNER with canonical APP access can create a structured purchase'
);
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000005',true);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000404',
    'd3100000-0000-4000-8000-000000000107',
    current_setting('aviora_test.purchase_date')::date,
    'Staff purchase',100,'realizado',null,null,null,null,null,null
  )$$,
  'STAFF with canonical APP access can create a structured purchase'
);

select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000001',true);

-- Temporal matrix: purchase visibility follows the civil purchase_date while
-- transaction_date remains the untouched financial competence.
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000412',
    'd3100000-0000-4000-8000-000000000111',
    current_setting('aviora_test.today')::date+1,
    'Future scheduled purchase',250,'programado',null,null,null,null,null,null
  )$$,
  'future scheduled purchase can be persisted as a known commitment'
);
select results_eq(
  $$select count(*) from public.get_my_card_billing_summary_as_of_v1(
    'd3100000-0000-4000-8000-000000000111',
    current_setting('aviora_test.today')::date
  )$$,
  array[0::bigint],
  'future purchase stays outside an earlier historical billing position'
);
select throws_ok(
  $$update public.transactions
    set status='realizado'
    where operation_id='d3400000-0000-4000-8000-000000000412'$$,
  '22023','realized card purchase cannot take effect before its civil purchase_date',
  'direct future pending-to-realized update is blocked by the temporal trigger'
);
select results_eq(
  $$select status from public.transactions
    where operation_id='d3400000-0000-4000-8000-000000000412'$$,
  $$values ('programado'::text)$$,
  'blocked status promotion preserves the future scheduled commitment'
);
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000413',
    'd3100000-0000-4000-8000-000000000111',
    current_setting('aviora_test.today')::date+1,
    'Future realized purchase',100,'realizado',null,null,null,null,null,null
  )$$,
  '22023','realized card purchase cannot use a future purchase_date','future realized purchase is rejected fail closed'
);
select results_eq(
  $$select count(*) from public.transactions
    where operation_id='d3400000-0000-4000-8000-000000000413'$$,
  array[0::bigint],
  'rejected future realized purchase leaves no transaction'
);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000414',
    'd3100000-0000-4000-8000-000000000112',
    current_setting('aviora_test.today')::date-1,
    'Past realized purchase',120,'realizado',null,null,null,null,null,null
  )$$,
  'past realized purchase remains valid'
);
select results_eq(
  $$select coalesce(sum(purchase_amount),0)
    from public.get_my_card_billing_summary_as_of_v1(
      'd3100000-0000-4000-8000-000000000112',
      current_setting('aviora_test.today')::date
    )$$,
  $$values (120::numeric)$$,
  'past purchase is included in the current position'
);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000415',
    'd3100000-0000-4000-8000-000000000113',
    current_setting('aviora_test.today')::date,
    'Same-day realized purchase',80,'realizado',null,null,null,null,null,null
  )$$,
  'purchase on position_as_of remains valid'
);
select results_eq(
  $$select coalesce(sum(purchase_amount),0)
    from public.get_my_card_billing_summary_as_of_v1(
      'd3100000-0000-4000-8000-000000000113',
      current_setting('aviora_test.today')::date
    )$$,
  $$values (80::numeric)$$,
  'purchase on position_as_of is included at the inclusive boundary'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions
      where operation_id='d3400000-0000-4000-8000-000000000414'),
    'd3200000-0000-4000-8000-000000000204',120,
    current_setting('aviora_test.today')::date-2,
    'd3500000-0000-4000-8000-000000000513'
  )$$,
  '23514','payment effective_date precedes an eligible purchase_date','payment before the eligible purchase_date is rejected'
);
select results_eq(
  $$select count(*) from public.card_invoice_payments
    where operation_id='d3500000-0000-4000-8000-000000000513'$$,
  array[0::bigint],
  'rejected retroactive payment leaves no ledger entry'
);

select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000405',
    'd3100000-0000-4000-8000-000000000101',
    current_setting('aviora_test.purchase_date')::date,
    'Golden purchase',1000,'realizado','Casa','Serviços','Cartão','Nota sintética',
    'd3300000-0000-4000-8000-000000000301','contribution'
  )$$,
  'APP user creates one-off purchase atomically'
);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000405',
    'd3100000-0000-4000-8000-000000000101',
    current_setting('aviora_test.purchase_date')::date,
    'Golden purchase',1000,'realizado','Casa','Serviços','Cartão','Nota sintética',
    'd3300000-0000-4000-8000-000000000301','contribution'
  )$$,
  'one-off purchase retry is idempotent'
);
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000405',
    'd3100000-0000-4000-8000-000000000101',
    current_setting('aviora_test.purchase_date')::date,
    'Different payload',1000,'realizado','Casa','Serviços','Cartão','Nota sintética',
    'd3300000-0000-4000-8000-000000000301','contribution'
  )$$,
  '23505',null,'one-off purchase operation key rejects payload drift'
);
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    gen_random_uuid(),'d3100000-0000-4000-8000-000000000101',
    current_setting('aviora_test.purchase_date')::date,
    'Cross-user goal',10,'realizado',null,null,null,null,
    'd3300000-0000-4000-8000-000000000308','contribution'
  )$$,
  '23503',null,'one-off writer rejects cross-user goal'
);
select throws_ok(
  $$select public.create_my_card_purchase_v1(
    gen_random_uuid(),'d3100000-0000-4000-8000-000000000108',
    current_setting('aviora_test.purchase_date')::date,
    'Cross-user card',10,'realizado',null,null,null,null,null,null
  )$$,
  '23503',null,'one-off writer rejects cross-user card'
);

select lives_ok(
  $$select public.create_my_card_installment_series_with_metadata_v1(
    'd3400000-0000-4000-8000-000000000410',
    'd3100000-0000-4000-8000-000000000110',
    current_setting('aviora_test.purchase_date')::date,
    'Metadata installments',101,2,'realizado','Casa','Serviços',
    'Cartão','Nota das parcelas',
    'd3300000-0000-4000-8000-000000000301','contribution'
  )$$,
  'metadata-complete installment writer commits atomically'
);
select results_eq(
  $$select count(*),sum(amount),min(installment_number),max(installment_number),
      count(*) filter (where payment_method='Cartão' and note='Nota das parcelas'
        and goal_id='d3300000-0000-4000-8000-000000000301'
        and goal_effect='contribution')
    from public.transactions
    where installment_series_id=(select id from public.card_installment_series
      where operation_id='d3400000-0000-4000-8000-000000000410')$$,
  $$values (2::bigint,101::numeric,1,2,2::bigint)$$,
  'all installment metadata is present without post-RPC direct DML'
);
select lives_ok(
  $$select public.create_my_card_installment_series_with_metadata_v1(
    'd3400000-0000-4000-8000-000000000410',
    'd3100000-0000-4000-8000-000000000110',
    current_setting('aviora_test.purchase_date')::date,
    'Metadata installments',101,2,'realizado','Casa','Serviços',
    'Cartão','Nota das parcelas',
    'd3300000-0000-4000-8000-000000000301','contribution'
  )$$,
  'metadata installment retry is idempotent'
);
select throws_ok(
  $$select public.create_my_card_installment_series_with_metadata_v1(
    'd3400000-0000-4000-8000-000000000410',
    'd3100000-0000-4000-8000-000000000110',
    current_setting('aviora_test.purchase_date')::date,
    'Metadata installments',101,2,'realizado','Casa','Serviços',
    'Cartão','Different note',
    'd3300000-0000-4000-8000-000000000301','contribution'
  )$$,
  '23505',null,'metadata installment retry rejects payload drift'
);

-- Scheduled commitments are structured and visible, but never payable.
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000406',
    'd3100000-0000-4000-8000-000000000102',
    current_setting('aviora_test.purchase_date')::date,
    'Pending commitment',250,'pendente',null,null,null,null,null,null
  )$$,
  'pending purchase is a known structured commitment'
);
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000407',
    'd3100000-0000-4000-8000-000000000102',
    current_setting('aviora_test.purchase_date')::date,
    'Programmed commitment',300,'programado',null,null,null,null,null,null
  )$$,
  'programmed purchase is a known structured commitment'
);
select results_eq(
  $$select purchase_amount,scheduled_purchase_amount,known_commitment_amount
    from public.get_my_card_billing_summary_as_of_v1(
      'd3100000-0000-4000-8000-000000000102',
      current_setting('aviora_test.today')::date
    )$$,
  $$values (0::numeric,550::numeric,550::numeric)$$,
  'invoice adapter separates payable realized from scheduled known commitments'
);
select results_eq(
  $$select managed_used_limit,managed_available_limit,coverage_state
    from public.card_managed_limit_positions_v1
    where card_id='d3100000-0000-4000-8000-000000000102'$$,
  $$values (550::numeric,450::numeric,'complete'::text)$$,
  'managed limit consumes all structured known commitments'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000406'),
    'd3200000-0000-4000-8000-000000000201',1,
    current_setting('aviora_test.today')::date,gen_random_uuid()
  )$$,
  '23514',null,'pending/programmed invoice cannot be paid'
);

-- Unknown/null and cancelled statuses are not silently promoted.
insert into public.transactions(
  id,user_id,transaction_date,purchase_date,description,amount,card_id,transaction_type,status
) values (
  'd3400000-0000-4000-8000-000000000408',
  'd3000000-0000-4000-8000-000000000001',
  (select due_date from public.card_billing_cycles
   where card_id='d3100000-0000-4000-8000-000000000102'
   order by due_date desc limit 1),
  current_setting('aviora_test.purchase_date')::date,
  'Unknown legacy status',50,
  'd3100000-0000-4000-8000-000000000102','despesa',null
);
select throws_ok(
  $$select public.structure_my_card_purchase_v1('d3400000-0000-4000-8000-000000000408')$$,
  '22023',null,'unknown status is excluded from structured billing'
);

-- Billing effective dates use the fixed São Paulo civil boundary.
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000405'),
    'd3200000-0000-4000-8000-000000000201',1000,
    current_setting('aviora_test.today')::date+1,
    'd3500000-0000-4000-8000-000000000501'
  )$$,
  '22023',null,'future payment is blocked by the public wrapper'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000405'),
    'd3200000-0000-4000-8000-000000000202',1000,
    current_setting('aviora_test.today')::date,
    'd3500000-0000-4000-8000-000000000502'
  )$$,
  '23514',null,'payment fails closed when balance_as_of is missing'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000405'),
    'd3200000-0000-4000-8000-000000000203',1000,
    current_setting('aviora_test.today')::date,
    'd3500000-0000-4000-8000-000000000503'
  )$$,
  '23514',null,'payment on the end-of-day snapshot boundary fails closed'
);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000405'),
    'd3200000-0000-4000-8000-000000000201',1000,
    current_setting('aviora_test.today')::date,
    'd3500000-0000-4000-8000-000000000504'
  )$$,
  'payment after balance_as_of succeeds'
);

-- Activated credit and reversal wrappers keep APP/date/append-only contracts.
select lives_ok(
  $$select public.create_my_card_purchase_v1(
    'd3400000-0000-4000-8000-000000000409',
    'd3100000-0000-4000-8000-000000000109',
    current_setting('aviora_test.purchase_date')::date,
    'Credit and reversal purchase',200,'realizado',null,null,null,null,null,null
  )$$,
  'credit fixture purchase is structured'
);
select throws_ok(
  $$select public.credit_my_card_purchase_v1(
    (select id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000409'),
    50,current_setting('aviora_test.today')::date+1,
    'd3600000-0000-4000-8000-000000000601','future credit'
  )$$,
  '22023',null,'future credit is blocked by the public wrapper'
);
select lives_ok(
  $$select public.credit_my_card_purchase_v1(
    (select id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000409'),
    50,current_setting('aviora_test.today')::date,
    'd3600000-0000-4000-8000-000000000602','synthetic credit'
  )$$,
  'current purchase credit is accepted'
);
select lives_ok(
  $$select public.reverse_my_card_purchase_credit_v1(
    (select id from public.card_purchase_credits where operation_id='d3600000-0000-4000-8000-000000000602'),
    'd3600000-0000-4000-8000-000000000603',
    current_setting('aviora_test.today')::date,'synthetic credit reversal'
  )$$,
  'credit reversal is append-only and accepted'
);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000409'),
    'd3200000-0000-4000-8000-000000000201',200,
    current_setting('aviora_test.today')::date,
    'd3600000-0000-4000-8000-000000000604'
  )$$,
  'payment fixture for reversal is accepted'
);
select throws_ok(
  $$select public.reverse_my_card_payment_v1(
    (select id from public.card_invoice_payments where operation_id='d3600000-0000-4000-8000-000000000604'),
    'd3600000-0000-4000-8000-000000000605',
    current_setting('aviora_test.today')::date+1,'future payment reversal'
  )$$,
  '22023',null,'future payment reversal is blocked by the public wrapper'
);
select lives_ok(
  $$select public.reverse_my_card_payment_v1(
    (select id from public.card_invoice_payments where operation_id='d3600000-0000-4000-8000-000000000604'),
    'd3600000-0000-4000-8000-000000000606',
    current_setting('aviora_test.today')::date,'synthetic payment reversal'
  )$$,
  'payment reversal is append-only and accepted'
);
select lives_ok(
  $$select public.reverse_my_card_payment_v1(
    (select id from public.card_invoice_payments where operation_id='d3600000-0000-4000-8000-000000000604'),
    'd3600000-0000-4000-8000-000000000606',
    current_setting('aviora_test.today')::date,'synthetic payment reversal'
  )$$,
  'payment reversal retry is idempotent'
);
select results_eq(
  $$select coalesce(sum(account_delta),0),coalesce(sum(consumption_expense_delta),0)
    from public.card_account_settlement_effects_v1
    where operation_id in (
      'd3600000-0000-4000-8000-000000000604',
      'd3600000-0000-4000-8000-000000000606'
    )$$,
  $$values (0::numeric,0::numeric)$$,
  'payment plus append-only reversal has zero net cash and zero expense effect'
);

-- Explicit as-of reads and golden accounting.
select results_eq(
  $$select outstanding_amount,paid_amount
    from public.get_my_card_billing_summary_as_of_v1(
      'd3100000-0000-4000-8000-000000000101',
      current_setting('aviora_test.today')::date-1
    )$$,
  $$values (1000::numeric,0::numeric)$$,
  'effective_date after position_as_of has no premature billing effect'
);
select results_eq(
  $$select settlement_delta,managed_balance
    from public.get_my_card_account_positions_v1(
      'd3200000-0000-4000-8000-000000000201',
      current_setting('aviora_test.today')::date-1
    )$$,
  $$values (0::numeric,5000::numeric)$$,
  'effective_date after position_as_of has no premature account effect'
);
select results_eq(
  $$select outstanding_amount,paid_amount
    from public.get_my_card_billing_summary_as_of_v1(
      'd3100000-0000-4000-8000-000000000101',
      current_setting('aviora_test.today')::date
    )$$,
  $$values (0::numeric,1000::numeric)$$,
  'current invoice position includes settlement exactly once'
);
select results_eq(
  $$select settlement_delta,managed_balance,coverage_state
    from public.get_my_card_account_positions_v1(
      'd3200000-0000-4000-8000-000000000201',
      current_setting('aviora_test.today')::date
    )$$,
  $$values (-1000::numeric,4000::numeric,'complete'::text)$$,
  'golden account is 5000 minus one neutral settlement = 4000'
);
select results_eq(
  $$select managed_balance,coverage_state
    from public.get_my_card_account_positions_v1(
      'd3200000-0000-4000-8000-000000000202',
      current_setting('aviora_test.today')::date
    )$$,
  $$values (null::numeric,'BALANCE_SNAPSHOT_REQUIRED'::text)$$,
  'missing snapshot returns NULL instead of a fabricated account balance'
);
select results_eq(
  $$select managed_balance,coverage_state
    from public.get_my_card_account_positions_v1(
      'd3200000-0000-4000-8000-000000000203',
      current_setting('aviora_test.today')::date-1
    )$$,
  $$values (null::numeric,'HISTORICAL_POSITION_UNAVAILABLE'::text)$$,
  'position before account snapshot fails closed'
);
select results_eq(
  $$select account_delta,consumption_expense_delta
    from public.card_account_settlement_effects_v1
    where operation_id='d3500000-0000-4000-8000-000000000504'$$,
  $$values (-1000::numeric,0::numeric)$$,
  'payment settlement reduces cash and never creates a second expense'
);
select results_eq(
  $$select sum(amount) from public.transactions
    where operation_id='d3400000-0000-4000-8000-000000000405'$$,
  $$values (1000::numeric)$$,
  'golden economic expense remains exactly 1000'
);
select results_eq(
  $$select count(*) from public.card_invoice_payments
    where operation_id='d3500000-0000-4000-8000-000000000504'$$,
  array[1::bigint],
  'golden payment persists once'
);
select results_eq(
  $$select count(*) from public.card_payment_allocations a
    join public.card_invoice_payments p on p.id=a.payment_entry_id and p.user_id=a.user_id
    where p.operation_id='d3500000-0000-4000-8000-000000000504'$$,
  array[1::bigint],
  'golden payment has one allocation'
);
select results_eq(
  $$select count(*) from public.card_account_settlements s
    join public.card_invoice_payments p on p.id=s.payment_entry_id and p.user_id=s.user_id
    where p.operation_id='d3500000-0000-4000-8000-000000000504'$$,
  array[1::bigint],
  'golden payment has one settlement'
);

-- A later end-of-day account snapshot may absorb the settlement. Retrying the
-- already-committed operation remains idempotent and does not apply it twice.
reset role;
update public.accounts
set statement_balance=4000,
    balance_as_of=current_setting('aviora_test.today')::date
where id='d3200000-0000-4000-8000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000001',true);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000405'),
    'd3200000-0000-4000-8000-000000000201',1000,
    current_setting('aviora_test.today')::date,
    'd3500000-0000-4000-8000-000000000504'
  )$$,
  'retry remains idempotent after the account snapshot advances'
);
select results_eq(
  $$select managed_balance from public.get_my_card_account_positions_v1(
    'd3200000-0000-4000-8000-000000000201',
    current_setting('aviora_test.today')::date
  )$$,
  $$values (4000::numeric)$$,
  'advanced snapshot absorbs the settlement without double application'
);

-- Direct cross-user and anon checks after activation.
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000006',true);
select results_eq(
  $$select count(*) from public.card_billing_cycles
    where user_id='d3000000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'other APP user cannot read user A cycles'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where operation_id='d3400000-0000-4000-8000-000000000405'),
    'd3200000-0000-4000-8000-000000000208',1,
    current_setting('aviora_test.today')::date,gen_random_uuid()
  )$$,
  '42501',null,'other APP user cannot operate user A cycle'
);
select results_eq(
  $$select count(*) from public.get_my_card_billing_summary_as_of_v1(
    'd3100000-0000-4000-8000-000000000101',
    current_setting('aviora_test.today')::date
  )$$,
  array[0::bigint],
  'other APP user receives no rows for user A card'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.pay_my_card_invoice_v1(null,null,1,current_date,gen_random_uuid())$$,
  '42501',null,'anon cannot execute payment RPC'
);
select throws_ok(
  $$select * from public.get_my_card_billing_summary_as_of_v1(null,null)$$,
  '42501',null,'anon cannot execute APP billing reader'
);
reset role;

select * from finish();
rollback;
