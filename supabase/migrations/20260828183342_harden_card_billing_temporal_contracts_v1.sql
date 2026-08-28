-- AVIORA Card Billing V1 — temporal hardening while client mutators remain dormant.
-- Requires the sequence: shadow schema -> activation -> fail-closed revocation.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '3min';
select pg_advisory_xact_lock(
  hashtextextended('aviora:card-billing-mutator-activation-v1', 0)
);

-- Close the direct service-role/internal DML race before inspecting persisted
-- temporal state. Beta is intentionally small and all writers are dormant.
lock table public.transactions,
           billing_private.writer_context_v1,
           public.card_installment_series,
           public.card_billing_cycles,
           public.card_invoice_payments,
           public.card_payment_allocations,
           public.card_account_settlements,
           public.card_purchase_credits
  in access exclusive mode;

do $preflight$
declare
  v_signature text;
begin
  if to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.has_active_access(text)') is null
     or to_regnamespace('billing_private') is null
     or to_regclass('public.transactions') is null
     or to_regclass('public.card_billing_cycles') is null then
    raise exception 'card billing temporal hardening requires the activated shadow contract'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(array[
      'card_installment_series', 'card_billing_cycles',
      'card_invoice_payments', 'card_payment_allocations',
      'card_account_settlements', 'card_purchase_credits'
    ]) as expected(table_name)
    left join pg_class c
      on c.oid = to_regclass(format('public.%I', expected.table_name))
    where c.oid is null or c.relrowsecurity is not true
  ) then
    raise exception 'card billing temporal hardening requires RLS on all shadow tables'
      using errcode = 'P0001';
  end if;

  -- Refuse to bless persisted rows that already violate the temporal contract.
  -- This migration hardens future writes; it never silently repairs history.
  if exists (
    select 1
    from public.transactions t
    where t.card_billing_cycle_id is not null
      and t.transaction_type = 'despesa'
      and t.status = 'realizado'
      and (
        t.purchase_date is null
        or not isfinite(t.purchase_date)
        or t.purchase_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date
      )
  ) then
    raise exception 'temporal hardening refuses persisted realized purchase chronology drift'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.card_invoice_payments p
    join public.transactions t
      on t.user_id = p.user_id
     and t.card_billing_cycle_id = p.billing_cycle_id
    where p.entry_kind = 'payment'
      and t.transaction_type = 'despesa'
      and t.status = 'realizado'
      and (
        t.purchase_date is null
        or not isfinite(t.purchase_date)
        or p.effective_date < t.purchase_date
      )
  ) then
    raise exception 'temporal hardening refuses persisted payment chronology drift'
      using errcode = 'P0001';
  end if;

  foreach v_signature in array array[
    'public.structure_my_card_purchase_v1(uuid)',
    'public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)',
    'public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)',
    'public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',
    'public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',
    'public.reverse_my_card_payment_v1(uuid,uuid,date,text)',
    'public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)',
    'public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)'
  ] loop
    if to_regprocedure(v_signature) is null
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_signature)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute')
       or has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'temporal hardening requires every client mutator to remain revoked: %',
        v_signature using errcode = 'P0001';
    end if;
  end loop;

  if to_regprocedure('billing_private.guard_card_purchase_temporal_v1()') is not null
     or to_regprocedure('billing_private.guard_card_payment_temporal_v1()') is not null
     or to_regprocedure('billing_private.structure_my_card_purchase_pre_temporal_v1(uuid)') is not null
     or to_regprocedure('billing_private.get_my_card_billing_summary_as_of_pre_temporal_v1(uuid,date)') is not null then
    raise exception 'card billing temporal hardening objects already exist'
      using errcode = 'P0001';
  end if;
end
$preflight$;

-- Preserve the reviewed activated implementations byte-for-byte behind a new
-- fail-closed temporal boundary. They remain inaccessible to API roles.
alter function public.structure_my_card_purchase_v1(uuid)
  set schema billing_private;
alter function billing_private.structure_my_card_purchase_v1(uuid)
  rename to structure_my_card_purchase_pre_temporal_v1;

alter function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  set schema billing_private;
alter function billing_private.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  rename to create_my_card_installment_series_pre_temporal_v1;

alter function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  set schema billing_private;
alter function billing_private.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  rename to create_my_card_installment_series_with_metadata_pre_temporal_v1;

alter function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  set schema billing_private;
alter function billing_private.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  rename to create_my_card_purchase_pre_temporal_v1;

alter function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  set schema billing_private;
alter function billing_private.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  rename to pay_my_card_invoice_pre_temporal_v1;

alter function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  set schema billing_private;
alter function billing_private.reverse_my_card_payment_v1(uuid, uuid, date, text)
  rename to reverse_my_card_payment_pre_temporal_v1;

