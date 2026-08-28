'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const migration=read('supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql');
const rollback=read('supabase/rollback/rollback_20260828130535_aviora_card_billing_backend_v1.sql');
const design=read('docs/AVIORA_CARD_BILLING_BACKEND_DESIGN.md');
const contract=read('docs/AVIORA_CARD_BILLING_CONTRACT.md');
const pgTap=read('supabase/tests/card_billing_backend_v1_test.sql');
const runner=read('supabase/tests/card_billing_backend_v1_local_test.sh');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.equal(actual,expected,message)};
const test=(name,fn)=>{fn();tests++};
const includesAll=(source,tokens)=>tokens.forEach(token=>ok(source.includes(token),token));
const functionBody=name=>{
  const start=migration.indexOf(`create function public.${name}`);
  ok(start>=0,`${name}: function exists`);
  const end=migration.indexOf('\n$$;',start);
  ok(end>start,`${name}: function body terminates`);
  return migration.slice(start,end+4);
};

const mutators=[
  ['structure_my_card_purchase_v1','uuid'],
  ['create_my_card_installment_series_v1','uuid, uuid, date, text, numeric, integer, text, text, text'],
  ['pay_my_card_invoice_v1','uuid, uuid, numeric, date, uuid'],
  ['reverse_my_card_payment_v1','uuid, uuid, date, text'],
  ['credit_my_card_purchase_v1','uuid, numeric, date, uuid, text'],
  ['reverse_my_card_purchase_credit_v1','uuid, uuid, date, text']
];

test('migration permanece transacional, serializada e fail-closed',()=>{
  ok(/^--[\s\S]*\nbegin;/m.test(migration));
  includesAll(migration,[
    "pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0))",
    "set local lock_timeout = '15s'", "set local statement_timeout = '5min'",
    "to_regnamespace('billing_private') is not null",'semantic reconciliation is required',
    'base column contract drift; reconcile schema before migration'
  ]);
  ok(!migration.includes('create schema if not exists billing_private'));
  ok(migration.trimEnd().endsWith('commit;'));
});

test('preflight exige baseline V82 e não reescreve competência legada',()=>{
  includesAll(migration,[
    "to_regprocedure('auth.uid()') is null",
    "('public', 'transactions',  'transaction_date', 'date'::regtype",
    "('public', 'transactions',  'purchase_date',    'date'::regtype",
    "('public', 'transactions',  'installment_series_id', 'uuid'::regtype",
    'cards_id_user_id_key','accounts_id_user_id_key','transactions_id_user_id_key'
  ]);
  ok(!/set\s+transaction_date\s*=/i.test(migration));
});

test('schema normalizado contém série, ciclo, pagamento, alocação, settlement e crédito',()=>{
  for(const table of ['card_installment_series','card_billing_cycles','card_invoice_payments','card_payment_allocations','card_account_settlements','card_purchase_credits']){
    ok(migration.includes(`create table public.${table}`),table);
  }
  includesAll(migration,[
    'add column card_billing_cycle_id uuid','add column installment_total smallint',
    'transactions_card_installment_shape_v1','card_payment_allocations_payment_key',
    'card_account_settlements_payment_key','never backfilled by inference'
  ]);
});

test('calendário aprovado é civil, inclui fechamento e clampa dias inexistentes',()=>{
  const body=migration.slice(migration.indexOf('create function billing_private.card_cycle_dates_v1'),migration.indexOf('create function billing_private.guard_cycle_insert_v1'));
  includesAll(body,[
    'p_purchase_date date','p_closing_day integer','p_due_day integer',
    'billing_private.clamped_month_day_v1','if p_purchase_date > v_closing_date then',
    "interval '1 month'",'v_previous_closing + 1'
  ]);
  ok(!/p_purchase_date\s*>=\s*v_closing_date/.test(body));
  ok(!/(timezone|at time zone|timestamptz)/i.test(body));
});

