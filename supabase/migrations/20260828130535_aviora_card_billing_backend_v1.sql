-- AVIORA Card Billing Backend V1 — local Beta-approval candidate.
-- IMPORTANT: this file remains unapplied. Any remote migration or RPC activation
-- requires a separate, explicit authorization after shadow validation.

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
         ('public', 'cards',         'limit',            'numeric'::regtype, true),
         ('public', 'cards',         'closing_day',      'int4'::regtype,    false),
         ('public', 'cards',         'due_day',          'int4'::regtype,    false),
         ('public', 'accounts',      'id',               'uuid'::regtype,    true),
         ('public', 'accounts',      'user_id',          'uuid'::regtype,    true),
         ('public', 'accounts',      'opening_balance',  'numeric'::regtype, true),
         ('public', 'transactions',  'id',               'uuid'::regtype,    true),
         ('public', 'transactions',  'user_id',          'uuid'::regtype,    true),
         ('public', 'transactions',  'card_id',          'uuid'::regtype,    false),
         ('public', 'transactions',  'transaction_date', 'date'::regtype,    true),
         ('public', 'transactions',  'purchase_date',    'date'::regtype,    false),
         ('public', 'transactions',  'description',      'text'::regtype,    true),
         ('public', 'transactions',  'category',         'text'::regtype,    false),
         ('public', 'transactions',  'subcategory',      'text'::regtype,    false),
         ('public', 'transactions',  'transaction_type', 'text'::regtype,    true),
         ('public', 'transactions',  'amount',           'numeric'::regtype, true),
         ('public', 'transactions',  'status',           'text'::regtype,    false),
         ('public', 'transactions',  'installment_series_id', 'uuid'::regtype, false),
         ('public', 'transactions',  'installment_number',    'int4'::regtype, false)
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
     or to_regclass('public.card_payment_allocations') is not null
     or to_regclass('public.card_account_settlements') is not null
     or to_regclass('public.card_purchase_credits') is not null
     or to_regclass('public.card_installment_series') is not null
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'transactions'
         and column_name in ('card_billing_cycle_id', 'installment_total')
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

-- Existing V82 clients legitimately retain INSERT/UPDATE access to their own
-- transactions.  A private transaction-scoped capability prevents those broad
-- legacy grants from being used to forge structured billing membership while
-- still allowing the dormant SECURITY DEFINER writers to exercise the same
-- transaction triggers when they are explicitly activated in a later gate.
create table billing_private.writer_context_v1 (
  transaction_id bigint not null,
  user_id uuid not null,
  purpose text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint writer_context_v1_pkey primary key (transaction_id, user_id, purpose),
  constraint writer_context_v1_purpose_check
    check (purpose in ('structure_purchase', 'create_installments'))
);
revoke all on table billing_private.writer_context_v1 from public, anon, authenticated;

create table public.card_installment_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  card_id uuid not null,
  operation_id uuid not null,
  purchase_date date not null,
  description text not null,
  category text,
  subcategory text,
  initial_status text not null,
  installment_total smallint not null,
  original_amount numeric(14,2) not null,
  origin_kind text not null default 'new_card_purchase',
  created_at timestamptz not null default clock_timestamp(),
  constraint card_installment_series_id_user_key unique (id, user_id),
  constraint card_installment_series_id_user_card_key unique (id, user_id, card_id),
  constraint card_installment_series_operation_key unique (user_id, operation_id),
  constraint card_installment_series_card_user_fkey
    foreign key (card_id, user_id)
    references public.cards(id, user_id) on delete restrict,
  constraint card_installment_series_purchase_date_finite_check
    check (isfinite(purchase_date)),
  constraint card_installment_series_total_check
    check (installment_total between 1 and 120),
  constraint card_installment_series_amount_check
    check (
      original_amount > 0
      and original_amount <= 999999999999.99
      and original_amount = round(original_amount, 2)
      and original_amount < 'Infinity'::numeric
      and original_amount * 100 >= installment_total
    ),
  constraint card_installment_series_status_check
    check (initial_status in ('realizado', 'pendente', 'programado')),
  constraint card_installment_series_origin_check
    check (origin_kind = 'new_card_purchase'),
  constraint card_installment_series_description_check
    check (length(trim(description)) between 1 and 240)
);

create table public.card_billing_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  card_id uuid not null,
  cycle_key date not null,
  closing_day_snapshot smallint not null,
  due_day_snapshot smallint not null,
  cycle_start_date date not null,
  closing_date date not null,
  due_date date not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint card_billing_cycles_id_user_key unique (id, user_id),
  constraint card_billing_cycles_user_card_closing_key unique (user_id, card_id, closing_date),
  constraint card_billing_cycles_card_user_fkey
    foreign key (card_id, user_id)
    references public.cards(id, user_id) on delete restrict,
  constraint card_billing_cycles_key_month_check
    check (
      cycle_key = date_trunc('month', cycle_key)::date
      and cycle_key = date_trunc('month', due_date)::date
    ),
  constraint card_billing_cycles_snapshot_days_check
    check (closing_day_snapshot between 1 and 31 and due_day_snapshot between 1 and 31),
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
  add column card_billing_cycle_id uuid,
  add column installment_total smallint;

alter table public.transactions
  add constraint transactions_card_billing_cycle_user_fkey
  foreign key (card_billing_cycle_id, user_id)
  references public.card_billing_cycles(id, user_id)
  on delete restrict not valid;

alter table public.transactions
  add constraint transactions_card_installment_shape_v1
  check (
    (installment_series_id is null and installment_number is null and installment_total is null)
    or (
      -- V82 already accepted an opaque series UUID plus a positive number.
      -- Preserve that writer contract without inferring a V1 structured series.
      installment_series_id is not null
      and installment_number > 0
      and installment_total is null
    )
    or (
      installment_series_id is not null
      and installment_number between 1 and installment_total
      and installment_total between 1 and 120
    )
  ) not valid;

