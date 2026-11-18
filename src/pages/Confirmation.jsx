import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CalendarDays, CalendarPlus, CalendarRange, Car, Check, CheckCircle2, ClipboardCheck, Clock, Copy, Mail,
  Printer, ShieldCheck, User, XCircle,
} from 'lucide-react';
import { PageLoader, StatusPill } from '../components/ui.jsx';
import ExtendTripModal from '../components/ExtendTripModal.jsx';
import LateMeter from '../components/LateMeter.jsx';
import { api } from '../lib/api.js';
import { vehicleDocs } from '../lib/fleetDocs.js';
import { inspectionLine } from '../lib/inspection.js';
import { kmAllowance, kmDisclosure } from '../lib/km.js';
import { todayISO } from '../lib/pricing.js';
import { lateDays, REFUND_METHOD_LABELS as refundMethodLabels } from '../lib/returns.js';
import { licenceExpiryProblem } from '../lib/validation.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { downloadBookingICS } from '../lib/calendar.js';
import { bookingPaymentState, bookingRefundTotal, cn, inr, longDate, paymentLabel, paymentStatusLabel, timeLabel } from '../lib/format.js';
import { invoiceNumber } from '../lib/finance.js';
import { getSiteContent } from '../lib/site.js';
import { isEmail } from '../lib/validation.js';
import { tripProgress, tripProgressPercent } from '../lib/tripProgress.js';import { tripHistoryEntries } from '../lib/tripHistory.js';
import { tripCountdown } from '../lib/tripCountdown.js';

// Private-mode browsers can throw on sessionStorage access, and the voucher
// still loads by code, so remember-my-email is strictly best-effort.
function readStoredEmail() {
  try {
    return sessionStorage.getItem('rove:last-email') || '';
  } catch {
    return '';
  }
}

function storeEmail(value) {
  try {
    sessionStorage.setItem('rove:last-email', value);
  } catch {
    // ignore unavailable storage
  }
}

