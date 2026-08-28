-- LOCAL/DISPOSABLE pgTAP SUITE — NEVER TARGET A LINKED OR REMOTE PROJECT.
-- The shell harness installs V81 + V82 before this candidate. Fixtures are
-- synthetic, client mutators are granted only inside this rolled-back test.

begin;
create extension if not exists pgtap;
select no_plan();

-- Structural contract.
select has_table('public','card_installment_series','structured installment series exists');
select has_table('public','card_billing_cycles','billing cycles exist');
select has_table('public','card_invoice_payments','payment ledger exists');
select has_table('public','card_payment_allocations','mono-cycle allocation ledger exists');
select has_table('public','card_account_settlements','account settlement ledger exists');
select has_table('public','card_purchase_credits','purchase credit ledger exists');
select has_column('public','transactions','card_billing_cycle_id','transaction has nullable cycle membership');
select has_column('public','transactions','installment_total','transaction has structured installment total');
select has_view('public','card_invoice_balances_v1','invoice balance view exists');
select has_view('public','card_account_settlement_effects_v1','account settlement effect view exists');
select has_view('public','card_purchase_credit_effects_v1','credit effect view exists');
select has_view('public','card_billing_shadow_comparison_v1','shadow comparator exists');
select has_view('public','card_managed_limit_positions_v1','managed limit view exists');

select col_type_is('public','card_invoice_payments','effective_date','date','payment date is civil DATE');
select col_type_is('public','card_purchase_credits','effective_date','date','credit date is civil DATE');
select col_type_is('public','card_invoice_payments','amount','numeric(14,2)','payment uses bounded monetary scale');
select col_type_is('public','card_purchase_credits','amount','numeric(14,2)','credit uses bounded monetary scale');
select col_not_null('public','card_billing_cycles','closing_day_snapshot','closing-day snapshot is required');
select col_not_null('public','card_billing_cycles','due_day_snapshot','due-day snapshot is required');
select col_not_null('public','card_billing_cycles','closing_date','effective closing date is required');
select col_not_null('public','card_billing_cycles','due_date','effective due date is required');

select has_function('public','structure_my_card_purchase_v1',array['uuid']);
select has_function('public','create_my_card_installment_series_v1',array['uuid','uuid','date','text','numeric','integer','text','text','text']);
select has_function('public','pay_my_card_invoice_v1',array['uuid','uuid','numeric','date','uuid']);
select has_function('public','reverse_my_card_payment_v1',array['uuid','uuid','date','text']);
select has_function('public','credit_my_card_purchase_v1',array['uuid','numeric','date','uuid','text']);
select has_function('public','reverse_my_card_purchase_credit_v1',array['uuid','uuid','date','text']);
select has_function('public','get_my_card_billing_summary_v1',array['uuid']);

select has_trigger('public','card_billing_cycles','card_billing_cycles_calendar_guard_v1','cycle calendar guard exists');
select has_trigger('public','card_billing_cycles','card_billing_cycles_immutable_v1','cycle snapshots are immutable');
select has_trigger('public','card_installment_series','card_installment_series_immutable_v1','series identity is immutable');
select has_trigger('public','transactions','transactions_guard_card_cycle_v1','cycle membership guard exists');
select has_trigger('public','transactions','transactions_guard_linked_card_delete_v1','linked-history delete guard exists');
select has_trigger('public','card_invoice_payments','card_invoice_payments_guard_insert_v1','payment guard exists');
select has_trigger('public','card_invoice_payments','card_invoice_payments_append_only_v1','payment ledger is append-only');
select has_trigger('public','card_payment_allocations','card_payment_allocations_guard_insert_v1','allocation guard exists');
select has_trigger('public','card_payment_allocations','card_payment_allocations_append_only_v1','allocations are append-only');
select has_trigger('public','card_account_settlements','card_account_settlements_guard_insert_v1','settlement guard exists');
select has_trigger('public','card_account_settlements','card_account_settlements_append_only_v1','settlements are append-only');
select has_trigger('public','card_purchase_credits','card_purchase_credits_guard_insert_v1','credit guard exists');
select has_trigger('public','card_purchase_credits','card_purchase_credits_append_only_v1','credits are append-only');

select index_is_unique('public','card_installment_series','card_installment_series_operation_key');
select index_is_unique('public','card_invoice_payments','card_invoice_payments_operation_key');
select index_is_unique('public','card_invoice_payments','card_invoice_payments_single_reversal_uidx');
select index_is_unique('public','card_payment_allocations','card_payment_allocations_payment_key');
select index_is_unique('public','card_account_settlements','card_account_settlements_payment_key');
select index_is_unique('public','card_purchase_credits','card_purchase_credits_operation_key');
select index_is_unique('public','card_purchase_credits','card_purchase_credits_single_reversal_uidx');

