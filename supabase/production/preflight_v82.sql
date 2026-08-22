\set ON_ERROR_STOP on
\pset pager off
\pset tuples_only on

-- Remote V82 production pre-flight. Catalog and application data are read only.
-- Output is limited to aggregate counts and technical object names.
begin transaction isolation level repeatable read read only;
set local default_transaction_read_only=on;
set local statement_timeout='2min';
set local lock_timeout='5s';

do $preflight$
declare
  v_expected_ref constant text:='mwjqfzbpjmwiscvtxvfc';
  v_beta_ref constant text:='amzgqfvyjaiaoohnbcfl';
  v_project_ref text;
  v_blockers jsonb:='[]'::jsonb;
  v_warnings jsonb:='[]'::jsonb;
  v_metrics jsonb:='{}'::jsonb;
  v_row record;
  v_table text;
  v_operation text;
  v_text text;
  v_text_two text;
  v_config text[];
  v_count bigint;
  v_count_two bigint;
  v_bool boolean;
  v_bool_two boolean;
  v_oid oid;
  v_latest_migration text;
  v_m1_history boolean:=false;
  v_m2_history boolean:=false;
  v_m3_history boolean:=false;
  v_m1_presence integer:=0;
  v_m2_presence integer:=0;
  v_m3_presence integer:=0;
  v_m1_function_issues integer:=0;
  v_m2_function_issues integer:=0;
  v_m1_complete boolean:=false;
  v_m2_complete boolean:=false;
  v_m3_complete boolean:=false;
  v_bad_data bigint:=0;
  v_cross_user bigint:=0;
  v_policy_issues bigint:=0;
  v_grant_issues bigint:=0;
  v_policy_duplicate_count bigint:=0;
  v_direct_auth_uid_policy_count bigint:=0;
  v_excess_grant_count bigint:=0;
  v_m3_canonical_policy_count bigint:=0;
  v_m3_constraint_count bigint:=0;
  v_m3_new_default_count bigint:=0;
