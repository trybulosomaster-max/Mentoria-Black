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
  v_state text;
  v_columns text[];
  v_policy record;
begin
  if to_regprocedure('auth.uid()') is null or to_regclass('auth.users') is null then
    raise exception 'commercial access v2 requires Supabase Auth' using errcode='P0001';
  end if;

  if to_regclass('public.products') is null
     and to_regclass('public.access_grants') is null
     and to_regclass('public.payment_events') is null then
    foreach v_object in array array[
      'product_components','commercial_offers','product_trials','commercial_admin_audit',
      'commercial_enforcement_state','billing_customers','billing_orders',
      'billing_order_grants','billing_subscriptions'
    ] loop
      if to_regclass('public.'||v_object) is not null then
        raise exception 'commercial access v2 partial schema: unexpected public.%',v_object using errcode='P0001';
      end if;
    end loop;
    if to_regprocedure('public.has_active_access(text)') is not null
       or to_regprocedure('public.get_my_entitlements()') is not null
       or to_regprocedure('public.start_my_app_trial()') is not null
       or to_regprocedure('public.set_kiwify_webhook_token(text)') is not null then
      raise exception 'commercial access v2 partial schema: access RPC exists without commercial tables' using errcode='P0001';
    end if;
    v_state:='absent';
  elsif to_regclass('public.products') is not null
        and to_regclass('public.access_grants') is not null
        and to_regclass('public.payment_events') is not null
        and exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='slug')
        and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='code')
        and exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='source')
        and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='access_type')
        and exists(select 1 from information_schema.columns where table_schema='public' and table_name='payment_events' and column_name='event_id')
        and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='payment_events' and column_name='external_event_id') then
    v_state:='kiwify_legacy';

    foreach v_object in array array[
      'product_components','commercial_offers','product_trials','commercial_admin_audit',
      'commercial_enforcement_state','billing_customers','billing_orders',
      'billing_order_grants','billing_subscriptions'
    ] loop
      if to_regclass('public.'||v_object) is not null then
        raise exception 'commercial access v2 Kiwify drift: unexpected public.%',v_object using errcode='P0001';
      end if;
    end loop;

    select array_agg(column_name order by column_name) into v_columns from information_schema.columns
      where table_schema='public' and table_name='products';
    if v_columns<>array['active','created_at','description','id','name','slug','updated_at']::text[] then
      raise exception 'commercial access v2 Kiwify drift: public.products columns differ' using errcode='P0001';
    end if;
    select array_agg(column_name order by column_name) into v_columns from information_schema.columns
      where table_schema='public' and table_name='access_grants';
    if v_columns<>array['created_at','expires_at','external_customer_id','external_purchase_id','id','product_id','revoked_at','source','started_at','status','updated_at','user_id']::text[] then
      raise exception 'commercial access v2 Kiwify drift: public.access_grants columns differ' using errcode='P0001';
    end if;
    select array_agg(column_name order by column_name) into v_columns from information_schema.columns
      where table_schema='public' and table_name='payment_events';
    if v_columns<>array['created_at','event_id','event_type','external_customer_id','external_purchase_id','id','payload','processed','processed_at','provider','user_id']::text[] then
      raise exception 'commercial access v2 Kiwify drift: public.payment_events columns differ' using errcode='P0001';
    end if;
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='id' and data_type='uuid' and is_nullable='NO')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='slug' and data_type='text' and is_nullable='NO')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='active' and data_type='boolean' and is_nullable='NO' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='true')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='user_id' and data_type='uuid' and is_nullable='NO')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='product_id' and data_type='uuid' and is_nullable='NO')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='status' and data_type='text' and is_nullable='NO' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='''active''::text')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='source' and data_type='text' and is_nullable='NO' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='''manual''::text')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='started_at' and data_type='timestamp with time zone' and is_nullable='NO')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='payment_events' and column_name='provider' and data_type='text' and is_nullable='NO' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='''kiwify''::text')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='payment_events' and column_name='payload' and data_type='jsonb' and is_nullable='NO')
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='payment_events' and column_name='processed' and data_type='boolean' and is_nullable='NO' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='false') then
      raise exception 'commercial access v2 Kiwify drift: legacy types/defaults/nullability differ' using errcode='P0001';
    end if;

    if exists(
      select 1
      from (values
        ('products','name','text','NO'),('products','description','text','YES'),
        ('products','created_at','timestamp with time zone','YES'),('products','updated_at','timestamp with time zone','YES'),
        ('access_grants','id','uuid','NO'),('access_grants','expires_at','timestamp with time zone','YES'),
        ('access_grants','external_customer_id','text','YES'),('access_grants','external_purchase_id','text','YES'),
        ('access_grants','revoked_at','timestamp with time zone','YES'),('access_grants','created_at','timestamp with time zone','YES'),
        ('access_grants','updated_at','timestamp with time zone','YES'),
        ('payment_events','id','uuid','NO'),('payment_events','event_id','text','NO'),
        ('payment_events','event_type','text','NO'),('payment_events','user_id','uuid','YES'),
        ('payment_events','external_customer_id','text','YES'),('payment_events','external_purchase_id','text','YES'),
        ('payment_events','processed_at','timestamp with time zone','YES'),('payment_events','created_at','timestamp with time zone','YES')
      ) as expected(table_name,column_name,data_type,is_nullable)
      left join information_schema.columns actual
        on actual.table_schema='public' and actual.table_name=expected.table_name and actual.column_name=expected.column_name
      where actual.column_name is null or actual.data_type<>expected.data_type or actual.is_nullable<>expected.is_nullable
    ) then
      raise exception 'commercial access v2 Kiwify drift: secondary legacy types/nullability differ' using errcode='P0001';
    end if;

    if (select count(*) from public.products)<>1
       or (select count(*) from public.products where slug='mentoria-black')<>1
       or (select count(*) from public.access_grants)<>1
       or (select count(*) from public.payment_events)<>2
       or exists(select 1 from public.access_grants where source not in ('manual','kiwify'))
       or exists(select 1 from public.access_grants where status not in ('active','suspended','revoked','expired'))
       or exists(select 1 from public.payment_events where provider<>'kiwify') then
      raise exception 'commercial access v2 Kiwify drift: expected 1 mapped product, 1 grant and 2 Kiwify events' using errcode='P0001';
    end if;
    if not exists(
      select 1 from pg_constraint c where c.conrelid='public.products'::regclass and c.contype='p'
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['id']::name[]
    ) or not exists(
      select 1 from pg_constraint c where c.conrelid='public.products'::regclass and c.contype='u'
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['slug']::name[]
    ) or not exists(
      select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='p'
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['id']::name[]
    ) or not exists(
      select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='u'
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['user_id','product_id']::name[]
    ) or not exists(
      select 1 from pg_constraint c where c.conrelid='public.payment_events'::regclass and c.contype='p'
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['id']::name[]
    ) or not exists(
      select 1 from pg_constraint c where c.conrelid='public.payment_events'::regclass and c.contype='u'
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['provider','event_id']::name[]
    ) then
      raise exception 'commercial access v2 Kiwify drift: legacy unique contracts differ' using errcode='P0001';
    end if;
    if not exists(select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='c' and c.convalidated
          and regexp_replace(lower(pg_get_constraintdef(c.oid)),'[[:space:]()]','','g')='checksource=anyarray[''manual''::text,''kiwify''::text]')
       or not exists(select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='c' and c.convalidated
          and regexp_replace(lower(pg_get_constraintdef(c.oid)),'[[:space:]()]','','g')='checkstatus=anyarray[''active''::text,''suspended''::text,''revoked''::text,''expired''::text]')
       or not exists(select 1 from pg_constraint c where c.conrelid='public.payment_events'::regclass and c.contype='c' and c.convalidated
          and regexp_replace(lower(pg_get_constraintdef(c.oid)),'[[:space:]()]','','g')='checkprovider=''kiwify''::text') then
      raise exception 'commercial access v2 Kiwify drift: legacy CHECK constraints differ' using errcode='P0001';
    end if;
    if (select count(*) from pg_constraint where conrelid='public.products'::regclass)<>2
       or (select count(*) from pg_constraint where conrelid='public.access_grants'::regclass)<>6
       or (select count(*) from pg_constraint where conrelid='public.payment_events'::regclass)<>3 then
      raise exception 'commercial access v2 Kiwify drift: unexpected legacy constraint' using errcode='P0001';
    end if;
    if not exists(
      select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='f' and c.confrelid='auth.users'::regclass
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['user_id']::name[]
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.confkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.confrelid and a.attnum=key.attnum)=array['id']::name[]
    ) or not exists(
      select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='f' and c.confrelid='public.products'::regclass
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['product_id']::name[]
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.confkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.confrelid and a.attnum=key.attnum)=array['id']::name[]
    ) then
      raise exception 'commercial access v2 Kiwify drift: access_grants ownership FKs differ' using errcode='P0001';
    end if;
    if exists(
      select 1 from pg_constraint c
      join pg_index i on i.indexrelid=c.conindid
      where c.conrelid in('public.products'::regclass,'public.access_grants'::regclass,'public.payment_events'::regclass)
        and c.contype in('p','u') and (not i.indisvalid or not i.indisready)
    ) then
      raise exception 'commercial access v2 Kiwify drift: legacy constraint index invalid' using errcode='P0001';
    end if;
    if not (select relrowsecurity from pg_class where oid='public.products'::regclass)
       or not (select relrowsecurity from pg_class where oid='public.access_grants'::regclass)
       or not (select relrowsecurity from pg_class where oid='public.payment_events'::regclass) then
      raise exception 'commercial access v2 Kiwify drift: RLS must be enabled' using errcode='P0001';
    end if;
    if (select count(*) from pg_policies where schemaname='public' and tablename in('products','access_grants','payment_events'))<>3 then
      raise exception 'commercial access v2 Kiwify drift: unexpected or duplicate legacy policy' using errcode='P0001';
    end if;
    select * into v_policy from pg_policies where schemaname='public' and tablename='products' and policyname='products_select_active';
    if not found or v_policy.cmd<>'SELECT' or v_policy.roles<>array['authenticated']::name[]
       or regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g') not in ('active=true','active') then
      raise exception 'commercial access v2 Kiwify drift: products policy differs' using errcode='P0001';
    end if;
    select * into v_policy from pg_policies where schemaname='public' and tablename='access_grants' and policyname='access_grants_select_own';
    if not found or v_policy.cmd<>'SELECT' or v_policy.roles<>array['authenticated']::name[]
       or regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g') not in ('user_id=auth.uid','auth.uid=user_id','user_id=selectauth.uid','selectauth.uid=user_id') then
      raise exception 'commercial access v2 Kiwify drift: access_grants policy differs' using errcode='P0001';
    end if;
    select * into v_policy from pg_policies where schemaname='public' and tablename='payment_events' and policyname='payment_events_no_client_access';
    if not found or v_policy.cmd<>'ALL' or not (v_policy.roles @> array['anon','authenticated']::name[])
       or regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g')<>'false'
       or regexp_replace(lower(coalesce(v_policy.with_check,'')),'[[:space:]()]','','g')<>'false' then
      raise exception 'commercial access v2 Kiwify drift: payment_events policy differs' using errcode='P0001';
    end if;
    if not exists(select 1 from pg_proc where oid=to_regprocedure('public.has_active_access(text)')
      and not prosecdef and provolatile='s' and pronargdefaults=1 and prorettype='boolean'::regtype
      and prosrc ilike '%access_grants%' and prosrc ilike '%products%' and prosrc ilike '%auth.uid%')
       or not exists(select 1 from pg_proc where oid=to_regprocedure('public.set_kiwify_webhook_token(text)')
      and prosecdef and prorettype='void'::regtype
      and exists(select 1 from unnest(coalesce(proconfig,array[]::text[])) as configs(setting)
                 where lower(setting) like 'search_path=public,%vault%')) then
      raise exception 'commercial access v2 Kiwify drift: legacy functions differ' using errcode='P0001';
    end if;
  elsif to_regclass('public.commercial_enforcement_state') is not null
        and exists(select 1 from information_schema.columns where table_schema='public' and table_name='commercial_enforcement_state' and column_name='schema_version')
        and exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='code')
        and exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='access_type')
        and exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='source')
        and exists(select 1 from information_schema.columns where table_schema='public' and table_name='payment_events' and column_name='external_event_id') then
    v_state:='commercial_v2';
    if not exists(select 1 from public.commercial_enforcement_state where singleton and schema_version='commercial_access_v2_kiwify_reconciled') then
      raise exception 'commercial access v2 drift: schema version marker differs' using errcode='P0001';
    end if;
    foreach v_object in array array[
      'products','product_components','commercial_offers','product_trials','access_grants',
      'commercial_admin_audit','commercial_enforcement_state','billing_customers',
      'billing_orders','billing_order_grants','billing_subscriptions','payment_events'
    ] loop
      if to_regclass('public.'||v_object) is null then
        raise exception 'commercial access v2 drift: missing public.%',v_object using errcode='P0001';
      end if;
    end loop;
    select array_agg(column_name order by column_name) into v_columns from information_schema.columns
      where table_schema='public' and table_name='products';
    if v_columns<>array['active','code','created_at','description','id','name','product_kind','public_sample_available','slug','updated_at']::text[] then
      raise exception 'commercial access v2 drift: products V2 columns differ' using errcode='P0001';
    end if;
    select array_agg(column_name order by column_name) into v_columns from information_schema.columns
      where table_schema='public' and table_name='access_grants';
    if v_columns<>array['access_type','administrative_reason','created_at','environment','expires_at','external_customer_id','external_purchase_id','external_reference','external_subscription_id','grace_until','granted_by','id','product_id','revoked_at','revoked_by','source','started_at','status','updated_at','user_id']::text[] then
      raise exception 'commercial access v2 drift: access_grants V2 columns differ' using errcode='P0001';
    end if;
    select array_agg(column_name order by column_name) into v_columns from information_schema.columns
      where table_schema='public' and table_name='payment_events';
    if v_columns<>array['created_at','environment','error_code','event_id','event_type','external_customer_id','external_event_id','external_payment_id','external_purchase_id','external_subscription_id','id','last_error_at','next_retry_at','payload','payload_hash','processed','processed_at','processing_attempts','provider','received_at','status','user_id']::text[] then
      raise exception 'commercial access v2 drift: payment_events V2 columns differ' using errcode='P0001';
    end if;
    foreach v_object in array array[
      'access_grants_provider_reference_uidx','access_grants_one_trial_uidx',
      'access_grants_one_active_subscription_uidx','access_grants_user_product_status_idx',
      'payment_events_provider_environment_event_uidx','payment_events_status_received_idx',
      'payment_events_external_payment_idx'
    ] loop
      if to_regclass('public.'||v_object) is null or not exists(
        select 1 from pg_index where indexrelid=to_regclass('public.'||v_object) and indisvalid and indisready
      ) then
        raise exception 'commercial access v2 drift: missing or invalid index %',v_object using errcode='P0001';
      end if;
    end loop;
    if not exists(select 1 from pg_index where indexrelid='public.access_grants_provider_reference_uidx'::regclass
          and indisunique and pg_get_expr(indpred,indrelid) ilike '%external_reference%is not null%')
       or not exists(select 1 from pg_index where indexrelid='public.access_grants_one_trial_uidx'::regclass
          and indisunique and pg_get_expr(indpred,indrelid) ilike '%access_type%trial%')
       or not exists(select 1 from pg_index where indexrelid='public.access_grants_one_active_subscription_uidx'::regclass
          and indisunique and pg_get_expr(indpred,indrelid) ilike '%access_type%paid%'
          and pg_get_expr(indpred,indrelid) ilike '%external_subscription_id%is not null%')
       or not exists(select 1 from pg_index where indexrelid='public.payment_events_provider_environment_event_uidx'::regclass
          and indisunique and indpred is null) then
      raise exception 'commercial access v2 drift: V2 unique-index semantics differ' using errcode='P0001';
    end if;
    if to_regprocedure('public.has_active_access(text)') is null
       or to_regprocedure('public.get_my_entitlements()') is null
       or to_regprocedure('public.start_my_app_trial()') is null
       or to_regprocedure('public.process_payment_event_v1(uuid)') is null
       or to_regprocedure('public.activate_commercial_enforcement_v1(uuid,text)') is null
       or not exists(select 1 from pg_proc where oid=to_regprocedure('public.has_active_access(text)') and not prosecdef and provolatile='s' and prosrc ilike '%p.slug%')
       or not exists(select 1 from pg_proc where oid=to_regprocedure('public.process_payment_event_v1(uuid)') and prosecdef and prosrc ilike '%billing_order_grants%')
       or (select enforced from public.commercial_enforcement_state where singleton)
       or (select count(*) from pg_policies where schemaname='public' and policyname='mb_v82_own_rows')<>9
       or (select count(*) from pg_policies where schemaname='public' and tablename in('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans'))<>9
       or (select count(*) from pg_policies where schemaname='public' and policyname in(
            'mb_products_authenticated_read','mb_product_components_authenticated_read','mb_commercial_offers_authenticated_read',
            'mb_product_trials_own_read','mb_access_grants_own_read','mb_payment_events_no_client_access'))<>6
       or (select count(*) from pg_policies where schemaname='public' and tablename in(
            'products','product_components','commercial_offers','product_trials','access_grants','commercial_admin_audit',
            'commercial_enforcement_state','billing_customers','billing_orders','billing_order_grants','billing_subscriptions','payment_events'))<>6
       or (to_regprocedure('public.set_kiwify_webhook_token(text)') is not null and not exists(
            select 1 from pg_proc where oid=to_regprocedure('public.set_kiwify_webhook_token(text)') and prosecdef
          )) then
      raise exception 'commercial access v2 drift: existing V2 contract is not semantically retryable' using errcode='P0001';
    end if;
  else
    raise exception 'commercial access v2 NO-GO: unknown or partial commercial schema' using errcode='P0001';
  end if;

  perform set_config('mb.commercial_prestate',v_state,true);