-- RLS and dormant artifact privileges.
select ok((select relrowsecurity from pg_class where oid='public.card_installment_series'::regclass),'RLS enabled on installment series');
select ok((select relrowsecurity from pg_class where oid='public.card_billing_cycles'::regclass),'RLS enabled on cycles');
select ok((select relrowsecurity from pg_class where oid='public.card_invoice_payments'::regclass),'RLS enabled on payments');
select ok((select relrowsecurity from pg_class where oid='public.card_payment_allocations'::regclass),'RLS enabled on allocations');
select ok((select relrowsecurity from pg_class where oid='public.card_account_settlements'::regclass),'RLS enabled on settlements');
select ok((select relrowsecurity from pg_class where oid='public.card_purchase_credits'::regclass),'RLS enabled on credits');
select policies_are('public','card_installment_series',array['card_installment_series_select_own']);
select policies_are('public','card_billing_cycles',array['card_billing_cycles_select_own']);
select policies_are('public','card_invoice_payments',array['card_invoice_payments_select_own']);
select policies_are('public','card_payment_allocations',array['card_payment_allocations_select_own']);
select policies_are('public','card_account_settlements',array['card_account_settlements_select_own']);
select policies_are('public','card_purchase_credits',array['card_purchase_credits_select_own']);

select ok(not has_table_privilege('anon','public.card_billing_cycles','select'),'anon cannot read cycles');
select ok(not has_table_privilege('anon','public.card_account_settlements','select'),'anon cannot read settlements');
select ok(has_table_privilege('authenticated','public.card_billing_cycles','select'),'authenticated can read own cycles through RLS');
select ok(has_table_privilege('authenticated','public.card_account_settlements','select'),'authenticated can read own settlements through RLS');
select ok(not has_table_privilege('authenticated','public.card_billing_cycles','insert,update,delete'),'authenticated cannot mutate cycles directly');
select ok(not has_table_privilege('authenticated','public.card_invoice_payments','insert,update,delete'),'authenticated cannot mutate payments directly');
select ok(not has_table_privilege('authenticated','public.card_purchase_credits','insert,update,delete'),'authenticated cannot mutate credits directly');

select function_privs_are('public','get_my_card_billing_summary_v1',array['uuid'],'authenticated',array['EXECUTE']);
select function_privs_are('public','pay_my_card_invoice_v1',array['uuid','uuid','numeric','date','uuid'],'authenticated',array[]::text[]);
select function_privs_are('public','credit_my_card_purchase_v1',array['uuid','numeric','date','uuid','text'],'authenticated',array[]::text[]);
select ok(not has_function_privilege('anon','public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)','execute'),'anon cannot execute payment RPC');
select ok(not has_function_privilege('anon','public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)','execute'),'anon cannot execute installment RPC');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'structure_my_card_purchase_v1','create_my_card_installment_series_v1',
        'pay_my_card_invoice_v1','reverse_my_card_payment_v1',
        'credit_my_card_purchase_v1','reverse_my_card_purchase_credit_v1'
      )
      and (
        not p.prosecdef
        or coalesce(array_to_string(p.proconfig,','),'') not like 'search_path=pg_catalog%'
        or coalesce(array_to_string(p.proconfig,','),'') like '%pg_temp%'
      )
  ),
  'all mutation RPCs are SECURITY DEFINER with pinned search_path'
);

-- Calendar contract: civil dates, closing day included, clamp 28-31.
select results_eq(
  $$select cycle_key,cycle_start_date,closing_date,due_date from billing_private.card_cycle_dates_v1('2028-01-19',20,30)$$,
  $$values ('2028-01-01'::date,'2027-12-21'::date,'2028-01-20'::date,'2028-01-30'::date)$$,
  'purchase before closing remains in current cycle'
);
select results_eq(
  $$select cycle_key,cycle_start_date,closing_date,due_date from billing_private.card_cycle_dates_v1('2028-01-20',20,30)$$,
  $$values ('2028-01-01'::date,'2027-12-21'::date,'2028-01-20'::date,'2028-01-30'::date)$$,
  'closing day remains in current cycle'
);
select results_eq(
  $$select cycle_key,cycle_start_date,closing_date,due_date from billing_private.card_cycle_dates_v1('2028-01-21',20,30)$$,
  $$values ('2028-02-01'::date,'2028-01-21'::date,'2028-02-20'::date,'2028-02-29'::date)$$,
  'purchase after closing moves to next cycle'
);
select results_eq(
  $$select closing_date,due_date from billing_private.card_cycle_dates_v1('2028-04-29',31,31)$$,
  $$values ('2028-04-30'::date,'2028-04-30'::date)$$,
  'April clamps closing and due day 31 to April 30'
);
select results_eq(
  $$select closing_date,due_date from billing_private.card_cycle_dates_v1('2028-02-27',28,28)$$,
  $$values ('2028-02-28'::date,'2028-02-28'::date)$$,
  'calendar day 28 is used directly when valid'
);
select results_eq(
  $$select closing_date,due_date from billing_private.card_cycle_dates_v1('2027-02-27',29,29)$$,
  $$values ('2027-02-28'::date,'2027-02-28'::date)$$,
  'calendar day 29 clamps in a non-leap February'
);
select results_eq(
  $$select closing_date,due_date from billing_private.card_cycle_dates_v1('2028-04-29',30,30)$$,
  $$values ('2028-04-30'::date,'2028-04-30'::date)$$,
  'calendar day 30 is used directly in April'
);
select results_eq(
  $$select closing_date,due_date from billing_private.card_cycle_dates_v1('2028-02-28',31,31)$$,
  $$values ('2028-02-29'::date,'2028-02-29'::date)$$,
  'leap-year February clamps day 31 to 29'
);
select results_eq(
  $$select closing_date,due_date from billing_private.card_cycle_dates_v1('2027-02-28',31,31)$$,
  $$values ('2027-02-28'::date,'2027-02-28'::date)$$,
  'non-leap February clamps day 31 to 28'
);
select results_eq(
  $$select closing_date,due_date from billing_private.card_cycle_dates_v1('2028-12-31',30,5)$$,
  $$values ('2029-01-30'::date,'2029-02-05'::date)$$,
  'December to January closing and following due month are deterministic'
);

