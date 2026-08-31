import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { appEnvironment, configurationMessage } from '../config/env';
import { getSupabaseClient } from '../supabase/client';
import {
  authErrorMessage,
  hasFinancialAppAccess,
  normalizeEntitlements,
  type NormalizedEntitlements,
} from '../../domain/access/access-contract';
import { PASSWORD_MESSAGE, passwordIsValid, validateSignup } from '../../features/auth/password-policy';
import { expoAuthDeepLinks } from '../../infrastructure/native/expo-auth-deep-links';
import { reactNativeLifecycle } from '../../infrastructure/native/react-native-lifecycle';
import { createSelfAccessContext } from '../../application/foundation/access-context-factory';
import type { AccessContext } from '../../domain/foundation/access-context';

type AuthPhase =
  | 'booting'
  | 'configuration-required'
  | 'anonymous'
  | 'loading-access'
  | 'granted'
  | 'denied'
  | 'error';

type ActionResult = Readonly<{ ok: true; message?: string }> | Readonly<{ ok: false; message: string }>;

type AuthContextValue = Readonly<{
  phase: AuthPhase;
  session: Session | null;
  user: User | null;
  entitlements: NormalizedEntitlements | null;
  accessContext: AccessContext | null;
  errorMessage: string;
  configurationRequired: boolean;
  financialAccess: boolean;
  signIn(email: string, password: string): Promise<ActionResult>;
  signUp(input: {
    name: string;
    email: string;
    password: string;
    confirmation: string;
    termsAccepted: boolean;
  }): Promise<ActionResult>;
  requestPasswordReset(email: string): Promise<ActionResult>;
  updatePassword(password: string): Promise<ActionResult>;
  exchangeCode(code: string): Promise<ActionResult>;
  refreshEntitlements(): Promise<ActionResult>;
  startTrial(): Promise<ActionResult>;
  signOut(): Promise<void>;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const client = useMemo(() => getSupabaseClient(), []);
  const [phase, setPhase] = useState<AuthPhase>(client ? 'booting' : 'configuration-required');
  const [session, setSession] = useState<Session | null>(null);
  const [entitlements, setEntitlements] = useState<NormalizedEntitlements | null>(null);
  const [errorMessage, setErrorMessage] = useState(client ? '' : configurationMessage());
  const mounted = useRef(true);
  const activeUserId = useRef<string | null>(null);
  const entitlementGeneration = useRef(0);

  const loadEntitlements = useCallback(async (nextSession: Session | null): Promise<ActionResult> => {
    const generation = ++entitlementGeneration.current;
    const expectedUserId = nextSession?.user.id ?? null;
    const requestIsCurrent = () => (
      mounted.current
      && generation === entitlementGeneration.current
      && activeUserId.current === expectedUserId
    );

    if (!client || !nextSession) {
      if (requestIsCurrent()) {
        setEntitlements(null);
        setPhase(client ? 'anonymous' : 'configuration-required');
      }
      return { ok: false, message: client ? 'Entre para continuar.' : configurationMessage() };
    }

    if (requestIsCurrent()) {
      setPhase('loading-access');
      setErrorMessage('');
    }

    const { data, error } = await client.rpc('get_my_entitlements');
    if (!requestIsCurrent()) return { ok: false, message: 'A sessão mudou durante a atualização do acesso.' };

    if (error) {
      setEntitlements(null);
      setErrorMessage('Não foi possível carregar seu acesso. Tente novamente.');
      setPhase('error');
      return { ok: false, message: 'Não foi possível carregar seu acesso. Tente novamente.' };
    }

    try {
      const normalized = normalizeEntitlements(data);
      if (!requestIsCurrent()) return { ok: false, message: 'A sessão mudou durante a atualização do acesso.' };
      setEntitlements(normalized);
      setPhase(hasFinancialAppAccess(normalized) ? 'granted' : 'denied');
      return { ok: true };
    } catch {
      if (requestIsCurrent()) {
        setEntitlements(null);
        setErrorMessage('O servidor retornou um contrato de acesso inválido.');
        setPhase('error');
      }
      return { ok: false, message: 'O servidor retornou um contrato de acesso inválido.' };
    }
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    if (!client) return () => { mounted.current = false; };

    const bootstrap = async () => {
      const { data, error } = await client.auth.getSession();
      if (!mounted.current) return;
      if (error) {
        setErrorMessage('Não foi possível restaurar sua sessão.');
        setPhase('error');
        return;
      }
      activeUserId.current = data.session?.user.id ?? null;
      setSession(data.session);
      await loadEntitlements(data.session);
    };

    void bootstrap();

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted.current) return;
      activeUserId.current = nextSession?.user.id ?? null;
      entitlementGeneration.current += 1;
      setSession(nextSession);
      queueMicrotask(() => { void loadEntitlements(nextSession); });
    });

    const syncAutoRefresh = (state: 'foreground' | 'background') => {
      if (state === 'foreground') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };
    syncAutoRefresh(reactNativeLifecycle.current());
    const removeLifecycleListener = reactNativeLifecycle.subscribe(syncAutoRefresh);

    return () => {
      mounted.current = false;
      listener.subscription.unsubscribe();
      removeLifecycleListener();
      client.auth.stopAutoRefresh();
    };
  }, [client, loadEntitlements]);

  const signIn = useCallback(async (email: string, password: string): Promise<ActionResult> => {
    if (!client) return { ok: false, message: configurationMessage() };
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    return error ? { ok: false, message: authErrorMessage(error) } : { ok: true };
  }, [client]);

  const signUp = useCallback(async (input: {
    name: string;
    email: string;
    password: string;
    confirmation: string;
    termsAccepted: boolean;
  }): Promise<ActionResult> => {
    if (!client) return { ok: false, message: configurationMessage() };
    if (!appEnvironment.enableSignup) return { ok: false, message: 'Novos cadastros estão temporariamente indisponíveis.' };
    const validation = validateSignup(input);
    if (!validation.ok) return { ok: false, message: validation.message };

    const emailRedirectTo = expoAuthDeepLinks.callback();
    const { data, error } = await client.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: { full_name: input.name.trim() },
        emailRedirectTo,
      },
    });
    if (error) return { ok: false, message: error.message || 'Não foi possível criar sua conta.' };
    if (!data.session) return { ok: true, message: 'Conta criada. Confirme o e-mail para entrar.' };
    return { ok: true, message: 'Conta criada com sucesso.' };
  }, [client]);

  const requestPasswordReset = useCallback(async (email: string): Promise<ActionResult> => {
    if (!client) return { ok: false, message: configurationMessage() };
    const redirectTo = expoAuthDeepLinks.passwordRecovery();
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    return error
      ? { ok: false, message: 'Não foi possível enviar o link de recuperação.' }
      : { ok: true, message: 'Enviamos as instruções de recuperação para seu e-mail.' };
  }, [client]);

  const updatePassword = useCallback(async (password: string): Promise<ActionResult> => {
    if (!client) return { ok: false, message: configurationMessage() };
    if (!passwordIsValid(password)) return { ok: false, message: PASSWORD_MESSAGE };
    const { error } = await client.auth.updateUser({ password });
    return error
      ? { ok: false, message: 'Não foi possível atualizar a senha.' }
      : { ok: true, message: 'Senha atualizada com sucesso.' };
  }, [client]);

  const exchangeCode = useCallback(async (code: string): Promise<ActionResult> => {
    if (!client) return { ok: false, message: configurationMessage() };
    const { error } = await client.auth.exchangeCodeForSession(code);
    return error
      ? { ok: false, message: 'Este link é inválido ou expirou.' }
      : { ok: true };
  }, [client]);

  const refreshEntitlements = useCallback(async () => loadEntitlements(session), [loadEntitlements, session]);

  const startTrial = useCallback(async (): Promise<ActionResult> => {
    if (!client) return { ok: false, message: configurationMessage() };
    if (!appEnvironment.enableTrialStart) {
      return { ok: false, message: 'A ativação do teste está desabilitada nesta versão.' };
    }
    const { error } = await client.rpc('start_my_app_trial');
    if (error) return { ok: false, message: 'Não foi possível ativar o teste gratuito.' };
    return loadEntitlements(session);
  }, [client, loadEntitlements, session]);

  const signOut = useCallback(async () => {
    activeUserId.current = null;
    entitlementGeneration.current += 1;
    setEntitlements(null);
    setSession(null);
    setErrorMessage('');
    if (client) await client.auth.signOut({ scope: 'local' });
    setPhase(client ? 'anonymous' : 'configuration-required');
  }, [client]);

  const accessContext = useMemo(() => {
    if (!session || !entitlements || phase !== 'granted') return null;
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
    const expiresAt = Number(session.expires_at) * 1000;
    if (!Number.isFinite(expiresAt)) return null;
    return createSelfAccessContext({
      userId: session.user.id,
      sessionExpiresAt: new Date(expiresAt).toISOString(),
      entitlements,
      environment: appEnvironment.name,
      platform: Platform.OS,
      appVersion: appEnvironment.appVersion,
      generation: Math.max(1, entitlementGeneration.current),
    });
  }, [entitlements, phase, session]);

  const value = useMemo<AuthContextValue>(() => ({
    phase,
    session,
    user: session?.user ?? null,
    entitlements,
    accessContext,
    errorMessage,
    configurationRequired: !client,
    financialAccess: hasFinancialAppAccess(entitlements),
    signIn,
    signUp,
    requestPasswordReset,
    updatePassword,
    exchangeCode,
    refreshEntitlements,
    startTrial,
    signOut,
  }), [
    accessContext,
    client,
    entitlements,
    errorMessage,
    exchangeCode,
    phase,
    refreshEntitlements,
    requestPasswordReset,
    session,
    signIn,
    signOut,
    signUp,
    startTrial,
    updatePassword,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return value;
}
