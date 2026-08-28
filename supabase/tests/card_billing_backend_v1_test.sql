-- LOCAL/DISPOSABLE pgTAP SUITE — NEVER TARGET A LINKED OR REMOTE PROJECT.
-- Requires 20260828130535_aviora_card_billing_backend_v1.sql to have been
-- applied to a disposable V82-compatible clone. All fixtures are synthetic and
-- rolled back. Mutation RPCs intentionally remain unavailable in shadow mode.

begin;
create extension if not exists pgtap;
select no_plan();

-- Structural contract.
select has_table('public', 'card_billing_cycles', 'billing cycles table exists');
select has_table('public', 'card_invoice_payments', 'payment ledger table exists');
select has_table('public', 'card_purchase_credits', 'credit ledger table exists');
select has_column('public', 'transactions', 'card_billing_cycle_id', 'transaction has nullable cycle membership');
select has_view('public', 'card_invoice_balances_v1', 'invoice balance view exists');
select has_view('public', 'card_billing_shadow_comparison_v1', 'shadow comparison view exists');

select ok((select relrowsecurity from pg_class where oid = 'public.card_billing_cycles'::regclass), 'RLS enabled on cycles');
select ok((select relrowsecurity from pg_class where oid = 'public.card_invoice_payments'::regclass), 'RLS enabled on payments');
select ok((select relrowsecurity from pg_class where oid = 'public.card_purchase_credits'::regclass), 'RLS enabled on credits');

select policies_are('public', 'card_billing_cycles', array['card_billing_cycles_select_own']);
select policies_are('public', 'card_invoice_payments', array['card_invoice_payments_select_own']);
select policies_are('public', 'card_purchase_credits', array['card_purchase_credits_select_own']);

select has_function('public', 'pay_my_card_invoice_v1', array['uuid','uuid','numeric','timestamp with time zone','uuid']);
select has_function('public', 'reverse_my_card_payment_v1', array['uuid','uuid','timestamp with time zone','text']);
select has_function('public', 'credit_my_card_purchase_v1', array['uuid','numeric','timestamp with time zone','uuid','text']);
select has_function('public', 'reverse_my_card_purchase_credit_v1', array['uuid','uuid','timestamp with time zone','text']);
select has_function('public', 'get_my_card_billing_summary_v1', array['uuid']);

select has_trigger('public', 'transactions', 'transactions_guard_card_cycle_v1', 'transaction cycle update guard exists');
select has_trigger('public', 'transactions', 'transactions_guard_linked_card_delete_v1', 'settled transaction delete guard exists');
select has_trigger('public', 'card_billing_cycles', 'card_billing_cycles_immutable_v1', 'cycle snapshot update guard exists');
select has_trigger('public', 'card_invoice_payments', 'card_invoice_payments_guard_insert_v1', 'payment insert guard exists');
select has_trigger('public', 'card_purchase_credits', 'card_purchase_credits_guard_insert_v1', 'credit insert guard exists');
select has_trigger('public', 'card_invoice_payments', 'card_invoice_payments_append_only_v1', 'payment append-only guard exists');
select has_trigger('public', 'card_purchase_credits', 'card_purchase_credits_append_only_v1', 'credit append-only guard exists');

select index_is_unique('public', 'card_invoice_payments', 'card_invoice_payments_operation_key');
select index_is_unique('public', 'card_purchase_credits', 'card_purchase_credits_operation_key');
select has_index('public', 'card_invoice_payments', 'card_invoice_payments_single_reversal_uidx', 'payment has one reversal index');
select has_index('public', 'card_purchase_credits', 'card_purchase_credits_single_reversal_uidx', 'credit has one reversal index');

select fk_ok(
  'public', 'card_invoice_payments', array['billing_cycle_id','user_id'],
  'public', 'card_billing_cycles', array['id','user_id']
);
select fk_ok(
  'public', 'card_purchase_credits', array['transaction_id','user_id'],
  'public', 'transactions', array['id','user_id']
);
select fk_ok(
  'public', 'transactions', array['card_billing_cycle_id','user_id'],
  'public', 'card_billing_cycles', array['id','user_id']
);
select ok(
  not (select convalidated from pg_constraint
       where conrelid = 'public.transactions'::regclass
         and conname = 'transactions_card_billing_cycle_user_fkey'),
  'transition FK is intentionally NOT VALID pending explicit legacy validation'
);

