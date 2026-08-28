'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {financialEffect}=require('../js/financial-core');

const root=path.resolve(__dirname,'..');
const migrationPath=path.join(root,'supabase/migrations/20260828130535_aviora_card_billing_backend_v1.sql');
const rollbackPath=path.join(root,'supabase/rollback/rollback_20260828130535_aviora_card_billing_backend_v1.sql');
const designPath=path.join(root,'docs/AVIORA_CARD_BILLING_BACKEND_DESIGN.md');
const pgTapPath=path.join(root,'supabase/tests/card_billing_backend_v1_test.sql');
const migration=fs.readFileSync(migrationPath,'utf8');
const rollback=fs.readFileSync(rollbackPath,'utf8');
const design=fs.readFileSync(designPath,'utf8');
const pgTap=fs.readFileSync(pgTapPath,'utf8');

let tests=0,assertions=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message)};
const equal=(actual,expected,message)=>{assertions++;assert.equal(actual,expected,message)};
const test=(name,fn)=>{fn();tests++};

const invoice=({purchase=0,credit=0,payment=0,closing='2026-08-22',due='2026-09-30',today='2026-08-20',closed=false})=>{
  const outstanding=Math.max(purchase-credit-payment,0);
  const creditBalance=Math.max(credit+payment-purchase,0);
  const settlement=purchase===0?'empty':purchase<=credit+payment?'paid':payment>0?'partially_paid':'unpaid';
  const lifecycle=today<=closing&&!closed?'open':today<due?'closed':today===due?'due':outstanding>0?'overdue':'closed';
  return {outstanding,creditBalance,settlement,lifecycle};
};

test('migration é transacional e serializa a instalação',()=>{
  ok(/^--[\s\S]*\nbegin;/m.test(migration));
  ok(migration.includes("pg_advisory_xact_lock(hashtextextended('aviora:card-billing-backend-v1', 0))"));
  ok(migration.trimEnd().endsWith('commit;'));
  ok(migration.includes("set local lock_timeout = '15s'"));
});

test('preflight exige V82 e recusa colisão semântica',()=>{
  for(const token of ['public.cards','public.accounts','public.transactions','cards_id_user_id_key','accounts_id_user_id_key','transactions_id_user_id_key'])ok(migration.includes(token),token);
  ok(migration.includes('semantic reconciliation is required'));
});

test('schema mínimo contém ciclos, pagamentos, créditos e vínculo explícito',()=>{
  for(const table of ['card_billing_cycles','card_invoice_payments','card_purchase_credits'])ok(migration.includes(`create table public.${table}`),table);
  ok(migration.includes('add column card_billing_cycle_id uuid'));
  ok(migration.includes('references public.card_billing_cycles(id, user_id)'));
  equal((migration.match(/update public\.transactions/g)||[]).length,1);
  ok(migration.includes('where id = v_tx.id and user_id = v_user'));
  ok(migration.includes('never backfilled by inference'));
});

test('RLS expõe somente leitura própria e RPCs controladas',()=>{
  equal((migration.match(/enable row level security;/g)||[]).length,3);
  equal((migration.match(/for select to authenticated/g)||[]).length,3);
  equal((migration.match(/using \(\(select auth\.uid\(\)\) = user_id\)/g)||[]).length,3);
  for(const table of ['card_billing_cycles','card_invoice_payments','card_purchase_credits']){
    ok(migration.includes(`revoke all on table public.${table} from public, anon, authenticated`));
    ok(migration.includes(`grant select on table public.${table} to authenticated`));
  }
  ok(!/grant (insert|update|delete).*authenticated/i.test(migration));
});

test('views respeitam RLS e não são security definer implícitas',()=>{
  equal((migration.match(/with \(security_invoker = true\)/g)||[]).length,2);
  ok(migration.includes('create view public.card_invoice_balances_v1'));
  ok(migration.includes('create view public.card_limit_positions_v1'));
});

test('mutações autenticam, restringem search_path e retiram PUBLIC/anon',()=>{
  for(const fn of ['attach_my_card_transaction_to_cycle_v1','pay_my_card_invoice_v1','reverse_my_card_payment_v1','credit_my_card_purchase_v1','reverse_my_card_purchase_credit_v1']){
    const start=migration.indexOf(`create function public.${fn}`);
    ok(start>=0,fn);
    const body=migration.slice(start,migration.indexOf('\n$$;',start)+4);
    ok(body.includes('security definer'),`${fn}: security definer`);
    ok(body.includes('auth.uid()'),`${fn}: auth.uid`);
    ok(body.includes('set search_path = pg_catalog, public'),`${fn}: search_path`);
    ok(migration.includes(`revoke all on function public.${fn}`),`${fn}: revoke`);
  }
});