create table public.card_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  billing_cycle_id uuid not null,
  source_account_id uuid not null,
  entry_kind text not null default 'payment',
  amount numeric(14,2) not null,
  effective_date date not null,
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
    check (
      amount > 0
      and amount <= 999999999999.99
      and amount = round(amount, 2)
      and amount < 'Infinity'::numeric
    ),
  constraint card_invoice_payments_effective_date_check
    check (isfinite(effective_date)),
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

create table public.card_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  payment_entry_id uuid not null,
  billing_cycle_id uuid not null,
  amount numeric(14,2) not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint card_payment_allocations_id_user_key unique (id, user_id),
  constraint card_payment_allocations_payment_key unique (user_id, payment_entry_id),
  constraint card_payment_allocations_payment_user_fkey
    foreign key (payment_entry_id, user_id)
    references public.card_invoice_payments(id, user_id) on delete restrict,
  constraint card_payment_allocations_cycle_user_fkey
    foreign key (billing_cycle_id, user_id)
    references public.card_billing_cycles(id, user_id) on delete restrict,
  constraint card_payment_allocations_amount_check
    check (
      amount > 0
      and amount <= 999999999999.99
      and amount = round(amount, 2)
      and amount < 'Infinity'::numeric
    )
);

create table public.card_account_settlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  payment_entry_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint card_account_settlements_id_user_key unique (id, user_id),
  constraint card_account_settlements_payment_key unique (user_id, payment_entry_id),
  constraint card_account_settlements_payment_user_fkey
    foreign key (payment_entry_id, user_id)
    references public.card_invoice_payments(id, user_id) on delete restrict
);

create table public.card_purchase_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  transaction_id uuid not null,
  entry_kind text not null default 'purchase_credit',
  amount numeric(14,2) not null,
  effective_date date not null,
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
    check (
      amount > 0
      and amount <= 999999999999.99
      and amount = round(amount, 2)
      and amount < 'Infinity'::numeric
    ),
  constraint card_purchase_credits_effective_date_check
    check (isfinite(effective_date)),
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
create index card_billing_cycles_user_card_cycle_idx
  on public.card_billing_cycles(user_id, card_id, cycle_key desc);
create index card_installment_series_user_card_date_idx
  on public.card_installment_series(user_id, card_id, purchase_date desc);
create index transactions_user_cycle_date_card_idx
  on public.transactions(user_id, card_billing_cycle_id, transaction_date, card_id)
  where card_billing_cycle_id is not null;
create index card_invoice_payments_user_cycle_date_idx
  on public.card_invoice_payments(user_id, billing_cycle_id, effective_date);
create index card_invoice_payments_user_account_date_idx
  on public.card_invoice_payments(user_id, source_account_id, effective_date);
create index card_payment_allocations_user_cycle_idx
  on public.card_payment_allocations(user_id, billing_cycle_id, payment_entry_id);
create index card_account_settlements_user_payment_idx
  on public.card_account_settlements(user_id, payment_entry_id);
create index card_purchase_credits_user_transaction_idx
  on public.card_purchase_credits(user_id, transaction_id);

alter table public.card_installment_series enable row level security;
alter table public.card_billing_cycles enable row level security;
alter table public.card_invoice_payments enable row level security;
alter table public.card_payment_allocations enable row level security;
alter table public.card_account_settlements enable row level security;
alter table public.card_purchase_credits enable row level security;

revoke all on table public.card_installment_series from public, anon, authenticated;
revoke all on table public.card_billing_cycles from public, anon, authenticated;
revoke all on table public.card_invoice_payments from public, anon, authenticated;
revoke all on table public.card_payment_allocations from public, anon, authenticated;
revoke all on table public.card_account_settlements from public, anon, authenticated;
revoke all on table public.card_purchase_credits from public, anon, authenticated;

grant select on table public.card_installment_series to authenticated;
grant select on table public.card_billing_cycles to authenticated;
grant select on table public.card_invoice_payments to authenticated;
grant select on table public.card_payment_allocations to authenticated;
grant select on table public.card_account_settlements to authenticated;
grant select on table public.card_purchase_credits to authenticated;

create policy card_installment_series_select_own
  on public.card_installment_series for select to authenticated
  using ((select auth.uid()) = user_id);
create policy card_billing_cycles_select_own
  on public.card_billing_cycles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy card_invoice_payments_select_own
  on public.card_invoice_payments for select to authenticated
  using ((select auth.uid()) = user_id);
create policy card_payment_allocations_select_own
  on public.card_payment_allocations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy card_account_settlements_select_own
  on public.card_account_settlements for select to authenticated
  using ((select auth.uid()) = user_id);
create policy card_purchase_credits_select_own
  on public.card_purchase_credits for select to authenticated
  using ((select auth.uid()) = user_id);

create function billing_private.clamped_month_day_v1(p_month date, p_day integer)
returns date
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select make_date(
    extract(year from date_trunc('month', p_month))::integer,
    extract(month from date_trunc('month', p_month))::integer,
    least(
      p_day,
      extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer
    )
  )
$$;

create function billing_private.card_cycle_dates_v1(
  p_purchase_date date,
  p_closing_day integer,
  p_due_day integer
)
returns table (
  cycle_key date,
  cycle_start_date date,
  closing_date date,
  due_date date
)
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  v_purchase_month date := date_trunc('month', p_purchase_date)::date;
  v_closing_date date;
  v_due_date date;
  v_previous_closing date;
