-- OPERATIONAL ROLLBACK CANDIDATE — DO NOT RUN WITHOUT EXPLICIT AUTHORIZATION.
-- Safe precondition: no production writer may still call the V1 RPCs.
-- Default strategy is application-first; this destructive schema rollback is
-- reserved for an empty/unreleased installation and refuses to erase ledger data.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0));

do $rollback_preflight$
begin
  if to_regclass('public.card_billing_cycles') is null
     or to_regclass('public.card_invoice_payments') is null
     or to_regclass('public.card_purchase_credits') is null
     or not exists (
       select 1
       from pg_namespace n
       join pg_roles r on r.oid = n.nspowner
       where n.nspname = 'billing_private'
         and r.rolname = current_user
     ) then
    raise exception 'card billing rollback requires the complete V1 schema'
      using errcode = 'P0001';
  end if;
end
$rollback_preflight$;

lock table public.transactions,
           public.card_billing_cycles,
           public.card_invoice_payments,
           public.card_purchase_credits
  in access exclusive mode;

do $rollback_guard$
begin
  if exists (select 1 from public.card_invoice_payments)
     or exists (select 1 from public.card_purchase_credits)
     or exists (select 1 from public.card_billing_cycles)
     or exists (
       select 1 from public.transactions
       where card_billing_cycle_id is not null
     ) then
    raise exception 'refusing destructive rollback: billing ledger or cycle memberships exist; use application-first rollback'
      using errcode = 'P0001';
  end if;
end
$rollback_guard$;

drop function public.get_my_card_billing_summary_v1(uuid);
drop function public.reverse_my_card_purchase_credit_v1(uuid, uuid, timestamptz, text);
drop function public.credit_my_card_purchase_v1(uuid, numeric, timestamptz, uuid, text);
drop function public.reverse_my_card_payment_v1(uuid, uuid, timestamptz, text);
drop function public.pay_my_card_invoice_v1(uuid, uuid, numeric, timestamptz, uuid);

drop view public.card_billing_shadow_comparison_v1;
drop view public.card_invoice_balances_v1;

drop trigger card_purchase_credits_append_only_v1 on public.card_purchase_credits;
drop trigger card_purchase_credits_guard_insert_v1 on public.card_purchase_credits;
drop trigger card_invoice_payments_append_only_v1 on public.card_invoice_payments;
drop trigger card_invoice_payments_guard_insert_v1 on public.card_invoice_payments;
drop trigger card_billing_cycles_immutable_v1 on public.card_billing_cycles;
drop trigger transactions_guard_linked_card_delete_v1 on public.transactions;
drop trigger transactions_guard_card_cycle_v1 on public.transactions;

drop function billing_private.guard_payment_insert_v1();
drop function billing_private.guard_purchase_credit_insert_v1();
drop function billing_private.reject_ledger_mutation_v1();
drop function billing_private.reject_cycle_update_v1();
drop function billing_private.guard_transaction_cycle_v1();
drop function billing_private.guard_linked_transaction_delete_v1();

alter table public.transactions
  drop constraint transactions_card_billing_cycle_user_fkey;
alter table public.transactions
  drop column card_billing_cycle_id;

drop table public.card_purchase_credits;
drop table public.card_invoice_payments;
drop table public.card_billing_cycles;

drop schema billing_private;

commit;
