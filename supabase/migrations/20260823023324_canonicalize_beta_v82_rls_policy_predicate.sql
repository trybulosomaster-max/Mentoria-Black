begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_advisory_xact_lock(
  hashtextextended('mentoria-black:reconcile-beta-v82-rls-policy-contract', 0)
);

do $canonicalize$
declare
  v_table text;
  v_policy record;
  v_policy_count integer;
  v_normalized_using text;
  v_normalized_check text;
  v_before_counts jsonb := '{}'::jsonb;
  v_after_counts jsonb := '{}'::jsonb;
  v_before_grants text;
  v_after_grants text;
  v_before_functions text;
  v_after_functions text;
  v_count bigint;
begin
  select md5(coalesce(string_agg(
    concat_ws('|', table_name, grantee, privilege_type, is_grantable),
    E'\n' order by table_name, grantee, privilege_type, is_grantable
  ), '')) into v_before_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(array[
      'accounts','cards','categories','goals','assets','liabilities',
      'recurring','transactions','monthly_plans'
    ]);

  select md5(coalesce(string_agg(
    pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text
  ), '')) into v_before_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';

  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    if to_regclass(format('public.%I',v_table)) is null
       or not (select relrowsecurity from pg_class where oid=to_regclass(format('public.%I',v_table)))
       or (select relforcerowsecurity from pg_class where oid=to_regclass(format('public.%I',v_table))) then
      raise exception 'canonical RLS predicate requires the expected RLS table public.%',v_table
        using errcode='P0001';
    end if;

    select count(*)::integer into v_policy_count
    from pg_policies where schemaname='public' and tablename=v_table;
    if v_policy_count<>1 then
      raise exception 'canonical RLS predicate refuses policy set drift on public.%',v_table
        using errcode='P0001';
    end if;

    select * into strict v_policy
    from pg_policies
    where schemaname='public' and tablename=v_table and policyname='mb_v82_own_rows';

    v_normalized_using:=regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g');
    v_normalized_check:=regexp_replace(lower(coalesce(v_policy.with_check,'')),'[[:space:]()]','','g');
    if v_policy.cmd<>'ALL'
       or v_policy.roles<>array['authenticated']::name[]
       or v_policy.permissive<>'PERMISSIVE'
       or v_normalized_using not in (
         'selectauth.uidasuid=user_id',
         'selectauth.uid=user_id',
         'selectauth.uidasuidisnotnullandselectauth.uidasuid=user_id'
       )
       or v_normalized_check not in (
         'selectauth.uidasuid=user_id',
         'selectauth.uid=user_id',
         'selectauth.uidasuidisnotnullandselectauth.uidasuid=user_id'
       ) then
      raise exception 'canonical RLS predicate found semantic drift on public.%',v_table
        using errcode='P0001';
    end if;

    execute format('select count(*) from public.%I',v_table) into v_count;
    v_before_counts:=v_before_counts||jsonb_build_object(v_table,v_count);

    execute format(
      'alter policy mb_v82_own_rows on public.%I to authenticated '
      'using ((select auth.uid())=user_id) '
      'with check ((select auth.uid())=user_id)',
      v_table
    );
  end loop;

  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    select * into strict v_policy
    from pg_policies
    where schemaname='public' and tablename=v_table and policyname='mb_v82_own_rows';
    v_normalized_using:=regexp_replace(lower(coalesce(v_policy.qual,'')),'[[:space:]()]','','g');
    v_normalized_check:=regexp_replace(lower(coalesce(v_policy.with_check,'')),'[[:space:]()]','','g');
    if v_policy.cmd<>'ALL'
       or v_policy.roles<>array['authenticated']::name[]
       or v_policy.permissive<>'PERMISSIVE'
       or v_normalized_using not in ('selectauth.uidasuid=user_id','selectauth.uid=user_id')
       or v_normalized_check not in ('selectauth.uidasuid=user_id','selectauth.uid=user_id') then
      raise exception 'canonical RLS predicate post-check failed on public.%',v_table
        using errcode='P0001';
    end if;
    execute format('select count(*) from public.%I',v_table) into v_count;
    v_after_counts:=v_after_counts||jsonb_build_object(v_table,v_count);
  end loop;

  select md5(coalesce(string_agg(
    concat_ws('|', table_name, grantee, privilege_type, is_grantable),
    E'\n' order by table_name, grantee, privilege_type, is_grantable
  ), '')) into v_after_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(array[
      'accounts','cards','categories','goals','assets','liabilities',
      'recurring','transactions','monthly_plans'
    ]);

  select md5(coalesce(string_agg(
    pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text
  ), '')) into v_after_functions
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public';

  if v_before_counts is distinct from v_after_counts then
    raise exception 'canonical RLS predicate changed protected table counts' using errcode='P0001';
  end if;
  if v_before_grants is distinct from v_after_grants then
    raise exception 'canonical RLS predicate changed grants' using errcode='P0001';
  end if;
  if v_before_functions is distinct from v_after_functions then
    raise exception 'canonical RLS predicate changed public functions' using errcode='P0001';
  end if;
end
$canonicalize$;

commit;
