-- READ ONLY. Run against the explicitly selected production project before the
-- reviewed V82 chain. It reports the current phase and rejects unsupported V81 drift.
begin transaction read only;

do $preflight$
declare
  v_table text;
  v_column record;
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'V82 preflight: PostgreSQL 15 or newer is required';
  end if;
  foreach v_table in array array['accounts','cards','goals','assets','liabilities','recurring','transactions'] loop
    if to_regclass('public.'||v_table) is null then
      raise exception 'V82 preflight drift: required table public.% is missing',v_table;
    end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||v_table)) then
      raise exception 'V82 preflight drift: RLS is disabled on public.%',v_table;
    end if;
  end loop;
  for v_column in
    select * from (values
      ('accounts','id','uuid'),('accounts','user_id','uuid'),
      ('cards','id','uuid'),('cards','user_id','uuid'),
      ('goals','id','uuid'),('goals','user_id','uuid'),
      ('assets','id','uuid'),('assets','user_id','uuid'),
      ('liabilities','id','uuid'),('liabilities','user_id','uuid'),
      ('recurring','id','uuid'),('recurring','user_id','uuid'),('recurring','amount','numeric'),
      ('transactions','id','uuid'),('transactions','user_id','uuid'),
      ('transactions','amount','numeric'),('transactions','status','text')
    ) as expected(table_name,column_name,type_name)
  loop
    if not exists(
      select 1 from pg_attribute
      where attrelid=to_regclass('public.'||v_column.table_name)
        and attname=v_column.column_name and atttypid=v_column.type_name::regtype
        and attnum>0 and not attisdropped
    ) then
      raise exception 'V82 preflight drift: %.% is missing or has the wrong type',v_column.table_name,v_column.column_name;
    end if;
  end loop;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'V82 preflight drift: auth.uid() is missing';
  end if;
end$preflight$;

select json_build_object(
  'database',current_database(),
  'server_version',current_setting('server_version'),
  'migration_20260820161846',case
    when to_regprocedure('public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)') is not null
     and to_regclass('public.transactions_user_operation_uidx') is not null then 'complete'
    when exists(select 1 from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='operation_id') then 'partial-compatible-or-drift'
    else 'pending'
  end,
  'migration_20260820195658',case
    when to_regprocedure('public.materialize_recurring_occurrences_v82(date)') is not null
     and to_regclass('public.recurring_user_active_next_date_v82_idx') is not null then 'complete'
    when exists(select 1 from information_schema.columns where table_schema='public' and table_name='recurring' and column_name='source_account_id') then 'partial-compatible-or-drift'
    else 'pending'
  end
) as v82_preflight;

rollback;
