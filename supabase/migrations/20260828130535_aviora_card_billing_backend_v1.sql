-- AVIORA Card Billing Backend V1 — design candidate only.
-- IMPORTANT: this file is intentionally not applied by the design gate that
-- created it. Applying it requires a separate, explicit database authorization.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0));

do $preflight$
begin
  if to_regclass('auth.users') is null
     or to_regprocedure('auth.uid()') is null
     or to_regclass('public.cards') is null
     or to_regclass('public.accounts') is null
     or to_regclass('public.transactions') is null then
    raise exception 'card billing v1 requires the V82 cards/accounts/transactions contract'
      using errcode = 'P0001';
  end if;

  if (
       select p.prorettype <> 'uuid'::regtype
       from pg_proc p
       where p.oid = 'auth.uid()'::regprocedure
     ) or exists (
       select 1
       from (values
         ('auth',   'users',        'id',               'uuid'::regtype,    true),
         ('public', 'cards',         'id',               'uuid'::regtype,    true),
         ('public', 'cards',         'user_id',          'uuid'::regtype,    true),
         ('public', 'accounts',      'id',               'uuid'::regtype,    true),
         ('public', 'accounts',      'user_id',          'uuid'::regtype,    true),
         ('public', 'transactions',  'id',               'uuid'::regtype,    true),
         ('public', 'transactions',  'user_id',          'uuid'::regtype,    true),
         ('public', 'transactions',  'card_id',          'uuid'::regtype,    false),
         ('public', 'transactions',  'transaction_date', 'date'::regtype,    true),
         ('public', 'transactions',  'transaction_type', 'text'::regtype,    true),
         ('public', 'transactions',  'amount',           'numeric'::regtype, true),
         ('public', 'transactions',  'status',           'text'::regtype,    false)
       ) expected(schema_name, table_name, column_name, type_oid, require_not_null)
       left join pg_namespace n on n.nspname = expected.schema_name
       left join pg_class c
         on c.relnamespace = n.oid and c.relname = expected.table_name
       left join pg_attribute a
         on a.attrelid = c.oid
        and a.attname = expected.column_name
        and a.attnum > 0
        and not a.attisdropped
       where a.attnum is null
          or a.atttypid <> expected.type_oid
          or (expected.require_not_null and not a.attnotnull)
     ) then
    raise exception 'card billing v1 base column contract drift; reconcile schema before migration'
      using errcode = 'P0001';
  end if;

  if to_regclass('public.card_billing_cycles') is not null
     or to_regclass('public.card_invoice_payments') is not null
     or to_regclass('public.card_purchase_credits') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'transactions'
         and column_name = 'card_billing_cycle_id'
     ) then
    raise exception 'card billing v1 objects already exist; semantic reconciliation is required'
      using errcode = 'P0001';
  end if;

  if to_regnamespace('billing_private') is not null then
    raise exception 'billing_private already exists; ownership and semantic reconciliation are required'
      using errcode = 'P0001';
  end if;

  if not exists (
       select 1 from pg_constraint
       where conrelid = 'public.cards'::regclass
         and conname = 'cards_id_user_id_key'
         and contype = 'u'
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.accounts'::regclass
         and conname = 'accounts_id_user_id_key'
         and contype = 'u'
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.transactions'::regclass
         and conname = 'transactions_id_user_id_key'
         and contype = 'u'
     ) then
    raise exception 'card billing v1 requires V82 composite ownership keys'
      using errcode = 'P0001';
  end if;
end
$preflight$;

create schema billing_private;
revoke all on schema billing_private from public, anon, authenticated;

