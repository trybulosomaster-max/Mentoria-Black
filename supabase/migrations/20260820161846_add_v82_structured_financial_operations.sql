-- Production-reconciled V82 structure. The transaction prevents persistent partial
-- application; semantic guards make a retry safe and reject incompatible drift.
begin;
set local lock_timeout='15s';
set local statement_timeout='5min';
select pg_advisory_xact_lock(hashtextextended('mentoria-black:v82:production-chain',0));

create or replace function pg_temp.mb_v82_normalize(p_value text) returns text
language sql immutable as $$
  select regexp_replace(lower(trim(p_value)),'[[:space:]]+',' ','g')
$$;

create or replace function pg_temp.mb_v82_require_base() returns void
language plpgsql as $$
declare v_table text;
begin
  foreach v_table in array array['accounts','cards','goals','assets','liabilities','recurring','transactions'] loop
    if to_regclass('public.'||v_table) is null then
      raise exception 'V82 preflight drift: required table public.% is missing',v_table using errcode='P0001';
    end if;
    if not (select relrowsecurity from pg_class where oid=to_regclass('public.'||v_table)) then
      raise exception 'V82 preflight drift: RLS is disabled on public.%',v_table using errcode='P0001';
    end if;
  end loop;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'V82 preflight drift: auth.uid() is missing' using errcode='P0001';
  end if;
  if not exists(select 1 from pg_roles where rolname='anon')
     or not exists(select 1 from pg_roles where rolname='authenticated') then
    raise exception 'V82 preflight drift: Supabase API roles are missing' using errcode='P0001';
  end if;
end$$;

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

create or replace function pg_temp.mb_v82_retire_constraint(
  p_table regclass,p_name name,p_expected text
) returns void language plpgsql as $$
declare v_definition text;
begin
  select pg_get_constraintdef(oid) into v_definition from pg_constraint where conrelid=p_table and conname=p_name;
  if found then
    if pg_temp.mb_v82_normalize(v_definition)<>pg_temp.mb_v82_normalize(p_expected) then
      raise exception 'V82 schema drift: legacy constraint %.% is incompatible: %',p_table,p_name,v_definition using errcode='P0001';
    end if;
    execute format('alter table %s drop constraint %I',p_table,p_name);
  end if;
end$$;

create or replace function pg_temp.mb_v82_ensure_index(
  p_table regclass,p_name name,p_expected text,p_create text
) returns void language plpgsql as $$
declare v_oid oid;v_table oid;v_definition text;
begin
  select c.oid,i.indrelid,pg_get_indexdef(c.oid) into v_oid,v_table,v_definition
  from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid
  where n.nspname='public' and c.relname=p_name;
  if not found then
    execute p_create;
    select c.oid,i.indrelid,pg_get_indexdef(c.oid) into v_oid,v_table,v_definition
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

select pg_temp.mb_v82_require_base();

select pg_temp.mb_v82_ensure_column('public.accounts','balance_as_of','date');
select pg_temp.mb_v82_ensure_column('public.assets','opening_value','numeric');
select pg_temp.mb_v82_ensure_column('public.assets','value_as_of','date');
select pg_temp.mb_v82_ensure_column('public.transactions','source_account_id','uuid');
select pg_temp.mb_v82_ensure_column('public.transactions','destination_account_id','uuid');
select pg_temp.mb_v82_ensure_column('public.transactions','asset_id','uuid');
select pg_temp.mb_v82_ensure_column('public.transactions','liability_id','uuid');
select pg_temp.mb_v82_ensure_column('public.transactions','recurring_series_id','uuid');
select pg_temp.mb_v82_ensure_column('public.transactions','recurring_occurrence_date','date');
select pg_temp.mb_v82_ensure_column('public.transactions','installment_series_id','uuid');
select pg_temp.mb_v82_ensure_column('public.transactions','installment_number','integer');
select pg_temp.mb_v82_ensure_column('public.transactions','operation_id','uuid');
select pg_temp.mb_v82_ensure_column('public.transactions','reversal_of_id','uuid');

select pg_temp.mb_v82_ensure_constraint('public.accounts','accounts_id_user_id_key','u','unique (id, user_id)',
  'alter table public.accounts add constraint accounts_id_user_id_key unique (id,user_id)');
