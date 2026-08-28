-- OPERATIONAL ROLLBACK CANDIDATE — DO NOT RUN WITHOUT EXPLICIT AUTHORIZATION.
-- Safe only while the activation has produced no structured billing data.
-- After first use, revoke consumers application-first and use a forward migration.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:card-billing-mutator-activation-v1', 0));

do $rollback_preflight$
begin
  if to_regprocedure('public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)') is null
     or to_regprocedure('public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)') is null
     or to_regprocedure('public.get_my_card_billing_summary_as_of_v1(uuid,date)') is null
     or to_regprocedure('public.get_my_card_account_positions_v1(uuid,date)') is null
     or to_regprocedure('billing_private.structure_my_card_purchase_shadow_impl_v1(uuid)') is null
     or to_regprocedure('billing_private.create_my_card_installment_series_shadow_impl_v1(uuid,uuid,date,text,numeric,integer,text,text,text)') is null
     or to_regprocedure('billing_private.pay_my_card_invoice_shadow_impl_v1(uuid,uuid,numeric,date,uuid)') is null
     or to_regprocedure('billing_private.reverse_my_card_payment_shadow_impl_v1(uuid,uuid,date,text)') is null
     or to_regprocedure('billing_private.credit_my_card_purchase_shadow_impl_v1(uuid,numeric,date,uuid,text)') is null
     or to_regprocedure('billing_private.reverse_my_card_purchase_credit_shadow_impl_v1(uuid,uuid,date,text)') is null then
    raise exception 'card billing activation rollback requires the complete activated contract'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid in (
      'billing_private.structure_my_card_purchase_shadow_impl_v1(uuid)'::regprocedure,
      'billing_private.create_my_card_installment_series_shadow_impl_v1(uuid,uuid,date,text,numeric,integer,text,text,text)'::regprocedure,
      'billing_private.pay_my_card_invoice_shadow_impl_v1(uuid,uuid,numeric,date,uuid)'::regprocedure,
      'billing_private.reverse_my_card_payment_shadow_impl_v1(uuid,uuid,date,text)'::regprocedure,
      'billing_private.credit_my_card_purchase_shadow_impl_v1(uuid,numeric,date,uuid,text)'::regprocedure,
      'billing_private.reverse_my_card_purchase_credit_shadow_impl_v1(uuid,uuid,date,text)'::regprocedure
    )
      and pg_get_userbyid(p.proowner) <> current_user
  ) then
    raise exception 'card billing activation rollback refuses function ownership drift'
      using errcode = '42501';
  end if;
end
$rollback_preflight$;

lock table public.accounts,
           public.cards,
           public.transactions,
           billing_private.writer_context_v1,
           public.card_installment_series,
           public.card_billing_cycles,
           public.card_invoice_payments,
           public.card_payment_allocations,
           public.card_account_settlements,
           public.card_purchase_credits
  in access exclusive mode;

do $rollback_guard$
begin
  if exists (select 1 from billing_private.writer_context_v1)
     or exists (select 1 from public.card_installment_series)
     or exists (select 1 from public.card_billing_cycles)
     or exists (select 1 from public.card_invoice_payments)
     or exists (select 1 from public.card_payment_allocations)
     or exists (select 1 from public.card_account_settlements)
     or exists (select 1 from public.card_purchase_credits)
     or exists (
       select 1
       from public.transactions
       where card_billing_cycle_id is not null
          or installment_total is not null
     ) then
    raise exception 'refusing activation rollback after use; revoke clients application-first and use a forward migration'
      using errcode = 'P0001';
  end if;
end
$rollback_guard$;

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

drop function public.get_my_card_billing_summary_v1(uuid);
drop function public.get_my_card_billing_summary_as_of_v1(uuid, date);
drop function public.get_my_card_account_positions_v1(uuid, date);
drop function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text);
drop function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text);
drop function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text);
drop function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text);
drop function public.reverse_my_card_payment_v1(uuid, uuid, date, text);
drop function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid);
drop function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text);
drop function public.structure_my_card_purchase_v1(uuid);

drop view public.card_managed_limit_positions_v1;
drop view public.card_invoice_balances_v1;