begin
  if not isfinite(p_purchase_date)
     or p_closing_day not between 1 and 31
     or p_due_day not between 1 and 31 then
    raise exception 'invalid card calendar input' using errcode = '22023';
  end if;

  v_closing_date := billing_private.clamped_month_day_v1(v_purchase_month, p_closing_day);
  if p_purchase_date > v_closing_date then
    v_closing_date := billing_private.clamped_month_day_v1(
      (v_purchase_month + interval '1 month')::date,
      p_closing_day
    );
  end if;

  v_due_date := billing_private.clamped_month_day_v1(v_closing_date, p_due_day);
  if v_due_date < v_closing_date then
    v_due_date := billing_private.clamped_month_day_v1(
      (date_trunc('month', v_closing_date) + interval '1 month')::date,
      p_due_day
    );
  end if;

  v_previous_closing := billing_private.clamped_month_day_v1(
    (date_trunc('month', v_closing_date) - interval '1 month')::date,
    p_closing_day
  );

  return query select
    date_trunc('month', v_due_date)::date,
    (v_previous_closing + 1)::date,
    v_closing_date,
    v_due_date;
end
$$;

create function billing_private.guard_cycle_insert_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_expected_close date;
  v_expected_due date;
  v_expected_previous_close date;
begin
  v_expected_close := billing_private.clamped_month_day_v1(
    new.closing_date,
    new.closing_day_snapshot
  );
  v_expected_due := billing_private.clamped_month_day_v1(
    new.closing_date,
    new.due_day_snapshot
  );
  if v_expected_due < new.closing_date then
    v_expected_due := billing_private.clamped_month_day_v1(
      (date_trunc('month', new.closing_date) + interval '1 month')::date,
      new.due_day_snapshot
    );
  end if;
  v_expected_previous_close := billing_private.clamped_month_day_v1(
    (date_trunc('month', new.closing_date) - interval '1 month')::date,
    new.closing_day_snapshot
  );

  if new.closing_date <> v_expected_close
     or new.due_date <> v_expected_due
     or new.cycle_start_date <> v_expected_previous_close + 1
     or new.cycle_key <> date_trunc('month', new.due_date)::date then
    raise exception 'card billing cycle calendar contract mismatch'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger card_billing_cycles_calendar_guard_v1
before insert on public.card_billing_cycles
for each row execute function billing_private.guard_cycle_insert_v1();

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
before update or delete on public.card_billing_cycles
for each row execute function billing_private.reject_cycle_update_v1();

create trigger card_installment_series_immutable_v1
before update or delete on public.card_installment_series
for each row execute function billing_private.reject_cycle_update_v1();

create function billing_private.guard_transaction_cycle_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_user uuid := auth.uid();
  v_requested_structured_write boolean;
  v_old_cycle public.card_billing_cycles%rowtype;
  v_new_cycle public.card_billing_cycles%rowtype;
  v_series public.card_installment_series%rowtype;
  v_has_ledger boolean := false;
begin
  v_requested_structured_write := case
    when tg_op = 'INSERT' then
      new.card_billing_cycle_id is not null
      or new.installment_total is not null
    else
      new.card_billing_cycle_id is distinct from old.card_billing_cycle_id
      or new.installment_total is distinct from old.installment_total
    end;

  if v_auth_user is not null
     and v_requested_structured_write
     and not exists (
       select 1
       from billing_private.writer_context_v1 context
       where context.transaction_id = txid_current()
         and context.user_id = v_auth_user
         and context.purpose in ('structure_purchase', 'create_installments')
     ) then
    raise exception 'structured card billing writer is not activated for direct transaction DML'
      using errcode = '42501';
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
           or new.purchase_date is distinct from old.purchase_date
           or new.transaction_type is distinct from old.transaction_type
           or new.amount is distinct from old.amount
           or new.status is distinct from old.status then
          raise exception 'settled card purchase is immutable; use an explicit compensating operation'
            using errcode = '23514';
        end if;
      elsif new.card_id is distinct from old.card_id
         or new.transaction_date is distinct from old.transaction_date
         or new.purchase_date is distinct from old.purchase_date
         or new.transaction_type is distinct from old.transaction_type then
        -- Preserve the canonical transaction_date exactly as supplied by the
        -- legacy writer. Membership is cleared, never recalculated here.
        new.card_billing_cycle_id := null;
      end if;
    end if;

    if old.installment_series_id is not null
       and exists (
         select 1 from public.card_installment_series s
         where s.id = old.installment_series_id and s.user_id = old.user_id
       )
       and (
         new.installment_series_id is distinct from old.installment_series_id
         or new.installment_number is distinct from old.installment_number
         or new.installment_total is distinct from old.installment_total
         or new.purchase_date is distinct from old.purchase_date
         or new.card_id is distinct from old.card_id
         or new.transaction_date is distinct from old.transaction_date
         or new.transaction_type is distinct from old.transaction_type
         or new.amount is distinct from old.amount
       ) then
      raise exception 'structured installment financial identity is immutable'
        using errcode = '23514';
    end if;
  end if;

  if new.installment_total is not null then
    select * into strict v_series
    from public.card_installment_series
    where id = new.installment_series_id
      and user_id = new.user_id
      and card_id = new.card_id;

    if (
      new.transaction_type <> 'despesa'
      or new.purchase_date is distinct from v_series.purchase_date
      or new.installment_total is distinct from v_series.installment_total
      or new.installment_number not between 1 and v_series.installment_total
      or new.amount is null
      or new.amount <> round(new.amount, 2)
      or not (new.amount > 0 and new.amount <= 999999999999.99 and new.amount < 'Infinity'::numeric)
    ) then
      raise exception 'structured installment transaction contract mismatch'
        using errcode = '23514';
    end if;
  end if;

  if new.card_billing_cycle_id is null then return new; end if;
  if new.card_id is null
     or new.transaction_type <> 'despesa'
     or new.transaction_date is null
     or not isfinite(new.transaction_date)
     or new.amount is null
     or not (
       new.amount > 0
       and new.amount <= 999999999999.99
       and new.amount = round(new.amount, 2)
       and new.amount < 'Infinity'::numeric
     ) then
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
     or v_new_cycle.cycle_key <> date_trunc('month', new.transaction_date)::date
     or v_new_cycle.due_date <> new.transaction_date
     or (
       new.installment_total is null
       and (
         new.purchase_date is null
         or not isfinite(new.purchase_date)
         or new.purchase_date < v_new_cycle.cycle_start_date
         or new.purchase_date > v_new_cycle.closing_date
       )
     ) then
    raise exception 'transaction and billing cycle contract mismatch' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger transactions_guard_card_cycle_v1
