import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPublicClientCredential } from '../src/core/config/public-client-credential.ts';

const publicRole = 'anon';
const privilegedRole = ['service', 'role'].join('_');
const secretPrefix = ['sb', 'secret', ''].join('_');

function syntheticJwt(payload: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from([0xff, 0x00, 0x80, 0x7f, 0x42]).toString('base64url');
  return `${header}.${body}.${signature}`;
}

test('guard aceita credencial pública moderna sintética', () => {
  assert.doesNotThrow(() => assertPublicClientCredential('  sb_publishable_synthetic-client-key_123  '));
});

test('guard mantém compatibilidade com JWT legado público sintético', () => {
  assert.doesNotThrow(() => assertPublicClientCredential(syntheticJwt({ role: publicRole })));
});

test(`guard nunca aceita JWT cliente com papel administrativo ${privilegedRole}`, () => {
  assert.throws(
    () => assertPublicClientCredential(syntheticJwt({ role: privilegedRole })),
    /administrativa/,
  );
});

test('guard rejeita JWT malformado e payload inválido', () => {
  assert.throws(() => assertPublicClientCredential('header.payload'), /inválida/);
  assert.throws(() => assertPublicClientCredential('header.%%%invalid.signature'), /inválida/);
  const malformedHeader = `not-json.${Buffer.from(JSON.stringify({ role: publicRole })).toString('base64url')}.signature`;
  assert.throws(() => assertPublicClientCredential(malformedHeader), /inválida/);
  const validHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const validPayload = Buffer.from(JSON.stringify({ role: publicRole })).toString('base64url');
  assert.throws(() => assertPublicClientCredential(`${validHeader}.${validPayload}.a`), /inválida/);
  const invalidPayload = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('not-json').toString('base64url')}.signature`;
  assert.throws(() => assertPublicClientCredential(invalidPayload), /inválida/);
  assert.throws(() => assertPublicClientCredential(syntheticJwt({ role: 'authenticated' })), /inválida/);
  assert.throws(() => assertPublicClientCredential(syntheticJwt([])), /inválida/);
});

test('guard rejeita credencial vazia, secreta e alias administrativo reconhecível', () => {
  assert.throws(() => assertPublicClientCredential(''), /inválida/);
  assert.throws(() => assertPublicClientCredential('sb_publishable_'), /inválida/);
  assert.throws(() => assertPublicClientCredential('opaque-public-looking-value'), /inválida/);
  assert.throws(() => assertPublicClientCredential(`${secretPrefix}synthetic-private-key`), /administrativa/);
  assert.throws(() => assertPublicClientCredential(`${secretPrefix.toUpperCase()}synthetic-private-key`), /administrativa/);
  assert.throws(() => assertPublicClientCredential(`synthetic-${privilegedRole}-credential`), /administrativa/);
});
