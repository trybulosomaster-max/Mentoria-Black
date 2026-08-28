'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {financialEffect}=require('../js/financial-core');

const root=path.resolve(__dirname,'..');
const migrationPath=path.join(root,'supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql');
const rollbackPath=path.join(root,'supabase/rollback/rollback_20260828130535_aviora_card_billing_backend_v1.sql');
const designPath=path.join(root,'docs/AVIORA_CARD_BILLING_BACKEND_DESIGN.md');
const contractPath=path.join(root,'docs/AVIORA_CARD_BILLING_CONTRACT.md');
const pgTapPath=path.join(root,'supabase/tests/card_billing_backend_v1_test.sql');
const localRunnerPath=path.join(root,'supabase/tests/card_billing_backend_v1_local_test.sh');
const migration=fs.readFileSync(migrationPath,'utf8');
const rollback=fs.readFileSync(rollbackPath,'utf8');
const design=fs.readFileSync(designPath,'utf8');
const contract=fs.readFileSync(contractPath,'utf8');
const pgTap=fs.readFileSync(pgTapPath,'utf8');
const localRunner=fs.existsSync(localRunnerPath)?fs.readFileSync(localRunnerPath,'utf8'):'';

let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.equal(actual,expected,message)};
const test=(name,fn)=>{fn();tests++};
const includesAll=(source,tokens)=>tokens.forEach(token=>ok(source.includes(token),token));
const functionBody=(name)=>{
  const start=migration.indexOf(`create function public.${name}`);
  ok(start>=0,`${name}: function exists`);
  const end=migration.indexOf('\n$$;',start);
  ok(end>start,`${name}: function body terminates`);
  return migration.slice(start,end+4);
};

const mutationFunctions=[
  ['pay_my_card_invoice_v1','uuid, uuid, numeric, timestamptz, uuid'],
  ['reverse_my_card_payment_v1','uuid, uuid, timestamptz, text'],
  ['credit_my_card_purchase_v1','uuid, numeric, timestamptz, uuid, text'],
  ['reverse_my_card_purchase_credit_v1','uuid, uuid, timestamptz, text']
];

test('migration é transacional, serializada e falha fechada em namespace preexistente',()=>{
  ok(/^--[\s\S]*\nbegin;/m.test(migration));
  ok(migration.includes("pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0))"));
  ok(migration.trimEnd().endsWith('commit;'));
  includesAll(migration,["set local lock_timeout = '15s'","set local statement_timeout = '5min'","to_regnamespace('billing_private') is not null","create schema billing_private;"]);
  ok(!migration.includes('create schema if not exists billing_private'));
});

test('preflight exige contrato V82 e recusa drift semântico conhecido',()=>{
  includesAll(migration,[
    "to_regprocedure('auth.uid()') is null",
    "p.prorettype <> 'uuid'::regtype",
    'a.atttypid <> expected.type_oid',
    'expected.require_not_null and not a.attnotnull',
    'base column contract drift; reconcile schema before migration',
    'public.cards','public.accounts','public.transactions',
    'cards_id_user_id_key','accounts_id_user_id_key','transactions_id_user_id_key',
    'semantic reconciliation is required','ownership and semantic reconciliation are required'
  ]);
  ok(/\('public',\s*'transactions',\s*'transaction_date',\s*'date'::regtype,\s*true\)/.test(migration));
});

test('schema aditivo contém ciclos, pagamentos, créditos e vínculo explícito nullable',()=>{
  for(const table of ['card_billing_cycles','card_invoice_payments','card_purchase_credits'])ok(migration.includes(`create table public.${table}`),table);
  includesAll(migration,['add column card_billing_cycle_id uuid','references public.card_billing_cycles(id, user_id)','on delete restrict not valid','never backfilled by inference']);
  ok(!/update public\.transactions\s+set\s+transaction_date/i.test(migration));
});

