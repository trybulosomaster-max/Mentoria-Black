-- AVIORA Card Billing V1 — controlled Beta mutator activation.
-- This migration activates only the APP-facing billing surface required by the
-- current Cards UI and its canonical settlement/credit consumers.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:card-billing-mutator-activation-v1', 0));

do $preflight$
declare
  v_signature text;
  v_relation text;
  v_has_rows boolean;
begin
  if to_regnamespace('billing_private') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.has_active_access(text)') is null
     or to_regclass('public.accounts') is null
     or to_regclass('public.transactions') is null
     or to_regclass('public.card_installment_series') is null
     or to_regclass('public.card_billing_cycles') is null
     or to_regclass('public.card_invoice_payments') is null
     or to_regclass('public.card_payment_allocations') is null
     or to_regclass('public.card_account_settlements') is null
     or to_regclass('public.card_purchase_credits') is null
     or to_regclass('public.card_invoice_balances_v1') is null
     or to_regclass('public.card_managed_limit_positions_v1') is null then
    raise exception 'card billing activation requires the complete approved shadow schema'
      using errcode = 'P0001';
  end if;

  if not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'accounts'
         and column_name = 'statement_balance'
         and udt_name = 'numeric'
     )
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'accounts'
         and column_name = 'balance_as_of'
         and udt_name = 'date'
     ) then
    raise exception 'card billing activation requires the V82 account snapshot contract'
      using errcode = 'P0001';
  end if;

  if not exists (
       select 1
       from pg_proc p
       where p.oid = 'public.has_active_access(text)'::regprocedure
         and not p.prosecdef
         and p.provolatile = 's'
         and p.prorettype = 'boolean'::regtype
     ) then
    raise exception 'card billing activation refuses has_active_access contract drift'
      using errcode = 'P0001';
  end if;

  foreach v_signature in array array[
    'public.structure_my_card_purchase_v1(uuid)',
    'public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)',
    'public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',
    'public.reverse_my_card_payment_v1(uuid,uuid,date,text)',
    'public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)',
    'public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)'
  ] loop
    if to_regprocedure(v_signature) is null
       or not exists (
         select 1
         from pg_proc p
         where p.oid = to_regprocedure(v_signature)
           and p.prosecdef
           and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=pg_catalog'
           and pg_get_userbyid(p.proowner) = current_user
       )
       or has_function_privilege('public', v_signature, 'execute')
       or has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute') then
      raise exception 'card billing activation refuses shadow mutator drift: %', v_signature
        using errcode = 'P0001';
    end if;
  end loop;

  if to_regprocedure('public.get_my_card_billing_summary_as_of_v1(uuid,date)') is not null
     or to_regprocedure('public.get_my_card_account_positions_v1(uuid,date)') is not null
     or to_regprocedure('public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)') is not null
     or to_regprocedure('public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)') is not null
     or to_regprocedure('billing_private.structure_my_card_purchase_shadow_impl_v1(uuid)') is not null
     or to_regprocedure('billing_private.pay_my_card_invoice_shadow_impl_v1(uuid,uuid,numeric,date,uuid)') is not null then
    raise exception 'card billing activation objects already exist; reconcile before retry'
      using errcode = 'P0001';
  end if;

  foreach v_relation in array array[
    'public.card_installment_series',
    'public.card_billing_cycles',
    'public.card_invoice_payments',
    'public.card_payment_allocations',
    'public.card_account_settlements',
    'public.card_purchase_credits'
  ] loop
    execute format('select exists(select 1 from %s)', v_relation) into strict v_has_rows;
    if v_has_rows then
      raise exception 'card billing activation requires an empty shadow ledger: %', v_relation
        using errcode = 'P0001';
    end if;
  end loop;

  if exists (
       select 1
       from public.transactions
       where card_billing_cycle_id is not null
          or installment_total is not null
     ) then
    raise exception 'card billing activation requires SAFE_NO_BACKFILL shadow state'
      using errcode = 'P0001';
  end if;

  if (
       select count(*)
       from pg_policies
       where schemaname = 'public'
         and tablename in (
           'card_installment_series', 'card_billing_cycles',
           'card_invoice_payments', 'card_payment_allocations',
           'card_account_settlements', 'card_purchase_credits'
         )
     ) <> 6 then
    raise exception 'card billing activation refuses RLS policy drift'
      using errcode = 'P0001';
  end if;
end
$preflight$;

-- Hide the already-reviewed implementations in the non-exposed schema.  The
-- wrappers below are the only client entry points and close commercial, date
-- and balance-snapshot contracts before reaching the immutable implementation.
alter function public.structure_my_card_purchase_v1(uuid)
  set schema billing_private;
