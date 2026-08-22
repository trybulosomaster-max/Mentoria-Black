\set ON_ERROR_STOP on
begin;
set local transaction read only;
set local lock_timeout='5s';
set local statement_timeout='2min';

do $preflight$
declare
  v_columns text[];
  v_policy record;
begin
  if to_regprocedure('auth.uid()') is null or to_regclass('auth.users') is null then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: Supabase Auth contract missing' using errcode='P0001';
  end if;
  if to_regclass('public.products') is null or to_regclass('public.access_grants') is null or to_regclass('public.payment_events') is null then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: required Kiwify tables missing' using errcode='P0001';
  end if;

  select array_agg(column_name order by column_name) into v_columns from information_schema.columns where table_schema='public' and table_name='products';
  if v_columns<>array['active','created_at','description','id','name','slug','updated_at']::text[] then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: products shape drift' using errcode='P0001';
  end if;
  select array_agg(column_name order by column_name) into v_columns from information_schema.columns where table_schema='public' and table_name='access_grants';
  if v_columns<>array['created_at','expires_at','external_customer_id','external_purchase_id','id','product_id','revoked_at','source','started_at','status','updated_at','user_id']::text[] then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: access_grants shape drift' using errcode='P0001';
  end if;
  select array_agg(column_name order by column_name) into v_columns from information_schema.columns where table_schema='public' and table_name='payment_events';
  if v_columns<>array['created_at','event_id','event_type','external_customer_id','external_purchase_id','id','payload','processed','processed_at','provider','user_id']::text[] then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: payment_events shape drift' using errcode='P0001';
  end if;

  if exists(
    select 1
    from (values
      ('products','id','uuid','NO'),('products','name','text','NO'),('products','slug','text','NO'),
      ('products','description','text','YES'),('products','active','boolean','NO'),
      ('products','created_at','timestamp with time zone','YES'),('products','updated_at','timestamp with time zone','YES'),
      ('access_grants','id','uuid','NO'),('access_grants','user_id','uuid','NO'),('access_grants','product_id','uuid','NO'),
      ('access_grants','status','text','NO'),('access_grants','source','text','NO'),
      ('access_grants','external_customer_id','text','YES'),('access_grants','external_purchase_id','text','YES'),
      ('access_grants','started_at','timestamp with time zone','NO'),('access_grants','expires_at','timestamp with time zone','YES'),
      ('access_grants','revoked_at','timestamp with time zone','YES'),('access_grants','created_at','timestamp with time zone','YES'),
      ('access_grants','updated_at','timestamp with time zone','YES'),
      ('payment_events','id','uuid','NO'),('payment_events','provider','text','NO'),
      ('payment_events','event_id','text','NO'),('payment_events','event_type','text','NO'),
      ('payment_events','user_id','uuid','YES'),('payment_events','external_customer_id','text','YES'),
      ('payment_events','external_purchase_id','text','YES'),('payment_events','payload','jsonb','NO'),
      ('payment_events','processed','boolean','NO'),('payment_events','processed_at','timestamp with time zone','YES'),
      ('payment_events','created_at','timestamp with time zone','YES')
    ) as expected(table_name,column_name,data_type,is_nullable)
    left join information_schema.columns actual
      on actual.table_schema='public' and actual.table_name=expected.table_name and actual.column_name=expected.column_name
    where actual.column_name is null or actual.data_type<>expected.data_type or actual.is_nullable<>expected.is_nullable
  ) then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: type/nullability drift' using errcode='P0001';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='active' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='true')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='status' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='''active''::text')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='access_grants' and column_name='source' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='''manual''::text')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='payment_events' and column_name='provider' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='''kiwify''::text')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='payment_events' and column_name='processed' and regexp_replace(lower(column_default),'[[:space:]()]','','g')='false') then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: legacy default drift' using errcode='P0001';
  end if;

  if (select count(*) from public.products)<>1
     or (select count(*) from public.products where slug='mentoria-black')<>1
     or (select count(*) from public.access_grants)<>1
     or (select count(*) from public.payment_events)<>2
     or exists(select 1 from public.access_grants where source not in('manual','kiwify'))
     or exists(select 1 from public.access_grants where status not in('active','suspended','revoked','expired'))
     or exists(select 1 from public.payment_events where provider<>'kiwify') then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: row-count/provider checkpoint drift' using errcode='P0001';
  end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.products'::regclass and c.contype='p'
    and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['id']::name[])
     or not exists(select 1 from pg_constraint c where c.conrelid='public.products'::regclass and c.contype='u'
    and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['slug']::name[])
     or not exists(select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='p'
    and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['id']::name[])
     or not exists(select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='u'
    and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['user_id','product_id']::name[])
     or not exists(select 1 from pg_constraint c where c.conrelid='public.payment_events'::regclass and c.contype='p'
    and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['id']::name[])
     or not exists(select 1 from pg_constraint c where c.conrelid='public.payment_events'::regclass and c.contype='u'
    and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['provider','event_id']::name[]) then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: legacy unique contract drift' using errcode='P0001';
  end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='c' and c.convalidated
       and regexp_replace(lower(pg_get_constraintdef(c.oid)),'[[:space:]()]','','g')='checksource=anyarray[''manual''::text,''kiwify''::text]')
     or not exists(select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='c' and c.convalidated
       and regexp_replace(lower(pg_get_constraintdef(c.oid)),'[[:space:]()]','','g')='checkstatus=anyarray[''active''::text,''suspended''::text,''revoked''::text,''expired''::text]')
     or not exists(select 1 from pg_constraint c where c.conrelid='public.payment_events'::regclass and c.contype='c' and c.convalidated
       and regexp_replace(lower(pg_get_constraintdef(c.oid)),'[[:space:]()]','','g')='checkprovider=''kiwify''::text') then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: legacy CHECK drift' using errcode='P0001';
  end if;
  if (select count(*) from pg_constraint where conrelid='public.products'::regclass)<>2
     or (select count(*) from pg_constraint where conrelid='public.access_grants'::regclass)<>6
     or (select count(*) from pg_constraint where conrelid='public.payment_events'::regclass)<>3 then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: unexpected legacy constraint' using errcode='P0001';
  end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='f' and c.confrelid='auth.users'::regclass
       and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['user_id']::name[]
       and (select array_agg(a.attname order by key.ordinality) from unnest(c.confkey) with ordinality key(attnum,ordinality) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=key.attnum)=array['id']::name[])
     or not exists(select 1 from pg_constraint c where c.conrelid='public.access_grants'::regclass and c.contype='f' and c.confrelid='public.products'::regclass
       and (select array_agg(a.attname order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum,ordinality) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum)=array['product_id']::name[]
       and (select array_agg(a.attname order by key.ordinality) from unnest(c.confkey) with ordinality key(attnum,ordinality) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=key.attnum)=array['id']::name[]) then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: ownership FK drift' using errcode='P0001';
  end if;
  if exists(select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
    where c.conrelid in('public.products'::regclass,'public.access_grants'::regclass,'public.payment_events'::regclass)
      and c.contype in('p','u') and (not i.indisvalid or not i.indisready)) then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: invalid legacy constraint index' using errcode='P0001';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.products'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.access_grants'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.payment_events'::regclass) then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: RLS disabled' using errcode='P0001';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename in('products','access_grants','payment_events'))<>3 then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: unexpected or duplicate legacy policy' using errcode='P0001';
  end if;

  select * into v_policy from pg_policies where schemaname='public' and tablename='products' and policyname='products_select_active';
  if not found or v_policy.cmd<>'SELECT' or v_policy.roles<>array['authenticated']::name[]
     or regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g') not in('active=true','active') then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: products policy drift' using errcode='P0001';
  end if;
  select * into v_policy from pg_policies where schemaname='public' and tablename='access_grants' and policyname='access_grants_select_own';
  if not found or v_policy.cmd<>'SELECT' or v_policy.roles<>array['authenticated']::name[]
     or regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g') not in('user_id=auth.uid','auth.uid=user_id') then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: access_grants policy drift' using errcode='P0001';
  end if;
  select * into v_policy from pg_policies where schemaname='public' and tablename='payment_events' and policyname='payment_events_no_client_access';
  if not found or v_policy.cmd<>'ALL' or not(v_policy.roles @> array['anon','authenticated']::name[])
     or regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g')<>'false'
     or regexp_replace(lower(coalesce(v_policy.with_check,'')),'[[:space:]()]','','g')<>'false' then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: payment_events policy drift' using errcode='P0001';
  end if;
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.has_active_access(text)')
       and not prosecdef and provolatile='s' and pronargdefaults=1 and prorettype='boolean'::regtype
       and prosrc ilike '%access_grants%' and prosrc ilike '%products%' and prosrc ilike '%auth.uid%')
     or not exists(select 1 from pg_proc where oid=to_regprocedure('public.set_kiwify_webhook_token(text)')
       and prosecdef and prorettype='void'::regtype
       and exists(select 1 from unnest(coalesce(proconfig,array[]::text[])) as configs(setting) where lower(setting) like 'search_path=public,%vault%')) then
    raise exception 'COMMERCIAL_ACCESS_V2_NO_GO: legacy function drift' using errcode='P0001';
  end if;
