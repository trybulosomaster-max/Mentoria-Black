-- Production-only V82 access/default reconciliation. This follows the two
-- structural migrations and does not rewrite historical application rows.
begin;
set local lock_timeout='15s';
set local statement_timeout='5min';
select pg_advisory_xact_lock(hashtextextended('mentoria-black:v82:production-chain',0));

create or replace function pg_temp.mb_v82_access_normalize(p_value text) returns text
language sql immutable as $$
  select regexp_replace(lower(trim(coalesce(p_value,''))),'[[:space:]]+',' ','g')
$$;

create or replace function pg_temp.mb_v82_policy_expression_is_owner(p_value text) returns boolean
language sql immutable as $$
  select regexp_replace(lower(coalesce(p_value,'')),'[[:space:]()]','','g') in (
    'selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id',
    'user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid'
  )
$$;

create or replace function pg_temp.mb_v82_ensure_not_valid_check(
  p_table regclass,p_name name,p_expected text,p_create text
) returns void language plpgsql as $$
declare v_type "char";v_definition text;v_validated boolean;
begin
  select contype,pg_get_constraintdef(oid),convalidated
    into v_type,v_definition,v_validated
  from pg_constraint where conrelid=p_table and conname=p_name;
  if not found then
    execute p_create;
    select contype,pg_get_constraintdef(oid),convalidated
      into v_type,v_definition,v_validated
    from pg_constraint where conrelid=p_table and conname=p_name;
  end if;
  if v_type<>'c'
     or pg_temp.mb_v82_access_normalize(v_definition)<>pg_temp.mb_v82_access_normalize(p_expected)
     or v_validated then
    raise exception 'V82 schema drift: constraint %.% is incompatible: %',p_table,p_name,v_definition using errcode='P0001';
  end if;
end$$;

do $preflight$
declare
  v_table text;
  v_policy record;
  v_default text;
  v_type oid;
  v_not_null boolean;
  v_api_policy_count integer;
begin
  if to_regprocedure('public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)') is null
     or to_regprocedure('public.materialize_recurring_occurrences_v82(date)') is null
     or to_regclass('public.transactions_user_operation_uidx') is null
     or to_regclass('public.recurring_user_active_next_date_v82_idx') is null then
    raise exception 'V82 schema drift: structural migrations 20260820161846 and 20260820195658 must complete first' using errcode='P0001';
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.transactions'::regclass and conname='transactions_account_user_fkey'
  ) or not exists(
    select 1 from pg_constraint
    where conrelid='public.recurring'::regclass and conname='recurring_account_user_fkey'
  ) then
    raise exception 'V82 schema drift: compound ownership foreign keys are missing' using errcode='P0001';
  end if;

  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    if to_regclass('public.'||v_table) is null then
      raise exception 'V82 schema drift: required private table public.% is missing',v_table using errcode='P0001';
    end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||v_table)) then
      raise exception 'V82 schema drift: RLS is disabled on public.%',v_table using errcode='P0001';
    end if;
    select atttypid,attnotnull into v_type,v_not_null
    from pg_attribute
    where attrelid=to_regclass('public.'||v_table) and attname='user_id'
      and attnum>0 and not attisdropped;
    if not found or v_type<>'uuid'::regtype::oid or not v_not_null then
      raise exception 'V82 schema drift: public.%.user_id must be NOT NULL uuid',v_table using errcode='P0001';
    end if;

    select count(*) into v_api_policy_count
    from pg_policies
    where schemaname='public' and tablename=v_table
      and roles&&array['public','anon','authenticated']::name[];
    if v_api_policy_count=0 then
      raise exception 'V82 policy drift: public.% has no API ownership policy',v_table using errcode='P0001';
    end if;

    for v_policy in
      select * from pg_policies
      where schemaname='public' and tablename=v_table
        and roles&&array['public','anon','authenticated']::name[]
    loop
      if v_policy.permissive<>'PERMISSIVE'
         or not (v_policy.roles<@array['public','anon','authenticated']::name[])
         or (v_policy.cmd in ('ALL','SELECT','UPDATE','DELETE')
             and not pg_temp.mb_v82_policy_expression_is_owner(v_policy.qual))
         or (v_policy.cmd='INSERT'
             and not pg_temp.mb_v82_policy_expression_is_owner(v_policy.with_check))
         or (v_policy.cmd in ('ALL','UPDATE') and v_policy.with_check is not null
             and not pg_temp.mb_v82_policy_expression_is_owner(v_policy.with_check)) then
        raise exception 'V82 policy drift: public.% policy % is not provably equivalent to owner-only access',v_table,v_policy.policyname using errcode='P0001';
      end if;
    end loop;

    if not exists(
      select 1 from pg_policies where schemaname='public' and tablename=v_table
        and roles&&array['public','authenticated']::name[] and cmd in ('ALL','SELECT')
        and pg_temp.mb_v82_policy_expression_is_owner(qual)
    ) or not exists(
      select 1 from pg_policies where schemaname='public' and tablename=v_table
        and roles&&array['public','authenticated']::name[] and cmd in ('ALL','INSERT')
        and pg_temp.mb_v82_policy_expression_is_owner(coalesce(with_check,qual))
    ) or not exists(
      select 1 from pg_policies where schemaname='public' and tablename=v_table
        and roles&&array['public','authenticated']::name[] and cmd in ('ALL','UPDATE')
        and pg_temp.mb_v82_policy_expression_is_owner(qual)
        and pg_temp.mb_v82_policy_expression_is_owner(coalesce(with_check,qual))
    ) or not exists(
      select 1 from pg_policies where schemaname='public' and tablename=v_table
        and roles&&array['public','authenticated']::name[] and cmd in ('ALL','DELETE')
        and pg_temp.mb_v82_policy_expression_is_owner(qual)
    ) then
      raise exception 'V82 policy drift: public.% existing policies do not prove owner-only CRUD coverage',v_table using errcode='P0001';
    end if;
  end loop;

  select pg_get_expr(d.adbin,d.adrelid) into v_default
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.categories'::regclass and a.attname='kind'
    and a.atttypid='text'::regtype and a.attnum>0 and not a.attisdropped;
  if not found or pg_temp.mb_v82_access_normalize(v_default) not in ($d$'expense'::text$d$,$d$'despesa'::text$d$) then
    raise exception 'V82 schema drift: categories.kind default is incompatible: %',v_default using errcode='P0001';
  end if;

  select pg_get_expr(d.adbin,d.adrelid) into v_default
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.recurring'::regclass and a.attname='type'
    and a.atttypid='text'::regtype and a.attnum>0 and not a.attisdropped;
  if not found or pg_temp.mb_v82_access_normalize(v_default) not in ($d$'expense'::text$d$,$d$'despesa'::text$d$) then
    raise exception 'V82 schema drift: recurring.type default is incompatible: %',v_default using errcode='P0001';
  end if;
