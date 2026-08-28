#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const activationPath = path.join(
  root,
  'supabase/migrations/20260828173831_aviora_card_billing_mutator_activation_v1.sql'
);
const revocationPath = path.join(
  root,
  'supabase/migrations/20260828182643_revoke_card_billing_mutators_pending_review.sql'
);
const temporalPath = path.join(
  root,
  'supabase/migrations/20260828183342_harden_card_billing_temporal_contracts_v1.sql'
);
const rollbackPath = path.join(
  root,
  'supabase/rollback/rollback_20260828173831_aviora_card_billing_mutator_activation_v1.sql'
);
const temporalRollbackPath = path.join(
  root,
  'supabase/rollback/rollback_20260828183342_harden_card_billing_temporal_contracts_v1.sql'
);
const sqlTestPath = path.join(
  root,
  'supabase/tests/card_billing_mutator_activation_v1_test.sql'
);
const harnessPath = path.join(
  root,
  'supabase/tests/card_billing_mutator_activation_v1_local_test.sh'
);

const activation = fs.readFileSync(activationPath, 'utf8');
const revocation = fs.readFileSync(revocationPath, 'utf8');
const temporal = fs.readFileSync(temporalPath, 'utf8');
const rollback = fs.readFileSync(rollbackPath, 'utf8');
const temporalRollback = fs.readFileSync(temporalRollbackPath, 'utf8');
const sqlTest = fs.readFileSync(sqlTestPath, 'utf8');
const harness = fs.readFileSync(harnessPath, 'utf8');

function includesAll(text, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(text.includes(fragment), `${label}: missing ${fragment}`);
  }
}

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

includesAll(activation, [
  'begin;',
  "set local lock_timeout = '15s';",
  "set local statement_timeout = '5min';",
  "pg_advisory_xact_lock(hashtextextended('aviora:card-billing-mutator-activation-v1', 0))",
  "card billing activation requires the complete approved shadow schema",
  "card billing activation requires SAFE_NO_BACKFILL shadow state",
  "public.has_active_access('APP')",
  "(statement_timestamp() at time zone 'America/Sao_Paulo')::date",
  "status in ('realizado', 'pendente', 'programado')",
  "status = 'realizado'",
  'scheduled_purchase_amount',
  'known_commitment_amount',
  'AVIORA_MANAGED_AVAILABLE_LIMIT',
  'BALANCE_SNAPSHOT_REQUIRED',
  'HISTORICAL_POSITION_UNAVAILABLE',
  'create_my_card_purchase_v1',
  'create_my_card_installment_series_with_metadata_v1',
  'get_my_card_billing_summary_as_of_v1',
  'get_my_card_account_positions_v1',
  'security invoker',
  'security definer',
  'set search_path = pg_catalog',
  'commit;'
], 'activation contract');

const hiddenImplementations = [
  'structure_my_card_purchase_shadow_impl_v1',
  'create_my_card_installment_series_shadow_impl_v1',
  'pay_my_card_invoice_shadow_impl_v1',
  'reverse_my_card_payment_shadow_impl_v1',
  'credit_my_card_purchase_shadow_impl_v1',
  'reverse_my_card_purchase_credit_shadow_impl_v1'
];
includesAll(activation, hiddenImplementations, 'private implementation topology');
for (const implementation of hiddenImplementations) {
  assert.match(
    activation,
    new RegExp(`revoke all on function billing_private\\.${implementation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(`),
    `hidden implementation ${implementation} must be explicitly revoked`
  );
}

const publicWriters = [
  'structure_my_card_purchase_v1',
  'create_my_card_installment_series_v1',
  'create_my_card_installment_series_with_metadata_v1',
  'create_my_card_purchase_v1',
  'pay_my_card_invoice_v1',
  'reverse_my_card_payment_v1',
  'credit_my_card_purchase_v1',
  'reverse_my_card_purchase_credit_v1'
];
for (const writer of publicWriters) {
  assert.match(
    activation,
    new RegExp(`grant execute on function public\\.${writer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\([\\s\\S]*?\\)\\s+to authenticated;`),
    `${writer} must be granted only through its explicit authenticated grant`
  );
}

includesAll(revocation, publicWriters.map((writer) =>
  `revoke all on function public.${writer}`
), 'fail-closed revocation');
includesAll(temporal, [
  'card billing temporal hardening requires RLS on all shadow tables',
  'temporal hardening refuses persisted realized purchase chronology drift',
  'temporal hardening refuses persisted payment chronology drift',
  'temporal hardening requires every client mutator to remain revoked',
  "public.has_active_access('APP') is not true",
  "new.status = 'realizado'",
  'realized card purchase cannot use a future purchase_date',
  'payment effective_date precedes an eligible purchase_date',
  't.purchase_date <= v_position',
  'c.effective_date <= v_position',
  'only the read adapters are restored for authenticated while writers stay dormant',
  'commit;'
], 'temporal hardening contract');
assert.ok(
  occurrences(temporal, "public.has_active_access('APP') is not true") >= 10,
  'every temporal writer/reader must fail closed on a nullable APP predicate'
);
for (const writer of publicWriters) {
  assert.doesNotMatch(
    temporal,
    new RegExp(`grant execute on function public\\.${writer}\\(`),
    `${writer} must remain dormant after temporal hardening`
  );
}

