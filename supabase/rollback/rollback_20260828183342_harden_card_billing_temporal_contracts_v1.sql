-- OPERATIONAL ROLLBACK CANDIDATE — DO NOT RUN WITHOUT EXPLICIT AUTHORIZATION.
-- Safe only while no durable structured billing data exists. Mutators remain
-- revoked after rollback; reactivation always requires a separate migration.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '3min';
select pg_advisory_xact_lock(
  hashtextextended('aviora:card-billing-mutator-activation-v1', 0)
);

do $rollback_preflight$
begin
  if to_regprocedure('billing_private.structure_my_card_purchase_pre_temporal_v1(uuid)') is null
     or to_regprocedure('billing_private.create_my_card_installment_series_pre_temporal_v1(uuid,uuid,date,text,numeric,integer,text,text,text)') is null
     or to_regprocedure('billing_private.create_my_card_installment_series_with_metadata_pre_temporal_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)') is null
     or to_regprocedure('billing_private.create_my_card_purchase_pre_temporal_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)') is null
     or to_regprocedure('billing_private.pay_my_card_invoice_pre_temporal_v1(uuid,uuid,numeric,date,uuid)') is null
     or to_regprocedure('billing_private.reverse_my_card_payment_pre_temporal_v1(uuid,uuid,date,text)') is null
     or to_regprocedure('billing_private.credit_my_card_purchase_pre_temporal_v1(uuid,numeric,date,uuid,text)') is null
     or to_regprocedure('billing_private.reverse_my_card_purchase_credit_pre_temporal_v1(uuid,uuid,date,text)') is null
     or to_regprocedure('billing_private.get_my_card_billing_summary_as_of_pre_temporal_v1(uuid,date)') is null
     or to_regprocedure('billing_private.get_my_card_account_positions_pre_temporal_v1(uuid,date)') is null
     or to_regprocedure('billing_private.guard_card_purchase_temporal_v1()') is null
     or to_regprocedure('billing_private.guard_card_payment_temporal_v1()') is null then
    raise exception 'temporal hardening rollback requires the complete hardened contract'
      using errcode = 'P0001';
  end if;

end
$rollback_preflight$;

lock table public.transactions,
           billing_private.writer_context_v1,
           public.card_installment_series,
           public.card_billing_cycles,
           public.card_invoice_payments,
           public.card_payment_allocations,
           public.card_account_settlements,
           public.card_purchase_credits
  in access exclusive mode;

do $rollback_data_guard$
begin
  if exists (select 1 from public.card_installment_series)
     or exists (select 1 from public.card_billing_cycles)
     or exists (select 1 from public.card_invoice_payments)
     or exists (select 1 from public.card_payment_allocations)
     or exists (select 1 from public.card_account_settlements)
     or exists (select 1 from public.card_purchase_credits)
     or exists (
       select 1 from public.transactions
       where card_billing_cycle_id is not null or installment_total is not null
     ) then
    raise exception 'refusing temporal hardening rollback after use; use application-first forward repair'
      using errcode = 'P0001';
  end if;
end
$rollback_data_guard$;

revoke all on function public.structure_my_card_purchase_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_card_billing_summary_as_of_v1(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_card_account_positions_v1(uuid, date)
  from public, anon, authenticated, service_role;

drop function public.structure_my_card_purchase_v1(uuid);
drop function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text);
drop function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text);
drop function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text);
drop function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid);
drop function public.reverse_my_card_payment_v1(uuid, uuid, date, text);
drop function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text);
drop function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text);
drop function public.get_my_card_billing_summary_as_of_v1(uuid, date);
drop function public.get_my_card_account_positions_v1(uuid, date);

drop trigger transactions_guard_card_purchase_temporal_v1 on public.transactions;
drop function billing_private.guard_card_purchase_temporal_v1();
drop trigger card_invoice_payments_guard_temporal_v1 on public.card_invoice_payments;
drop function billing_private.guard_card_payment_temporal_v1();

