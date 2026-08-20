-- Additive V82 structure. New fields remain nullable for ambiguous legacy rows.

alter table public.accounts
  add column balance_as_of date,
  add constraint accounts_id_user_id_key unique (id,user_id);

alter table public.cards
  add constraint cards_id_user_id_key unique (id,user_id);

alter table public.assets
  add column opening_value numeric,
  add column value_as_of date,
  add constraint assets_id_user_id_key unique (id,user_id);

alter table public.liabilities
  add constraint liabilities_id_user_id_key unique (id,user_id);

alter table public.transactions
  add column source_account_id uuid,
  add column destination_account_id uuid,
  add column asset_id uuid,
  add column liability_id uuid,
  add column recurring_series_id uuid,
  add column recurring_occurrence_date date,
  add column installment_series_id uuid,
  add column installment_number integer,
  add column operation_id uuid,
  add column reversal_of_id uuid;

alter table public.transactions drop constraint transactions_account_id_fkey;
alter table public.transactions drop constraint transactions_card_id_fkey;
alter table public.recurring drop constraint recurring_account_id_fkey;
alter table public.recurring drop constraint recurring_card_id_fkey;

alter table public.transactions
  add constraint transactions_account_user_fkey
    foreign key (account_id,user_id) references public.accounts(id,user_id)
    on delete set null (account_id) not valid,
  add constraint transactions_card_user_fkey
    foreign key (card_id,user_id) references public.cards(id,user_id)
    on delete set null (card_id) not valid,
  add constraint transactions_source_account_user_fkey
    foreign key (source_account_id,user_id) references public.accounts(id,user_id)
    on delete set null (source_account_id) not valid,
  add constraint transactions_destination_account_user_fkey
    foreign key (destination_account_id,user_id) references public.accounts(id,user_id)
    on delete set null (destination_account_id) not valid,
  add constraint transactions_asset_user_fkey
    foreign key (asset_id,user_id) references public.assets(id,user_id)
    on delete set null (asset_id) not valid,
  add constraint transactions_liability_user_fkey
    foreign key (liability_id,user_id) references public.liabilities(id,user_id)
    on delete set null (liability_id) not valid,
  add constraint transactions_recurring_series_user_fkey
    foreign key (recurring_series_id,user_id) references public.recurring(id,user_id)
    on delete set null (recurring_series_id) not valid,
  add constraint transactions_reversal_user_fkey
    foreign key (reversal_of_id,user_id) references public.transactions(id,user_id)
    on delete restrict not valid;

alter table public.recurring
  add constraint recurring_account_user_fkey
    foreign key (account_id,user_id) references public.accounts(id,user_id)
    on delete set null (account_id) not valid,
  add constraint recurring_card_user_fkey
    foreign key (card_id,user_id) references public.cards(id,user_id)
    on delete set null (card_id) not valid;

-- The remote baseline allows zero. NOT VALID preserves legacy zero rows while rejecting new ones.
alter table public.transactions
  add constraint transactions_amount_positive_v82 check (amount>0) not valid,
  add constraint transactions_transfer_shape_v82 check (
    transaction_type<>'transferencia' or
    (source_account_id is not null and destination_account_id is not null and source_account_id<>destination_account_id)
  ) not valid,
  add constraint transactions_investment_shape_v82 check (
    transaction_type<>'investimento' or (source_account_id is not null and asset_id is not null)
  ) not valid,
  add constraint transactions_rescue_shape_v82 check (
    transaction_type<>'resgate' or (destination_account_id is not null and asset_id is not null)
  ) not valid,
  add constraint transactions_recurring_identity_v82 check (
    recurring_series_id is null or recurring_occurrence_date is not null
  ) not valid,
  add constraint transactions_installment_identity_v82 check (
    (installment_series_id is null and installment_number is null) or
    (installment_series_id is not null and installment_number>0)
  ) not valid,
  add constraint transactions_reversal_not_self_v82 check (reversal_of_id is null or reversal_of_id<>id) not valid;

-- Expand status compatibility without removing legacy aliases.
alter table public.transactions drop constraint transactions_status_check;
alter table public.transactions
  add constraint transactions_status_check check (
    status is null or status in ('realizado','pendente','programado','cancelado')
  ) not valid;

create unique index transactions_user_operation_uidx
  on public.transactions(user_id,operation_id) where operation_id is not null;
create unique index transactions_user_recurring_occurrence_uidx
  on public.transactions(user_id,recurring_series_id,recurring_occurrence_date)
  where recurring_series_id is not null and recurring_occurrence_date is not null;
create unique index transactions_user_installment_uidx
  on public.transactions(user_id,installment_series_id,installment_number)
  where installment_series_id is not null and installment_number is not null;
create unique index transactions_user_reversal_uidx
  on public.transactions(user_id,reversal_of_id) where reversal_of_id is not null;