alter function billing_private.structure_my_card_purchase_v1(uuid)
  rename to structure_my_card_purchase_shadow_impl_v1;

alter function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  set schema billing_private;
alter function billing_private.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  rename to create_my_card_installment_series_shadow_impl_v1;

alter function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  set schema billing_private;
alter function billing_private.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  rename to pay_my_card_invoice_shadow_impl_v1;

alter function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  set schema billing_private;
alter function billing_private.reverse_my_card_payment_v1(uuid, uuid, date, text)
  rename to reverse_my_card_payment_shadow_impl_v1;

alter function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  set schema billing_private;
alter function billing_private.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  rename to credit_my_card_purchase_shadow_impl_v1;

alter function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  set schema billing_private;
alter function billing_private.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  rename to reverse_my_card_purchase_credit_shadow_impl_v1;

revoke all on schema billing_private from service_role;
revoke all on function billing_private.structure_my_card_purchase_shadow_impl_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.create_my_card_installment_series_shadow_impl_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.pay_my_card_invoice_shadow_impl_v1(uuid, uuid, numeric, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.reverse_my_card_payment_shadow_impl_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.credit_my_card_purchase_shadow_impl_v1(uuid, numeric, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.reverse_my_card_purchase_credit_shadow_impl_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;

-- A cycle's payable invoice consists only of realized economic purchases.
-- Pendente/programado remain visible as known commitments, never liquidable.
create or replace view public.card_invoice_balances_v1
with (security_invoker = true)
as
with purchases as (
  select t.user_id,
         t.card_billing_cycle_id,
         coalesce(sum(t.amount) filter (
           where t.transaction_type = 'despesa'
             and t.status = 'realizado'
         ), 0)::numeric as purchase_amount,
         coalesce(sum(t.amount) filter (
           where t.transaction_type = 'despesa'
             and t.status in ('pendente', 'programado')
         ), 0)::numeric as scheduled_purchase_amount,
         coalesce(sum(t.amount) filter (
           where t.transaction_type = 'despesa'
             and t.status in ('realizado', 'pendente', 'programado')
         ), 0)::numeric as known_commitment_amount
  from public.transactions t
  where t.card_billing_cycle_id is not null
  group by t.user_id, t.card_billing_cycle_id
), payments as (
  select p.user_id,
         a.billing_cycle_id,
         coalesce(sum(
           case when p.entry_kind = 'payment' then a.amount else -a.amount end
         ), 0)::numeric as paid_amount
  from public.card_invoice_payments p
  join public.card_payment_allocations a
    on a.payment_entry_id = p.id and a.user_id = p.user_id
  join public.card_account_settlements s
    on s.payment_entry_id = p.id and s.user_id = p.user_id
  where p.effective_date <= (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  group by p.user_id, a.billing_cycle_id
), credits as (
  select c.user_id,
         t.card_billing_cycle_id,
         coalesce(sum(
           case when c.entry_kind = 'purchase_credit' then c.amount else -c.amount end
         ), 0)::numeric as credited_amount
  from public.card_purchase_credits c
  join public.transactions t
    on t.id = c.transaction_id and t.user_id = c.user_id
  where t.card_billing_cycle_id is not null
    and c.effective_date <= (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  group by c.user_id, t.card_billing_cycle_id
)
select cy.id,
       cy.user_id,
       cy.card_id,
       cy.cycle_key,
       cy.cycle_start_date,
       cy.closing_date,
       cy.due_date,
       coalesce(pu.purchase_amount, 0)::numeric as purchase_amount,
       coalesce(cr.credited_amount, 0)::numeric as credited_amount,
       coalesce(pa.paid_amount, 0)::numeric as paid_amount,
       greatest(
         coalesce(pu.purchase_amount, 0)
           - coalesce(cr.credited_amount, 0)
           - coalesce(pa.paid_amount, 0),
         0
       )::numeric as outstanding_amount,
       greatest(
         coalesce(cr.credited_amount, 0)
           + coalesce(pa.paid_amount, 0)
           - coalesce(pu.purchase_amount, 0),
         0
       )::numeric as credit_balance,
       (
         coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0)
           > coalesce(pu.purchase_amount, 0)
       ) as credit_balance_review_required,
       case
         when coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0)
              > coalesce(pu.purchase_amount, 0)
           then 'CREDIT_BALANCE_REVIEW_REQUIRED'
         when coalesce(pu.purchase_amount, 0) - coalesce(cr.credited_amount, 0)
              - coalesce(pa.paid_amount, 0) <= 0
           then 'settled'
         when coalesce(pa.paid_amount, 0) > 0 then 'partially_paid'
         else 'open'
       end::text as settlement_state,
       coalesce(pu.scheduled_purchase_amount, 0)::numeric as scheduled_purchase_amount,
       coalesce(pu.known_commitment_amount, 0)::numeric as known_commitment_amount
from public.card_billing_cycles cy
left join purchases pu
  on pu.user_id = cy.user_id and pu.card_billing_cycle_id = cy.id
left join payments pa
  on pa.user_id = cy.user_id and pa.billing_cycle_id = cy.id
left join credits cr
  on cr.user_id = cy.user_id and cr.card_billing_cycle_id = cy.id;

-- The management limit consumes every structured known commitment.  Unknown
-- non-cancelled statuses fail coverage closed instead of being ignored.
create or replace view public.card_managed_limit_positions_v1
with (security_invoker = true)
as
with coverage as (
  select c.user_id,
         c.id as card_id,
         c."limit" as configured_limit,
         count(t.id) filter (
           where t.status in ('realizado', 'pendente', 'programado')
         )::bigint as relevant_purchase_count,
         count(t.id) filter (
           where t.status in ('realizado', 'pendente', 'programado')
             and t.card_billing_cycle_id is not null
             and (
               t.installment_series_id is null
               or (
                 t.installment_total is not null
                 and exists (
                   select 1
                   from public.card_installment_series s
                   where s.id = t.installment_series_id
                     and s.user_id = t.user_id
                     and s.card_id = t.card_id
                 )
               )
             )
         )::bigint as structured_purchase_count,
         count(t.id) filter (
           where coalesce(t.status, '') <> 'cancelado'
             and coalesce(t.status, '') not in ('realizado', 'pendente', 'programado')
         )::bigint as unsupported_status_count
  from public.cards c
  left join public.transactions t
    on t.user_id = c.user_id
   and t.card_id = c.id
   and t.transaction_type = 'despesa'
   and coalesce(t.status, '') <> 'cancelado'
  group by c.user_id, c.id, c."limit"
), obligation as (
  select i.user_id,
         i.card_id,
         coalesce(sum(greatest(
           i.known_commitment_amount - i.credited_amount - i.paid_amount,
           0
         )), 0)::numeric as managed_used_limit,
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
          and c.unsupported_status_count = 0
          and not coalesce(o.credit_balance_review_required, false)
         then c.configured_limit - coalesce(o.managed_used_limit, 0)
         else null
       end::numeric as managed_available_limit,
       case
         when coalesce(o.credit_balance_review_required, false)
           then 'CREDIT_BALANCE_REVIEW_REQUIRED'
         when c.unsupported_status_count > 0 then 'unsupported_status'
         when not (
           c.configured_limit > 0
           and c.configured_limit <= 999999999999.99
           and c.configured_limit = round(c.configured_limit, 2)
           and c.configured_limit < 'Infinity'::numeric
         ) then 'limit_unknown'
         when c.relevant_purchase_count > 0 and c.structured_purchase_count = 0
           then 'unlinked'
         when c.structured_purchase_count <> c.relevant_purchase_count then 'partial'
         when c.configured_limit - coalesce(o.managed_used_limit, 0) < 0
           then 'exceeded'
         else 'complete'
       end::text as coverage_state,
       c.relevant_purchase_count,
       c.structured_purchase_count,
       'Gerencial: não representa autorizações, juros, tarifas ou compras ausentes no AVIORA.'::text
         as limitation_notice
from coverage c
left join obligation o on o.user_id = c.user_id and o.card_id = c.card_id;

-- Defense in depth: insert guards enforce the same civil-date and snapshot
-- boundaries even if a privileged internal caller reaches the hidden impl.
create or replace function billing_private.guard_payment_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_original public.card_invoice_payments%rowtype;
  v_outstanding numeric;
  v_statement_balance numeric;
  v_balance_as_of date;
begin
  if new.effective_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'future card payment effects are not active in V1'
      using errcode = '22023';
  end if;

  perform 1
  from public.card_billing_cycles
  where id = new.billing_cycle_id and user_id = new.user_id
  for update;
  if not found then
    raise exception 'payment cycle ownership mismatch' using errcode = '23514';
  end if;

  select statement_balance, balance_as_of
  into v_statement_balance, v_balance_as_of
  from public.accounts
  where id = new.source_account_id and user_id = new.user_id
  for key share;
  if not found then
    raise exception 'payment account ownership mismatch' using errcode = '23514';
  end if;
  if v_statement_balance is null
     or v_balance_as_of is null
     or new.effective_date <= v_balance_as_of then
    raise exception 'BALANCE_SNAPSHOT_REQUIRED: payment date must be after the end-of-day account snapshot'
      using errcode = '23514';
  end if;

  if new.entry_kind = 'payment' then
    if exists (
      select 1
      from public.transactions t
      where t.user_id = new.user_id
        and t.card_billing_cycle_id = new.billing_cycle_id
        and t.transaction_type = 'despesa'
        and coalesce(t.status, '') <> 'cancelado'
        and t.status is distinct from 'realizado'
    ) then
      raise exception 'invoice contains non-payable scheduled or unsupported purchases'
        using errcode = '23514';
    end if;

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
  if new.effective_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'future card credit effects are not active in V1'
      using errcode = '22023';
  end if;

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

create function public.structure_my_card_purchase_v1(p_transaction_id uuid)
returns public.card_billing_cycles
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  select status into strict v_status
  from public.transactions
  where id = p_transaction_id and user_id = v_user
  for update;
  if coalesce(v_status, '') not in ('realizado', 'pendente', 'programado') then
    raise exception 'transaction status is not eligible for structured billing'
      using errcode = '22023';
  end if;
  return billing_private.structure_my_card_purchase_shadow_impl_v1(p_transaction_id);
end
$$;

create function public.create_my_card_installment_series_v1(
  p_operation_id uuid,
  p_card_id uuid,
  p_purchase_date date,
  p_description text,
  p_original_amount numeric,
  p_installment_total integer,
  p_status text default 'realizado',
  p_category text default null,
  p_subcategory text default null
)
returns public.card_installment_series
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('realizado', 'pendente', 'programado') then
    raise exception 'installment status is not eligible for structured billing'
      using errcode = '22023';
  end if;
  return billing_private.create_my_card_installment_series_shadow_impl_v1(
    p_operation_id,
    p_card_id,
    p_purchase_date,
    p_description,
    p_original_amount,
    p_installment_total,
    p_status,
    p_category,
    p_subcategory
  );
end
$$;

-- Metadata-complete installment writer used by the UI.  It composes the
-- reviewed cent-exact hidden implementation and applies all transaction
-- metadata inside the same transaction, avoiding any post-RPC direct UPDATE.
create function public.create_my_card_installment_series_with_metadata_v1(
  p_operation_id uuid,
  p_card_id uuid,
  p_purchase_date date,
  p_description text,
  p_original_amount numeric,
  p_installment_total integer,
  p_status text default 'realizado',
  p_category text default null,
  p_subcategory text default null,
  p_payment_method text default null,
  p_note text default null,
  p_goal_id uuid default null,
  p_goal_effect text default null
)
returns public.card_installment_series
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_series public.card_installment_series%rowtype;
  v_payment_method text := nullif(trim(coalesce(p_payment_method, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_existing_count integer;
  v_matching_count integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_operation_id is null
     or length(coalesce(v_payment_method, '')) > 120
     or length(coalesce(v_note, '')) > 2000
     or (p_goal_id is null and p_goal_effect is not null)
     or (p_goal_id is not null and p_goal_effect not in ('contribution', 'withdrawal')) then
    raise exception 'invalid installment metadata' using errcode = '22023';
  end if;

  if p_goal_id is not null then
    perform 1
    from public.goals
    where id = p_goal_id and user_id = v_user
    for key share;
    if not found then
      raise exception 'goal not found' using errcode = '23503';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':card-installment:' || p_operation_id::text, 0)
  );
  select * into v_series
  from public.card_installment_series
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    select count(*),
           count(*) filter (
             where payment_method is not distinct from v_payment_method
               and note is not distinct from v_note
               and goal_id is not distinct from p_goal_id
               and goal_effect is not distinct from p_goal_effect
           )
    into v_existing_count, v_matching_count
    from public.transactions
    where user_id = v_user and installment_series_id = v_series.id;
    if v_existing_count <> v_series.installment_total
       or v_matching_count <> v_existing_count then
      raise exception 'operation_id metadata payload mismatch' using errcode = '23505';
    end if;
    -- The hidden implementation proves all non-metadata payload fields.
    perform billing_private.create_my_card_installment_series_shadow_impl_v1(
      p_operation_id, p_card_id, p_purchase_date, p_description,
      p_original_amount, p_installment_total, p_status, p_category, p_subcategory
    );
    return v_series;
  end if;

  v_series := billing_private.create_my_card_installment_series_shadow_impl_v1(
    p_operation_id,
    p_card_id,
    p_purchase_date,
    p_description,
    p_original_amount,
    p_installment_total,
    p_status,
    p_category,
    p_subcategory
  );
  update public.transactions
  set payment_method = v_payment_method,
      note = v_note,
      goal_id = p_goal_id,
      goal_effect = p_goal_effect
  where user_id = v_user and installment_series_id = v_series.id;
  if not found then
    raise exception 'structured installment metadata update found no transactions'
      using errcode = 'P0001';
  end if;
  return v_series;
end
$$;

-- Atomic writer for a new one-off card purchase.  It never accepts a billing
-- date from the client: transaction_date is the frozen cycle due_date, while
-- purchase_date remains the civil date used only to choose the new cycle.
create function public.create_my_card_purchase_v1(
  p_operation_id uuid,
  p_card_id uuid,
  p_purchase_date date,
  p_description text,
  p_amount numeric,
  p_status text default 'realizado',
  p_category text default null,
  p_subcategory text default null,
  p_payment_method text default null,
  p_note text default null,
  p_goal_id uuid default null,
  p_goal_effect text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.transactions%rowtype;
  v_cycle public.card_billing_cycles%rowtype;
  v_result public.transactions%rowtype;
  v_category text := nullif(trim(coalesce(p_category, '')), '');
  v_subcategory text := nullif(trim(coalesce(p_subcategory, '')), '');
  v_payment_method text := nullif(trim(coalesce(p_payment_method, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_operation_id is null
     or p_card_id is null
     or p_purchase_date is null
     or not isfinite(p_purchase_date)
     or length(trim(coalesce(p_description, ''))) not between 1 and 240
     or p_status is null
     or p_status not in ('realizado', 'pendente', 'programado')
     or p_amount is null
     or not (
       p_amount > 0
       and p_amount <= 999999999999.99
       and p_amount = round(p_amount, 2)
       and p_amount < 'Infinity'::numeric
     )
     or length(coalesce(v_category, '')) > 120
     or length(coalesce(v_subcategory, '')) > 120
     or length(coalesce(v_payment_method, '')) > 120
     or length(coalesce(v_note, '')) > 2000
     or (p_goal_id is null and p_goal_effect is not null)
     or (p_goal_id is not null and p_goal_effect not in ('contribution', 'withdrawal')) then
    raise exception 'invalid structured card purchase input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':card-purchase:' || p_operation_id::text, 0)
  );
  select * into v_existing
  from public.transactions
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    if v_existing.card_id is distinct from p_card_id
       or v_existing.purchase_date is distinct from p_purchase_date
       or v_existing.description is distinct from trim(p_description)
       or v_existing.amount is distinct from p_amount
       or v_existing.status is distinct from p_status
       or v_existing.transaction_type is distinct from 'despesa'
       or v_existing.category is distinct from v_category
       or v_existing.subcategory is distinct from v_subcategory
       or v_existing.payment_method is distinct from v_payment_method
       or v_existing.note is distinct from v_note
       or v_existing.goal_id is distinct from p_goal_id
       or v_existing.goal_effect is distinct from p_goal_effect
       or v_existing.card_billing_cycle_id is null then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  perform 1
  from public.cards
  where id = p_card_id and user_id = v_user
  for key share;
  if not found then
    raise exception 'card not found' using errcode = '23503';
  end if;
  if p_goal_id is not null then
    perform 1
    from public.goals
    where id = p_goal_id and user_id = v_user
    for key share;
    if not found then
      raise exception 'goal not found' using errcode = '23503';
    end if;
  end if;

  v_cycle := billing_private.ensure_cycle_for_purchase_v1(
    v_user,
    p_card_id,
    p_purchase_date
  );
  insert into billing_private.writer_context_v1(transaction_id, user_id, purpose)
  values (txid_current(), v_user, 'structure_purchase');

  insert into public.transactions(
    user_id,
    transaction_date,
    purchase_date,
    description,
    category,
    subcategory,
    amount,
    transaction_type,
    status,
    card_id,
    payment_method,
    note,
    goal_id,
    goal_effect,
    operation_id,
    card_billing_cycle_id
  ) values (
    v_user,
    v_cycle.due_date,
    p_purchase_date,
    trim(p_description),
    v_category,
    v_subcategory,
    p_amount,
    'despesa',
    p_status,
    p_card_id,
    v_payment_method,
    v_note,
    p_goal_id,
    p_goal_effect,
    p_operation_id,
    v_cycle.id
  ) returning * into v_result;

  delete from billing_private.writer_context_v1
  where transaction_id = txid_current()
    and user_id = v_user
    and purpose = 'structure_purchase';
  return v_result;
end
$$;

create function public.pay_my_card_invoice_v1(
  p_billing_cycle_id uuid,
  p_source_account_id uuid,
  p_amount numeric,
  p_effective_date date,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.card_invoice_payments%rowtype;
  v_statement_balance numeric;
  v_balance_as_of date;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_effective_date is null
     or not isfinite(p_effective_date)
     or p_effective_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'payment effective_date must not be in the future'
      using errcode = '22023';
  end if;

  select * into v_existing
  from public.card_invoice_payments
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    return billing_private.pay_my_card_invoice_shadow_impl_v1(
      p_billing_cycle_id,
      p_source_account_id,
      p_amount,
      p_effective_date,
      p_operation_id
    );
  end if;

  perform 1
  from public.card_billing_cycles
  where id = p_billing_cycle_id and user_id = v_user
  for update;
  if not found then
    raise exception 'billing cycle not found' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.transactions t
    where t.user_id = v_user
      and t.card_billing_cycle_id = p_billing_cycle_id
      and t.transaction_type = 'despesa'
      and coalesce(t.status, '') <> 'cancelado'
      and t.status is distinct from 'realizado'
  ) then
    raise exception 'invoice contains non-payable scheduled or unsupported purchases'
      using errcode = '23514';
  end if;

  select statement_balance, balance_as_of
  into v_statement_balance, v_balance_as_of
  from public.accounts
  where id = p_source_account_id and user_id = v_user
  for update;
  if not found then
    raise exception 'source account not found' using errcode = '42501';
  end if;
  if v_statement_balance is null
     or v_balance_as_of is null
     or p_effective_date <= v_balance_as_of then
    raise exception 'BALANCE_SNAPSHOT_REQUIRED: payment date must be after the end-of-day account snapshot'
      using errcode = '23514';
  end if;

  return billing_private.pay_my_card_invoice_shadow_impl_v1(
    p_billing_cycle_id,
    p_source_account_id,
    p_amount,
    p_effective_date,
    p_operation_id
  );
end
$$;

create function public.reverse_my_card_payment_v1(
  p_payment_id uuid,
  p_operation_id uuid,
  p_effective_date date,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.card_invoice_payments%rowtype;
  v_statement_balance numeric;
  v_balance_as_of date;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_effective_date is null
     or not isfinite(p_effective_date)
     or p_effective_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'payment reversal effective_date must not be in the future'
      using errcode = '22023';
  end if;

  select * into v_existing
  from public.card_invoice_payments
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    return billing_private.reverse_my_card_payment_shadow_impl_v1(
      p_payment_id,
      p_operation_id,
      p_effective_date,
      p_reason_code
    );
  end if;

  select a.statement_balance, a.balance_as_of
  into v_statement_balance, v_balance_as_of
  from public.card_invoice_payments p
  join public.accounts a
    on a.id = p.source_account_id and a.user_id = p.user_id
  where p.id = p_payment_id
    and p.user_id = v_user
    and p.entry_kind = 'payment'
  for update of a;
  if not found then
    raise exception 'payment not found' using errcode = '42501';
  end if;
  if v_statement_balance is null
     or v_balance_as_of is null
     or p_effective_date <= v_balance_as_of then
    raise exception 'BALANCE_SNAPSHOT_REQUIRED: reversal date must be after the end-of-day account snapshot'
      using errcode = '23514';
  end if;

  return billing_private.reverse_my_card_payment_shadow_impl_v1(
    p_payment_id,
    p_operation_id,
    p_effective_date,
    p_reason_code
  );
end
$$;

create function public.credit_my_card_purchase_v1(
  p_transaction_id uuid,
  p_amount numeric,
  p_effective_date date,
  p_operation_id uuid,
  p_reason_code text
)
returns public.card_purchase_credits
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_effective_date is null
     or not isfinite(p_effective_date)
     or p_effective_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'credit effective_date must not be in the future'
      using errcode = '22023';
  end if;
  return billing_private.credit_my_card_purchase_shadow_impl_v1(
    p_transaction_id,
    p_amount,
    p_effective_date,
    p_operation_id,
    p_reason_code
  );
end
$$;

create function public.reverse_my_card_purchase_credit_v1(
  p_credit_id uuid,
  p_operation_id uuid,
  p_effective_date date,
  p_reason_code text
)
returns public.card_purchase_credits
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_effective_date is null
     or not isfinite(p_effective_date)
     or p_effective_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'credit reversal effective_date must not be in the future'
      using errcode = '22023';
  end if;
  return billing_private.reverse_my_card_purchase_credit_shadow_impl_v1(
    p_credit_id,
    p_operation_id,
    p_effective_date,
    p_reason_code
  );
end
$$;

-- Explicit position boundary for UI invoice reads.  All historical effects are
-- filtered by their own effective_date; the purchase competency remains the
-- immutable transaction_date contract and is never reclassified here.
create function public.get_my_card_billing_summary_as_of_v1(
  p_card_id uuid default null,
  p_position_as_of date default null
)
returns table (
  card_id uuid,
  cycle_id uuid,
  cycle_key date,
  closing_date date,
  due_date date,
  position_as_of date,
  purchase_amount numeric,
  scheduled_purchase_amount numeric,
  known_commitment_amount numeric,
  credited_amount numeric,
  paid_amount numeric,
  outstanding_amount numeric,
  credit_balance numeric,
  credit_balance_review_required boolean,
  settlement_state text
)
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_position date := coalesce(
    p_position_as_of,
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  );
begin
  if v_user is null or not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if not isfinite(v_position)
     or v_position > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'position_as_of must be a valid non-future civil date'
      using errcode = '22023';
  end if;

  return query
  with purchases as (
    select t.user_id,
           t.card_billing_cycle_id,
           coalesce(sum(t.amount) filter (
             where t.transaction_type = 'despesa' and t.status = 'realizado'
           ), 0)::numeric as purchase_amount,
           coalesce(sum(t.amount) filter (
             where t.transaction_type = 'despesa'
               and t.status in ('pendente', 'programado')
           ), 0)::numeric as scheduled_purchase_amount,
           coalesce(sum(t.amount) filter (
             where t.transaction_type = 'despesa'
               and t.status in ('realizado', 'pendente', 'programado')
           ), 0)::numeric as known_commitment_amount
    from public.transactions t
    where t.user_id = v_user and t.card_billing_cycle_id is not null
    group by t.user_id, t.card_billing_cycle_id
  ), payments as (
    select p.user_id,
           a.billing_cycle_id,
           coalesce(sum(
             case when p.entry_kind = 'payment' then a.amount else -a.amount end
           ), 0)::numeric as paid_amount
    from public.card_invoice_payments p
    join public.card_payment_allocations a
      on a.payment_entry_id = p.id and a.user_id = p.user_id
    join public.card_account_settlements s
      on s.payment_entry_id = p.id and s.user_id = p.user_id
    where p.user_id = v_user and p.effective_date <= v_position
    group by p.user_id, a.billing_cycle_id
  ), credits as (
    select c.user_id,
           t.card_billing_cycle_id,
           coalesce(sum(
             case when c.entry_kind = 'purchase_credit' then c.amount else -c.amount end
           ), 0)::numeric as credited_amount
    from public.card_purchase_credits c
    join public.transactions t
      on t.id = c.transaction_id and t.user_id = c.user_id
    where c.user_id = v_user
      and t.card_billing_cycle_id is not null
      and c.effective_date <= v_position
    group by c.user_id, t.card_billing_cycle_id
  )
  select cy.card_id,
         cy.id,
         cy.cycle_key,
         cy.closing_date,
         cy.due_date,
         v_position,
         coalesce(pu.purchase_amount, 0)::numeric,
         coalesce(pu.scheduled_purchase_amount, 0)::numeric,
         coalesce(pu.known_commitment_amount, 0)::numeric,
         coalesce(cr.credited_amount, 0)::numeric,
         coalesce(pa.paid_amount, 0)::numeric,
         greatest(
           coalesce(pu.purchase_amount, 0) - coalesce(cr.credited_amount, 0)
             - coalesce(pa.paid_amount, 0),
           0
         )::numeric,
         greatest(
           coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0)
             - coalesce(pu.purchase_amount, 0),
           0
         )::numeric,
         (
           coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0)
             > coalesce(pu.purchase_amount, 0)
         ),
         case
           when coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0)
                > coalesce(pu.purchase_amount, 0)
             then 'CREDIT_BALANCE_REVIEW_REQUIRED'
           when coalesce(pu.purchase_amount, 0) - coalesce(cr.credited_amount, 0)
                - coalesce(pa.paid_amount, 0) <= 0
             then 'settled'
           when coalesce(pa.paid_amount, 0) > 0 then 'partially_paid'
           else 'open'
         end::text
  from public.card_billing_cycles cy
  left join purchases pu
    on pu.user_id = cy.user_id and pu.card_billing_cycle_id = cy.id
  left join payments pa
    on pa.user_id = cy.user_id and pa.billing_cycle_id = cy.id
  left join credits cr
    on cr.user_id = cy.user_id and cr.card_billing_cycle_id = cy.id
  where cy.user_id = v_user
    and (p_card_id is null or cy.card_id = p_card_id)
  order by cy.due_date desc, cy.card_id;
end
$$;

create function public.get_my_card_account_positions_v1(
  p_account_id uuid default null,
  p_position_as_of date default null
)
returns table (
  account_id uuid,
  balance_as_of date,
  position_as_of date,
  snapshot_balance numeric,
  settlement_delta numeric,
  managed_balance numeric,
  coverage_state text
)
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_position date := coalesce(
    p_position_as_of,
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  );
begin
  if v_user is null or not public.has_active_access('APP') then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if not isfinite(v_position)
     or v_position > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'position_as_of must be a valid non-future civil date'
      using errcode = '22023';
  end if;

  return query
  select a.id,
         a.balance_as_of,
         v_position,
         a.statement_balance::numeric,
         case
           when a.statement_balance is null or a.balance_as_of is null then null
           when v_position < a.balance_as_of then null
           else coalesce(sum(e.account_delta) filter (
             where e.effective_date > a.balance_as_of
               and e.effective_date <= v_position
           ), 0)::numeric
         end as settlement_delta,
         case
           when a.statement_balance is null or a.balance_as_of is null then null
           when v_position < a.balance_as_of then null
           else a.statement_balance + coalesce(sum(e.account_delta) filter (
             where e.effective_date > a.balance_as_of
               and e.effective_date <= v_position
           ), 0)
         end::numeric as managed_balance,
         case
           when a.statement_balance is null or a.balance_as_of is null
             then 'BALANCE_SNAPSHOT_REQUIRED'
           when v_position < a.balance_as_of
             then 'HISTORICAL_POSITION_UNAVAILABLE'
           else 'complete'
         end::text as coverage_state
  from public.accounts a
  left join public.card_account_settlement_effects_v1 e
    on e.user_id = a.user_id and e.account_id = a.id
  where a.user_id = v_user
    and (p_account_id is null or a.id = p_account_id)
  group by a.id, a.balance_as_of, a.statement_balance
  order by a.id;
end
$$;

create or replace function public.get_my_card_billing_summary_v1(p_card_id uuid default null)
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
  select s.card_id,
         s.cycle_id,
         s.cycle_key,
         s.closing_date,
         s.due_date,
         s.purchase_amount,
         s.credited_amount,
         s.paid_amount,
         s.outstanding_amount,
         s.credit_balance,
         s.credit_balance_review_required,
         s.settlement_state
  from public.get_my_card_billing_summary_as_of_v1(
    p_card_id,
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date
  ) s
$$;

-- RLS remains ownership-first and now also enforces the canonical APP contract.
drop policy card_installment_series_select_own on public.card_installment_series;
create policy card_installment_series_select_own
  on public.card_installment_series for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_active_access('APP'))
  );

drop policy card_billing_cycles_select_own on public.card_billing_cycles;
create policy card_billing_cycles_select_own
  on public.card_billing_cycles for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_active_access('APP'))
  );

drop policy card_invoice_payments_select_own on public.card_invoice_payments;
create policy card_invoice_payments_select_own
  on public.card_invoice_payments for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_active_access('APP'))
  );

