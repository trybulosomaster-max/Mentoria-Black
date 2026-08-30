type EnvironmentName = 'local' | 'development' | 'preview' | 'production';

function clean(value: string | undefined): string {
  return String(value ?? '').trim();
}

function flag(value: string | undefined, fallback: boolean): boolean {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function environment(value: string | undefined): EnvironmentName {
  const normalized = clean(value).toLowerCase();
  return ['local', 'development', 'preview', 'production'].includes(normalized)
    ? normalized as EnvironmentName
    : 'local';
}

const supabaseUrl = clean(process.env.EXPO_PUBLIC_SUPABASE_URL);
const supabasePublishableKey = clean(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export const appEnvironment = Object.freeze({
  name: environment(process.env.EXPO_PUBLIC_AVIORA_ENV),
  supabaseUrl,
  supabasePublishableKey,
  readOnly: flag(process.env.EXPO_PUBLIC_AVIORA_READ_ONLY, true),
  enableSignup: flag(process.env.EXPO_PUBLIC_AVIORA_ENABLE_SIGNUP, true),
  enableTrialStart: flag(process.env.EXPO_PUBLIC_AVIORA_ENABLE_TRIAL_START, false),
  configured: Boolean(supabaseUrl && supabasePublishableKey),
});

export function assertSafeClientEnvironment(): void {
  const key = appEnvironment.supabasePublishableKey.toLowerCase();
  if (key.includes('service_role') || key.startsWith('sb_secret_')) {
    throw new Error('Uma chave secreta do Supabase nunca pode ser usada no aplicativo móvel.');
  }

  if (appEnvironment.supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(appEnvironment.supabaseUrl)) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL não possui o formato esperado.');
  }

  if (appEnvironment.name !== 'production' && appEnvironment.readOnly !== true) {
    throw new Error('Ambientes de fundação devem permanecer em modo financeiro somente leitura.');
  }
}

export function configurationMessage(): string {
  if (appEnvironment.configured) return '';
  return 'Configure a URL e a chave publicável do Supabase Beta em .env.local.';
}