create table public.card_billing_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  card_id uuid not null,
  cycle_key date not null,
  cycle_start_date date not null,
  closing_date date not null,
  due_date date not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint card_billing_cycles_id_user_key unique (id, user_id),
  constraint card_billing_cycles_user_card_key unique (user_id, card_id, cycle_key),
  constraint card_billing_cycles_card_user_fkey
    foreign key (card_id, user_id)
    references public.cards(id, user_id) on delete restrict,
  constraint card_billing_cycles_key_month_check
    check (cycle_key = date_trunc('month', cycle_key)::date),
  constraint card_billing_cycles_dates_finite_check
    check (
      isfinite(cycle_key)
      and isfinite(cycle_start_date)
      and isfinite(closing_date)
      and isfinite(due_date)
    ),
  constraint card_billing_cycles_dates_check
    check (cycle_start_date <= closing_date and closing_date <= due_date)
);

alter table public.transactions
  add column card_billing_cycle_id uuid;

alter table public.transactions
  add constraint transactions_card_billing_cycle_user_fkey
  foreign key (card_billing_cycle_id, user_id)
  references public.card_billing_cycles(id, user_id)
  on delete restrict not valid;

create table public.card_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  billing_cycle_id uuid not null,
  source_account_id uuid not null,
  entry_kind text not null default 'payment',
  amount numeric not null,
  occurred_at timestamptz not null,
  operation_id uuid not null,
  reversal_of_id uuid,
  reason_code text,
  created_at timestamptz not null default clock_timestamp(),
  constraint card_invoice_payments_id_user_key unique (id, user_id),
  constraint card_invoice_payments_operation_key unique (user_id, operation_id),
  constraint card_invoice_payments_cycle_user_fkey
    foreign key (billing_cycle_id, user_id)
    references public.card_billing_cycles(id, user_id) on delete restrict,
  constraint card_invoice_payments_account_user_fkey
    foreign key (source_account_id, user_id)
    references public.accounts(id, user_id) on delete restrict,
  constraint card_invoice_payments_reversal_user_fkey
    foreign key (reversal_of_id, user_id)
    references public.card_invoice_payments(id, user_id) on delete restrict,
  constraint card_invoice_payments_kind_check
    check (entry_kind in ('payment', 'payment_reversal')),
  constraint card_invoice_payments_amount_check
    check (amount > 0 and amount < 'Infinity'::numeric),
  constraint card_invoice_payments_occurred_at_check
    check (isfinite(occurred_at)),
  constraint card_invoice_payments_reason_check check (
    (entry_kind = 'payment' and reason_code is null)
    or (
      entry_kind = 'payment_reversal'
      and reason_code is not null
      and length(trim(reason_code)) between 3 and 80
    )
  ),
  constraint card_invoice_payments_reversal_shape_check check (
    (entry_kind = 'payment' and reversal_of_id is null)
    or (entry_kind = 'payment_reversal' and reversal_of_id is not null)
  ),
  constraint card_invoice_payments_not_self_check
    check (reversal_of_id is null or reversal_of_id <> id)
);

create unique index card_invoice_payments_single_reversal_uidx
  on public.card_invoice_payments(user_id, reversal_of_id)
  where reversal_of_id is not null;

create table public.card_purchase_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  transaction_id uuid not null,
  entry_kind text not null default 'purchase_credit',
  amount numeric not null,
  occurred_at timestamptz not null,
  operation_id uuid not null,
  reversal_of_id uuid,
  reason_code text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint card_purchase_credits_id_user_key unique (id, user_id),
  constraint card_purchase_credits_operation_key unique (user_id, operation_id),
  constraint card_purchase_credits_transaction_user_fkey
    foreign key (transaction_id, user_id)
    references public.transactions(id, user_id) on delete restrict,
  constraint card_purchase_credits_reversal_user_fkey
    foreign key (reversal_of_id, user_id)
    references public.card_purchase_credits(id, user_id) on delete restrict,
  constraint card_purchase_credits_kind_check
    check (entry_kind in ('purchase_credit', 'credit_reversal')),
  constraint card_purchase_credits_amount_check
    check (amount > 0 and amount < 'Infinity'::numeric),
  constraint card_purchase_credits_occurred_at_check
    check (isfinite(occurred_at)),
  constraint card_purchase_credits_reason_check
    check (length(trim(reason_code)) between 3 and 80),
  constraint card_purchase_credits_reversal_shape_check check (
    (entry_kind = 'purchase_credit' and reversal_of_id is null)
    or (entry_kind = 'credit_reversal' and reversal_of_id is not null)
  ),
  constraint card_purchase_credits_not_self_check
    check (reversal_of_id is null or reversal_of_id <> id)
);

