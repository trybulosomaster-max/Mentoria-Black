#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20260828183342_harden_card_billing_temporal_contracts_v1.sql');
const rollback = read('supabase/rollback/rollback_20260828183342_harden_card_billing_temporal_contracts_v1.sql');
const sqlTest = read('supabase/tests/card_billing_temporal_hardening_v1_test.sql');
const harness = read('supabase/tests/card_billing_temporal_hardening_v1_local_test.sh');

for (const fragment of [
  "t.purchase_date <= v_position",
  'temporal hardening refuses persisted realized purchase chronology drift',
  'temporal hardening refuses persisted payment chronology drift',
  "p_status = 'realizado'",
  "public.has_active_access('APP') is not true",
  'c.relrowsecurity is not true',
  'payment effective_date precedes an eligible purchase_date',
  'guard_card_purchase_temporal_v1',
  'guard_card_payment_temporal_v1',
  'in access exclusive mode',
  "privilege.grantee = 0",
  "from public, anon, authenticated, service_role;"
]) {
  assert.ok(migration.includes(fragment), `missing temporal invariant: ${fragment}`);
}

assert.doesNotMatch(
  migration,
  /grant execute on function public\.(?:structure|create|pay|reverse|credit)_my_card_/i,
  'temporal migration must not reactivate a mutator'
);
assert.ok(
  (migration.match(/is not true/g) || []).length >= 10,
  'all public readers and writers must fail closed on nullable APP access'
);
assert.ok(
  (migration.match(/has_function_privilege\('public'/g) || []).length === 0,
  'PUBLIC ACL inspection must use grantee=0, not a nonexistent role name'
);

for (const fragment of [
  'refusing temporal hardening rollback after use',
  'in access exclusive mode',
  'guard_card_purchase_temporal_v1',
  'guard_card_payment_temporal_v1',
  'All eight mutators stay dormant'
]) {
  assert.ok(rollback.includes(fragment), `missing rollback contract: ${fragment}`);
}

for (const fragment of [
  'NULL commercial predicate fails closed',
  'as-of billing excludes purchases after position_as_of',
  'payment wrapper cannot predate an eligible purchase',
  'payment ledger trigger independently enforces purchase chronology',
  'all eight public mutators remain dormant'
]) {
  assert.ok(sqlTest.includes(fragment), `missing temporal test: ${fragment}`);
}

assert.doesNotMatch(
  harness,
  /\bsupabase\s+(?:db\s+push|link|migration\s+up)|https?:\/\/|amzgqfvyjaiaoohnbcfl|mwjqfzbpjmwiscvtxvfc/,
  'temporal harness must remain local-only'
);
for (const text of [migration, rollback, sqlTest, harness]) {
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'no JWT-like token');
}

console.log('CARD_BILLING_TEMPORAL_HARDENING_STATIC=PASS');