test('ciclo congela snapshots e datas efetivas',()=>{
  includesAll(migration,[
    'closing_day_snapshot smallint not null','due_day_snapshot smallint not null',
    'cycle_start_date date not null','closing_date date not null','due_date date not null',
    'card_billing_cycles_calendar_guard_v1','card billing cycle snapshots are immutable',
    "cycle_key = date_trunc('month', due_date)::date"
  ]);
});

test('parcelas novas são estruturadas, completas, cent-exact e retidas',()=>{
  const body=functionBody('create_my_card_installment_series_v1');
  includesAll(body,[
    'p_installment_total integer','installment_series_id, installment_number, installment_total',
    'v_total_cents','v_base_cents','v_remainder','for v_number in 1..p_installment_total loop',
    'operation_id payload mismatch','for key share','v_first_cycle := billing_private.ensure_cycle_for_purchase_v1',
    "date_trunc('month', v_first_cycle.closing_date)",'billing_private.ensure_cycle_by_closing_month_v1'
  ]);
  includesAll(migration,[
    'structured installment series must contain the complete cent-exact sequence',
    'structured installment transaction cannot be deleted','card_installment_series_immutable_v1',
    'Preserve that writer contract without inferring a V1 structured series'
  ]);
  ok(!body.includes('p_purchase_date + make_interval'),'installments advance from the frozen first closing month');
  ok(!/(note|description)[\s\S]{0,160}(infer|regexp|similar)/i.test(migration));
});

test('novos valores monetários usam numeric(14,2) e guards fechados',()=>{
  ok((migration.match(/numeric\(14,2\)/g)||[]).length>=4);
  includesAll(migration,[
    'original_amount <= 999999999999.99','amount <= 999999999999.99',
    'amount = round(amount, 2)','original_amount = round(original_amount, 2)',
    "amount < 'Infinity'::numeric","original_amount < 'Infinity'::numeric"
  ]);
});

test('pagamento V1 é mono-ciclo, parcial/integral, atômico e sem overpayment',()=>{
  const body=functionBody('pay_my_card_invoice_v1');
  includesAll(body,[
    'p_billing_cycle_id uuid','p_source_account_id uuid','p_effective_date date',
    "':card-payment:'",'for update','source account not found',
    'payment exceeds invoice outstanding amount','CREDIT_BALANCE_REVIEW_REQUIRED',
    'insert into public.card_invoice_payments','insert into public.card_payment_allocations',
    'insert into public.card_account_settlements','operation_id payload mismatch'
  ]);
  ok(!/p_(allocations|cycles)\b/.test(body));
});

test('settlement é explícito, auditável e neutro para despesa',()=>{
  includesAll(migration,[
    'create view public.card_account_settlement_effects_v1',
    "case when p.entry_kind = 'payment' then -p.amount else p.amount end::numeric as account_delta",
    '0::numeric as consumption_expense_delta',
    'card payment must commit with exactly one allocation and one account settlement'
  ]);
  ok(!/insert into public\.transactions[\s\S]{0,500}(payment|settlement)/i.test(functionBody('pay_my_card_invoice_v1')));
});

test('crédito e estorno são append-only, não retroativos e retry-safe',()=>{
  const credit=functionBody('credit_my_card_purchase_v1');
  const reversal=functionBody('reverse_my_card_purchase_credit_v1');
  includesAll(credit,['p_effective_date date',"':card-credit:'",'purchase credit exceeds original purchase amount','operation_id payload mismatch','for update']);
  includesAll(reversal,['p_effective_date date',"':card-credit-reversal:'",'credit_reversal','reversal_of_id','operation_id payload mismatch']);
  includesAll(migration,[
    'new.effective_date < v_transaction.transaction_date','new.effective_date < v_original.effective_date',
    'card_purchase_credits_single_reversal_uidx','card billing ledgers are append-only'
  ]);
});

test('crédito reduz saldo antes do pagamento e carry-forward fica bloqueado',()=>{
  includesAll(migration,[
    'greatest(coalesce(pu.purchase_amount, 0) - coalesce(cr.credited_amount, 0) - coalesce(pa.paid_amount, 0), 0)',
    'credit_balance_review_required',"then 'CREDIT_BALANCE_REVIEW_REQUIRED'",
    "then 'partially_paid'","else 'open'"
  ]);
});

