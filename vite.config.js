import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Pick exactly one backend adapter while the bundle is built. The selected
// adapter is still a dynamic import, so it keeps its own chunk; the other
// adapter (and the demo fixtures) never reaches a production bundle.
function apiAdapterPlugin(isDemo) {
  const virtualId = 'virtual:rove-api';
  const resolvedId = `\0${virtualId}`;
  return {
    name: 'rove-api-adapter',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
      return undefined;
    },
    load(id) {
      if (id !== resolvedId) return undefined;
      return isDemo
        ? "export const loadAdapter = () => import('/src/demo/api.js').then((module) => module.demoApi);\nexport const loadDemoAccounts = () => import('/src/demo/data.js').then((module) => module.demoAccounts);\n"
        : "export const loadAdapter = () => import('/src/lib/supabaseApi.js').then((module) => module.supabaseApi);\nexport const loadDemoAccounts = async () => [];\n";
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isDemo =
    String(env.VITE_ENABLE_DEMO ?? '').toLowerCase() === 'true' ||
    !env.VITE_SUPABASE_URL ||
    !env.VITE_SUPABASE_ANON_KEY;

  return {
    plugins: [react(), tailwindcss(), apiAdapterPlugin(isDemo)],
    server: {
      port: 5173,
      host: true,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: isDemo
            ? { react: ['react', 'react-dom', 'react-router-dom'] }
            : {
                react: ['react', 'react-dom', 'react-router-dom'],
                supabase: ['@supabase/supabase-js'],
              },
        },
      },
    },
  };
});