export default function Confirmation() {
  const { code } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { meta } = useMeta();
  const { push } = useToast();
  const content = getSiteContent(meta.settings);
  const policy = content.policy;
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [email, setEmail] = useState(() => user?.email || readStoredEmail() || '');
  const [extendOpen, setExtendOpen] = useState(false);
  const requestRef = useRef(0);

  const load = async (emailArg, silent = false) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    if (!silent) setLoading(true);
    setError('');
    setNotFound(false);
    try {
      const result = await api.getBooking(code, emailArg || null);
      if (request !== requestRef.current) return;
      if (!result) throw new Error(content.confirmation_lookup_notfound_title);
      setBooking(result);
      if (emailArg) storeEmail(emailArg);
      if (result?.customer?.email) storeEmail(result.customer.email);
    } catch (nextError) {
      if (request !== requestRef.current) return;
      const message = nextError.message || content.confirmation_lookup_error_title;
      setBooking(null);
      setError(message);
      setNotFound(/not found|could not find|does not exist|no booking/i.test(message));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    // Wait for the session before deciding we have no email: a signed-in
    // customer should never be asked to retype their own address. A guest on
    // a new device gets the lookup form instead of a premature error.
    if (authLoading) return;
    const initialEmail = user?.email || email || '';
    if (!initialEmail) {
      setLoading(false);
      return;
    }
    if (!email) setEmail(initialEmail);
    load(initialEmail, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, authLoading]);

  const verify = (event) => {
    event.preventDefault();
    if (!isEmail(email)) {
      setError(content.confirmation_lookup_email_required);
      document.getElementById('confirm-email')?.focus();
      return;
    }
    load(email.trim());
  };

  const copyCode = async () => {
    const value = booking?.code || code;
    try {
      await navigator.clipboard.writeText(value);
      push(content.confirmation_code_copied, 'success');
    } catch {
      push(content.confirmation_code_fallback.replace('{code}', value), 'info');
    }
  };

  if (loading) return <PageLoader label={content.confirmation_loading} />;

  if (!booking) {
    const lookupProblem = notFound || Boolean(error);
    return (
      <div className="container-x py-16 sm:py-20">
        <div className="mx-auto max-w-md">
          <div className="mb-6 text-center">
            <p className="eyebrow">{content.confirmation_lookup_eyebrow}</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
              {notFound ? content.confirmation_lookup_notfound_title : error ? content.confirmation_lookup_error_title : content.confirmation_lookup_title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              {notFound
                ? content.confirmation_lookup_notfound_copy
                : error
                  ? content.confirmation_lookup_error_copy
                  : content.confirmation_lookup_copy}
            </p>
          </div>
          <form onSubmit={verify} noValidate className="gradient-border rounded-3xl p-5 shadow-card">
            {lookupProblem && (
              <p className="mb-3 rounded-xl border border-line bg-paper px-3 py-2 text-center font-mono text-sm font-bold">{code}</p>
            )}
            <label className="label" htmlFor="confirm-email">{content.confirmation_lookup_email_label}</label>
            <div className="input-group">
              <Mail className="input-icon h-4 w-4" />
              <input
                id="confirm-email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) setError('');
                }}
                placeholder={content.checkout_placeholder_email}
                className="field"
                autoComplete="email"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'confirm-email-error' : undefined}
              />
            </div>
            {error && <p id="confirm-email-error" className="mt-2 text-[0.7rem] font-semibold text-rose-700" role="alert">{error}</p>}
            <button type="submit" className="btn btn-dark mt-4 w-full">{content.confirmation_lookup_submit} <ArrowRight className="h-4 w-4" /></button>
            {lookupProblem ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Link to="/manage" className="btn btn-white">{content.confirmation_try_another}</Link>
                <Link to="/account" className="btn btn-white">{content.confirmation_open_account}</Link>
              </div>
            ) : (
              <p className="mt-3 text-center text-[0.62rem] text-muted">
                {content.confirmation_lookup_account_hint.split('{link}')[0]}
                <Link to="/account" className="font-bold underline underline-offset-2">{content.confirmation_lookup_account_link}</Link>
                {content.confirmation_lookup_account_hint.split('{link}')[1] || ''}
              </p>
            )}
          </form>
        </div>
      </div>
    );
  }

  const vehicleName = booking.vehicle?.name || content.confirmation_vehicle_fallback;
  const taxLabel = String(meta.settings?.tax_label || 'GST').trim() || 'GST';
  const taxRate = Number(booking.taxRate ?? meta.settings?.tax_rate ?? 0);
  const invoiceNo = invoiceNumber(meta.settings, booking.code);
  const invoiceTaxNote = String(meta.settings?.tax_invoice_note || '').trim();
  const closed = ['cancelled', 'rejected'].includes(booking.status);
  const pending = booking.status === 'pending';
  const settlement = booking.depositSettlement ?? null;
  const km = kmDisclosure({
    kmCap: booking.kmCap ?? booking.vehicle?.kmCap,
    kmExtraRate: booking.kmExtraRate ?? booking.vehicle?.kmExtraRate,
  });
  const kmTotal = kmAllowance({ kmCap: km.kmCap, days: booking.days });
  const historyLines = tripHistoryEntries(booking, content);
  const overdueDays = booking.status === 'active' ? lateDays(booking, todayISO()) : 0;
  // The licence must be valid for the whole rental; warn on the voucher too so
  // the customer never meets this rule for the first time at the counter.
  const licenceWarn = ['confirmed', 'pending', 'active'].includes(booking.status)
    ? licenceExpiryProblem(booking.driver ?? {}, { endDate: booking.endDate }, { policy: content.policy })
    : null;
  const countdown = tripCountdown(booking);
  const countdownLabel = countdown
    ? content[`countdown_${countdown.labelHint}`]
      .replace('{days}', countdown.days ? String(countdown.days) : '')
      .replace('{time}', countdown.time || '10:00')
    : '';
  const deductions = settlement
    ? [
      ['confirmation_deduction_late', settlement.lateFee],
      ['confirmation_deduction_damage', settlement.damageFee],
      ['confirmation_deduction_cleaning', settlement.cleaningFee],
      ['confirmation_deduction_km', settlement.excessKmFee],
      ['confirmation_deduction_fuel', settlement.fuelFee],
    ].filter(([, amount]) => Number(amount) > 0)
    : [];
  // A legacy settlement may only carry a total. Still tell the customer what
  // was taken instead of showing a deduction with no explanation.
  if (settlement && deductions.length === 0 && Number(settlement.charges) > 0) {
    deductions.push(['confirmation_deduction_total', settlement.charges]);
  }
  const depositParts = settlement
    ? [settlement.label || content.confirmation_deposit_state_settled]
    : [];
  if (settlement?.refundDue > 0) {
    depositParts.push(content.confirmation_deposit_state_refunded.replace('{amount}', inr(settlement.refundDue)));
    if (settlement.refundMethod) {
      depositParts.push(content.confirmation_deposit_state_via.replace('{method}', refundMethodLabels[settlement.refundMethod] || settlement.refundMethod));
    }
  }
  if (settlement?.charges > 0) {
    depositParts.push(content.confirmation_deposit_state_deducted.replace('{amount}', inr(settlement.charges)));
  }
  if (settlement && depositParts.length === 1) {
    depositParts.push(content.confirmation_deposit_state_no_deductions);
  }
  const depositState = settlement
    ? depositParts.join(' · ')
    : closed
      ? content.confirmation_deposit_state_none
      : booking.status === 'completed'
        ? content.confirmation_deposit_state_after
        : content.confirmation_deposit_state_due;
  const depositInvoiceNote = settlement
    ? `${settlement.charges > 0
      ? content.confirmation_deposit_note_settled_deducted.replace('{amount}', inr(settlement.charges))
      : content.confirmation_deposit_note_settled} ${settlement.refundDue > 0
      ? content.confirmation_deposit_note_refund.replace('{amount}', inr(settlement.refundDue))
      : content.confirmation_deposit_note_no_refund}`
    : closed
      ? content.confirmation_deposit_note_closed
      : booking.status === 'completed'
        ? content.confirmation_deposit_note_completed
        : content.confirmation_deposit_note_due;
  const refunded = bookingRefundTotal(booking);
  const netPaid = booking.amountPaid ?? 0;
  const grossPaid = netPaid + refunded;
  const balance = closed ? 0 : booking.balanceDue ?? Math.max(0, (booking.total || 0) - netPaid);
  const heading = booking.status === 'rejected'
    ? content.confirmation_rejected_heading
    : closed
      ? content.confirmation_cancelled_heading
      : pending
        ? content.confirmation_pending_heading
        : booking.status === 'completed'
          ? content.confirmation_completed_heading
          : booking.status === 'active'
            ? content.confirmation_active_heading
            : content.confirmation_confirmed_heading;
  const badge = booking.status === 'rejected'
    ? content.confirmation_rejected_badge
    : closed
      ? content.confirmation_cancelled_badge
      : pending
        ? content.confirmation_pending_badge
        : booking.status === 'completed'
          ? content.confirmation_completed_badge
          : booking.status === 'active'
            ? content.confirmation_active_badge
            : content.confirmation_confirmed_badge;
  const statusNote = closed
    ? content.confirmation_closed_note
    : pending
      ? content.confirmation_pending_note
      : booking.status === 'completed'
        ? content.confirmation_completed_note
        : booking.status === 'active'
          ? content.confirmation_active_note
          : content.confirmation_confirmed_note;
  // Pick-up instructions, calendar downloads and the cancellation policy only
  // make sense while the trip is still ahead of the customer.
  const upcoming = ['pending', 'confirmed'].includes(booking.status);

  const progress = tripProgress(booking);
  const progressStages = [
    content.confirmation_stage_requested,
    content.confirmation_stage_confirmed,
    content.confirmation_stage_pickup,
    content.confirmation_stage_returned,
  ];
  const progressPercent = tripProgressPercent(progress);

  return (
    <div className="pb-20">
      <section className="no-print relative overflow-hidden border-b border-line bg-gradient-to-br from-forest via-ink to-forest text-cream">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-aqua/20 blur-[110px]" />
        <div className="pointer-events-none absolute -left-20 bottom-[-6rem] h-64 w-64 rounded-full bg-lime/15 blur-[100px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-lime/60 to-transparent" />
        <div className="container-x relative py-10 sm:py-14">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-lime/30 bg-lime/10 px-3 py-1.5 text-[0.62rem] font-extrabold uppercase tracking-[0.14em] text-lime">
                {closed ? <XCircle className="h-3.5 w-3.5" /> : pending ? <Clock className="h-3.5 w-3.5" /> : booking.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5" /> : (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
                  </span>
                )}
                {badge}
              </span>
              <h1 className="display mt-4 text-5xl leading-none sm:text-6xl">{heading}</h1>
              <p className="mt-3 max-w-xl text-sm leading-7 text-cream/65">
                {statusNote}
              </p>

              <LateMeter
                booking={booking}
                content={content}
                policy={policy}
                canExtend={booking.status === 'active' && content.extensions_enabled}
                tone="dark"
                className="mt-4 max-w-xl"
              />

              {booking.status === 'active' && overdueDays === 0 && countdown && (
                <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[0.68rem] font-extrabold text-cream">
                  <Clock className="h-3.5 w-3.5" /> {countdownLabel}
                </p>
              )}

              {booking.status === 'active' && content.extensions_enabled && (
                <button
                  type="button"
                  onClick={() => setExtendOpen(true)}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border border-lime bg-lime/20 px-4 py-2 text-[0.72rem] font-extrabold text-cream transition hover:bg-lime/35"
                >
                  <Clock className="h-4 w-4 text-lime" /> {content.extend_extension_chip}
                </button>
              )}

              {progress.closed ? (
                <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-[0.66rem] font-extrabold text-rose-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  {progress.closedStatus === 'rejected' ? content.confirmation_stage_closed_rejected : content.confirmation_stage_closed_cancelled}
                </p>
              ) : (
                <ol className="mt-6 flex items-center gap-2" aria-label={content.confirmation_progress_label}>
                  {progressStages.map((label, index) => (
                    <Fragment key={label}>
                      <li className="flex flex-col items-center gap-1">
                        <span className={cn('flex h-4.5 w-4.5 items-center justify-center rounded-full border-2', index < progress.currentIndex ? 'border-lime bg-lime text-ink' : index === progress.currentIndex ? 'border-lime text-lime' : 'border-white/30 text-cream/40')}>
                          {index < progress.currentIndex
                            ? <Check className="h-2.5 w-2.5" />
                            : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                        </span>
                        <span className={cn('mt-1 text-[0.55rem] font-bold leading-none', index <= progress.currentIndex ? 'text-lime' : 'text-cream/50')}>{label}</span>
                      </li>
                      {index < progressStages.length - 1 && (
                        <li aria-hidden="true" className={cn('h-0.5 flex-1 min-w-[1.5rem] rounded-full', index < progress.currentIndex ? 'bg-lime' : 'bg-white/20')} />
                      )}
                    </Fragment>
                  ))}
                </ol>
              )}
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/[0.08] px-4 py-3 shadow-[0_20px_40px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
              <p className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-cream/55">{content.confirmation_code_label}</p>
              <div className="mt-1 flex items-center gap-3">
                <p className="font-mono text-xl font-bold tracking-[0.16em]">{booking.code}</p>
                <button type="button" onClick={copyCode} className="rounded-full border border-white/15 p-1.5 text-cream/60 transition hover:border-lime hover:text-lime" aria-label={content.confirmation_copy_code}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {licenceWarn && (
        <div className="container-x" role="alert">
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-400/50 bg-amber-50 px-4 py-3 text-[0.72rem] leading-5 text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{licenceWarn} {content.confirmation_licence_warn_help}</span>
          </div>
        </div>
      )}

      <div className="print-grid container-x mt-8 grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-5">
          <div className="print-card rounded-3xl border border-line bg-white/95 p-5 shadow-card backdrop-blur-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">{content.confirmation_rental_eyebrow}</p>
                <h2 className="mt-1 text-xl font-extrabold tracking-tight">{vehicleName}</h2>
                <p className="mt-0.5 text-xs text-muted">{booking.vehicle?.type} · {booking.vehicle?.brand} · {booking.vehicle?.location}</p>
              </div>
              <StatusPill status={booking.status} />
            </div>

            <div className="mt-5 flex items-center gap-4 rounded-2xl border border-line/70 bg-gradient-to-r from-paper to-white p-3">
              {booking.vehicle?.imageUrl && (
                <img src={booking.vehicle.imageUrl} alt={vehicleName} className="h-20 w-28 rounded-xl object-cover shadow-[0_12px_24px_-20px_rgba(10,15,11,0.6)] ring-1 ring-line" />
              )}
              <div className="min-w-0 text-[0.72rem]">
                <p className="font-extrabold">{booking.days} day{booking.days === 1 ? '' : 's'} · {booking.pickupLocation}</p>
                <p className="mt-0.5 text-muted">
                  {closed
                    ? (booking.status === 'rejected' ? content.confirmation_rejected_badge : content.confirmation_rental_cancelled)
                    : `${booking.insurance?.label} protection · ${booking.paymentPlan === 'deposit'
                      ? booking.depositDue
                        ? content.confirmation_deposit_paid.replace('{amount}', inr(booking.depositDue))
                        : content.confirmation_deposit_paid_generic
                      : content.confirmation_paid_in_full}`}
                </p>
                <p className="mt-1 font-mono text-[0.62rem] text-muted">{booking.code}</p>
              </div>
            </div>
            {!closed && (
              <p className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 text-[0.66rem] leading-5 text-muted">
                <span className="font-bold text-ink">{content.confirmation_km_label}</span>{' '}
                {km.limited
                  ? content.confirmation_km_included
                    .replace('{km}', km.kmCap.toLocaleString('en-IN'))
                    .replace('{rate}', inr(km.kmExtraRate))
                  : content.confirmation_km_unlimited}
                {km.limited && kmTotal ? ` ${content.confirmation_km_total
                  .replace('{total}', kmTotal.toLocaleString('en-IN'))
                  .replace('{days}', String(booking.days))}` : ''}
                {km.limited ? ` ${content.confirmation_km_note}` : ''}
              </p>
            )}
            {deductions.length > 0 && (
              <p className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 text-[0.66rem] leading-5 text-muted">
                <span className="font-bold text-ink">{content.confirmation_deductions_label}</span>{' '}
                {deductions.map(([key, amount]) => `${content[key]} ${inr(amount)}`).join(' · ')}
              </p>
            )}
            {!closed && (booking.pickupInspection || booking.inspection) && (
              <div className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 text-[0.66rem] leading-5 text-muted">
                <p className="font-bold text-ink">{content.confirmation_condition_label}</p>
                {booking.pickupInspection && (
                  <p>{content.confirmation_condition_pickup} {inspectionLine(booking.pickupInspection)}</p>
                )}
                {booking.inspection && (
                  <p>{content.confirmation_condition_return} {inspectionLine(booking.inspection)}</p>
                )}
              </div>
            )}
            {historyLines.length > 0 && (
              <div className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 text-[0.66rem] leading-5 text-muted">
                <p className="font-bold text-ink">{content.amend_history_label}</p>
                {historyLines.map((line) => (
                  <p key={line.id} className="mt-0.5">
                    <span className="font-semibold text-muted">{line.day}</span> {line.title}
                    {line.detail && <span className="text-muted"> · {line.detail}</span>}
                  </p>
                ))}
              </div>
            )}
            {!closed && (() => {
              const docs = vehicleDocs(booking.vehicle, todayISO());
              const lines = Object.values(docs.docs).filter((doc) => doc.status !== 'untracked');
              if (!docs.registrationNumber && !lines.length) return null;
              const noteLines = [];
              if (docs.registrationNumber) noteLines.push(`RC: ${docs.registrationNumber}`);
              lines.forEach((doc) => {
                if (doc.status === 'expired') noteLines.push(`${doc.label} expired — renew before this trip`);
                else if (doc.status === 'expiring') noteLines.push(`${doc.label} valid till ${booking.vehicle?.[doc.key]}`);
                else noteLines.push(`${doc.label} valid`);
              });
              return (
                <p className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 text-[0.66rem] leading-5 text-muted">
                  <span className="font-bold text-ink">Vehicle documents</span>{' '}
                  {noteLines.join(' · ')} — carry a copy of the RC during the trip.
                </p>
              );
            })()}
            {booking.status === 'cancelled' && booking.cancellationReason && (
              <p className="mt-3 rounded-xl border border-line bg-paper px-3 py-2 text-[0.68rem] leading-5 text-muted">
                <span className="font-bold text-ink">{content.confirmation_cancellation_reason}</span> {booking.cancellationReason}
              </p>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-soft">
                <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted"><CalendarDays className="h-3 w-3 text-moss" /> {content.checkout_pickup_label}</p>
                <p className="mt-1 text-sm font-extrabold">{longDate(booking.startDate)}</p>
                <p className="mt-0.5 text-[0.7rem] text-muted">{timeLabel(booking.pickupTime)} · {booking.pickupLocation}</p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-soft">
                <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted"><CalendarDays className="h-3 w-3 text-aqua" /> {content.checkout_dropoff_label}</p>
                <p className="mt-1 text-sm font-extrabold">{longDate(booking.endDate)}</p>
                <p className="mt-0.5 text-[0.7rem] text-muted">{timeLabel(booking.dropoffTime)} · {booking.dropoffLocation}</p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-soft">
                <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted"><User className="h-3 w-3 text-violet" /> {content.checkout_driver_label}</p>
                <p className="mt-1 text-sm font-extrabold">{booking.driver?.name || booking.customer?.name}</p>
                <p className="mt-0.5 text-[0.7rem] text-muted">{content.confirmation_licence_label} {booking.driver?.license || content.confirmation_licence_on_file}{booking.driver?.licenseExpiry ? ` · ${content.confirmation_licence_expires} ${longDate(booking.driver.licenseExpiry)}` : ''} · {booking.driver?.phone || booking.customer?.phone || ''}</p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-soft">
                <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-muted"><ShieldCheck className="h-3 w-3 text-lime-deep" /> {content.confirmation_deposit_label}</p>
                <p className="mt-1 text-sm font-extrabold">{closed && !settlement ? inr(0) : inr(booking.holdAmount ?? policy.holdAmount)}</p>
                <p className="mt-0.5 text-[0.7rem] text-muted">{depositState}</p>
              </div>
            </div>

            {(booking.extras?.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {booking.extras.map((extra) => <span key={extra.key} className="chip">{extra.label}</span>)}
              </div>
            )}

            {!closed && ['pending', 'confirmed'].includes(booking.status) && content.confirmation_checklist_items.length > 0 && (
              <div className="mt-4 rounded-2xl border border-lime-deep/40 bg-lime/12 p-4">
                <p className="flex items-center gap-2 text-[0.72rem] font-extrabold">
                  <ClipboardCheck className="h-4 w-4 text-forest" /> {content.confirmation_checklist_title}
                </p>
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {content.confirmation_checklist_items.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-[0.68rem] text-ink/80">
                      <Check className="h-3.5 w-3.5 shrink-0 text-forest" /> {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[0.6rem] leading-4 text-ink/60">{content.confirmation_checklist_note}</p>
              </div>
            )}
          </div>

          <div className="print-card rounded-3xl border border-line bg-white/95 p-5 shadow-card backdrop-blur-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">{content.confirmation_invoice_eyebrow}</p>
                <h2 className="mt-1 text-lg font-extrabold tracking-tight">{content.confirmation_invoice_title}</h2>
                <p className="mt-1 break-all font-mono text-[0.6rem] text-muted">{invoiceNo}</p>
              </div>
              <StatusPill status={bookingPaymentState(booking)} />
            </div>

            <div className="mt-4 space-y-1.5 rounded-2xl border border-line/70 bg-gradient-to-br from-paper to-white p-4 text-[0.72rem]">
              <div className="flex justify-between"><span className="text-muted">{content.confirmation_line_rental_base}</span><span className="font-bold">{inr(booking.baseTotal)}</span></div>
              {booking.extras?.map((extra) => (
                <div key={extra.key} className="flex justify-between"><span className="text-muted">{extra.label}</span><span className="font-bold">{inr(extra.pricePerDay * booking.days)}</span></div>
              ))}
              <div className="flex justify-between"><span className="text-muted">{content.confirmation_line_insurance.replace('{name}', booking.insurance?.label || content.confirmation_insurance_fallback)}</span><span className="font-bold">{booking.insuranceTotal ? inr(booking.insuranceTotal) : content.checkout_included}</span></div>
              {booking.oneWayFee > 0 && <div className="flex justify-between"><span className="text-muted">{content.checkout_one_way_fee}</span><span className="font-bold">{inr(booking.oneWayFee)}</span></div>}
              {booking.discount > 0 && <div className="flex justify-between text-forest"><span>{content.confirmation_line_promo.replace('{code}', booking.promoCode)}</span><span className="font-bold">−{inr(booking.discount)}</span></div>}
              <div className="flex justify-between"><span className="text-muted">{taxLabel}{taxRate ? ` (${taxRate}%)` : ''}{booking.taxInclusive ? ` · ${content.checkout_tax_included}` : ''}</span><span className="font-bold">{inr(booking.fees)}</span></div>
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-[0.86rem]"><span className="font-extrabold">{content.checkout_total}</span><span className="font-extrabold">{inr(booking.total)}</span></div>
              {grossPaid > 0 ? (
                <div className="flex justify-between text-forest"><span className="font-bold">{content.confirmation_line_paid}</span><span className="font-extrabold">{inr(grossPaid)}</span></div>
              ) : (
                <div className="flex justify-between text-muted"><span>{content.confirmation_line_payment}</span><span className="font-bold">{content.confirmation_line_none_captured}</span></div>
              )}
              {refunded > 0 && <div className="flex justify-between text-rose-700"><span className="font-bold">{content.confirmation_line_refunded}</span><span className="font-bold">−{inr(refunded)}</span></div>}
              {refunded > 0 && netPaid > 0 && <div className="flex justify-between"><span className="text-muted">{content.confirmation_line_net_paid}</span><span className="font-bold">{inr(netPaid)}</span></div>}
              {balance > 0 && <div className="flex justify-between"><span className="text-muted">{content.confirmation_line_balance_due}</span><span className="font-bold">{inr(balance)}</span></div>}
              {Number(booking.creditDue) > 0 && (
                <div className="flex justify-between text-amber-700"><span className="font-bold">{content.confirmation_line_credit_due}</span><span className="font-extrabold">{inr(booking.creditDue)}</span></div>
              )}
            </div>

            {booking.payments?.length > 0 && (
              <div className="mt-4">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.confirmation_line_transactions}</p>
                <div className="mt-2 divide-y divide-line rounded-xl border border-line">
                  {booking.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[0.68rem]">
                      <div>
                        <p className="font-bold">{paymentLabel[payment.kind] || payment.kind}{payment.kind !== 'hold' && payment.last4 ? ` · •••• ${payment.last4}` : ''}</p>
                        <p className="text-[0.6rem] text-muted">{longDate(payment.createdAt)} · {payment.reference || (payment.kind === 'hold' ? content.confirmation_payment_due_at_pickup : content.confirmation_payment_awaiting)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-extrabold">{inr(payment.amount)}</p>
                        <p className="text-[0.58rem] uppercase tracking-wider text-muted">
                          {payment.kind === 'hold'
                            ? closed
                              ? content.confirmation_payment_not_charged
                              : booking.status === 'completed'
                                ? content.confirmation_payment_settled_after
                                : content.confirmation_payment_due_at_pickup
                            : paymentStatusLabel[payment.status] || payment.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 space-y-1 text-[0.58rem] leading-4 text-muted">
              <p>
                {content.company_legal_name}{content.registered_address ? ` · ${content.registered_address}` : ''}
              </p>
              <p>
                {content.gstin ? `GSTIN ${content.gstin} · ` : ''}Invoice {invoiceNo} · {content.confirmation_invoice_generated} {depositInvoiceNote}
              </p>
              {invoiceTaxNote && <p className="mt-1">{invoiceTaxNote}</p>}
            </div>
          </div>
        </div>

        <aside className="space-y-4 no-print">
          {upcoming && (
            <div className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-card backdrop-blur-sm">
              <p className="eyebrow">{content.confirmation_next_eyebrow}</p>
              <div className="mt-4 space-y-4">
                {[
                  ...(pending
                    ? [[content.confirmation_next_pending_title, content.confirmation_next_pending_copy, false]]
                    : [[content.confirmation_next_voucher_title, content.confirmation_next_voucher_copy, true]]),
                  [content.confirmation_next_calendar_title, content.confirmation_next_calendar_copy, false],
                  [content.checkout_pickup_label, content.confirmation_next_pickup_copy.replace('{hub}', booking.pickupLocation), false],
                ].map(([title, copy, done]) => (
                  <div key={title} className="flex gap-3">
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${done ? 'bg-gradient-to-br from-lime to-lime-deep text-ink shadow-sm' : 'border border-line bg-paper text-muted'}`}>
                      {done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </span>
                    <div>
                      <p className="text-[0.74rem] font-extrabold">{title}</p>
                      <p className="mt-0.5 text-[0.65rem] leading-5 text-muted">{copy}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2">
            {upcoming && (
              <button type="button" onClick={() => downloadBookingICS(booking, {
                fallbackName: content.confirmation_vehicle_fallback,
                pickupTitle: content.confirmation_calendar_pickup_title,
                dropoffTitle: content.confirmation_calendar_dropoff_title,
                pickupNote: content.confirmation_calendar_pickup_note,
                dropoffNote: content.confirmation_calendar_dropoff_note,
              })} className="btn btn-lime">
                <CalendarPlus className="h-4 w-4" /> {content.confirmation_add_calendar}
              </button>
            )}
            <button type="button" onClick={() => window.print()} className="btn btn-white">
              <Printer className="h-4 w-4" /> {content.confirmation_print}
            </button>
            <Link to={`/manage?code=${encodeURIComponent(booking.code)}`} className="btn btn-outline">
              {content.confirmation_manage} <ArrowRight className="h-4 w-4" />
            </Link>
            {['pending', 'confirmed'].includes(booking.status) && content.change_request_enabled && (
              <Link to="/account?tab=trips" className="btn btn-outline">
                <CalendarRange className="h-4 w-4" /> {content.amend_change_button}
              </Link>
            )}
            <Link to="/browse" className="btn btn-outline">
              <Car className="h-4 w-4" /> {content.confirmation_book_another}
            </Link>
          </div>

          {upcoming && (
            <div className="relative overflow-hidden rounded-3xl border border-lime-deep/40 bg-gradient-to-br from-lime/25 via-lime/15 to-aqua/15 p-4">
              <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-lime/25 blur-2xl" />
              <p className="relative flex items-center gap-1.5 text-[0.7rem] font-extrabold"><ShieldCheck className="h-4 w-4 text-forest" /> {policy.fullRefundCopy}</p>
              <p className="relative mt-1 text-[0.65rem] leading-5 text-ink/65">{content.confirmation_cancel_note} {policy.partialRefundCopy}</p>
            </div>
          )}

          {booking.customer?.isGuest && (
            <div className="rounded-2xl border border-line bg-paper p-4 text-[0.65rem] leading-5 text-muted">
              <p className="font-extrabold text-ink">{content.confirmation_guest_title}</p>
              <p className="mt-1">
                {content.confirmation_guest_copy.split('{email}')[0]}
                <span className="font-bold text-ink">{booking.customer.email}</span>
                {content.confirmation_guest_copy.split('{email}')[1] || ''}
              </p>
              <Link to="/register" className="mt-2 inline-flex font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">{content.confirmation_guest_cta}</Link>
            </div>
          )}
        </aside>
      </div>

      <ExtendTripModal
        booking={booking}
        open={extendOpen && booking?.status === 'active'}
        onClose={() => setExtendOpen(false)}
        onExtended={() => {
          setExtendOpen(false);
          load(null, true);
        }}
      />
    </div>
  );
}
