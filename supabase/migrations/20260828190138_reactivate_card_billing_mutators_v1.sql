-- AVIORA Card Billing V1 — re-enable only the reviewed authenticated writers.
-- Requires shadow -> activation -> emergency revoke -> temporal hardening.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '3min';
select pg_advisory_xact_lock(
  hashtextextended('aviora:card-billing-mutator-activation-v1', 0)
);

-- Keep the validated empty Beta state stable between the fail-closed audit and
-- the ACL transition. No historical row is rewritten or backfilled here.
lock table public.transactions,
           billing_private.writer_context_v1,
           public.card_installment_series,
           public.card_billing_cycles,
           public.card_invoice_payments,
           public.card_payment_allocations,
           public.card_account_settlements,
           public.card_purchase_credits
  in access exclusive mode;

do $preflight$
declare
  v_signature text;
  v_private_signature text;
  v_reader_signature text;
  v_table text;
begin
  if to_regprocedure('auth.uid()') is null
     or to_regprocedure('public.has_active_access(text)') is null
     or to_regnamespace('billing_private') is null then
    raise exception 'card billing mutator reactivation requires the temporal APP contract'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.has_active_access(text)')
      and p.proowner = current_user::regrole
      and p.prosecdef is false
      and 'search_path=pg_catalog' = any(coalesce(p.proconfig, array[]::text[]))
  ) then
    raise exception 'card billing mutator reactivation requires the canonical APP predicate'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from unnest(array[
      'card_installment_series', 'card_billing_cycles',
      'card_invoice_payments', 'card_payment_allocations',
      'card_account_settlements', 'card_purchase_credits'
    ]) as expected(table_name)
    left join pg_class c
      on c.oid = to_regclass(format('public.%I', expected.table_name))
    where c.oid is null or c.relrowsecurity is not true
  ) then
    raise exception 'card billing mutator reactivation requires RLS on all shadow tables'
      using errcode = 'P0001';
  end if;

  if (select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename in (
          'card_installment_series', 'card_billing_cycles',
          'card_invoice_payments', 'card_payment_allocations',
          'card_account_settlements', 'card_purchase_credits'
        )) <> 6
     or exists (
       select 1
       from unnest(array[
         'card_installment_series', 'card_billing_cycles',
         'card_invoice_payments', 'card_payment_allocations',
         'card_account_settlements', 'card_purchase_credits'
       ]) as expected(table_name)
       left join pg_policies policy
         on policy.schemaname = 'public'
        and policy.tablename = expected.table_name
        and policy.policyname = expected.table_name || '_select_own'
        and policy.permissive = 'PERMISSIVE'
        and policy.roles = array['authenticated']::name[]
        and policy.cmd = 'SELECT'
        and policy.with_check is null
        and policy.qual ilike '%auth.uid()%'
        and policy.qual ilike '%has_active_access%APP%IS TRUE%'
       where policy.policyname is null
     ) then
    raise exception 'card billing mutator reactivation requires the exact APP-gated SELECT policies'
      using errcode = 'P0001';
  end if;

  foreach v_table in array array[
    'card_installment_series', 'card_billing_cycles',
    'card_invoice_payments', 'card_payment_allocations',
    'card_account_settlements', 'card_purchase_credits'
  ] loop
    if has_table_privilege('anon', format('public.%I', v_table), 'select')
       or has_table_privilege('anon', format('public.%I', v_table), 'insert')
       or has_table_privilege('anon', format('public.%I', v_table), 'update')
       or has_table_privilege('anon', format('public.%I', v_table), 'delete')
       or not has_table_privilege('authenticated', format('public.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'insert')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'update')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'delete') then
      raise exception 'card billing mutator reactivation requires read-only authenticated table ACL: %',
        v_table using errcode = 'P0001';
    end if;
  end loop;

  if exists (
    select 1
    from (values
      ('card_account_settlements_append_only_v1','public.card_account_settlements','billing_private.reject_ledger_mutation_v1()','268aa1ef59589deddbd4a43a1dda8a49'),
      ('card_account_settlements_guard_insert_v1','public.card_account_settlements','billing_private.guard_account_settlement_insert_v1()','fb75084d2d7fad651089ccd265f7eb82'),
      ('card_billing_cycles_calendar_guard_v1','public.card_billing_cycles','billing_private.guard_cycle_insert_v1()','909b90c9b39060c87218006705bc7964'),
      ('card_billing_cycles_immutable_v1','public.card_billing_cycles','billing_private.reject_cycle_update_v1()','edb0c1d4972c53a3e7d10b1b1727ca05'),
      ('card_installment_series_immutable_v1','public.card_installment_series','billing_private.reject_cycle_update_v1()','f7c298540d69bf67de6ca6455949701d'),
      ('card_invoice_payments_append_only_v1','public.card_invoice_payments','billing_private.reject_ledger_mutation_v1()','c288568ee306580c0ca252c90487866d'),
      ('card_invoice_payments_guard_insert_v1','public.card_invoice_payments','billing_private.guard_payment_insert_v1()','62100a534acd608fe3a76cd8ab527fd6'),
      ('card_invoice_payments_guard_temporal_v1','public.card_invoice_payments','billing_private.guard_card_payment_temporal_v1()','636b243cd64ab3fbc984059e333ecfca'),
      ('card_payment_allocations_append_only_v1','public.card_payment_allocations','billing_private.reject_ledger_mutation_v1()','f83c5e34b06e12293aface72526b97b6'),
      ('card_payment_allocations_guard_insert_v1','public.card_payment_allocations','billing_private.guard_payment_allocation_insert_v1()','d20ff5d7a375e6f1c54a9fafdb7f4c1c'),
      ('card_purchase_credits_append_only_v1','public.card_purchase_credits','billing_private.reject_ledger_mutation_v1()','fed41a2cc850941f3233f9bdacd512eb'),
      ('card_purchase_credits_guard_insert_v1','public.card_purchase_credits','billing_private.guard_purchase_credit_insert_v1()','c01f850b1f629e01860e9e14642ac8d3'),
      ('transactions_guard_card_cycle_v1','public.transactions','billing_private.guard_transaction_cycle_v1()','444ce40ca08d6a3263793a43f4fcd575'),
      ('transactions_guard_card_purchase_temporal_v1','public.transactions','billing_private.guard_card_purchase_temporal_v1()','f39e57b663b50bc5dc349b8ee5d8aead'),
      ('transactions_guard_linked_card_delete_v1','public.transactions','billing_private.guard_linked_transaction_delete_v1()','37d19017d6a16eeac833318a71279d87')
    ) as expected(trigger_name, relation_name, function_signature, fingerprint)
    left join pg_trigger t
      on t.tgname = expected.trigger_name
     and t.tgrelid = to_regclass(expected.relation_name)
     and t.tgfoid = to_regprocedure(expected.function_signature)
     and not t.tgisinternal
     and t.tgenabled = 'O'
     and md5(pg_get_triggerdef(t.oid, true)) = expected.fingerprint
    where t.oid is null
  ) or (
    select count(*)
    from pg_trigger t
    where not t.tgisinternal
      and t.tgname = any(array[
        'card_account_settlements_append_only_v1','card_account_settlements_guard_insert_v1',
        'card_billing_cycles_calendar_guard_v1','card_billing_cycles_immutable_v1',
        'card_installment_series_immutable_v1','card_invoice_payments_append_only_v1',
        'card_invoice_payments_guard_insert_v1','card_invoice_payments_guard_temporal_v1',
        'card_payment_allocations_append_only_v1','card_payment_allocations_guard_insert_v1',
        'card_purchase_credits_append_only_v1','card_purchase_credits_guard_insert_v1',
        'transactions_guard_card_cycle_v1','transactions_guard_card_purchase_temporal_v1',
        'transactions_guard_linked_card_delete_v1'
      ])
  ) <> 15 then
    raise exception 'card billing mutator reactivation requires every billing guard enabled'
      using errcode = 'P0001';
  end if;

  -- This is the first controlled Beta activation. A non-empty shadow topology
  -- requires a later, data-aware forward gate rather than silently reusing it.
  if exists (select 1 from public.card_installment_series)
     or exists (select 1 from public.card_billing_cycles)
     or exists (select 1 from public.card_invoice_payments)
     or exists (select 1 from public.card_payment_allocations)
     or exists (select 1 from public.card_account_settlements)
     or exists (select 1 from public.card_purchase_credits)
     or exists (select 1 from billing_private.writer_context_v1)
     or exists (
       select 1 from public.transactions
       where card_billing_cycle_id is not null or installment_total is not null
     ) then
    raise exception 'card billing mutator reactivation requires the validated empty shadow state'
      using errcode = 'P0001';
  end if;

  -- Freeze the exact reviewed public boundary. This rejects a wrapper/body,
  -- return-type, volatility or argument-default drift before opening ACLs.
  if exists (
    select 1
    from (values
      ('public.structure_my_card_purchase_v1(uuid)', '68ad3a33a416d9e95edd4103ca74217d'),
      ('public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)', '601f264f0c05de51dfaefad0926ae625'),
      ('public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)', '26c279a0c6f1bcdb171a8f29a471a0d0'),
      ('public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)', '10f9d919e888b0a42e87868d274df404'),
      ('public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)', 'cebd21abf91754ff3c663051033f630b'),
      ('public.reverse_my_card_payment_v1(uuid,uuid,date,text)', 'e83653cc65923db0c41a3ed6adf3dafa'),
      ('public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)', '1404cabf6683e66e56bbe3381a0e7e60'),
      ('public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)', '17809c26544386b29a9c90466e028793'),
      ('public.get_my_card_billing_summary_as_of_v1(uuid,date)', '3c7599385ad843667ea1417236ad2910'),
      ('public.get_my_card_account_positions_v1(uuid,date)', '21ceafca21b2980f2a6dbeeff59926b7'),
      ('public.get_my_card_billing_summary_v1(uuid)', 'd98f3e6f415330e41a8d8fab7b65b3de')
    ) as expected(signature, fingerprint)
    where to_regprocedure(expected.signature) is null
       or md5(pg_get_functiondef(to_regprocedure(expected.signature))) <> expected.fingerprint
  ) then
    raise exception 'card billing mutator reactivation refuses reviewed function drift'
      using errcode = 'P0001';
  end if;

  -- The public wrappers are only boundaries; attest the complete private
  -- implementation/guard topology they can reach before exposing any writer.
  if (select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'billing_private') <> 33
     or exists (
       select 1
       from (values
        ('billing_private.assert_installment_series_complete_v1()','c61911c4fc9931d552e57534efa99d30'),
        ('billing_private.assert_payment_complete_v1()','6315d7fe218d445bed2c81d159b57452'),
        ('billing_private.card_cycle_dates_v1(date,integer,integer)','78463cba76dbdbdddb9f842652d6637a'),
        ('billing_private.clamped_month_day_v1(date,integer)','ac4b732d72acda32cfcfbfe22943fda2'),
        ('billing_private.create_my_card_installment_series_pre_temporal_v1(uuid,uuid,date,text,numeric,integer,text,text,text)','d033c06281c7d092e266c8634eccd6aa'),
        ('billing_private.create_my_card_installment_series_shadow_impl_v1(uuid,uuid,date,text,numeric,integer,text,text,text)','9757acae9111293cde2e15a27d4f1fa0'),
        ('billing_private.create_my_card_installment_series_with_metadata_pre_temporal_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)','c6cfeb7683f922188039dddca6308b46'),
        ('billing_private.create_my_card_purchase_pre_temporal_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)','49e5b32ed3e61338800eef1344a3d9c8'),
        ('billing_private.credit_my_card_purchase_pre_temporal_v1(uuid,numeric,date,uuid,text)','4eb95fa87e6d259b3ff516a2e616dc24'),
        ('billing_private.credit_my_card_purchase_shadow_impl_v1(uuid,numeric,date,uuid,text)','f58c2b3b37fd1acc6a26200a7f1205a4'),
        ('billing_private.ensure_cycle_by_closing_month_v1(uuid,uuid,integer,integer,date)','f3d970780d8c39813f632a9c59c7d0ed'),
        ('billing_private.ensure_cycle_for_purchase_v1(uuid,uuid,date)','21200e2a3959113801a515ceb5c54a5f'),
        ('billing_private.get_my_card_account_positions_pre_temporal_v1(uuid,date)','aef316170d8bcb724f73a45b28b4090f'),
        ('billing_private.get_my_card_billing_summary_as_of_pre_temporal_v1(uuid,date)','b151ff78fc66d35c26acbbf5d6188873'),
        ('billing_private.guard_account_settlement_insert_v1()','3069986158850a56a47f231ac3c2c42c'),
        ('billing_private.guard_card_payment_temporal_v1()','81a4275067c285f78d31c80295904375'),
        ('billing_private.guard_card_purchase_temporal_v1()','4c79cbc917abe2eaca815c5f35651e49'),
        ('billing_private.guard_cycle_insert_v1()','124d08ae237827c1c85036cd2fc25320'),
        ('billing_private.guard_linked_transaction_delete_v1()','86eab1342d1905a46f4145b8501b825a'),
        ('billing_private.guard_payment_allocation_insert_v1()','0f7410c17638559d02966abaaa222275'),
        ('billing_private.guard_payment_insert_v1()','42104e5483a8c20653e99e3c27cd8bcd'),
        ('billing_private.guard_purchase_credit_insert_v1()','832ad0f181e2beb27866c22bd8b8a26e'),
        ('billing_private.guard_transaction_cycle_v1()','48319787034b7f74c81d11960642b17f'),
        ('billing_private.pay_my_card_invoice_pre_temporal_v1(uuid,uuid,numeric,date,uuid)','54ffd51ae5f3146ac399458debd9c206'),
        ('billing_private.pay_my_card_invoice_shadow_impl_v1(uuid,uuid,numeric,date,uuid)','5950ca1f8c8ebe2bf6f2decfc6f90dd9'),
        ('billing_private.reject_cycle_update_v1()','171537923e7fca29e3663e29ee1f2d8d'),
        ('billing_private.reject_ledger_mutation_v1()','3c2de5bd0ce526b22ba08fd9c92ded05'),
        ('billing_private.reverse_my_card_payment_pre_temporal_v1(uuid,uuid,date,text)','b5e65c71a8db7992303c98660ce44e45'),
        ('billing_private.reverse_my_card_payment_shadow_impl_v1(uuid,uuid,date,text)','108aa3090754719f5ca1261db1190e13'),
        ('billing_private.reverse_my_card_purchase_credit_pre_temporal_v1(uuid,uuid,date,text)','7a45aec117a056a047f4d4aaac78faed'),
        ('billing_private.reverse_my_card_purchase_credit_shadow_impl_v1(uuid,uuid,date,text)','7a3430e456ab0da4f68c7f2aaf565d2f'),
        ('billing_private.structure_my_card_purchase_pre_temporal_v1(uuid)','86568683eae80913a9259995911582e1'),
        ('billing_private.structure_my_card_purchase_shadow_impl_v1(uuid)','40ea562bdacc50a6a9cf5f5bf42bde6b')
       ) as expected(signature, fingerprint)
       where to_regprocedure(expected.signature) is null
          or md5(pg_get_functiondef(to_regprocedure(expected.signature))) <> expected.fingerprint
     ) then
    raise exception 'card billing mutator reactivation refuses private implementation drift'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) privilege
    where n.nspname = 'billing_private'
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee <> p.proowner
  ) then
    raise exception 'card billing mutator reactivation requires owner-only private function ACL'
      using errcode = 'P0001';
  end if;

  foreach v_signature in array array[
    'public.structure_my_card_purchase_v1(uuid)',
    'public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)',
    'public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)',
    'public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',
    'public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',
    'public.reverse_my_card_payment_v1(uuid,uuid,date,text)',
    'public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)',
    'public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)'
  ] loop
    if not exists (
         select 1
         from pg_proc p
         where p.oid = to_regprocedure(v_signature)
           and p.proowner = current_user::regrole
           and p.prosecdef is true
           and p.prokind = 'f'
           and p.provolatile = 'v'
           and 'search_path=pg_catalog' = any(coalesce(p.proconfig, array[]::text[]))
           and lower(p.prosrc) like '%has_active_access(''app'') is not true%'
       )
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_signature)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_signature)
           and privilege.privilege_type = 'EXECUTE'
           and privilege.grantee <> p.proowner
       )
       or has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute')
       or has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'card billing mutator reactivation requires a dormant reviewed wrapper: %',
        v_signature using errcode = 'P0001';
    end if;
  end loop;

  foreach v_private_signature in array array[
    'billing_private.structure_my_card_purchase_pre_temporal_v1(uuid)',
    'billing_private.create_my_card_installment_series_pre_temporal_v1(uuid,uuid,date,text,numeric,integer,text,text,text)',
    'billing_private.create_my_card_installment_series_with_metadata_pre_temporal_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)',
    'billing_private.create_my_card_purchase_pre_temporal_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',
    'billing_private.pay_my_card_invoice_pre_temporal_v1(uuid,uuid,numeric,date,uuid)',
    'billing_private.reverse_my_card_payment_pre_temporal_v1(uuid,uuid,date,text)',
    'billing_private.credit_my_card_purchase_pre_temporal_v1(uuid,numeric,date,uuid,text)',
    'billing_private.reverse_my_card_purchase_credit_pre_temporal_v1(uuid,uuid,date,text)',
    'billing_private.get_my_card_billing_summary_as_of_pre_temporal_v1(uuid,date)',
    'billing_private.get_my_card_account_positions_pre_temporal_v1(uuid,date)',
    'billing_private.guard_card_purchase_temporal_v1()',
    'billing_private.guard_card_payment_temporal_v1()'
  ] loop
    if to_regprocedure(v_private_signature) is null
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_private_signature)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_private_signature, 'execute')
       or has_function_privilege('authenticated', v_private_signature, 'execute')
       or has_function_privilege('service_role', v_private_signature, 'execute') then
      raise exception 'card billing mutator reactivation requires a private inaccessible implementation: %',
        v_private_signature using errcode = 'P0001';
    end if;
  end loop;

  foreach v_reader_signature in array array[
    'public.get_my_card_billing_summary_as_of_v1(uuid,date)',
    'public.get_my_card_account_positions_v1(uuid,date)',
    'public.get_my_card_billing_summary_v1(uuid)'
  ] loop
    if not exists (
         select 1
         from pg_proc p
         where p.oid = to_regprocedure(v_reader_signature)
           and p.proowner = current_user::regrole
           and p.prosecdef is false
           and p.prokind = 'f'
           and p.provolatile = 's'
           and 'search_path=pg_catalog' = any(coalesce(p.proconfig, array[]::text[]))
       )
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_reader_signature)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_reader_signature, 'execute')
       or not has_function_privilege('authenticated', v_reader_signature, 'execute')
       or has_function_privilege('service_role', v_reader_signature, 'execute')
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_reader_signature)
           and privilege.privilege_type = 'EXECUTE'
           and privilege.grantee not in (p.proowner, 'authenticated'::regrole::oid)
       ) then
      raise exception 'card billing mutator reactivation requires reviewed APP readers: %',
        v_reader_signature using errcode = 'P0001';
    end if;
  end loop;

  if exists (
       select 1
       from pg_namespace n
       cross join lateral aclexplode(
         coalesce(n.nspacl, acldefault('n', n.nspowner))
       ) privilege
       where n.nspname = 'billing_private'
         and privilege.grantee = 0
         and privilege.privilege_type = 'USAGE'
     )
     or exists (
       select 1
       from pg_namespace n
       cross join lateral aclexplode(
         coalesce(n.nspacl, acldefault('n', n.nspowner))
       ) privilege
       where n.nspname = 'billing_private'
         and privilege.privilege_type = 'USAGE'
         and privilege.grantee <> n.nspowner
     )
     or has_schema_privilege('anon', 'billing_private', 'usage')
     or has_schema_privilege('authenticated', 'billing_private', 'usage')
     or has_schema_privilege('service_role', 'billing_private', 'usage') then
    raise exception 'card billing mutator reactivation requires private schema isolation'
      using errcode = 'P0001';
  end if;
