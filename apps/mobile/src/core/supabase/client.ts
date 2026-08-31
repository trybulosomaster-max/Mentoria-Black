import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { appEnvironment, assertSafeClientEnvironment } from '../config/env';
import { createTransitionalSupabaseAuthStorage } from '../../infrastructure/storage/supabase-auth-storage';
import type { Database } from './database.types';

let singleton: SupabaseClient<Database> | null = null;

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!appEnvironment.configured) return null;
  assertSafeClientEnvironment();

  if (!singleton) {
    const mobileStorage = createTransitionalSupabaseAuthStorage(appEnvironment.name);
    singleton = createClient<Database>(
      appEnvironment.supabaseUrl,
      appEnvironment.supabasePublishableKey,
      {
        auth: {
          storage: mobileStorage,
          storageKey: `aviora-${appEnvironment.name}-auth-v${appEnvironment.schemaVersion}`,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
        },
        global: {
          headers: {
            'x-client-info': 'aviora-mobile/0.1.0',
          },
        },
      },
    );
  }

  return singleton;
}

export function requireSupabaseClient(): SupabaseClient<Database> {
  const client = getSupabaseClient();
  if (!client) throw new Error('O ambiente Supabase Beta ainda não foi configurado.');
  return client;
}
