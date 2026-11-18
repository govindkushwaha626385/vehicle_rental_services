// Environment flags live in their own tiny module so demo builds never import
// the Supabase client just to answer "are we in demo mode?".
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseUrl = url;
export const supabaseAnonKey = anonKey;

export const isSupabaseConfigured = Boolean(
  url && anonKey && /^https?:\/\//.test(url) && !url.includes('your-project')
);

export const forceDemo = String(import.meta.env.VITE_ENABLE_DEMO ?? '').toLowerCase() === 'true';
export const isDemo = forceDemo || !isSupabaseConfigured;

export const functionUrl = (name) => `${url}/functions/v1/${name}`;
