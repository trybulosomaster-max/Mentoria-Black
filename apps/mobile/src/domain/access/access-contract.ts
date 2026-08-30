/**
 * Port TypeScript do contrato Web
 * `commercial/access-contract.js` da baseline auditada
 * (Git blob `1d64da78044d29d5c91f21d39523bbd556a227a7`).
 */

export const PRODUCT_CODES = Object.freeze({ APP: 'APP', KNOWLEDGE: 'KNOWLEDGE', COMPLETE: 'COMPLETE' } as const);
export const ACCESS_TYPES = Object.freeze(['paid', 'trial', 'manual', 'lifetime', 'internal'] as const);
export const ACCESS_STATES = Object.freeze([
  'active',
  'grace_period',
  'past_due',
  'expired',
  'revoked',
  'refunded',
  'chargeback',
  'administrative_review',
  'none',
] as const);
export const TRIAL_RESULTS = Object.freeze([
  'started',
  'already_active',
  'already_used',
  'not_eligible',
  'internal_access',
] as const);
export const ACCESS_BASES = Object.freeze(['commercial', 'internal', 'internal_and_commercial', 'none'] as const);

const AUTH_ERROR_MESSAGES = Object.freeze({
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
});
const NORMALIZED_ENTITLEMENTS = new WeakSet<object>();

type AccessType = (typeof ACCESS_TYPES)[number];
type AccessState = (typeof ACCESS_STATES)[number];
type AccessBasis = (typeof ACCESS_BASES)[number];

export type Entitlement = Readonly<{
  hasAccess: boolean;
  access: boolean;
  accessType: AccessType | null;
  type: AccessType | null;
  source: string | null;
  state: AccessState;
  status: AccessState;
  expiresAt: unknown;
  graceUntil: unknown;
  trialRemainingSeconds: number | null;
  commercialState: string | null;
  accessBasis: AccessBasis;
  internalAccess: boolean;
  commercialAccess: Readonly<Record<string, unknown>>;
}>;

export type NormalizedEntitlements = Readonly<{
  serverNow: string;
  app: Entitlement;
  knowledge: Entitlement;
  trial: Readonly<Record<string, unknown>>;
  internalAccess: Readonly<{
    active: boolean;
    app: boolean;
    knowledge: boolean;
    role: string | null;
  }>;
  accessBasis: AccessBasis;
}>;

export type Experience = 'complete' | 'app_trial' | 'app' | 'knowledge' | 'trial_expired' | 'no_access';

type UnknownRecord = Record<string, unknown>;

function objectValue(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {};
}

