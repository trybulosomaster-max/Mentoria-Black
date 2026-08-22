-- Canonical structured references for recurring V82 operations. This file is
-- transaction-safe, retryable, and rejects incompatible catalog drift.
begin;
set local lock_timeout='15s';
set local statement_timeout='5min';
select pg_advisory_xact_lock(hashtextextended('mentoria-black:v82:production-chain',0));

create or replace function pg_temp.mb_v82_normalize(p_value text) returns text
language sql immutable as $$
  select regexp_replace(lower(trim(p_value)),'[[:space:]]+',' ','g')
$$;

create or replace function pg_temp.mb_v82_ensure_column(
  p_table regclass,p_column name,p_type regtype
) returns void language plpgsql as $$
declare v_type oid;v_not_null boolean;v_has_default boolean;
begin
  select atttypid,attnotnull,atthasdef into v_type,v_not_null,v_has_default
  from pg_attribute where attrelid=p_table and attname=p_column and attnum>0 and not attisdropped;
  if not found then
    execute format('alter table %s add column %I %s',p_table,p_column,p_type::text);
    select atttypid,attnotnull,atthasdef into v_type,v_not_null,v_has_default
    from pg_attribute where attrelid=p_table and attname=p_column and attnum>0 and not attisdropped;
  end if;
  if v_type<>p_type::oid or v_not_null or v_has_default then
    raise exception 'V82 schema drift: %.% must be nullable %, without default',p_table,p_column,p_type using errcode='P0001';
  end if;
end$$;

create or replace function pg_temp.mb_v82_ensure_constraint(
  p_table regclass,p_name name,p_type "char",p_expected text,p_create text,p_not_valid boolean default false
) returns void language plpgsql as $$
declare v_type "char";v_definition text;v_validated boolean;
begin
  select contype,pg_get_constraintdef(oid),convalidated into v_type,v_definition,v_validated
  from pg_constraint where conrelid=p_table and conname=p_name;
  if not found then
    execute p_create;
    select contype,pg_get_constraintdef(oid),convalidated into v_type,v_definition,v_validated
    from pg_constraint where conrelid=p_table and conname=p_name;
  end if;
  if v_type<>p_type or pg_temp.mb_v82_normalize(v_definition)<>pg_temp.mb_v82_normalize(p_expected)
     or (p_not_valid and v_validated) then
    raise exception 'V82 schema drift: constraint %.% is incompatible: %',p_table,p_name,v_definition using errcode='P0001';
  end if;
end$$;

create or replace function pg_temp.mb_v82_ensure_index(
  p_table regclass,p_name name,p_expected text,p_create text
) returns void language plpgsql as $$
declare v_table oid;v_definition text;
begin
  select i.indrelid,pg_get_indexdef(c.oid) into v_table,v_definition
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid
  where n.nspname='public' and c.relname=p_name;
  if not found then
    execute p_create;
    select i.indrelid,pg_get_indexdef(c.oid) into v_table,v_definition
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid
    where n.nspname='public' and c.relname=p_name;
  end if;
  if v_table<>p_table::oid or pg_temp.mb_v82_normalize(v_definition)<>pg_temp.mb_v82_normalize(p_expected) then
    raise exception 'V82 schema drift: index public.% is incompatible: %',p_name,v_definition using errcode='P0001';
  end if;
end$$;

create or replace function pg_temp.mb_v82_assert_function(
  p_signature text,p_body_md5 text,p_return regtype,p_setof boolean
) returns void language plpgsql as $$
declare v_oid regprocedure;v_name name;v_body text;v_security_definer boolean;v_config text[];v_return oid;v_setof boolean;v_language name;
begin
  v_oid:=to_regprocedure(p_signature);
  v_name:=split_part(split_part(p_signature,'(',1),'.',2);
  if v_oid is null then
    if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=v_name) then
      raise exception 'V82 schema drift: function %.% exists with an unexpected signature','public',v_name using errcode='P0001';
    end if;
    return;
  end if;
  select md5(p.prosrc),p.prosecdef,p.proconfig,p.prorettype,p.proretset,l.lanname
    into v_body,v_security_definer,v_config,v_return,v_setof,v_language
  from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=v_oid;
  if v_body<>p_body_md5 or v_security_definer or v_config<>array['search_path=public, pg_temp']::text[]
     or v_return<>p_return::oid or v_setof<>p_setof or v_language<>'plpgsql' then
    raise exception 'V82 schema drift: function % is incompatible',p_signature using errcode='P0001';
  end if;
