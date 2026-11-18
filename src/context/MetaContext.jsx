import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { VEHICLE_TYPES } from '../lib/constants.js';

const FALLBACK = {
  types: VEHICLE_TYPES,
  locations: [],
  extras: [],
  insuranceTiers: [],
  settings: {},
  currency: 'INR',
};

const MetaContext = createContext(null);

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getMeta();
      setMeta({ ...FALLBACK, ...next });
      setError(null);
    } catch (nextError) {
      console.error('Could not load catalogue meta', nextError);
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({ meta, loading, error, refresh }), [meta, loading, error, refresh]);
  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

export function useMeta() {
  const context = useContext(MetaContext);
  if (!context) throw new Error('useMeta must be used inside MetaProvider');
  return context;
}