-- Least privilege and shadow-mode activation hold.
select ok(not has_table_privilege('anon', 'public.card_billing_cycles', 'select'), 'anon cannot read cycles');
select ok(not has_table_privilege('anon', 'public.card_invoice_payments', 'select'), 'anon cannot read payments');
select ok(not has_table_privilege('anon', 'public.card_purchase_credits', 'select'), 'anon cannot read credits');
select ok(has_table_privilege('authenticated', 'public.card_billing_cycles', 'select'), 'authenticated can read own cycles through RLS');
select ok(has_table_privilege('authenticated', 'public.card_invoice_payments', 'select'), 'authenticated can read own payments through RLS');
select ok(has_table_privilege('authenticated', 'public.card_purchase_credits', 'select'), 'authenticated can read own credits through RLS');
select ok(not has_table_privilege('authenticated', 'public.card_billing_cycles', 'insert,update,delete'), 'authenticated cannot mutate cycles directly');
select ok(not has_table_privilege('authenticated', 'public.card_invoice_payments', 'insert,update,delete'), 'authenticated cannot mutate payments directly');
select ok(not has_table_privilege('authenticated', 'public.card_purchase_credits', 'insert,update,delete'), 'authenticated cannot mutate credits directly');

select function_privs_are(
  'public', 'get_my_card_billing_summary_v1', array['uuid'],
  'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'get_my_card_billing_summary_v1', array['uuid'],
  'anon', array[]::text[]
);
select function_privs_are(
  'public', 'pay_my_card_invoice_v1', array['uuid','uuid','numeric','timestamp with time zone','uuid'],
  'authenticated', array[]::text[]
);
select function_privs_are(
  'public', 'reverse_my_card_payment_v1', array['uuid','uuid','timestamp with time zone','text'],
  'authenticated', array[]::text[]
);
select function_privs_are(
  'public', 'credit_my_card_purchase_v1', array['uuid','numeric','timestamp with time zone','uuid','text'],
  'authenticated', array[]::text[]
);
select function_privs_are(
  'public', 'reverse_my_card_purchase_credit_v1', array['uuid','uuid','timestamp with time zone','text'],
  'authenticated', array[]::text[]
);
select ok(has_table_privilege('authenticated', 'public.card_invoice_balances_v1', 'select'), 'authenticated can read RLS-protected invoice balance view');
select ok(has_table_privilege('authenticated', 'public.card_billing_shadow_comparison_v1', 'select'), 'authenticated can read own shadow coverage comparison');
select ok(not has_table_privilege('anon', 'public.card_invoice_balances_v1', 'select'), 'anon cannot read invoice balance view');
select ok(not has_table_privilege('anon', 'public.card_billing_shadow_comparison_v1', 'select'), 'anon cannot read shadow comparison');

select ok(
  not exists (
    select 1
    from unnest(array[
      'public.pay_my_card_invoice_v1(uuid,uuid,numeric,timestamptz,uuid)'::regprocedure,
      'public.reverse_my_card_payment_v1(uuid,uuid,timestamptz,text)'::regprocedure,
      'public.credit_my_card_purchase_v1(uuid,numeric,timestamptz,uuid,text)'::regprocedure,
      'public.reverse_my_card_purchase_credit_v1(uuid,uuid,timestamptz,text)'::regprocedure
    ]) as f(oid)
    where has_function_privilege('authenticated', f.oid, 'EXECUTE')
       or has_function_privilege('anon', f.oid, 'EXECUTE')
  ),
  'no mutation RPC is client-executable before the activation migration'
);

-- Deterministic synthetic fixtures.
insert into auth.users(id, email)
values
  ('b1000000-0000-4000-8000-000000000001', 'card-billing-a@example.invalid'),
  ('b1000000-0000-4000-8000-000000000002', 'card-billing-b@example.invalid');

insert into public.cards(id, user_id, name, "limit", closing_day, due_day)
values
  ('b1000000-0000-4000-8000-000000000101', 'b1000000-0000-4000-8000-000000000001', 'Synthetic A', 5000, 20, 30),
  ('b1000000-0000-4000-8000-000000000102', 'b1000000-0000-4000-8000-000000000002', 'Synthetic B', 3000, 15, 25),
  ('b1000000-0000-4000-8000-000000000103', 'b1000000-0000-4000-8000-000000000001', 'Missing dates', 1000, null, null);

insert into public.accounts(id, user_id, name, opening_balance)
values
  ('b1000000-0000-4000-8000-000000000201', 'b1000000-0000-4000-8000-000000000001', 'Synthetic account A', 5000),
  ('b1000000-0000-4000-8000-000000000202', 'b1000000-0000-4000-8000-000000000002', 'Synthetic account B', 5000);

