import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as mobile from '../src/domain/finance/foundation-financial-read-model.ts';

const require = createRequire(import.meta.url);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../../..');
const webCorePath = path.join(repositoryRoot, 'js', 'financial-core.js');
const EXPECTED_GIT_BLOB = '054f00edc7efdedf672f0066ff0a370638e6fbf7';

function gitBlobHash(content: Buffer): string {
  return createHash('sha1')
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest('hex');
}

const fixtures = [
  {
    amount: 1000,
    transaction_type: 'receita',
    status: 'pago',
    transaction_date: '2026-08-01',
    destination_account_id: 'account-income',
  },
  {
    amount: '250.50',
    transaction_type: 'despesa',
    status: 'realizado',
    transaction_date: '2026-08-02',
    account_id: 'account-expense',
  },
  {
    amount: 400,
    transaction_type: 'investimento',
    status: 'realizado',
    transaction_date: '2026-08-03',
    source_account_id: 'account-source',
    asset_id: 'asset-destination',
  },
  {
    amount: 100,
    transaction_type: 'transferencia',
    status: 'realizado',
    transaction_date: '2026-08-04',
    source_account_id: 'account-a',
    destination_account_id: 'account-b',
  },
  {
    amount: 75,
    transaction_type: 'resgate',
    status: 'realizado',
    transaction_date: '2026-08-05',
    destination_account_id: 'account-rescue',
    asset_id: 'asset-source',
  },
  {
    amount: 90,
    transaction_type: 'despesa',
    status: 'programado',
    transaction_date: '2026-08-12',
    source_account_id: 'account-expense',
  },
  {
    amount: 10,
    transaction_type: 'despesa',
    status: 'realizado',
    transaction_date: '2026-09-01',
    source_account_id: 'account-expense',
  },
  {
    amount: -1,
    transaction_type: 'despesa',
    status: 'realizado',
    transaction_date: '2026-08-01',
  },
  {
    amount: 10,
    transaction_type: 'transferencia',
    status: 'realizado',
    transaction_date: '2026-08-01',
    source_account_id: 'same',
    destination_account_id: 'same',
  },
  {
    amount: 10,
    transaction_type: 'unknown',
    status: 'misterioso',
    due_date: '31/08/2026',
  },
  {
    amount: 10,
    transaction_type: 'despesa',
    status: 'cancelado',
    transaction_date: '2026-08-06',
    purchase_date: '2026-08-01',
  },
] as const;

test('mantém paridade diferencial com js/financial-core.js da baseline', (context) => {
  if (!existsSync(webCorePath)) {
    context.skip('O overlay isolado não contém o núcleo Web; a comparação será obrigatória após integração no repositório real.');
    return;
  }

  const content = readFileSync(webCorePath);
  assert.equal(
    gitBlobHash(content),
    EXPECTED_GIT_BLOB,
    'O núcleo Web mudou; revise fixtures e freeze antes de aceitar a paridade.',
  );

  const web = require(webCorePath) as {
    canonicalStatus(transaction: unknown): unknown;
    financialDate(transaction: unknown): unknown;
    temporalState(transaction: unknown, now: unknown): unknown;
    financialEffect(transaction: unknown, options: { now: unknown }): unknown;
    realizedTransactions(rows: readonly unknown[], period: unknown, now: unknown): unknown;
    scheduledTransactions(rows: readonly unknown[], period: unknown, now: unknown): unknown;
  };
  const now = '2026-08-29';

  for (const fixture of fixtures) {
    assert.deepEqual(mobile.canonicalStatus(fixture), web.canonicalStatus(fixture));
    assert.deepEqual(mobile.financialDate(fixture), web.financialDate(fixture));
    assert.deepEqual(mobile.temporalState(fixture, now), web.temporalState(fixture, now));
    assert.deepEqual(mobile.financialEffect(fixture, { now }), web.financialEffect(fixture, { now }));
  }

  assert.deepEqual(
    mobile.realizedTransactions(fixtures, { year: 2026, month: 8 }, now),
    web.realizedTransactions(fixtures, { year: 2026, month: 8 }, now),
  );
  assert.deepEqual(
    mobile.scheduledTransactions(fixtures, { year: 2026, month: 8 }, now),
    web.scheduledTransactions(fixtures, { year: 2026, month: 8 }, now),
  );
});
