import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, AlertTriangle, Clock, Mail, MapPin, MessageCircle, Phone, Send, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { getSiteContent, emphasize, fillCopy } from '../lib/site.js';
import { isEmail, phoneProblem } from '../lib/validation.js';
import { CONTACT_SUBJECT_LABELS, CONTACT_SUBJECTS } from '../lib/constants.js';

export default function Contact() {
  const { meta } = useMeta();
  const { user } = useAuth();
  const { push } = useToast();
  const [params] = useSearchParams();
  const content = getSiteContent(meta.settings);
  const hubCount = meta.locations.length;
  const fill = (value) => fillCopy(value, content, hubCount);
  const bookingParam = String(params.get('booking') || '').trim().toUpperCase();
  const messageParam = String(params.get('message') || '').slice(0, 300);
  const linkedBookingCode = bookingParam.slice(0, 16);

  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: '',
    subject: linkedBookingCode ? 'Booking & payment' : '',
    message: [linkedBookingCode ? `Need help with booking ${linkedBookingCode}: ` : '', messageParam].join('').trim(),
    bookingCode: linkedBookingCode,
  });
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);

  const set = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const validate = () => {
    const next = {};
    if (form.name.trim().length < 2) next.name = content.contact_error_name;
    if (!isEmail(form.email)) next.email = content.contact_error_email;
    const phoneError = phoneProblem(form.phone);
    if (phoneError) next.phone = phoneError;
    if (form.message.trim().length < 10) next.message = content.contact_error_message;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    setSending(true);
    try {
      if (api.submitContact) {
        await api.submitContact({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          message: form.message.trim(),
          bookingCode: form.bookingCode,
          subject: form.subject || 'General',
        });
      }
      push(content.contact_success, 'success');
      setForm({ name: '', email: '', phone: '', subject: '', message: '', bookingCode: '' });
    } catch (error) {
      push(error.message || content.contact_error_send, 'error');
    } finally {
      setSending(false);
    }
  };

  const whatsapp = String(content.whatsapp_number || '');
  const email = content.support_email;
  const phone = content.support_phone;

  return (
    <div>
      {/* Hero ------------------------------------------------------------------ */}
      <section className="no-print relative overflow-hidden border-b border-line bg-cream">
        <div className="absolute -left-24 top-8 h-80 w-80 rounded-full bg-lime/15 blur-3xl" />
        <div className="absolute -right-20 top-16 h-72 w-72 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-coral/10 blur-[90px]" />
        <div className="container-x relative py-14 sm:py-20">
          <p className="eyebrow">{content.contact_eyebrow}</p>
          <h1 className="display mt-4 text-5xl leading-[1.02] tracking-tight sm:text-6xl">
            {emphasize(content.contact_title).map((part, index) => (
              part.italic
                ? <span key={index} className="italic text-forest">{part.text}</span>
                : <span key={index}>{part.text}</span>
            ))}
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-muted sm:text-[0.98rem]">
            {content.contact_description}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-[0.62rem] font-bold text-muted">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/20 bg-ok/10 px-2.5 py-1 text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> {content.support_hours}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-2.5 py-1"><Clock className="h-3 w-3 text-moss" /> {content.contact_reply_badge}</span>
          </div>
        </div>
      </section>

      <div className="container-x grid gap-10 py-12 lg:grid-cols-[1.2fr_1fr] sm:py-16">
        {/* Form ----------------------------------------------------------------- */}
        <section className="gradient-border rounded-3xl p-5 shadow-card sm:p-7">
          <h2 className="text-lg font-extrabold tracking-tight">{content.contact_form_title}</h2>
          <p className="mt-1 text-xs text-muted">{content.contact_form_hint}</p>

          <form onSubmit={submit} noValidate className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="contact-name">{content.contact_name_label}</label>
              <input
                id="contact-name"
                value={form.name}
                onChange={set('name')}
                placeholder={content.contact_name_placeholder}
                autoComplete="name"
                className="field"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'contact-name-error' : undefined}
              />
              {errors.name && <p id="contact-name-error" role="alert" className="mt-1.5 text-[0.72rem] font-semibold text-rose-700">{errors.name}</p>}
            </div>

            <div>
              <label className="label" htmlFor="contact-subject">{content.contact_subject_label}</label>
              <select
                id="contact-subject"
                value={form.subject}
                onChange={set('subject')}
                className="field"
              >
                <option value="">{content.contact_subject_placeholder}</option>
                {CONTACT_SUBJECTS.map((subject) => (
                  <option key={subject} value={subject}>{CONTACT_SUBJECT_LABELS[subject]}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="contact-email">{content.contact_email_label}</label>
                <input
                  id="contact-email"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder={content.contact_email_placeholder}
                  autoComplete="email"
                  className="field"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'contact-email-error' : undefined}
                />
                {errors.email && <p id="contact-email-error" role="alert" className="mt-1.5 text-[0.72rem] font-semibold text-rose-700">{errors.email}</p>}
              </div>
              <div>
                <label className="label" htmlFor="contact-phone">{content.contact_phone_label} <span className="font-normal normal-case text-muted">({content.auth_optional})</span></label>
                <input
                  id="contact-phone"
                  type="tel"
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder={content.contact_phone_placeholder}
                  autoComplete="tel"
                  className="field"
                />
                {errors.phone && <p id="contact-phone-error" role="alert" className="mt-1.5 text-[0.72rem] font-semibold text-rose-700">{errors.phone}</p>}
              </div>
            </div>

            {form.bookingCode && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-lime-deep/40 bg-lime/15 px-3 py-2">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-forest" />
                  <p className="min-w-0 flex-1 text-[0.66rem] leading-4 text-ink/75">
                    {content.contact_booking_prefix} <span className="font-mono font-extrabold">{form.bookingCode}</span> {content.contact_booking_suffix}
                  </p>
                  <button
                    type="button"
                    onClick={() => setForm((current) => {
                      // Unlinking must also drop the "Need help with booking …"
                      // prefix already baked into the draft message, or the
                      // form would send a booking reference the UI no longer shows.
                      const prefix = `Need help with booking ${current.bookingCode}: `;
                      const withoutPrefix = current.message.startsWith(prefix)
                        ? current.message.slice(prefix.length).trim()
                        : current.message;
                      return { ...current, bookingCode: '', message: withoutPrefix };
                    })}
                    className="rounded-full p-1.5 text-muted transition hover:bg-white hover:text-ink"
                    aria-label={content.contact_booking_remove}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
            </div>
          )}

              <div>
                <label className="label" htmlFor="contact-message">{content.contact_message_label}</label>
              <textarea
                id="contact-message"
                rows={6}
                value={form.message}
                onChange={set('message')}
                placeholder={content.contact_message_placeholder}
                maxLength={1200}
                className="field resize-none"
                aria-invalid={Boolean(errors.message)}
                aria-describedby={errors.message ? 'contact-message-error' : undefined}
              />
              {errors.message ? (
                <p id="contact-message-error" role="alert" className="mt-1.5 text-[0.72rem] font-semibold text-rose-700">{errors.message}</p>
              ) : (
                <p className="mt-1.5 text-[0.7rem] text-muted">{form.message.length}/1200</p>
              )}
            </div>

            <button type="submit" disabled={sending} className="btn btn-lime w-full sm:w-auto">
              {sending ? content.contact_form_sending : content.contact_form_submit} <Send className="h-4 w-4" />
            </button>
            <p className="mt-2 flex items-center gap-1.5 text-[0.68rem] text-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-forest" /> {fill(content.contact_privacy_note)}
            </p>
          </form>
        </section>

        {/* Talk to a human card --------------------------------------------------- */}
        <aside className="space-y-4">
          <section className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-card backdrop-blur-sm sm:p-6">
            <p className="eyebrow">{content.contact_human_eyebrow}</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              {fill(content.contact_human_body)}
            </p>
            <div className="mt-5 space-y-2.5">
              <a href={`mailto:${email}`} className="group flex items-center gap-3 rounded-2xl border border-line bg-white px-3.5 py-3 transition duration-300 hover:-translate-y-0.5 hover:border-ink hover:shadow-soft">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-aqua/25 text-forest"><Mail className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.68rem] font-bold uppercase tracking-wider text-muted">{content.contact_channel_email}</span>
                  <span className="block truncate text-sm font-bold text-ink">{email}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink/60 transition group-hover:text-ink" />
              </a>
              <a href={`tel:${phone ? String(phone).replace(/\s/g, '') : ''}`} className="group flex items-center gap-3 rounded-2xl border border-line bg-white px-3.5 py-3 transition duration-300 hover:-translate-y-0.5 hover:border-ink hover:shadow-soft">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sun/35 text-ink"><Phone className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.68rem] font-bold uppercase tracking-wider text-muted">{content.contact_channel_phone}</span>
                  <span className="block truncate text-sm font-bold text-ink">{phone}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink/60 transition group-hover:text-ink" />
              </a>
              {whatsapp && (
                <a
                  href={`https://wa.me/${String(whatsapp).replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-white px-3.5 py-3 transition duration-300 hover:-translate-y-0.5 hover:border-ink hover:shadow-soft"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lime text-ink"><MessageCircle className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.68rem] font-bold uppercase tracking-wider text-muted">{content.contact_channel_whatsapp}</span>
                    <span className="block truncate text-sm font-bold text-ink">{whatsapp}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink/60 transition group-hover:text-ink" />
                </a>
              )}
            </div>
          </section>

          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-ink via-ink to-forest p-5 text-cream sm:p-6">
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-lime/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-12 left-8 h-28 w-28 rounded-full bg-aqua/10 blur-2xl" />
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime text-ink"><Clock className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-extrabold">{content.contact_fast_title}</p>
                <p className="mt-0.5 text-[0.68rem] text-cream/60">{content.contact_fast_body}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lime"><MapPin className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-extrabold">{hubCount === 1 ? content.contact_hub_singular : fill(content.contact_hub_count, { count: hubCount })}</p>
                <p className="mt-0.5 text-[0.68rem] text-cream/60">
                  {meta.locations.length ? meta.locations.map((location) => location.city || location.name).join(' · ') : content.registered_address}
                </p>
              </div>
            </div>
          </section>

          <p className="flex items-start gap-2.5 rounded-2xl border border-dashed border-stone-300 bg-white/60 p-3.5 text-[0.68rem] leading-5 text-muted">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            {content.contact_manage_prefix} <Link to="/manage" className="font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">{content.manage_heading}</Link> {content.contact_manage_suffix}
          </p>
        </aside>
      </div>
    </div>
  );
}