import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, LockKeyhole } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { getSiteContent } from '../lib/site.js';

export default function ResetPassword() {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const { signOut, isDemo } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) {
      setError(content.auth_reset_error_length);
      return;
    }
    if (password !== confirm) {
      setError(content.auth_reset_error_mismatch);
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.updatePassword(password);
      await signOut();
      push(content.auth_reset_success, 'success');
      navigate('/login', { replace: true });
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow={content.auth_reset_eyebrow}
      title={content.auth_reset_title}
      subtitle={content.auth_reset_subtitle}
      footer={<Link to="/login" className="font-extrabold text-ink hover:underline">{content.auth_back_to_signin}</Link>}
    >
      <form onSubmit={submit} noValidate className="space-y-3.5">
        <div>
          <label className="label" htmlFor="reset-password">{content.auth_new_password}</label>
          <div className="input-group">
            <LockKeyhole className="input-icon h-4 w-4" />
            <input id="reset-password" type="password" autoComplete="new-password" required value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }} placeholder={content.auth_new_password_placeholder} className="field" aria-invalid={Boolean(error)} aria-describedby={error ? 'reset-error' : undefined} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="reset-confirm">{content.auth_confirm_new_password}</label>
          <div className="input-group">
            <LockKeyhole className="input-icon h-4 w-4" />
            <input id="reset-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(event) => { setConfirm(event.target.value); if (error) setError(''); }} placeholder={content.auth_confirm_placeholder} className="field" aria-invalid={Boolean(error)} aria-describedby={error ? 'reset-error' : undefined} />
          </div>
        </div>

        {error && (
          <p id="reset-error" role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[0.72rem] font-semibold text-rose-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn btn-lime btn-lg w-full">
          {loading ? <><Spinner className="h-4 w-4" /> {content.auth_updating}</> : <>{content.auth_update_password} <ArrowRight className="h-4 w-4" /></>}
        </button>

        {isDemo && (
          <p className="rounded-xl border border-dashed border-lime-deep bg-lime/15 px-3 py-2 text-[0.62rem] leading-4 text-ink/65">
            {content.auth_reset_demo_password_note}
          </p>
        )}
      </form>
    </AuthShell>
  );
}