end
$preflight$;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  code text not null unique,
  product_kind text not null,
  public_sample_available boolean not null default false,
  constraint products_code_format check (code=upper(code) and code~'^[A-Z][A-Z0-9_]{1,63}$'),
  constraint products_kind_check check (product_kind in ('entitlement','bundle'))
);

do $reconcile_products$
begin
  if current_setting('mb.commercial_prestate')='kiwify_legacy' then
    alter table public.products add column code text;
    alter table public.products add column product_kind text;
    alter table public.products add column public_sample_available boolean not null default false;
    update public.products set code='APP',product_kind='entitlement' where slug='mentoria-black';
    alter table public.products alter column code set not null;
    alter table public.products alter column product_kind set not null;
    alter table public.products add constraint products_code_key unique(code);
    alter table public.products add constraint products_code_format check(code=upper(code) and code~'^[A-Z][A-Z0-9_]{1,63}$');
    alter table public.products add constraint products_kind_check check(product_kind in('entitlement','bundle'));
  end if;
end
$reconcile_products$;

create table if not exists public.product_components (
  bundle_product_id uuid not null references public.products(id) on delete restrict,
  component_product_id uuid not null references public.products(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (bundle_product_id, component_product_id),
  constraint product_components_not_self check (bundle_product_id <> component_product_id)
);

create table if not exists public.commercial_offers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  product_id uuid not null references public.products(id) on delete restrict,
  billing_mode text not null,
  billing_interval text,
  active boolean not null default false,
  provider text,
  external_offer_id text,
  knowledge_cancellation_policy text,
  grace_period_hours integer not null default 0,
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
  ),
  constraint commercial_offers_grace_check check (
    (billing_mode = 'subscription' and grace_period_hours between 0 and 720)
    or (billing_mode = 'one_time' and grace_period_hours = 0)
  )
);