drop policy card_payment_allocations_select_own on public.card_payment_allocations;
create policy card_payment_allocations_select_own
  on public.card_payment_allocations for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_active_access('APP'))
  );

drop policy card_account_settlements_select_own on public.card_account_settlements;
create policy card_account_settlements_select_own
  on public.card_account_settlements for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_active_access('APP'))
  );

drop policy card_purchase_credits_select_own on public.card_purchase_credits;
create policy card_purchase_credits_select_own
  on public.card_purchase_credits for select to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_active_access('APP'))
  );

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
revoke all on function public.get_my_card_billing_summary_v1(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.structure_my_card_purchase_v1(uuid) to authenticated;
grant execute on function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  to authenticated;
grant execute on function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  to authenticated;
grant execute on function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  to authenticated;
grant execute on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  to authenticated;
grant execute on function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  to authenticated;
grant execute on function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  to authenticated;
grant execute on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  to authenticated;
grant execute on function public.get_my_card_billing_summary_as_of_v1(uuid, date)
  to authenticated;
grant execute on function public.get_my_card_account_positions_v1(uuid, date)
  to authenticated;
grant execute on function public.get_my_card_billing_summary_v1(uuid)
  to authenticated;

comment on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid) is
  'APP-gated mono-cycle payment. The civil effective_date must be after the account end-of-day balance_as_of snapshot and must not be future in America/Sao_Paulo.';
comment on function public.get_my_card_billing_summary_as_of_v1(uuid, date) is
  'APP-gated invoice adapter at an explicit non-future civil position. Realizado is payable; pendente/programado remain known commitments.';
comment on function public.get_my_card_account_positions_v1(uuid, date) is
  'APP-gated account position. Applies neutral settlements strictly after balance_as_of and through position_as_of; missing snapshots fail closed.';
comment on function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text) is
  'APP-gated idempotent one-off card purchase writer. It derives immutable cycle membership and canonical transaction_date atomically.';
comment on function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text) is
  'APP-gated metadata-complete installment writer. Series, transactions and UI metadata commit atomically without post-RPC DML.';
comment on view public.card_invoice_balances_v1 is
  'Current America/Sao_Paulo invoice position: payable realized purchases plus scheduled and total known commitments; future effects are excluded.';
comment on view public.card_managed_limit_positions_v1 is
  'AVIORA-managed estimate using all known structured realized/pendente/programado commitments; NULL on incomplete or unsupported coverage.';

commit;
