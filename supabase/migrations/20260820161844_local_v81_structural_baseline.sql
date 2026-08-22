-- LOCAL-ONLY structural baseline reconstructed from the previously audited catalog.
-- It intentionally contains no production data and only the tables needed by V82 tests.

do $baseline_guard$
begin
  if to_regclass('public.transactions') is not null or to_regclass('public.accounts') is not null then
    raise exception 'local V81 baseline refuses to run against an existing application schema';
  end if;
end
$baseline_guard$;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  institution text,
  account_type text not null default 'checking',
  opening_balance numeric not null default 0,
  statement_balance numeric,
  last_reconciled_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  institution text,
  brand text,
  "limit" numeric not null default 0,
  closing_day integer,
  due_day integer,
  note text,
  created_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target numeric not null default 0,
  current numeric not null default 0,
  deadline date,
  cadence text default 'monthly',
  note text,
  created_at timestamptz not null default now(),
  unique (id,user_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  asset_type text not null default 'investment',
  institution text,
  cost_basis numeric not null default 0,
  current_value numeric not null default 0,
  quantity numeric,
  liquidity text default 'medium',
  updated_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create table public.liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  liability_type text not null default 'loan',
  principal numeric not null default 0,
  balance numeric not null default 0,
  interest_rate numeric not null default 0,
  monthly_payment numeric not null default 0,
  due_date date,
  note text,
  created_at timestamptz not null default now()
);

create table public.recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'expense',
  amount numeric not null default 0,
  category text,
  subcategory text,
  account_id uuid references public.accounts(id) on delete set null,
  card_id uuid references public.cards(id) on delete set null,
  frequency text not null default 'monthly',
  interval integer not null default 1,
  day_of_month integer,
  start_date date not null default current_date,
  next_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  auto_post boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  goal_id uuid,
  goal_effect text check (goal_effect is null or goal_effect in ('contribution','withdrawal')),
  unique (id,user_id),
  constraint recurring_goal_user_fkey foreign key (goal_id,user_id)
    references public.goals(id,user_id) on delete set null (goal_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_date date not null,
  description text not null,
  category text,
  amount numeric not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  account_id uuid references public.accounts(id) on delete set null,
  card_id uuid references public.cards(id) on delete set null,
  subcategory text,
  transaction_type text not null default 'despesa'
    check (transaction_type in ('receita','despesa','transferencia','investimento','resgate')),
  status text default 'realizado'
    check (status in ('realizado','pendente','cancelado')),
  payment_method text,
  note text,
  purchase_date date,
  goal_id uuid,
  goal_effect text check (goal_effect is null or goal_effect in ('contribution','withdrawal')),
  unique (id,user_id),
  constraint transactions_goal_user_fkey foreign key (goal_id,user_id)
    references public.goals(id,user_id) on delete set null (goal_id)
);

create index idx_accounts_user on public.accounts(user_id);
create index idx_cards_user on public.cards(user_id);
create index idx_assets_user on public.assets(user_id);
create index idx_liabilities_user on public.liabilities(user_id);
create index idx_recurring_user_goal_next_date on public.recurring(user_id,goal_id,next_date);
create index idx_transactions_user_date on public.transactions(user_id,transaction_date);
create index idx_transactions_user_goal_date on public.transactions(user_id,goal_id,transaction_date);

do $policies$
declare table_name text;
begin
  foreach table_name in array array['accounts','cards','goals','assets','liabilities','recurring','transactions']
  loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',
      table_name||'_own_rows',table_name
    );
    execute format('grant select,insert,update,delete on public.%I to authenticated',table_name);
  end loop;
end
$policies$;