test('idempotência, reversão única e locks protegem concorrência',()=>{
  equal((migration.match(/operation_id uuid not null/g)||[]).length,2);
  equal((migration.match(/unique \(user_id, operation_id\)/g)||[]).length,2);
  ok((migration.match(/':card-(?:payment|payment-reversal|credit|credit-reversal):'/g)||[]).length===4);
  ok(migration.includes('card_invoice_payments_single_reversal_uidx'));
  ok(migration.includes('card_purchase_credits_single_reversal_uidx'));
  ok((migration.match(/for update;/g)||[]).length>=8);
  ok(migration.includes('transactions_guard_card_cycle_v1'));
  ok(migration.includes('billing cycle membership is immutable'));
  ok(migration.includes('payment exceeds invoice outstanding amount'));
  ok(migration.includes('purchase credit exceeds original purchase amount'));
});

test('fatura mantém ciclo e liquidação como eixos independentes',()=>{
  equal(invoice({purchase:100,today:'2026-08-22'}).lifecycle,'open');
  assert.deepEqual(invoice({purchase:100,payment:40,today:'2026-10-01'}),{outstanding:60,creditBalance:0,settlement:'partially_paid',lifecycle:'overdue'});assertions++;
  assert.deepEqual(invoice({purchase:100,payment:100,today:'2026-10-01'}),{outstanding:0,creditBalance:0,settlement:'paid',lifecycle:'closed'});assertions++;
  assert.deepEqual(invoice({purchase:100,payment:100,credit:20,today:'2026-10-01'}),{outstanding:0,creditBalance:20,settlement:'paid',lifecycle:'closed'});assertions++;
});

test('pagamento da fatura permanece neutro em despesa econômica',()=>{
  const purchase=financialEffect({transaction_type:'despesa',amount:100,status:'realizado',transaction_date:'2026-08-20',card_id:'card'},{now:'2026-08-20'});
  equal(purchase.consumptionExpenseAmount,100);
  ok(!migration.includes("transaction_type, 'despesa'"));
  ok(!/insert into public\.transactions[\s\S]{0,500}payment/i.test(migration));
});

test('limite usa saldo aberto de todos os ciclos e preserva excesso negativo',()=>{
  const committed=[invoice({purchase:900,payment:300}),invoice({purchase:600,credit:100})].reduce((sum,row)=>sum+row.outstanding,0);
  equal(committed,1100);
  equal(1000-committed,-100);
  ok(migration.includes('c."limit" - coalesce(sum(i.outstanding_amount), 0)'));
  ok(migration.includes('case when c."limit" > 0'));
});

test('rollback falha fechado quando existe qualquer ledger ou vínculo',()=>{
  ok(rollback.includes('if exists (select 1 from public.card_invoice_payments)'));
  ok(rollback.includes('or exists (select 1 from public.card_purchase_credits)'));
  ok(rollback.includes('where card_billing_cycle_id is not null'));
  ok(rollback.includes('use application-first rollback'));
  ok(rollback.trimEnd().endsWith('commit;'));
});

test('artefatos não executam Supabase e não contêm alvo remoto',()=>{
  const combined=[migration,rollback,design,pgTap].join('\n');
  ok(!combined.includes('mwjqfzbpjmwiscvtxvfc'));
  ok(!combined.includes('amzgqfvyjaiaoohnbcfl'));
  ok(!/supabase\s+(db push|migration up|link)/i.test(combined));
  ok(design.includes('VISUAL_V1_IMPACT = ZERO'));
});

test('pgTAP futuro cobre schema, RLS, grants, funções, índices e ownership',()=>{
  ok(pgTap.includes('select plan(34)'));
  for(const token of ['relrowsecurity','policies_are','function_privs_are','index_is_unique','fk_ok'])ok(pgTap.includes(token),token);
  ok(pgTap.trimEnd().endsWith('rollback;'));
});

console.log(`card-billing-backend-design: ${tests} tests, ${assertions} assertions passed`);