create table if not exists public.product_trials (
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

create table if not exists public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  access_type text not null,
  source text not null default 'manual',
  environment text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  grace_until timestamptz,
  external_reference text,
  external_customer_id text,
  external_purchase_id text,
  external_subscription_id text,
  granted_by uuid references auth.users(id) on delete set null,
  administrative_reason text,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_grants_type_check check (access_type in ('paid', 'trial', 'manual', 'lifetime')),
  constraint access_grants_status_check check (status in ('active','grace_period','past_due','suspended','expired','revoked','refunded','chargeback','administrative_review')),
  constraint access_grants_source_format check (source~'^[a-z][a-z0-9_-]{1,31}$'),
  constraint access_grants_environment_check check (environment is null or environment in ('legacy','sandbox','production')),
  constraint access_grants_interval_check check (expires_at is null or expires_at > started_at),
  constraint access_grants_grace_check check (grace_until is null or grace_until >= started_at),
  constraint access_grants_lifetime_check check (access_type <> 'lifetime' or expires_at is null),
  constraint access_grants_trial_source_check check (access_type<>'trial' or source='trial'),
  constraint access_grants_manual_audit_check check (
    access_type<>'manual' or (source='manual' and (environment='legacy' or granted_by is not null))
  ),
  constraint access_grants_revocation_check check (revoked_at is null or revoked_at >= started_at)
);

do $reconcile_access_grants$
declare v_constraint name;
begin
  if current_setting('mb.commercial_prestate')='kiwify_legacy' then
    alter table public.access_grants add column access_type text;
    alter table public.access_grants add column environment text;
    alter table public.access_grants add column grace_until timestamptz;
    alter table public.access_grants add column external_reference text;
    alter table public.access_grants add column external_subscription_id text;
    alter table public.access_grants add column granted_by uuid references auth.users(id) on delete set null;
    alter table public.access_grants add column administrative_reason text;
    alter table public.access_grants add column revoked_by uuid references auth.users(id) on delete set null;
    update public.access_grants set
      access_type=case when source='manual' then 'manual' else 'paid' end,
      environment='legacy',
      external_reference=external_purchase_id;
    alter table public.access_grants alter column access_type set not null;

    for v_constraint in select c.conname from pg_constraint c where c.conrelid='public.access_grants'::regclass
      and (c.contype='c' and (pg_get_constraintdef(c.oid) ilike '%source%' or pg_get_constraintdef(c.oid) ilike '%status%')
        or c.contype='u' and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
          join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['user_id','product_id']::name[])
    loop execute format('alter table public.access_grants drop constraint %I',v_constraint); end loop;

    alter table public.access_grants add constraint access_grants_type_check check(access_type in('paid','trial','manual','lifetime'));
    alter table public.access_grants add constraint access_grants_status_check check(status in('active','grace_period','past_due','suspended','expired','revoked','refunded','chargeback','administrative_review'));
    alter table public.access_grants add constraint access_grants_source_format check(source~'^[a-z][a-z0-9_-]{1,31}$');
    alter table public.access_grants add constraint access_grants_environment_check check(environment is null or environment in('legacy','sandbox','production'));
    alter table public.access_grants add constraint access_grants_interval_check check(expires_at is null or expires_at>started_at);
    alter table public.access_grants add constraint access_grants_grace_check check(grace_until is null or grace_until>=started_at);
    alter table public.access_grants add constraint access_grants_lifetime_check check(access_type<>'lifetime' or expires_at is null);
    alter table public.access_grants add constraint access_grants_trial_source_check check(access_type<>'trial' or source='trial');
    alter table public.access_grants add constraint access_grants_manual_audit_check check(access_type<>'manual' or (source='manual' and (environment='legacy' or granted_by is not null)));
    alter table public.access_grants add constraint access_grants_revocation_check check(revoked_at is null or revoked_at>=started_at);
  end if;
