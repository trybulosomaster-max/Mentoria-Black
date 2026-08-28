-- FUTURE pgTAP SUITE — DO NOT RUN WITHOUT EXPLICIT MIGRATION AUTHORIZATION.
-- Requires 20260828130535_aviora_card_billing_backend_v1.sql in a disposable clone.

begin;
create extension if not exists pgtap;
select plan(34);

select has_table('public', 'card_billing_cycles');
select has_table('public', 'card_invoice_payments');
select has_table('public', 'card_purchase_credits');
select has_column('public', 'transactions', 'card_billing_cycle_id');
select has_view('public', 'card_invoice_balances_v1');
select has_view('public', 'card_limit_positions_v1');

select ok((select relrowsecurity from pg_class where oid = 'public.card_billing_cycles'::regclass), 'RLS enabled on cycles');
select ok((select relrowsecurity from pg_class where oid = 'public.card_invoice_payments'::regclass), 'RLS enabled on payments');
select ok((select relrowsecurity from pg_class where oid = 'public.card_purchase_credits'::regclass), 'RLS enabled on credits');

select policies_are(
  'public', 'card_billing_cycles', array['card_billing_cycles_select_own']
);
select policies_are(
  'public', 'card_invoice_payments', array['card_invoice_payments_select_own']
);
select policies_are(
  'public', 'card_purchase_credits', array['card_purchase_credits_select_own']
);

select ok(not has_table_privilege('anon', 'public.card_billing_cycles', 'select'), 'anon cannot read cycles');
select ok(not has_table_privilege('anon', 'public.card_invoice_payments', 'select'), 'anon cannot read payments');
select ok(not has_table_privilege('anon', 'public.card_purchase_credits', 'select'), 'anon cannot read credits');
select ok(has_table_privilege('authenticated', 'public.card_billing_cycles', 'select'), 'authenticated reads own cycles through RLS');
select ok(not has_table_privilege('authenticated', 'public.card_billing_cycles', 'insert,update,delete'), 'authenticated cannot mutate cycles directly');
select ok(not has_table_privilege('authenticated', 'public.card_invoice_payments', 'insert,update,delete'), 'authenticated cannot mutate payments directly');
select ok(not has_table_privilege('authenticated', 'public.card_purchase_credits', 'insert,update,delete'), 'authenticated cannot mutate credits directly');

select has_function('public', 'attach_my_card_transaction_to_cycle_v1', array['uuid']);
select has_function('public', 'pay_my_card_invoice_v1', array['uuid','uuid','numeric','timestamp with time zone','uuid']);
select has_function('public', 'reverse_my_card_payment_v1', array['uuid','uuid','timestamp with time zone','text']);
select has_function('public', 'credit_my_card_purchase_v1', array['uuid','numeric','timestamp with time zone','uuid','text']);
select has_function('public', 'reverse_my_card_purchase_credit_v1', array['uuid','uuid','timestamp with time zone','text']);
select has_function('public', 'get_my_card_billing_summary_v1', array['uuid']);

select function_privs_are(
  'public', 'pay_my_card_invoice_v1', array['uuid','uuid','numeric','timestamp with time zone','uuid'],
  'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'pay_my_card_invoice_v1', array['uuid','uuid','numeric','timestamp with time zone','uuid'],
  'anon', array[]::text[]
);

select index_is_unique('public', 'card_invoice_payments', 'card_invoice_payments_operation_key');
select index_is_unique('public', 'card_purchase_credits', 'card_purchase_credits_operation_key');
select has_index('public', 'card_invoice_payments', 'card_invoice_payments_single_reversal_uidx');
select has_index('public', 'card_purchase_credits', 'card_purchase_credits_single_reversal_uidx');

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

select * from finish();
rollback;
