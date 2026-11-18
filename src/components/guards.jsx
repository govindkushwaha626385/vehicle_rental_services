import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { PageLoader } from './ui.jsx';

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Checking your session…" />;
  if (!user) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  return children;
}

export function RequireStaff({ children }) {
  const { user, loading, isStaff } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Opening the console…" />;
  if (!user) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  if (!isStaff) return <Navigate to="/account" replace />;
  return children;
}

export function RequireAdmin({ children }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Opening the console…" />;
  if (!user) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  if (!isAdmin) return <Navigate to="/admin" replace />;
  return children;
}
