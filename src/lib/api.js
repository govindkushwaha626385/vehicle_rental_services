import { isDemo } from './config.js';
import { loadAdapter } from 'virtual:rove-api';

// The adapter is loaded before React mounts, so pages can keep importing a
// stable `api` binding. Vite's apiAdapterPlugin bakes exactly one adapter into
// the build, which keeps demo fixtures out of production bundles.
let api = null;
let loading = null;

export function loadApi() {
  if (api) return Promise.resolve(api);
  if (!loading) {
    loading = loadAdapter().then((adapter) => {
      api = adapter;
      return api;
    });
  }
  return loading;
}

export { api, isDemo };
