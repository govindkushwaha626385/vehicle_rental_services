import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CalendarDays, CalendarRange, Car, CheckCircle2, Clock, FileText, Mail, MapPin,
  Search, ShieldCheck, User,
} from 'lucide-react';
import { Modal, StatusPill } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { bookingPaymentSummary, inr, longDate, timeLabel } from '../lib/format.js';
import { cancellationRefund, getSiteContent } from '../lib/site.js';
import { kmAllowance, kmDisclosure } from '../lib/km.js';
import { todayISO } from '../lib/pricing.js';
import { isEmail, licenceExpiryProblem } from '../lib/validation.js';
import ExtendTripModal from '../components/ExtendTripModal.jsx';
import LateMeter from '../components/LateMeter.jsx';
import { tripHistoryEntries } from '../lib/tripHistory.js';
import { tripCountdown } from '../lib/tripCountdown.js';

// Private-mode browsers can refuse sessionStorage; remembering the last code
// and email is a convenience, never a requirement for opening a booking.
function readStored(key) {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function store(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore unavailable storage
  }
}

export default function ManageBooking() {
  const { user, loading: authLoading } = useAuth();
  const { meta } = useMeta();
  const { push } = useToast();
  const [params] = useSearchParams();
  const content = getSiteContent(meta.settings);
  const policy = content.policy;
  const fill = (text, values = {}) => Object.entries(values)
    .reduce((next, [token, value]) => next.replaceAll(`{${token}}`, String(value)), text);
  const queryCode = (params.get('code') || '').trim().toUpperCase();
  const wantExtend = params.get('extend') === '1';

  const [code, setCode] = useState(() => queryCode || readStored('rove:last-code'));
  const [email, setEmail] = useState(() => readStored('rove:last-email') || user?.email || '');
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const requestRef = useRef(0);
  const refund = booking ? cancellationRefund(booking, booking.amountPaid, meta.settings) : null;
  const km = kmDisclosure({
    kmCap: booking?.kmCap ?? booking?.vehicle?.kmCap,
    kmExtraRate: booking?.kmExtraRate ?? booking?.vehicle?.kmExtraRate,
  });
  const kmTotal = kmAllowance({ kmCap: km.kmCap, days: booking?.days });
  const historyLines = tripHistoryEntries(booking, content);
  const canExtend = booking?.status === 'active' && content.extensions_enabled;
  const countdown = tripCountdown(booking);
  // The desk will refuse to hand over a licence that expires inside the
  // rental — tell the customer now, not at the counter.
  const licenceWarn = booking && ['confirmed', 'pending', 'active'].includes(booking.status)
    ? licenceExpiryProblem(booking.driver ?? {}, { endDate: booking.endDate }, { policy })
    : null;
  const pendingChange = booking?.changeRequest?.status === 'pending' ? booking.changeRequest : null;
  const countdownLabel = countdown
    ? content[`countdown_${countdown.labelHint}`]
      .replace('{days}', countdown.days ? String(countdown.days) : '')
      .replace('{time}', countdown.time || '10:00')
    : '';
  // Cancelling a booking made under an account requires that account's
  // session. Guest bookings can still be cancelled with the code + email that
  // already opened this page.
  const needsSignInToCancel = Boolean(booking) && !user && !booking?.customer?.isGuest;

  const runLookup = async (codeValue, emailValue) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setLoading(true);
    setError('');
    setErrorField('');
    try {
      const result = await api.lookupBooking(codeValue.trim().toUpperCase(), emailValue.trim() || null);
      if (request !== requestRef.current) return null;
      setBooking(result);
      store('rove:last-code', result.code);
      if (emailValue.trim()) store('rove:last-email', emailValue.trim());
      return result;
    } catch (nextError) {
      if (request !== requestRef.current) return null;
      setBooking(null);
      setError(nextError.message);
      setErrorField('both');
      return null;
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };

  const focusField = (id) => document.getElementById(id)?.focus();

  const lookup = (event) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedEmail = email.trim();
    if (!trimmedCode) {
      setError(content.manage_error_code);
      setErrorField('code');
      focusField('manage-code');
      return;
    }
    if (trimmedEmail && !isEmail(trimmedEmail)) {
      setError(content.manage_error_email);
      setErrorField('email');
      focusField('manage-email');
      return;
    }
    if (!trimmedEmail && !user) {
      setError(content.manage_error_email);
      setErrorField('email');
      focusField('manage-email');
      return;
    }
    runLookup(trimmedCode, trimmedEmail);
  };

  // Voucher and email links arrive as /manage?code=ROVE-XXXX. When we already
  // know the email (or the customer is signed in) open the booking straight
  // away instead of making them submit the same code again.
  useEffect(() => {
    if (!queryCode || authLoading) return;
    setCode(queryCode);
    setBooking(null);
    setError('');
    setErrorField('');
    const knownEmail = readStored('rove:last-email') || user?.email || '';
    if (knownEmail || user) runLookup(queryCode, knownEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryCode, authLoading]);

  // A "Extend trip" shortcut (home next-trip card, reminders) deep-links with
  // ?extend=1. Open the modal once the active booking has loaded; closing it
  // leaves the customer on the booking page, not in a reopen loop.
  useEffect(() => {
    if (wantExtend && booking?.status === 'active' && content.extensions_enabled) {
      setExtendOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantExtend, booking?.id, booking?.status, content.extensions_enabled]);

  const refresh = async () => {
    const result = await api.lookupBooking(booking.code, email.trim() || null);
    setBooking(result);
    return result;
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      const result = await api.cancelBooking({
        bookingId: booking.id,
        code: booking.code,
        email: email.trim() || undefined,
        reason: reason.trim() || content.manage_reason_default,
      });
      push(result?.message || content.manage_cancel_success, 'success');
      setCancelOpen(false);
      setReason('');
      try {
        await refresh();
      } catch {
        // The cancellation itself succeeded; only the refresh failed. Keep the
        // card honest without pretending the cancel failed.
        setBooking((current) => (current ? { ...current, status: 'cancelled', canCancel: false } : current));
      }
    } catch (nextError) {
      push(nextError.message, 'error');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="pb-20">
      <section className="no-print relative overflow-hidden border-b border-line bg-paper/75">
        <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-lime/20 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-0 h-72 w-72 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="container-x relative py-10 sm:py-14">
          <p className="eyebrow">{content.manage_eyebrow}</p>
          <h1 className="display mt-2 text-4xl leading-none sm:text-5xl lg:text-[3.4rem]">{content.manage_title}</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">{content.manage_subtitle}</p>
        </div>
      </section>

      <div className="print-grid container-x mt-7 grid gap-6 lg:grid-cols-[23rem_1fr]">
        <aside className="no-print">
          <form onSubmit={lookup} noValidate className="gradient-border rounded-3xl p-5 shadow-card">
            <p className="text-sm font-extrabold">{content.manage_find_title}</p>
            <p className="mt-1 text-[0.68rem] leading-5 text-muted">{content.manage_find_copy}</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="label" htmlFor="manage-code">{content.manage_code_label}</label>
                <div className="input-group">
                  <FileText className="input-icon h-4 w-4" />
                  <input
                    id="manage-code"
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.toUpperCase());
                      if (error) {
                        setError('');
                        setErrorField('');
                      }
                    }}
                    placeholder={content.manage_code_placeholder}
                    className="field font-mono tracking-wider"
                    autoComplete="off"
                    aria-invalid={errorField === 'code' || errorField === 'both'}
                    aria-describedby={errorField === 'code' || errorField === 'both' ? 'manage-lookup-error' : undefined}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="manage-email">{content.manage_email_label}</label>
                <div className="input-group">
                  <Mail className="input-icon h-4 w-4" />
                  <input
                    id="manage-email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (error) {
                        setError('');
                        setErrorField('');
                      }
                    }}
                    placeholder={content.manage_email_placeholder}
                    className="field"
                    autoComplete="email"
                    aria-invalid={errorField === 'email' || errorField === 'both'}
                    aria-describedby={errorField === 'email' || errorField === 'both' ? 'manage-lookup-error' : undefined}
                  />
                </div>
              </div>
            </div>
            {error && (
              <p id="manage-lookup-error" role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[0.7rem] font-semibold text-rose-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            )}
            <button type="submit" disabled={loading} className="btn btn-lime mt-4 w-full">
              {loading ? content.manage_searching : <>{content.manage_find_cta} <Search className="h-4 w-4" /></>}
            </button>
            <p className="mt-3 text-center text-[0.62rem] text-muted">
              {user ? <Link to="/account" className="font-bold underline underline-offset-2">{content.manage_all_trips}</Link> : <>{content.manage_have_account} <Link to="/login" className="font-bold underline underline-offset-2">{content.manage_signin}</Link></>}
            </p>
          </form>

          <div className="mt-4 rounded-3xl border border-white/80 bg-white/85 p-5 shadow-card backdrop-blur-sm">
            <p className="flex items-center gap-2 text-[0.72rem] font-extrabold"><ShieldCheck className="h-4 w-4 text-forest" /> {content.manage_policy_title}</p>
            <ul className="mt-3 space-y-2 text-[0.68rem] leading-5 text-muted">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> {policy.fullRefundCopy}</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> {policy.partialRefundCopy}</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> {content.manage_policy_dates}</li>
            </ul>
          </div>
        </aside>

        <div>
          {!booking ? (
            <div className="relative flex h-full min-h-[20rem] flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-stone-300 bg-white/60 px-6 py-14 text-center">
              <div className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-lime/20 blur-3xl" />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-lime to-aqua/60 text-ink shadow-[0_16px_30px_-22px_rgba(10,15,11,0.5)]"><Search className="h-6 w-6" /></span>
              <h2 className="relative mt-4 text-lg font-extrabold tracking-tight">{content.manage_empty_title}</h2>
              <p className="relative mt-1.5 max-w-sm text-sm leading-6 text-muted">{content.manage_empty_copy}</p>
              <Link to="/browse" className="relative btn btn-lime mt-4">
                <Car className="h-4 w-4" /> {content.manage_empty_cta}
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-3xl border border-line bg-white/95 p-5 shadow-card backdrop-blur-sm sm:p-6 print-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">{content.manage_booking_prefix} {booking.code}</p>
                    <h2 className="mt-1 text-2xl font-extrabold tracking-tight">{booking.vehicle?.name || content.manage_rental_fallback}</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {countdownLabel && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-ink">
                          <Clock className="h-3 w-3" /> {countdownLabel}
                        </span>
                      )}
                      <span className="ml-1">{booking.days} {booking.days === 1 ? content.manage_days_singular : content.manage_days_plural} · {booking.insurance?.label} {content.manage_protection_suffix}</span>
                    </p>
                  </div>
                  <StatusPill status={booking.status} />
                </div>

                {pendingChange && (
                  <div className="mt-3 rounded-xl border border-sun/40 bg-sun/10 px-3 py-2.5 text-[0.7rem] leading-5 text-ink">
                    <p className="flex items-center gap-2 font-extrabold"><CalendarRange className="h-4 w-4 shrink-0" /> {content.amend_pending}</p>
                    <p className="mt-1 text-muted">{content.amend_pending_note}</p>
                    <p className="mt-1.5 font-semibold">
                      {longDate(pendingChange.startDate)} → {longDate(pendingChange.endDate)} · {timeLabel(pendingChange.pickupTime)} → {timeLabel(pendingChange.dropoffTime)} · {inr(pendingChange.total)}
                    </p>
                    <p className="text-muted">{pendingChange.pickupLocation} → {pendingChange.dropoffLocation}</p>
                  </div>
                )}

                {licenceWarn && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/50 bg-amber-50 px-3 py-2.5 text-[0.7rem] leading-5 text-amber-900" role="alert">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0">{licenceWarn} {content.manage_licence_help}</span>
                  </div>
                )}

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-line bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-soft">
                    <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted"><CalendarDays className="h-3 w-3 text-moss" /> {content.manage_pickup}</p>
                    <p className="mt-1 text-sm font-extrabold">{longDate(booking.startDate)}</p>
                    <p className="mt-0.5 text-[0.7rem] text-muted">{timeLabel(booking.pickupTime)}</p>
                    <p className="mt-1 flex items-center gap-1 text-[0.68rem] text-muted"><MapPin className="h-3 w-3" /> {booking.pickupLocation}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-soft">
                    <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted"><CalendarDays className="h-3 w-3 text-aqua" /> {content.manage_dropoff}</p>
                    <p className="mt-1 text-sm font-extrabold">{longDate(booking.endDate)}</p>
                    <p className="mt-0.5 text-[0.7rem] text-muted">{timeLabel(booking.dropoffTime)}</p>
                    <p className="mt-1 flex items-center gap-1 text-[0.68rem] text-muted"><MapPin className="h-3 w-3" /> {booking.dropoffLocation}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-soft">
                    <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted"><User className="h-3 w-3 text-violet" /> {content.manage_driver}</p>
                    <p className="mt-1 text-sm font-extrabold">{booking.driver?.name || booking.customer?.name}</p>
                    <p className="mt-0.5 text-[0.7rem] text-muted">{booking.driver?.email || booking.customer?.email}</p>
                  </div>
                  <div className="rounded-2xl border border-line bg-gradient-to-br from-paper to-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-soft">
                    <p className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">{content.manage_total}</p>
                    <p className="mt-1 text-sm font-extrabold">{inr(booking.total)}</p>
                    <p className="mt-0.5 text-[0.7rem] text-muted">{bookingPaymentSummary(booking)}</p>
                  </div>
                </div>

                {!['cancelled', 'rejected'].includes(booking.status) && (
                  <p className="mt-4 rounded-xl border border-line bg-paper px-3 py-2 text-[0.7rem] leading-5 text-muted">
                    <span className="font-bold text-ink">{content.manage_km_label}</span>{' '}
                    {km.limited
                      ? content.manage_km_included
                        .replace('{km}', km.kmCap.toLocaleString('en-IN'))
                        .replace('{rate}', inr(km.kmExtraRate))
                      : content.manage_km_unlimited}
                    {km.limited && kmTotal ? ` ${content.manage_km_total
                      .replace('{total}', kmTotal.toLocaleString('en-IN'))
                      .replace('{days}', String(booking.days))}` : ''}
                    {km.limited ? ` ${content.manage_km_note}` : ''}
                  </p>
                )}

                {booking.notes && (
                  <p className="mt-4 rounded-xl bg-paper px-3 py-2 text-[0.7rem] leading-5 text-muted"><span className="font-bold text-ink">{content.manage_note_label}</span> {booking.notes}</p>
                )}
                {booking.status === 'cancelled' && booking.cancellationReason && (
                  <p className="mt-4 rounded-xl border border-line bg-paper px-3 py-2 text-[0.7rem] leading-5 text-muted">
                    <span className="font-bold text-ink">{content.manage_cancellation_reason_label}</span> {booking.cancellationReason}
                  </p>
                )}

                {historyLines.length > 0 && (
                  <div className="mt-4 rounded-xl border border-line bg-paper px-3 py-2 text-[0.7rem] leading-5 text-muted">
                    <p className="font-bold text-ink">{content.amend_history_label}</p>
                    {historyLines.map((line) => (
                      <p key={line.id} className="mt-1">
                        <span className="font-semibold text-muted">{line.day}</span> {line.title}
                        {line.detail && <span className="text-muted"> · {line.detail}</span>}
                      </p>
                    ))}
                  </div>
                )}

                <LateMeter booking={booking} content={content} policy={policy} canExtend={canExtend} className="mt-4" />

                <div className="mt-5 flex flex-wrap gap-2">
                  <Link to={`/confirmation/${booking.code}`} className="btn btn-lime btn-sm">
                    {content.manage_open_voucher} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <button type="button" onClick={() => window.print()} className="btn btn-white btn-sm">{content.manage_print}</button>
                  {canExtend && (
                    <button type="button" onClick={() => setExtendOpen(true)} className="btn btn-ghost btn-sm text-moss">
                      <Clock className="h-3.5 w-3.5" /> {content.extend_extension_chip}
                    </button>
                  )}
                  {booking.canCancel && (
                    needsSignInToCancel ? (
                      <Link to={`/login?redirect=${encodeURIComponent(`/manage?code=${booking.code}`)}`} className="btn btn-outline btn-sm">
                        {content.manage_signin_to_cancel}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => setCancelOpen(true)} className="btn btn-outline btn-sm text-rose-700">
                        {content.manage_cancel_cta}
                      </button>
                    )
                  )}
                </div>

                {booking.canCancel && needsSignInToCancel && (
                  <p className="mt-3 text-[0.68rem] text-muted">{content.manage_signin_cancel_note}</p>
                )}

                {!booking.canCancel && (
                  <p className="mt-3 text-[0.68rem] text-muted">
                    {booking.status === 'cancelled'
                      ? content.manage_cancelled_note
                      : booking.startDate < todayISO()
                        ? content.manage_started_note
                        : content.manage_no_online_cancel}
                  </p>
                )}
              </div>

              <div className="relative overflow-hidden rounded-3xl border border-lime-deep/30 bg-gradient-to-br from-lime/20 via-white to-aqua/10 p-5 shadow-[0_18px_46px_-40px_rgba(10,15,11,0.5)] sm:p-6">
                <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-lime/20 blur-2xl" />
                <p className="eyebrow relative">{content.manage_help_eyebrow}</p>
                <h3 className="relative mt-1 text-lg font-extrabold tracking-tight">{content.manage_help_title}</h3>
                <p className="relative mt-1.5 text-sm leading-6 text-muted">{fill(content.manage_help_copy, { code: booking.code, hours: content.support_hours })}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a href={`mailto:${content.support_email}`} className="btn btn-outline btn-sm">{content.manage_email_support}</a>
                  <a href={`tel:${content.support_phone ? String(content.support_phone).replace(/[^\d+]/g, '') : ''}`} className="btn btn-outline btn-sm">{fill(content.manage_call_support, { phone: content.support_phone })}</a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => (cancelling ? null : setCancelOpen(false))}
        title={content.manage_cancel_modal_title}
        description={fill(content.manage_cancel_modal_description, { policy: policy.cancellationSummary })}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setCancelOpen(false)} disabled={cancelling} className="btn btn-white flex-1">{content.manage_keep_booking}</button>
            <button type="button" onClick={cancel} disabled={cancelling} className="btn btn-dark flex-1">{cancelling ? content.manage_cancelling : content.manage_cancel_confirm}</button>
          </div>
        )}
      >
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[0.72rem] leading-6 text-amber-900">
          <p className="font-extrabold">{content.manage_refund_estimate}</p>
          <p className="mt-1">
            {!booking?.amountPaid
              ? content.manage_refund_none
              : refund && !refund.insideWindow
                ? fill(content.manage_refund_full, { window: policy.windowLabel, amount: inr(refund.refundAmount) })
                : fill(content.manage_refund_partial, {
                  window: policy.windowLabel,
                  percent: refund?.percent ?? policy.refundPercent,
                  amount: inr(refund?.refundAmount ?? 0),
                })}
          </p>
          <p className="mt-1 text-[0.62rem] text-amber-900/70">{content.manage_refund_note}</p>
        </div>
        <div className="mt-4">
          <label className="label" htmlFor="cancel-reason">{content.manage_reason_label} <span className="font-medium normal-case tracking-normal text-muted">{content.manage_optional}</span></label>
          <textarea id="cancel-reason" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="field resize-none" placeholder={content.manage_reason_placeholder} maxLength={300} />
        </div>
      </Modal>

      <ExtendTripModal
        booking={booking}
        open={extendOpen && booking?.status === 'active'}
        onClose={() => setExtendOpen(false)}
        onExtended={() => {
          setExtendOpen(false);
          refresh();
        }}
      />
    </div>
  );
}