end
$reconcile_access_grants$;

create unique index if not exists access_grants_provider_reference_uidx
  on public.access_grants(source,coalesce(environment,'internal'),external_reference,product_id)
  where external_reference is not null;
create unique index if not exists access_grants_one_trial_uidx
  on public.access_grants(user_id, product_id)
  where access_type = 'trial';
create unique index if not exists access_grants_one_active_subscription_uidx
  on public.access_grants(user_id,product_id,source,environment)
  where access_type='paid' and external_subscription_id is not null and status in('active','grace_period');
create index if not exists access_grants_user_product_status_idx
  on public.access_grants(user_id, product_id, status, started_at, expires_at);
create index if not exists product_trials_user_idx on public.product_trials(user_id, product_id);

create table if not exists public.commercial_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  product_code text,
  grant_id uuid references public.access_grants(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint commercial_admin_audit_action_check check (action in ('bootstrap','grant','revoke','activate_enforcement','rollback_enforcement')),
  constraint commercial_admin_audit_reason_check check (length(trim(reason)) between 3 and 500)
);
create index if not exists commercial_admin_audit_target_idx on public.commercial_admin_audit(target_user_id, created_at desc);
create index if not exists commercial_admin_audit_actor_idx on public.commercial_admin_audit(actor_user_id, created_at desc);

create table if not exists public.commercial_enforcement_state (
  singleton boolean primary key default true check (singleton),
  schema_version text not null default 'commercial_access_v2_kiwify_reconciled',
  enforced boolean not null default false,
  enforced_at timestamptz,
  enforced_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint commercial_enforcement_timeline_check check (
    (not enforced and enforced_at is null and enforced_by is null)
    or (enforced and enforced_at is not null and enforced_by is not null)
  ),
  constraint commercial_enforcement_version_check check(schema_version='commercial_access_v2_kiwify_reconciled')
);
insert into public.commercial_enforcement_state(singleton,schema_version,enforced)
values(true,'commercial_access_v2_kiwify_reconciled',false) on conflict(singleton) do nothing;

create table if not exists public.billing_customers (
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
  constraint billing_customers_environment_check check (environment in ('legacy','sandbox','production'))
);

create table if not exists public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_id uuid not null references public.commercial_offers(id) on delete restrict,
  provider text not null,
  environment text not null,
  status text not null default 'created',
  external_checkout_id text,
  external_payment_id text,
  external_subscription_id text,
  paid_through timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_orders_provider_format check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint billing_orders_environment_check check (environment in ('legacy','sandbox','production')),
  constraint billing_orders_status_check check (status in ('created', 'pending', 'confirmed', 'received', 'past_due', 'cancelled', 'refunded', 'chargeback', 'failed'))
);

create unique index if not exists billing_orders_payment_uidx
  on public.billing_orders(provider, environment, external_payment_id)
  where external_payment_id is not null;
create unique index if not exists billing_orders_subscription_uidx
  on public.billing_orders(provider, environment, external_subscription_id)
  where external_subscription_id is not null;
create index if not exists billing_orders_user_idx on public.billing_orders(user_id, created_at desc);