alter function billing_private.structure_my_card_purchase_pre_temporal_v1(uuid)
  set schema public;
alter function public.structure_my_card_purchase_pre_temporal_v1(uuid)
  rename to structure_my_card_purchase_v1;

alter function billing_private.create_my_card_installment_series_pre_temporal_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  set schema public;
alter function public.create_my_card_installment_series_pre_temporal_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  rename to create_my_card_installment_series_v1;

alter function billing_private.create_my_card_installment_series_with_metadata_pre_temporal_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  set schema public;
alter function public.create_my_card_installment_series_with_metadata_pre_temporal_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  rename to create_my_card_installment_series_with_metadata_v1;

alter function billing_private.create_my_card_purchase_pre_temporal_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  set schema public;
alter function public.create_my_card_purchase_pre_temporal_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  rename to create_my_card_purchase_v1;

alter function billing_private.pay_my_card_invoice_pre_temporal_v1(uuid, uuid, numeric, date, uuid)
  set schema public;
alter function public.pay_my_card_invoice_pre_temporal_v1(uuid, uuid, numeric, date, uuid)
  rename to pay_my_card_invoice_v1;

alter function billing_private.reverse_my_card_payment_pre_temporal_v1(uuid, uuid, date, text)
  set schema public;
alter function public.reverse_my_card_payment_pre_temporal_v1(uuid, uuid, date, text)
  rename to reverse_my_card_payment_v1;

alter function billing_private.credit_my_card_purchase_pre_temporal_v1(uuid, numeric, date, uuid, text)
  set schema public;
alter function public.credit_my_card_purchase_pre_temporal_v1(uuid, numeric, date, uuid, text)
  rename to credit_my_card_purchase_v1;

alter function billing_private.reverse_my_card_purchase_credit_pre_temporal_v1(uuid, uuid, date, text)
  set schema public;
alter function public.reverse_my_card_purchase_credit_pre_temporal_v1(uuid, uuid, date, text)
  rename to reverse_my_card_purchase_credit_v1;

alter function billing_private.get_my_card_billing_summary_as_of_pre_temporal_v1(uuid, date)
  set schema public;
alter function public.get_my_card_billing_summary_as_of_pre_temporal_v1(uuid, date)
  rename to get_my_card_billing_summary_as_of_v1;

alter function billing_private.get_my_card_account_positions_pre_temporal_v1(uuid, date)
  set schema public;
alter function public.get_my_card_account_positions_pre_temporal_v1(uuid, date)
  rename to get_my_card_account_positions_v1;

drop policy card_installment_series_select_own on public.card_installment_series;
create policy card_installment_series_select_own
  on public.card_installment_series for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')));

drop policy card_billing_cycles_select_own on public.card_billing_cycles;
create policy card_billing_cycles_select_own
  on public.card_billing_cycles for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')));

drop policy card_invoice_payments_select_own on public.card_invoice_payments;
create policy card_invoice_payments_select_own
  on public.card_invoice_payments for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')));

drop policy card_payment_allocations_select_own on public.card_payment_allocations;
create policy card_payment_allocations_select_own
  on public.card_payment_allocations for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')));

drop policy card_account_settlements_select_own on public.card_account_settlements;
create policy card_account_settlements_select_own
  on public.card_account_settlements for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')));

drop policy card_purchase_credits_select_own on public.card_purchase_credits;
create policy card_purchase_credits_select_own
  on public.card_purchase_credits for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')));

-- Restore only the pre-hardening reader ACL. All eight mutators stay dormant.
revoke all on function public.structure_my_card_purchase_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_card_billing_summary_as_of_v1(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_card_account_positions_v1(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_card_billing_summary_as_of_v1(uuid, date)
  to authenticated;
grant execute on function public.get_my_card_account_positions_v1(uuid, date)
  to authenticated;

commit;
