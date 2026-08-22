-- LOCAL PROPOSAL ONLY. Do not apply remotely without a dedicated production
-- preflight, backup, approval window and reconciliation of any unversioned
-- Kiwify/commercial objects. This migration is deliberately transactional.
begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(hashtextextended('mentoria-black:commercial-access-v1', 0));

do $preflight$
declare
  v_object text;
begin
  if to_regprocedure('auth.uid()') is null or to_regclass('auth.users') is null then
    raise exception 'commercial access v1 requires Supabase Auth' using errcode = 'P0001';
  end if;

  foreach v_object in array array[
    'products', 'product_components', 'commercial_offers', 'product_trials',
    'access_grants', 'billing_customers', 'billing_orders', 'billing_subscriptions',
    'payment_events'
  ] loop
    if to_regclass('public.' || v_object) is not null then
      raise exception
        'commercial access v1 found existing public.%: reconcile it explicitly before applying this proposal',
        v_object using errcode = 'P0001';
    end if;
  end loop;

  if to_regprocedure('public.has_active_access(text)') is not null
     or to_regprocedure('public.get_my_entitlements()') is not null
     or to_regprocedure('public.start_my_app_trial()') is not null then
    raise exception 'commercial access v1 found an existing access RPC; semantic reconciliation is required'
      using errcode = 'P0001';
  end if;
end
$preflight$;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  product_kind text not null,
  active boolean not null default true,
  public_sample_available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_code_format check (code = upper(code) and code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint products_kind_check check (product_kind in ('entitlement', 'bundle'))
);

create table public.product_components (
  bundle_product_id uuid not null references public.products(id) on delete restrict,
  component_product_id uuid not null references public.products(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (bundle_product_id, component_product_id),
  constraint product_components_not_self check (bundle_product_id <> component_product_id)
);

create table public.commercial_offers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  product_id uuid not null references public.products(id) on delete restrict,
  billing_mode text not null,
  billing_interval text,
  active boolean not null default false,
  provider text,
  external_offer_id text,
  knowledge_cancellation_policy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_offers_code_format check (code = upper(code) and code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint commercial_offers_billing_mode_check check (billing_mode in ('subscription', 'one_time')),
  constraint commercial_offers_interval_check check (
    (billing_mode = 'subscription' and billing_interval in ('month', 'year'))
    or (billing_mode = 'one_time' and billing_interval is null)
  ),
  constraint commercial_offers_provider_format check (
    provider is null or provider ~ '^[a-z][a-z0-9_-]{1,31}$'
  )
);

create table public.product_trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  state text not null,
  origin text not null default 'first_eligible_access',
  started_at timestamptz,
  expires_at timestamptz,
  converted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id),
  constraint product_trials_state_check check (state in ('eligible', 'active', 'expired', 'converted', 'revoked')),
  constraint product_trials_timeline_check check (
    (state = 'eligible' and started_at is null and expires_at is null)
    or (state <> 'eligible' and started_at is not null and expires_at = started_at + interval '168 hours')
  ),
  constraint product_trials_conversion_check check (converted_at is null or converted_at >= started_at),
  constraint product_trials_revocation_check check (revoked_at is null or revoked_at >= started_at)
);

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  access_type text not null,
  source_provider text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grace_until timestamptz,
  external_reference text,
  granted_by uuid references auth.users(id) on delete set null,
  administrative_reason text,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_grants_type_check check (access_type in ('paid', 'trial', 'manual', 'lifetime')),
  constraint access_grants_status_check check (status in ('active', 'grace_period', 'past_due', 'expired', 'revoked', 'refunded', 'chargeback')),
  constraint access_grants_provider_format check (source_provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint access_grants_interval_check check (expires_at is null or expires_at > starts_at),
  constraint access_grants_grace_check check (grace_until is null or grace_until >= starts_at),
  constraint access_grants_lifetime_check check (access_type <> 'lifetime' or expires_at is null),
  constraint access_grants_trial_source_check check (access_type <> 'trial' or source_provider = 'trial'),
  constraint access_grants_manual_audit_check check (
    access_type <> 'manual' or (source_provider = 'manual' and granted_by is not null)
  ),
  constraint access_grants_revocation_check check (revoked_at is null or revoked_at >= starts_at)
);

create unique index access_grants_provider_reference_uidx
  on public.access_grants(source_provider, external_reference, product_id)
  where external_reference is not null;
create unique index access_grants_one_trial_uidx
  on public.access_grants(user_id, product_id)
  where access_type = 'trial';
create index access_grants_user_product_status_idx
  on public.access_grants(user_id, product_id, status, starts_at, expires_at);
create index product_trials_user_idx on public.product_trials(user_id, product_id);

