import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasFinancialAppAccess,
  normalizeEntitlements,
  resolveExperience,
  trialNotice,
} from '../src/domain/access/access-contract.ts';
import {
  canonicalStatus,
  dateOnly,
  financialDate,
  financialEffect,
  summarizeRealized,
  temporalState,
} from '../src/domain/finance/foundation-financial-read-model.ts';
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_POLICY_SOURCE,
  validateSignup,
} from '../src/features/auth/password-policy.ts';
import { touch } from '../src/design-system/tokens.ts';

const entitlementPayload = {
  server_now: '2026-08-29T20:00:00.000Z',
  app: {
    has_access: true,
    access_type: 'trial',
    status: 'active',
    trial_remaining_seconds: 7200,
  },
  knowledge: { has_access: false, status: 'none' },
  trial: { state: 'active' },
  internal_access: { active: false, app: false, knowledge: false },
};

test('normaliza entitlement e resolve experiência APP trial', () => {
  const normalized = normalizeEntitlements(entitlementPayload);
  assert.equal(normalized.app.hasAccess, true);
  assert.equal(resolveExperience(entitlementPayload), 'app_trial');
  assert.equal(hasFinancialAppAccess(normalized), true);
  assert.equal(trialNotice(entitlementPayload), 'Teste gratuito — 2 horas restantes');
});

test('nega acesso financeiro para produto somente de conhecimento', () => {
  const normalized = normalizeEntitlements({
    ...entitlementPayload,
    app: { has_access: false, status: 'none' },
    knowledge: { has_access: true, access_type: 'paid', status: 'active' },
  });
  assert.equal(resolveExperience(normalized), 'knowledge');
  assert.equal(hasFinancialAppAccess(normalized), false);
});

test('mantém a política de senha da main auditada', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 6);
  assert.match(PASSWORD_POLICY_SOURCE, /9b865964/);
  assert.equal(validateSignup({
    name: 'Lucas',
    email: 'lucas@example.com',
    password: '123456',
    confirmation: '123456',
    termsAccepted: true,
  }).ok, true);
  assert.equal(validateSignup({
    name: 'Lucas',
    email: 'lucas@example.com',
    password: '12345',
    confirmation: '12345',
    termsAccepted: true,
  }).code, 'password_requirements');
});

test('preserva realizado, programado, futuro realizado e cancelado', () => {
  assert.equal(canonicalStatus({ status: 'pago' }).status, 'realizado');
  assert.equal(canonicalStatus({ status: 'pago' }).aliasUsed, 'pago');
  assert.equal(temporalState({ status: 'programado', transaction_date: '2026-08-01' }, '2026-08-29').state, 'previsto_materializado');
  assert.equal(temporalState({ status: 'realizado', transaction_date: '2026-09-01' }, '2026-08-29').state, 'previsto_materializado');
  assert.equal(temporalState({ status: 'cancelado', transaction_date: '2026-08-01' }, '2026-08-29').state, 'cancelado');
  assert.equal(dateOnly('2026-02-31'), '');
  assert.equal(financialDate({ transaction_date: '2026-08-05', purchase_date: '2026-08-01' }), '2026-08-05');
  assert.equal(financialDate({ purchase_date: '2026-08-01' }), '');
});

test('resume somente efeitos realizados de leitura', () => {
  const summary = summarizeRealized([
    { amount: 5000, transaction_type: 'receita', status: 'realizado', transaction_date: '2026-08-01' },
    { amount: 900, transaction_type: 'despesa', status: 'realizado', transaction_date: '2026-08-02' },
    { amount: 400, transaction_type: 'investimento', status: 'realizado', transaction_date: '2026-08-03', source_account_id: 'account-1', asset_id: 'asset-1' },
    { amount: 100, transaction_type: 'despesa', status: 'programado', transaction_date: '2026-08-04' },
    { amount: 250, transaction_type: 'resgate', status: 'realizado', transaction_date: '2026-08-05', destination_account_id: 'account-1', asset_id: 'asset-1' },
  ], '2026-08-29');
  assert.deepEqual(summary, {
    income: 5000,
    expense: 900,
    investment: 400,
    transfer: 0,
    rescue: 250,
    availableBalanceDelta: 3950,
    netWorthDelta: 4100,
    unclassified: 0,
  });
  assert.equal(financialEffect({ amount: -1, transaction_type: 'despesa', status: 'realizado', transaction_date: '2026-08-01' }, { now: '2026-08-29' }).valid, false);
  const transfer = financialEffect({ amount: 10, transaction_type: 'transferencia', status: 'realizado', transaction_date: '2026-08-01', source_account_id: 'same', destination_account_id: 'same' }, { now: '2026-08-29' });
  assert.equal(transfer.valid, false);
  assert.ok(transfer.warnings.includes('same_transfer_account'));
});

test('design system cumpre alvo mínimo de toque', () => {
  assert.ok(touch.minimum >= 44);
  assert.ok(touch.comfortable >= touch.minimum);
});
