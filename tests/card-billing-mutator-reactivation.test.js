#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20260828190138_reactivate_card_billing_mutators_v1.sql');
const rollback = read('supabase/rollback/rollback_20260828190138_reactivate_card_billing_mutators_v1.sql');
const sqlTest = read('supabase/tests/card_billing_mutator_reactivation_v1_test.sql');
const harness = read('supabase/tests/card_billing_mutator_reactivation_v1_local_test.sh');

const uiWriters = [
  'create_my_card_installment_series_with_metadata_v1',
  'create_my_card_purchase_v1',
  'pay_my_card_invoice_v1',
  'reverse_my_card_payment_v1',
  'credit_my_card_purchase_v1',
  'reverse_my_card_purchase_credit_v1'
];
const dormantWriters = [
  'structure_my_card_purchase_v1',
  'create_my_card_installment_series_v1'
];
const allWriters = [...dormantWriters, ...uiWriters].sort();

const granted = [...migration.matchAll(
  /grant execute on function public\.([a-z0-9_]+)\([^;]+?\)\s+to authenticated;/gi
)].map(match => match[1]).sort();
assert.deepEqual(granted, [...uiWriters].sort(), 'migration must grant exactly six reviewed UI writers');
for (const dormant of dormantWriters) {
  assert.ok(!granted.includes(dormant), `${dormant} must remain dormant`);
}
assert.doesNotMatch(
  migration,
  /grant execute[\s\S]{0,300}\bto\s+(?:public|anon|service_role)\b/i,
  'migration must not grant a writer to PUBLIC, anon or service_role'
);

for (const [text, label] of [[migration, 'migration'], [rollback, 'rollback']]) {
  const revoked = [...text.matchAll(
    /revoke all on function public\.([a-z0-9_]+)\([^;]+?\)\s+from public, anon, authenticated, service_role;/gi
  )].map(match => match[1]).sort();
  assert.deepEqual(revoked, allWriters, `${label} must revoke exactly all eight writers`);
}

for (const fragment of [
  'card billing mutator reactivation requires the temporal APP contract',
  'card billing mutator reactivation requires the canonical APP predicate',
  'card billing mutator reactivation requires RLS on all shadow tables',
  'card billing mutator reactivation requires the exact APP-gated SELECT policies',
  'card billing mutator reactivation requires read-only authenticated table ACL',
  'card billing mutator reactivation requires every billing guard enabled',
  'card billing mutator reactivation requires the validated empty shadow state',
  'card billing mutator reactivation refuses reviewed function drift',
  'card billing mutator reactivation refuses private implementation drift',
  'card billing mutator reactivation requires owner-only private function ACL',
  "md5(pg_get_functiondef(to_regprocedure(expected.signature)))",
  'billing_private.writer_context_v1',
  'privilege.grantee = 0',
  'privilege.is_grantable is false',
  'privilege.grantee not in (p.proowner, v_authenticated)',
  'unused card billing mutator must remain dormant',
  'card billing mutator reactivation requires private schema isolation'
]) {
  assert.ok(migration.includes(fragment), `missing reactivation invariant: ${fragment}`);
}
assert.equal(
  (migration.match(/'[a-f0-9]{32}'/g) || []).length,
  59,
  'preflight must fingerprint fifteen triggers, eleven public and thirty-three private functions'
);
assert.match(migration, /n\.nspname = 'billing_private'\) <> 33/);
assert.match(migration, /\) <> 15 then[\s\S]*every billing guard enabled/);
assert.match(migration, /\(select count\(\*\)[\s\S]*from pg_policies[\s\S]*\) <> 6/);
assert.ok(migration.includes('t.tgrelid = to_regclass(expected.relation_name)'),
  'trigger check must bind each name to its exact relation');
assert.ok(migration.includes('t.tgfoid = to_regprocedure(expected.function_signature)'),
  'trigger check must bind each name to its exact function');
assert.ok(migration.includes('md5(pg_get_triggerdef(t.oid, true)) = expected.fingerprint'),
  'trigger check must freeze event, timing, level and update-column semantics');
assert.ok((migration.match(/privilege\.grantee <> p\.proowner/g) || []).length >= 3,
  'private, dormant and wrapper ACLs must reject every arbitrary role');