create unique index card_purchase_credits_single_reversal_uidx
  on public.card_purchase_credits(user_id, reversal_of_id)
  where reversal_of_id is not null;

create index card_billing_cycles_user_card_due_idx
  on public.card_billing_cycles(user_id, card_id, due_date desc);
create index transactions_user_cycle_date_card_idx
  on public.transactions(user_id, card_billing_cycle_id, transaction_date, card_id)
  where card_billing_cycle_id is not null;
create index card_invoice_payments_user_cycle_date_idx
  on public.card_invoice_payments(user_id, billing_cycle_id, occurred_at);
create index card_invoice_payments_user_account_date_idx
  on public.card_invoice_payments(user_id, source_account_id, occurred_at);
create index card_purchase_credits_user_transaction_idx
  on public.card_purchase_credits(user_id, transaction_id);

alter table public.card_billing_cycles enable row level security;
alter table public.card_invoice_payments enable row level security;
alter table public.card_purchase_credits enable row level security;

revoke all on table public.card_billing_cycles from public, anon, authenticated;
revoke all on table public.card_invoice_payments from public, anon, authenticated;
revoke all on table public.card_purchase_credits from public, anon, authenticated;

grant select on table public.card_billing_cycles to authenticated;
grant select on table public.card_invoice_payments to authenticated;
grant select on table public.card_purchase_credits to authenticated;

create policy card_billing_cycles_select_own
  on public.card_billing_cycles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy card_invoice_payments_select_own
  on public.card_invoice_payments for select to authenticated
  using ((select auth.uid()) = user_id);
create policy card_purchase_credits_select_own
  on public.card_purchase_credits for select to authenticated
  using ((select auth.uid()) = user_id);

create function billing_private.reject_cycle_update_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'card billing cycle snapshots are immutable'
    using errcode = '23514';
end
$$;

create trigger card_billing_cycles_immutable_v1
before update on public.card_billing_cycles
for each row execute function billing_private.reject_cycle_update_v1();

create function billing_private.guard_transaction_cycle_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_old_cycle public.card_billing_cycles%rowtype;
  v_new_cycle public.card_billing_cycles%rowtype;
  v_has_ledger boolean := false;
