/**
 * Port TypeScript de `js/signup-password-policy.js` da baseline auditada
 * (Git blob `e33e680640092a17f87ef782e2487be93a014286`).
 */
export const PASSWORD_POLICY_SOURCE =
  'main:js/signup-password-policy.js@9b8659643d5d66713d0f12e2af9422c573a27a8d';
export const MIN_PASSWORD_LENGTH = 6;
export const PASSWORD_MESSAGE = 'Use pelo menos 6 caracteres.';
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignupInput = Readonly<{
  name?: string;
  email?: string;
  password?: string;
  confirmation?: string;
  termsAccepted?: boolean;
}>;

export type SignupValidation = Readonly<{
  ok: boolean;
  code: string | null;
  message: string;
}>;

export function passwordIsValid(password: unknown): boolean {
  return String(password || '').length >= MIN_PASSWORD_LENGTH;
}

export function validateSignup({
  name = '',
  email = '',
  password = '',
  confirmation = '',
  termsAccepted = false,
}: SignupInput = {}): SignupValidation {
  const value = String(password || '');
  if (!String(name || '').trim()) {
    return Object.freeze({ ok: false, code: 'name_required', message: 'Informe seu nome para criar a conta.' });
  }
  if (!EMAIL_PATTERN.test(String(email || '').trim())) {
    return Object.freeze({ ok: false, code: 'email_required', message: 'Informe um e-mail válido para criar a conta.' });
  }
  if (!passwordIsValid(value)) {
    return Object.freeze({ ok: false, code: 'password_requirements', message: PASSWORD_MESSAGE });
  }
  if (value !== String(confirmation || '')) {
    return Object.freeze({ ok: false, code: 'password_confirmation', message: 'As senhas não coincidem.' });
  }
  if (termsAccepted !== true) {
    return Object.freeze({
      ok: false,
      code: 'terms_required',
      message: 'Confirme que você concorda com os Termos de Uso e a Política de Privacidade.',
    });
  }
  return Object.freeze({ ok: true, code: null, message: '' });
}

export type SignupFunction = (input: {
  email: string;
  password: string;
  options: { data: { full_name: string } };
}) => Promise<{ data?: unknown; error?: unknown }>;

export async function submitSignup({
  name,
  email,
  password,
  confirmation,
  termsAccepted,
  signUp,
}: SignupInput & { signUp?: SignupFunction } = {}) {
  const validation = validateSignup({ name, email, password, confirmation, termsAccepted });
  if (!validation.ok) return Object.freeze({ ok: false, called: false, validation });
  if (typeof signUp !== 'function') throw new TypeError('signUp is required');
  const result = await signUp({
    email: String(email).trim(),
    password: String(password),
    options: { data: { full_name: String(name).trim() } },
  });
  return Object.freeze({
    ok: !result?.error,
    called: true,
    validation,
    error: result?.error || null,
    data: result?.data || null,
  });
}
