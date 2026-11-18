import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Mail, MailCheck } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { getSiteContent } from '../lib/site.js';

export default function ForgotPassword() {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const { isDemo } = useAuth();
  const { push } = useToast();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.sendPasswordReset(email.trim());
      setMessage(result.message);
      push(content.auth_reset_sent, 'success');
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow={content.auth_forgot_eyebrow}
      title={content.auth_forgot_title}
      subtitle={content.auth_forgot_subtitle}
      footer={<Link to="/login" className="inline-flex items-center gap-1.5 font-extrabold text-ink hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> {content.auth_back_to_signin}</Link>}
    >
      {message ? (
        <div className="rounded-3xl border border-line bg-white p-7 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-lime text-ink"><MailCheck className="h-6 w-6" /></span>
          <p className="mt-4 text-sm font-extrabold">{content.auth_check_inbox}</p>
          <p className="mt-2 text-xs leading-6 text-muted">{message}</p>
          <div className="mt-5 flex gap-2">
            <button type="button" onClick={() => { setMessage(''); setEmail(''); }} className="btn btn-outline flex-1">{content.auth_try_another}</button>
            <Link to="/login" className="btn btn-dark flex-1">{content.auth_signin_cta}</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3.5">
          <div>
            <label className="label" htmlFor="forgot-email">{content.auth_email_label}</label>
            <div className="input-group">
              <Mail className="input-icon h-4 w-4" />
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }}
                placeholder={content.auth_email_placeholder}
                className="field"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'forgot-error' : undefined}
              />
            </div>
          </div>

          {error && <p id="forgot-error" role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[0.72rem] font-semibold text-rose-800">{error}</p>}

          <button type="submit" disabled={loading} className="btn btn-lime btn-lg w-full">
            {loading ? <><Spinner className="h-4 w-4" /> {content.auth_sending}</> : <>{content.auth_send_reset} <ArrowRight className="h-4 w-4" /></>}
          </button>

          {isDemo && (
            <p className="rounded-xl border border-dashed border-lime-deep bg-lime/15 px-3 py-2 text-[0.62rem] leading-4 text-ink/65">
              {content.auth_reset_demo_note}
            </p>
          )}
        </form>
      )}
    </AuthShell>
  );
}