create table if not exists public.billing_order_grants (
  order_id uuid not null references public.billing_orders(id) on delete restrict,
  grant_id uuid not null references public.access_grants(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (order_id, product_id),
  unique (grant_id)
);

create table if not exists public.billing_subscriptions (
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
  constraint billing_subscriptions_environment_check check (environment in ('legacy','sandbox','production')),
  constraint billing_subscriptions_status_check check (status in ('active', 'grace_period', 'past_due', 'expired', 'revoked', 'refunded', 'chargeback', 'cancelled'))
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  environment text not null,
  external_event_id text not null,
  event_type text not null,
  user_id uuid,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  processing_attempts integer not null default 0,
  next_retry_at timestamptz,
  last_error_at timestamptz,
  payload_hash text not null,
  error_code text,
  external_customer_id text,
  external_purchase_id text,
  external_payment_id text,
  external_subscription_id text,
  payload jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint payment_events_provider_format check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint payment_events_environment_check check (environment in ('legacy','sandbox','production')),
  constraint payment_events_status_check check (status in ('received', 'processing', 'processed', 'ignored', 'failed', 'administrative_review')),
  constraint payment_events_attempts_check check (processing_attempts >= 0),
  constraint payment_events_hash_check check (payload_hash ~ '^[0-9a-f]{64}$')
);

do $reconcile_payment_events$
declare v_constraint name;
begin
  if current_setting('mb.commercial_prestate')='kiwify_legacy' then
    alter table public.payment_events add column environment text;
    alter table public.payment_events add column external_event_id text;
    alter table public.payment_events add column received_at timestamptz;
    alter table public.payment_events add column status text;
    alter table public.payment_events add column processing_attempts integer not null default 0;
    alter table public.payment_events add column next_retry_at timestamptz;
    alter table public.payment_events add column last_error_at timestamptz;
    alter table public.payment_events add column payload_hash text;
    alter table public.payment_events add column error_code text;
    alter table public.payment_events add column external_payment_id text;
    alter table public.payment_events add column external_subscription_id text;
    update public.payment_events set environment='legacy',external_event_id=event_id,
      received_at=coalesce(created_at,now()),status=case when processed then 'processed' else 'received' end,
      payload_hash=encode(sha256(convert_to(payload::text,'UTF8')),'hex'),
      external_payment_id=external_purchase_id;
    alter table public.payment_events alter column environment set not null;
    alter table public.payment_events alter column external_event_id set not null;
    alter table public.payment_events alter column received_at set not null;
    alter table public.payment_events alter column received_at set default now();
    alter table public.payment_events alter column status set not null;
    alter table public.payment_events alter column status set default 'received';
    alter table public.payment_events alter column payload_hash set not null;
    alter table public.payment_events alter column payload drop not null;

    for v_constraint in select c.conname from pg_constraint c where c.conrelid='public.payment_events'::regclass
      and (c.contype='c' and pg_get_constraintdef(c.oid) ilike '%provider%'
        or c.contype='u' and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
          join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['provider','event_id']::name[])
    loop execute format('alter table public.payment_events drop constraint %I',v_constraint); end loop;

    alter table public.payment_events add constraint payment_events_provider_format check(provider~'^[a-z][a-z0-9_-]{1,31}$');
    alter table public.payment_events add constraint payment_events_environment_check check(environment in('legacy','sandbox','production'));
    alter table public.payment_events add constraint payment_events_status_check check(status in('received','processing','processed','ignored','failed','administrative_review'));
    alter table public.payment_events add constraint payment_events_attempts_check check(processing_attempts>=0);
    alter table public.payment_events add constraint payment_events_hash_check check(payload_hash~'^[0-9a-f]{64}$');
  end if;
end
$reconcile_payment_events$;

create unique index if not exists payment_events_provider_environment_event_uidx on public.payment_events(provider,environment,external_event_id);
create index if not exists payment_events_status_received_idx on public.payment_events(status, received_at);
create index if not exists payment_events_external_payment_idx on public.payment_events(provider, environment, external_payment_id);

insert into public.products(code,name,slug,description,product_kind,public_sample_available) values
  ('APP','Aplicativo financeiro Mentoria Black','mentoria-black',null,'entitlement',false),
  ('KNOWLEDGE','Área de Conhecimento Mentoria Black','knowledge',null,'entitlement',true),
  ('COMPLETE','Mentoria Black Completa','complete',null,'bundle',true)
on conflict(code) do nothing;

insert into public.product_components(bundle_product_id, component_product_id)
select bundle.id, component.id
from public.products bundle
join public.products component on component.code in ('APP', 'KNOWLEDGE')
where bundle.code = 'COMPLETE'
on conflict(bundle_product_id,component_product_id) do nothing;

insert into public.commercial_offers(
  code, product_id, billing_mode, billing_interval, active,
  knowledge_cancellation_policy, grace_period_hours
)
select offer.code, product.id, offer.billing_mode, offer.billing_interval, false,
       offer.knowledge_cancellation_policy, offer.grace_period_hours
from (values
  ('APP_MONTHLY', 'APP', 'subscription', 'month', null::text, 72),
  ('APP_ANNUAL', 'APP', 'subscription', 'year', null::text, 72),
  ('KNOWLEDGE_LIFETIME', 'KNOWLEDGE', 'one_time', null::text, null::text, 0),
  ('COMPLETE_MONTHLY', 'COMPLETE', 'subscription', 'month', 'KNOWLEDGE_LIFETIME_AFTER_VALID_ACQUISITION', 72),
  ('COMPLETE_ANNUAL', 'COMPLETE', 'subscription', 'year', 'KNOWLEDGE_LIFETIME_AFTER_VALID_ACQUISITION', 72)
) as offer(code, product_code, billing_mode, billing_interval, knowledge_cancellation_policy, grace_period_hours)
join public.products product on product.code = offer.product_code
on conflict(code) do nothing;

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

create or replace function public.mb_normalize_access_grant_v2()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog
as $$
begin
  if new.access_type is null then
    new.access_type:=case when new.source='manual' then 'manual' else 'paid' end;
  end if;
  if new.environment is null and new.source in ('kiwify','asaas','hotmart','eduzz') then
    new.environment:='production';
  end if;
  if new.external_reference is null then
    new.external_reference:=new.external_purchase_id;
  end if;
  return new;
end
$$;

create or replace function public.mb_normalize_payment_event_v2()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog
as $$
begin
  new.environment:=coalesce(new.environment,case when new.provider='kiwify' then 'production' else null end);
  new.external_event_id:=coalesce(new.external_event_id,new.event_id);
  new.event_id:=coalesce(new.event_id,new.external_event_id);
  new.received_at:=coalesce(new.received_at,new.created_at,clock_timestamp());
  new.status:=coalesce(new.status,case when coalesce(new.processed,false) then 'processed' else 'received' end);
  if coalesce(new.processed,false) and new.status in ('received','processing') then
    new.status:='processed';
  end if;
  if new.status='processed' then
    new.processed:=true;
  end if;
  if new.payload_hash is null and new.payload is not null then
    new.payload_hash:=encode(sha256(convert_to(new.payload::text,'UTF8')),'hex');
  end if;
  new.external_payment_id:=coalesce(new.external_payment_id,new.external_purchase_id);
  if new.environment is null or new.external_event_id is null or new.payload_hash is null then
    raise exception 'payment event requires canonical environment, event id and payload hash' using errcode='23502';
  end if;
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
    execute format('drop trigger if exists mb_commercial_touch_updated_at on public.%I',v_table);
    execute format(
      'create trigger mb_commercial_touch_updated_at before update on public.%I '
      'for each row execute function public.mb_commercial_touch_updated_at()',
      v_table
    );
  end loop;
end
$touch_triggers$;

drop trigger if exists mb_normalize_access_grant_v2 on public.access_grants;
create trigger mb_normalize_access_grant_v2
before insert or update on public.access_grants
for each row execute function public.mb_normalize_access_grant_v2();

drop trigger if exists mb_normalize_payment_event_v2 on public.payment_events;
create trigger mb_normalize_payment_event_v2
before insert or update on public.payment_events
for each row execute function public.mb_normalize_payment_event_v2();

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

drop trigger if exists mb_validate_commercial_grant_target on public.access_grants;
create trigger mb_validate_commercial_grant_target
before insert or update of product_id on public.access_grants
for each row execute function public.mb_validate_commercial_grant_target();

alter table public.products enable row level security;
alter table public.product_components enable row level security;
alter table public.commercial_offers enable row level security;
alter table public.product_trials enable row level security;
alter table public.access_grants enable row level security;
alter table public.commercial_admin_audit enable row level security;
alter table public.commercial_enforcement_state enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_orders enable row level security;
alter table public.billing_order_grants enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists products_select_active on public.products;
drop policy if exists access_grants_select_own on public.access_grants;
drop policy if exists payment_events_no_client_access on public.payment_events;
drop policy if exists mb_products_authenticated_read on public.products;
drop policy if exists mb_product_components_authenticated_read on public.product_components;
drop policy if exists mb_commercial_offers_authenticated_read on public.commercial_offers;
drop policy if exists mb_product_trials_own_read on public.product_trials;
drop policy if exists mb_access_grants_own_read on public.access_grants;
drop policy if exists mb_payment_events_no_client_access on public.payment_events;
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
create policy mb_payment_events_no_client_access on public.payment_events
for all to anon,authenticated using(false) with check(false);

revoke all privileges on table public.products, public.product_components,
  public.commercial_offers, public.product_trials, public.access_grants,
  public.commercial_admin_audit, public.commercial_enforcement_state, public.billing_customers, public.billing_orders,
  public.billing_order_grants, public.billing_subscriptions,
  public.payment_events from public, anon, authenticated;
grant select on table public.products, public.product_components,
  public.commercial_offers, public.product_trials, public.access_grants to authenticated;

create or replace function public.has_active_access(p_product_slug text default 'mentoria-black')
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
      and (p.code=upper(trim(p_product_slug)) or p.slug=lower(trim(p_product_slug)))
      and p.product_kind = 'entitlement'
      and p.active
      and g.started_at <= statement_timestamp()
      and (
        (g.status = 'active' and (g.expires_at is null or g.expires_at > statement_timestamp()))
        or (g.status = 'grace_period' and g.grace_until > statement_timestamp())
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
    select p.code,g.access_type,g.source,g.status,g.expires_at,g.grace_until,
           coalesce(
             g.started_at <= statement_timestamp() and (
               (g.status = 'active' and (g.expires_at is null or g.expires_at > statement_timestamp()))
               or (g.status = 'grace_period' and g.grace_until > statement_timestamp())
             ), false
           ) as has_access
    from public.products p
    left join lateral (
      select grant_row.*
      from public.access_grants grant_row
      where grant_row.user_id = (select auth.uid())
        and grant_row.product_id = p.id
        and grant_row.started_at <= statement_timestamp()
      order by case
        when grant_row.status = 'active' and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp()) then 1
        when grant_row.status = 'grace_period' and grant_row.grace_until > statement_timestamp() then 2
        else 3 end,
        case grant_row.access_type when 'lifetime' then 1 when 'paid' then 2 when 'manual' then 3 else 4 end,
        grant_row.created_at desc
      limit 1
    ) g on true
    where p.product_kind = 'entitlement' and p.active
  ), trial_state as (
    select case
             when t.state = 'active' and t.expires_at <= statement_timestamp() then 'expired'
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
    'server_now', statement_timestamp(),
    'app', coalesce((
      select jsonb_build_object(
        'has_access', has_access,
        'access', has_access,
        'access_type', access_type,
        'type', access_type,
        'source', source,
        'state', case when status = 'active' and expires_at <= statement_timestamp() then 'expired' else status end,
        'status', case when status = 'active' and expires_at <= statement_timestamp() then 'expired' else status end,
        'expires_at', expires_at,
        'grace_until', grace_until,
        'trial_remaining_seconds', case when access_type = 'trial' then greatest(0, extract(epoch from expires_at-statement_timestamp())::bigint) else null end,
        'commercial_state', case
          when status = 'grace_period' and grace_until > statement_timestamp() then 'payment_attention'
          when status in ('revoked','refunded','chargeback','administrative_review') then status
          when status = 'active' and (expires_at is null or expires_at > statement_timestamp()) then 'authorized'
          else 'expired' end
      ) from product_state where code = 'APP'
    ), jsonb_build_object('has_access', false, 'access', false, 'state', 'none', 'commercial_state', 'offer')),
    'knowledge', coalesce((
      select jsonb_build_object(
        'has_access', has_access,
        'access', has_access,
        'access_type', access_type,
        'type', access_type,
        'source', source,
        'state', case when status = 'active' and expires_at <= statement_timestamp() then 'expired' else status end,
        'status', case when status = 'active' and expires_at <= statement_timestamp() then 'expired' else status end,
        'expires_at', expires_at,
        'grace_until', grace_until,
        'commercial_state', case when has_access then 'authorized' else coalesce(status, 'offer') end
      ) from product_state where code = 'KNOWLEDGE'
    ), jsonb_build_object('has_access', false, 'access', false, 'state', 'none', 'commercial_state', 'offer')),
    'trial', coalesce((select to_jsonb(trial_state) from trial_state), jsonb_build_object('state', 'eligible'))
  )