assert.doesNotMatch(
  activation,
  /grant execute on function[\s\S]*?\bto\s+(?:public|anon|service_role)\s*;/i,
  'activation must never grant callable billing functions to PUBLIC, anon or service_role'
);
assert.ok(
  occurrences(activation, "from public, anon, authenticated, service_role;") >= 17,
  'all callable surfaces and hidden implementations must be fail-closed before granular grants'
);

assert.match(
  activation,
  /coalesce\(t\.status, ''\) <> 'cancelado'[\s\S]*?t\.status is distinct from 'realizado'/,
  'payment wrapper must refuse mixed non-realized cycle rows'
);
assert.match(
  activation,
  /p_effective_date <= v_balance_as_of/,
  'payments and reversals must be strictly after the end-of-day snapshot'
);
assert.ok(
  occurrences(activation, "p_effective_date > (statement_timestamp() at time zone 'America/Sao_Paulo')::date") >= 4,
  'all dated public ledger writers must reject a future Sao Paulo civil date'
);
assert.match(
  activation,
  /e\.effective_date > a\.balance_as_of[\s\S]*?e\.effective_date <= v_position/,
  'account adapter must apply only post-snapshot settlements through position_as_of'
);

assert.match(
  activation,
  /create function public\.create_my_card_purchase_v1\([\s\S]*?insert into public\.transactions\([\s\S]*?v_cycle\.due_date,[\s\S]*?p_purchase_date/,
  'one-off writer must atomically preserve purchase date and use the frozen cycle due date'
);
assert.match(
  activation,
  /create function public\.create_my_card_installment_series_with_metadata_v1\([\s\S]*?update public\.transactions[\s\S]*?payment_method = v_payment_method,[\s\S]*?goal_effect = p_goal_effect/,
  'installment metadata must be completed inside the writer transaction'
);

includesAll(rollback, [
  'refusing activation rollback after use',
  'revoke all on function public.create_my_card_purchase_v1',
  'drop function public.get_my_card_billing_summary_as_of_v1',
  'drop function public.create_my_card_installment_series_with_metadata_v1',
  'rename to pay_my_card_invoice_v1',
  'commit;'
], 'rollback contract');
includesAll(temporalRollback, [
  'lock table public.transactions,',
  'billing_private.writer_context_v1',
  'public.card_installment_series',
  'public.card_billing_cycles',
  'public.card_invoice_payments',
  'public.card_payment_allocations',
  'public.card_account_settlements',
  'public.card_purchase_credits',
  'in access exclusive mode',
  'refusing temporal hardening rollback after use; use application-first forward repair'
], 'temporal rollback locked fail-closed contract');

includesAll(sqlTest, [
  'KNOWLEDGE-only does not authorize Cards mutation',
  'expired APP access does not authorize Cards mutation',
  'NULL APP access does not authorize Cards mutation',
  'future purchase stays outside an earlier historical billing position',
  'direct future pending-to-realized update is blocked by the temporal trigger',
  'future realized purchase is rejected fail closed',
  'payment before the eligible purchase_date is rejected',
  'past realized purchase remains valid',
  'purchase on position_as_of is included at the inclusive boundary',
  'effective_date after position_as_of has no premature billing effect',
  'OWNER with canonical APP access can create a structured purchase',
  'STAFF with canonical APP access can create a structured purchase',
  'invoice adapter separates payable realized from scheduled known commitments',
  'future payment is blocked by the public wrapper',
  'payment on the end-of-day snapshot boundary fails closed',
  'golden payment',
  'golden economic expense remains exactly 1000',
  'one-off writer rejects cross-user card',
  'anon cannot execute payment RPC',
  'all installment metadata is present without post-RPC direct DML'
], 'targeted SQL coverage');

includesAll(harness, [
  'supabase_db_${project_id}',
  'createdb -U postgres -T template0',
  'activation-rerun-drift',
  'empty rollback restores dormant public surface',
  'activation-privilege-drift',
  '20260828182643_revoke_card_billing_mutators_pending_review.sql',
  '20260828183342_harden_card_billing_temporal_contracts_v1.sql',
  'temporal-rls-disabled-preflight',
  'temporal-future-purchase-drift',
  'temporal-payment-chronology-drift',
  'temporal-rollback-after-use',
  'temporal hardening performs zero backfill',
  'transactional test activation rolls back and leaves mutators dormant',
  'CARD_BILLING_MUTATOR_ACTIVATION_LOCAL=PASS'
], 'local disposable harness');
assert.doesNotMatch(
  harness,
  /\bsupabase\s+(?:db\s+push|link|migration\s+up)|https?:\/\/|amzgqfvyjaiaoohnbcfl|mwjqfzbpjmwiscvtxvfc/,
  'local harness must have no linked/remote Supabase path'
);

for (const artifact of [activation, revocation, temporal, rollback, temporalRollback, sqlTest, harness]) {
  assert.doesNotMatch(artifact, /service_role\s*[:=]\s*['"][^'"]+/i, 'no service role credential');
  assert.doesNotMatch(artifact, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'no JWT-like token');
}

console.log('CARD_BILLING_MUTATOR_ACTIVATION_STATIC=PASS');