create view public.card_invoice_balances_v1
with (security_invoker = true)
as
with purchases as (
  select t.user_id, t.card_billing_cycle_id,
         coalesce(sum(t.amount) filter (
           where t.transaction_type = 'despesa'
             and coalesce(t.status, 'realizado') <> 'cancelado'
         ), 0)::numeric as purchase_amount
  from public.transactions t
  where t.card_billing_cycle_id is not null
  group by t.user_id, t.card_billing_cycle_id
), payments as (
  select p.user_id, a.billing_cycle_id,
         coalesce(sum(case when p.entry_kind = 'payment' then a.amount else -a.amount end), 0)::numeric as paid_amount
  from public.card_invoice_payments p
  join public.card_payment_allocations a
    on a.payment_entry_id = p.id and a.user_id = p.user_id
  join public.card_account_settlements s
    on s.payment_entry_id = p.id and s.user_id = p.user_id
  group by p.user_id, a.billing_cycle_id
), credits as (
  select c.user_id, t.card_billing_cycle_id,
         coalesce(sum(case when c.entry_kind = 'purchase_credit' then c.amount else -c.amount end), 0)::numeric as credited_amount
  from public.card_purchase_credits c
  join public.transactions t
    on t.id = c.transaction_id and t.user_id = c.user_id
  where t.card_billing_cycle_id is not null
  group by c.user_id, t.card_billing_cycle_id
)
select cy.id, cy.user_id, cy.card_id, cy.cycle_key,
       cy.cycle_start_date, cy.closing_date, cy.due_date,
       coalesce(pu.purchase_amount, 0)::numeric as purchase_amount,
       coalesce(cr.credited_amount, 0)::numeric as credited_amount,
       coalesce(pa.paid_amount, 0)::numeric as paid_amount,
       greatest(coalesce(pu.purchase_amount, 0) - coalesce(cr.credited_amount, 0) - coalesce(pa.paid_amount, 0), 0)::numeric as outstanding_amount,
       greatest(coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0) - coalesce(pu.purchase_amount, 0), 0)::numeric as credit_balance,
       (coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0) > coalesce(pu.purchase_amount, 0)) as credit_balance_review_required,
       case
         when coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0) > coalesce(pu.purchase_amount, 0)
           then 'CREDIT_BALANCE_REVIEW_REQUIRED'
         when coalesce(pu.purchase_amount, 0) - coalesce(cr.credited_amount, 0) - coalesce(pa.paid_amount, 0) <= 0
           then 'settled'
         when coalesce(pa.paid_amount, 0) > 0 then 'partially_paid'
         else 'open'
       end::text as settlement_state
from public.card_billing_cycles cy
left join purchases pu on pu.user_id = cy.user_id and pu.card_billing_cycle_id = cy.id
left join payments pa on pa.user_id = cy.user_id and pa.billing_cycle_id = cy.id
left join credits cr on cr.user_id = cy.user_id and cr.card_billing_cycle_id = cy.id;

create view public.card_managed_limit_positions_v1
with (security_invoker = true)
as
with coverage as (
  select c.user_id, c.id as card_id, c."limit" as configured_limit,
         count(t.id)::bigint as relevant_purchase_count,
         count(t.id) filter (
           where t.card_billing_cycle_id is not null
             and (
               t.installment_series_id is null
               or (
                 t.installment_total is not null
                 and exists (
                   select 1 from public.card_installment_series s
                   where s.id = t.installment_series_id
                     and s.user_id = t.user_id
                     and s.card_id = t.card_id
                 )
               )
             )
         )::bigint as structured_purchase_count
  from public.cards c
  left join public.transactions t
    on t.user_id = c.user_id
   and t.card_id = c.id
   and t.transaction_type = 'despesa'
   and coalesce(t.status, 'realizado') <> 'cancelado'
  group by c.user_id, c.id, c."limit"
), obligation as (
  select i.user_id, i.card_id,
         coalesce(sum(i.outstanding_amount), 0)::numeric as managed_used_limit,
         bool_or(i.credit_balance_review_required) as credit_balance_review_required
  from public.card_invoice_balances_v1 i
  group by i.user_id, i.card_id
)
select c.user_id,
       c.card_id,
       'AVIORA_MANAGED_AVAILABLE_LIMIT'::text as metric_contract,
       c.configured_limit,
       coalesce(o.managed_used_limit, 0)::numeric as managed_used_limit,
       case
         when c.configured_limit > 0
          and c.configured_limit <= 999999999999.99
          and c.configured_limit = round(c.configured_limit, 2)
          and c.configured_limit < 'Infinity'::numeric
          and c.structured_purchase_count = c.relevant_purchase_count
          and not coalesce(o.credit_balance_review_required, false)
         then c.configured_limit - coalesce(o.managed_used_limit, 0)
         else null
       end::numeric as managed_available_limit,
       case
         when coalesce(o.credit_balance_review_required, false)
           then 'CREDIT_BALANCE_REVIEW_REQUIRED'
         when not (
           c.configured_limit > 0
           and c.configured_limit <= 999999999999.99
           and c.configured_limit = round(c.configured_limit, 2)
           and c.configured_limit < 'Infinity'::numeric
         ) then 'limit_unknown'
         when c.relevant_purchase_count > 0 and c.structured_purchase_count = 0 then 'unlinked'
         when c.structured_purchase_count <> c.relevant_purchase_count then 'partial'
         when c.configured_limit - coalesce(o.managed_used_limit, 0) < 0 then 'exceeded'
         else 'complete'
       end::text as coverage_state,
       c.relevant_purchase_count,
       c.structured_purchase_count,
       'Gerencial: não representa autorizações, juros, tarifas ou compras ausentes no AVIORA.'::text
         as limitation_notice
