const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]+$/;
const PRIVILEGED_LEGACY_ROLE = ['service', 'role'].join('_');
const PRIVILEGED_LEGACY_ROLE_ALIAS = ['service', 'role'].join('-');
const SECRET_KEY_PREFIX = ['sb', 'secret', ''].join('_');

function invalidCredential(): Error {
  return new Error('A credencial pública do Supabase é inválida para o aplicativo móvel.');
}

function privilegedCredential(): Error {
  return new Error('Uma credencial administrativa do Supabase nunca pode ser usada no aplicativo móvel.');
}

function decodeBase64UrlBytes(value: string): readonly number[] {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw invalidCredential();
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    const index = BASE64URL_ALPHABET.indexOf(character);
    if (index < 0) throw invalidCredential();
    buffer = (buffer << 6) | index;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
    buffer &= bits === 0 ? 0 : (1 << bits) - 1;
  }
  if (buffer !== 0) throw invalidCredential();
  return bytes;
}

function decodeBase64Url(value: string): string {
  try {
    const bytes = decodeBase64UrlBytes(value);
    return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    throw invalidCredential();
  }
}

function decodeJsonObject(value: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(decodeBase64Url(value));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw invalidCredential();
    return decoded as Record<string, unknown>;
  } catch {
    throw invalidCredential();
  }
}

function legacyJwtRole(value: string): string {
  const segments = value.split('.');
  if (segments.length !== 3 || segments.some((segment) => !segment || !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw invalidCredential();
  }

  const header = decodeJsonObject(segments[0]!);
  if (typeof header.alg !== 'string' || !header.alg) throw invalidCredential();
  const role = decodeJsonObject(segments[1]!).role;
  if (typeof role !== 'string' || !role) throw invalidCredential();
  decodeBase64UrlBytes(segments[2]!);
  return role;
}

/**
 * Classifica somente o tipo da credencial usada pelo cliente público.
 * A assinatura JWT continua sendo responsabilidade do Supabase; o Mobile
 * precisa apenas impedir que uma credencial administrativa chegue ao bundle.
 */
export function assertPublicClientCredential(input: string): void {
  const credential = String(input ?? '').trim();
  if (!credential) throw invalidCredential();

  const lowered = credential.toLowerCase();
  if (
    lowered.startsWith(SECRET_KEY_PREFIX)
    || lowered.includes(PRIVILEGED_LEGACY_ROLE)
    || lowered.includes(PRIVILEGED_LEGACY_ROLE_ALIAS)
  ) throw privilegedCredential();

  if (PUBLISHABLE_KEY_PATTERN.test(credential)) return;

  const role = legacyJwtRole(credential);
  if (role === PRIVILEGED_LEGACY_ROLE) throw privilegedCredential();
  if (role !== 'anon') throw invalidCredential();
}
