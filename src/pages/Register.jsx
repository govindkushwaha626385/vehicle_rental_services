import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, MailCheck, LockKeyhole, Mail, Phone, User } from 'lucide-react';
import AuthShell from '../components/AuthShell.jsx';
import { Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { cn } from '../lib/format.js';
import { isEmail, phoneProblem } from '../lib/validation.js';
import { sitePolicy, getSiteContent } from '../lib/site.js';

export default function Register() {
  const { signUp, isDemo } = useAuth();
  const { meta } = useMeta();
  const { push } = useToast();
  const policy = sitePolicy(meta.settings);
  const content = getSiteContent(meta.settings);
  const termsSuffix = content.auth_terms_agreement_suffix.replaceAll('{age}', String(policy.minAge));
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedRedirect = params.get('redirect') || '';
  const redirect = requestedRedirect.startsWith('/')
    && !requestedRedirect.startsWith('//')
    && !requestedRedirect.includes('\\')
    ? requestedRedirect
    : '';

  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState('');
  const [loading, setLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  // Scope `aria-invalid`/`aria-describedby` to the field the error belongs to,
  // so assistive tech does not announce "invalid" on fields that are fine.
  const fieldAria = (field) => (errorField === field
    ? { 'aria-invalid': true, 'aria-describedby': 'reg-error' }
    : {});

  const strength = useMemo(() => {
    const password = form.password;
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return Math.min(4, score);
  }, [form.password]);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
    setErrorField('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (form.name.trim().length < 2) {
      setError(content.auth_error_name);
      setErrorField('name');
      return;
    }
    if (!isEmail(form.email)) {
      setError(content.auth_error_email);
      setErrorField('email');
      return;
    }
    const phoneError = phoneProblem(form.phone);
    if (phoneError) {
      setError(phoneError);
      setErrorField('phone');
      return;
    }
    if (form.password.length < 8) {
      setError(content.auth_error_password_length);
      setErrorField('password');
      return;
    }
    if (form.password !== form.confirm) {
      setError(content.auth_error_password_mismatch);
      setErrorField('confirm');
      return;
    }
    if (!agreed) {
      setError(content.auth_error_terms);
      setErrorField('terms');
      return;
    }

    setLoading(true);
    setError('');
    setErrorField('');
    try {
      const result = await signUp({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
      });
      if (result?.needsConfirmation) {
        setNeedsConfirmation(true);
        return;
      }
      push(content.auth_account_created, 'success');
      navigate(redirect || '/account', { replace: true });
    } catch (nextError) {
      setError(nextError.message);
      setErrorField('form');
    } finally {
      setLoading(false);
    }
  };

  if (needsConfirmation) {
    return (
      <AuthShell
        eyebrow={content.auth_confirm_eyebrow}
        title={content.auth_confirm_title}
        subtitle={`${content.auth_confirm_subtitle} ${content.auth_confirm_sent_to.replaceAll('{email}', form.email)}`}
        footer={<>{content.auth_wrong_email} <button type="button" onClick={() => setNeedsConfirmation(false)} className="font-extrabold text-ink underline decoration-lime decoration-2 underline-offset-4">{content.auth_go_back}</button></>}
      >
        <div className="rounded-3xl border border-line bg-white p-7 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-lime text-ink"><MailCheck className="h-6 w-6" /></span>
          <p className="mt-4 text-sm font-extrabold">{content.auth_confirm_email_sent}</p>
          <p className="mt-2 text-xs leading-6 text-muted">{content.auth_confirm_expiry_copy}</p>
          <Link to="/login" className="btn btn-dark mt-5 w-full">{content.auth_go_sign_in} <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={`${content.auth_join_prefix} ${content.site_name}`}
      title={content.auth_register_title}
      subtitle={content.auth_register_subtitle}
      footer={(
        <>
          {content.auth_have_account}{' '}
          <Link to={`/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="font-extrabold text-ink underline decoration-lime decoration-2 underline-offset-4">
            {content.auth_signin_cta}
          </Link>
        </>
      )}
    >
      <form onSubmit={submit} noValidate className="space-y-3.5">
        <div>
          <label className="label" htmlFor="reg-name">{content.auth_full_name}</label>
          <div className="input-group">
            <User className="input-icon h-4 w-4" />
            <input id="reg-name" autoComplete="name" required value={form.name} onChange={(event) => set('name', event.target.value)} placeholder={content.auth_name_placeholder} className="field" {...fieldAria('name')} />
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="reg-email">{content.auth_email_short}</label>
            <div className="input-group">
              <Mail className="input-icon h-4 w-4" />
              <input id="reg-email" type="email" autoComplete="email" required value={form.email} onChange={(event) => set('email', event.target.value)} placeholder={content.auth_email_placeholder} className="field" {...fieldAria('email')} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="reg-phone">{content.auth_phone} <span className="font-medium normal-case tracking-normal text-muted">{content.auth_optional}</span></label>
            <div className="input-group">
              <Phone className="input-icon h-4 w-4" />
              <input id="reg-phone" type="tel" autoComplete="tel" value={form.phone} onChange={(event) => set('phone', event.target.value)} placeholder={content.auth_phone_placeholder} className="field" {...fieldAria('phone')} />
            </div>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="reg-password">{content.auth_password_label}</label>
          <div className="input-group">
            <LockKeyhole className="input-icon h-4 w-4" />
            <input
              id="reg-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={form.password}
              onChange={(event) => set('password', event.target.value)}
              placeholder={content.auth_new_password_placeholder}
              className="field pr-11"
              {...fieldAria('password')}
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
          {form.password && (
            <div className="mt-2 flex items-center gap-1.5">
              {[1, 2, 3, 4].map((bar) => (
                <span key={bar} className={cn('h-1 flex-1 rounded-full', strength >= bar ? (strength >= 3 ? 'bg-forest' : 'bg-amber-400') : 'bg-stone-200')} />
              ))}
              <span className="ml-1 text-[0.58rem] font-bold text-muted">{[content.auth_password_weak, content.auth_password_fair, content.auth_password_good, content.auth_password_strong][Math.max(0, strength - 1)] || content.auth_password_weak}</span>
            </div>
          )}
        </div>

        <div>
          <label className="label" htmlFor="reg-confirm">{content.auth_confirm_password}</label>
          <div className="input-group">
            <Check className="input-icon h-4 w-4" />
            <input id="reg-confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={(event) => set('confirm', event.target.value)} placeholder={content.auth_confirm_placeholder} className="field" {...fieldAria('confirm')} />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-paper p-3">
          <input type="checkbox" checked={agreed} onChange={(event) => { setAgreed(event.target.checked); setError(''); setErrorField(''); }} className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-ink" {...fieldAria('terms')} />
          <span className="text-[0.68rem] leading-5 text-ink/70">
            {content.auth_terms_agreement_prefix} {content.site_name}’s <Link to="/terms" target="_blank" className="font-bold underline underline-offset-2">{content.auth_terms_of_service}</Link> {content.auth_terms_agreement_middle} <Link to="/privacy" target="_blank" className="font-bold underline underline-offset-2">{content.auth_privacy_policy}</Link>. {termsSuffix}
          </span>
        </label>

        {error && (
          <p id="reg-error" role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[0.72rem] font-semibold text-rose-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn btn-lime btn-lg w-full">
          {loading ? <><Spinner className="h-4 w-4" /> {content.auth_creating}</> : <>{content.auth_create_cta} <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>

      {isDemo && (
        <p className="mt-4 rounded-xl border border-dashed border-lime-deep bg-lime/15 px-3 py-2 text-[0.62rem] leading-4 text-ink/65">
          {content.auth_demo_register_note}
        </p>
      )}
    </AuthShell>
  );
}