$$;

create or replace function public.start_my_app_trial()
returns table(result text, trial_state text, started_at timestamptz, expires_at timestamptz)
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
    return query select 'not_eligible'::text, 'eligible'::text, null::timestamptz, null::timestamptz;
    return;
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
    return query select
      case when v_trial.state = 'active' then 'already_active' else 'already_used' end,
      v_trial.state, v_trial.started_at, v_trial.expires_at;
    return;
  end if;

  if exists (
    select 1 from public.access_grants g
    where g.user_id = v_user_id and g.product_id = v_product_id and g.access_type <> 'trial'
  ) then
    return query select 'already_used'::text, 'converted'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  v_started_at := current_timestamp;
  insert into public.product_trials(
    user_id, product_id, state, origin, started_at, expires_at
  ) values (
    v_user_id, v_product_id, 'active', 'confirmed_email_first_eligible_access',
    v_started_at, v_started_at + interval '168 hours'
  ) returning * into v_trial;

  insert into public.access_grants(
    user_id,product_id,access_type,source,status,
    started_at,expires_at,external_reference
  ) values (
    v_user_id, v_product_id, 'trial', 'trial', 'active',
    v_trial.started_at, v_trial.expires_at, 'trial:' || v_trial.id::text
  );

  return query select 'started'::text, v_trial.state, v_trial.started_at, v_trial.expires_at;
end
$$;

create or replace function public.admin_grant_commercial_access_v1(
  p_target_user_id uuid,
  p_product_codes text[],
  p_access_type text,
  p_expires_at timestamptz,
  p_actor_user_id uuid,
  p_reason text
)
returns table(product_code text, grant_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_code text;
  v_product_id uuid;
  v_grant_id uuid;
  v_created boolean;
  v_existing_status text;
  v_reference text;
begin
  if p_target_user_id is null or p_actor_user_id is null
     or not exists (select 1 from auth.users where id = p_target_user_id)
     or not exists (select 1 from auth.users where id = p_actor_user_id) then
    raise exception 'valid target and actor are required' using errcode = '22023';
  end if;
  if p_access_type not in ('manual','lifetime') then
    raise exception 'admin access type must be manual or lifetime' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'administrative reason is required' using errcode = '22023';
  end if;
  if p_access_type = 'lifetime' and p_expires_at is not null then
    raise exception 'lifetime access cannot expire' using errcode = '22023';
  end if;
  if p_access_type = 'manual' and p_expires_at is not null and p_expires_at <= clock_timestamp() then
    raise exception 'temporary access must expire in the future' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mb-admin-grant:' || p_target_user_id::text, 0));
  foreach v_code in array p_product_codes loop
    v_code := upper(trim(v_code));
    if v_code not in ('APP','KNOWLEDGE') then
      raise exception 'only APP and KNOWLEDGE may be granted' using errcode = '22023';
    end if;
    select id into v_product_id from public.products where code = v_code and product_kind = 'entitlement' and active;
    v_reference := 'admin:' || p_target_user_id::text || ':' || v_code || ':' || p_access_type || ':' || coalesce(extract(epoch from p_expires_at)::bigint::text,'lifetime');
    select id,status into v_grant_id,v_existing_status from public.access_grants
      where source='manual' and product_id=v_product_id and external_reference=v_reference
      for update;
    v_created := v_grant_id is null or v_existing_status <> 'active';
    if v_grant_id is null then
      insert into public.access_grants(
        user_id,product_id,access_type,source,status,expires_at,
        granted_by, administrative_reason, external_reference
      ) values (
        p_target_user_id, v_product_id, p_access_type, 'manual', 'active', p_expires_at,
        p_actor_user_id, trim(p_reason),
        v_reference
      ) returning id into v_grant_id;
    elsif v_existing_status <> 'active' then
      update public.access_grants set status='active',started_at=current_timestamp,expires_at=p_expires_at,
        grace_until=null,revoked_at=null,revoked_by=null,granted_by=p_actor_user_id,
        administrative_reason=trim(p_reason) where id=v_grant_id;
    end if;
    if v_created then
      insert into public.commercial_admin_audit(actor_user_id,target_user_id,action,product_code,grant_id,reason)
      values (p_actor_user_id,p_target_user_id,'grant',v_code,v_grant_id,trim(p_reason));
    end if;
    return query select v_code, v_grant_id, v_created;
  end loop;
end
$$;

create or replace function public.bootstrap_commercial_admin_v1(
  p_target_user_id uuid, p_actor_user_id uuid, p_reason text
)
returns table(product_code text, grant_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  return query select * from public.admin_grant_commercial_access_v1(
    p_target_user_id, array['APP','KNOWLEDGE']::text[], 'lifetime', null, p_actor_user_id, p_reason
  );
  insert into public.commercial_admin_audit(actor_user_id,target_user_id,action,reason)
  values (p_actor_user_id,p_target_user_id,'bootstrap',trim(p_reason));
end
$$;

create or replace function public.admin_revoke_commercial_access_v1(
  p_grant_id uuid, p_actor_user_id uuid, p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_target uuid; v_code text;
begin
  if not exists (select 1 from auth.users where id = p_actor_user_id)
     or length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'valid actor and reason are required' using errcode = '22023';
  end if;
  update public.access_grants g set status='revoked', revoked_at=clock_timestamp(), revoked_by=p_actor_user_id,
    administrative_reason=trim(p_reason)
  from public.products p where g.id=p_grant_id and p.id=g.product_id and g.status not in ('revoked','refunded','chargeback')
  returning g.user_id,p.code into v_target,v_code;
  if not found then return false; end if;
  insert into public.commercial_admin_audit(actor_user_id,target_user_id,action,product_code,grant_id,reason)
  values (p_actor_user_id,v_target,'revoke',v_code,p_grant_id,trim(p_reason));
  return true;
end
$$;

create or replace function public.admin_get_commercial_access_v1(p_target_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'target_exists', exists(select 1 from auth.users u where u.id=p_target_user_id),
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'grant_id',g.id,'product_code',p.code,'access_type',g.access_type,
        'source',g.source,'status',g.status,'started_at',g.started_at,
        'expires_at',g.expires_at,'grace_until',g.grace_until
      ) order by g.created_at desc)
      from public.access_grants g join public.products p on p.id=g.product_id
      where g.user_id=p_target_user_id
    ),'[]'::jsonb)
  )
$$;