-- Deterministic synthetic identities.
insert into auth.users(id,email) values
  ('b2000000-0000-4000-8000-000000000001','card-billing-a@example.invalid'),
  ('b2000000-0000-4000-8000-000000000002','card-billing-b@example.invalid');

insert into public.cards(id,user_id,name,"limit",closing_day,due_day) values
  ('b2000000-0000-4000-8000-000000000101','b2000000-0000-4000-8000-000000000001','Synthetic Gold',5000,20,30),
  ('b2000000-0000-4000-8000-000000000102','b2000000-0000-4000-8000-000000000001','Synthetic Installments',3000,31,31),
  ('b2000000-0000-4000-8000-000000000103','b2000000-0000-4000-8000-000000000001','Synthetic Exceeded',500,20,30),
  ('b2000000-0000-4000-8000-000000000104','b2000000-0000-4000-8000-000000000001','Synthetic Unknown',0,null,null),
  ('b2000000-0000-4000-8000-000000000106','b2000000-0000-4000-8000-000000000001','Synthetic Jan31',2000,30,5),
  ('b2000000-0000-4000-8000-000000000105','b2000000-0000-4000-8000-000000000002','Synthetic User B',2000,15,25);

insert into public.accounts(id,user_id,name,opening_balance,statement_balance) values
  ('b2000000-0000-4000-8000-000000000201','b2000000-0000-4000-8000-000000000001','Synthetic account A',5000,5000),
  ('b2000000-0000-4000-8000-000000000202','b2000000-0000-4000-8000-000000000002','Synthetic account B',5000,5000);

-- Mutators stay dormant in the artifact. These grants exist only in this
-- transaction and disappear with the final rollback.
grant execute on function public.structure_my_card_purchase_v1(uuid) to authenticated;
grant execute on function public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text) to authenticated;
grant execute on function public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid) to authenticated;
grant execute on function public.reverse_my_card_payment_v1(uuid,uuid,date,text) to authenticated;
grant execute on function public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text) to authenticated;
grant execute on function public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text) to authenticated;