from coverage c
left join obligation o on o.user_id = c.user_id and o.card_id = c.card_id;

create or replace function billing_private.guard_payment_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_original public.card_invoice_payments%rowtype;
  v_outstanding numeric;
begin
  perform 1
  from public.card_billing_cycles
  where id = new.billing_cycle_id and user_id = new.user_id
  for update;
  if not found then
    raise exception 'payment cycle ownership mismatch' using errcode = '23514';
  end if;

  perform 1
  from public.accounts
  where id = new.source_account_id and user_id = new.user_id
  for key share;
  if not found then
    raise exception 'payment account ownership mismatch' using errcode = '23514';
  end if;

  if new.entry_kind = 'payment' then
    select outstanding_amount into strict v_outstanding
    from public.card_invoice_balances_v1
    where id = new.billing_cycle_id and user_id = new.user_id;

    if new.amount > v_outstanding then
      raise exception 'payment exceeds invoice outstanding amount'
        using errcode = '23514';
    end if;
  elsif new.entry_kind = 'payment_reversal' then
    select * into v_original
    from public.card_invoice_payments
    where id = new.reversal_of_id and user_id = new.user_id
    for key share;

    if not found
       or v_original.entry_kind <> 'payment'
       or v_original.billing_cycle_id <> new.billing_cycle_id
       or v_original.source_account_id <> new.source_account_id
       or v_original.amount <> new.amount
       or new.effective_date < v_original.effective_date then
      raise exception 'payment reversal must exactly compensate its original payment'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

create or replace function billing_private.guard_purchase_credit_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_transaction public.transactions%rowtype;
  v_original public.card_purchase_credits%rowtype;
  v_credited numeric;
begin
  select * into v_transaction
  from public.transactions
  where id = new.transaction_id and user_id = new.user_id
  for update;

  if not found
     or v_transaction.transaction_type <> 'despesa'
     or v_transaction.card_id is null
     or v_transaction.card_billing_cycle_id is null
     or coalesce(v_transaction.status, '') = 'cancelado' then
    raise exception 'credit transaction ownership or eligibility mismatch'
      using errcode = '23514';
  end if;

  perform 1
  from public.card_billing_cycles
  where id = v_transaction.card_billing_cycle_id
    and user_id = new.user_id
    and card_id = v_transaction.card_id
  for update;
  if not found then
    raise exception 'credit transaction cycle mismatch' using errcode = '23514';
  end if;

  if new.entry_kind = 'purchase_credit' then
    if v_transaction.status <> 'realizado'
       or new.effective_date < v_transaction.transaction_date then
      raise exception 'purchase credit requires an effected purchase and a non-retroactive date'
        using errcode = '23514';
    end if;
    select coalesce(sum(
      case when entry_kind = 'purchase_credit' then amount else -amount end
    ), 0)
    into v_credited
    from public.card_purchase_credits
    where user_id = new.user_id and transaction_id = new.transaction_id;

    if v_credited + new.amount > v_transaction.amount then
      raise exception 'purchase credit exceeds original purchase amount'
        using errcode = '23514';
    end if;
  elsif new.entry_kind = 'credit_reversal' then
    select * into v_original
    from public.card_purchase_credits
    where id = new.reversal_of_id and user_id = new.user_id
    for key share;

    if not found
       or v_original.entry_kind <> 'purchase_credit'
       or v_original.transaction_id <> new.transaction_id
       or v_original.amount <> new.amount
       or new.effective_date < v_original.effective_date then
      raise exception 'credit reversal must exactly compensate its original credit'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