insert into public.card_billing_cycles(
  id, user_id, card_id, cycle_key, cycle_start_date, closing_date, due_date
) values
  ('b1000000-0000-4000-8000-000000000301', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000101', '2099-01-01', '2098-12-21', '2099-01-20', '2099-01-30'),
  ('b1000000-0000-4000-8000-000000000302', 'b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000102', '2099-01-01', '2098-12-16', '2099-01-15', '2099-01-25');

select throws_ok(
  $$insert into public.card_billing_cycles(id, user_id, card_id, cycle_key, cycle_start_date, closing_date, due_date)
    values ('b1000000-0000-4000-8000-000000000311', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000101', '2099-02-01', '2099-01-21', null, '2099-02-28')$$,
  '23502', null, 'cycle creation fails closed when closing_date is NULL'
);
select throws_ok(
  $$insert into public.card_billing_cycles(id, user_id, card_id, cycle_key, cycle_start_date, closing_date, due_date)
    values ('b1000000-0000-4000-8000-000000000312', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000101', '2099-03-01', '2099-02-21', '2099-03-20', null)$$,
  '23502', null, 'cycle creation fails closed when due_date is NULL'
);

insert into public.transactions(
  id, user_id, transaction_date, description, amount, card_id,
  transaction_type, status, card_billing_cycle_id
) values
  ('b1000000-0000-4000-8000-000000000401', 'b1000000-0000-4000-8000-000000000001', '2099-01-10', 'Synthetic purchase A', 1000, 'b1000000-0000-4000-8000-000000000101', 'despesa', 'realizado', 'b1000000-0000-4000-8000-000000000301'),
  ('b1000000-0000-4000-8000-000000000402', 'b1000000-0000-4000-8000-000000000002', '2099-01-10', 'Synthetic purchase B', 500, 'b1000000-0000-4000-8000-000000000102', 'despesa', 'realizado', 'b1000000-0000-4000-8000-000000000302'),
  ('b1000000-0000-4000-8000-000000000403', 'b1000000-0000-4000-8000-000000000001', '2099-02-10', 'Unlinked control', 25, 'b1000000-0000-4000-8000-000000000101', 'despesa', 'pendente', null);

insert into public.card_invoice_payments(
  id, user_id, billing_cycle_id, source_account_id,
  entry_kind, amount, occurred_at, operation_id
) values
  ('b1000000-0000-4000-8000-000000000501', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000301', 'b1000000-0000-4000-8000-000000000201', 'payment', 100, '2099-01-20T12:00:00Z', 'b1000000-0000-4000-8000-000000000511');

select throws_ok(
  $$insert into public.card_invoice_payments(
      id, user_id, billing_cycle_id, source_account_id,
      entry_kind, amount, occurred_at, operation_id, reversal_of_id, reason_code
    ) values (
      'b1000000-0000-4000-8000-000000000502',
      'b1000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000301',
      'b1000000-0000-4000-8000-000000000201',
      'payment_reversal', 100, '2099-01-21T12:00:00Z',
      'b1000000-0000-4000-8000-000000000512',
      'b1000000-0000-4000-8000-000000000501', null
    )$$,
  '23514', null, 'privileged payment reversal requires a non-null reason'
);

insert into public.card_purchase_credits(
  id, user_id, transaction_id,
  entry_kind, amount, occurred_at, operation_id, reason_code
) values
  ('b1000000-0000-4000-8000-000000000601', 'b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000401', 'purchase_credit', 50, '2099-01-21T12:00:00Z', 'b1000000-0000-4000-8000-000000000611', 'synthetic credit');

-- RLS A/B and callable surface.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select results_eq($$select count(*) from public.card_billing_cycles$$, array[1::bigint], 'user A sees only own cycle');
select results_eq($$select count(*) from public.card_invoice_payments$$, array[1::bigint], 'user A sees only own payment');
select results_eq($$select count(*) from public.card_purchase_credits$$, array[1::bigint], 'user A sees only own purchase credit');
select results_eq($$select count(*) from public.get_my_card_billing_summary_v1(null)$$, array[1::bigint], 'summary returns only user A cycle');
select throws_ok(
  $$select public.pay_my_card_invoice_v1('b1000000-0000-4000-8000-000000000301', 'b1000000-0000-4000-8000-000000000201', 1, clock_timestamp(), gen_random_uuid())$$,
  '42501', null, 'authenticated cannot activate dormant payment RPC'
);
select throws_ok(
  $$update public.transactions set card_billing_cycle_id='b1000000-0000-4000-8000-000000000301' where id='b1000000-0000-4000-8000-000000000403'$$,
  '42501', null, 'authenticated cannot activate shadow cycle writer through direct DML'
);
select results_eq(
  $$select coverage_state from public.card_billing_shadow_comparison_v1 where card_id='b1000000-0000-4000-8000-000000000101' and transaction_month='2099-01-01'$$,
  array['complete'::text],
  'shadow comparison reports structured coverage without fabricating a managed limit'
);

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select id from public.card_billing_cycles order by id$$,
  array['b1000000-0000-4000-8000-000000000302'::uuid],
  'user B cannot read user A cycle'
);
select results_eq($$select count(*) from public.card_invoice_payments$$, array[0::bigint], 'user B cannot read user A payment');
select results_eq($$select count(*) from public.card_purchase_credits$$, array[0::bigint], 'user B cannot read user A credit');
reset role;

set local role anon;
select throws_ok($$select * from public.card_billing_cycles$$, '42501', null, 'anon has no billing-table access');
select throws_ok($$select * from public.get_my_card_billing_summary_v1(null)$$, '42501', null, 'anon cannot execute summary RPC');
reset role;

-- Settled purchase invariants and append-only ledgers.
select throws_ok(
  $$update public.card_billing_cycles set due_date='2099-01-31' where id='b1000000-0000-4000-8000-000000000301'$$,
  '23514', null, 'persisted cycle snapshot is immutable even to a privileged writer'
);
select throws_ok(
  $$update public.transactions set amount = 999 where id = 'b1000000-0000-4000-8000-000000000401'$$,
  '23514', null, 'settled purchase amount is immutable'
);
select throws_ok(
  $$update public.transactions set status = 'cancelado' where id = 'b1000000-0000-4000-8000-000000000401'$$,
  '23514', null, 'settled purchase cannot cross cancellation boundary'
);
select throws_ok(
  $$update public.transactions set transaction_date = '2099-02-10' where id = 'b1000000-0000-4000-8000-000000000401'$$,
  '23514', null, 'settled canonical transaction_date cannot be moved'
);
select throws_ok(
  $$delete from public.transactions where id = 'b1000000-0000-4000-8000-000000000401'$$,
  '23514', null, 'settled purchase cannot be deleted'
);
select lives_ok(
  $$update public.transactions set note = 'allowed non-financial edit' where id = 'b1000000-0000-4000-8000-000000000401'$$,
  'unrelated linked-purchase metadata remains editable'
);
select lives_ok(
  $$update public.transactions set amount = 30 where id = 'b1000000-0000-4000-8000-000000000403'$$,
  'unlinked legacy transaction remains compatible'
);
select lives_ok(
  $$update public.transactions set transaction_date = '2099-02-10' where id = 'b1000000-0000-4000-8000-000000000402'$$,
  'pre-ledger legacy edit stays compatible and clears stale membership'
);
select results_eq(
  $$select concat_ws('|',transaction_date,coalesce(card_billing_cycle_id::text,'NULL')) from public.transactions where id='b1000000-0000-4000-8000-000000000402'$$,
  array['2099-02-10|NULL'::text],
  'legacy edit preserves supplied transaction_date and never recalculates it'
);
select throws_ok(
  $$update public.card_invoice_payments set amount = 10 where id = 'b1000000-0000-4000-8000-000000000501'$$,
  '23514', null, 'payment ledger rejects update even for a privileged writer'
);
select throws_ok(
  $$delete from public.card_invoice_payments where id = 'b1000000-0000-4000-8000-000000000501'$$,
  '23514', null, 'payment ledger rejects delete even for a privileged writer'
);
select throws_ok(
  $$update public.card_purchase_credits set amount = 10 where id = 'b1000000-0000-4000-8000-000000000601'$$,
  '23514', null, 'credit ledger rejects update even for a privileged writer'
);
select throws_ok(
  $$delete from public.card_purchase_credits where id = 'b1000000-0000-4000-8000-000000000601'$$,
  '23514', null, 'credit ledger rejects delete even for a privileged writer'
);

-- No automatic calendar constructor exists while the calendar contract is open.
select col_not_null('public', 'card_billing_cycles', 'closing_date', 'persisted cycle closing_date cannot be NULL');
select col_not_null('public', 'card_billing_cycles', 'due_date', 'persisted cycle due_date cannot be NULL');
select ok(
  to_regprocedure('public.attach_my_card_transaction_to_cycle_v1(uuid)') is null,
  'no client cycle constructor hides an unapproved closing rule'
);
update public.cards set closing_day = 3, due_day = 8
where id = 'b1000000-0000-4000-8000-000000000101';
select results_eq(
  $$select closing_date, due_date from public.card_billing_cycles where id = 'b1000000-0000-4000-8000-000000000301'$$,
  $$values ('2099-01-20'::date, '2099-01-30'::date)$$,
  'editing card dates does not rewrite a persisted historical cycle'
);
select results_eq(
  $$select transaction_date from public.transactions where id = 'b1000000-0000-4000-8000-000000000401'$$,
  array['2099-01-10'::date],
  'transaction_date remains canonical and unchanged'
);

select * from finish();
rollback;
