-- OPERATIONAL ROLLBACK CANDIDATE — DO NOT RUN WITHOUT EXPLICIT AUTHORIZATION.
-- Safe precondition: no production writer may still call the V1 RPCs.
-- This destructive rollback is reserved for an empty/unreleased installation.
-- Once billing data exists, use application-first rollback plus a forward migration.

begin;
set local lock_timeout = '15s';
set local statement_timeout = '5min';
set local search_path = pg_catalog, public;
select pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0));

do $rollback_preflight$
begin
  if to_regnamespace('billing_private') is null
     or to_regclass('billing_private.writer_context_v1') is null
     or to_regclass('public.transactions') is null
     or to_regclass('public.card_installment_series') is null
     or to_regclass('public.card_billing_cycles') is null
     or to_regclass('public.card_invoice_payments') is null
     or to_regclass('public.card_payment_allocations') is null
     or to_regclass('public.card_account_settlements') is null
     or to_regclass('public.card_purchase_credits') is null
     or to_regclass('public.card_invoice_balances_v1') is null
     or to_regclass('public.card_account_settlement_effects_v1') is null
     or to_regclass('public.card_purchase_credit_effects_v1') is null
     or to_regclass('public.card_billing_shadow_comparison_v1') is null
     or to_regclass('public.card_managed_limit_positions_v1') is null
     or to_regprocedure(
       'billing_private.ensure_cycle_by_closing_month_v1(uuid,uuid,integer,integer,date)'
     ) is null then
    raise exception 'card billing rollback requires the complete V1 schema'
      using errcode = 'P0001';
  end if;

  if not exists (
       select 1
       from pg_namespace n
       where n.nspname = 'billing_private'
         and pg_get_userbyid(n.nspowner) = current_user
     ) then
    raise exception 'refusing rollback: billing_private is not owned by the executing role'
      using errcode = '42501';
  end if;

  if exists (
       select 1
       from (values
         ('billing_private', 'writer_context_v1',          'r'::"char"),
         ('public', 'card_installment_series',             'r'::"char"),
         ('public', 'card_billing_cycles',                 'r'::"char"),
         ('public', 'card_invoice_payments',               'r'::"char"),
         ('public', 'card_payment_allocations',            'r'::"char"),
         ('public', 'card_account_settlements',            'r'::"char"),
         ('public', 'card_purchase_credits',               'r'::"char"),
         ('public', 'card_invoice_balances_v1',            'v'::"char"),
         ('public', 'card_account_settlement_effects_v1',  'v'::"char"),
         ('public', 'card_purchase_credit_effects_v1',     'v'::"char"),
         ('public', 'card_billing_shadow_comparison_v1',   'v'::"char"),
         ('public', 'card_managed_limit_positions_v1',     'v'::"char")
       ) expected(schema_name, relation_name, relation_kind)
       left join pg_namespace n on n.nspname = expected.schema_name
       left join pg_class c
         on c.relnamespace = n.oid
        and c.relname = expected.relation_name
       where c.oid is null
          or c.relkind <> expected.relation_kind
          or pg_get_userbyid(c.relowner) <> current_user
     ) then
    raise exception 'refusing rollback: V1 relation type or ownership drift detected'
      using errcode = '42501';
  end if;

  if not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'transactions'
         and column_name = 'card_billing_cycle_id'
         and udt_name = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'transactions'
         and column_name = 'installment_total'
         and udt_name = 'int2'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'transactions'
         and column_name = 'installment_series_id'
         and udt_name = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'transactions'
         and column_name = 'installment_number'
         and udt_name = 'int4'
     ) then
    raise exception 'refusing rollback: transactions billing column contract drift detected'
      using errcode = 'P0001';
  end if;

  if not exists (
       select 1 from pg_constraint
       where conrelid = 'public.transactions'::regclass
         and conname = 'transactions_card_billing_cycle_user_fkey'
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.transactions'::regclass
         and conname = 'transactions_card_installment_shape_v1'
     ) then
    raise exception 'refusing rollback: transactions billing constraint drift detected'
      using errcode = 'P0001';
  end if;
end
$rollback_preflight$;

-- The explicit locks make the empty-installation decision stable until commit.
lock table public.accounts,
           public.cards,
           public.transactions,
           billing_private.writer_context_v1,
           public.card_installment_series,
           public.card_billing_cycles,
           public.card_invoice_payments,
           public.card_payment_allocations,
           public.card_account_settlements,
           public.card_purchase_credits
  in access exclusive mode;

