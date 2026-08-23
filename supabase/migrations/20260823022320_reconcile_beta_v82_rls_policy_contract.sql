begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_advisory_xact_lock(
  hashtextextended('mentoria-black:reconcile-beta-v82-rls-policy-contract', 0)
);

do $reconcile$
declare
  v_table text;
  v_legacy_policy text;
  v_policy record;
  v_policy_count integer;
  v_legacy_exists boolean;
  v_canonical_exists boolean;
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
  ), ''))
  into v_before_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(array[
      'accounts','cards','categories','goals','assets','liabilities',
      'recurring','transactions','monthly_plans'
    ]);

  select md5(coalesce(string_agg(
    pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text
  ), ''))
  into v_before_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';

  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'RLS reconciliation requires public.%', v_table
        using errcode = 'P0001';
    end if;

    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(format('public.%I', v_table))) then
      raise exception 'RLS reconciliation requires RLS on public.%', v_table
        using errcode = 'P0001';
    end if;

    if (select c.relforcerowsecurity from pg_class c where c.oid = to_regclass(format('public.%I', v_table))) then
      raise exception 'RLS reconciliation refuses FORCE RLS drift on public.%', v_table
        using errcode = 'P0001';
    end if;

    v_legacy_policy := v_table || '_own_rows';

    select count(*)::integer,
           bool_or(policyname = v_legacy_policy),
           bool_or(policyname = 'mb_v82_own_rows')
    into v_policy_count, v_legacy_exists, v_canonical_exists
    from pg_policies
    where schemaname = 'public' and tablename = v_table;

    if v_policy_count <> 1 or (v_legacy_exists and v_canonical_exists) then
      raise exception 'RLS reconciliation refuses policy set drift on public.%', v_table
        using errcode = 'P0001';
    end if;

    if not coalesce(v_legacy_exists, false) and not coalesce(v_canonical_exists, false) then
      raise exception 'RLS reconciliation found unknown policy on public.%', v_table
        using errcode = 'P0001';
    end if;

    select * into strict v_policy
    from pg_policies
    where schemaname = 'public'
      and tablename = v_table
      and policyname in (v_legacy_policy, 'mb_v82_own_rows');

    v_normalized_using := regexp_replace(
      lower(coalesce(v_policy.qual, '')), '[[:space:]()]', '', 'g'
    );
    v_normalized_check := regexp_replace(
      lower(coalesce(v_policy.with_check, '')), '[[:space:]()]', '', 'g'
    );

    if v_policy.cmd <> 'ALL'
       or v_policy.roles <> array['authenticated']::name[]
       or v_policy.permissive <> 'PERMISSIVE'
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
      raise exception 'RLS reconciliation found semantic drift on public.%', v_table
        using errcode = 'P0001';
    end if;

    execute format('select count(*) from public.%I', v_table) into v_count;
    v_before_counts := v_before_counts || jsonb_build_object(v_table, v_count);

    if v_legacy_exists then
      execute format(
        'alter policy %I on public.%I rename to mb_v82_own_rows',
        v_legacy_policy,
        v_table
      );
    end if;
  end loop;

  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    select count(*)::integer into v_policy_count
    from pg_policies
    where schemaname = 'public' and tablename = v_table;

    if v_policy_count <> 1 then
      raise exception 'RLS reconciliation post-check found policy count drift on public.%', v_table
        using errcode = 'P0001';
    end if;

    select * into strict v_policy
    from pg_policies
    where schemaname = 'public'
      and tablename = v_table
      and policyname = 'mb_v82_own_rows';

    v_normalized_using := regexp_replace(
      lower(coalesce(v_policy.qual, '')), '[[:space:]()]', '', 'g'
    );
    v_normalized_check := regexp_replace(
      lower(coalesce(v_policy.with_check, '')), '[[:space:]()]', '', 'g'
    );

    if v_policy.cmd <> 'ALL'
       or v_policy.roles <> array['authenticated']::name[]
       or v_policy.permissive <> 'PERMISSIVE'
       or v_normalized_using not in (
         'selectauth.uidasuid=user_id',
         'selectauth.uid=user_id',
         'selectauth.uidasuidisnotnullandselectauth.uidasuid=user_id'
       )
       or v_normalized_check not in (
         'selectauth.uidasuid=user_id',
         'selectauth.uid=user_id',
         'selectauth.uidasuidisnotnullandselectauth.uidasuid=user_id'
       )
       or not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(format('public.%I', v_table)))
       or (select c.relforcerowsecurity from pg_class c where c.oid = to_regclass(format('public.%I', v_table))) then
      raise exception 'RLS reconciliation post-check found contract drift on public.%', v_table
        using errcode = 'P0001';
    end if;

    execute format('select count(*) from public.%I', v_table) into v_count;
    v_after_counts := v_after_counts || jsonb_build_object(v_table, v_count);
  end loop;

  select md5(coalesce(string_agg(
    concat_ws('|', table_name, grantee, privilege_type, is_grantable),
    E'\n' order by table_name, grantee, privilege_type, is_grantable
  ), ''))
  into v_after_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any(array[
      'accounts','cards','categories','goals','assets','liabilities',
      'recurring','transactions','monthly_plans'
    ]);

  select md5(coalesce(string_agg(
    pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text
  ), ''))
  into v_after_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';

  if v_before_counts is distinct from v_after_counts then
    raise exception 'RLS reconciliation changed protected table counts'
      using errcode = 'P0001';
  end if;
  if v_before_grants is distinct from v_after_grants then
    raise exception 'RLS reconciliation changed grants'
      using errcode = 'P0001';
  end if;
  if v_before_functions is distinct from v_after_functions then
    raise exception 'RLS reconciliation changed public functions'
      using errcode = 'P0001';
  end if;
end
$reconcile$;

commit;