create table public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  environment text not null,
  external_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, environment, external_customer_id),
  unique (user_id, provider, environment),
  constraint billing_customers_provider_format check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint billing_customers_environment_check check (environment in ('sandbox', 'production'))
);

create table public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_id uuid not null references public.commercial_offers(id) on delete restrict,
  provider text not null,
  environment text not null,
  status text not null default 'created',
  external_checkout_id text,
  external_payment_id text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_orders_provider_format check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint billing_orders_environment_check check (environment in ('sandbox', 'production')),
  constraint billing_orders_status_check check (status in ('created', 'pending', 'confirmed', 'received', 'past_due', 'cancelled', 'refunded', 'chargeback', 'failed'))
);

create unique index billing_orders_payment_uidx
  on public.billing_orders(provider, environment, external_payment_id)
  where external_payment_id is not null;
create unique index billing_orders_subscription_uidx
  on public.billing_orders(provider, environment, external_subscription_id)
  where external_subscription_id is not null;
create index billing_orders_user_idx on public.billing_orders(user_id, created_at desc);

create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_id uuid not null references public.commercial_offers(id) on delete restrict,
  provider text not null,
  environment text not null,
  external_subscription_id text not null,
  status text not null,
  current_period_end timestamptz,
  grace_until timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, environment, external_subscription_id),
  constraint billing_subscriptions_provider_format check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint billing_subscriptions_environment_check check (environment in ('sandbox', 'production')),
  constraint billing_subscriptions_status_check check (status in ('active', 'grace_period', 'past_due', 'expired', 'revoked', 'refunded', 'chargeback', 'cancelled'))
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null,
  external_event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  payload_hash text not null,
  error_code text,
  external_customer_id text,
  external_payment_id text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  unique (provider, environment, external_event_id),
  constraint payment_events_provider_format check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint payment_events_environment_check check (environment in ('sandbox', 'production')),
  constraint payment_events_status_check check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  constraint payment_events_hash_check check (payload_hash ~ '^[0-9a-f]{64}$')
);

create index payment_events_status_received_idx on public.payment_events(status, received_at);
create index payment_events_external_payment_idx on public.payment_events(provider, environment, external_payment_id);

insert into public.products(code, name, product_kind, public_sample_available) values
  ('APP', 'Aplicativo financeiro Mentoria Black', 'entitlement', false),
  ('KNOWLEDGE', 'Área de Conhecimento Mentoria Black', 'entitlement', true),
  ('COMPLETE', 'Mentoria Black Completa', 'bundle', true);

insert into public.product_components(bundle_product_id, component_product_id)
select bundle.id, component.id
from public.products bundle
join public.products component on component.code in ('APP', 'KNOWLEDGE')
where bundle.code = 'COMPLETE';

insert into public.commercial_offers(
  code, product_id, billing_mode, billing_interval, active,
  knowledge_cancellation_policy
)
select offer.code, product.id, offer.billing_mode, offer.billing_interval, false,
       offer.knowledge_cancellation_policy
from (values
  ('APP_MONTHLY', 'APP', 'subscription', 'month', null::text),
  ('APP_ANNUAL', 'APP', 'subscription', 'year', null::text),
  ('KNOWLEDGE_LIFETIME', 'KNOWLEDGE', 'one_time', null::text, null::text),
  ('COMPLETE_MONTHLY', 'COMPLETE', 'subscription', 'month', 'COMMERCIAL_DECISION_REQUIRED'),
  ('COMPLETE_ANNUAL', 'COMPLETE', 'subscription', 'year', 'COMMERCIAL_DECISION_REQUIRED')
) as offer(code, product_code, billing_mode, billing_interval, knowledge_cancellation_policy)
join public.products product on product.code = offer.product_code;

create or replace function public.mb_commercial_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$$;

do $touch_triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'products', 'commercial_offers', 'product_trials', 'access_grants',
    'billing_customers', 'billing_orders', 'billing_subscriptions'
  ] loop
    execute format(
      'create trigger mb_commercial_touch_updated_at before update on public.%I '
      'for each row execute function public.mb_commercial_touch_updated_at()',
      v_table
    );
  end loop;
end
$touch_triggers$;

create or replace function public.mb_validate_commercial_grant_target()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_kind text;
begin
  select p.product_kind into v_kind from public.products p where p.id = new.product_id;
  if v_kind is distinct from 'entitlement' then
    raise exception 'grants must target entitlement products, not bundles' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger mb_validate_commercial_grant_target
before insert or update of product_id on public.access_grants
for each row execute function public.mb_validate_commercial_grant_target();

alter table public.products enable row level security;
alter table public.product_components enable row level security;
alter table public.commercial_offers enable row level security;
alter table public.product_trials enable row level security;
alter table public.access_grants enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_orders enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.payment_events enable row level security;

