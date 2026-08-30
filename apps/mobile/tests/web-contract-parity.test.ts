import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as mobileAccess from '../src/domain/access/access-contract.ts';
import * as mobilePassword from '../src/features/auth/password-policy.ts';

const require = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, '../../..');
const accessPath = path.join(repositoryRoot, 'commercial', 'access-contract.js');
const passwordPath = path.join(repositoryRoot, 'js', 'signup-password-policy.js');
const EXPECTED_ACCESS_BLOB = '1d64da78044d29d5c91f21d39523bbd556a227a7';
const EXPECTED_PASSWORD_BLOB = 'e33e680640092a17f87ef782e2487be93a014286';

function gitBlobHash(content: Buffer): string {
  return createHash('sha1')
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest('hex');
}

const entitlementPayload = {
  server_now: '2026-08-29T20:00:00.000Z',
  app: {
    has_access: true,
    access_type: 'trial',
    source: 'trial',
    status: 'active',
    expires_at: '2026-08-30T20:00:00.000Z',
    trial_remaining_seconds: 7200,
    commercial_access: { has_access: true, state: 'active' },
  },
  knowledge: {
    has_access: false,
    status: 'none',
  },
  trial: {
    state: 'active',
    expires_at: '2026-08-30T20:00:00.000Z',
  },
  internal_access: {
    active: false,
    app: false,
    knowledge: false,
    role: null,
  },
};

test('mantém paridade com contratos Web de acesso e cadastro', async (context) => {
  if (!existsSync(accessPath) || !existsSync(passwordPath)) {
    context.skip('O overlay isolado não contém os contratos Web; a comparação será obrigatória após integração.');
    return;
  }

  assert.equal(gitBlobHash(readFileSync(accessPath)), EXPECTED_ACCESS_BLOB, 'O contrato de acesso Web mudou; refaça o freeze.');
  assert.equal(gitBlobHash(readFileSync(passwordPath)), EXPECTED_PASSWORD_BLOB, 'A política de cadastro Web mudou; refaça o freeze.');

  const webAccess = require(accessPath) as typeof mobileAccess;
  const webPassword = require(passwordPath) as typeof mobilePassword;

  assert.deepEqual(mobileAccess.PRODUCT_CODES, webAccess.PRODUCT_CODES);
  assert.deepEqual(mobileAccess.ACCESS_TYPES, webAccess.ACCESS_TYPES);
  assert.deepEqual(mobileAccess.ACCESS_STATES, webAccess.ACCESS_STATES);
  assert.deepEqual(mobileAccess.TRIAL_RESULTS, webAccess.TRIAL_RESULTS);
  assert.deepEqual(mobileAccess.ACCESS_BASES, webAccess.ACCESS_BASES);

  assert.deepEqual(
    mobileAccess.normalizeEntitlements(entitlementPayload),
    webAccess.normalizeEntitlements(entitlementPayload),
  );
  assert.equal(mobileAccess.resolveExperience(entitlementPayload), webAccess.resolveExperience(entitlementPayload));
  assert.equal(mobileAccess.trialRemaining(entitlementPayload), webAccess.trialRemaining(entitlementPayload));
  assert.equal(mobileAccess.trialNotice(entitlementPayload), webAccess.trialNotice(entitlementPayload));
  assert.equal(mobileAccess.authErrorMessage({ code: 'invalid_credentials' }), webAccess.authErrorMessage({ code: 'invalid_credentials' }));
  assert.equal(mobileAccess.authErrorMessage({ message: 'Email not confirmed' }), webAccess.authErrorMessage({ message: 'Email not confirmed' }));
  assert.equal(mobileAccess.accountLoadErrorMessage(), webAccess.accountLoadErrorMessage());

  const signupCases = [
    {},
    { name: 'Lucas', email: 'invalido', password: '123456', confirmation: '123456', termsAccepted: true },
    { name: 'Lucas', email: 'lucas@example.com', password: '12345', confirmation: '12345', termsAccepted: true },
    { name: 'Lucas', email: 'lucas@example.com', password: '123456', confirmation: '123456', termsAccepted: false },
    { name: ' Lucas ', email: ' lucas@example.com ', password: '123456', confirmation: '123456', termsAccepted: true },
  ] as const;

  for (const input of signupCases) {
    assert.deepEqual(mobilePassword.validateSignup(input), webPassword.validateSignup(input));
  }
  for (const password of [null, '', '12345', '123456', 0, false]) {
    assert.equal(mobilePassword.passwordIsValid(password), webPassword.passwordIsValid(password));
  }

  const mobileSignupCalls: unknown[] = [];
  const webSignupCalls: unknown[] = [];
  const validInput = {
    name: ' Lucas ',
    email: ' lucas@example.com ',
    password: '123456',
    confirmation: '123456',
    termsAccepted: true,
  };
  const mobileSignup = await mobilePassword.submitSignup({
    ...validInput,
    signUp: async (input) => {
      mobileSignupCalls.push(input);
      return { data: { user: 'ok' }, error: null };
    },
  });
  const webSignup = await webPassword.submitSignup({
    ...validInput,
    signUp: async (input) => {
      webSignupCalls.push(input);
      return { data: { user: 'ok' }, error: null };
    },
  });
  assert.deepEqual(mobileSignupCalls, webSignupCalls);
  assert.deepEqual(mobileSignup, webSignup);

  const createRpcClient = () => ({
    calls: [] as string[],
    async rpc(name: string) {
      this.calls.push(name);
      if (name === 'start_my_app_trial') return { data: [{ result: 'started' }], error: null };
      if (name === 'get_my_entitlements') return { data: entitlementPayload, error: null };
      return { data: null, error: new Error('unexpected rpc') };
    },
  });
  const mobileClient = createRpcClient();
  const webClient = createRpcClient();
  const mobileSession = await mobileAccess.beginCommercialSession(mobileClient);
  const webSession = await webAccess.beginCommercialSession(webClient);
  assert.deepEqual(mobileClient.calls, webClient.calls);
  assert.deepEqual(mobileSession, webSession);
});