before insert or update of card_billing_cycle_id, user_id, card_id, transaction_date,
  transaction_type, amount, status, purchase_date, installment_series_id,
  installment_number, installment_total
on public.transactions
for each row execute function billing_private.guard_transaction_cycle_v1();

create function billing_private.guard_linked_transaction_delete_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_has_ledger boolean;
begin
  if old.installment_series_id is not null
     and exists (
       select 1 from public.card_installment_series s
       where s.id = old.installment_series_id and s.user_id = old.user_id
     ) then
    raise exception 'structured installment transaction cannot be deleted'
      using errcode = '23514';
  end if;

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

create trigger card_invoice_payments_guard_insert_v1
before insert on public.card_invoice_payments
for each row execute function billing_private.guard_payment_insert_v1();

create function billing_private.guard_payment_allocation_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payment public.card_invoice_payments%rowtype;
  v_original_allocation public.card_payment_allocations%rowtype;
  v_outstanding numeric;
  v_credit_balance numeric;
begin
  select * into strict v_payment
  from public.card_invoice_payments
  where id = new.payment_entry_id and user_id = new.user_id
  for key share;

  if v_payment.billing_cycle_id <> new.billing_cycle_id
     or v_payment.amount <> new.amount then
    raise exception 'V1 payment allocation must exactly match one payment and one cycle'
      using errcode = '23514';
  end if;

  perform 1 from public.card_billing_cycles
  where id = new.billing_cycle_id and user_id = new.user_id
  for update;

  if v_payment.entry_kind = 'payment' then
    select outstanding_amount, credit_balance
    into strict v_outstanding, v_credit_balance
    from public.card_invoice_balances_v1
    where id = new.billing_cycle_id and user_id = new.user_id;

    if v_credit_balance > 0 then
      raise exception 'CREDIT_BALANCE_REVIEW_REQUIRED' using errcode = '23514';
    end if;
    if new.amount > v_outstanding then
      raise exception 'payment exceeds invoice outstanding amount'
        using errcode = '23514';
    end if;
  else
    select a.* into strict v_original_allocation
    from public.card_payment_allocations a
    where a.payment_entry_id = v_payment.reversal_of_id
      and a.user_id = new.user_id;

    if v_original_allocation.billing_cycle_id <> new.billing_cycle_id
       or v_original_allocation.amount <> new.amount
       or not exists (
         select 1 from public.card_account_settlements s
         where s.payment_entry_id = v_payment.reversal_of_id
           and s.user_id = new.user_id
       ) then
      raise exception 'payment reversal allocation must compensate a completed payment'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger card_payment_allocations_guard_insert_v1
before insert on public.card_payment_allocations
for each row execute function billing_private.guard_payment_allocation_insert_v1();

create function billing_private.guard_account_settlement_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.card_invoice_payments p
    join public.card_payment_allocations a
      on a.payment_entry_id = p.id and a.user_id = p.user_id
    where p.id = new.payment_entry_id and p.user_id = new.user_id
      and a.billing_cycle_id = p.billing_cycle_id
      and a.amount = p.amount
  ) then
    raise exception 'account settlement requires one coherent V1 payment allocation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger card_account_settlements_guard_insert_v1
before insert on public.card_account_settlements
for each row execute function billing_private.guard_account_settlement_insert_v1();

create function billing_private.assert_payment_complete_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_allocations integer;
  v_settlements integer;
begin
  select count(*) into v_allocations
  from public.card_payment_allocations
  where user_id = new.user_id and payment_entry_id = new.id;
  select count(*) into v_settlements
  from public.card_account_settlements
  where user_id = new.user_id and payment_entry_id = new.id;

  if v_allocations <> 1 or v_settlements <> 1 then
    raise exception 'card payment must commit with exactly one allocation and one account settlement'
      using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger card_invoice_payments_complete_v1
after insert on public.card_invoice_payments
deferrable initially deferred
for each row execute function billing_private.assert_payment_complete_v1();

create function billing_private.guard_purchase_credit_insert_v1()
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

create trigger card_payment_allocations_append_only_v1
before update or delete on public.card_payment_allocations
for each row execute function billing_private.reject_ledger_mutation_v1();

create trigger card_account_settlements_append_only_v1
before update or delete on public.card_account_settlements
for each row execute function billing_private.reject_ledger_mutation_v1();

create trigger card_purchase_credits_append_only_v1
before update or delete on public.card_purchase_credits
for each row execute function billing_private.reject_ledger_mutation_v1();

create function billing_private.assert_installment_series_complete_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_series_id uuid;
  v_series public.card_installment_series%rowtype;
  v_count integer;
  v_min integer;
  v_max integer;
  v_sum numeric;
  v_first_cycle public.card_billing_cycles%rowtype;
  v_bad integer;