test('limite é gerencial e exige cobertura estrutural comprovada',()=>{
  includesAll(migration,[
    'create view public.card_managed_limit_positions_v1',"'AVIORA_MANAGED_AVAILABLE_LIMIT'::text as metric_contract",
    'managed_used_limit','managed_available_limit','structured_purchase_count = c.relevant_purchase_count',
    "then 'CREDIT_BALANCE_REVIEW_REQUIRED'","then 'unlinked'","then 'partial'","then 'exceeded'",
    'não representa autorizações, juros, tarifas ou compras ausentes no AVIORA'
  ]);
});

test('RLS é leitura própria e mutadores permanecem dormentes',()=>{
  equal((migration.match(/enable row level security;/g)||[]).length,6);
  equal((migration.match(/for select to authenticated/g)||[]).length,6);
  equal((migration.match(/using \(\(select auth\.uid\(\)\) = user_id\)/g)||[]).length,6);
  for(const table of ['card_installment_series','card_billing_cycles','card_invoice_payments','card_payment_allocations','card_account_settlements','card_purchase_credits']){
    ok(migration.includes(`revoke all on table public.${table} from public, anon, authenticated`));
    ok(migration.includes(`grant select on table public.${table} to authenticated`));
  }
  for(const [name,args] of mutators){
    const body=functionBody(name);
    includesAll(body,['security definer','auth.uid()','set search_path = pg_catalog']);
    ok(migration.includes(`revoke all on function public.${name}(${args}) from public, anon, authenticated`));
    ok(!migration.includes(`grant execute on function public.${name}(${args}) to authenticated`));
  }
});

test('capability privada bloqueia vínculo estruturado por DML legado direto',()=>{
  includesAll(migration,[
    'create table billing_private.writer_context_v1',
    'context.transaction_id = txid_current()',
    "context.purpose in ('structure_purchase', 'create_installments')",
    'structured card billing writer is not activated for direct transaction DML',
    "values (txid_current(), v_user, 'structure_purchase')",
    "values (txid_current(), v_user, 'create_installments')"
  ]);
  ok(!migration.includes('grant select on billing_private.writer_context_v1'));
});

test('views usam security_invoker e menor privilégio',()=>{
  ok((migration.match(/with \(security_invoker = true\)/g)||[]).length>=5);
  for(const view of ['card_invoice_balances_v1','card_account_settlement_effects_v1','card_purchase_credit_effects_v1','card_billing_shadow_comparison_v1','card_managed_limit_positions_v1']){
    ok(migration.includes(`grant select on public.${view} to authenticated`),view);
    ok(migration.includes(`revoke all on public.${view} from public, anon`),view);
  }
});

test('concorrência e idempotência possuem locks e unicidade',()=>{
  includesAll(migration,[
    'card_installment_series_operation_key unique (user_id, operation_id)',
    'card_invoice_payments_operation_key unique (user_id, operation_id)',
    'card_purchase_credits_operation_key unique (user_id, operation_id)',
    'card_payment_allocations_payment_key unique (user_id, payment_entry_id)',
    'card_account_settlements_payment_key unique (user_id, payment_entry_id)',
    'card_invoice_payments_single_reversal_uidx','card_purchase_credits_single_reversal_uidx'
  ]);
  ok((migration.match(/pg_advisory_xact_lock/g)||[]).length>=6);
  ok((migration.match(/for update/g)||[]).length>=10);
});

test('backfill permanece conservador e transaction_date soberana',()=>{
  includesAll(migration,['never backfilled by inference','transaction_date does not match the approved billing calendar; history was not changed']);
  includesAll(design,['SAFE_NO_BACKFILL','transaction_date']);
  ok(!/update public\.transactions\s+set\s+card_billing_cycle_id[\s\S]{0,300}(note|description)/i.test(migration));
});

