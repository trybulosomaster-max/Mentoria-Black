-- Canonical structured references for recurring V82 operations.
-- Columns stay nullable so ambiguous legacy rows are preserved. NOT VALID checks
-- protect every new or updated row without attempting to infer legacy links.

alter table public.recurring
  add column source_account_id uuid,
  add column destination_account_id uuid,
  add column asset_id uuid;

alter table public.recurring
  add constraint recurring_source_account_user_fkey
    foreign key (source_account_id,user_id) references public.accounts(id,user_id)
    on delete set null (source_account_id) not valid,
  add constraint recurring_destination_account_user_fkey
    foreign key (destination_account_id,user_id) references public.accounts(id,user_id)
    on delete set null (destination_account_id) not valid,
  add constraint recurring_asset_user_fkey
    foreign key (asset_id,user_id) references public.assets(id,user_id)
    on delete set null (asset_id) not valid;

alter table public.recurring
  add constraint recurring_amount_positive_v82 check (amount>0) not valid,
  add constraint recurring_investment_shape_v82 check (
    lower(type) not in ('investimento','investment') or
    (source_account_id is not null and asset_id is not null)
  ) not valid,
  add constraint recurring_transfer_shape_v82 check (
    lower(type) not in ('transferencia','transferência','transfer') or
    (
      source_account_id is not null and
      destination_account_id is not null and
      source_account_id<>destination_account_id
    )
  ) not valid,
  add constraint recurring_rescue_shape_v82 check (
    lower(type) not in ('resgate','rescue','withdrawal') or
    (asset_id is not null and destination_account_id is not null)
  ) not valid;

create index recurring_user_source_account_v82_idx
  on public.recurring(user_id,source_account_id)
  where source_account_id is not null;
create index recurring_user_destination_account_v82_idx
  on public.recurring(user_id,destination_account_id)
  where destination_account_id is not null;
create index recurring_user_asset_v82_idx
  on public.recurring(user_id,asset_id)
  where asset_id is not null;
create index recurring_user_active_next_date_v82_idx
  on public.recurring(user_id,next_date)
  where active is true;

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
