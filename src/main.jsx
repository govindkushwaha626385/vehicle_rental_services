import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { loadApi } from './lib/api.js';
import { AuthProvider } from './context/AuthContext.jsx';
import { MetaProvider } from './context/MetaContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';

const container = document.getElementById('root');
const root = createRoot(container);

// Render a lightweight shell while the selected backend adapter downloads.
// In production that is only the Supabase chunk; in demo mode only fixtures.
root.render(
  <div className="flex min-h-screen items-center justify-center bg-cream text-sm font-semibold text-muted">
    Loading Rove…
  </div>
);

loadApi()
  .then(() => {
    root.render(
      <StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <MetaProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </MetaProvider>
          </AuthProvider>
        </BrowserRouter>
      </StrictMode>
    );
  })
  .catch((error) => {
    console.error('Could not load the Rove API adapter', error);
    root.render(
      <div className="flex min-h-screen items-center justify-center bg-cream px-6">
        <div className="max-w-md rounded-3xl border border-line bg-white p-8 text-center shadow-card">
          <h1 className="display text-3xl">Rove could not start.</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            The app could not load its data layer. Check your connection and reload the page.
          </p>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-dark mt-6">
            Reload page
          </button>
        </div>
      </div>
    );
  });

// Production-only service worker registration: network-first pages with an
// offline app-shell fallback, stale-while-revalidate for static assets.
// Never runs in `vite dev`.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((error) => console.error('Service worker registration failed', error));
  });
}