create index transactions_user_status_date_v82_idx on public.transactions(user_id,status,transaction_date);
create index transactions_user_source_date_v82_idx on public.transactions(user_id,source_account_id,transaction_date) where source_account_id is not null;
create index transactions_user_destination_date_v82_idx on public.transactions(user_id,destination_account_id,transaction_date) where destination_account_id is not null;
create index transactions_user_asset_date_v82_idx on public.transactions(user_id,asset_id,transaction_date) where asset_id is not null;

create or replace function public.create_transfer_v82(
  p_operation_id uuid,p_source_account_id uuid,p_destination_account_id uuid,
  p_amount numeric,p_transaction_date date,p_description text default 'Transferência'
) returns public.transactions
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_user uuid:=(select auth.uid());v_row public.transactions%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501';end if;
  if p_operation_id is null then raise exception 'operation_id required' using errcode='23502';end if;
  if p_amount is null or p_amount<=0 then raise exception 'amount must be positive' using errcode='23514';end if;
  if p_source_account_id is null or p_destination_account_id is null or p_source_account_id=p_destination_account_id then
    raise exception 'valid distinct source and destination accounts required' using errcode='23514';
  end if;
  if not exists(select 1 from public.accounts where id=p_source_account_id and user_id=v_user)
     or not exists(select 1 from public.accounts where id=p_destination_account_id and user_id=v_user) then
    raise exception 'account ownership mismatch' using errcode='42501';
  end if;
  select * into v_row from public.transactions where user_id=v_user and operation_id=p_operation_id;
  if found then
    if v_row.transaction_type='transferencia' and v_row.source_account_id=p_source_account_id and v_row.destination_account_id=p_destination_account_id and v_row.amount=p_amount and v_row.transaction_date=p_transaction_date then return v_row;end if;
    raise exception 'operation_id payload conflict' using errcode='23505';
  end if;
  insert into public.transactions(user_id,transaction_date,description,amount,transaction_type,status,source_account_id,destination_account_id,operation_id)
  values(v_user,p_transaction_date,coalesce(nullif(p_description,''),'Transferência'),p_amount,'transferencia','realizado',p_source_account_id,p_destination_account_id,p_operation_id)
  on conflict(user_id,operation_id) where operation_id is not null do nothing returning * into v_row;
  if found then return v_row;end if;
  select * into v_row from public.transactions where user_id=v_user and operation_id=p_operation_id;
  if v_row.transaction_type='transferencia' and v_row.source_account_id=p_source_account_id and v_row.destination_account_id=p_destination_account_id and v_row.amount=p_amount and v_row.transaction_date=p_transaction_date then return v_row;end if;
  raise exception 'operation_id payload conflict' using errcode='23505';
end$$;

create or replace function public.create_investment_v82(
  p_operation_id uuid,p_source_account_id uuid,p_asset_id uuid,p_amount numeric,
  p_transaction_date date,p_category text,p_description text default 'Investimento'
) returns public.transactions
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_user uuid:=(select auth.uid());v_row public.transactions%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501';end if;
  if p_operation_id is null then raise exception 'operation_id required' using errcode='23502';end if;
  if p_amount is null or p_amount<=0 then raise exception 'amount must be positive' using errcode='23514';end if;
  if p_category is null or btrim(p_category)='' then raise exception 'investment category required' using errcode='23502';end if;
  if not exists(select 1 from public.accounts where id=p_source_account_id and user_id=v_user)
     or not exists(select 1 from public.assets where id=p_asset_id and user_id=v_user) then
    raise exception 'account or asset ownership mismatch' using errcode='42501';
  end if;
  select * into v_row from public.transactions where user_id=v_user and operation_id=p_operation_id;
  if found then
    if v_row.transaction_type='investimento' and v_row.source_account_id=p_source_account_id and v_row.asset_id=p_asset_id and v_row.amount=p_amount and v_row.transaction_date=p_transaction_date then return v_row;end if;
    raise exception 'operation_id payload conflict' using errcode='23505';
  end if;
  insert into public.transactions(user_id,transaction_date,description,category,amount,transaction_type,status,source_account_id,asset_id,operation_id)
  values(v_user,p_transaction_date,coalesce(nullif(p_description,''),'Investimento'),p_category,p_amount,'investimento','realizado',p_source_account_id,p_asset_id,p_operation_id)
  on conflict(user_id,operation_id) where operation_id is not null do nothing returning * into v_row;
  if found then return v_row;end if;
  select * into v_row from public.transactions where user_id=v_user and operation_id=p_operation_id;
  if v_row.transaction_type='investimento' and v_row.source_account_id=p_source_account_id and v_row.asset_id=p_asset_id and v_row.amount=p_amount and v_row.transaction_date=p_transaction_date then return v_row;end if;
  raise exception 'operation_id payload conflict' using errcode='23505';
end$$;