end
$preflight$;

-- Revoke table and column grants before restoring the minimal authenticated CRUD
-- contract. PUBLIC is included so anon cannot inherit a table privilege indirectly.
do $grants$
declare v_table text;v_columns text;
begin
  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    execute format('revoke all privileges on table public.%I from public,anon,authenticated',v_table);
    select string_agg(quote_ident(attname),',' order by attnum) into v_columns
    from pg_attribute
    where attrelid=to_regclass('public.'||v_table) and attnum>0 and not attisdropped;
    if v_columns is not null then
      execute format('revoke all privileges (%s) on table public.%I from public,anon,authenticated',v_columns,v_table);
    end if;
    execute format('grant select,insert,update,delete on table public.%I to authenticated',v_table);
  end loop;
end
$grants$;

-- recovery-test-checkpoint: migration-3-mid

-- Consolidate only policies already proven equivalent to owner-only CRUD.
do $policies$
declare v_table text;v_policy record;
begin
  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    for v_policy in
      select policyname from pg_policies
      where schemaname='public' and tablename=v_table
        and roles&&array['public','anon','authenticated']::name[]
    loop
      execute format('drop policy %I on public.%I',v_policy.policyname,v_table);
    end loop;
    execute format(
      'create policy mb_v82_own_rows on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',
      v_table
    );
  end loop;
end
$policies$;

alter table public.categories alter column kind set default 'despesa';
alter table public.recurring alter column type set default 'despesa';

-- NOT VALID preserves any legacy English values while enforcing the reviewed
-- vocabulary for new or changed rows.
select pg_temp.mb_v82_ensure_not_valid_check(
  'public.categories','categories_kind_v82',
  $d$check ((lower(kind) = any (array['receita'::text, 'despesa'::text, 'income'::text, 'expense'::text]))) not valid$d$,
  $d$alter table public.categories add constraint categories_kind_v82 check (lower(kind) in ('receita','despesa','income','expense')) not valid$d$
);
select pg_temp.mb_v82_ensure_not_valid_check(
  'public.recurring','recurring_type_v82',
  $d$check ((lower(type) = any (array['receita'::text, 'income'::text, 'revenue'::text, 'despesa'::text, 'expense'::text, 'investimento'::text, 'investment'::text, 'transferencia'::text, 'transferência'::text, 'transfer'::text, 'resgate'::text, 'rescue'::text, 'withdrawal'::text]))) not valid$d$,
  $d$alter table public.recurring add constraint recurring_type_v82 check (lower(type) in ('receita','income','revenue','despesa','expense','investimento','investment','transferencia','transferência','transfer','resgate','rescue','withdrawal')) not valid$d$
);