end
$preflight$;

select jsonb_build_object(
  'classification','KIWIFY_LEGACY_GO',
  'tables',jsonb_build_object('products',(select count(*) from public.products),'access_grants',(select count(*) from public.access_grants),'payment_events',(select count(*) from public.payment_events)),
  'app_slug_mapping_candidates',(select count(*) from public.products where slug='mentoria-black'),
  'grant_sources',(select jsonb_object_agg(source,row_count) from(select source,count(*) row_count from public.access_grants group by source) grouped),
  'grant_statuses',(select jsonb_object_agg(status,row_count) from(select status,count(*) row_count from public.access_grants group by status) grouped),
  'event_providers',(select jsonb_object_agg(provider,row_count) from(select provider,count(*) row_count from public.payment_events group by provider) grouped),
  'rls_enabled',(select count(*) from pg_class where oid in('public.products'::regclass,'public.access_grants'::regclass,'public.payment_events'::regclass) and relrowsecurity),
  'valid_primary_unique_indexes',(select count(*) from pg_constraint c join pg_index i on i.indexrelid=c.conindid where c.conrelid in('public.products'::regclass,'public.access_grants'::regclass,'public.payment_events'::regclass) and c.contype in('p','u') and i.indisvalid and i.indisready),
  'legacy_check_constraints',(select count(*) from pg_constraint where conrelid in('public.access_grants'::regclass,'public.payment_events'::regclass) and contype='c' and convalidated),
  'ownership_foreign_keys',(select count(*) from pg_constraint where conrelid='public.access_grants'::regclass and contype='f'),
  'legacy_policies',(select count(*) from pg_policies where schemaname='public' and policyname in('products_select_active','access_grants_select_own','payment_events_no_client_access')),
  'legacy_functions',(select count(*) from pg_proc where oid in('public.has_active_access(text)'::regprocedure,'public.set_kiwify_webhook_token(text)'::regprocedure)),
  'client_table_write_privileges',(
    select count(*) from information_schema.role_table_grants
    where table_schema='public' and table_name in('products','access_grants','payment_events')
      and grantee in('anon','authenticated') and privilege_type in('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES')
  ),
  'kiwify_secret_client_execute_count',(
    select count(*) from (values('anon'::name),('authenticated'::name)) roles(role_name)
    where has_function_privilege(role_name,'public.set_kiwify_webhook_token(text)','EXECUTE')
  ),
  'payloads_read',false,
  'personal_identifiers_returned',false
) as commercial_access_v2_preflight;

rollback;