create or replace function public.process_payment_event_v1(p_event_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_event public.payment_events%rowtype;
  v_order public.billing_orders%rowtype;
  v_offer public.commercial_offers%rowtype;
  v_product record;
  v_grant_id uuid;
  v_state text;
begin
  select * into v_event from public.payment_events where id=p_event_id for update;
  if not found then raise exception 'payment event not found' using errcode='P0002'; end if;
  if v_event.status in ('processed','ignored','administrative_review') then return v_event.status; end if;
  update public.payment_events set status='processing',processed=false,processing_attempts=processing_attempts+1,error_code=null,next_retry_at=null where id=p_event_id;

  select * into v_order from public.billing_orders o
    where o.provider=v_event.provider and o.environment=v_event.environment
      and ((v_event.external_payment_id is not null and o.external_payment_id=v_event.external_payment_id)
        or (v_event.external_subscription_id is not null and o.external_subscription_id=v_event.external_subscription_id))
    order by o.created_at desc limit 1 for update;
  if not found then
    update public.payment_events set status='failed',processed=false,error_code='order_not_found',last_error_at=clock_timestamp(),next_retry_at=clock_timestamp()+interval '15 minutes' where id=p_event_id;
    return 'retryable';
  end if;
  select * into v_offer from public.commercial_offers where id=v_order.offer_id;

  if v_event.event_type = 'PAYMENT_PARTIALLY_REFUNDED' then
    update public.payment_events set status='administrative_review',processed=true,error_code='partial_refund_requires_review',processed_at=clock_timestamp() where id=p_event_id;
    return 'administrative_review';
  elsif v_event.event_type in ('PAYMENT_CONFIRMED','PAYMENT_RECEIVED') then
    if v_offer.billing_mode='subscription' and v_order.paid_through is null then
      update public.payment_events set status='failed',processed=false,error_code='paid_period_missing',last_error_at=clock_timestamp(),next_retry_at=clock_timestamp()+interval '15 minutes' where id=p_event_id;
      return 'retryable';
    end if;
    update public.billing_orders set status=case when v_event.event_type='PAYMENT_RECEIVED' then 'received' else 'confirmed' end where id=v_order.id;
    for v_product in
      select component.id,component.code
      from public.products sold
      join public.products component on component.id=sold.id and sold.product_kind='entitlement'
      where sold.id=v_offer.product_id
      union all
      select component.id,component.code from public.product_components pc
      join public.products component on component.id=pc.component_product_id
      where pc.bundle_product_id=v_offer.product_id
    loop
      select grant_id into v_grant_id from public.billing_order_grants where order_id=v_order.id and product_id=v_product.id;
      if v_grant_id is null then
        insert into public.access_grants(user_id,product_id,access_type,source,environment,status,started_at,expires_at,external_reference,external_subscription_id)
        values (v_order.user_id,v_product.id,case when v_product.code='KNOWLEDGE' then 'lifetime' else 'paid' end,
          v_order.provider,v_order.environment,'active',current_timestamp,case when v_product.code='APP' then v_order.paid_through else null end,
          'order:'||v_order.id::text||':'||v_product.code,v_order.external_subscription_id)
        returning id into v_grant_id;
        insert into public.billing_order_grants(order_id,grant_id,product_id) values(v_order.id,v_grant_id,v_product.id);
      else
        update public.access_grants set status='active',revoked_at=null,grace_until=null,
          expires_at=case when v_product.code='APP' then v_order.paid_through else null end
        where id=v_grant_id;
      end if;
      if v_product.code='APP' then
        update public.product_trials
        set state='converted',converted_at=coalesce(converted_at,clock_timestamp())
        where user_id=v_order.user_id and product_id=v_product.id and state in ('active','expired');
        update public.access_grants
        set status='expired'
        where user_id=v_order.user_id and product_id=v_product.id and access_type='trial'
          and status in ('active','grace_period','past_due');
      end if;
    end loop;
    v_state:='processed';
  elsif v_event.event_type='PAYMENT_OVERDUE' then
    if v_offer.billing_mode='subscription' and not exists(
      select 1 from public.billing_order_grants bog
      join public.products p on p.id=bog.product_id
      where bog.order_id=v_order.id and p.code='APP'
    ) then
      update public.payment_events set status='failed',processed=false,error_code='grant_link_not_found',last_error_at=clock_timestamp(),next_retry_at=clock_timestamp()+interval '15 minutes' where id=p_event_id;
      return 'retryable';
    end if;
    update public.billing_orders set status='past_due' where id=v_order.id;
    update public.access_grants g set status='grace_period',grace_until=v_order.paid_through+make_interval(hours=>v_offer.grace_period_hours)
    from public.billing_order_grants bog,public.products p
    where bog.order_id=v_order.id and bog.grant_id=g.id and p.id=bog.product_id and p.code='APP';
    v_state:='processed';
  elsif v_event.event_type in ('SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED','PAYMENT_DELETED') then
    update public.billing_orders set status='cancelled' where id=v_order.id;
    v_state:='processed';
  elsif v_event.event_type in ('PAYMENT_REFUNDED','PAYMENT_RECEIVED_IN_CASH_UNDONE') then
    if not exists(select 1 from public.billing_order_grants where order_id=v_order.id) then
      update public.payment_events set status='failed',processed=false,error_code='grant_link_not_found',last_error_at=clock_timestamp(),next_retry_at=clock_timestamp()+interval '15 minutes' where id=p_event_id;
      return 'retryable';
    end if;
    update public.billing_orders set status='refunded' where id=v_order.id;
    update public.access_grants g set status='refunded',revoked_at=clock_timestamp()
    from public.billing_order_grants bog where bog.order_id=v_order.id and bog.grant_id=g.id;
    v_state:='processed';
  elsif v_event.event_type in ('PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL') then
    if not exists(select 1 from public.billing_order_grants where order_id=v_order.id) then
      update public.payment_events set status='failed',processed=false,error_code='grant_link_not_found',last_error_at=clock_timestamp(),next_retry_at=clock_timestamp()+interval '15 minutes' where id=p_event_id;
      return 'retryable';
    end if;
    update public.billing_orders set status='chargeback' where id=v_order.id;
    update public.access_grants g set status='chargeback',revoked_at=clock_timestamp()
    from public.billing_order_grants bog where bog.order_id=v_order.id and bog.grant_id=g.id;
    v_state:='processed';
  elsif v_event.event_type='PAYMENT_CREDIT_CARD_CAPTURE_REFUSED' then
    update public.billing_orders set status='failed' where id=v_order.id;
    v_state:='processed';
  else
    v_state:='ignored';
  end if;
  update public.payment_events set status=v_state,processed=true,processed_at=clock_timestamp(),error_code=null where id=p_event_id;
  return v_state;
exception when others then
  update public.payment_events set status='failed',processed=false,error_code='processor_exception',last_error_at=clock_timestamp(),next_retry_at=clock_timestamp()+interval '15 minutes' where id=p_event_id;
  return 'retryable';
end
$$;

revoke all on function public.mb_commercial_touch_updated_at() from public, anon, authenticated;
revoke all on function public.mb_validate_commercial_grant_target() from public, anon, authenticated;
revoke all on function public.mb_normalize_access_grant_v2() from public,anon,authenticated;
revoke all on function public.mb_normalize_payment_event_v2() from public,anon,authenticated;
revoke all on function public.has_active_access(text) from public, anon;
revoke all on function public.get_my_entitlements() from public, anon;
revoke all on function public.start_my_app_trial() from public, anon;
revoke all on function public.admin_grant_commercial_access_v1(uuid,text[],text,timestamptz,uuid,text) from public, anon, authenticated;
revoke all on function public.bootstrap_commercial_admin_v1(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_revoke_commercial_access_v1(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_get_commercial_access_v1(uuid) from public, anon, authenticated;
revoke all on function public.process_payment_event_v1(uuid) from public, anon, authenticated;
grant execute on function public.has_active_access(text) to authenticated;
grant execute on function public.get_my_entitlements() to authenticated;
grant execute on function public.start_my_app_trial() to authenticated;
grant execute on function public.admin_grant_commercial_access_v1(uuid,text[],text,timestamptz,uuid,text) to service_role;
grant execute on function public.bootstrap_commercial_admin_v1(uuid,uuid,text) to service_role;
grant execute on function public.admin_revoke_commercial_access_v1(uuid,uuid,text) to service_role;
grant execute on function public.admin_get_commercial_access_v1(uuid) to service_role;
grant execute on function public.process_payment_event_v1(uuid) to service_role;

do $preserve_kiwify_secret_rpc$
begin
  if to_regprocedure('public.set_kiwify_webhook_token(text)') is not null then
    execute 'revoke all on function public.set_kiwify_webhook_token(text) from public,anon,authenticated';
    execute 'grant execute on function public.set_kiwify_webhook_token(text) to service_role';
  end if;
end
$preserve_kiwify_secret_rpc$;

-- Phase 1 deliberately preserves the canonical V82 ownership policies. This lets
-- an authorized server bootstrap every legacy owner before the entitlement gate is
-- activated. The activation RPC repeats these checks under one transaction and
-- refuses to lock out any user who already owns financial data.
do $financial_policy_preflight$
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

  end loop;
end
$financial_policy_preflight$;

create or replace function public.activate_commercial_enforcement_v1(
  p_actor_user_id uuid, p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_table text;
  v_policy record;
  v_normalized_qual text;
  v_normalized_check text;
  v_unentitled bigint;
  v_enforced boolean;
begin
  if not exists (select 1 from auth.users where id=p_actor_user_id)
     or length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'valid actor and reason are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mentoria-black:commercial-enforcement-v1',0));
  select enforced into v_enforced from public.commercial_enforcement_state where singleton for update;
  if v_enforced then return false; end if;

  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    if to_regclass('public.'||v_table) is null
       or not (select relrowsecurity from pg_class where oid=to_regclass('public.'||v_table)) then
      raise exception 'commercial enforcement requires RLS table public.%',v_table using errcode='P0001';
    end if;
    select * into v_policy from pg_policies
      where schemaname='public' and tablename=v_table and policyname='mb_v82_own_rows';
    if not found then
      raise exception 'commercial enforcement requires canonical V82 policy on public.%',v_table using errcode='P0001';
    end if;
    v_normalized_qual:=regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g');
    v_normalized_check:=regexp_replace(lower(coalesce(v_policy.with_check,'')),'[[:space:]()]','','g');
    if v_policy.cmd<>'ALL' or v_policy.roles<>array['authenticated']::name[]
       or v_normalized_qual not in ('selectauth.uidasuid=user_id','selectauth.uid=user_id')
       or v_normalized_check not in ('selectauth.uidasuid=user_id','selectauth.uid=user_id')
       or exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=v_table
          and p.policyname<>'mb_v82_own_rows' and p.roles&&array['public','anon','authenticated']::name[]) then
      raise exception 'commercial enforcement refuses policy drift on public.%',v_table using errcode='P0001';
    end if;
    execute format(
      'select count(*) from (select distinct source.user_id from public.%I source '
      'where not exists (select 1 from public.access_grants g join public.products p on p.id=g.product_id '
      'where g.user_id=source.user_id and p.code=''APP'' and p.active and g.started_at<=statement_timestamp() '
      'and ((g.status=''active'' and (g.expires_at is null or g.expires_at>statement_timestamp())) '
      'or (g.status=''grace_period'' and g.grace_until>statement_timestamp())))) missing',v_table
    ) into v_unentitled;
    if v_unentitled<>0 then
      raise exception 'commercial enforcement would lock % legacy owner(s) on public.%',v_unentitled,v_table using errcode='P0001';
    end if;
  end loop;

  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    execute format('drop policy mb_v82_own_rows on public.%I',v_table);
    execute format(
      'create policy mb_commercial_app_access on public.%I for all to authenticated '
      'using ((select auth.uid())=user_id and (select public.has_active_access(''APP''))) '
      'with check ((select auth.uid())=user_id and (select public.has_active_access(''APP'')))',v_table
    );
  end loop;
  update public.commercial_enforcement_state set enforced=true,enforced_at=clock_timestamp(),
    enforced_by=p_actor_user_id,updated_at=clock_timestamp() where singleton;
  insert into public.commercial_admin_audit(actor_user_id,target_user_id,action,reason)
  values(p_actor_user_id,p_actor_user_id,'activate_enforcement',trim(p_reason));
  return true;
end
$$;

create or replace function public.rollback_commercial_enforcement_v1(
  p_actor_user_id uuid, p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare v_table text; v_enforced boolean;
begin
  if not exists(select 1 from auth.users where id=p_actor_user_id)
     or length(trim(coalesce(p_reason,'')))<3 then
    raise exception 'valid actor and reason are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mentoria-black:commercial-enforcement-v1',0));
  select enforced into v_enforced from public.commercial_enforcement_state where singleton for update;
  if not v_enforced then return false; end if;
  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=v_table
      and policyname='mb_commercial_app_access') then
      raise exception 'commercial rollback requires canonical access policy on public.%',v_table using errcode='P0001';
    end if;
    execute format('drop policy mb_commercial_app_access on public.%I',v_table);
    execute format(
      'create policy mb_v82_own_rows on public.%I for all to authenticated '
      'using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',v_table
    );
  end loop;
  update public.commercial_enforcement_state set enforced=false,enforced_at=null,enforced_by=null,
    updated_at=clock_timestamp() where singleton;
  insert into public.commercial_admin_audit(actor_user_id,target_user_id,action,reason)
  values(p_actor_user_id,p_actor_user_id,'rollback_enforcement',trim(p_reason));
  return true;