-- Structure an existing purchase without moving its canonical transaction_date.
insert into public.transactions(
  id,user_id,transaction_date,purchase_date,description,category,amount,card_id,transaction_type,status
) values (
  'b2000000-0000-4000-8000-000000000401','b2000000-0000-4000-8000-000000000001',
  '2028-01-30','2028-01-20','Snapshot purchase','Gastos Fixos',100,
  'b2000000-0000-4000-8000-000000000101','despesa','realizado'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select lives_ok(
  $$select public.structure_my_card_purchase_v1('b2000000-0000-4000-8000-000000000401')$$,
  'eligible new purchase receives a structured cycle'
);
reset role;
select results_eq(
  $$select closing_day_snapshot,due_day_snapshot,cycle_start_date,closing_date,due_date
    from public.card_billing_cycles where id=(select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000401')$$,
  $$values (20::smallint,30::smallint,'2027-12-21'::date,'2028-01-20'::date,'2028-01-30'::date)$$,
  'cycle persists exact calendar snapshots'
);
update public.cards set closing_day=3,due_day=8 where id='b2000000-0000-4000-8000-000000000101';
select results_eq(
  $$select closing_day_snapshot,due_day_snapshot,closing_date,due_date from public.card_billing_cycles
    where id=(select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000401')$$,
  $$values (20::smallint,30::smallint,'2028-01-20'::date,'2028-01-30'::date)$$,
  'editing card dates does not rewrite cycle snapshots'
);
select results_eq(
  $$select transaction_date from public.transactions where id='b2000000-0000-4000-8000-000000000401'$$,
  array['2028-01-30'::date],
  'historical transaction_date remains sovereign'
);
update public.cards set closing_day=20,due_day=30 where id='b2000000-0000-4000-8000-000000000101';

-- Wrong historical competence fails closed instead of being rewritten.
insert into public.transactions(
  id,user_id,transaction_date,purchase_date,description,amount,card_id,transaction_type,status
) values (
  'b2000000-0000-4000-8000-000000000402','b2000000-0000-4000-8000-000000000001',
  '2028-01-29','2028-01-20','Wrong date control',10,
  'b2000000-0000-4000-8000-000000000101','despesa','realizado'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select throws_ok(
  $$update public.transactions
    set card_billing_cycle_id=(select id from public.card_billing_cycles where user_id='b2000000-0000-4000-8000-000000000001' limit 1)
    where id='b2000000-0000-4000-8000-000000000402'$$,
  '42501',null,'authenticated direct structured link is blocked despite legacy transaction UPDATE grant'
);
select throws_ok(
  $$select public.structure_my_card_purchase_v1('b2000000-0000-4000-8000-000000000402')$$,
  '23514',null,'mismatched historical competence is never silently changed'
);
reset role;
select results_eq(
  $$select concat_ws('|',transaction_date,coalesce(card_billing_cycle_id::text,'NULL')) from public.transactions where id='b2000000-0000-4000-8000-000000000402'$$,
  array['2028-01-29|NULL'::text],
  'failed structuring preserves the source transaction exactly'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select lives_ok(
  $$insert into public.transactions(
      id,user_id,transaction_date,purchase_date,description,amount,card_id,transaction_type,status,
      installment_series_id,installment_number,installment_total
    ) values (
      'b2000000-0000-4000-8000-000000000403','b2000000-0000-4000-8000-000000000001',
      '2028-01-30','2028-01-20','Legacy V82 installment',25,
      'b2000000-0000-4000-8000-000000000101','despesa','realizado',
      'b2000000-0000-4000-8000-000000000799',1,null
    )$$,
  'authenticated V82 legacy installment INSERT remains compatible after migration'
);
select results_eq(
  $$select concat_ws('|',installment_number,coalesce(installment_total::text,'NULL'),coalesce(card_billing_cycle_id::text,'NULL'))
    from public.transactions where id='b2000000-0000-4000-8000-000000000403'$$,
  array['1|NULL|NULL'::text],
  'legacy V82 installment shape remains preserved without registry inference'
);
select throws_ok(
  $$select public.structure_my_card_purchase_v1('b2000000-0000-4000-8000-000000000403')$$,
  '22023',null,'legacy installment cannot be silently converted into a V1 structured series'
);
select throws_ok(
  $$update public.transactions set installment_total=1 where id='b2000000-0000-4000-8000-000000000403'$$,
  '42501',null,'legacy client cannot forge V1 installment registry membership'
);
reset role;

-- New structured installment series: 1x, 2x and 12x; retries do not duplicate.
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select lives_ok(
  $$select public.create_my_card_installment_series_v1(
    'b2000000-0000-4000-8000-000000000701','b2000000-0000-4000-8000-000000000102',
    '2028-02-15','One installment',100,1,'realizado','Conforto',null)$$,
  '1x structured series is accepted'
);
select lives_ok(
  $$select public.create_my_card_installment_series_v1(
    'b2000000-0000-4000-8000-000000000702','b2000000-0000-4000-8000-000000000102',
    '2028-12-15','Two installments',100.01,2,'pendente','Conforto',null)$$,
  '2x structured series is cent-exact across year boundary'
);
select lives_ok(
  $$select public.create_my_card_installment_series_v1(
    'b2000000-0000-4000-8000-000000000703','b2000000-0000-4000-8000-000000000102',
    '2028-01-15','Twelve installments',1200,12,'programado','Conhecimento',null)$$,
  '12x structured series is accepted'
);
select lives_ok(
  $$select public.create_my_card_installment_series_v1(
    'b2000000-0000-4000-8000-000000000703','b2000000-0000-4000-8000-000000000102',
    '2028-01-15','Twelve installments',1200,12,'programado','Conhecimento',null)$$,
  'installment creation retry returns the same series'
);
select throws_ok(
  $$select public.create_my_card_installment_series_v1(
    'b2000000-0000-4000-8000-000000000703','b2000000-0000-4000-8000-000000000102',
    '2028-01-15','Twelve installments',1201,12,'programado','Conhecimento',null)$$,
  '23505',null,'installment idempotency key rejects a different payload'
);
select lives_ok(
  $$select public.create_my_card_installment_series_v1(
    'b2000000-0000-4000-8000-000000000704','b2000000-0000-4000-8000-000000000102',
    '2028-01-15','Same amount separate series',1200,12,'programado','Conhecimento',null)$$,
  'two equal series remain distinct by structured identity'
);
select lives_ok(
  $$select public.create_my_card_installment_series_v1(
    'b2000000-0000-4000-8000-000000000705','b2000000-0000-4000-8000-000000000101',
    '2028-06-15','Second card series',60,2,'pendente','Lazer',null)$$,
  'structured series remains scoped to its explicit second card'
);
select lives_ok(
  $$select public.create_my_card_installment_series_v1(
    'b2000000-0000-4000-8000-000000000706','b2000000-0000-4000-8000-000000000106',
    '2027-01-31','Jan31 sequential cycles',200,2,'pendente','Conforto',null)$$,
  'Jan31 after close30 creates a structured 2x series'
);
reset role;

select lives_ok(
  $$update public.transactions set purchase_date='2028-01-19' where id='b2000000-0000-4000-8000-000000000401'$$,
  'pre-ledger purchase-date edit remains compatible and clears stale cycle membership'
);
select results_eq(
  $$select concat_ws('|',transaction_date,purchase_date,coalesce(card_billing_cycle_id::text,'NULL'))
    from public.transactions where id='b2000000-0000-4000-8000-000000000401'$$,
  array['2028-01-30|2028-01-19|NULL'::text],
  'pre-ledger edit preserves canonical competence and clears only the derived link'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select public.structure_my_card_purchase_v1('b2000000-0000-4000-8000-000000000401');
reset role;

select results_eq(
  $$select count(*),min(installment_number),max(installment_number),sum(amount)
    from public.transactions where installment_series_id=(select id from public.card_installment_series where operation_id='b2000000-0000-4000-8000-000000000703')$$,
  $$values (12::bigint,1,12,1200::numeric)$$,
  '12x series persists every installment exactly once'
);
select results_eq(
  $$select transaction_date from public.transactions
    where installment_series_id=(select id from public.card_installment_series where operation_id='b2000000-0000-4000-8000-000000000702')
    order by installment_number$$,
  $$values ('2028-12-31'::date),('2029-01-31'::date)$$,
  '2x series crosses the year with calendar-clamped competencies'
);
select results_eq(
  $$select count(*) from public.card_installment_series where operation_id='b2000000-0000-4000-8000-000000000703'$$,
  array[1::bigint],
  'installment retry leaves one series'
);
select results_eq(
  $$select card_id,installment_total from public.card_installment_series where operation_id='b2000000-0000-4000-8000-000000000705'$$,
  $$values ('b2000000-0000-4000-8000-000000000101'::uuid,2::smallint)$$,
  'two-card fixture preserves independent series ownership'
);
select results_eq(
  $$select t.installment_number,cy.closing_date,t.transaction_date,t.purchase_date
    from public.transactions t join public.card_billing_cycles cy on cy.id=t.card_billing_cycle_id
    where t.installment_series_id=(select id from public.card_installment_series where operation_id='b2000000-0000-4000-8000-000000000706')
    order by t.installment_number$$,
  $$values
    (1,'2027-02-28'::date,'2027-03-05'::date,'2027-01-31'::date),
    (2,'2027-03-30'::date,'2027-04-05'::date,'2027-01-31'::date)$$,
  'Jan31 2x advances by frozen closing month without collapsing installments'
);
select results_eq(
  $$select count(distinct card_billing_cycle_id) from public.transactions
    where installment_series_id=(select id from public.card_installment_series where operation_id='b2000000-0000-4000-8000-000000000706')$$,
  array[2::bigint],
  'Jan31 2x uses two distinct sequential cycles'
);
set constraints card_installment_series_complete_v1,transactions_installment_series_complete_v1 immediate;
select pass('deferred installment completeness invariants are satisfied');
set constraints card_installment_series_complete_v1,transactions_installment_series_complete_v1 deferred;
select throws_ok(
  $$delete from public.card_installment_series where operation_id='b2000000-0000-4000-8000-000000000703'$$,
  '23514',null,'materialized installment series cannot be deleted'
);
select throws_ok(
  $$delete from public.transactions where installment_series_id=(select id from public.card_installment_series where operation_id='b2000000-0000-4000-8000-000000000703') and installment_number=1$$,
  '23514',null,'structured installment history cannot be deleted'
);

-- Golden purchase and independent credit-before-payment scenario.
insert into public.transactions(
  id,user_id,transaction_date,purchase_date,description,category,amount,card_id,transaction_type,status
) values
  ('b2000000-0000-4000-8000-000000000411','b2000000-0000-4000-8000-000000000001','2028-08-30','2028-08-10','Golden purchase','Gastos Fixos',1000,'b2000000-0000-4000-8000-000000000101','despesa','realizado'),
  ('b2000000-0000-4000-8000-000000000412','b2000000-0000-4000-8000-000000000001','2028-09-30','2028-09-10','Credit purchase','Conforto',1000,'b2000000-0000-4000-8000-000000000101','despesa','realizado'),
  ('b2000000-0000-4000-8000-000000000413','b2000000-0000-4000-8000-000000000001','2028-10-30','2028-10-10','Limit exceeded purchase','Lazer',700,'b2000000-0000-4000-8000-000000000103','despesa','realizado');

set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select public.structure_my_card_purchase_v1('b2000000-0000-4000-8000-000000000411');
select public.structure_my_card_purchase_v1('b2000000-0000-4000-8000-000000000412');
select public.structure_my_card_purchase_v1('b2000000-0000-4000-8000-000000000413');
select lives_ok(
  $$select public.credit_my_card_purchase_v1(
    'b2000000-0000-4000-8000-000000000412',200,'2028-10-05',
    'b2000000-0000-4000-8000-000000000801','synthetic refund')$$,
  'append-only credit is recognized on its effective date'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000412'),
    'b2000000-0000-4000-8000-000000000201',1000,'2028-10-06',
    'b2000000-0000-4000-8000-000000000802')$$,
  '23514',null,'credit reduces eligible balance before payment and blocks overpayment'
);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000412'),
    'b2000000-0000-4000-8000-000000000201',300,'2028-10-06',
    'b2000000-0000-4000-8000-000000000803')$$,
  'partial payment is accepted'
);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000412'),
    'b2000000-0000-4000-8000-000000000201',500,'2028-10-07',
    'b2000000-0000-4000-8000-000000000804')$$,
  'remaining eligible balance can be paid in full'
);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000412'),
    'b2000000-0000-4000-8000-000000000201',500,'2028-10-07',
    'b2000000-0000-4000-8000-000000000804')$$,
  'same payment retry is idempotent'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000412'),
    'b2000000-0000-4000-8000-000000000201',499,'2028-10-07',
    'b2000000-0000-4000-8000-000000000804')$$,
  '23505',null,'payment idempotency key rejects a different payload'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000412'),
    'b2000000-0000-4000-8000-000000000201',0.001,'2028-10-07',
    'b2000000-0000-4000-8000-000000000809')$$,
  '22023',null,'payment rejects sub-cent monetary input'
);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000411'),
    'b2000000-0000-4000-8000-000000000201',1000,'2028-09-05',
    'b2000000-0000-4000-8000-000000000805')$$,
  'golden invoice is paid exactly once'
);
reset role;