end
$preflight$;

revoke all on function public.structure_my_card_purchase_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_my_card_installment_series_with_metadata_v1(uuid, uuid, date, text, numeric, integer, text, text, text, text, text, uuid, text)
  to authenticated;
grant execute on function public.create_my_card_purchase_v1(uuid, uuid, date, text, numeric, text, text, text, text, text, uuid, text)
  to authenticated;
grant execute on function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid)
  to authenticated;
grant execute on function public.reverse_my_card_payment_v1(uuid, uuid, date, text)
  to authenticated;
grant execute on function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text)
  to authenticated;
grant execute on function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text)
  to authenticated;

do $postcondition$
declare
  v_signature text;
  v_dormant_signature text;
  v_authenticated oid := 'authenticated'::regrole::oid;
begin
  foreach v_signature in array array[
    'public.create_my_card_installment_series_with_metadata_v1(uuid,uuid,date,text,numeric,integer,text,text,text,text,text,uuid,text)',
    'public.create_my_card_purchase_v1(uuid,uuid,date,text,numeric,text,text,text,text,text,uuid,text)',
    'public.pay_my_card_invoice_v1(uuid,uuid,numeric,date,uuid)',
    'public.reverse_my_card_payment_v1(uuid,uuid,date,text)',
    'public.credit_my_card_purchase_v1(uuid,numeric,date,uuid,text)',
    'public.reverse_my_card_purchase_credit_v1(uuid,uuid,date,text)'
  ] loop
    if exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_signature)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_signature, 'execute')
       or not has_function_privilege('authenticated', v_signature, 'execute')
       or has_function_privilege('service_role', v_signature, 'execute')
       or (select count(*)
           from pg_proc p
           cross join lateral aclexplode(
             coalesce(p.proacl, acldefault('f', p.proowner))
           ) privilege
           where p.oid = to_regprocedure(v_signature)
             and privilege.grantee = v_authenticated
             and privilege.privilege_type = 'EXECUTE'
             and privilege.is_grantable is false) <> 1
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_signature)
           and privilege.privilege_type = 'EXECUTE'
           and privilege.grantee not in (p.proowner, v_authenticated)
       ) then
      raise exception 'card billing mutator reactivation grant postcondition failed: %',
        v_signature using errcode = 'P0001';
    end if;
  end loop;

  foreach v_dormant_signature in array array[
    'public.structure_my_card_purchase_v1(uuid)',
    'public.create_my_card_installment_series_v1(uuid,uuid,date,text,numeric,integer,text,text,text)'
  ] loop
    if exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_dormant_signature)
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', v_dormant_signature, 'execute')
       or has_function_privilege('authenticated', v_dormant_signature, 'execute')
       or has_function_privilege('service_role', v_dormant_signature, 'execute')
       or exists (
         select 1
         from pg_proc p
         cross join lateral aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) privilege
         where p.oid = to_regprocedure(v_dormant_signature)
           and privilege.privilege_type = 'EXECUTE'
           and privilege.grantee <> p.proowner
       ) then
      raise exception 'unused card billing mutator must remain dormant: %',
        v_dormant_signature using errcode = 'P0001';
    end if;
  end loop;
end
$postcondition$;

commit;