function nonArrayObject(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

function entitlement(value: unknown): Entitlement {
  const source = objectValue(value);
  const accessType = source.access_type || source.type;
  const state = source.state || source.status || 'none';
  const accessBasis: AccessBasis = includes(ACCESS_BASES, source.access_basis) ? source.access_basis : 'none';
  const rawSeconds = Number(source.trial_remaining_seconds);
  const hasAccess = source.has_access === true || source.access === true;
  const commercialSource = source.commercial_access && typeof source.commercial_access === 'object'
    ? { ...(source.commercial_access as UnknownRecord) }
    : { has_access: false };

  return Object.freeze({
    hasAccess,
    access: hasAccess,
    accessType: includes(ACCESS_TYPES, accessType) ? accessType : null,
    type: includes(ACCESS_TYPES, accessType) ? accessType : null,
    source: typeof source.source === 'string' ? source.source : null,
    state: includes(ACCESS_STATES, state) ? state : 'none',
    status: includes(ACCESS_STATES, state) ? state : 'none',
    expiresAt: source.expires_at || null,
    graceUntil: source.grace_until || null,
    trialRemainingSeconds: Number.isFinite(rawSeconds) ? Math.max(0, rawSeconds) : null,
    commercialState: typeof source.commercial_state === 'string' ? source.commercial_state : null,
    accessBasis,
    internalAccess: source.internal_access === true,
    commercialAccess: Object.freeze(commercialSource),
  });
}

function explicitProductInternalAccess(value: unknown, fallback: boolean): boolean {
  const source = nonArrayObject(value);
  return source && typeof source.internal_access === 'boolean'
    ? source.internal_access === true
    : fallback;
}

function internalAccess(value: unknown, appValue: unknown, knowledgeValue: unknown) {
  const source = nonArrayObject(value);
  if (source) {
    return Object.freeze({
      active: source.active === true,
      app: source.app === true,
      knowledge: source.knowledge === true,
      role: typeof source.role === 'string' ? source.role : null,
    });
  }
  const active = value === true;
  return Object.freeze({
    active,
    app: explicitProductInternalAccess(appValue, active),
    knowledge: explicitProductInternalAccess(knowledgeValue, active),
    role: null,
  });
}

export function normalizeEntitlements(payload: unknown): NormalizedEntitlements {
  if (!payload || typeof payload !== 'object') throw new TypeError('invalid entitlement response');
  if (NORMALIZED_ENTITLEMENTS.has(payload)) return payload as NormalizedEntitlements;
  const source = payload as UnknownRecord;
  if (!source.server_now) throw new TypeError('server_now is required');

  const app = entitlement(source.app);
  const knowledge = entitlement(source.knowledge);
  const internal = internalAccess(source.internal_access, source.app, source.knowledge);
  const hasCommercial = [app, knowledge].some((item) => item.hasAccess && item.accessType !== 'internal');
  const inferredBasis: AccessBasis = internal.active
    ? (hasCommercial ? 'internal_and_commercial' : 'internal')
    : (hasCommercial ? 'commercial' : 'none');
  const basis = includes(ACCESS_BASES, source.access_basis) ? source.access_basis : inferredBasis;
  const trial = source.trial && typeof source.trial === 'object'
    ? { ...(source.trial as UnknownRecord) }
    : { state: 'eligible' };

  const normalized = Object.freeze({
    serverNow: String(source.server_now),
    app,
    knowledge,
    trial: Object.freeze(trial),
    internalAccess: internal,
    accessBasis: basis,
  });
  NORMALIZED_ENTITLEMENTS.add(normalized);
  return normalized;
}

export function resolveExperience(entitlements: unknown): Experience {
  const state = normalizeEntitlements(entitlements);
  if (state.app.hasAccess && state.knowledge.hasAccess) return 'complete';
  if (state.app.hasAccess) return state.app.accessType === 'trial' ? 'app_trial' : 'app';
  if (state.knowledge.hasAccess) return 'knowledge';
  return state.trial.state === 'expired' || state.app.state === 'expired' ? 'trial_expired' : 'no_access';
}

export function trialRemaining(entitlements: unknown): number {
  const state = normalizeEntitlements(entitlements);
  if (state.app.trialRemainingSeconds !== null) return state.app.trialRemainingSeconds * 1000;
  const end = Date.parse(String(state.trial.expires_at || ''));
  const server = Date.parse(state.serverNow);
  return Number.isFinite(end) && Number.isFinite(server) ? Math.max(0, end - server) : 0;
}

export function trialNotice(entitlements: unknown): string {
  const state = normalizeEntitlements(entitlements);
  if (state.internalAccess.active === true) return '';
  const remaining = trialRemaining(state);
  if (!remaining) return '';
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours <= 24) return `Teste gratuito — ${hours === 1 ? 'menos de 1 hora' : `${hours} horas restantes`}`;
  return `Teste gratuito — ${Math.ceil(hours / 24)} dias restantes`;
}

export function authErrorMessage(error: unknown): string {
  const source = objectValue(error);
  const code = String(source.code || '').trim().toLowerCase();
  if (code in AUTH_ERROR_MESSAGES) return AUTH_ERROR_MESSAGES[code as keyof typeof AUTH_ERROR_MESSAGES];
  const message = String(source.message || '');
  if (/invalid login credentials/i.test(message)) return AUTH_ERROR_MESSAGES.invalid_credentials;
  if (/email not confirmed/i.test(message)) return AUTH_ERROR_MESSAGES.email_not_confirmed;
  return 'Não foi possível entrar. Tente novamente.';
}

export function accountLoadErrorMessage(): string {
  return 'Não foi possível carregar sua conta. Tente novamente.';
}

export type CommercialRpcClient = {
  rpc(name: string): Promise<{ data: unknown; error: unknown }>;
};

export async function beginCommercialSession(client: CommercialRpcClient) {
  if (!client || typeof client.rpc !== 'function') throw new TypeError('Supabase client is required');
  const trial = await client.rpc('start_my_app_trial');
  if (trial.error) throw trial.error;
  const trialRow = Array.isArray(trial.data) ? trial.data[0] : trial.data;
  const trialSource = objectValue(trialRow);
  if (trialSource.result && !includes(TRIAL_RESULTS, trialSource.result)) {
    throw new TypeError('invalid trial result');
  }
  const resolved = await client.rpc('get_my_entitlements');
  if (resolved.error) throw resolved.error;
  const entitlements = normalizeEntitlements(resolved.data);
  return Object.freeze({
    trialResult: trialSource.result || null,
    entitlements,
    experience: resolveExperience(resolved.data),
  });
}

export function hasFinancialAppAccess(entitlements: NormalizedEntitlements | null): boolean {
  return Boolean(entitlements?.app.hasAccess || entitlements?.internalAccess.app);
}