begin
  if v_actor is not null then
    if tg_op = 'INSERT' and new.card_billing_cycle_id is not null then
      raise exception 'shadow billing writer is not activated'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE'
       and new.card_billing_cycle_id is distinct from old.card_billing_cycle_id then
      raise exception 'shadow billing writer is not activated'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'transaction ownership is immutable'
        using errcode = '23514';
    end if;

    perform 1
    from public.card_billing_cycles
    where user_id = old.user_id
      and id in (old.card_billing_cycle_id, new.card_billing_cycle_id)
    order by id
    for update;

    if old.card_billing_cycle_id is not null then
      select * into strict v_old_cycle
      from public.card_billing_cycles
      where id = old.card_billing_cycle_id and user_id = old.user_id;

      select exists (
        select 1
        from public.card_invoice_payments p
        where p.user_id = old.user_id
          and p.billing_cycle_id = old.card_billing_cycle_id
      ) or exists (
        select 1
        from public.card_purchase_credits c
        join public.transactions linked
          on linked.id = c.transaction_id
         and linked.user_id = c.user_id
        where c.user_id = old.user_id
          and linked.card_billing_cycle_id = old.card_billing_cycle_id
      ) into v_has_ledger;

      if v_has_ledger then
        if new.card_billing_cycle_id is distinct from old.card_billing_cycle_id
           or new.card_id is distinct from old.card_id
           or new.transaction_date is distinct from old.transaction_date
           or new.transaction_type is distinct from old.transaction_type
           or new.amount is distinct from old.amount then
          raise exception 'settled card purchase is immutable; use an explicit compensating operation'
            using errcode = '23514';
        end if;

        if (coalesce(old.status, '') = 'cancelado')
           is distinct from (coalesce(new.status, '') = 'cancelado') then
          raise exception 'settled card purchase cannot cross the cancellation boundary'
            using errcode = '23514';
        end if;
      elsif new.card_id is distinct from old.card_id
         or new.transaction_date is distinct from old.transaction_date
         or new.transaction_type is distinct from old.transaction_type then
        -- Preserve the canonical transaction_date exactly as supplied by the
        -- legacy writer. Membership is cleared, never recalculated here.
        new.card_billing_cycle_id := null;
      end if;
    end if;
  end if;

  if new.card_billing_cycle_id is null then return new; end if;
  if new.card_id is null
     or new.transaction_type <> 'despesa'
     or new.transaction_date is null
     or not isfinite(new.transaction_date)
     or new.amount is null
     or not (new.amount > 0 and new.amount < 'Infinity'::numeric) then
    raise exception 'only card expenses may reference a billing cycle' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
     and new.card_billing_cycle_id = old.card_billing_cycle_id then
    v_new_cycle := v_old_cycle;
  else
    select * into strict v_new_cycle
    from public.card_billing_cycles
    where id = new.card_billing_cycle_id and user_id = new.user_id
    for update;
  end if;

  if v_new_cycle.card_id <> new.card_id
     or v_new_cycle.cycle_key <> date_trunc('month', new.transaction_date)::date then
    raise exception 'transaction and billing cycle contract mismatch' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger transactions_guard_card_cycle_v1
before insert or update of card_billing_cycle_id, user_id, card_id, transaction_date, transaction_type, amount, status
on public.transactions
for each row execute function billing_private.guard_transaction_cycle_v1();

create function billing_private.guard_linked_transaction_delete_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_has_ledger boolean;
begin
  if old.card_billing_cycle_id is not null then
    perform 1
    from public.card_billing_cycles
    where id = old.card_billing_cycle_id and user_id = old.user_id
    for update;

    select exists (
      select 1
      from public.card_invoice_payments p
      where p.user_id = old.user_id
        and p.billing_cycle_id = old.card_billing_cycle_id
    ) or exists (
      select 1
      from public.card_purchase_credits c
      join public.transactions linked
        on linked.id = c.transaction_id
       and linked.user_id = c.user_id
      where c.user_id = old.user_id
        and linked.card_billing_cycle_id = old.card_billing_cycle_id
    ) into v_has_ledger;

    if v_has_ledger then
      raise exception 'settled card purchase cannot be deleted; use an explicit compensating operation'
        using errcode = '23514';
    end if;
  end if;

  return old;
end
$$;

create trigger transactions_guard_linked_card_delete_v1
before delete on public.transactions
for each row execute function billing_private.guard_linked_transaction_delete_v1();

create function billing_private.guard_payment_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
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
       or v_original.amount <> new.amount then
      raise exception 'payment reversal must exactly compensate its original payment'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

create trigger card_invoice_payments_guard_insert_v1
before insert on public.card_invoice_payments
for each row execute function billing_private.guard_payment_insert_v1();

create function billing_private.guard_purchase_credit_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
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
       or v_original.amount <> new.amount then
      raise exception 'credit reversal must exactly compensate its original credit'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

create trigger card_purchase_credits_guard_insert_v1
before insert on public.card_purchase_credits
for each row execute function billing_private.guard_purchase_credit_insert_v1();

create function billing_private.reject_ledger_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'card billing ledgers are append-only; use an explicit reversal operation'
    using errcode = '23514';
end
$$;

create trigger card_invoice_payments_append_only_v1
before update or delete on public.card_invoice_payments
for each row execute function billing_private.reject_ledger_mutation_v1();