begin
  if current_setting('transaction_read_only')<>'on'
     or current_setting('default_transaction_read_only')<>'on' then
    raise exception 'MB_V82_PREFLIGHT_RESULT=NO-GO read-only transaction is not enforced';
  end if;

  -- Supabase does not guarantee a project-ref GUC. The runbook therefore also
  -- validates the URL hostname locally, without printing it, before psql starts.
  v_project_ref:=coalesce(
    nullif(current_setting('supabase.project_ref',true),''),
    nullif(current_setting('app.settings.project_ref',true),'')
  );
  if v_project_ref=v_beta_ref then
    v_blockers:=v_blockers||jsonb_build_array('identity:beta_project_ref_detected');
  elsif v_project_ref is not null and v_project_ref<>v_expected_ref then
    v_blockers:=v_blockers||jsonb_build_array('identity:unexpected_project_ref');
  elsif v_project_ref is null then
    v_warnings:=v_warnings||jsonb_build_array('identity:project_ref_not_exposed_by_database');
  end if;
  v_metrics:=v_metrics||jsonb_build_object(
    'identity',case when v_project_ref=v_expected_ref then 'production-confirmed-in-database'
                    when v_project_ref is null then 'requires-url-host-precheck'
                    else 'mismatch' end,
    'database',current_database(),
    'server_version',current_setting('server_version')
  );

  if current_setting('server_version_num')::integer<150000 then
    v_blockers:=v_blockers||jsonb_build_array('platform:postgres_before_15');
  end if;
  if to_regprocedure('auth.uid()') is null then
    v_blockers:=v_blockers||jsonb_build_array('platform:auth.uid_missing');
  end if;
  if not exists(select 1 from pg_roles where rolname='anon')
     or not exists(select 1 from pg_roles where rolname='authenticated') then
    v_blockers:=v_blockers||jsonb_build_array('platform:supabase_api_roles_missing');
  end if;

  -- Migration history: only versions and technical names are inspected.
  if to_regclass('supabase_migrations.schema_migrations') is null then
    v_blockers:=v_blockers||jsonb_build_array('history:schema_migrations_missing');
  elsif not exists(
    select 1 from information_schema.columns
    where table_schema='supabase_migrations' and table_name='schema_migrations'
      and column_name='version' and data_type='text'
  ) then
    v_blockers:=v_blockers||jsonb_build_array('history:version_column_incompatible');
  else
    execute 'select count(*),max(version),bool_or(version=$1),bool_or(version=$2),bool_or(version=$3) from supabase_migrations.schema_migrations'
      into v_count,v_latest_migration,v_m1_history,v_m2_history,v_m3_history
      using '20260820161846','20260820195658','20260821205630';
    v_m1_history:=coalesce(v_m1_history,false);
    v_m2_history:=coalesce(v_m2_history,false);
    v_m3_history:=coalesce(v_m3_history,false);
    v_metrics:=v_metrics||jsonb_build_object(
      'migration_history_count',v_count,
      'latest_migration_version',v_latest_migration,
      'migration_20260820161846_recorded',v_m1_history,
      'migration_20260820195658_recorded',v_m2_history
      ,'migration_20260821205630_recorded',v_m3_history
    );
    execute 'select count(*) from supabase_migrations.schema_migrations where version in ($1,$2,$3)'
      into v_count using '20260820161846','20260820195658','20260821205630';
    if v_count<>(case when v_m1_history then 1 else 0 end)+(case when v_m2_history then 1 else 0 end)+(case when v_m3_history then 1 else 0 end) then
      v_blockers:=v_blockers||jsonb_build_array('history:duplicate_v82_version');
    end if;
    if v_m2_history and not v_m1_history then
      v_blockers:=v_blockers||jsonb_build_array('history:migration_2_without_migration_1');
    end if;
    if v_m3_history and (not v_m1_history or not v_m2_history) then
      v_blockers:=v_blockers||jsonb_build_array('history:migration_3_without_structural_chain');
    end if;
  end if;

  foreach v_table in array array['accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans'] loop
    if to_regclass('public.'||v_table) is null then
      v_blockers:=v_blockers||jsonb_build_array('table:'||v_table||':missing');
    elsif not (select relrowsecurity from pg_class where oid=to_regclass('public.'||v_table)) then
      v_blockers:=v_blockers||jsonb_build_array('rls:'||v_table||':disabled');
    end if;
  end loop;

  -- Exact V81 columns used by the V82 DDL and RPCs.
  for v_row in
    select * from (values
      ('accounts','id','uuid',true,'gen_random_uuid()'),('accounts','user_id','uuid',true,null),
      ('accounts','opening_balance','numeric',true,'0'),('accounts','created_at','timestamp with time zone',true,'now()'),
      ('cards','id','uuid',true,'gen_random_uuid()'),('cards','user_id','uuid',true,null),
      ('categories','id','uuid',true,'gen_random_uuid()'),('categories','user_id','uuid',true,null),
      ('categories','kind','text',false,$d$'expense'::text$d$),
      ('goals','id','uuid',true,'gen_random_uuid()'),('goals','user_id','uuid',true,null),
      ('assets','id','uuid',true,'gen_random_uuid()'),('assets','user_id','uuid',true,null),
      ('assets','current_value','numeric',true,'0'),('assets','created_at','timestamp with time zone',true,'now()'),
      ('liabilities','id','uuid',true,'gen_random_uuid()'),('liabilities','user_id','uuid',true,null),
      ('recurring','id','uuid',true,'gen_random_uuid()'),('recurring','user_id','uuid',true,null),
      ('recurring','name','text',true,null),('recurring','type','text',true,$d$'expense'::text$d$),
      ('recurring','amount','numeric',true,'0'),('recurring','account_id','uuid',false,null),
      ('recurring','card_id','uuid',false,null),('recurring','frequency','text',true,$d$'monthly'::text$d$),
      ('recurring','interval','integer',true,'1'),('recurring','start_date','date',true,'CURRENT_DATE'),
      ('recurring','next_date','date',true,'CURRENT_DATE'),('recurring','active','boolean',true,'true'),
      ('transactions','id','uuid',true,'gen_random_uuid()'),('transactions','user_id','uuid',true,null),
      ('transactions','transaction_date','date',true,null),('transactions','description','text',true,null),
      ('transactions','amount','numeric',true,null),('transactions','account_id','uuid',false,null),
      ('transactions','card_id','uuid',false,null),('transactions','transaction_type','text',true,$d$'despesa'::text$d$),
      ('transactions','status','text',false,$d$'realizado'::text$d$),
      ('monthly_plans','id','uuid',true,'gen_random_uuid()'),('monthly_plans','user_id','uuid',true,null)
    ) as expected(table_name,column_name,type_name,not_null,default_expression)
  loop
    if to_regclass('public.'||v_row.table_name) is null then continue; end if;
    select a.atttypid,a.attnotnull,
           case when a.atthasdef then pg_get_expr(d.adbin,d.adrelid) end
      into v_oid,v_bool,v_text_two
    from pg_attribute a
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=to_regclass('public.'||v_row.table_name)
      and a.attname=v_row.column_name and a.attnum>0 and not a.attisdropped;
    if not found then
      v_blockers:=v_blockers||jsonb_build_array('column:'||v_row.table_name||'.'||v_row.column_name||':missing');
    elsif v_oid is distinct from to_regtype(v_row.type_name)::oid
       or v_bool is distinct from v_row.not_null
       or (
         not ((v_row.table_name='recurring' and v_row.column_name='type')
              or (v_row.table_name='categories' and v_row.column_name='kind'))
         and regexp_replace(lower(coalesce(v_text_two,'')),'[[:space:]]+','','g')
             <>regexp_replace(lower(coalesce(v_row.default_expression,'')),'[[:space:]]+','','g')
       )
       or (
         ((v_row.table_name='recurring' and v_row.column_name='type')
          or (v_row.table_name='categories' and v_row.column_name='kind'))
         and regexp_replace(lower(coalesce(v_text_two,'')),'[[:space:]]+','','g')
             not in ($d$'expense'::text$d$,$d$'despesa'::text$d$)
       ) then
      v_blockers:=v_blockers||jsonb_build_array('column:'||v_row.table_name||'.'||v_row.column_name||':incompatible_contract');
    end if;
  end loop;

  -- V82 columns may all be absent (pending) or all be exact (applied).
  for v_row in
    select * from (values
      (1,'accounts','balance_as_of','date'),
      (1,'assets','opening_value','numeric'),(1,'assets','value_as_of','date'),
      (1,'transactions','source_account_id','uuid'),(1,'transactions','destination_account_id','uuid'),
      (1,'transactions','asset_id','uuid'),(1,'transactions','liability_id','uuid'),
      (1,'transactions','recurring_series_id','uuid'),(1,'transactions','recurring_occurrence_date','date'),
      (1,'transactions','installment_series_id','uuid'),(1,'transactions','installment_number','integer'),
      (1,'transactions','operation_id','uuid'),(1,'transactions','reversal_of_id','uuid'),
      (2,'recurring','source_account_id','uuid'),(2,'recurring','destination_account_id','uuid'),
      (2,'recurring','asset_id','uuid')
    ) as expected(migration_no,table_name,column_name,type_name)
  loop
    if exists(
      select 1 from pg_attribute
      where attrelid=to_regclass('public.'||v_row.table_name) and attname=v_row.column_name
        and attnum>0 and not attisdropped
    ) then
      if v_row.migration_no=1 then v_m1_presence:=v_m1_presence+1; else v_m2_presence:=v_m2_presence+1; end if;
      select pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.atthasdef
        into v_text,v_bool,v_bool_two
      from pg_attribute a
      where a.attrelid=to_regclass('public.'||v_row.table_name) and a.attname=v_row.column_name
        and a.attnum>0 and not a.attisdropped;
      if v_text<>v_row.type_name or v_bool or v_bool_two then
        v_blockers:=v_blockers||jsonb_build_array('v82_column:'||v_row.table_name||'.'||v_row.column_name||':incompatible');
      end if;
    end if;
  end loop;

  -- V81 ownership objects retained by both migrations.
  for v_row in
    select * from (values
      ('goals','goals_id_user_id_key','u','UNIQUE (id, user_id)'),
      ('recurring','recurring_id_user_id_key','u','UNIQUE (id, user_id)'),
      ('transactions','transactions_id_user_id_key','u','UNIQUE (id, user_id)'),
      ('recurring','recurring_goal_user_fkey','f','FOREIGN KEY (goal_id, user_id) REFERENCES goals(id, user_id) ON DELETE SET NULL (goal_id)'),
      ('transactions','transactions_goal_user_fkey','f','FOREIGN KEY (goal_id, user_id) REFERENCES goals(id, user_id) ON DELETE SET NULL (goal_id)')
    ) as expected(table_name,constraint_name,constraint_type,definition)
  loop
    select contype::text,pg_get_constraintdef(oid) into v_text,v_text_two
    from pg_constraint where conrelid=to_regclass('public.'||v_row.table_name) and conname=v_row.constraint_name;
    if not found and v_row.constraint_name in ('recurring_id_user_id_key','transactions_id_user_id_key')
       and not v_m1_history then
      select count(*) into v_count
      from pg_constraint
      where conrelid=to_regclass('public.'||v_row.table_name)
        and contype=v_row.constraint_type::"char"
        and regexp_replace(lower(pg_get_constraintdef(oid)),'[[:space:]]+',' ','g')
            =regexp_replace(lower(v_row.definition),'[[:space:]]+',' ','g');
      if v_count>1 then
        v_blockers:=v_blockers||jsonb_build_array('constraint:'||v_row.table_name||'.'||v_row.constraint_name||':multiple_semantic_equivalents');
      end if;
    elsif not found or v_text<>v_row.constraint_type
       or regexp_replace(lower(coalesce(v_text_two,'')),'[[:space:]]+',' ','g')
          <>regexp_replace(lower(v_row.definition),'[[:space:]]+',' ','g') then
      v_blockers:=v_blockers||jsonb_build_array('constraint:'||v_row.table_name||'.'||v_row.constraint_name||':missing_or_incompatible');
    end if;
  end loop;

  -- Legacy single-column FKs are accepted only with their exact V81 definitions.
  for v_row in
    select * from (values
      ('transactions','transactions_account_id_fkey','FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL'),
      ('transactions','transactions_card_id_fkey','FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL'),
      ('recurring','recurring_account_id_fkey','FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL'),
      ('recurring','recurring_card_id_fkey','FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL')
    ) as expected(table_name,constraint_name,definition)
  loop
    select pg_get_constraintdef(oid) into v_text
    from pg_constraint where conrelid=to_regclass('public.'||v_row.table_name) and conname=v_row.constraint_name;
    if found and regexp_replace(lower(v_text),'[[:space:]]+',' ','g')
                 <>regexp_replace(lower(v_row.definition),'[[:space:]]+',' ','g') then
      v_blockers:=v_blockers||jsonb_build_array('legacy_constraint:'||v_row.table_name||'.'||v_row.constraint_name||':incompatible');
    end if;
  end loop;

  -- Existing V82 constraints must match the reviewed DDL and remain NOT VALID
  -- where legacy preservation was intentional.
  for v_row in
    select * from (values
      (1,'accounts','accounts_id_user_id_key','u','UNIQUE (id, user_id)',false),
      (1,'cards','cards_id_user_id_key','u','UNIQUE (id, user_id)',false),
      (1,'assets','assets_id_user_id_key','u','UNIQUE (id, user_id)',false),
      (1,'liabilities','liabilities_id_user_id_key','u','UNIQUE (id, user_id)',false),
      (1,'transactions','transactions_account_user_fkey','f','FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE SET NULL (account_id) NOT VALID',true),
      (1,'transactions','transactions_card_user_fkey','f','FOREIGN KEY (card_id, user_id) REFERENCES cards(id, user_id) ON DELETE SET NULL (card_id) NOT VALID',true),
      (1,'transactions','transactions_source_account_user_fkey','f','FOREIGN KEY (source_account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE SET NULL (source_account_id) NOT VALID',true),
      (1,'transactions','transactions_destination_account_user_fkey','f','FOREIGN KEY (destination_account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE SET NULL (destination_account_id) NOT VALID',true),
      (1,'transactions','transactions_asset_user_fkey','f','FOREIGN KEY (asset_id, user_id) REFERENCES assets(id, user_id) ON DELETE SET NULL (asset_id) NOT VALID',true),
      (1,'transactions','transactions_liability_user_fkey','f','FOREIGN KEY (liability_id, user_id) REFERENCES liabilities(id, user_id) ON DELETE SET NULL (liability_id) NOT VALID',true),
      (1,'transactions','transactions_recurring_series_user_fkey','f','FOREIGN KEY (recurring_series_id, user_id) REFERENCES recurring(id, user_id) ON DELETE SET NULL (recurring_series_id) NOT VALID',true),
      (1,'transactions','transactions_reversal_user_fkey','f','FOREIGN KEY (reversal_of_id, user_id) REFERENCES transactions(id, user_id) ON DELETE RESTRICT NOT VALID',true),
      (1,'recurring','recurring_account_user_fkey','f','FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE SET NULL (account_id) NOT VALID',true),
      (1,'recurring','recurring_card_user_fkey','f','FOREIGN KEY (card_id, user_id) REFERENCES cards(id, user_id) ON DELETE SET NULL (card_id) NOT VALID',true),
      (1,'transactions','transactions_amount_positive_v82','c','CHECK ((amount > (0)::numeric)) NOT VALID',true),
      (1,'transactions','transactions_transfer_shape_v82','c',$d$CHECK (((transaction_type <> 'transferencia'::text) OR ((source_account_id IS NOT NULL) AND (destination_account_id IS NOT NULL) AND (source_account_id <> destination_account_id)))) NOT VALID$d$,true),
      (1,'transactions','transactions_investment_shape_v82','c',$d$CHECK (((transaction_type <> 'investimento'::text) OR ((source_account_id IS NOT NULL) AND (asset_id IS NOT NULL)))) NOT VALID$d$,true),
      (1,'transactions','transactions_rescue_shape_v82','c',$d$CHECK (((transaction_type <> 'resgate'::text) OR ((destination_account_id IS NOT NULL) AND (asset_id IS NOT NULL)))) NOT VALID$d$,true),
      (1,'transactions','transactions_recurring_identity_v82','c','CHECK (((recurring_series_id IS NULL) OR (recurring_occurrence_date IS NOT NULL))) NOT VALID',true),
      (1,'transactions','transactions_installment_identity_v82','c','CHECK ((((installment_series_id IS NULL) AND (installment_number IS NULL)) OR ((installment_series_id IS NOT NULL) AND (installment_number > 0)))) NOT VALID',true),
      (1,'transactions','transactions_reversal_not_self_v82','c','CHECK (((reversal_of_id IS NULL) OR (reversal_of_id <> id))) NOT VALID',true),
      (2,'recurring','recurring_source_account_user_fkey','f','FOREIGN KEY (source_account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE SET NULL (source_account_id) NOT VALID',true),
      (2,'recurring','recurring_destination_account_user_fkey','f','FOREIGN KEY (destination_account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE SET NULL (destination_account_id) NOT VALID',true),
      (2,'recurring','recurring_asset_user_fkey','f','FOREIGN KEY (asset_id, user_id) REFERENCES assets(id, user_id) ON DELETE SET NULL (asset_id) NOT VALID',true),
      (2,'recurring','recurring_amount_positive_v82','c','CHECK ((amount > (0)::numeric)) NOT VALID',true),
      (2,'recurring','recurring_investment_shape_v82','c',$d$CHECK (((lower(type) <> ALL (ARRAY['investimento'::text, 'investment'::text])) OR ((source_account_id IS NOT NULL) AND (asset_id IS NOT NULL)))) NOT VALID$d$,true),
      (2,'recurring','recurring_transfer_shape_v82','c',$d$CHECK (((lower(type) <> ALL (ARRAY['transferencia'::text, 'transferência'::text, 'transfer'::text])) OR ((source_account_id IS NOT NULL) AND (destination_account_id IS NOT NULL) AND (source_account_id <> destination_account_id)))) NOT VALID$d$,true),
      (2,'recurring','recurring_rescue_shape_v82','c',$d$CHECK (((lower(type) <> ALL (ARRAY['resgate'::text, 'rescue'::text, 'withdrawal'::text])) OR ((asset_id IS NOT NULL) AND (destination_account_id IS NOT NULL)))) NOT VALID$d$,true)
    ) as expected(migration_no,table_name,constraint_name,constraint_type,definition,must_be_not_valid)
  loop
    select contype::text,pg_get_constraintdef(oid),convalidated
      into v_text,v_text_two,v_bool
    from pg_constraint where conrelid=to_regclass('public.'||v_row.table_name) and conname=v_row.constraint_name;
    if found then
      if v_row.migration_no=1 then v_m1_presence:=v_m1_presence+1; else v_m2_presence:=v_m2_presence+1; end if;
      if v_text<>v_row.constraint_type
         or regexp_replace(lower(v_text_two),'[[:space:]]+',' ','g')
            <>regexp_replace(lower(v_row.definition),'[[:space:]]+',' ','g')
         or (v_row.must_be_not_valid and v_bool) then
        v_blockers:=v_blockers||jsonb_build_array('v82_constraint:'||v_row.table_name||'.'||v_row.constraint_name||':incompatible');
      end if;
    end if;
  end loop;

  -- V81 and V82 status constraints are both recognized; any other definition is drift.
  select pg_get_constraintdef(oid),convalidated into v_text,v_bool
  from pg_constraint where conrelid=to_regclass('public.transactions') and conname='transactions_status_check';
  if not found then
    v_blockers:=v_blockers||jsonb_build_array('constraint:transactions.transactions_status_check:missing');
  elsif regexp_replace(lower(v_text),'[[:space:]]+',' ','g')=
        regexp_replace(lower($d$CHECK ((status = ANY (ARRAY['realizado'::text, 'pendente'::text, 'cancelado'::text])))$d$),'[[:space:]]+',' ','g') then
    null;
  elsif regexp_replace(lower(v_text),'[[:space:]]+',' ','g')=
        regexp_replace(lower($d$CHECK (((status IS NULL) OR (status = ANY (ARRAY['realizado'::text, 'pendente'::text, 'programado'::text, 'cancelado'::text])))) NOT VALID$d$),'[[:space:]]+',' ','g') and not v_bool then
    v_m1_presence:=v_m1_presence+1;
  else
    v_blockers:=v_blockers||jsonb_build_array('constraint:transactions.transactions_status_check:incompatible');
  end if;

  -- Existing V82 indexes must match columns, uniqueness and predicates exactly.
  for v_row in
    select * from (values
      (1,'transactions_user_operation_uidx','CREATE UNIQUE INDEX transactions_user_operation_uidx ON public.transactions USING btree (user_id, operation_id) WHERE (operation_id IS NOT NULL)'),
      (1,'transactions_user_recurring_occurrence_uidx','CREATE UNIQUE INDEX transactions_user_recurring_occurrence_uidx ON public.transactions USING btree (user_id, recurring_series_id, recurring_occurrence_date) WHERE ((recurring_series_id IS NOT NULL) AND (recurring_occurrence_date IS NOT NULL))'),
      (1,'transactions_user_installment_uidx','CREATE UNIQUE INDEX transactions_user_installment_uidx ON public.transactions USING btree (user_id, installment_series_id, installment_number) WHERE ((installment_series_id IS NOT NULL) AND (installment_number IS NOT NULL))'),
      (1,'transactions_user_reversal_uidx','CREATE UNIQUE INDEX transactions_user_reversal_uidx ON public.transactions USING btree (user_id, reversal_of_id) WHERE (reversal_of_id IS NOT NULL)'),
      (1,'transactions_user_status_date_v82_idx','CREATE INDEX transactions_user_status_date_v82_idx ON public.transactions USING btree (user_id, status, transaction_date)'),
      (1,'transactions_user_source_date_v82_idx','CREATE INDEX transactions_user_source_date_v82_idx ON public.transactions USING btree (user_id, source_account_id, transaction_date) WHERE (source_account_id IS NOT NULL)'),
      (1,'transactions_user_destination_date_v82_idx','CREATE INDEX transactions_user_destination_date_v82_idx ON public.transactions USING btree (user_id, destination_account_id, transaction_date) WHERE (destination_account_id IS NOT NULL)'),
      (1,'transactions_user_asset_date_v82_idx','CREATE INDEX transactions_user_asset_date_v82_idx ON public.transactions USING btree (user_id, asset_id, transaction_date) WHERE (asset_id IS NOT NULL)'),
      (2,'recurring_user_source_account_v82_idx','CREATE INDEX recurring_user_source_account_v82_idx ON public.recurring USING btree (user_id, source_account_id) WHERE (source_account_id IS NOT NULL)'),
      (2,'recurring_user_destination_account_v82_idx','CREATE INDEX recurring_user_destination_account_v82_idx ON public.recurring USING btree (user_id, destination_account_id) WHERE (destination_account_id IS NOT NULL)'),
      (2,'recurring_user_asset_v82_idx','CREATE INDEX recurring_user_asset_v82_idx ON public.recurring USING btree (user_id, asset_id) WHERE (asset_id IS NOT NULL)'),
      (2,'recurring_user_active_next_date_v82_idx','CREATE INDEX recurring_user_active_next_date_v82_idx ON public.recurring USING btree (user_id, next_date) WHERE (active IS TRUE)')
    ) as expected(migration_no,index_name,definition)
  loop
    select pg_get_indexdef(c.oid) into v_text
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=v_row.index_name and c.relkind='i';
    if found then
      if v_row.migration_no=1 then v_m1_presence:=v_m1_presence+1; else v_m2_presence:=v_m2_presence+1; end if;
      if regexp_replace(lower(v_text),'[[:space:]]+',' ','g')
         <>regexp_replace(lower(v_row.definition),'[[:space:]]+',' ','g') then
        v_blockers:=v_blockers||jsonb_build_array('v82_index:'||v_row.index_name||':incompatible');
      end if;
    end if;
  end loop;

  -- RPC signature/body/return, SECURITY INVOKER, controlled search_path and grants.
  for v_row in
    select * from (values
      (1,'create_transfer_v82','public.create_transfer_v82(uuid,uuid,uuid,numeric,date,text)','d5fc0089bb7964841249ab7dd5448868','public.transactions'::regtype,false),
      (1,'create_investment_v82','public.create_investment_v82(uuid,uuid,uuid,numeric,date,text,text)','ccf379a9df25d1bc209a4df9c8e64303','public.transactions'::regtype,false),
      (1,'create_rescue_v82','public.create_rescue_v82(uuid,uuid,uuid,numeric,date,text)','25021eb487d785e19ee17115632cb13b','public.transactions'::regtype,false),
      (1,'reverse_structured_operation_v82','public.reverse_structured_operation_v82(uuid,uuid,date,text)','18bf8e05ca2ff68a355f388e869c5892','public.transactions'::regtype,false),
      (2,'materialize_recurring_occurrences_v82','public.materialize_recurring_occurrences_v82(date)','9d5d8239ef4e434a63f89d44e8ad3ce2','public.transactions'::regtype,true),
      (2,'create_investment_entry_v82','public.create_investment_entry_v82(uuid,uuid,uuid,numeric,date,text,text,text,text,text,uuid,text)','136dbe1155585e6b2f7ec4c4e6746837','public.transactions'::regtype,false)
    ) as expected(migration_no,function_name,signature,body_md5,return_type,returns_set)
  loop
    select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_row.function_name;
    if v_count>0 then
      if v_row.migration_no=1 then v_m1_presence:=v_m1_presence+1; else v_m2_presence:=v_m2_presence+1; end if;
      if v_count<>1 or to_regprocedure(v_row.signature) is null then
        v_blockers:=v_blockers||jsonb_build_array('rpc:'||v_row.function_name||':unexpected_signature_or_overload');
        if v_row.migration_no=1 then v_m1_function_issues:=v_m1_function_issues+1;else v_m2_function_issues:=v_m2_function_issues+1;end if;
      else
        select md5(p.prosrc),p.prosecdef,p.proconfig,p.prorettype,p.proretset,l.lanname
          into v_text,v_bool,v_config,v_oid,v_bool_two,v_text_two
        from pg_proc p join pg_language l on l.oid=p.prolang
        where p.oid=to_regprocedure(v_row.signature);
        if v_text<>v_row.body_md5 or v_bool
           or v_config is distinct from array['search_path=public, pg_temp']::text[]
           or v_oid<>v_row.return_type::oid or v_bool_two is distinct from v_row.returns_set
           or v_text_two<>'plpgsql'
           or exists(
             select 1 from pg_proc p
             cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
             where p.oid=to_regprocedure(v_row.signature)
               and acl.grantee=0 and acl.privilege_type='EXECUTE'
           )
           or has_function_privilege('anon',v_row.signature,'execute')
           or not has_function_privilege('authenticated',v_row.signature,'execute') then
          v_blockers:=v_blockers||jsonb_build_array('rpc:'||v_row.function_name||':incompatible_contract_or_grants');
          if v_row.migration_no=1 then v_m1_function_issues:=v_m1_function_issues+1;else v_m2_function_issues:=v_m2_function_issues+1;end if;
        end if;
      end if;
    end if;
  end loop;

  -- API-facing policies may be duplicated, use PUBLIC, or call auth.uid() directly
  -- before migration 3. They are reconcilable only when every expression is exactly
  -- owner-only and the combined policies already cover CRUD without broadening access.
  foreach v_table in array array['accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans'] loop
    if to_regclass('public.'||v_table) is null then continue; end if;
    select count(*) into v_count from pg_policies
    where schemaname='public' and tablename=v_table
      and roles&&array['public','anon','authenticated']::name[];
    if v_count=0 then
      v_blockers:=v_blockers||jsonb_build_array('policy:'||v_table||':missing');
      v_policy_issues:=v_policy_issues+1;
      continue;
    end if;
    v_policy_duplicate_count:=v_policy_duplicate_count+greatest(v_count-1,0);
    select count(*) into v_count_two
    from pg_policies where schemaname='public' and tablename=v_table
      and roles&&array['public','anon','authenticated']::name[]
      and (
        regexp_replace(lower(coalesce(qual,'')),'[[:space:]()]','','g') in ('auth.uid=user_id','user_id=auth.uid')
        or regexp_replace(lower(coalesce(with_check,'')),'[[:space:]()]','','g') in ('auth.uid=user_id','user_id=auth.uid')
      );
    v_direct_auth_uid_policy_count:=v_direct_auth_uid_policy_count+v_count_two;
    select count(*) into v_count
    from pg_policies
    where schemaname='public' and tablename=v_table
      and roles&&array['public','anon','authenticated']::name[]
      and (
          permissive<>'PERMISSIVE' or not (roles<@array['public','anon','authenticated']::name[])
          or ((cmd in ('ALL','SELECT','UPDATE','DELETE')) and
            regexp_replace(lower(coalesce(qual,'')),'[[:space:]()]','','g') not in
              ('selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id',
               'user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid'))
          or (cmd='INSERT' and regexp_replace(lower(coalesce(with_check,'')),'[[:space:]()]','','g') not in
              ('selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id',
               'user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid'))
          or (cmd in ('ALL','UPDATE') and with_check is not null
              and regexp_replace(lower(with_check),'[[:space:]()]','','g') not in
                ('selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id',
                 'user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid'))
      );
    if v_count>0 then
      v_blockers:=v_blockers||jsonb_build_array('policy:'||v_table||':unsafe_or_incomplete_expression');
      v_policy_issues:=v_policy_issues+v_count;
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=v_table
      and roles&&array['public','authenticated']::name[] and cmd in ('ALL','SELECT')
      and regexp_replace(lower(coalesce(qual,'')),'[[:space:]()]','','g') in
        ('selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id','user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid'))
      or not exists(select 1 from pg_policies where schemaname='public' and tablename=v_table
      and roles&&array['public','authenticated']::name[] and cmd in ('ALL','INSERT')
      and regexp_replace(lower(coalesce(with_check,qual,'')),'[[:space:]()]','','g') in
        ('selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id','user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid'))
      or not exists(select 1 from pg_policies where schemaname='public' and tablename=v_table
      and roles&&array['public','authenticated']::name[] and cmd in ('ALL','UPDATE')
      and regexp_replace(lower(coalesce(qual,'')),'[[:space:]()]','','g') in
        ('selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id','user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid')
      and regexp_replace(lower(coalesce(with_check,qual,'')),'[[:space:]()]','','g') in
        ('selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id','user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid'))
      or not exists(select 1 from pg_policies where schemaname='public' and tablename=v_table
      and roles&&array['public','authenticated']::name[] and cmd in ('ALL','DELETE')
      and regexp_replace(lower(coalesce(qual,'')),'[[:space:]()]','','g') in
        ('selectauth.uidasuid=user_id','selectauth.uid=user_id','auth.uid=user_id','user_id=selectauth.uidasuid','user_id=selectauth.uid','user_id=auth.uid')) then
      v_blockers:=v_blockers||jsonb_build_array('policy:'||v_table||':owner_crud_coverage_missing');
      v_policy_issues:=v_policy_issues+1;
    end if;
    if (select count(*) from pg_policies where schemaname='public' and tablename=v_table
          and roles&&array['public','anon','authenticated']::name[])=1 and exists(
      select 1 from pg_policies where schemaname='public' and tablename=v_table
        and policyname='mb_v82_own_rows' and roles=array['authenticated']::name[] and cmd='ALL'
        and regexp_replace(lower(coalesce(qual,'')),'[[:space:]()]','','g')='selectauth.uidasuid=user_id'
        and regexp_replace(lower(coalesce(with_check,'')),'[[:space:]()]','','g')='selectauth.uidasuid=user_id'
    ) then
      v_m3_canonical_policy_count:=v_m3_canonical_policy_count+1;
      v_m3_presence:=v_m3_presence+1;
    end if;
  end loop;

  -- Excess grants are a known, recoverable production fact handled by migration 3.
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema='public' and grantee in ('anon','PUBLIC')
    and table_name=any(array['accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans']);
  select count(*) into v_count_two
  from information_schema.role_table_grants
  where table_schema='public' and grantee='authenticated'
    and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
    and table_name=any(array['accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans']);
  v_excess_grant_count:=v_count+v_count_two;
  select v_excess_grant_count+count(*) into v_excess_grant_count
  from pg_attribute a
  join pg_class c on c.oid=a.attrelid
  join pg_namespace n on n.oid=c.relnamespace
  cross join lateral aclexplode(a.attacl) acl
  left join pg_roles r on r.oid=acl.grantee
  where n.nspname='public' and c.relname=any(array['accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans'])
    and a.attnum>0 and not a.attisdropped
    and (acl.grantee=0 or r.rolname in ('anon','authenticated'));
  v_metrics:=v_metrics||jsonb_build_object('excess_table_or_column_grant_count',v_excess_grant_count);

  -- Aggregate-only legacy data checks.
  if to_regclass('public.transactions') is not null then
    execute 'select count(*) from public.transactions where amount is null or amount<=0' into v_count;
    v_metrics:=v_metrics||jsonb_build_object('transactions_nonpositive_amount_count',v_count);
    if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('legacy:transactions_nonpositive_amount');v_bad_data:=v_bad_data+v_count;end if;
    execute $sql$select count(*) from public.transactions where transaction_type is null or transaction_type not in ('receita','despesa','transferencia','investimento','resgate')$sql$ into v_count;
    v_metrics:=v_metrics||jsonb_build_object('transactions_incompatible_type_count',v_count);
    if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('legacy:transactions_incompatible_type');v_bad_data:=v_bad_data+v_count;end if;
    execute $sql$select count(*) from public.transactions where status is not null and status not in ('realizado','pendente','programado','cancelado')$sql$ into v_count;
    v_metrics:=v_metrics||jsonb_build_object('transactions_incompatible_status_count',v_count);
    if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('legacy:transactions_incompatible_status');v_bad_data:=v_bad_data+v_count;end if;
  end if;
  if to_regclass('public.recurring') is not null then
    execute 'select count(*) from public.recurring where amount is null or amount<=0' into v_count;
    v_metrics:=v_metrics||jsonb_build_object('recurring_nonpositive_amount_count',v_count);
    if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('legacy:recurring_nonpositive_amount');v_bad_data:=v_bad_data+v_count;end if;
    execute $sql$select count(*) from public.recurring where lower(type) not in ('receita','income','revenue','despesa','expense','investimento','investment','transferencia','transferência','transfer','resgate','rescue','withdrawal') or frequency not in ('daily','weekly','biweekly','monthly','yearly')$sql$ into v_count;
    v_metrics:=v_metrics||jsonb_build_object('recurring_incompatible_type_or_frequency_count',v_count);
    if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('legacy:recurring_incompatible_type_or_frequency');v_bad_data:=v_bad_data+v_count;end if;
  end if;

  -- Cross-user ownership references, including optional V82 relationships.
  for v_row in
    select * from (values
      ('transactions','account_id','accounts'),('transactions','card_id','cards'),('transactions','goal_id','goals'),
      ('transactions','source_account_id','accounts'),('transactions','destination_account_id','accounts'),
      ('transactions','asset_id','assets'),('transactions','liability_id','liabilities'),
      ('transactions','recurring_series_id','recurring'),('transactions','reversal_of_id','transactions'),
      ('recurring','account_id','accounts'),('recurring','card_id','cards'),('recurring','goal_id','goals'),
      ('recurring','source_account_id','accounts'),('recurring','destination_account_id','accounts'),('recurring','asset_id','assets')
    ) as relationship(source_table,source_column,target_table)
  loop
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_row.source_table and column_name=v_row.source_column) then
      execute format(
        'select count(*) from public.%I s join public.%I t on t.id=s.%I where s.%I is not null and s.user_id is distinct from t.user_id',
        v_row.source_table,v_row.target_table,v_row.source_column,v_row.source_column
      ) into v_count;
      v_cross_user:=v_cross_user+v_count;
      if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('ownership:'||v_row.source_table||'.'||v_row.source_column||':cross_user');end if;
    end if;
  end loop;
  v_metrics:=v_metrics||jsonb_build_object('cross_user_reference_count',v_cross_user);

  -- Structured shapes; a clean V81 schema with no structured legacy remains pending.
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='source_account_id') then
    execute $sql$select count(*) from public.transactions where
      (transaction_type='investimento' and (source_account_id is null or asset_id is null)) or
      (transaction_type='transferencia' and (source_account_id is null or destination_account_id is null or source_account_id=destination_account_id)) or
      (transaction_type='resgate' and (asset_id is null or destination_account_id is null)) or
      (recurring_series_id is not null and recurring_occurrence_date is null) or
      ((installment_series_id is null)<>(installment_number is null)) or
      (installment_number is not null and installment_number<=0) or
      (reversal_of_id=id)$sql$ into v_count;
  else
    execute $sql$select count(*) from public.transactions where transaction_type in ('investimento','transferencia','resgate')$sql$ into v_count;
  end if;
  v_metrics:=v_metrics||jsonb_build_object('transactions_incompatible_v82_shape_count',v_count);
  if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('legacy:transactions_incompatible_v82_shape');v_bad_data:=v_bad_data+v_count;end if;

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='recurring' and column_name='source_account_id') then
    execute $sql$select count(*) from public.recurring where
      (lower(type) in ('investimento','investment') and (source_account_id is null or asset_id is null)) or
      (lower(type) in ('transferencia','transferência','transfer') and (source_account_id is null or destination_account_id is null or source_account_id=destination_account_id)) or
      (lower(type) in ('resgate','rescue','withdrawal') and (asset_id is null or destination_account_id is null))$sql$ into v_count;
  else
    execute $sql$select count(*) from public.recurring where lower(type) in ('investimento','investment','transferencia','transferência','transfer','resgate','rescue','withdrawal')$sql$ into v_count;
  end if;
  v_metrics:=v_metrics||jsonb_build_object('recurring_incompatible_v82_shape_count',v_count);
  if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('legacy:recurring_incompatible_v82_shape');v_bad_data:=v_bad_data+v_count;end if;

  -- Snapshot/date-base consistency. Null/null remains explicit compatible legacy.
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='accounts' and column_name='balance_as_of') then
    execute 'select count(*) from public.accounts where balance_as_of is null' into v_count;
    v_metrics:=v_metrics||jsonb_build_object('accounts_without_balance_as_of_count',v_count);
  else
    v_metrics:=v_metrics||jsonb_build_object('accounts_without_balance_as_of_count','column_pending');
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='assets' and column_name='opening_value') then
    execute 'select count(*) from public.assets where (opening_value is null)<>(value_as_of is null)' into v_count;
    v_metrics:=v_metrics||jsonb_build_object('assets_partial_snapshot_count',v_count);
    if v_count>0 then v_blockers:=v_blockers||jsonb_build_array('snapshot:assets_opening_value_value_as_of_partial');end if;
  else
    v_metrics:=v_metrics||jsonb_build_object('assets_partial_snapshot_count','columns_pending');
  end if;

  -- Migration 3 access/default contract.
  select count(*) into v_m3_new_default_count
  from (
    select pg_get_expr(d.adbin,d.adrelid) as expression
    from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where (a.attrelid='public.categories'::regclass and a.attname='kind')
       or (a.attrelid='public.recurring'::regclass and a.attname='type')
  ) defaults
  where regexp_replace(lower(expression),'[[:space:]]+','','g')=$d$'despesa'::text$d$;
  v_m3_presence:=v_m3_presence+v_m3_new_default_count;

  select count(*) into v_m3_constraint_count
  from pg_constraint
  where (conrelid='public.categories'::regclass and conname='categories_kind_v82' and contype='c' and not convalidated
         and regexp_replace(lower(pg_get_constraintdef(oid)),'[[:space:]]+',' ','g')=
             regexp_replace(lower($d$check ((lower(kind) = any (array['receita'::text, 'despesa'::text, 'income'::text, 'expense'::text]))) not valid$d$),'[[:space:]]+',' ','g'))
     or (conrelid='public.recurring'::regclass and conname='recurring_type_v82' and contype='c' and not convalidated
         and regexp_replace(lower(pg_get_constraintdef(oid)),'[[:space:]]+',' ','g')=
             regexp_replace(lower($d$check ((lower(type) = any (array['receita'::text, 'income'::text, 'revenue'::text, 'despesa'::text, 'expense'::text, 'investimento'::text, 'investment'::text, 'transferencia'::text, 'transferência'::text, 'transfer'::text, 'resgate'::text, 'rescue'::text, 'withdrawal'::text]))) not valid$d$),'[[:space:]]+',' ','g'));
  if exists(select 1 from pg_constraint where conname in ('categories_kind_v82','recurring_type_v82'))
     and v_m3_constraint_count<>2 then
    v_blockers:=v_blockers||jsonb_build_array('migration_3:default_constraint_drift');
  end if;
  v_m3_presence:=v_m3_presence+v_m3_constraint_count;

  -- Component totals are explicit and covered by the loops above.
  v_m1_complete:=v_m1_presence=47
    and not exists(select 1 from pg_constraint where conname in ('transactions_account_id_fkey','transactions_card_id_fkey','recurring_account_id_fkey','recurring_card_id_fkey'))
    and 2=(
      select count(*) from pg_constraint
      where (conrelid='public.transactions'::regclass and conname='transactions_id_user_id_key'
             and contype='u' and pg_get_constraintdef(oid)='UNIQUE (id, user_id)')
         or (conrelid='public.recurring'::regclass and conname='recurring_id_user_id_key'
             and contype='u' and pg_get_constraintdef(oid)='UNIQUE (id, user_id)')
    )
    and v_m1_function_issues=0;
  v_m2_complete:=v_m2_presence=16 and v_m2_function_issues=0;
  v_m3_complete:=v_m3_canonical_policy_count=9
    and v_m3_new_default_count=2 and v_m3_constraint_count=2
    and v_excess_grant_count=0
    and not exists(
      select 1 from information_schema.role_table_grants
      where table_schema='public' and grantee='authenticated'
        and table_name=any(array['accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans'])
        and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
    )
    and not exists(
      select t.name
      from unnest(array['accounts','cards','categories','goals','assets','liabilities','recurring','transactions','monthly_plans']) as t(name)
      where (select count(distinct privilege_type) from information_schema.role_table_grants g
             where g.table_schema='public' and g.table_name=t.name
               and g.grantee='authenticated' and g.privilege_type in ('SELECT','INSERT','UPDATE','DELETE'))<>4
    );

  if v_m1_presence>0 and not v_m1_complete then
    v_blockers:=v_blockers||jsonb_build_array('migration_1:partial_or_incompatible_catalog_state');
  end if;
  if v_m2_presence>0 and not v_m2_complete then
    v_blockers:=v_blockers||jsonb_build_array('migration_2:partial_or_incompatible_catalog_state');
  end if;
  if v_m3_presence>0 and not v_m3_complete then
    v_blockers:=v_blockers||jsonb_build_array('migration_3:partial_or_incompatible_catalog_state');
  end if;
  if v_m1_history<>v_m1_complete then
    v_blockers:=v_blockers||jsonb_build_array('migration_1:history_catalog_mismatch');
  end if;
  if v_m2_history<>v_m2_complete then
    v_blockers:=v_blockers||jsonb_build_array('migration_2:history_catalog_mismatch');
  end if;
  if v_m3_history<>v_m3_complete then
    v_blockers:=v_blockers||jsonb_build_array('migration_3:history_catalog_mismatch');
  end if;
  if v_m2_complete and not v_m1_complete then
    v_blockers:=v_blockers||jsonb_build_array('migration_2:catalog_without_migration_1');
  end if;

  v_metrics:=v_metrics||jsonb_build_object(
    'required_tables',9,
    'policy_issue_count',v_policy_issues,
    'grant_issue_count',v_grant_issues,
    'rpc_issue_count',v_m1_function_issues+v_m2_function_issues,
    'legacy_incompatible_total',v_bad_data,
    'migration_1_state',case when v_m1_complete then 'complete' when v_m1_presence=0 then 'pending' else 'partial' end,
    'migration_2_state',case when v_m2_complete then 'complete' when v_m2_presence=0 then 'pending' else 'partial' end,
    'migration_3_state',case when v_m3_complete then 'complete' when v_m3_presence=0 then 'pending' else 'partial' end,
    'duplicate_api_policy_count',v_policy_duplicate_count,
    'direct_auth_uid_policy_count',v_direct_auth_uid_policy_count,
    'future_constraints_mode','NOT VALID for reviewed legacy-preserving checks/FKs'
  );

  raise notice 'MB_V82_PREFLIGHT_REPORT=%',jsonb_build_object(
    'result',case when jsonb_array_length(v_blockers)=0 then 'GO' else 'NO-GO' end,
    'metrics',v_metrics,
    'warnings',v_warnings,
    'blockers',v_blockers
  );
  if jsonb_array_length(v_blockers)>0 then
    raise exception 'MB_V82_PREFLIGHT_RESULT=NO-GO blocker_count=%',jsonb_array_length(v_blockers);
  end if;
  raise notice 'MB_V82_PREFLIGHT_RESULT=GO';
end
$preflight$;

rollback;