do $rollback_guard$
begin
  if exists (select 1 from billing_private.writer_context_v1)
     or exists (select 1 from public.card_billing_cycles)
     or exists (select 1 from public.card_invoice_payments)
     or exists (select 1 from public.card_payment_allocations)
     or exists (select 1 from public.card_account_settlements)
     or exists (select 1 from public.card_purchase_credits)
     or exists (
       select 1
       from public.transactions t
       join public.card_installment_series s
         on s.id = t.installment_series_id
        and s.user_id = t.user_id
     )
     or exists (select 1 from public.card_installment_series)
     or exists (
       select 1 from public.transactions
       where card_billing_cycle_id is not null
          or installment_total is not null
     ) then
    raise exception 'refusing destructive rollback: billing data or structured links exist; use application-first rollback'
      using errcode = 'P0001';
  end if;
end
$rollback_guard$;

-- Public API first: no session can retain a callable entry point while objects
-- are dismantled. Signatures are exact so drift fails and rolls back atomically.
drop function public.get_my_card_billing_summary_v1(uuid);
drop function public.reverse_my_card_purchase_credit_v1(uuid, uuid, date, text);
drop function public.credit_my_card_purchase_v1(uuid, numeric, date, uuid, text);
drop function public.reverse_my_card_payment_v1(uuid, uuid, date, text);
drop function public.pay_my_card_invoice_v1(uuid, uuid, numeric, date, uuid);
drop function public.create_my_card_installment_series_v1(uuid, uuid, date, text, numeric, integer, text, text, text);
drop function public.structure_my_card_purchase_v1(uuid);

drop view public.card_managed_limit_positions_v1;
drop view public.card_billing_shadow_comparison_v1;
drop view public.card_purchase_credit_effects_v1;
drop view public.card_account_settlement_effects_v1;
drop view public.card_invoice_balances_v1;

drop trigger transactions_installment_series_complete_v1 on public.transactions;
drop trigger card_installment_series_complete_v1 on public.card_installment_series;
drop trigger card_purchase_credits_append_only_v1 on public.card_purchase_credits;
drop trigger card_account_settlements_append_only_v1 on public.card_account_settlements;
drop trigger card_payment_allocations_append_only_v1 on public.card_payment_allocations;
drop trigger card_invoice_payments_append_only_v1 on public.card_invoice_payments;
drop trigger card_purchase_credits_guard_insert_v1 on public.card_purchase_credits;
drop trigger card_invoice_payments_complete_v1 on public.card_invoice_payments;
drop trigger card_account_settlements_guard_insert_v1 on public.card_account_settlements;
drop trigger card_payment_allocations_guard_insert_v1 on public.card_payment_allocations;
drop trigger card_invoice_payments_guard_insert_v1 on public.card_invoice_payments;
drop trigger transactions_guard_linked_card_delete_v1 on public.transactions;
drop trigger transactions_guard_card_cycle_v1 on public.transactions;
drop trigger card_installment_series_immutable_v1 on public.card_installment_series;
drop trigger card_billing_cycles_immutable_v1 on public.card_billing_cycles;
drop trigger card_billing_cycles_calendar_guard_v1 on public.card_billing_cycles;

drop function billing_private.ensure_cycle_for_purchase_v1(uuid, uuid, date);
drop function billing_private.ensure_cycle_by_closing_month_v1(uuid, uuid, integer, integer, date);
drop function billing_private.assert_installment_series_complete_v1();
drop function billing_private.reject_ledger_mutation_v1();
drop function billing_private.guard_purchase_credit_insert_v1();
drop function billing_private.assert_payment_complete_v1();
drop function billing_private.guard_account_settlement_insert_v1();
drop function billing_private.guard_payment_allocation_insert_v1();
drop function billing_private.guard_payment_insert_v1();
drop function billing_private.guard_linked_transaction_delete_v1();
drop function billing_private.guard_transaction_cycle_v1();
drop function billing_private.reject_cycle_update_v1();
drop function billing_private.guard_cycle_insert_v1();
drop function billing_private.card_cycle_dates_v1(date, integer, integer);
drop function billing_private.clamped_month_day_v1(date, integer);

drop index public.transactions_user_cycle_date_card_idx;

alter table public.transactions
  drop constraint transactions_card_installment_shape_v1;
alter table public.transactions
  drop constraint transactions_card_billing_cycle_user_fkey;

-- installment_series_id and installment_number are V82 columns and remain.
alter table public.transactions
  drop column installment_total;
alter table public.transactions
  drop column card_billing_cycle_id;

drop table public.card_account_settlements;
drop table public.card_payment_allocations;
drop table public.card_purchase_credits;
drop table public.card_invoice_payments;
drop table public.card_billing_cycles;
drop table public.card_installment_series;
drop table billing_private.writer_context_v1;

drop schema billing_private;

commit;
