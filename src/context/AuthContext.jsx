import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, isDemo } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await api.getSession();
      setUser(result?.user ?? null);
    } catch (error) {
      console.error('Session refresh failed', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = api.onAuthStateChange(refresh);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [refresh]);

  const signIn = useCallback(async (email, password) => {
    const next = await api.signIn(email, password);
    await refresh();
    return next;
  }, [refresh]);

  const signUp = useCallback(async (payload) => {
    const result = await api.signUp(payload);
    if (result?.user) await refresh();
    return result;
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.signOut();
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const next = await api.updateProfile(patch);
    await refresh();
    return next;
  }, [refresh]);

  const value = useMemo(() => ({
    user,
    loading,
    isDemo,
    isStaff: Boolean(user && ['manager', 'admin'].includes(user.role) && user.status === 'active'),
    isAdmin: Boolean(user && user.role === 'admin' && user.status === 'active'),
    signIn,
    signUp,
    signOut,
    updateProfile,
    refresh,
  }), [user, loading, signIn, signUp, signOut, updateProfile, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