create policy mb_products_authenticated_read on public.products
for select to authenticated using (active);
create policy mb_product_components_authenticated_read on public.product_components
for select to authenticated using (true);
create policy mb_commercial_offers_authenticated_read on public.commercial_offers
for select to authenticated using (active);
create policy mb_product_trials_own_read on public.product_trials
for select to authenticated using ((select auth.uid()) = user_id);
create policy mb_access_grants_own_read on public.access_grants
for select to authenticated using ((select auth.uid()) = user_id);

revoke all privileges on table public.products, public.product_components,
  public.commercial_offers, public.product_trials, public.access_grants,
  public.billing_customers, public.billing_orders, public.billing_subscriptions,
  public.payment_events from public, anon, authenticated;
grant select on table public.products, public.product_components,
  public.commercial_offers, public.product_trials, public.access_grants to authenticated;

create or replace function public.has_active_access(p_product_code text)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.access_grants g
    join public.products p on p.id = g.product_id
    where g.user_id = (select auth.uid())
      and p.code = upper(trim(p_product_code))
      and p.product_kind = 'entitlement'
      and p.active
      and g.starts_at <= current_timestamp
      and (
        (g.status = 'active' and (g.expires_at is null or g.expires_at > current_timestamp))
        or (g.status = 'grace_period' and g.grace_until > current_timestamp)
      )
  )
$$;

create or replace function public.get_my_entitlements()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  with product_state as (
    select p.code,
           g.access_type,
           g.source_provider,
           g.status,
           g.expires_at,
           g.grace_until
    from public.products p
    left join lateral (
      select grant_row.*
      from public.access_grants grant_row
      where grant_row.user_id = (select auth.uid())
        and grant_row.product_id = p.id
        and grant_row.starts_at <= current_timestamp
        and (
          (grant_row.status = 'active' and (grant_row.expires_at is null or grant_row.expires_at > current_timestamp))
          or (grant_row.status = 'grace_period' and grant_row.grace_until > current_timestamp)
        )
      order by case grant_row.access_type
        when 'lifetime' then 1 when 'paid' then 2 when 'manual' then 3 else 4 end,
        grant_row.created_at desc
      limit 1
    ) g on true
    where p.product_kind = 'entitlement' and p.active
  ), trial_state as (
    select case
             when t.state = 'active' and t.expires_at <= current_timestamp then 'expired'
             else t.state
           end as state,
           t.started_at,
           t.expires_at,
           t.converted_at,
           t.revoked_at
    from public.product_trials t
    join public.products p on p.id = t.product_id and p.code = 'APP'
    where t.user_id = (select auth.uid())
  )
  select jsonb_build_object(
    'server_now', current_timestamp,
    'app', coalesce((
      select jsonb_build_object(
        'access', access_type is not null,
        'type', access_type,
        'source', source_provider,
        'status', status,
        'expires_at', expires_at,
        'grace_until', grace_until
      ) from product_state where code = 'APP'
    ), jsonb_build_object('access', false)),
    'knowledge', coalesce((
      select jsonb_build_object(
        'access', access_type is not null,
        'type', access_type,
        'source', source_provider,
        'status', status,
        'expires_at', expires_at,
        'grace_until', grace_until
      ) from product_state where code = 'KNOWLEDGE'
    ), jsonb_build_object('access', false)),
    'trial', coalesce((select to_jsonb(trial_state) from trial_state), jsonb_build_object('state', 'eligible'))
  )
$$;