end$$;

do $preflight$
declare v_table text;
begin
  foreach v_table in array array['accounts','assets','goals','recurring','transactions'] loop
    if to_regclass('public.'||v_table) is null then
      raise exception 'V82 recurring preflight drift: required table public.% is missing',v_table using errcode='P0001';
    end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||v_table)) then
      raise exception 'V82 recurring preflight drift: RLS is disabled on public.%',v_table using errcode='P0001';
    end if;
  end loop;
  if to_regprocedure('public.create_investment_v82(uuid,uuid,uuid,numeric,date,text,text)') is null
     or to_regclass('public.transactions_user_recurring_occurrence_uidx') is null then
    raise exception 'V82 recurring preflight drift: migration 20260820161846 is not complete' using errcode='P0001';
  end if;
end$preflight$;

select pg_temp.mb_v82_ensure_column('public.recurring','source_account_id','uuid');
select pg_temp.mb_v82_ensure_column('public.recurring','destination_account_id','uuid');
select pg_temp.mb_v82_ensure_column('public.recurring','asset_id','uuid');

select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_source_account_user_fkey','f','foreign key (source_account_id, user_id) references accounts(id, user_id) on delete set null (source_account_id) not valid','alter table public.recurring add constraint recurring_source_account_user_fkey foreign key (source_account_id,user_id) references public.accounts(id,user_id) on delete set null (source_account_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_destination_account_user_fkey','f','foreign key (destination_account_id, user_id) references accounts(id, user_id) on delete set null (destination_account_id) not valid','alter table public.recurring add constraint recurring_destination_account_user_fkey foreign key (destination_account_id,user_id) references public.accounts(id,user_id) on delete set null (destination_account_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_asset_user_fkey','f','foreign key (asset_id, user_id) references assets(id, user_id) on delete set null (asset_id) not valid','alter table public.recurring add constraint recurring_asset_user_fkey foreign key (asset_id,user_id) references public.assets(id,user_id) on delete set null (asset_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_amount_positive_v82','c','check ((amount > (0)::numeric)) not valid','alter table public.recurring add constraint recurring_amount_positive_v82 check (amount>0) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_investment_shape_v82','c',$d$check (((lower(type) <> all (array['investimento'::text, 'investment'::text])) or ((source_account_id is not null) and (asset_id is not null)))) not valid$d$,$d$alter table public.recurring add constraint recurring_investment_shape_v82 check (lower(type) not in ('investimento','investment') or (source_account_id is not null and asset_id is not null)) not valid$d$,true);
select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_transfer_shape_v82','c',$d$check (((lower(type) <> all (array['transferencia'::text, 'transferência'::text, 'transfer'::text])) or ((source_account_id is not null) and (destination_account_id is not null) and (source_account_id <> destination_account_id)))) not valid$d$,$d$alter table public.recurring add constraint recurring_transfer_shape_v82 check (lower(type) not in ('transferencia','transferência','transfer') or (source_account_id is not null and destination_account_id is not null and source_account_id<>destination_account_id)) not valid$d$,true);
select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_rescue_shape_v82','c',$d$check (((lower(type) <> all (array['resgate'::text, 'rescue'::text, 'withdrawal'::text])) or ((asset_id is not null) and (destination_account_id is not null)))) not valid$d$,$d$alter table public.recurring add constraint recurring_rescue_shape_v82 check (lower(type) not in ('resgate','rescue','withdrawal') or (asset_id is not null and destination_account_id is not null)) not valid$d$,true);

-- recovery-test-checkpoint: migration-2-mid
select pg_temp.mb_v82_ensure_index('public.recurring','recurring_user_source_account_v82_idx','create index recurring_user_source_account_v82_idx on public.recurring using btree (user_id, source_account_id) where (source_account_id is not null)','create index recurring_user_source_account_v82_idx on public.recurring(user_id,source_account_id) where source_account_id is not null');
select pg_temp.mb_v82_ensure_index('public.recurring','recurring_user_destination_account_v82_idx','create index recurring_user_destination_account_v82_idx on public.recurring using btree (user_id, destination_account_id) where (destination_account_id is not null)','create index recurring_user_destination_account_v82_idx on public.recurring(user_id,destination_account_id) where destination_account_id is not null');
select pg_temp.mb_v82_ensure_index('public.recurring','recurring_user_asset_v82_idx','create index recurring_user_asset_v82_idx on public.recurring using btree (user_id, asset_id) where (asset_id is not null)','create index recurring_user_asset_v82_idx on public.recurring(user_id,asset_id) where asset_id is not null');
select pg_temp.mb_v82_ensure_index('public.recurring','recurring_user_active_next_date_v82_idx','create index recurring_user_active_next_date_v82_idx on public.recurring using btree (user_id, next_date) where (active is true)','create index recurring_user_active_next_date_v82_idx on public.recurring(user_id,next_date) where active is true');

select pg_temp.mb_v82_assert_function('public.materialize_recurring_occurrences_v82(date)','9d5d8239ef4e434a63f89d44e8ad3ce2','public.transactions',true);

create or replace function public.materialize_recurring_occurrences_v82(
  p_horizon_end date
) returns setof public.transactions
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_user uuid:=(select auth.uid());
  v_rule public.recurring%rowtype;
  v_row public.transactions%rowtype;
  v_cursor date;
  v_next date;
  v_effective_end date;
  v_interval integer;
  v_anchor_day integer;
  v_anchor_month integer;
  v_candidate_month date;
  v_last_day integer;
  v_type text;
  v_status text;
  v_guard integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if p_horizon_end is null or p_horizon_end<current_date then
    raise exception 'valid horizon_end required' using errcode='22007';
  end if;
  if p_horizon_end>(current_date+interval '12 months')::date then
    raise exception 'horizon_end exceeds 12 months' using errcode='22007';
  end if;

  for v_rule in
    select r.*
    from public.recurring r
    where r.user_id=v_user
      and r.active is true
      and r.next_date<=p_horizon_end
      and (r.end_date is null or r.next_date<=r.end_date)
    order by r.id
    for update
  loop
    v_type:=case lower(v_rule.type)
      when 'receita' then 'receita'
      when 'income' then 'receita'
      when 'revenue' then 'receita'
      when 'despesa' then 'despesa'
      when 'expense' then 'despesa'
      when 'investimento' then 'investimento'
      when 'investment' then 'investimento'
      when 'transferencia' then 'transferencia'
      when 'transferência' then 'transferencia'
      when 'transfer' then 'transferencia'
      when 'resgate' then 'resgate'
      when 'rescue' then 'resgate'
      when 'withdrawal' then 'resgate'
      else null
    end;

    if v_type is null then
      raise exception 'unsupported recurring type for series %',v_rule.id using errcode='23514';
    end if;
    if v_rule.amount is null or v_rule.amount<=0 then
      raise exception 'positive recurring amount required for series %',v_rule.id using errcode='23514';
    end if;
    if v_rule.frequency not in ('daily','weekly','biweekly','monthly','yearly') then
      raise exception 'unsupported recurring frequency for series %',v_rule.id using errcode='23514';
    end if;

    if v_type='investimento' then
      if v_rule.source_account_id is null or v_rule.asset_id is null then
        raise exception 'investment recurring links required for series %',v_rule.id using errcode='23514';
      end if;
      if not exists(select 1 from public.accounts where id=v_rule.source_account_id and user_id=v_user)
         or not exists(select 1 from public.assets where id=v_rule.asset_id and user_id=v_user) then
        raise exception 'investment recurring ownership mismatch for series %',v_rule.id using errcode='42501';
      end if;
    elsif v_type='transferencia' then
      if v_rule.source_account_id is null or v_rule.destination_account_id is null
         or v_rule.source_account_id=v_rule.destination_account_id then
        raise exception 'valid distinct transfer accounts required for series %',v_rule.id using errcode='23514';
      end if;
      if not exists(select 1 from public.accounts where id=v_rule.source_account_id and user_id=v_user)
         or not exists(select 1 from public.accounts where id=v_rule.destination_account_id and user_id=v_user) then
        raise exception 'transfer recurring ownership mismatch for series %',v_rule.id using errcode='42501';
      end if;
    elsif v_type='resgate' then
      if v_rule.asset_id is null or v_rule.destination_account_id is null then
        raise exception 'rescue recurring links required for series %',v_rule.id using errcode='23514';
      end if;
      if not exists(select 1 from public.assets where id=v_rule.asset_id and user_id=v_user)
         or not exists(select 1 from public.accounts where id=v_rule.destination_account_id and user_id=v_user) then
        raise exception 'rescue recurring ownership mismatch for series %',v_rule.id using errcode='42501';
      end if;
    end if;

    v_cursor:=v_rule.next_date;
    v_effective_end:=least(p_horizon_end,coalesce(v_rule.end_date,p_horizon_end));
    v_interval:=greatest(1,coalesce(v_rule.interval,1));
    v_anchor_day:=least(31,greatest(1,coalesce(v_rule.day_of_month,extract(day from coalesce(v_rule.start_date,v_cursor))::integer)));
    v_anchor_month:=extract(month from coalesce(v_rule.start_date,v_cursor))::integer;
    v_guard:=0;

    while v_cursor<=v_effective_end loop
      v_guard:=v_guard+1;
      if v_guard>400 then
        raise exception 'recurring occurrence safety limit exceeded for series %',v_rule.id using errcode='54000';
      end if;

      v_status:=case when v_cursor<=current_date then 'realizado' else 'pendente' end;
      insert into public.transactions(
        user_id,transaction_date,description,category,subcategory,amount,
        transaction_type,status,payment_method,account_id,card_id,
        source_account_id,destination_account_id,asset_id,
        goal_id,goal_effect,note,recurring_series_id,recurring_occurrence_date
      ) values (
        v_user,v_cursor,v_rule.name,v_rule.category,v_rule.subcategory,v_rule.amount,
        v_type,v_status,
        case when v_type in ('investimento','transferencia','resgate') then 'Operação estruturada'
             when v_rule.card_id is not null then 'Cartão de crédito' else 'Conta' end,
        case v_type
          when 'investimento' then v_rule.source_account_id
          when 'transferencia' then v_rule.source_account_id
          when 'resgate' then v_rule.destination_account_id
          else v_rule.account_id
        end,
        case when v_type in ('receita','despesa') then v_rule.card_id else null end,
        v_rule.source_account_id,v_rule.destination_account_id,v_rule.asset_id,
        v_rule.goal_id,
        case when v_rule.goal_id is not null then coalesce(v_rule.goal_effect,'contribution') else null end,
        concat_ws(' • ',nullif(btrim(v_rule.note),''),'Recorrência automática',v_rule.id::text),
        v_rule.id,v_cursor
      )
      on conflict(user_id,recurring_series_id,recurring_occurrence_date)
        where recurring_series_id is not null and recurring_occurrence_date is not null
      do nothing
      returning * into v_row;

      if found then
        return next v_row;
      end if;

      if v_rule.frequency='daily' then
        v_next:=v_cursor+v_interval;
      elsif v_rule.frequency='weekly' then
        v_next:=v_cursor+(v_interval*7);
      elsif v_rule.frequency='biweekly' then
        v_next:=v_cursor+(v_interval*14);
      elsif v_rule.frequency='monthly' then
        v_candidate_month:=(date_trunc('month',v_cursor)::date+make_interval(months=>v_interval))::date;
        v_last_day:=extract(day from (date_trunc('month',v_candidate_month)+interval '1 month - 1 day'))::integer;
        v_next:=make_date(extract(year from v_candidate_month)::integer,extract(month from v_candidate_month)::integer,least(v_anchor_day,v_last_day));
      else
        v_candidate_month:=make_date(extract(year from v_cursor)::integer+v_interval,v_anchor_month,1);
        v_last_day:=extract(day from (date_trunc('month',v_candidate_month)+interval '1 month - 1 day'))::integer;
        v_next:=make_date(extract(year from v_candidate_month)::integer,v_anchor_month,least(v_anchor_day,v_last_day));
      end if;

      if v_next<=v_cursor then
        raise exception 'recurring schedule did not advance for series %',v_rule.id using errcode='22007';
      end if;
      v_cursor:=v_next;
    end loop;

    update public.recurring
    set next_date=v_cursor
    where id=v_rule.id and user_id=v_user;
  end loop;

  return;
end
$$;

select pg_temp.mb_v82_assert_function('public.create_investment_entry_v82(uuid,uuid,uuid,numeric,date,text,text,text,text,text,uuid,text)','136dbe1155585e6b2f7ec4c4e6746837','public.transactions',false);

create or replace function public.create_investment_entry_v82(
  p_operation_id uuid,
  p_source_account_id uuid,
  p_asset_id uuid,
  p_amount numeric,
  p_transaction_date date,
  p_category text,
  p_description text default 'Investimento',
  p_subcategory text default null,
  p_payment_method text default null,
  p_note text default null,
  p_goal_id uuid default null,
  p_goal_effect text default null
) returns public.transactions
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_user uuid:=(select auth.uid());
  v_row public.transactions%rowtype;
  v_description text:=coalesce(nullif(btrim(p_description),''),'Investimento');
begin
  if v_user is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if p_goal_id is not null and not exists(
    select 1 from public.goals where id=p_goal_id and user_id=v_user
  ) then
    raise exception 'goal ownership mismatch' using errcode='42501';
  end if;
  if (p_goal_id is null and p_goal_effect is not null)
     or (p_goal_id is not null and coalesce(p_goal_effect,'contribution') not in ('contribution','withdrawal')) then
    raise exception 'valid goal effect required' using errcode='23514';
  end if;

  select * into v_row
  from public.create_investment_v82(
    p_operation_id,p_source_account_id,p_asset_id,p_amount,
    p_transaction_date,p_category,v_description
  );

  if v_row.category is distinct from p_category
     or v_row.description is distinct from v_description
     or (v_row.account_id is not null and v_row.account_id is distinct from p_source_account_id)
     or (v_row.subcategory is not null and v_row.subcategory is distinct from p_subcategory)
     or (v_row.payment_method is not null and v_row.payment_method is distinct from p_payment_method)
     or (v_row.note is not null and v_row.note is distinct from p_note)
     or (v_row.goal_id is not null and v_row.goal_id is distinct from p_goal_id)
     or (v_row.goal_effect is not null and v_row.goal_effect is distinct from coalesce(p_goal_effect,'contribution')) then
    raise exception 'operation_id metadata conflict' using errcode='23505';
  end if;

  update public.transactions
  set account_id=p_source_account_id,
      subcategory=p_subcategory,
      payment_method=p_payment_method,
      note=p_note,
      goal_id=p_goal_id,
      goal_effect=case when p_goal_id is not null then coalesce(p_goal_effect,'contribution') else null end
  where id=v_row.id and user_id=v_user
  returning * into v_row;
  return v_row;
end
$$;

revoke all on function public.materialize_recurring_occurrences_v82(date) from public,anon;
revoke all on function public.create_investment_entry_v82(uuid,uuid,uuid,numeric,date,text,text,text,text,text,uuid,text) from public,anon;
grant execute on function public.materialize_recurring_occurrences_v82(date) to authenticated;
grant execute on function public.create_investment_entry_v82(uuid,uuid,uuid,numeric,date,text,text,text,text,text,uuid,text) to authenticated;

select pg_temp.mb_v82_assert_function('public.materialize_recurring_occurrences_v82(date)','9d5d8239ef4e434a63f89d44e8ad3ce2','public.transactions',true);
select pg_temp.mb_v82_assert_function('public.create_investment_entry_v82(uuid,uuid,uuid,numeric,date,text,text,text,text,text,uuid,text)','136dbe1155585e6b2f7ec4c4e6746837','public.transactions',false);

do $grants$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.materialize_recurring_occurrences_v82(date)',
    'public.create_investment_entry_v82(uuid,uuid,uuid,numeric,date,text,text,text,text,text,uuid,text)'
  ] loop
    if has_function_privilege('anon',v_signature,'execute')
       or not has_function_privilege('authenticated',v_signature,'execute') then
      raise exception 'V82 privilege drift on function %',v_signature using errcode='P0001';
    end if;
  end loop;
end$grants$;

commit;
