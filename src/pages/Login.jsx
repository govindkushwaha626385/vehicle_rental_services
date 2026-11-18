import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { getSiteContent } from '../lib/site.js';
import { loadDemoAccounts } from 'virtual:rove-api';

export default function Login() {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const { signIn, isDemo } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedRedirect = params.get('redirect') || '';
  const redirect = requestedRedirect.startsWith('/')
    && !requestedRedirect.startsWith('//')
    && !requestedRedirect.includes('\\')
    ? requestedRedirect
    : '';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [quickLoading, setQuickLoading] = useState('');
  const [demoAccounts, setDemoAccounts] = useState([]);

  useEffect(() => {
    if (!isDemo) {
      setDemoAccounts([]);
      return undefined;
    }
    let active = true;
    loadDemoAccounts()
      .then((accounts) => {
        if (active) setDemoAccounts(accounts);
      })
      .catch(() => {
        if (active) setDemoAccounts([]);
      });
    return () => {
      active = false;
    };
  }, [isDemo]);

  const destination = (nextUser) => {
    if (redirect) return redirect;
    if (nextUser && ['manager', 'admin'].includes(nextUser.role)) return '/admin';
    return '/account';
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const nextUser = await signIn(email.trim(), password);
      push(`${content.auth_welcome_back}${nextUser?.name ? `, ${nextUser.name.split(' ')[0]}` : ''}.`, 'success');
      navigate(destination(nextUser), { replace: true });
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (account) => {
    setError('');
    setQuickLoading(account.email);
    setEmail(account.email);
    setPassword(account.password);
    try {
      const nextUser = await signIn(account.email, account.password);
      push(`${content.auth_signed_in_as} ${nextUser?.name || account.role}.`, 'success');
      navigate(destination(nextUser), { replace: true });
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setQuickLoading('');
    }
  };

  return (
    <AuthShell
      eyebrow={content.auth_login_eyebrow}
      title={content.auth_login_title}
      subtitle={content.auth_login_subtitle}
      footer={(
        <>
          {content.auth_new_prefix}{' '}
          <Link to={`/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="font-extrabold text-ink underline decoration-lime decoration-2 underline-offset-4">
            {content.auth_create_account}
          </Link>
        </>
      )}
    >
      <form onSubmit={submit} noValidate className="space-y-3.5">
        <div>
          <label className="label" htmlFor="login-email">{content.auth_email_label}</label>
          <div className="input-group">
            <Mail className="input-icon h-4 w-4" />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }}
              placeholder={content.auth_email_placeholder}
              className="field"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="login-password">{content.auth_password_label}</label>
            <Link to="/forgot-password" className="mb-1.5 text-[0.65rem] font-bold text-forest hover:underline">{content.auth_forgot_password}</Link>
          </div>
          <div className="input-group">
            <LockKeyhole className="input-icon h-4 w-4" />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }}
              placeholder={content.auth_password_placeholder}
              className="field pr-11"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted transition hover:text-ink"
              aria-label={showPassword ? content.auth_hide_password : content.auth_show_password}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p id="login-error" role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[0.72rem] font-semibold text-rose-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        <button type="submit" disabled={loading || Boolean(quickLoading)} className="btn btn-lime btn-lg w-full">
          {loading ? <><Spinner className="h-4 w-4" /> {content.auth_signing_in}</> : <>{content.auth_signin_cta} <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-[0.62rem] text-muted">
        <ShieldCheck className="h-3.5 w-3.5" /> {content.auth_protected}
      </p>

      {isDemo && demoAccounts.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-dashed border-lime-deep/40 bg-gradient-to-br from-lime/20 via-cream to-aqua/10 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.12em]">{content.auth_demo_accounts}</p>
            <span className="rounded-full bg-ink px-2 py-0.5 text-[0.52rem] font-extrabold uppercase tracking-wider text-lime">{content.auth_demo_one_click}</span>
          </div>
          <p className="mt-1 text-[0.65rem] leading-5 text-ink/60">{content.auth_demo_copy}</p>
          <div className="mt-3 grid gap-1.5">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => quickLogin(account)}
                disabled={Boolean(quickLoading)}
                className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2 text-left transition duration-300 hover:-translate-y-0.5 hover:border-ink hover:shadow-soft disabled:opacity-60"
              >
                <span>
                  <span className="block text-[0.7rem] font-extrabold">{account.role}</span>
                  <span className="block text-[0.6rem] text-muted">{account.email}</span>
                </span>
                {quickLoading === account.email ? <Spinner className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5 text-muted transition group-hover:translate-x-0.5 group-hover:text-ink" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  );
}
