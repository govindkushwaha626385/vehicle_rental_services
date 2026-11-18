// Rove service worker — network-first for pages, stale-while-revalidate for
// static assets. Registered from src/main.jsx in production builds only.
const CACHE_NAME = 'rove-v2';
const APP_SHELL = '/index.html';
const PRECACHE = [APP_SHELL, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)),
      self.skipWaiting(),
    ])
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    // Cache only the shell, never per-route HTML. A fresh shell always points
    // at the current hashed bundles; offline routing falls back to it.
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(APP_SHELL, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(APP_SHELL);
    return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept cross-origin requests (fonts, images, APIs).
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  // Hashed build assets and local images are safe to cache. Unknown same-origin
  // paths bypass the worker so API-like endpoints are never cached.
  const cacheable =
    url.pathname.startsWith('/assets/') ||
    /\.(?:css|js|mjs|png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname);
  if (cacheable) event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