create or replace function public.start_my_app_trial()
returns table(trial_state text, started_at timestamptz, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_product_id uuid;
  v_trial public.product_trials%rowtype;
  v_started_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mb-app-trial:' || v_user_id::text, 0));

  if not exists (
    select 1 from auth.users u
    where u.id = v_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'confirmed email required before starting trial' using errcode = '42501';
  end if;

  select p.id into v_product_id
  from public.products p
  where p.code = 'APP' and p.product_kind = 'entitlement' and p.active;
  if v_product_id is null then
    raise exception 'APP product unavailable' using errcode = 'P0001';
  end if;

  select t.* into v_trial
  from public.product_trials t
  where t.user_id = v_user_id and t.product_id = v_product_id
  for update;

  if found then
    if v_trial.state = 'active' and v_trial.expires_at <= clock_timestamp() then
      update public.product_trials set state = 'expired' where id = v_trial.id;
      update public.access_grants
        set status = 'expired'
        where user_id = v_user_id and product_id = v_product_id and access_type = 'trial';
      v_trial.state := 'expired';
    end if;
    return query select v_trial.state, v_trial.started_at, v_trial.expires_at;
    return;
  end if;

  if exists (
    select 1 from public.access_grants g
    where g.user_id = v_user_id and g.product_id = v_product_id and g.access_type <> 'trial'
  ) then
    return query select 'converted'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_started_at := clock_timestamp();
  insert into public.product_trials(
    user_id, product_id, state, origin, started_at, expires_at
  ) values (
    v_user_id, v_product_id, 'active', 'confirmed_email_first_eligible_access',
    v_started_at, v_started_at + interval '168 hours'
  ) returning * into v_trial;

  insert into public.access_grants(
    user_id, product_id, access_type, source_provider, status,
    starts_at, expires_at, external_reference
  ) values (
    v_user_id, v_product_id, 'trial', 'trial', 'active',
    v_trial.started_at, v_trial.expires_at, 'trial:' || v_trial.id::text
  );

  return query select v_trial.state, v_trial.started_at, v_trial.expires_at;
end
$$;

revoke all on function public.mb_commercial_touch_updated_at() from public, anon, authenticated;
revoke all on function public.mb_validate_commercial_grant_target() from public, anon, authenticated;
revoke all on function public.has_active_access(text) from public, anon;
revoke all on function public.get_my_entitlements() from public, anon;
revoke all on function public.start_my_app_trial() from public, anon;
grant execute on function public.has_active_access(text) to authenticated;
grant execute on function public.get_my_entitlements() to authenticated;
grant execute on function public.start_my_app_trial() to authenticated;

-- Financial data remains intact at trial expiry. The database gate blocks API
-- reads and writes unless the caller has a current APP entitlement.
do $financial_policies$
declare
  v_table text;
  v_policy record;
  v_normalized_qual text;
  v_normalized_check text;
begin
  foreach v_table in array array[
    'accounts', 'cards', 'categories', 'goals', 'assets', 'liabilities',
    'recurring', 'transactions', 'monthly_plans'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'commercial access v1 requires public.%', v_table using errcode = 'P0001';
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || v_table)) then
      raise exception 'commercial access v1 requires RLS on public.%', v_table using errcode = 'P0001';
    end if;

    select * into v_policy
    from pg_policies
    where schemaname = 'public' and tablename = v_table
      and policyname = 'mb_v82_own_rows';
    if not found then
      raise exception 'commercial access v1 requires canonical V82 policy on public.%', v_table using errcode = 'P0001';
    end if;

    v_normalized_qual := regexp_replace(lower(coalesce(v_policy.qual, '')), '[[:space:]()]', '', 'g');
    v_normalized_check := regexp_replace(lower(coalesce(v_policy.with_check, '')), '[[:space:]()]', '', 'g');
    if v_policy.cmd <> 'ALL'
       or v_policy.roles <> array['authenticated']::name[]
       or v_normalized_qual not in ('selectauth.uidasuid=user_id', 'selectauth.uid=user_id')
       or v_normalized_check not in ('selectauth.uidasuid=user_id', 'selectauth.uid=user_id')
       or exists (
         select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = v_table
           and p.policyname <> 'mb_v82_own_rows'
           and p.roles && array['public', 'anon', 'authenticated']::name[]
       ) then
      raise exception 'commercial access v1 refuses policy drift on public.%', v_table using errcode = 'P0001';
    end if;

    execute format('drop policy mb_v82_own_rows on public.%I', v_table);
    execute format(
      'create policy mb_commercial_app_access on public.%I for all to authenticated '
      'using ((select auth.uid()) = user_id and (select public.has_active_access(''APP''))) '
      'with check ((select auth.uid()) = user_id and (select public.has_active_access(''APP'')))',
      v_table
    );
  end loop;
end
$financial_policies$;

do $verify$
declare
  v_table text;
begin
  if (select count(*) from public.products where code in ('APP', 'KNOWLEDGE') and product_kind = 'entitlement') <> 2
     or not exists (select 1 from public.products where code = 'COMPLETE' and product_kind = 'bundle')
     or (select count(*) from public.product_components pc join public.products p on p.id = pc.bundle_product_id where p.code = 'COMPLETE') <> 2 then
    raise exception 'commercial access v1 product catalog verification failed' using errcode = 'P0001';
  end if;

  foreach v_table in array array[
    'products', 'product_components', 'commercial_offers', 'product_trials',
    'access_grants', 'billing_customers', 'billing_orders', 'billing_subscriptions',
    'payment_events'
  ] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || v_table)) then
      raise exception 'commercial access v1 RLS verification failed for public.%', v_table using errcode = 'P0001';
    end if;
  end loop;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('product_trials', 'access_grants', 'billing_customers', 'billing_orders', 'billing_subscriptions', 'payment_events')
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) then
    raise exception 'commercial access v1 client write grant verification failed' using errcode = 'P0001';
  end if;
end
$verify$;

commit;