begin
  if tg_table_name = 'card_installment_series' then
    v_series_id := new.id;
  elsif tg_op = 'DELETE' then
    v_series_id := old.installment_series_id;
  else
    v_series_id := new.installment_series_id;
  end if;

  if v_series_id is null then return null; end if;
  select * into v_series
  from public.card_installment_series
  where id = v_series_id;
  if not found then return null; end if;

  select count(*), min(t.installment_number), max(t.installment_number), sum(t.amount)
  into v_count, v_min, v_max, v_sum
  from public.transactions t
  where t.installment_series_id = v_series.id and t.user_id = v_series.user_id;

  if v_count <> v_series.installment_total
     or v_min <> 1
     or v_max <> v_series.installment_total
     or v_sum <> v_series.original_amount then
    raise exception 'structured installment series must contain the complete cent-exact sequence'
      using errcode = '23514';
  end if;

  select cy.* into strict v_first_cycle
  from public.transactions t
  join public.card_billing_cycles cy
    on cy.id = t.card_billing_cycle_id and cy.user_id = t.user_id
  where t.installment_series_id = v_series.id
    and t.user_id = v_series.user_id
    and t.installment_number = 1;

  select count(*) into v_bad
  from public.transactions t
  left join public.card_billing_cycles cy
    on cy.id = t.card_billing_cycle_id and cy.user_id = t.user_id
  where t.installment_series_id = v_series.id
    and t.user_id = v_series.user_id
    and (
      t.card_id is distinct from v_series.card_id
      or t.purchase_date is distinct from v_series.purchase_date
      or t.installment_total is distinct from v_series.installment_total
      or t.transaction_type <> 'despesa'
      or cy.id is null
      or cy.card_id is distinct from v_series.card_id
      or cy.closing_day_snapshot is distinct from v_first_cycle.closing_day_snapshot
      or cy.due_day_snapshot is distinct from v_first_cycle.due_day_snapshot
      or cy.closing_date is distinct from billing_private.clamped_month_day_v1(
        (date_trunc('month', v_first_cycle.closing_date)
          + make_interval(months => t.installment_number - 1))::date,
        v_first_cycle.closing_day_snapshot
      )
      or t.transaction_date is distinct from cy.due_date
    );

  if v_bad <> 0 then
    raise exception 'structured installment series calendar or ownership invariant failed'
      using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger card_installment_series_complete_v1
after insert on public.card_installment_series
deferrable initially deferred
for each row execute function billing_private.assert_installment_series_complete_v1();

create constraint trigger transactions_installment_series_complete_v1
after insert or update or delete on public.transactions
deferrable initially deferred
for each row execute function billing_private.assert_installment_series_complete_v1();

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

create view public.card_account_settlement_effects_v1
with (security_invoker = true)
as
select s.id as settlement_id,
       s.user_id,
       p.id as payment_entry_id,
       a.billing_cycle_id,
       p.source_account_id as account_id,
       p.operation_id,
       p.effective_date,
       case when p.entry_kind = 'payment' then 'decrease' else 'increase' end::text as direction,
       p.amount,
       case when p.entry_kind = 'payment' then -p.amount else p.amount end::numeric as account_delta,
       0::numeric as consumption_expense_delta
from public.card_account_settlements s
join public.card_invoice_payments p
  on p.id = s.payment_entry_id and p.user_id = s.user_id
join public.card_payment_allocations a
  on a.payment_entry_id = p.id and a.user_id = p.user_id;

create view public.card_purchase_credit_effects_v1
with (security_invoker = true)
as
select c.id as credit_entry_id,
       c.user_id,
       c.transaction_id,
       t.card_id,
       t.card_billing_cycle_id as billing_cycle_id,
       c.operation_id,
       c.effective_date,
       c.entry_kind,
       c.amount,
       case when c.entry_kind = 'purchase_credit' then -c.amount else c.amount end::numeric
         as consumption_expense_delta,
       t.category,
       t.subcategory
from public.card_purchase_credits c
join public.transactions t
  on t.id = c.transaction_id and t.user_id = c.user_id;

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

create function billing_private.ensure_cycle_by_closing_month_v1(
  p_user_id uuid,
  p_card_id uuid,
  p_closing_day integer,
  p_due_day integer,
  p_closing_month date
)
returns public.card_billing_cycles
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_closing_date date;
  v_due_date date;
  v_previous_closing date;
  v_cycle public.card_billing_cycles%rowtype;
begin
  if p_closing_month is null
     or not isfinite(p_closing_month)
     or p_closing_month <> date_trunc('month', p_closing_month)::date
     or p_closing_day not between 1 and 31
     or p_due_day not between 1 and 31 then
    raise exception 'invalid frozen card cycle input' using errcode = '22023';
  end if;

  v_closing_date := billing_private.clamped_month_day_v1(
    p_closing_month,
    p_closing_day
  );
  v_due_date := billing_private.clamped_month_day_v1(
    p_closing_month,
    p_due_day
  );
  if v_due_date < v_closing_date then
    v_due_date := billing_private.clamped_month_day_v1(
      (p_closing_month + interval '1 month')::date,
      p_due_day
    );
  end if;
  v_previous_closing := billing_private.clamped_month_day_v1(
    (p_closing_month - interval '1 month')::date,
    p_closing_day
  );

  insert into public.card_billing_cycles(
    user_id, card_id, cycle_key,
    closing_day_snapshot, due_day_snapshot,
    cycle_start_date, closing_date, due_date
  ) values (
    p_user_id, p_card_id, date_trunc('month', v_due_date)::date,
    p_closing_day, p_due_day,
    v_previous_closing + 1, v_closing_date, v_due_date
  )
  on conflict (user_id, card_id, closing_date) do nothing
  returning * into v_cycle;

  if not found then
    select * into strict v_cycle
    from public.card_billing_cycles
    where user_id = p_user_id
      and card_id = p_card_id
      and closing_date = v_closing_date
    for key share;
    if v_cycle.cycle_key <> date_trunc('month', v_due_date)::date
       or v_cycle.closing_day_snapshot <> p_closing_day
       or v_cycle.due_day_snapshot <> p_due_day
       or v_cycle.cycle_start_date <> v_previous_closing + 1
       or v_cycle.due_date <> v_due_date then
      raise exception 'existing frozen cycle conflicts with the requested calendar'
        using errcode = '23514';
    end if;
  end if;
  return v_cycle;
end
$$;

create function billing_private.ensure_cycle_for_purchase_v1(
  p_user_id uuid,
  p_card_id uuid,
  p_purchase_date date
)
returns public.card_billing_cycles
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_closing_day integer;
  v_due_day integer;
  v_dates record;
  v_cycle public.card_billing_cycles%rowtype;