create trigger card_purchase_credits_append_only_v1
before update or delete on public.card_purchase_credits
for each row execute function billing_private.reject_ledger_mutation_v1();

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
  select p.user_id, p.billing_cycle_id,
         coalesce(sum(case when p.entry_kind = 'payment' then p.amount else -p.amount end), 0)::numeric as paid_amount
  from public.card_invoice_payments p
  group by p.user_id, p.billing_cycle_id
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
       greatest(coalesce(cr.credited_amount, 0) + coalesce(pa.paid_amount, 0) - coalesce(pu.purchase_amount, 0), 0)::numeric as credit_balance
from public.card_billing_cycles cy
left join purchases pu on pu.user_id = cy.user_id and pu.card_billing_cycle_id = cy.id
left join payments pa on pa.user_id = cy.user_id and pa.billing_cycle_id = cy.id
left join credits cr on cr.user_id = cy.user_id and cr.card_billing_cycle_id = cy.id;

create view public.card_billing_shadow_comparison_v1
with (security_invoker = true)
as
with coverage as (
  select t.user_id,
         t.card_id,
         date_trunc('month', t.transaction_date)::date as transaction_month,
         count(*)::bigint as legacy_count,
         coalesce(sum(t.amount), 0)::numeric as legacy_amount,
         count(*) filter (where t.card_billing_cycle_id is not null)::bigint as structured_count,
         coalesce(sum(t.amount) filter (
           where t.card_billing_cycle_id is not null
         ), 0)::numeric as structured_amount
  from public.transactions t
  where t.card_id is not null
    and t.transaction_type = 'despesa'
    and coalesce(t.status, 'realizado') <> 'cancelado'
  group by t.user_id, t.card_id, date_trunc('month', t.transaction_date)::date
)
select user_id, card_id, transaction_month,
       legacy_count, legacy_amount, structured_count, structured_amount,
       case
         when structured_count = legacy_count
          and structured_amount = legacy_amount then 'complete'
         when structured_count = 0 then 'unlinked'
         else 'partial'
       end::text as coverage_state
from coverage;

create function public.pay_my_card_invoice_v1(
  p_billing_cycle_id uuid,
  p_source_account_id uuid,
  p_amount numeric,
  p_occurred_at timestamptz,
  p_operation_id uuid
)
returns public.card_invoice_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_cycle public.card_billing_cycles%rowtype;
  v_existing public.card_invoice_payments%rowtype;
  v_result public.card_invoice_payments%rowtype;
  v_outstanding numeric;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_operation_id is null
     or p_amount is null
     or not (p_amount > 0 and p_amount < 'Infinity'::numeric)
     or p_occurred_at is null
     or not isfinite(p_occurred_at) then
    raise exception 'invalid payment input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':card-payment:' || p_operation_id::text, 0)
  );

  select * into v_existing from public.card_invoice_payments
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    if v_existing.entry_kind <> 'payment'
       or v_existing.billing_cycle_id <> p_billing_cycle_id
       or v_existing.source_account_id <> p_source_account_id
       or v_existing.amount <> p_amount
       or v_existing.occurred_at <> p_occurred_at then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  select * into strict v_cycle from public.card_billing_cycles
  where id = p_billing_cycle_id and user_id = v_user for update;
  perform 1 from public.accounts
  where id = p_source_account_id and user_id = v_user for update;
  if not found then raise exception 'source account not found' using errcode = '23503'; end if;

  select outstanding_amount into strict v_outstanding
  from public.card_invoice_balances_v1
  where id = v_cycle.id and user_id = v_user;
  if p_amount > v_outstanding then
    raise exception 'payment exceeds invoice outstanding amount' using errcode = '23514';
  end if;

  insert into public.card_invoice_payments(
    user_id, billing_cycle_id, source_account_id,
    entry_kind, amount, occurred_at, operation_id
  ) values (
    v_user, v_cycle.id, p_source_account_id,
    'payment', p_amount, p_occurred_at, p_operation_id
  ) returning * into v_result;
  return v_result;
end
$$;