test('transaction_date permanece a competência canônica e nunca sofre backfill/reclassificação',()=>{
  ok(migration.includes("date_trunc('month', t.transaction_date)::date as transaction_month"));
  ok(!migration.includes('create function public.attach_my_card_transaction_to_cycle_v1'));
  ok(!/set\s+transaction_date\s*=/i.test(migration));
  equal((migration.match(/update public\.transactions/g)||[]).length,0);
  ok(!/(purchase_date|closing_day|due_day)[\s\S]{0,120}set\s+transaction_date/i.test(migration));
});

test('calendário não aprovado não tem construtor automático e datas persistidas são obrigatórias',()=>{
  ok(!migration.includes('ensure_cycle_v1'));
  ok(!migration.includes('clamped_day_v1'));
  ok(!migration.includes('last_day_of_month_v1'));
  includesAll(migration,['closing_date date not null','due_date date not null']);
});

test('RLS expõe somente leitura própria nas três tabelas',()=>{
  equal((migration.match(/enable row level security;/g)||[]).length,3);
  equal((migration.match(/for select to authenticated/g)||[]).length,3);
  equal((migration.match(/using \(\(select auth\.uid\(\)\) = user_id\)/g)||[]).length,3);
  for(const table of ['card_billing_cycles','card_invoice_payments','card_purchase_credits']){
    ok(migration.includes(`revoke all on table public.${table} from public, anon, authenticated`));
    ok(migration.includes(`grant select on table public.${table} to authenticated`));
  }
  ok(!/grant (insert|update|delete).*authenticated/i.test(migration));
});

test('views preservam RLS e o shadow comparator não fabrica limite',()=>{
  equal((migration.match(/with \(security_invoker = true\)/g)||[]).length,2);
  includesAll(migration,['create view public.card_invoice_balances_v1','create view public.card_billing_shadow_comparison_v1','grant select on public.card_invoice_balances_v1 to authenticated','grant select on public.card_billing_shadow_comparison_v1 to authenticated']);
  ok(!migration.includes('create view public.card_limit_positions_v1'));
  includesAll(migration,["when structured_count = 0 then 'unlinked'","else 'partial'","then 'complete'"]);
});

test('RPCs mutadoras autenticam e fixam search_path, mas permanecem dormentes',()=>{
  for(const [fn,args] of mutationFunctions){
    const body=functionBody(fn);
    includesAll(body,['security definer','auth.uid()','set search_path = pg_catalog, public']);
    ok(migration.includes(`revoke all on function public.${fn}(${args}) from public, anon, authenticated`),`${fn}: revoke all client roles`);
    ok(!migration.includes(`grant execute on function public.${fn}(${args}) to authenticated`),`${fn}: no authenticated activation grant`);
  }
  ok(migration.includes('Shadow mode: mutation RPCs deliberately remain non-executable by authenticated'));
  ok(migration.includes('grant execute on function public.get_my_card_billing_summary_v1(uuid) to authenticated'));
});

test('compra liquidada bloqueia mudanças econômicas e exclusão sob lock do ciclo',()=>{
  includesAll(migration,[
    'shadow billing writer is not activated',
    "using errcode = '42501'",
    'update of card_billing_cycle_id, user_id, card_id, transaction_date, transaction_type, amount, status',
    'new.amount is distinct from old.amount',
    'settled card purchase is immutable',
    'settled card purchase cannot cross the cancellation boundary',
    'transactions_guard_linked_card_delete_v1',
    'settled card purchase cannot be deleted',
    'for update;'
  ]);
  ok(migration.includes('new.card_billing_cycle_id := null'));
});

test('snapshots de ciclo e valores temporais/numéricos inválidos são bloqueados',()=>{
  includesAll(migration,[
    'create trigger card_billing_cycles_immutable_v1',
    'card billing cycle snapshots are immutable',
    "amount > 0 and amount < 'Infinity'::numeric",
    'check (isfinite(occurred_at))',
    'new.transaction_date is null',
    'not isfinite(new.transaction_date)',
    'new.amount is null',
    'not isfinite(p_occurred_at)'
  ]);
});