begin
  select closing_day, due_day into v_closing_day, v_due_day
  from public.cards
  where id = p_card_id and user_id = p_user_id
  for key share;
  if not found then
    raise exception 'card ownership mismatch' using errcode = '42501';
  end if;
  if p_purchase_date is null or not isfinite(p_purchase_date)
     or v_closing_day is null or v_due_day is null
     or v_closing_day not between 1 and 31
     or v_due_day not between 1 and 31 then
    raise exception 'card calendar requires valid closing and due days'
      using errcode = '22023';
  end if;

  select * into strict v_dates
  from billing_private.card_cycle_dates_v1(
    p_purchase_date,
    v_closing_day,
    v_due_day
  );

  v_cycle := billing_private.ensure_cycle_by_closing_month_v1(
    p_user_id,
    p_card_id,
    v_closing_day,
    v_due_day,
    date_trunc('month', v_dates.closing_date)::date
  );
  return v_cycle;
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
  v_tx public.transactions%rowtype;
  v_cycle public.card_billing_cycles%rowtype;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into strict v_tx
  from public.transactions
  where id = p_transaction_id and user_id = v_user
  for update;

  if v_tx.card_billing_cycle_id is not null then
    select * into strict v_cycle
    from public.card_billing_cycles
    where id = v_tx.card_billing_cycle_id and user_id = v_user;
    return v_cycle;
  end if;
  if v_tx.transaction_type <> 'despesa'
     or v_tx.card_id is null
     or v_tx.purchase_date is null
     or v_tx.installment_series_id is not null
     or v_tx.installment_number is not null
     or coalesce(v_tx.status, '') = 'cancelado' then
    raise exception 'transaction is not an eligible card purchase'
      using errcode = '22023';
  end if;

  v_cycle := billing_private.ensure_cycle_for_purchase_v1(
    v_user,
    v_tx.card_id,
    v_tx.purchase_date
  );
  if v_tx.transaction_date <> v_cycle.due_date then
    raise exception 'transaction_date does not match the approved billing calendar; history was not changed'
      using errcode = '23514';
  end if;

  insert into billing_private.writer_context_v1(transaction_id, user_id, purpose)
  values (txid_current(), v_user, 'structure_purchase');
  update public.transactions
  set card_billing_cycle_id = v_cycle.id
  where id = v_tx.id and user_id = v_user;
  delete from billing_private.writer_context_v1
  where transaction_id = txid_current()
    and user_id = v_user
    and purpose = 'structure_purchase';
  return v_cycle;
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
  v_existing public.card_installment_series%rowtype;
  v_series public.card_installment_series%rowtype;
  v_cycle public.card_billing_cycles%rowtype;
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder bigint;
  v_part_cents bigint;
  v_number integer;
  v_first_cycle public.card_billing_cycles%rowtype;
  v_closing_month date;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_operation_id is null
     or p_card_id is null
     or p_purchase_date is null
     or not isfinite(p_purchase_date)
     or length(trim(coalesce(p_description, ''))) not between 1 and 240
     or p_status is null
     or p_status not in ('realizado', 'pendente', 'programado')
     or p_installment_total is null
     or p_installment_total not between 1 and 120
     or p_original_amount is null
     or not (
       p_original_amount > 0
       and p_original_amount <= 999999999999.99
       and p_original_amount = round(p_original_amount, 2)
       and p_original_amount < 'Infinity'::numeric
       and p_original_amount * 100 >= p_installment_total
     ) then
    raise exception 'invalid structured installment input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || ':card-installment:' || p_operation_id::text, 0)
  );
  select * into v_existing
  from public.card_installment_series
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    if v_existing.card_id <> p_card_id
       or v_existing.purchase_date <> p_purchase_date
       or v_existing.description <> trim(p_description)
       or v_existing.category is distinct from nullif(trim(coalesce(p_category, '')), '')
       or v_existing.subcategory is distinct from nullif(trim(coalesce(p_subcategory, '')), '')
       or v_existing.initial_status <> p_status
       or v_existing.installment_total <> p_installment_total
       or v_existing.original_amount <> p_original_amount then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  perform 1 from public.cards
  where id = p_card_id and user_id = v_user
  for key share;
  if not found then
    raise exception 'card not found' using errcode = '23503';
  end if;

  insert into public.card_installment_series(
    user_id, card_id, operation_id, purchase_date, description,
    category, subcategory, initial_status, installment_total,
    original_amount, origin_kind
  ) values (
    v_user, p_card_id, p_operation_id, p_purchase_date, trim(p_description),
    nullif(trim(coalesce(p_category, '')), ''),
    nullif(trim(coalesce(p_subcategory, '')), ''),
    p_status, p_installment_total, p_original_amount, 'new_card_purchase'
  ) returning * into v_series;

  insert into billing_private.writer_context_v1(transaction_id, user_id, purpose)
  values (txid_current(), v_user, 'create_installments');

  v_total_cents := (p_original_amount * 100)::bigint;
  v_base_cents := v_total_cents / p_installment_total;
  v_remainder := v_total_cents % p_installment_total;
  v_first_cycle := billing_private.ensure_cycle_for_purchase_v1(
    v_user,
    p_card_id,
    p_purchase_date
  );

  for v_number in 1..p_installment_total loop
    v_closing_month := (
      date_trunc('month', v_first_cycle.closing_date)
      + make_interval(months => v_number - 1)
    )::date;
    v_cycle := billing_private.ensure_cycle_by_closing_month_v1(
      v_user,
      p_card_id,
      v_first_cycle.closing_day_snapshot,
      v_first_cycle.due_day_snapshot,
      v_closing_month
    );
    v_part_cents := v_base_cents
      + case when v_number = p_installment_total then v_remainder else 0 end;

    insert into public.transactions(
      user_id, transaction_date, purchase_date, description,
      category, subcategory, amount, transaction_type, status, card_id,
      installment_series_id, installment_number, installment_total,
      card_billing_cycle_id
    ) values (
      v_user, v_cycle.due_date, p_purchase_date, trim(p_description),
      v_series.category, v_series.subcategory,
      (v_part_cents::numeric / 100)::numeric(14,2),
      'despesa', p_status, p_card_id,
      v_series.id, v_number, p_installment_total,
      v_cycle.id
    );
  end loop;

  delete from billing_private.writer_context_v1
  where transaction_id = txid_current()
    and user_id = v_user
    and purpose = 'create_installments';

  return v_series;
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
  v_cycle public.card_billing_cycles%rowtype;
  v_existing public.card_invoice_payments%rowtype;
  v_result public.card_invoice_payments%rowtype;
  v_allocation_id uuid;
  v_settlement_id uuid;
  v_outstanding numeric;
  v_credit_balance numeric;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_operation_id is null
     or p_amount is null
     or not (
       p_amount > 0
       and p_amount <= 999999999999.99
       and p_amount = round(p_amount, 2)
       and p_amount < 'Infinity'::numeric
     )
     or p_effective_date is null
     or not isfinite(p_effective_date) then
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
       or v_existing.effective_date <> p_effective_date then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    select a.id, s.id into strict v_allocation_id, v_settlement_id
    from public.card_payment_allocations a
    join public.card_account_settlements s
      on s.payment_entry_id = a.payment_entry_id and s.user_id = a.user_id
    where a.payment_entry_id = v_existing.id and a.user_id = v_user;
    select outstanding_amount into strict v_outstanding
    from public.card_invoice_balances_v1
    where id = v_existing.billing_cycle_id and user_id = v_user;
    return jsonb_build_object(
      'payment_entry_id', v_existing.id,
      'allocation_id', v_allocation_id,
      'settlement_id', v_settlement_id,
      'billing_cycle_id', v_existing.billing_cycle_id,
      'outstanding_amount', v_outstanding
    );
  end if;

  select * into strict v_cycle from public.card_billing_cycles
  where id = p_billing_cycle_id and user_id = v_user for update;
  perform 1 from public.accounts
  where id = p_source_account_id and user_id = v_user for update;
  if not found then raise exception 'source account not found' using errcode = '23503'; end if;

  select outstanding_amount, credit_balance into strict v_outstanding, v_credit_balance
  from public.card_invoice_balances_v1
  where id = v_cycle.id and user_id = v_user;
  if v_credit_balance > 0 then
    raise exception 'CREDIT_BALANCE_REVIEW_REQUIRED' using errcode = '23514';
  end if;
  if p_amount > v_outstanding then
    raise exception 'payment exceeds invoice outstanding amount' using errcode = '23514';
  end if;

  insert into public.card_invoice_payments(
    user_id, billing_cycle_id, source_account_id,
    entry_kind, amount, effective_date, operation_id
  ) values (
    v_user, v_cycle.id, p_source_account_id,
    'payment', p_amount, p_effective_date, p_operation_id
  ) returning * into v_result;

  insert into public.card_payment_allocations(
    user_id, payment_entry_id, billing_cycle_id, amount
  ) values (
    v_user, v_result.id, v_cycle.id, p_amount
  ) returning id into v_allocation_id;

  insert into public.card_account_settlements(user_id, payment_entry_id)
  values (v_user, v_result.id)
  returning id into v_settlement_id;

  select outstanding_amount into strict v_outstanding
  from public.card_invoice_balances_v1
  where id = v_cycle.id and user_id = v_user;
  return jsonb_build_object(
    'payment_entry_id', v_result.id,
    'allocation_id', v_allocation_id,
    'settlement_id', v_settlement_id,
    'billing_cycle_id', v_cycle.id,
    'outstanding_amount', v_outstanding
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
  v_original public.card_invoice_payments%rowtype;
  v_existing public.card_invoice_payments%rowtype;
  v_result public.card_invoice_payments%rowtype;
  v_allocation_id uuid;
  v_settlement_id uuid;
  v_outstanding numeric;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_operation_id is null
     or p_effective_date is null
     or not isfinite(p_effective_date)
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
       or v_existing.effective_date <> p_effective_date
       or v_existing.reason_code <> trim(p_reason_code) then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    select a.id, s.id into strict v_allocation_id, v_settlement_id
    from public.card_payment_allocations a
    join public.card_account_settlements s
      on s.payment_entry_id = a.payment_entry_id and s.user_id = a.user_id
    where a.payment_entry_id = v_existing.id and a.user_id = v_user;
    select outstanding_amount into strict v_outstanding
    from public.card_invoice_balances_v1
    where id = v_existing.billing_cycle_id and user_id = v_user;
    return jsonb_build_object(
      'payment_entry_id', v_existing.id,
      'allocation_id', v_allocation_id,
      'settlement_id', v_settlement_id,
      'billing_cycle_id', v_existing.billing_cycle_id,
      'outstanding_amount', v_outstanding
    );
  end if;

  select * into strict v_original from public.card_invoice_payments
  where id = p_payment_id and user_id = v_user and entry_kind = 'payment';
  perform 1 from public.card_billing_cycles
  where id = v_original.billing_cycle_id and user_id = v_user for update;

  insert into public.card_invoice_payments(
    user_id, billing_cycle_id, source_account_id, entry_kind,
    amount, effective_date, operation_id, reversal_of_id, reason_code
  ) values (
    v_user, v_original.billing_cycle_id, v_original.source_account_id,
    'payment_reversal', v_original.amount,
    p_effective_date, p_operation_id, v_original.id, trim(p_reason_code)
  ) returning * into v_result;

  insert into public.card_payment_allocations(
    user_id, payment_entry_id, billing_cycle_id, amount
  ) values (
    v_user, v_result.id, v_original.billing_cycle_id, v_original.amount
  ) returning id into v_allocation_id;

  insert into public.card_account_settlements(user_id, payment_entry_id)
  values (v_user, v_result.id)
  returning id into v_settlement_id;

  select outstanding_amount into strict v_outstanding
  from public.card_invoice_balances_v1
  where id = v_original.billing_cycle_id and user_id = v_user;
  return jsonb_build_object(
    'payment_entry_id', v_result.id,
    'allocation_id', v_allocation_id,
    'settlement_id', v_settlement_id,
    'billing_cycle_id', v_original.billing_cycle_id,
    'outstanding_amount', v_outstanding
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
  v_tx public.transactions%rowtype;
  v_existing public.card_purchase_credits%rowtype;
  v_result public.card_purchase_credits%rowtype;
  v_credited numeric;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_operation_id is null
     or p_amount is null
     or not (
       p_amount > 0
       and p_amount <= 999999999999.99
       and p_amount = round(p_amount, 2)
       and p_amount < 'Infinity'::numeric
     )
     or p_effective_date is null
     or not isfinite(p_effective_date)
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
       or v_existing.effective_date <> p_effective_date
       or v_existing.reason_code <> trim(p_reason_code) then
      raise exception 'operation_id payload mismatch' using errcode = '23505';
    end if;
    return v_existing;
  end if;

  select * into strict v_tx from public.transactions
  where id = p_transaction_id and user_id = v_user for update;
  if v_tx.transaction_type <> 'despesa' or v_tx.card_id is null
     or v_tx.card_billing_cycle_id is null or v_tx.status <> 'realizado'
     or p_effective_date < v_tx.transaction_date then
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
    amount, effective_date, operation_id, reason_code
  ) values (
    v_user, v_tx.id, 'purchase_credit', p_amount,
    p_effective_date, p_operation_id, trim(p_reason_code)
  ) returning * into v_result;
  return v_result;
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
  v_original public.card_purchase_credits%rowtype;
  v_transaction public.transactions%rowtype;
  v_existing public.card_purchase_credits%rowtype;
  v_result public.card_purchase_credits%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_operation_id is null
     or p_effective_date is null
     or not isfinite(p_effective_date)
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
       or v_existing.effective_date <> p_effective_date
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
    amount, effective_date, operation_id, reversal_of_id, reason_code
  ) values (
    v_user, v_original.transaction_id, 'credit_reversal', v_original.amount,
    p_effective_date, p_operation_id, v_original.id, trim(p_reason_code)
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

revoke all on function billing_private.guard_transaction_cycle_v1() from public, anon, authenticated;
revoke all on function billing_private.guard_linked_transaction_delete_v1() from public, anon, authenticated;
revoke all on function billing_private.reject_cycle_update_v1() from public, anon, authenticated;
revoke all on function billing_private.clamped_month_day_v1(date, integer) from public, anon, authenticated;
revoke all on function billing_private.card_cycle_dates_v1(date, integer, integer) from public, anon, authenticated;
revoke all on function billing_private.guard_cycle_insert_v1() from public, anon, authenticated;
revoke all on function billing_private.ensure_cycle_by_closing_month_v1(uuid, uuid, integer, integer, date) from public, anon, authenticated;
revoke all on function billing_private.ensure_cycle_for_purchase_v1(uuid, uuid, date) from public, anon, authenticated;
revoke all on function billing_private.guard_payment_insert_v1() from public, anon, authenticated;
revoke all on function billing_private.guard_payment_allocation_insert_v1() from public, anon, authenticated;
revoke all on function billing_private.guard_account_settlement_insert_v1() from public, anon, authenticated;
revoke all on function billing_private.assert_payment_complete_v1() from public, anon, authenticated;
revoke all on function billing_private.guard_purchase_credit_insert_v1() from public, anon, authenticated;
revoke all on function billing_private.reject_ledger_mutation_v1() from public, anon, authenticated;
revoke all on function billing_private.assert_installment_series_complete_v1() from public, anon, authenticated;

revoke all on function public.structure_my_card_purchase_v1(uuid) from public, anon, authenticated;
revoke all on function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid) from public, anon, authenticated;
revoke all on function public.reverse_my_card_payment_v1(uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text) from public, anon, authenticated;
revoke all on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function public.get_my_card_billing_summary_v1(uuid) from public, anon, authenticated;

