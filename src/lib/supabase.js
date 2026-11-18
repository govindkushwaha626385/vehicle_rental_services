import { createClient } from '@supabase/supabase-js';
import {
  isSupabaseConfigured,
  supabaseAnonKey,
  supabaseUrl,
} from './config.js';

export * from './config.js';

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
