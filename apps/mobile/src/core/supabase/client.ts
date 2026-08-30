import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { appEnvironment, assertSafeClientEnvironment } from '../config/env';
import type { Database } from './database.types';

let singleton: SupabaseClient<Database> | null = null;

const mobileStorage = {
  getItem: (key: string) => globalThis.localStorage.getItem(key),
  setItem: (key: string, value: string) => globalThis.localStorage.setItem(key, value),
  removeItem: (key: string) => globalThis.localStorage.removeItem(key),
};

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!appEnvironment.configured) return null;
  assertSafeClientEnvironment();

  if (!singleton) {
    singleton = createClient<Database>(
      appEnvironment.supabaseUrl,
      appEnvironment.supabasePublishableKey,
      {
        auth: {
          storage: mobileStorage,
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