alter function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  set schema billing_private;
alter function billing_private.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  rename to credit_my_card_purchase_pre_temporal_v1;

alter function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  set schema billing_private;
alter function billing_private.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  rename to reverse_my_card_purchase_credit_pre_temporal_v1;

alter function public.get_my_card_billing_summary_as_of_v1(uuid, date)
  set schema billing_private;
alter function billing_private.get_my_card_billing_summary_as_of_v1(uuid, date)
  rename to get_my_card_billing_summary_as_of_pre_temporal_v1;

alter function public.get_my_card_account_positions_v1(uuid, date)
  set schema billing_private;
alter function billing_private.get_my_card_account_positions_v1(uuid, date)
  rename to get_my_card_account_positions_pre_temporal_v1;

revoke all on function billing_private.structure_my_card_purchase_pre_temporal_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.create_my_card_installment_series_pre_temporal_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.create_my_card_installment_series_with_metadata_pre_temporal_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.create_my_card_purchase_pre_temporal_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.pay_my_card_invoice_pre_temporal_v1(uuid, uuid, numeric, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.reverse_my_card_payment_pre_temporal_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.credit_my_card_purchase_pre_temporal_v1(uuid, numeric, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.reverse_my_card_purchase_credit_pre_temporal_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.get_my_card_billing_summary_as_of_pre_temporal_v1(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function billing_private.get_my_card_account_positions_pre_temporal_v1(uuid, date)
  from public, anon, authenticated, service_role;

create function billing_private.guard_card_purchase_temporal_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.card_billing_cycle_id is not null
     and new.status = 'realizado'
     and (
       new.purchase_date is null
       or not isfinite(new.purchase_date)
       or new.purchase_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date
     ) then
    raise exception 'realized card purchase cannot take effect before its civil purchase_date'
      using errcode = '22023';
  end if;
  return new;
end
$$;

create trigger transactions_guard_card_purchase_temporal_v1
before insert or update of card_billing_cycle_id, status, purchase_date
on public.transactions
for each row execute function billing_private.guard_card_purchase_temporal_v1();

revoke all on function billing_private.guard_card_purchase_temporal_v1()
  from public, anon, authenticated, service_role;

-- Defense in depth for privileged/internal callers: the invoice ledger itself
-- enforces that a payment cannot predate any payable purchase in its cycle.
create function billing_private.guard_card_payment_temporal_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.entry_kind <> 'payment' then
    return new;
  end if;
  perform 1
  from public.card_billing_cycles
  where id = new.billing_cycle_id and user_id = new.user_id
  for update;
  if not found then
    raise exception 'billing cycle not found' using errcode = '23503';
  end if;
  if exists (
    select 1
    from public.transactions t
    where t.user_id = new.user_id
      and t.card_billing_cycle_id = new.billing_cycle_id
      and t.transaction_type = 'despesa'
      and t.status = 'realizado'
      and (t.purchase_date is null or t.purchase_date > new.effective_date)
  ) then
    raise exception 'payment effective_date precedes an eligible purchase_date'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger card_invoice_payments_guard_temporal_v1
before insert on public.card_invoice_payments
for each row execute function billing_private.guard_card_payment_temporal_v1();

revoke all on function billing_private.guard_card_payment_temporal_v1()
  from public, anon, authenticated, service_role;

create function public.structure_my_card_purchase_v1(p_transaction_id uuid)
returns public.card_billing_cycles
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
  v_purchase_date date;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if public.has_active_access('APP') is not true then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  select status, purchase_date into strict v_status, v_purchase_date
  from public.transactions
  where id = p_transaction_id and user_id = v_user
  for update;
  if v_status = 'realizado'
     and v_purchase_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'realized card purchase cannot use a future purchase_date'
      using errcode = '22023';
  end if;
  return billing_private.structure_my_card_purchase_pre_temporal_v1(p_transaction_id);
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
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if public.has_active_access('APP') is not true then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_status = 'realizado'
     and p_purchase_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'realized card purchase cannot use a future purchase_date'
      using errcode = '22023';
  end if;
  return billing_private.create_my_card_installment_series_pre_temporal_v1(
    p_operation_id, p_card_id, p_purchase_date, p_description,
    p_original_amount, p_installment_total, p_status, p_category, p_subcategory
  );
end
$$;

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
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if public.has_active_access('APP') is not true then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_status = 'realizado'
     and p_purchase_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'realized card purchase cannot use a future purchase_date'
      using errcode = '22023';
  end if;
  return billing_private.create_my_card_installment_series_with_metadata_pre_temporal_v1(
    p_operation_id, p_card_id, p_purchase_date, p_description,
    p_original_amount, p_installment_total, p_status, p_category, p_subcategory,
    p_payment_method, p_note, p_goal_id, p_goal_effect
  );
end
$$;

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
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if public.has_active_access('APP') is not true then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_status = 'realizado'
     and p_purchase_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'realized card purchase cannot use a future purchase_date'
      using errcode = '22023';
  end if;
  return billing_private.create_my_card_purchase_pre_temporal_v1(
    p_operation_id, p_card_id, p_purchase_date, p_description, p_amount,
    p_status, p_category, p_subcategory, p_payment_method, p_note,
    p_goal_id, p_goal_effect
  );
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
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if public.has_active_access('APP') is not true then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  if p_effective_date is null or not isfinite(p_effective_date) then
    raise exception 'invalid payment effective_date' using errcode = '22023';
  end if;

  -- A retry must preserve the original idempotent result even if the cycle
  -- later receives another purchase through a separately reviewed operation.
  if exists (
    select 1 from public.card_invoice_payments
    where user_id = v_user and operation_id = p_operation_id
  ) then
    return billing_private.pay_my_card_invoice_pre_temporal_v1(
      p_billing_cycle_id, p_source_account_id, p_amount,
      p_effective_date, p_operation_id
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
      and t.status = 'realizado'
      and (t.purchase_date is null or t.purchase_date > p_effective_date)
  ) then
    raise exception 'payment effective_date precedes an eligible purchase_date'
      using errcode = '23514';
  end if;
  return billing_private.pay_my_card_invoice_pre_temporal_v1(
    p_billing_cycle_id, p_source_account_id, p_amount,
    p_effective_date, p_operation_id
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
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if public.has_active_access('APP') is not true then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  return billing_private.reverse_my_card_payment_pre_temporal_v1(
    p_payment_id, p_operation_id, p_effective_date, p_reason_code
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
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if public.has_active_access('APP') is not true then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  return billing_private.credit_my_card_purchase_pre_temporal_v1(
    p_transaction_id, p_amount, p_effective_date, p_operation_id, p_reason_code
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
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if public.has_active_access('APP') is not true then
    raise exception 'active APP access required' using errcode = '42501';
  end if;
  return billing_private.reverse_my_card_purchase_credit_pre_temporal_v1(
    p_credit_id, p_operation_id, p_effective_date, p_reason_code
  );
end
$$;

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
  if v_user is null or public.has_active_access('APP') is not true then
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
    where t.user_id = v_user
      and t.card_billing_cycle_id is not null
      and t.purchase_date <= v_position
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
      and t.purchase_date <= v_position
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
    and (
      pu.card_billing_cycle_id is not null
      or pa.billing_cycle_id is not null
      or cr.card_billing_cycle_id is not null
    )
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
  if v_user is null or public.has_active_access('APP') is not true then
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

-- RLS predicates fail closed on a nullable commercial predicate.
drop policy card_installment_series_select_own on public.card_installment_series;
create policy card_installment_series_select_own
  on public.card_installment_series for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')) is true);

drop policy card_billing_cycles_select_own on public.card_billing_cycles;
create policy card_billing_cycles_select_own
  on public.card_billing_cycles for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')) is true);

drop policy card_invoice_payments_select_own on public.card_invoice_payments;
create policy card_invoice_payments_select_own
  on public.card_invoice_payments for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')) is true);

drop policy card_payment_allocations_select_own on public.card_payment_allocations;
create policy card_payment_allocations_select_own
  on public.card_payment_allocations for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')) is true);

drop policy card_account_settlements_select_own on public.card_account_settlements;
create policy card_account_settlements_select_own
  on public.card_account_settlements for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')) is true);

drop policy card_purchase_credits_select_own on public.card_purchase_credits;
create policy card_purchase_credits_select_own
  on public.card_purchase_credits for select to authenticated
  using ((select auth.uid()) = user_id and (select public.has_active_access('APP')) is true);

-- Function creation grants PUBLIC by default. Revoke every new surface first;
-- only the read adapters are restored for authenticated while writers stay dormant.
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

do $postcondition$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.structure_my_card_purchase_v1(uuid)',
    'public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)',
    'public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)',
    'public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',
    'public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',
    'public.reverse_my_card_payment_v1(uuid,uuid,date,text)',
    'public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)',
    'public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)'
  ] loop
    if exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_signature)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute')
       or has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'temporal hardening failed to preserve dormant mutator: %',
        v_signature using errcode = 'P0001';
    end if;
  end loop;
end
$postcondition$;

comment on function public.get_my_card_billing_summary_as_of_v1(uuid, date) is
  'APP-gated temporal billing position. Includes only purchases whose civil purchase_date is on or before position_as_of and effects effective by that position.';
comment on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid) is
  'Dormant APP-gated payment boundary. When separately reactivated, effective_date must be on or after every eligible realized purchase_date in the locked cycle.';

commit;