-- Shadow mode: mutation RPCs deliberately remain non-executable by authenticated
-- clients until a separately approved Beta activation validates the read adapter,
-- balance_as_of handling and shadow comparisons against authenticated data.
grant execute on function public.get_my_card_billing_summary_v1(uuid) to authenticated;

grant select on public.card_invoice_balances_v1 to authenticated;
grant select on public.card_account_settlement_effects_v1 to authenticated;
grant select on public.card_purchase_credit_effects_v1 to authenticated;
grant select on public.card_billing_shadow_comparison_v1 to authenticated;
grant select on public.card_managed_limit_positions_v1 to authenticated;
revoke all on public.card_invoice_balances_v1 from public, anon;
revoke all on public.card_account_settlement_effects_v1 from public, anon;
revoke all on public.card_purchase_credit_effects_v1 from public, anon;
revoke all on public.card_billing_shadow_comparison_v1 from public, anon;
revoke all on public.card_managed_limit_positions_v1 from public, anon;

comment on table public.card_installment_series is
  'Immutable identity for new structured installments; legacy text is never inferred.';
comment on table public.card_billing_cycles is
  'Frozen card invoice cycle metadata; no economic expense is recorded here.';
comment on table public.card_invoice_payments is
  'Immutable settlement ledger. Payments are patrimonial settlement, never consumption expense.';
comment on table public.card_payment_allocations is
  'Append-only V1 mono-cycle allocations; exactly one allocation per payment entry.';
comment on table public.card_account_settlements is
  'Explicit append-only account settlement marker for a completed payment entry.';
comment on table public.card_purchase_credits is
  'Immutable purchase-credit ledger; economic effect belongs to effective_date, never the original purchase month.';
comment on column public.transactions.card_billing_cycle_id is
  'Explicit invoice membership. Nullable during the legacy transition; never backfilled by inference.';
comment on view public.card_billing_shadow_comparison_v1 is
  'Read-only coverage comparison by canonical transaction month; never infers or reclassifies a billing cycle.';
comment on view public.card_managed_limit_positions_v1 is
  'AVIORA-managed estimate only; NULL whenever structural coverage or credit state cannot prove the number.';

commit;