create function public.reverse_my_card_payment_v1(
  p_payment_id uuid,
  p_operation_id uuid,
  p_occurred_at timestamptz,
  p_reason_code text
)
returns public.card_invoice_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_original public.card_invoice_payments%rowtype;
  v_existing public.card_invoice_payments%rowtype;
  v_result public.card_invoice_payments%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_operation_id is null
     or p_occurred_at is null
     or not isfinite(p_occurred_at)
     or length(trim(coalesce(p_reason_code, ''))) not between 3 and 80 then
    raise exception 'invalid reversal input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':card-payment-reversal:' || p_operation_id::text, 0)
  );
  select * into v_existing from public.card_invoice_payments
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    if v_existing.entry_kind <> 'payment_reversal'
       or v_existing.reversal_of_id <> p_payment_id
       or v_existing.occurred_at <> p_occurred_at
       or v_existing.reason_code <> trim(p_reason_code) then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  select * into strict v_original from public.card_invoice_payments
  where id = p_payment_id and user_id = v_user and entry_kind = 'payment';
  perform 1 from public.card_billing_cycles
  where id = v_original.billing_cycle_id and user_id = v_user for update;

  insert into public.card_invoice_payments(
    user_id, billing_cycle_id, source_account_id, entry_kind,
    amount, occurred_at, operation_id, reversal_of_id, reason_code
  ) values (
    v_user, v_original.billing_cycle_id, v_original.source_account_id,
    'payment_reversal', v_original.amount,
    p_occurred_at, p_operation_id, v_original.id, trim(p_reason_code)
  ) returning * into v_result;
  return v_result;
end
$$;

create function public.credit_my_card_purchase_v1(
  p_transaction_id uuid,
  p_amount numeric,
  p_occurred_at timestamptz,
  p_operation_id uuid,
  p_reason_code text
)
returns public.card_purchase_credits
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_tx public.transactions%rowtype;
  v_existing public.card_purchase_credits%rowtype;
  v_result public.card_purchase_credits%rowtype;
  v_credited numeric;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_operation_id is null
     or p_amount is null
     or not (p_amount > 0 and p_amount < 'Infinity'::numeric)
     or p_occurred_at is null
     or not isfinite(p_occurred_at)
     or length(trim(coalesce(p_reason_code, ''))) not between 3 and 80 then
    raise exception 'invalid purchase credit input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':card-credit:' || p_operation_id::text, 0)
  );
  select * into v_existing from public.card_purchase_credits
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    if v_existing.entry_kind <> 'purchase_credit'
       or v_existing.transaction_id <> p_transaction_id
       or v_existing.amount <> p_amount
       or v_existing.occurred_at <> p_occurred_at
       or v_existing.reason_code <> trim(p_reason_code) then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  select * into strict v_tx from public.transactions
  where id = p_transaction_id and user_id = v_user for update;
  if v_tx.transaction_type <> 'despesa' or v_tx.card_id is null
     or v_tx.card_billing_cycle_id is null or coalesce(v_tx.status, '') = 'cancelado' then
    raise exception 'transaction is not an eligible settled card purchase' using errcode = '22023';
  end if;
  perform 1 from public.card_billing_cycles
  where id = v_tx.card_billing_cycle_id and user_id = v_user for update;

  select coalesce(sum(case when entry_kind = 'purchase_credit' then amount else -amount end), 0)
  into v_credited
  from public.card_purchase_credits
  where user_id = v_user and transaction_id = v_tx.id;
  if v_credited + p_amount > v_tx.amount then
    raise exception 'purchase credit exceeds original purchase amount' using errcode = '23514';
  end if;

  insert into public.card_purchase_credits(
    user_id, transaction_id, entry_kind,
    amount, occurred_at, operation_id, reason_code
  ) values (
    v_user, v_tx.id, 'purchase_credit', p_amount,
    p_occurred_at, p_operation_id, trim(p_reason_code)
  ) returning * into v_result;
  return v_result;
end
$$;