select pg_temp.mb_v82_ensure_constraint('public.cards','cards_id_user_id_key','u','unique (id, user_id)',
  'alter table public.cards add constraint cards_id_user_id_key unique (id,user_id)');
select pg_temp.mb_v82_ensure_constraint('public.assets','assets_id_user_id_key','u','unique (id, user_id)',
  'alter table public.assets add constraint assets_id_user_id_key unique (id,user_id)');
select pg_temp.mb_v82_ensure_constraint('public.liabilities','liabilities_id_user_id_key','u','unique (id, user_id)',
  'alter table public.liabilities add constraint liabilities_id_user_id_key unique (id,user_id)');

select pg_temp.mb_v82_retire_constraint('public.transactions','transactions_account_id_fkey','foreign key (account_id) references accounts(id) on delete set null');
select pg_temp.mb_v82_retire_constraint('public.transactions','transactions_card_id_fkey','foreign key (card_id) references cards(id) on delete set null');
select pg_temp.mb_v82_retire_constraint('public.recurring','recurring_account_id_fkey','foreign key (account_id) references accounts(id) on delete set null');
select pg_temp.mb_v82_retire_constraint('public.recurring','recurring_card_id_fkey','foreign key (card_id) references cards(id) on delete set null');

select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_account_user_fkey','f','foreign key (account_id, user_id) references accounts(id, user_id) on delete set null (account_id) not valid','alter table public.transactions add constraint transactions_account_user_fkey foreign key (account_id,user_id) references public.accounts(id,user_id) on delete set null (account_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_card_user_fkey','f','foreign key (card_id, user_id) references cards(id, user_id) on delete set null (card_id) not valid','alter table public.transactions add constraint transactions_card_user_fkey foreign key (card_id,user_id) references public.cards(id,user_id) on delete set null (card_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_source_account_user_fkey','f','foreign key (source_account_id, user_id) references accounts(id, user_id) on delete set null (source_account_id) not valid','alter table public.transactions add constraint transactions_source_account_user_fkey foreign key (source_account_id,user_id) references public.accounts(id,user_id) on delete set null (source_account_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_destination_account_user_fkey','f','foreign key (destination_account_id, user_id) references accounts(id, user_id) on delete set null (destination_account_id) not valid','alter table public.transactions add constraint transactions_destination_account_user_fkey foreign key (destination_account_id,user_id) references public.accounts(id,user_id) on delete set null (destination_account_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_asset_user_fkey','f','foreign key (asset_id, user_id) references assets(id, user_id) on delete set null (asset_id) not valid','alter table public.transactions add constraint transactions_asset_user_fkey foreign key (asset_id,user_id) references public.assets(id,user_id) on delete set null (asset_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_liability_user_fkey','f','foreign key (liability_id, user_id) references liabilities(id, user_id) on delete set null (liability_id) not valid','alter table public.transactions add constraint transactions_liability_user_fkey foreign key (liability_id,user_id) references public.liabilities(id,user_id) on delete set null (liability_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_recurring_series_user_fkey','f','foreign key (recurring_series_id, user_id) references recurring(id, user_id) on delete set null (recurring_series_id) not valid','alter table public.transactions add constraint transactions_recurring_series_user_fkey foreign key (recurring_series_id,user_id) references public.recurring(id,user_id) on delete set null (recurring_series_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_reversal_user_fkey','f','foreign key (reversal_of_id, user_id) references transactions(id, user_id) on delete restrict not valid','alter table public.transactions add constraint transactions_reversal_user_fkey foreign key (reversal_of_id,user_id) references public.transactions(id,user_id) on delete restrict not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_account_user_fkey','f','foreign key (account_id, user_id) references accounts(id, user_id) on delete set null (account_id) not valid','alter table public.recurring add constraint recurring_account_user_fkey foreign key (account_id,user_id) references public.accounts(id,user_id) on delete set null (account_id) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.recurring','recurring_card_user_fkey','f','foreign key (card_id, user_id) references cards(id, user_id) on delete set null (card_id) not valid','alter table public.recurring add constraint recurring_card_user_fkey foreign key (card_id,user_id) references public.cards(id,user_id) on delete set null (card_id) not valid',true);

-- NOT VALID preserves legacy rows while rejecting incompatible new writes.
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_amount_positive_v82','c','check ((amount > (0)::numeric)) not valid','alter table public.transactions add constraint transactions_amount_positive_v82 check (amount>0) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_transfer_shape_v82','c',$d$check (((transaction_type <> 'transferencia'::text) or ((source_account_id is not null) and (destination_account_id is not null) and (source_account_id <> destination_account_id)))) not valid$d$,$d$alter table public.transactions add constraint transactions_transfer_shape_v82 check (transaction_type<>'transferencia' or (source_account_id is not null and destination_account_id is not null and source_account_id<>destination_account_id)) not valid$d$,true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_investment_shape_v82','c',$d$check (((transaction_type <> 'investimento'::text) or ((source_account_id is not null) and (asset_id is not null)))) not valid$d$,$d$alter table public.transactions add constraint transactions_investment_shape_v82 check (transaction_type<>'investimento' or (source_account_id is not null and asset_id is not null)) not valid$d$,true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_rescue_shape_v82','c',$d$check (((transaction_type <> 'resgate'::text) or ((destination_account_id is not null) and (asset_id is not null)))) not valid$d$,$d$alter table public.transactions add constraint transactions_rescue_shape_v82 check (transaction_type<>'resgate' or (destination_account_id is not null and asset_id is not null)) not valid$d$,true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_recurring_identity_v82','c','check (((recurring_series_id is null) or (recurring_occurrence_date is not null))) not valid','alter table public.transactions add constraint transactions_recurring_identity_v82 check (recurring_series_id is null or recurring_occurrence_date is not null) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_installment_identity_v82','c','check ((((installment_series_id is null) and (installment_number is null)) or ((installment_series_id is not null) and (installment_number > 0)))) not valid','alter table public.transactions add constraint transactions_installment_identity_v82 check ((installment_series_id is null and installment_number is null) or (installment_series_id is not null and installment_number>0)) not valid',true);
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_reversal_not_self_v82','c','check (((reversal_of_id is null) or (reversal_of_id <> id))) not valid','alter table public.transactions add constraint transactions_reversal_not_self_v82 check (reversal_of_id is null or reversal_of_id<>id) not valid',true);

do $status$
declare v_definition text;
begin
  select pg_get_constraintdef(oid) into v_definition from pg_constraint
  where conrelid='public.transactions'::regclass and conname='transactions_status_check';
  if found and pg_temp.mb_v82_normalize(v_definition)=pg_temp.mb_v82_normalize($d$check ((status = any (array['realizado'::text, 'pendente'::text, 'cancelado'::text])))$d$) then
    alter table public.transactions drop constraint transactions_status_check;
  elsif found and pg_temp.mb_v82_normalize(v_definition)<>pg_temp.mb_v82_normalize($d$check (((status is null) or (status = any (array['realizado'::text, 'pendente'::text, 'programado'::text, 'cancelado'::text])))) not valid$d$) then
    raise exception 'V82 schema drift: transactions_status_check is incompatible: %',v_definition using errcode='P0001';
  end if;
end$status$;
select pg_temp.mb_v82_ensure_constraint('public.transactions','transactions_status_check','c',$d$check (((status is null) or (status = any (array['realizado'::text, 'pendente'::text, 'programado'::text, 'cancelado'::text])))) not valid$d$,$d$alter table public.transactions add constraint transactions_status_check check (status is null or status in ('realizado','pendente','programado','cancelado')) not valid$d$,true);

-- recovery-test-checkpoint: migration-1-mid
select pg_temp.mb_v82_ensure_index('public.transactions','transactions_user_operation_uidx','create unique index transactions_user_operation_uidx on public.transactions using btree (user_id, operation_id) where (operation_id is not null)','create unique index transactions_user_operation_uidx on public.transactions(user_id,operation_id) where operation_id is not null');
select pg_temp.mb_v82_ensure_index('public.transactions','transactions_user_recurring_occurrence_uidx','create unique index transactions_user_recurring_occurrence_uidx on public.transactions using btree (user_id, recurring_series_id, recurring_occurrence_date) where ((recurring_series_id is not null) and (recurring_occurrence_date is not null))','create unique index transactions_user_recurring_occurrence_uidx on public.transactions(user_id,recurring_series_id,recurring_occurrence_date) where recurring_series_id is not null and recurring_occurrence_date is not null');
select pg_temp.mb_v82_ensure_index('public.transactions','transactions_user_installment_uidx','create unique index transactions_user_installment_uidx on public.transactions using btree (user_id, installment_series_id, installment_number) where ((installment_series_id is not null) and (installment_number is not null))','create unique index transactions_user_installment_uidx on public.transactions(user_id,installment_series_id,installment_number) where installment_series_id is not null and installment_number is not null');
select pg_temp.mb_v82_ensure_index('public.transactions','transactions_user_reversal_uidx','create unique index transactions_user_reversal_uidx on public.transactions using btree (user_id, reversal_of_id) where (reversal_of_id is not null)','create unique index transactions_user_reversal_uidx on public.transactions(user_id,reversal_of_id) where reversal_of_id is not null');
select pg_temp.mb_v82_ensure_index('public.transactions','transactions_user_status_date_v82_idx','create index transactions_user_status_date_v82_idx on public.transactions using btree (user_id, status, transaction_date)','create index transactions_user_status_date_v82_idx on public.transactions(user_id,status,transaction_date)');
select pg_temp.mb_v82_ensure_index('public.transactions','transactions_user_source_date_v82_idx','create index transactions_user_source_date_v82_idx on public.transactions using btree (user_id, source_account_id, transaction_date) where (source_account_id is not null)','create index transactions_user_source_date_v82_idx on public.transactions(user_id,source_account_id,transaction_date) where source_account_id is not null');
select pg_temp.mb_v82_ensure_index('public.transactions','transactions_user_destination_date_v82_idx','create index transactions_user_destination_date_v82_idx on public.transactions using btree (user_id, destination_account_id, transaction_date) where (destination_account_id is not null)','create index transactions_user_destination_date_v82_idx on public.transactions(user_id,destination_account_id,transaction_date) where destination_account_id is not null');
select pg_temp.mb_v82_ensure_index('public.transactions','transactions_user_asset_date_v82_idx','create index transactions_user_asset_date_v82_idx on public.transactions using btree (user_id, asset_id, transaction_date) where (asset_id is not null)','create index transactions_user_asset_date_v82_idx on public.transactions(user_id,asset_id,transaction_date) where asset_id is not null');

select pg_temp.mb_v82_assert_function('public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','d5fc0089bb7964841249ab7dd5448868','public.transactions',false);

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

select pg_temp.mb_v82_assert_function('public.create_investment_v82(uuid,uuid,uuid,numeric,date,text,text)','ccf379a9df25d1bc209a4df9c8e64303','public.transactions',false);

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

select pg_temp.mb_v82_assert_function('public.create_rescue_v82(uuid,uuid,uuid,numeric,date,text)','25021eb487d785e19ee17115632cb13b','public.transactions',false);

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

select pg_temp.mb_v82_assert_function('public.reverse_structured_operation_v82(uuid,uuid,date,text)','18bf8e05ca2ff68a355f388e869c5892','public.transactions',false);

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

select pg_temp.mb_v82_assert_function('public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','d5fc0089bb7964841249ab7dd5448868','public.transactions',false);
select pg_temp.mb_v82_assert_function('public.create_investment_v82(uuid,uuid,uuid,numeric,date,text,text)','ccf379a9df25d1bc209a4df9c8e64303','public.transactions',false);
select pg_temp.mb_v82_assert_function('public.create_rescue_v82(uuid,uuid,uuid,numeric,date,text)','25021eb487d785e19ee17115632cb13b','public.transactions',false);
select pg_temp.mb_v82_assert_function('public.reverse_structured_operation_v82(uuid,uuid,date,text)','18bf8e05ca2ff68a355f388e869c5892','public.transactions',false);

do $grants$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)',
    'public.create_investment_v82(uuid,uuid,uuid,numeric,date,text,text)',
    'public.create_rescue_v82(uuid,uuid,uuid,numeric,date,text)',
    'public.reverse_structured_operation_v82(uuid,uuid,date,text)'
  ] loop
    if has_function_privilege('anon',v_signature,'execute')
       or not has_function_privilege('authenticated',v_signature,'execute') then
      raise exception 'V82 privilege drift on function %',v_signature using errcode='P0001';
    end if;
  end loop;
end$grants$;

commit;