assert.ok(migration.includes("privilege.grantee not in (p.proowner, 'authenticated'::regrole::oid)"),
  'reader ACL must reject roles outside owner and authenticated');
assert.ok(migration.includes('privilege.grantee <> n.nspowner'),
  'private schema ACL must reject every non-owner role');
for (const table of [
  'transactions', 'writer_context_v1', 'card_installment_series',
  'card_billing_cycles', 'card_invoice_payments',
  'card_payment_allocations', 'card_account_settlements',
  'card_purchase_credits'
]) {
  assert.ok(migration.includes(table), `locked/preflight topology must include ${table}`);
}

assert.doesNotMatch(rollback, /\b(?:drop|delete|insert|update|truncate|alter)\b/i,
  'operational rollback must be ACL-only');
assert.doesNotMatch(rollback, /\bgrant\s+execute\b/i,
  'operational rollback must never reactivate a writer');
for (const fragment of [
  'card billing mutator revoke rollback postcondition failed',
  'privilege.grantee = 0',
  "has_function_privilege('anon'",
  "has_function_privilege('authenticated'",
  "has_function_privilege('service_role'",
  'commit;'
]) {
  assert.ok(rollback.includes(fragment), `missing rollback invariant: ${fragment}`);
}

for (const label of [
  'reactivation grants exactly six UI writers only to authenticated',
  'two lower-level structuring writers remain dormant for every client role',
  'expired APP cannot call reactivated writer',
  'missing APP cannot call reactivated writer',
  'disabled APP cannot call reactivated writer',
  'active APP user can call reactivated metadata installment writer',
  'active APP user can call reactivated purchase writer',
  'active APP user can call reactivated payment writer',
  'active APP user can call reactivated credit writer',
  'active APP user can call reactivated payment reversal writer',
  'active APP user can call reactivated credit reversal writer',
  'user B cannot pay user A cycle with own account',
  'user B cannot credit user A transaction by explicit UUID',
  'user B cannot reverse user A payment by explicit UUID',
  'user B cannot reverse user A credit by explicit UUID',
  'anon cannot execute reactivated purchase writer',
  'service_role cannot execute reactivated purchase writer'
]) {
  assert.ok(sqlTest.includes(label), `missing runtime reactivation proof: ${label}`);
}

for (const fragment of [
  '20260828130535_aviora_card_billing_backend_v1.sql',
  '20260828173831_aviora_card_billing_mutator_activation_v1.sql',
  '20260828182643_revoke_card_billing_mutators_pending_review.sql',
  '20260828183342_harden_card_billing_temporal_contracts_v1.sql',
  '20260828190138_reactivate_card_billing_mutators_v1.sql',
  'rollback_20260828190138_reactivate_card_billing_mutators_v1.sql',
  'CARD_BILLING_MUTATOR_REACTIVATION_LOCAL=PASS',
  'reactivation-private-body-drift',
  'reactivation-disabled-trigger-drift',
  'reactivation-misattached-trigger-drift',
  'reactivation-trigger-event-timing-drift',
  'reactivation-rogue-role-grant-drift',
  'reactivation-rollback-rogue-role-grant',
  'PRIVATE_BODY_DRIFT_PREFLIGHT=PASS',
  'TRIGGER_BINDING_AND_ENABLED_PREFLIGHT=PASS',
  'TRIGGER_EVENT_TIMING_FINGERPRINT_PREFLIGHT=PASS',
  'ARBITRARY_ROLE_ACL_PREFLIGHT=PASS',
  'ROLLBACK_ARBITRARY_ROLE_FAIL_CLOSED=PASS',
  'com.supabase.cli.project',
  'createdb -U postgres -T template0',
  'dropdb -U postgres --if-exists --force'
]) {
  assert.ok(harness.includes(fragment), `missing local harness contract: ${fragment}`);
}
assert.doesNotMatch(
  harness,
  /\bsupabase\s+(?:db\s+push|link|migration\s+up)|https?:\/\/|amzgqfvyjaiaoohnbcfl|mwjqfzbpjmwiscvtxvfc/,
  'reactivation harness must remain local-only'
);
for (const text of [migration, rollback, sqlTest, harness]) {
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'no JWT-like token');
}

console.log('CARD_BILLING_MUTATOR_REACTIVATION_STATIC=PASS');