end
$$;

revoke all on function public.activate_commercial_enforcement_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.rollback_commercial_enforcement_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.activate_commercial_enforcement_v1(uuid,text) to service_role;
grant execute on function public.rollback_commercial_enforcement_v1(uuid,text) to service_role;

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
    'access_grants', 'commercial_admin_audit', 'commercial_enforcement_state', 'billing_customers', 'billing_orders',
    'billing_order_grants', 'billing_subscriptions', 'payment_events'
  ] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || v_table)) then
      raise exception 'commercial access v1 RLS verification failed for public.%', v_table using errcode = 'P0001';
    end if;
  end loop;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('product_trials', 'access_grants', 'commercial_admin_audit', 'commercial_enforcement_state', 'billing_customers', 'billing_orders', 'billing_order_grants', 'billing_subscriptions', 'payment_events')
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) then
    raise exception 'commercial access v1 client write grant verification failed' using errcode = 'P0001';
  end if;

  if (select count(*) from pg_policies where schemaname='public'
      and tablename in ('accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans')
      and policyname='mb_v82_own_rows')<>9
     or (select enforced from public.commercial_enforcement_state where singleton) then
    raise exception 'commercial access v1 must preserve V82 policies until explicit activation' using errcode='P0001';
  end if;

  if exists(
    select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='u'
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['user_id','product_id']::name[]
  ) or exists(
    select 1 from pg_constraint c where c.conrelid='public.payment_events'::regclass and c.contype='u'
      and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
           join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['provider','event_id']::name[]
  ) then
    raise exception 'commercial access v2 legacy uniqueness was not reconciled' using errcode='P0001';
  end if;

  if current_setting('mb.commercial_prestate')='kiwify_legacy' and (
    (select count(*) from public.products where code='APP' and slug='mentoria-black')<>1
    or (select count(*) from public.access_grants)<>1
    or (select count(*) from public.access_grants where source in('manual','kiwify') and environment='legacy')<>1
    or (select count(*) from public.payment_events)<>2
    or (select count(*) from public.payment_events where provider='kiwify' and environment='legacy' and payload is not null)<>2
    or to_regprocedure('public.set_kiwify_webhook_token(text)') is null
  ) then
    raise exception 'commercial access v2 Kiwify preservation verification failed' using errcode='P0001';
  end if;
end
$verify$;

commit;