do $verify$
declare v_table text;v_default text;v_policy_count integer;v_bad_acl integer;
begin
  foreach v_table in array array[
    'accounts','cards','categories','goals','assets','liabilities',
    'recurring','transactions','monthly_plans'
  ] loop
    select count(*) into v_policy_count
    from pg_policies
    where schemaname='public' and tablename=v_table
      and roles&&array['public','anon','authenticated']::name[];
    if v_policy_count<>1 or not exists(
      select 1 from pg_policies
      where schemaname='public' and tablename=v_table
        and policyname='mb_v82_own_rows' and permissive='PERMISSIVE'
        and roles=array['authenticated']::name[] and cmd='ALL'
        and pg_temp.mb_v82_policy_expression_is_owner(qual)
        and pg_temp.mb_v82_policy_expression_is_owner(with_check)
    ) then
      raise exception 'V82 policy reconciliation failed for public.%',v_table using errcode='P0001';
    end if;

    select count(*) into v_bad_acl
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    left join pg_roles r on r.oid=acl.grantee
    where c.oid=to_regclass('public.'||v_table)
      and (acl.grantee=0 or r.rolname='anon')
      and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
    if v_bad_acl>0
       or has_table_privilege('anon',to_regclass('public.'||v_table),'select')
       or has_table_privilege('anon',to_regclass('public.'||v_table),'insert')
       or has_table_privilege('anon',to_regclass('public.'||v_table),'update')
       or has_table_privilege('anon',to_regclass('public.'||v_table),'delete')
       or has_table_privilege('anon',to_regclass('public.'||v_table),'truncate')
       or has_table_privilege('anon',to_regclass('public.'||v_table),'references')
       or has_table_privilege('anon',to_regclass('public.'||v_table),'trigger') then
      raise exception 'V82 grant reconciliation failed: public.% remains available to PUBLIC/anon',v_table using errcode='P0001';
    end if;

    select count(*) into v_bad_acl
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    join pg_roles r on r.oid=acl.grantee
    where c.oid=to_regclass('public.'||v_table) and r.rolname='authenticated'
      and acl.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');
    if v_bad_acl>0
       or has_table_privilege('authenticated',to_regclass('public.'||v_table),'truncate')
       or has_table_privilege('authenticated',to_regclass('public.'||v_table),'references')
       or has_table_privilege('authenticated',to_regclass('public.'||v_table),'trigger')
       or not has_table_privilege('authenticated',to_regclass('public.'||v_table),'select')
       or not has_table_privilege('authenticated',to_regclass('public.'||v_table),'insert')
       or not has_table_privilege('authenticated',to_regclass('public.'||v_table),'update')
       or not has_table_privilege('authenticated',to_regclass('public.'||v_table),'delete') then
      raise exception 'V82 grant reconciliation failed for authenticated on public.%',v_table using errcode='P0001';
    end if;

    select count(*) into v_bad_acl
    from pg_attribute a
    cross join lateral aclexplode(a.attacl) acl
    left join pg_roles r on r.oid=acl.grantee
    where a.attrelid=to_regclass('public.'||v_table) and a.attnum>0 and not a.attisdropped
      and (acl.grantee=0 or r.rolname in ('anon','authenticated'));
    if v_bad_acl>0 then
      raise exception 'V82 grant reconciliation failed: column ACL remains on public.%',v_table using errcode='P0001';
    end if;
  end loop;

  select pg_get_expr(d.adbin,d.adrelid) into v_default
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.categories'::regclass and a.attname='kind';
  if pg_temp.mb_v82_access_normalize(v_default)<>$d$'despesa'::text$d$ then
    raise exception 'V82 default reconciliation failed for categories.kind' using errcode='P0001';
  end if;
  select pg_get_expr(d.adbin,d.adrelid) into v_default
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid='public.recurring'::regclass and a.attname='type';
  if pg_temp.mb_v82_access_normalize(v_default)<>$d$'despesa'::text$d$ then
    raise exception 'V82 default reconciliation failed for recurring.type' using errcode='P0001';
  end if;
end
$verify$;

commit;