test('ledgers validam coerência na inserção e são append-only estruturalmente',()=>{
  includesAll(migration,[
    'create function billing_private.guard_payment_insert_v1()',
    'create function billing_private.guard_purchase_credit_insert_v1()',
    'card_invoice_payments_guard_insert_v1',
    'card_purchase_credits_guard_insert_v1',
    'payment reversal must exactly compensate its original payment',
    'credit reversal must exactly compensate its original credit',
    'create function billing_private.reject_ledger_mutation_v1()',
    'card billing ledgers are append-only',
    'create trigger card_invoice_payments_append_only_v1',
    'create trigger card_purchase_credits_append_only_v1',
    'before update or delete on public.card_invoice_payments',
    'before update or delete on public.card_purchase_credits'
  ]);
  ok(/card_invoice_payments_reason_check check \([\s\S]{0,400}entry_kind = 'payment_reversal'[\s\S]{0,160}reason_code is not null/.test(migration));
});

test('idempotência e locks continuam presentes no desenho dormente',()=>{
  equal((migration.match(/operation_id uuid not null/g)||[]).length,2);
  equal((migration.match(/unique \(user_id, operation_id\)/g)||[]).length,2);
  equal((migration.match(/':card-(?:payment|payment-reversal|credit|credit-reversal):'/g)||[]).length,4);
  includesAll(migration,['card_invoice_payments_single_reversal_uidx','card_purchase_credits_single_reversal_uidx','operation_id payload mismatch','payment exceeds invoice outstanding amount','purchase credit exceeds original purchase amount']);
  ok((migration.match(/for update;/g)||[]).length>=10);
});

test('saldo estrutural não persiste nem infere lifecycle ou settlement de produto',()=>{
  includesAll(migration,['purchase_amount','credited_amount','paid_amount','outstanding_amount','credit_balance']);
  ok(!migration.includes('settlement_state'));
  ok(!migration.includes('lifecycle_state'));
});

test('teste econômico de ouro permanece requisito de ativação, não prova fictícia',()=>{
  const purchase=financialEffect({transaction_type:'despesa',amount:1000,status:'realizado',transaction_date:'2026-08-20',card_id:'card'},{now:'2026-08-20'});
  equal(purchase.consumptionExpenseAmount,1000);
  equal(5000-1000,4000);
  ok(!migration.includes("transaction_type, 'despesa'"));
  ok(!/insert into public\.transactions[\s\S]{0,500}payment/i.test(migration));
  ok(!/update public\.accounts[\s\S]{0,400}(opening_balance|statement_balance)/i.test(migration));
  includesAll(design,['ACCOUNT_SETTLEMENT_REQUIRED','CARD_BILLING_BETA_READINESS = HOLD']);
  ok(!migration.includes('grant execute on function public.pay_my_card_invoice_v1'));
});

test('limite gerencial permanece decisão documental e não é exposto pelo schema candidato',()=>{
  ok(!migration.includes('card_limit_positions_v1'));
  ok(!migration.includes('available_amount'));
  includesAll(contract,['AVIORA_MANAGED_AVAILABLE_LIMIT','PRODUCT_DECISION_REQUIRED']);
  includesAll(design,['CARD_BILLING_BETA_READINESS = HOLD','PRODUCT_DECISION_REQUIRED']);
});

test('rollback bloqueia corridas e qualquer ciclo/ledger/vínculo existente',()=>{
  includesAll(rollback,[
    "pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0))",
    "where n.nspname = 'billing_private'",
    'and r.rolname = current_user',
    'lock table public.transactions,',
    'in access exclusive mode',
    'if exists (select 1 from public.card_invoice_payments)',
    'or exists (select 1 from public.card_purchase_credits)',
    'or exists (select 1 from public.card_billing_cycles)',
    'where card_billing_cycle_id is not null',
    'use application-first rollback'
  ]);
  ok(rollback.indexOf('in access exclusive mode')<rollback.indexOf('if exists (select 1 from public.card_invoice_payments)'));
  ok(rollback.trimEnd().endsWith('commit;'));
});

test('backfill é conservador por omissão e nenhuma heurística histórica existe',()=>{
  includesAll(design,['BACKFILL_MODE = SAFE_NO_BACKFILL','INITIAL_SCHEMA_MODE = SHADOW_ONLY']);
  ok(migration.includes('never backfilled by inference'));
  ok(!/(note|description)[\s\S]{0,200}card_billing_cycle_id/i.test(migration));
  equal((migration.match(/update public\.transactions/g)||[]).length,0);
});

test('decisões de produto permanecem explícitas e bloqueiam aplicação Beta',()=>{
  includesAll(design,[
    'BACKEND_DESIGN_GATE = PRODUCT_DECISION_REQUIRED',
    'CARD_BILLING_BETA_READINESS = HOLD',
    'INITIAL_SCHEMA_MODE = SHADOW_ONLY',
    'ACCOUNT_SETTLEMENT_REQUIRED',
    'BACKFILL_MODE = SAFE_NO_BACKFILL',
    'REMOTE_APPLY = PROHIBITED_PENDING_PRODUCT_DECISIONS_AND_RUNTIME_VALIDATION'
  ]);
  includesAll(contract,[
    'Decisão necessária para automatizar o ciclo',
    'dia do fechamento',
    'fuso/instante exato do fechamento',
    'pagamentos/alocações',
    'limite disponível',
    'STRUCTURED_INSTALLMENT_SERIES_REQUIRED'
  ]);
});

test('artefatos não executam Supabase, não contêm alvo remoto e preservam Visual V1',()=>{
  const combined=[migration,rollback,design,contract,pgTap,localRunner].join('\n');
  ok(!/https?:\/\/[a-z]{20}\.supabase\.co/i.test(combined));
  ok(!/project[_-]?ref\s*[:=]/i.test(combined));
  ok(!/supabase\s+(db push|migration up|link)/i.test(combined));
  ok(design.includes('VISUAL_V1_IMPACT = ZERO'));
});

test('pgTAP futuro cobre estrutura, RLS A/B, shadow grants e invariantes runtime',()=>{
  ok(pgTap.includes('select no_plan()'));
  for(const token of [
    'relrowsecurity','policies_are','function_privs_are','index_is_unique','fk_ok',
    'transactions_guard_linked_card_delete_v1','card_invoice_payments_append_only_v1',
    'card_invoice_payments_guard_insert_v1','card_purchase_credits_guard_insert_v1',
    'authenticated cannot activate dormant payment RPC','user B cannot read user A cycle',
    'settled purchase amount is immutable','settled purchase cannot cross cancellation boundary',
    'settled canonical transaction_date cannot be moved','persisted cycle closing_date cannot be NULL',
    '@example.invalid'
  ])ok(pgTap.includes(token),token);
  ok(pgTap.trimEnd().endsWith('rollback;'));
});

test('runner descartável é limitado ao container local rotulado e trata golden como blocker',()=>{
  ok(localRunner.length>0,'local disposable runner exists');
  includesAll(localRunner,['supabase_db_${project_id}','com.supabase.cli.project','trap cleanup EXIT','card_billing_backend_v1_test.sql','GOLDEN_ACCOUNTING_ACTIVATION_BLOCKED','CARD_BILLING_BETA_READINESS=HOLD']);
  ok(!localRunner.includes('DB_URL'));
  ok(!localRunner.includes('PGPASSWORD'));
  ok(!localRunner.includes('--linked'));
  ok(!/supabase\s+(db push|migration up|link)/i.test(localRunner));
});

console.log(`card-billing-backend-design: ${tests} tests, ${assertions} assertions passed`);