create function public.reverse_my_card_purchase_credit_v1(
  p_credit_id uuid,
  p_operation_id uuid,
  p_occurred_at timestamptz,
  p_reason_code text
)
returns public.card_purchase_credits
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_original public.card_purchase_credits%rowtype;
  v_transaction public.transactions%rowtype;
  v_existing public.card_purchase_credits%rowtype;
  v_result public.card_purchase_credits%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_operation_id is null
     or p_occurred_at is null
     or not isfinite(p_occurred_at)
     or length(trim(coalesce(p_reason_code, ''))) not between 3 and 80 then
    raise exception 'invalid credit reversal input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':card-credit-reversal:' || p_operation_id::text, 0)
  );
  select * into v_existing from public.card_purchase_credits
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    if v_existing.entry_kind <> 'credit_reversal'
       or v_existing.reversal_of_id <> p_credit_id
       or v_existing.occurred_at <> p_occurred_at
       or v_existing.reason_code <> trim(p_reason_code) then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  select * into strict v_original from public.card_purchase_credits
  where id = p_credit_id and user_id = v_user and entry_kind = 'purchase_credit';
  select * into strict v_transaction from public.transactions
  where id = v_original.transaction_id and user_id = v_user for update;
  perform 1 from public.card_billing_cycles
  where id = v_transaction.card_billing_cycle_id and user_id = v_user for update;

  insert into public.card_purchase_credits(
    user_id, transaction_id, entry_kind,
    amount, occurred_at, operation_id, reversal_of_id, reason_code
  ) values (
    v_user, v_original.transaction_id, 'credit_reversal', v_original.amount,
    p_occurred_at, p_operation_id, v_original.id, trim(p_reason_code)
  ) returning * into v_result;
  return v_result;
end
$$;

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
  credit_balance numeric
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select i.card_id, i.id, i.cycle_key, i.closing_date, i.due_date,
         i.purchase_amount, i.credited_amount, i.paid_amount,
         i.outstanding_amount, i.credit_balance
  from public.card_invoice_balances_v1 i
  where i.user_id = (select auth.uid())
    and (p_card_id is null or i.card_id = p_card_id)
  order by i.due_date desc, i.card_id
$$;

revoke all on function billing_private.guard_transaction_cycle_v1() from public, anon, authenticated;
revoke all on function billing_private.guard_linked_transaction_delete_v1() from public, anon, authenticated;
revoke all on function billing_private.reject_cycle_update_v1() from public, anon, authenticated;
revoke all on function billing_private.guard_payment_insert_v1() from public, anon, authenticated;
revoke all on function billing_private.guard_purchase_credit_insert_v1() from public, anon, authenticated;
revoke all on function billing_private.reject_ledger_mutation_v1() from public, anon, authenticated;

revoke all on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.reverse_my_card_payment_v1(uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.credit_my_card_purchase_v1(uuid, numeric, timestamptz, uuid, text) from public, anon, authenticated;
revoke all on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.get_my_card_billing_summary_v1(uuid) from public, anon, authenticated;

-- Shadow mode: mutation RPCs deliberately remain non-executable by authenticated
-- clients until the billing/product contracts and account-settlement integration
-- have a separately approved activation migration.
grant execute on function public.get_my_card_billing_summary_v1(uuid) to authenticated;

grant select on public.card_invoice_balances_v1 to authenticated;
grant select on public.card_billing_shadow_comparison_v1 to authenticated;
revoke all on public.card_invoice_balances_v1 from public, anon;
revoke all on public.card_billing_shadow_comparison_v1 from public, anon;

comment on table public.card_billing_cycles is
  'Frozen card invoice cycle metadata; no economic expense is recorded here.';
comment on table public.card_invoice_payments is
  'Immutable settlement ledger. Payments are patrimonial settlement, never consumption expense.';
comment on table public.card_purchase_credits is
  'Immutable purchase-credit ledger for post-settlement refunds and their reversals.';
comment on column public.transactions.card_billing_cycle_id is
  'Explicit invoice membership. Nullable during the legacy transition; never backfilled by inference.';
comment on view public.card_billing_shadow_comparison_v1 is
  'Read-only coverage comparison by canonical transaction month; never infers or reclassifies a billing cycle.';

commit;