select results_eq(
  $$select outstanding_amount,credited_amount,paid_amount,settlement_state from public.card_invoice_balances_v1
    where id=(select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000412')$$,
  $$values (0::numeric,200::numeric,800::numeric,'settled'::text)$$,
  'credit 200 plus payments 800 settles invoice 1000 exactly'
);
select results_eq(
  $$select count(*) from public.card_invoice_payments where operation_id='b2000000-0000-4000-8000-000000000804'$$,
  array[1::bigint],
  'payment retry persists one entry'
);
select results_eq(
  $$select count(*) from public.card_payment_allocations a join public.card_invoice_payments p on p.id=a.payment_entry_id
    where p.operation_id='b2000000-0000-4000-8000-000000000805'$$,
  array[1::bigint],
  'payment creates exactly one allocation'
);
select results_eq(
  $$select count(*) from public.card_account_settlements s join public.card_invoice_payments p on p.id=s.payment_entry_id
    where p.operation_id='b2000000-0000-4000-8000-000000000805'$$,
  array[1::bigint],
  'payment creates exactly one settlement'
);
select results_eq(
  $$select account_delta,consumption_expense_delta from public.card_account_settlement_effects_v1
    where operation_id='b2000000-0000-4000-8000-000000000805'$$,
  $$values (-1000::numeric,0::numeric)$$,
  'settlement consumption delta is zero'
);
select results_eq(
  $$select a.opening_balance+coalesce(sum(e.account_delta),0)
    from public.accounts a left join public.card_account_settlement_effects_v1 e
      on e.account_id=a.id and e.operation_id='b2000000-0000-4000-8000-000000000805'
    where a.id='b2000000-0000-4000-8000-000000000201' group by a.opening_balance$$,
  array[4000::numeric],
  'golden account balance is 5000 minus one neutral settlement = 4000'
);
select results_eq(
  $$select sum(t.amount)+coalesce(sum(e.consumption_expense_delta),0)
    from public.transactions t left join public.card_account_settlement_effects_v1 e
      on e.operation_id='b2000000-0000-4000-8000-000000000805'
    where t.id='b2000000-0000-4000-8000-000000000411'$$,
  array[1000::numeric],
  'golden economic expense remains 1000 after invoice payment'
);
select results_eq(
  $$select transaction_date from public.transactions where id='b2000000-0000-4000-8000-000000000412'$$,
  array['2028-09-30'::date],
  'later credit does not rewrite original purchase month'
);
select results_eq(
  $$select effective_date,consumption_expense_delta from public.card_purchase_credit_effects_v1
    where operation_id='b2000000-0000-4000-8000-000000000801'$$,
  $$values ('2028-10-05'::date,-200::numeric)$$,
  'credit economic effect belongs to its own effective date'
);
select throws_ok(
  $$update public.transactions set purchase_date='2028-08-09' where id='b2000000-0000-4000-8000-000000000411'$$,
  '23514',null,'post-ledger purchase_date is immutable historical identity'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select lives_ok(
  $$select public.credit_my_card_purchase_v1(
    'b2000000-0000-4000-8000-000000000411',100,'2028-09-10',
    'b2000000-0000-4000-8000-000000000806','post-payment credit')$$,
  'credit after full payment is preserved as explicit review state'
);
select results_eq(
  $$select credit_balance,credit_balance_review_required,settlement_state from public.card_invoice_balances_v1
    where id=(select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000411')$$,
  $$values (100::numeric,true,'CREDIT_BALANCE_REVIEW_REQUIRED'::text)$$,
  'excess credit never creates silent carry-forward'
);
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000411'),
    'b2000000-0000-4000-8000-000000000201',1,'2028-09-11',
    'b2000000-0000-4000-8000-000000000807')$$,
  '23514',null,'payment fails closed while credit-balance contract is unresolved'
);
reset role;

-- Append-only reversals, duplicate protection and non-retroactive dates.
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select throws_ok(
  $$select public.reverse_my_card_payment_v1(
    (select id from public.card_invoice_payments where operation_id='b2000000-0000-4000-8000-000000000805'),
    'b2000000-0000-4000-8000-000000000811','2028-09-01','too early')$$,
  '23514',null,'payment reversal cannot predate original payment'
);
select lives_ok(
  $$select public.reverse_my_card_payment_v1(
    (select id from public.card_invoice_payments where operation_id='b2000000-0000-4000-8000-000000000805'),
    'b2000000-0000-4000-8000-000000000812','2028-09-06','valid reversal')$$,
  'payment reversal is append-only and explicit'
);
select lives_ok(
  $$select public.reverse_my_card_payment_v1(
    (select id from public.card_invoice_payments where operation_id='b2000000-0000-4000-8000-000000000805'),
    'b2000000-0000-4000-8000-000000000812','2028-09-06','valid reversal')$$,
  'payment reversal retry is idempotent'
);
select throws_ok(
  $$select public.reverse_my_card_payment_v1(
    (select id from public.card_invoice_payments where operation_id='b2000000-0000-4000-8000-000000000805'),
    'b2000000-0000-4000-8000-000000000813','2028-09-07','duplicate reversal')$$,
  '23505',null,'second logical payment reversal is blocked'
);
select lives_ok(
  $$select public.reverse_my_card_purchase_credit_v1(
    (select id from public.card_purchase_credits where operation_id='b2000000-0000-4000-8000-000000000801'),
    'b2000000-0000-4000-8000-000000000814','2028-10-08','valid credit reversal')$$,
  'purchase credit reversal is append-only'
);
select lives_ok(
  $$select public.reverse_my_card_purchase_credit_v1(
    (select id from public.card_purchase_credits where operation_id='b2000000-0000-4000-8000-000000000801'),
    'b2000000-0000-4000-8000-000000000814','2028-10-08','valid credit reversal')$$,
  'credit reversal retry is idempotent'
);
select throws_ok(
  $$select public.reverse_my_card_purchase_credit_v1(
    (select id from public.card_purchase_credits where operation_id='b2000000-0000-4000-8000-000000000801'),
    'b2000000-0000-4000-8000-000000000815','2028-10-09','duplicate credit reversal')$$,
  '23505',null,'second logical credit reversal is blocked'
);
reset role;

select throws_ok($$update public.card_invoice_payments set amount=1 where operation_id='b2000000-0000-4000-8000-000000000803'$$,'23514',null,'payment ledger rejects update');
select throws_ok($$delete from public.card_payment_allocations where payment_entry_id=(select id from public.card_invoice_payments where operation_id='b2000000-0000-4000-8000-000000000803')$$,'23514',null,'allocation ledger rejects delete');
select throws_ok($$delete from public.card_account_settlements where payment_entry_id=(select id from public.card_invoice_payments where operation_id='b2000000-0000-4000-8000-000000000803')$$,'23514',null,'settlement ledger rejects delete');
select throws_ok($$update public.card_purchase_credits set amount=1 where operation_id='b2000000-0000-4000-8000-000000000801'$$,'23514',null,'credit ledger rejects update');

-- Managed limit is explicit, conservative and never claims issuer precision.
select results_eq(
  $$select metric_contract,managed_used_limit,managed_available_limit,coverage_state from public.card_managed_limit_positions_v1
    where card_id='b2000000-0000-4000-8000-000000000103'$$,
  $$values ('AVIORA_MANAGED_AVAILABLE_LIMIT'::text,700::numeric,-200::numeric,'exceeded'::text)$$,
  'managed limit is explicitly AVIORA-managed and can show exceeded'
);
select results_eq(
  $$select managed_available_limit,coverage_state from public.card_managed_limit_positions_v1
    where card_id='b2000000-0000-4000-8000-000000000104'$$,
  $$values (null::numeric,'limit_unknown'::text)$$,
  'zero or unknown configured limit never fabricates availability'
);
select ok(
  (select limitation_notice like 'Gerencial:%' from public.card_managed_limit_positions_v1 where card_id='b2000000-0000-4000-8000-000000000103'),
  'managed limit carries issuer-data limitation notice'
);

-- Once any ledger exists, canonical status is historical identity too. A
-- compensating operation must represent later economic events.
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select lives_ok(
  $$update public.transactions set status='pendente'
    where id='b2000000-0000-4000-8000-000000000413'$$,
  'pre-ledger status remains compatible with the legacy writer'
);
select lives_ok(
  $$select public.pay_my_card_invoice_v1(
    (select card_billing_cycle_id from public.transactions where id='b2000000-0000-4000-8000-000000000413'),
    'b2000000-0000-4000-8000-000000000201',700,'2028-10-31',
    'b2000000-0000-4000-8000-000000000816')$$,
  'fixture creates ledger for a pending purchase'
);
select throws_ok(
  $$update public.transactions set status='pendente'
    where id='b2000000-0000-4000-8000-000000000411'$$,
  '23514',null,'post-ledger realized purchase cannot be reclassified as pending'
);
select throws_ok(
  $$update public.transactions set status='realizado'
    where id='b2000000-0000-4000-8000-000000000413'$$,
  '23514',null,'post-ledger pending purchase cannot be reclassified as realized'
);
reset role;

-- RLS A/B after runtime artifacts exist.
select set_config(
  'aviora_test.victim_cycle',
  (select card_billing_cycle_id::text from public.transactions where id='b2000000-0000-4000-8000-000000000413'),
  true
);
select set_config(
  'aviora_test.victim_payment',
  (select id::text from public.card_invoice_payments where operation_id='b2000000-0000-4000-8000-000000000803'),
  true
);
select set_config(
  'aviora_test.victim_credit',
  (select id::text from public.card_purchase_credits where operation_id='b2000000-0000-4000-8000-000000000801'),
  true
);
select set_config('aviora_test.victim_transaction','b2000000-0000-4000-8000-000000000413',true);
select set_config('aviora_test.victim_card','b2000000-0000-4000-8000-000000000101',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select ok((select count(*) from public.card_billing_cycles)>0,'user A reads own cycles');
select ok((select count(*) from public.card_invoice_payments)>0,'user A reads own payments');
select ok((select count(*) from public.card_account_settlements)>0,'user A reads own settlements');
select throws_ok(
  $$insert into public.card_billing_cycles(user_id,card_id,cycle_key,closing_day_snapshot,due_day_snapshot,cycle_start_date,closing_date,due_date)
    values ('b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000105','2028-01-01',15,25,'2027-12-16','2028-01-15','2028-01-25')$$,
  '42501',null,'user A cannot spoof user B cycle through direct DML'
);
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000002',true);
select results_eq($$select count(*) from public.card_billing_cycles$$,array[0::bigint],'user B cannot read user A cycle');
select results_eq($$select count(*) from public.card_invoice_payments$$,array[0::bigint],'user B cannot read user A payment');
select results_eq($$select count(*) from public.card_payment_allocations$$,array[0::bigint],'user B cannot read user A allocation');
select results_eq($$select count(*) from public.card_account_settlements$$,array[0::bigint],'user B cannot read user A settlement');
select results_eq($$select count(*) from public.card_purchase_credits$$,array[0::bigint],'user B cannot read user A credit');
select throws_ok(
  $$select public.pay_my_card_invoice_v1(
    current_setting('aviora_test.victim_cycle')::uuid,
    'b2000000-0000-4000-8000-000000000202',1,'2028-10-01',gen_random_uuid())$$,
  'P0002',null,'user B cannot pay explicit user A cycle even with own account'
);
select throws_ok(
  $$select public.structure_my_card_purchase_v1(current_setting('aviora_test.victim_transaction')::uuid)$$,
  'P0002',null,'user B cannot structure explicit user A transaction'
);
select throws_ok(
  $$select public.credit_my_card_purchase_v1(
    current_setting('aviora_test.victim_transaction')::uuid,1,'2028-11-01',gen_random_uuid(),'cross-user credit')$$,
  'P0002',null,'user B cannot credit explicit user A transaction'
);
select throws_ok(
  $$select public.reverse_my_card_payment_v1(
    current_setting('aviora_test.victim_payment')::uuid,gen_random_uuid(),'2028-11-01','cross-user reversal')$$,
  'P0002',null,'user B cannot reverse explicit user A payment'
);
select throws_ok(
  $$select public.reverse_my_card_purchase_credit_v1(
    current_setting('aviora_test.victim_credit')::uuid,gen_random_uuid(),'2028-11-01','cross-user reversal')$$,
  'P0002',null,'user B cannot reverse explicit user A credit'
);
select results_eq(
  $$select count(*) from public.get_my_card_billing_summary_v1(current_setting('aviora_test.victim_card')::uuid)$$,
  array[0::bigint],
  'user B summary returns zero rows for explicit user A card'
);
reset role;

set local role anon;
select throws_ok($$select * from public.card_billing_cycles$$,'42501',null,'anon cannot read billing tables');
select throws_ok($$select * from public.get_my_card_billing_summary_v1(null)$$,'42501',null,'anon cannot execute summary');
reset role;

select * from finish();
rollback;
