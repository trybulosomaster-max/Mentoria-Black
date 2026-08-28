-- OPERATIONAL ROLLBACK CANDIDATE — DO NOT RUN WITHOUT EXPLICIT AUTHORIZATION.
-- Safe precondition: no production writer may still call the V1 RPCs.
-- Default strategy is application-first; this destructive schema rollback is
-- reserved for an empty/unreleased installation and refuses to erase ledger data.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0));

do $rollback_guard$
begin
  if to_regclass('public.card_billing_cycles') is null
     or to_regclass('public.card_invoice_payments') is null
     or to_regclass('public.card_purchase_credits') is null then
    raise exception 'card billing rollback requires the complete V1 schema'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.card_invoice_payments)
     or exists (select 1 from public.card_purchase_credits)
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
drop function public.attach_my_card_transaction_to_cycle_v1(uuid);

drop view public.card_limit_positions_v1;
drop view public.card_invoice_balances_v1;

drop trigger transactions_guard_card_cycle_v1 on public.transactions;
alter table public.transactions
  drop constraint transactions_card_billing_cycle_user_fkey;
alter table public.transactions
  drop column card_billing_cycle_id;

drop table public.card_purchase_credits;
drop table public.card_invoice_payments;
drop table public.card_billing_cycles;

drop function billing_private.ensure_cycle_v1(uuid, uuid, date);
drop function billing_private.guard_transaction_cycle_v1();
drop function billing_private.clamped_day_v1(date, integer);
drop function billing_private.last_day_of_month_v1(date);
drop schema billing_private;

commit;
