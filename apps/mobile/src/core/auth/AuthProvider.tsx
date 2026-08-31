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
import {
  resolveBootstrapState,
  type BootstrapSignal,
  type BootstrapState,
} from '../../domain/bootstrap/app-bootstrap';
import {
  bindValueToIdentity,
  valueForActiveIdentity,
  type IdentityBoundValue,
} from '../../domain/foundation/identity-bound-value';

type AuthPhase = BootstrapSignal;

type ActionResult = Readonly<{ ok: true; message?: string }> | Readonly<{ ok: false; message: string }>;

type AuthContextValue = Readonly<{
  phase: AuthPhase;
  bootstrapState: BootstrapState;
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
  retryBootstrap(): Promise<ActionResult>;
  startTrial(): Promise<ActionResult>;
  signOut(): Promise<void>;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const client = useMemo(() => getSupabaseClient(), []);
  const [phase, setPhase] = useState<AuthPhase>(client ? 'booting' : 'configuration-required');
  const [session, setSession] = useState<Session | null>(null);
  const [boundEntitlements, setBoundEntitlements] = useState<IdentityBoundValue<NormalizedEntitlements> | null>(null);
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
        setBoundEntitlements(null);
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
      setBoundEntitlements(null);
      setErrorMessage('Não foi possível carregar seu acesso. Tente novamente.');
      setPhase('error');
      return { ok: false, message: 'Não foi possível carregar seu acesso. Tente novamente.' };
    }

    try {
      const normalized = normalizeEntitlements(data);
      if (!requestIsCurrent()) return { ok: false, message: 'A sessão mudou durante a atualização do acesso.' };
      setBoundEntitlements(bindValueToIdentity(expectedUserId!, normalized));
      setPhase(hasFinancialAppAccess(normalized) ? 'granted' : 'denied');
      return { ok: true };
    } catch {
      if (requestIsCurrent()) {
        setBoundEntitlements(null);
        setErrorMessage('O servidor retornou um contrato de acesso inválido.');
        setPhase('error');
      }
      return { ok: false, message: 'O servidor retornou um contrato de acesso inválido.' };
    }
  }, [client]);

  const restoreSession = useCallback(async (): Promise<ActionResult> => {
    if (!client) {
      setPhase('configuration-required');
      setErrorMessage(configurationMessage());
      return { ok: false, message: configurationMessage() };
    }

    const restoreGeneration = ++entitlementGeneration.current;
    activeUserId.current = null;
    const restoreIsCurrent = () => (
      mounted.current && restoreGeneration === entitlementGeneration.current
    );
    setPhase('booting');
    setBoundEntitlements(null);
    setErrorMessage('');
    const { data, error } = await client.auth.getSession();
    if (!restoreIsCurrent()) return { ok: false, message: 'A inicialização foi interrompida.' };
    if (error) {
      activeUserId.current = null;
      setSession(null);
      setErrorMessage('Não foi possível restaurar sua sessão. Verifique sua conexão e tente novamente.');
      setPhase('error');
      return { ok: false, message: 'Não foi possível restaurar sua sessão.' };
    }

    activeUserId.current = data.session?.user.id ?? null;
    setSession(data.session);
    return loadEntitlements(data.session);
  }, [client, loadEntitlements]);

  useEffect(() => {
    mounted.current = true;
    if (!client) return () => { mounted.current = false; };

    void restoreSession();

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted.current) return;
      activeUserId.current = nextSession?.user.id ?? null;
      entitlementGeneration.current += 1;
      setBoundEntitlements(null);
      setPhase(nextSession ? 'loading-access' : 'anonymous');
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
  }, [client, loadEntitlements, restoreSession]);

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
    if (error) return { ok: false, message: 'Não foi possível criar sua conta. Revise os dados e tente novamente.' };
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
  const retryBootstrap = useCallback(async () => (
    session ? loadEntitlements(session) : restoreSession()
  ), [loadEntitlements, restoreSession, session]);

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
    setBoundEntitlements(null);
    setSession(null);
    setErrorMessage('');
    if (client) await client.auth.signOut({ scope: 'local' });
    setPhase(client ? 'anonymous' : 'configuration-required');
  }, [client]);

  const entitlements = valueForActiveIdentity(boundEntitlements, session?.user.id ?? null);
  const effectivePhase: AuthPhase = session
    && !entitlements
    && (phase === 'granted' || phase === 'denied')
    ? 'loading-access'
    : phase;

  const accessContext = useMemo(() => {
    if (!session || !entitlements || effectivePhase !== 'granted') return null;
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
  }, [effectivePhase, entitlements, session]);

  const value = useMemo<AuthContextValue>(() => ({
    phase: effectivePhase,
    bootstrapState: resolveBootstrapState(effectivePhase),
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
    retryBootstrap,
    startTrial,
    signOut,
  }), [
    accessContext,
    client,
    entitlements,
    errorMessage,
    exchangeCode,
    effectivePhase,
    refreshEntitlements,
    retryBootstrap,
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