create or replace function public.create_rescue_v82(
  p_operation_id uuid,p_asset_id uuid,p_destination_account_id uuid,
  p_amount numeric,p_transaction_date date,p_description text default 'Resgate'
) returns public.transactions
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_user uuid:=(select auth.uid());v_row public.transactions%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501';end if;
  if p_operation_id is null then raise exception 'operation_id required' using errcode='23502';end if;
  if p_amount is null or p_amount<=0 then raise exception 'amount must be positive' using errcode='23514';end if;
  if not exists(select 1 from public.accounts where id=p_destination_account_id and user_id=v_user)
     or not exists(select 1 from public.assets where id=p_asset_id and user_id=v_user) then
    raise exception 'account or asset ownership mismatch' using errcode='42501';
  end if;
  select * into v_row from public.transactions where user_id=v_user and operation_id=p_operation_id;
  if found then
    if v_row.transaction_type='resgate' and v_row.destination_account_id=p_destination_account_id and v_row.asset_id=p_asset_id and v_row.amount=p_amount and v_row.transaction_date=p_transaction_date then return v_row;end if;
    raise exception 'operation_id payload conflict' using errcode='23505';
  end if;
  insert into public.transactions(user_id,transaction_date,description,amount,transaction_type,status,destination_account_id,asset_id,operation_id)
  values(v_user,p_transaction_date,coalesce(nullif(p_description,''),'Resgate'),p_amount,'resgate','realizado',p_destination_account_id,p_asset_id,p_operation_id)
  on conflict(user_id,operation_id) where operation_id is not null do nothing returning * into v_row;
  if found then return v_row;end if;
  select * into v_row from public.transactions where user_id=v_user and operation_id=p_operation_id;
  if v_row.transaction_type='resgate' and v_row.destination_account_id=p_destination_account_id and v_row.asset_id=p_asset_id and v_row.amount=p_amount and v_row.transaction_date=p_transaction_date then return v_row;end if;
  raise exception 'operation_id payload conflict' using errcode='23505';
end$$;

create or replace function public.reverse_structured_operation_v82(
  p_original_operation_id uuid,p_reversal_operation_id uuid,p_transaction_date date,
  p_investment_category text default null
) returns public.transactions
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_user uuid:=(select auth.uid());v_original public.transactions%rowtype;v_row public.transactions%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode='42501';end if;
  if p_original_operation_id is null or p_reversal_operation_id is null then raise exception 'operation ids required' using errcode='23502';end if;
  select * into v_row from public.transactions where user_id=v_user and operation_id=p_reversal_operation_id;
  if found then
    if v_row.reversal_of_id is not null and exists(select 1 from public.transactions o where o.id=v_row.reversal_of_id and o.user_id=v_user and o.operation_id=p_original_operation_id) then return v_row;end if;
    raise exception 'reversal operation_id payload conflict' using errcode='23505';
  end if;
  select * into v_original from public.transactions where user_id=v_user and operation_id=p_original_operation_id;
  if not found then raise exception 'original operation not found' using errcode='P0002';end if;
  if exists(select 1 from public.transactions where user_id=v_user and reversal_of_id=v_original.id) then raise exception 'operation already reversed' using errcode='23505';end if;
  if v_original.transaction_type='transferencia' then
    select * into v_row from public.create_transfer_v82(p_reversal_operation_id,v_original.destination_account_id,v_original.source_account_id,v_original.amount,p_transaction_date,'Reversão: '||v_original.description);
  elsif v_original.transaction_type='investimento' then
    select * into v_row from public.create_rescue_v82(p_reversal_operation_id,v_original.asset_id,v_original.source_account_id,v_original.amount,p_transaction_date,'Reversão: '||v_original.description);
  elsif v_original.transaction_type='resgate' then
    if p_investment_category is null or btrim(p_investment_category)='' then
      raise exception 'investment category required to reverse rescue' using errcode='23502';
    end if;
    select * into v_row from public.create_investment_v82(p_reversal_operation_id,v_original.destination_account_id,v_original.asset_id,v_original.amount,p_transaction_date,p_investment_category,'Reversão: '||v_original.description);
  else
    raise exception 'unsupported operation type for reversal' using errcode='0A000';
  end if;
  update public.transactions set reversal_of_id=v_original.id where id=v_row.id returning * into v_row;
  return v_row;
end$$;

revoke all on function public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text) from public,anon;
revoke all on function public.create_investment_v82(uuid,uuid,uuid,numeric,date,text,text) from public,anon;
revoke all on function public.create_rescue_v82(uuid,uuid,uuid,numeric,date,text) from public,anon;
revoke all on function public.reverse_structured_operation_v82(uuid,uuid,date,text) from public,anon;
grant execute on function public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.create_investment_v82(uuid,uuid,uuid,numeric,date,text,text) to authenticated;
grant execute on function public.create_rescue_v82(uuid,uuid,uuid,numeric,date,text) to authenticated;
grant execute on function public.reverse_structured_operation_v82(uuid,uuid,date,text) to authenticated;