test('rollback cobre tudo e falha fechado após uso',()=>{
  includesAll(rollback,[
    "pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0))",
    'lock table public.accounts','public.transactions','in access exclusive mode','public.card_installment_series',
    'public.card_billing_cycles','public.card_invoice_payments','public.card_payment_allocations',
    'public.card_account_settlements','public.card_purchase_credits','refusing destructive rollback',
    'use application-first rollback','drop column installment_total','drop column card_billing_cycle_id'
  ]);
  ok(rollback.trimEnd().endsWith('commit;'));
});

test('shadow mode continua dormente',()=>{
  includesAll(migration,['create view public.card_billing_shadow_comparison_v1','mutation RPCs deliberately remain non-executable by authenticated','grant execute on function public.get_my_card_billing_summary_v1(uuid) to authenticated']);
  includesAll(design,['CARD_BILLING_BETA_ACTIVATION = APPLIED_VALIDATED','FRONTEND_ACTIVATION = LOCAL_CANDIDATE_NOT_PUBLISHED','Visual V1 permanece']);
});

test('documentação fecha V1 e isola dívidas V2',()=>{
  const combined=design+'\n'+contract;
  includesAll(combined,['transaction_date','SAFE_NO_BACKFILL','CREDIT_BALANCE_REVIEW_REQUIRED','AVIORA_MANAGED_AVAILABLE_LIMIT','numeric(14,2)','mono-ciclo','append-only','shadow','rollback']);
  includesAll(combined,['CARD_BILLING_BETA_ACTIVATION = APPLIED_VALIDATED','CARD_BILLING_MUTATOR_UI_BETA_VALIDATED']);
  for(const stale of [
    'CARD_BILLING_ACTIVATION_CANDIDATE_PENDING_VALIDATION',
    'A validação real de concorrência ainda pertence ao gate Beta.',
    'Esses grants existem apenas no SQL local.',
    'ainda não existem em Beta'
  ])ok(!combined.includes(stale),`stale activation claim removed: ${stale}`);
});

test('harness usa V81 + V82, ativa mutadores só no clone e prova golden',()=>{
  includesAll(runner,[
    '20260820161844_local_v81_structural_baseline.sql','20260820161846_add_v82_structured_financial_operations.sql',
    'grant execute on function public.pay_my_card_invoice_v1','CARD_BILLING_BACKEND_READY_FOR_BETA_APPROVAL',
    'GOLDEN_ACCOUNTING_TEST=PASS','card_account_settlement_effects_v1','run_payment','concurrent'
  ]);
  ok(!runner.includes('DB_URL'));ok(!runner.includes('PGPASSWORD'));ok(!runner.includes('--linked'));
  ok(!/supabase\s+(db push|migration up|link)/i.test(runner));
});

test('pgTAP cobre superfície, RLS, calendário, ledger e golden',()=>{
  for(const token of [
    'select no_plan()','relrowsecurity','policies_are','function_privs_are','card_installment_series',
    'card_payment_allocations','card_account_settlements','user B cannot read user A cycle',
    'closing day remains in current cycle','leap-year February clamps day 31 to 29',
    'editing card dates does not rewrite cycle snapshots','payment creates exactly one allocation',
    'settlement consumption delta is zero','managed limit is explicitly AVIORA-managed','@example.invalid'
  ])ok(pgTap.includes(token),token);
  ok(pgTap.trimEnd().endsWith('rollback;'));
});

test('artefatos não contêm alvo, segredo ou comando remoto',()=>{
  const combined=[migration,rollback,design,contract,pgTap,runner].join('\n');
  ok(!/https?:\/\/[a-z]{20}\.supabase\.co/i.test(combined));
  ok(!/project[_-]?ref\s*[:=]/i.test(combined));
  ok(!/service[_-]?role\s*[:=]/i.test(combined));
  ok(!/supabase\s+(db push|migration up|link|functions deploy)/i.test(combined));
});

console.log(`card-billing-backend-design: ${tests} tests, ${assertions} assertions passed`);