alter function billing_private.structure_my_card_purchase_shadow_impl_v1(uuid)
  rename to structure_my_card_purchase_v1;
alter function billing_private.structure_my_card_purchase_v1(uuid)
  set schema public;

alter function billing_private.create_my_card_installment_series_shadow_impl_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  rename to create_my_card_installment_series_v1;
alter function billing_private.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  set schema public;

alter function billing_private.pay_my_card_invoice_shadow_impl_v1(uuid, uuid, numeric, date, uuid)
  rename to pay_my_card_invoice_v1;
alter function billing_private.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  set schema public;

alter function billing_private.reverse_my_card_payment_shadow_impl_v1(uuid, uuid, date, text)
  rename to reverse_my_card_payment_v1;
alter function billing_private.reverse_my_card_payment_v1(uuid, uuid, date, text)
  set schema public;

alter function billing_private.credit_my_card_purchase_shadow_impl_v1(uuid, numeric, date, uuid, text)
  rename to credit_my_card_purchase_v1;
alter function billing_private.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  set schema public;

alter function billing_private.reverse_my_card_purchase_credit_shadow_impl_v1(uuid, uuid, date, text)
  rename to reverse_my_card_purchase_credit_v1;
alter function billing_private.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  set schema public;

create function public.get_my_card_billing_summary_v1(p_card_id uuid default null)
returns table (
  card_id uuid,
  cycle_id uuid,
  cycle_key date,
  closing_date date,
  due_date date,
  purchase_amount numeric,
  credited_amount numeric,
  paid_amount numeric,
  outstanding_amount numeric,
  credit_balance numeric,
  credit_balance_review_required boolean,
  settlement_state text
)
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select i.card_id, i.id, i.cycle_key, i.closing_date, i.due_date,
         i.purchase_amount, i.credited_amount, i.paid_amount,
         i.outstanding_amount, i.credit_balance,
         i.credit_balance_review_required, i.settlement_state
  from public.card_invoice_balances_v1 i
  where i.user_id = (select auth.uid())
    and (p_card_id is null or i.card_id = p_card_id)
  order by i.due_date desc, i.card_id
$$;

drop policy card_installment_series_select_own on public.card_installment_series;
create policy card_installment_series_select_own
  on public.card_installment_series for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy card_billing_cycles_select_own on public.card_billing_cycles;
create policy card_billing_cycles_select_own
  on public.card_billing_cycles for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy card_invoice_payments_select_own on public.card_invoice_payments;
create policy card_invoice_payments_select_own
  on public.card_invoice_payments for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy card_payment_allocations_select_own on public.card_payment_allocations;
create policy card_payment_allocations_select_own
  on public.card_payment_allocations for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy card_account_settlements_select_own on public.card_account_settlements;
create policy card_account_settlements_select_own
  on public.card_account_settlements for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy card_purchase_credits_select_own on public.card_purchase_credits;
create policy card_purchase_credits_select_own
  on public.card_purchase_credits for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on function public.structure_my_card_purchase_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_card_billing_summary_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_card_billing_summary_v1(uuid) to authenticated;

grant select on public.card_invoice_balances_v1 to authenticated;
grant select on public.card_managed_limit_positions_v1 to authenticated;
revoke all on public.card_invoice_balances_v1 from public, anon;
revoke all on public.card_managed_limit_positions_v1 from public, anon;

comment on view public.card_invoice_balances_v1 is null;
comment on view public.card_managed_limit_positions_v1 is
  'AVIORA-managed estimate only; NULL whenever structural coverage or credit state cannot prove the number.';

commit;
