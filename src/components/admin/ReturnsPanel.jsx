import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Bell, Check, CheckCircle2, ClipboardCheck, Clock, Fuel, Mail, Phone, Search, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { EmptyState, LoadError, Modal, SearchField } from '../../components/ui.jsx';
import ExtendReturnForm from './ExtendReturnForm.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { getSiteContent, lateChargeFor, lateFeeTermsText } from '../../lib/site.js';
import { cn, inr, shortDate, timeLabel } from '../../lib/format.js';
import {
  FUEL_LEVELS, REFUND_METHOD_LABELS, REFUND_METHODS, RETURN_CHECK_KEYS, RETURN_CHECK_LABELS, SEVERITIES, filterReturnBookings, isReturnOpen, lateDays, lateDuration, lateRepeatOffenders, maxAwaitingDays, returnChecklist, settlementFor, settlementWaitDays,
} from '../../lib/returns.js';
import {
  CLEANLINESS, CLEANLINESS_LABELS, inspectionLine, inspectionProblems, kmDriven,
} from '../../lib/inspection.js';
import { excessKm } from '../../lib/km.js';
import { addDaysISO, todayISO } from '../../lib/pricing.js';

const TONE = {
  ok: 'bg-forest/15 text-forest border-forest/30',
  todo: 'bg-amber-50 border-amber-200 text-amber-900',
  warn: 'bg-coral/15 text-ink border-coral/30',
  info: 'bg-aqua/15 text-forest border-aqua/30',
};

const chargedChecks = (booking) => RETURN_CHECK_KEYS.filter((key) => booking.returnChecks?.[key]);

const defaultsFor = (booking) => ({
  fuel: booking.inspection?.fuel ?? 'Full',
  odometer: booking.inspection?.odometer ?? '',
  cleanliness: booking.inspection?.cleanliness ?? 'clean',
  severity: booking.inspection?.severity ?? 'none',
  damageFee: booking.inspection?.damageFee ?? 0,
  cleaningFee: booking.inspection?.cleaningFee ?? 0,
  fuelFee: booking.inspection?.fuelFee ?? 0,
  // Blank means "use the live auto charge"; typing a number overrides it.
  lateFee: '',
  damageNote: booking.inspection?.damageNote ?? '',
  waiveKm: Boolean(booking.depositSettlement?.kmWaived),
  refundMethod: booking.depositSettlement?.refundMethod ?? 'original',
});

export default function ReturnsPanel() {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = getSiteContent(meta.settings);
  const policy = content.policy;
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [checks, setChecks] = useState(new Map());
  const [forms, setForms] = useState({});
  const [dirty, setDirty] = useState(new Set());
  const [feeDirty, setFeeDirty] = useState(new Set());
  const [lateDirty, setLateDirty] = useState(new Set());
  const [settleTarget, setSettleTarget] = useState(null);
  const [extendFor, setExtendFor] = useState(null);
  const [reminding, setReminding] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const requestGuard = useRequestGuard();
  const today = todayISO();

  // The admin hourly policy is the one authoritative figure. The desk's late
  // fee is computed from the exact drop-off time (hourly, grace-aware, capped
  // at a full day) with the same helper the customer's live meter uses, and it
  // stays editable for goodwill or a manual waiver.
  const autoCharge = (booking) => lateChargeFor(booking, content.policy, new Date());

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const rows = await api.adminReturnBookings();
      if (!requestGuard.isCurrent(guard)) return;
      setBookings(rows);
      const nextChecks = new Map();
      const nextForms = {};
      rows.forEach((booking) => {
        nextChecks.set(booking.id, new Set(chargedChecks(booking)));
        nextForms[booking.id] = defaultsFor(booking);
      });
      setChecks(nextChecks);
      setForms(nextForms);
      setDirty(new Set());
      setFeeDirty(new Set());
      setLateDirty(new Set());
    } catch (error) {
      if (!requestGuard.isCurrent(guard)) return;
      setLoadError(error.message);
      push(error.message, 'error');
    } finally {
      if (requestGuard.isCurrent(guard)) setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const toggle = (id, key) => {
    setChecks((current) => {
      const entry = new Set(current.get(id) ?? []);
      if (entry.has(key)) entry.delete(key); else entry.add(key);
      const next = new Map(current);
      next.set(id, entry);
      return next;
    });
    setDirty((current) => new Set([...current, id]));
  };

  const setField = (id, key, value) => {
    setForms((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
    setFeeDirty((current) => new Set([...current, id]));
  };

  const setLateFee = (id, value) => {
    setField(id, 'lateFee', value);
    setLateDirty((current) => new Set([...current, id]));
  };

  const resetLateFee = (id) => {
    setForms((current) => ({ ...current, [id]: { ...current[id], lateFee: '' } }));
    setLateDirty((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const saveChecks = async (booking) => {
    setBusy(true);
    try {
      const checked = [...(checks.get(booking.id) ?? [])];
      await api.adminSaveReturnChecks({ bookingId: booking.id, checked });
      // Do not reload: inspection fees are deliberately local until the
      // operator settles, and a reload would erase edits made before this save.
      setBookings((current) => current.map((row) => (
        row.id === booking.id
          ? { ...row, returnChecks: Object.fromEntries(checked.map((key) => [key, true])) }
          : row
      )));
      setDirty((current) => {
        const next = new Set(current);
        next.delete(booking.id);
        return next;
      });
      push(content.desk_saved_checks, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    if (!settleTarget || busy) return;
    const form = forms[settleTarget.id] ?? defaultsFor(settleTarget);
    const pickupOdometer = settleTarget.pickupInspection?.odometer ?? settleTarget.pickupOdometer ?? null;
    const problems = inspectionProblems(
      { odometer: form?.odometer, fuel: form?.fuel, cleanliness: form?.cleanliness, note: form?.damageNote },
      { minOdometer: pickupOdometer, requireOdometer: pickupOdometer !== null },
    );
    if (problems.length) {
      push(problems[0], 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await api.adminSettleReturn({
        bookingId: settleTarget.id,
        checked: [...(checks.get(settleTarget.id) ?? [])],
        ...form,
        // Send the live hourly charge unless the operator typed an override.
        lateFee: lateDirty.has(settleTarget.id) ? form?.lateFee : autoCharge(settleTarget).charge,
        lateFeePerDay: 0,
        waiveKm: Boolean(form?.waiveKm),
      });
      const label = result?.settlement?.extraDue > 0
        ? `${content.return_extra_due}: ${inr(result.settlement.extraDue)}`
        : result?.settlement?.refundDue > 0
          ? `${content.return_refund_due}: ${inr(result.settlement.refundDue)}`
          : '';
      push(`${content.return_settled}${label ? ` ${label}` : ''}`, 'success');
      setSettleTarget(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remind = async (booking) => {
    if (reminding.has(booking.id)) return;
    setReminding((current) => new Set([...current, booking.id]));
    try {
      await api.sendReturnReminder({ bookingId: booking.id });
      push(content.return_reminded, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setReminding((current) => {
        const next = new Set(current);
        next.delete(booking.id);
        return next;
      });
    }
  };

  const remindAll = async () => {
    const overdueRows = bookings.filter((row) => row.status === 'active' && lateDays(row, today) > 0);
    if (!overdueRows.length) return;
    const results = await Promise.allSettled(overdueRows.map((row) => api.sendReturnReminder({ bookingId: row.id })));
    const ok = results.filter((result) => result.status === 'fulfilled').length;
    push(
      content.return_reminded_all
        .replace('{count}', String(ok))
        .replace('{s}', ok === 1 ? '' : 's'),
      ok ? 'success' : 'error',
    );
    await load();
  };

  const visible = useMemo(() => filterReturnBookings(bookings, query), [bookings, query]);
  // Master switch (Admin → Settings → Operational reminders) hides the reminder
  // buttons; the server enforces the same toggle, so off means off everywhere.
  const remindersOn = content.policy.operationalReminders !== false;

  const groups = useMemo(() => {
    const completed = [];
    const overdue = [];
    const dueToday = [];
    const next7 = [];
    const later = [];
    const horizon = addDaysISO(today, 7);
    visible.forEach((booking) => {
      const days = lateDays(booking, today);
      if (booking.status === 'completed') completed.push(booking);
      else if (days > 0) overdue.push(booking);
      else if (booking.endDate === today) dueToday.push(booking);
      else if (booking.endDate <= horizon) next7.push(booking);
      else later.push(booking);
    });
    return [
      { key: 'completed', label: content.return_completed_group, tone: 'text-forest', rows: completed },
      { key: 'overdue', label: content.return_overdue_group, tone: 'text-coral', rows: overdue },
      { key: 'today', label: content.return_due_today, tone: 'text-forest', rows: dueToday },
      { key: 'next7', label: content.return_next7, tone: 'text-muted', rows: next7 },
      { key: 'later', label: content.return_later, tone: 'text-muted', rows: later },
    ].filter((group) => group.rows.length);
  }, [visible, today, content.return_completed_group, content.return_overdue_group, content.return_due_today, content.return_next7, content.return_later]);

  if (loading && !bookings.length) {
    return <div className="h-64 animate-pulse rounded-3xl bg-stone-200/70" />;
  }

  const depositsHeld = bookings
    .filter((booking) => isReturnOpen(booking))
    .reduce((sum, booking) => sum + (Number(booking.holdAmount) || 0), 0);
  const overdueCount = bookings.filter((booking) => booking.status === 'active' && lateDays(booking, today) > 0).length;
  // Trips that came back but were never settled: the desk's settlement backlog.
  const awaitingCount = bookings.filter((booking) => booking.status === 'completed' && !booking.depositSettlement).length;
  const oldestWait = maxAwaitingDays(bookings, today);
  // Vehicles that keep coming back late — the desk sees the flag before the
  // next handover, which is the moment a habit is cheapest to interrupt.
  const repeatOffenders = lateRepeatOffenders(bookings, {
    threshold: policy.lateRepeatThreshold,
    today,
  });
  const isRepeatOffender = (booking) => {
    const name = booking.vehicle?.name || booking.vehicleId;
    return Boolean(name) && repeatOffenders.some((row) => row.vehicle === name);
  };

  const renderRow = (booking) => {
    const checked = new Set(checks.get(booking.id) ?? []);
    const form = forms[booking.id] ?? defaultsFor(booking);
    const checklist = returnChecklist(booking, { today, checked: [...checked] });
    const days = checklist.lateDays;
    const autoLate = autoCharge(booking);
    const ready = checklist.ready;
    const pickupOdometer = booking.pickupInspection?.odometer ?? booking.pickupOdometer ?? null;
    const conditionProblems = inspectionProblems(
      { odometer: form.odometer, fuel: form.fuel, cleanliness: form.cleanliness, note: form.damageNote },
      { minOdometer: pickupOdometer, requireOdometer: pickupOdometer !== null },
    );
    const driven = kmDriven({ odometer: pickupOdometer }, { odometer: form.odometer });
    const km = excessKm({
      driven,
      kmCap: booking.kmCap ?? booking.vehicle?.kmCap,
      kmExtraRate: booking.kmExtraRate ?? booking.vehicle?.kmExtraRate,
      startDate: booking.startDate,
      endDate: booking.endDate,
      days: booking.days,
      waived: Boolean(form.waiveKm),
    });
    const preview = settlementFor({
      holdAmount: booking.holdAmount,
      lateDays: days,
      lateFee: lateDirty.has(booking.id) ? form.lateFee : autoLate.charge,
      damageFee: form.damageFee,
      cleaningFee: form.cleaningFee,
      fuelFee: form.fuelFee,
      excessKmFee: km.fee,
    });
    return (
      <section key={booking.id} className="rounded-3xl border border-line bg-white/92 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.62rem] font-bold text-muted">{booking.code}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[0.62rem] font-bold">
              <ArrowRight className="h-3 w-3 text-moss" /> {shortDate(booking.endDate)} · {timeLabel(booking.dropoffTime || '10:00')}
            </span>
            {booking.status === 'completed' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-forest/25 bg-forest/10 px-2 py-0.5 text-[0.58rem] font-extrabold text-forest">
                <CheckCircle2 className="h-3 w-3" /> {content.return_completed_badge}
              </span>
            ) : days > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-coral/30 bg-coral/15 px-2 py-0.5 text-[0.58rem] font-extrabold text-ink">
                <AlertTriangle className="h-3 w-3 text-coral" /> {content.return_overdue.replace('{days}', String(days))}
              </span>
            ) : booking.endDate === today ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-ok/25 bg-ok/10 px-2 py-0.5 text-[0.58rem] font-extrabold text-ok">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" /> {content.return_due_today}
              </span>
            ) : (
              <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[0.58rem] font-bold text-muted">
                {content.return_upcoming.replace('{date}', shortDate(booking.endDate))}
              </span>
            )}
            {(() => {
              const wait = settlementWaitDays(booking, today);
              return booking.status === 'completed' && !booking.depositSettlement && wait > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[0.58rem] font-extrabold text-amber-900"
                  title={content.return_waiting_tip}
                >
                  <Clock className="h-3 w-3" /> {content.return_waiting_days.replace('{days}', String(wait))}
                </span>
              ) : null;
            })()}
            {booking.depositSettlement && (
              <span className="rounded-full bg-forest/10 px-2 py-0.5 text-[0.58rem] font-extrabold text-forest">
                {content.return_settled_badge.replace('{status}', booking.depositSettlement.label || booking.depositSettlement.status)}
              </span>
            )}
            {isRepeatOffender(booking) && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[0.58rem] font-extrabold text-amber-900"
                title={content.return_repeat_offender_tip}
              >
                <AlertTriangle className="h-3 w-3" /> {content.return_repeat_offender}
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 text-[0.62rem] font-bold text-muted">
            <ShieldCheck className="h-3 w-3 text-forest" /> {content.return_deposit_held}: {inr(booking.holdAmount || 0)}
            {booking.depositCollected && (
              <span
                className="text-[0.58rem] font-semibold"
                title={`${booking.depositCollected.method}${booking.depositCollected.reference ? ` · ${booking.depositCollected.reference}` : ''}`}
              >
                · collected {shortDate(booking.depositCollected.at)}
              </span>
            )}
          </span>
        </div>

        <div className="grid gap-3 border-t border-line/70 px-4 py-3.5 sm:px-5 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2">
              <p className="text-sm font-extrabold">{booking.customer?.name || 'Guest'}</p>
              <span className="text-[0.68rem] text-muted">{booking.vehicle?.name || 'Vehicle removed'} · {booking.dropoffLocation || booking.pickupLocation}</span>
              {booking.vehicle?.registrationNumber && (
                <span className="rounded border border-line bg-paper px-1 py-0.5 font-mono text-[0.56rem] font-bold text-muted">{booking.vehicle.registrationNumber}</span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {booking.driver?.phone && <a href={`tel:${String(booking.driver.phone).replace(/[^\d+]/g, '')}`} className="btn btn-ghost btn-sm"><Phone className="h-3 w-3" /> {content.desk_call}</a>}
              {booking.customer?.email && <a href={`mailto:${booking.customer.email}`} className="btn btn-ghost btn-sm"><Mail className="h-3 w-3" /></a>}
              <Link to={`/confirmation/${booking.code}`} className="btn btn-ghost btn-sm">{content.desk_voucher}</Link>
              <Link to={`/admin/bookings?code=${booking.code}`} className="btn btn-ghost btn-sm" title={content.staff_view_booking_tip}>{content.staff_view_booking}</Link>
              {remindersOn && booking.status === 'active' && days > 0 && (
                <button type="button" onClick={() => remind(booking)} disabled={reminding.has(booking.id)} className="btn btn-ghost btn-sm" aria-label={content.return_remind_aria}>
                  <Bell className="h-3 w-3" /> {content.return_remind}
                </button>
              )}
            </div>
            <p className="mt-1 flex items-start gap-1.5 text-[0.6rem] font-semibold text-muted">
              <ClipboardCheck className="mt-0.5 h-3 w-3 shrink-0 text-forest" />
              <span className="min-w-0">Pick-up: {inspectionLine(booking.pickupInspection)}</span>
            </p>

            <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {checklist.checks.map((check) => {
                const on = checked.has(check.key);
                if (check.key === 'late') {
                  return (
                    <div key={check.key} className="flex items-center gap-2 rounded-xl border border-coral/30 bg-coral/10 px-2.5 py-2 text-[0.66rem] font-semibold text-ink sm:col-span-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-coral" /> {check.note}
                    </div>
                  );
                }
                return (
                  <button
                    key={check.key}
                    type="button"
                    onClick={() => toggle(booking.id, check.key)}
                    aria-pressed={on}
                    title={check.note}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition',
                      on ? 'border-forest bg-forest/10 text-forest' : TONE[check.status],
                    )}
                  >
                    <span className={cn('flex h-4.5 w-4.5 items-center justify-center rounded-md border', on ? 'border-forest bg-forest text-cream' : 'border-line bg-white')}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-[0.72rem] font-extrabold">{RETURN_CHECK_LABELS[check.key] || check.key}</span>
                      <span className="block truncate text-[0.58rem] text-muted">{check.note}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {!booking.depositSettlement && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                  {content.return_fuel}
                  <select value={form.fuel} onChange={(event) => setField(booking.id, 'fuel', event.target.value)} className="field mt-1 text-[0.72rem]">
                    {FUEL_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </label>
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                  Odometer (km)
                  <input
                    type="number"
                    min="0"
                    max="2000000"
                    step="1"
                    value={form.odometer}
                    onChange={(event) => setField(booking.id, 'odometer', event.target.value)}
                    placeholder={pickupOdometer !== null ? `${Number(pickupOdometer).toLocaleString('en-IN')}` : 'Return reading'}
                    className="field mt-1 text-[0.72rem]"
                  />
                </label>
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                  Cleanliness
                  <select value={form.cleanliness} onChange={(event) => setField(booking.id, 'cleanliness', event.target.value)} className="field mt-1 text-[0.72rem]">
                    {CLEANLINESS.map((level) => <option key={level} value={level}>{CLEANLINESS_LABELS[level]}</option>)}
                  </select>
                </label>
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                  {content.return_damage}
                  <input type="number" min="0" step="1" value={form.damageFee} onChange={(event) => setField(booking.id, 'damageFee', event.target.value)} className="field mt-1 text-[0.72rem]" />
                </label>
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                  {content.return_severity}
                  <select value={form.severity} onChange={(event) => setField(booking.id, 'severity', event.target.value)} className="field mt-1 text-[0.72rem]">
                    {SEVERITIES.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </label>
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                  {content.return_cleaning}
                  <input type="number" min="0" step="1" value={form.cleaningFee} onChange={(event) => setField(booking.id, 'cleaningFee', event.target.value)} className="field mt-1 text-[0.72rem]" />
                </label>
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                  {content.return_fuel_fee}
                  <span className="mt-1 flex h-[2.25rem] items-center gap-1">
                    <input type="number" min="0" step="1" value={form.fuelFee} onChange={(event) => setField(booking.id, 'fuelFee', event.target.value)} className="field h-full text-[0.72rem]" />
                    <button
                      type="button"
                      onClick={() => setField(booking.id, 'fuelFee', booking.vehicle?.kind === 'bike' ? content.policy?.bikeFuelFee : content.policy?.fuelFee)}
                      disabled={!content.policy?.fuelFee && !content.policy?.bikeFuelFee}
                      className="shrink-0 rounded-lg border border-line bg-white px-1.5 py-1 text-[0.55rem] font-extrabold text-moss transition hover:border-moss/40"
                    >
                      {content.return_fuel_fee_preset.replace('{amount}', inr(booking.vehicle?.kind === 'bike' ? content.policy?.bikeFuelFee : content.policy?.fuelFee))}
                    </button>
                  </span>
                </label>
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                  {content.return_late_fee}
                  <span className="mt-1 flex h-[2.25rem] items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      aria-label={content.return_late_fee}
                      value={lateDirty.has(booking.id) ? form.lateFee : autoLate.charge}
                      onChange={(event) => setLateFee(booking.id, event.target.value)}
                      className="field h-full text-[0.72rem]"
                    />
                    <button
                      type="button"
                      onClick={() => resetLateFee(booking.id)}
                      disabled={!lateDirty.has(booking.id)}
                      className="shrink-0 rounded-lg border border-line bg-white px-1.5 py-1 text-[0.55rem] font-extrabold text-moss transition hover:border-moss/40 disabled:opacity-40"
                    >
                      {content.return_late_fee_reset}
                    </button>
                  </span>
                  <span className="mt-0.5 block text-[0.52rem] font-semibold normal-case tracking-normal text-muted">
                    {autoLate.hours > 0
                      ? content.return_late_fee_auto
                        .replace('{duration}', lateDuration(autoLate.hours))
                        .replace('{hourly}', inr(autoLate.hourlyRate))
                        .replace('{daily}', inr(autoLate.dailyRate))
                      : content.return_late_fee_none}
                  </span>
                </label>
                <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted sm:col-span-2 lg:col-span-1">
                  {content.return_note}
                  <input value={form.damageNote} onChange={(event) => setField(booking.id, 'damageNote', event.target.value)} maxLength={500} placeholder="Scratch on rear bumper…" className="field mt-1 text-[0.72rem]" />
                </label>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-paper/60 p-3">
            <p className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">Settlement preview</p>
            <dl className="mt-1.5 space-y-1 text-[0.68rem]">
              <div className="flex justify-between"><dt className="text-muted">{content.return_deposit_held}</dt><dd className="font-bold">{inr(preview.deposit)}</dd></div>
              {driven !== null && (
                <div className="flex justify-between">
                  <dt className="text-muted">Driven this trip</dt>
                  <dd className="font-bold">{driven.toLocaleString('en-IN')} km</dd>
                </div>
              )}
              {km.limited && (
                <>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">
                      {content.return_km_allowance
                        .replace('{allowance}', Number(km.allowance || 0).toLocaleString('en-IN'))
                        .replace('{driven}', km.driven === null ? '—' : km.driven.toLocaleString('en-IN'))}
                    </dt>
                    <dd className={cn('shrink-0 font-bold', km.excess > 0 ? 'text-coral' : 'text-forest')}>
                      {km.excess > 0
                        ? content.return_km_excess
                          .replace('{excess}', km.excess.toLocaleString('en-IN'))
                          .replace('{rate}', inr(km.rate))
                        : content.return_km_within}
                    </dd>
                  </div>
                  {km.excess > 0 && (
                    <label className="flex items-start gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5 text-[0.6rem] font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={Boolean(form.waiveKm)}
                        onChange={(event) => setField(booking.id, 'waiveKm', event.target.checked)}
                        className="mt-0.5 h-3 w-3 rounded border-line accent-forest"
                      />
                      <span className="min-w-0">
                        {form.waiveKm ? content.return_km_waived : content.return_km_waive}
                        <span className="block text-[0.55rem] font-medium text-muted">
                          {form.waiveKm ? 'No charge applies' : `−${inr(km.fee)}`}
                        </span>
                      </span>
                    </label>
                  )}
                </>
              )}
              {(autoLate.hours > 0 || preview.lateFee > 0) && (
                <div className="flex justify-between">
                  <dt className="text-muted">{content.return_late_fee}{autoLate.hours > 0 ? ` · ${lateDuration(autoLate.hours)}` : ''}</dt>
                  <dd className={cn('font-bold', preview.lateFee === 0 ? 'text-muted' : 'text-coral')}>−{inr(preview.lateFee)}</dd>
                </div>
              )}
              {autoLate.hours > 0 && preview.lateFee === 0 && (
                <p className="mt-1 flex items-start gap-1 rounded-lg border border-coral/30 bg-coral/10 px-2 py-1.5 text-[0.6rem] font-semibold text-ink">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-coral" />
                  <span className="min-w-0">{content.return_late_fee_zero.replace('{amount}', inr(0)).replace('{duration}', lateDuration(autoLate.hours))}</span>
                </p>
              )}
              {preview.lateFee > (Number(booking.total) || 0) && (
                <p className="mt-1 flex items-start gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[0.6rem] font-semibold text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                  <span className="min-w-0">{content.return_late_fee_high.replace('{amount}', inr(booking.total || 0))}</span>
                </p>
              )}
              {preview.damageFee > 0 && <div className="flex justify-between"><dt className="text-muted">{content.return_damage}</dt><dd className="font-bold text-coral">−{inr(preview.damageFee)}</dd></div>}
              {preview.cleaningFee > 0 && <div className="flex justify-between"><dt className="text-muted">{content.return_cleaning}</dt><dd className="font-bold text-coral">−{inr(preview.cleaningFee)}</dd></div>}
              {preview.fuelFee > 0 && <div className="flex justify-between"><dt className="text-muted">{content.return_fuel_fee}</dt><dd className="font-bold text-coral">−{inr(preview.fuelFee)}</dd></div>}
              {preview.excessKmFee > 0 && <div className="flex justify-between"><dt className="text-muted">Excess distance</dt><dd className="font-bold text-coral">−{inr(preview.excessKmFee)}</dd></div>}
              <div className="flex justify-between border-t border-line pt-1"><dt className="font-extrabold">{content.return_charges}</dt><dd className="font-extrabold">{inr(preview.charges)}</dd></div>
              <div className="flex justify-between">
                <dt className="font-extrabold text-forest">{preview.extraDue > 0 ? content.return_extra_due : content.return_refund_due}</dt>
                <dd className={cn('font-extrabold', preview.extraDue > 0 ? 'text-coral' : 'text-forest')}>{inr(preview.extraDue > 0 ? preview.extraDue : preview.refundDue)}</dd>
              </div>
            </dl>
            <button type="button" onClick={() => saveChecks(booking)} disabled={busy || !dirty.has(booking.id)} className="btn btn-white btn-sm mt-2.5 w-full">
              <ClipboardCheck className="h-3.5 w-3.5" /> {content.desk_save_checks}
            </button>
            {feeDirty.has(booking.id) && (
              <p className="mt-1 text-center text-[0.58rem] font-semibold text-amber-800">{content.return_fee_pending}</p>
            )}
            <button
              type="button"
              onClick={() => setSettleTarget(booking)}
              disabled={busy || !ready || conditionProblems.length > 0}
              title={conditionProblems[0] || (ready ? '' : content.return_remaining.replace('{count}', String(RETURN_CHECK_KEYS.length - checked.size)).replace('{s}', RETURN_CHECK_KEYS.length - checked.size === 1 ? '' : 's'))}
              className={cn('btn btn-lime btn-sm mt-1.5 w-full', (!ready || conditionProblems.length > 0) && 'cursor-not-allowed opacity-50')}
            >
              <Sparkles className="h-3.5 w-3.5" /> {content.return_settle}
            </button>
            {booking.status === 'active' && (
              <button
                type="button"
                onClick={() => setExtendFor(extendFor === booking.id ? null : booking.id)}
                className={cn('btn btn-outline btn-sm mt-1.5 w-full', extendFor === booking.id && 'border-moss text-moss')}
              >
                <Clock className="h-3.5 w-3.5" /> {content.extend_extension_chip}
              </button>
            )}
            {conditionProblems.length > 0 && (
              <p className="mt-1 text-center text-[0.58rem] font-semibold text-coral">{conditionProblems[0]}</p>
            )}
            {!ready && (
              <p className="mt-1 text-center text-[0.58rem] text-muted">
                {content.return_remaining.replace('{count}', String(RETURN_CHECK_KEYS.length - checked.size)).replace('{s}', RETURN_CHECK_KEYS.length - checked.size === 1 ? '' : 's')}
              </p>
            )}
          </div>
        </div>
        {extendFor === booking.id && (
          <ExtendReturnForm
            booking={booking}
            onApplied={() => { setExtendFor(null); load(); }}
            onClose={() => setExtendFor(null)}
          />
        )}
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-[0.7rem]">
        <span className="inline-flex items-center gap-1.5"><ArrowRight className="h-3.5 w-3.5 text-muted" /> {bookings.length} open return{bookings.length === 1 ? '' : 's'}</span>
        <span className="h-4 w-px bg-line" />
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className={cn('h-3.5 w-3.5', overdueCount ? 'text-coral' : 'text-muted')} /> {overdueCount} overdue</span>
        <span className="h-4 w-px bg-line" />
        {awaitingCount > 0 && (
          <span className="inline-flex items-center gap-1.5" title={content.return_awaiting_tip}>
            <ShieldCheck className="h-3.5 w-3.5 text-amber-700" /> {awaitingCount} ready to settle{oldestWait > 0 ? ` · oldest ${oldestWait}d` : ''}
          </span>
        )}
        {awaitingCount > 0 && <span className="h-4 w-px bg-line" />}
        {repeatOffenders.length > 0 && (
          <>
            <span className="inline-flex items-center gap-1.5" title={content.return_repeat_offender_tip}>
              <AlertTriangle className={cn('h-3.5 w-3.5', repeatOffenders.length ? 'text-amber-700' : 'text-muted')} /> {repeatOffenders.length} repeat offender{repeatOffenders.length === 1 ? '' : 's'}
            </span>
            <span className="h-4 w-px bg-line" />
          </>
        )}
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-forest" /> {inr(depositsHeld)} deposits held</span>
        {remindersOn && overdueCount > 0 && (
          <button
            type="button"
            onClick={remindAll}
            disabled={busy || reminding.size > 0}
            className="btn btn-ghost btn-sm"
          >
            <Bell className="h-3.5 w-3.5" /> {content.return_remind_all}
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[0.62rem] text-muted"><Fuel className="h-3 w-3" /> {content.return_fee_default_note.replace('{terms}', lateFeeTermsText(content.late_fee_terms, content.policy))}</span>
      </div>

      {bookings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={content.return_search_placeholder}
            label={content.return_search_aria}
            className="min-w-[13rem] flex-1"
          />
          <span className="text-[0.62rem] font-bold text-muted" aria-live="polite">
            {content.return_showing.replace('{shown}', String(visible.length)).replace('{total}', String(bookings.length))}
          </span>
        </div>
      )}

      {loadError && !bookings.length ? (
        <LoadError
          title="Returns could not load"
          message={loadError}
          hint="Do not settle anything until this list reloads — the fees and deposits shown would be incomplete."
          onRetry={() => load()}
        />
      ) : !bookings.length ? (
        <EmptyState icon={ArrowRight} title={content.desk_returns_empty} description={content.desk_returns_empty_copy} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={content.return_no_match}
          description={content.return_no_match_copy}
          action={<button type="button" onClick={() => setQuery('')} className="btn btn-white">{content.return_clear_filters}</button>}
        />
      ) : (
        groups.map((group) => (
          <div key={group.key} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className={cn('text-sm font-extrabold', group.tone)}>{group.label}</h2>
              <span className="rounded-full bg-paper px-2 py-0.5 text-[0.58rem] font-extrabold text-muted">{group.rows.length}</span>
            </div>
            {group.rows.map(renderRow)}
          </div>
        ))
      )}

      <Modal
        open={Boolean(settleTarget)}
        onClose={() => (busy ? null : setSettleTarget(null))}
        title={content.return_settle_confirm}
        description={settleTarget?.code}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setSettleTarget(null)} disabled={busy} className="btn btn-white flex-1">Not yet</button>
            <button type="button" onClick={settle} disabled={busy} className="btn btn-dark flex-1">
              {busy ? content.return_settling : content.return_settle}
            </button>
          </div>
        )}
      >
        {settleTarget && (() => {
          const form = forms[settleTarget.id] ?? defaultsFor(settleTarget);
          const pickupOdometer = settleTarget.pickupInspection?.odometer ?? settleTarget.pickupOdometer ?? null;
          const driven = kmDriven({ odometer: pickupOdometer }, { odometer: form.odometer });
          const km = excessKm({
            driven,
            kmCap: settleTarget.kmCap ?? settleTarget.vehicle?.kmCap,
            kmExtraRate: settleTarget.kmExtraRate ?? settleTarget.vehicle?.kmExtraRate,
            startDate: settleTarget.startDate,
            endDate: settleTarget.endDate,
            days: settleTarget.days,
            waived: Boolean(form.waiveKm),
          });
          const preview = settlementFor({
            holdAmount: settleTarget.holdAmount,
            lateDays: lateDays(settleTarget, today),
            lateFee: lateDirty.has(settleTarget.id) ? form.lateFee : autoCharge(settleTarget).charge,
            damageFee: form.damageFee,
            cleaningFee: form.cleaningFee,
            fuelFee: form.fuelFee,
            excessKmFee: km.fee,
          });
          return (
            <div className="space-y-2 text-[0.72rem]">
              <p className="text-muted">{content.return_settle_copy}</p>
              <div className="rounded-2xl border border-line bg-paper/70 p-3">
                <p className="flex justify-between"><span className="text-muted">{content.return_deposit_held}</span><span className="font-bold">{inr(preview.deposit)}</span></p>
                {preview.lateFee > 0 && (
                  <p className="flex justify-between"><span className="text-muted">{content.return_late_fee}</span><span className="font-bold text-coral">−{inr(preview.lateFee)}</span></p>
                )}
                {preview.damageFee > 0 && (
                  <p className="flex justify-between"><span className="text-muted">{content.return_damage}</span><span className="font-bold text-coral">−{inr(preview.damageFee)}</span></p>
                )}
                {preview.cleaningFee > 0 && (
                  <p className="flex justify-between"><span className="text-muted">{content.return_cleaning}</span><span className="font-bold text-coral">−{inr(preview.cleaningFee)}</span></p>
                )}
                {preview.excessKmFee > 0 && (
                  <p className="flex justify-between"><span className="text-muted">Excess distance</span><span className="font-bold text-coral">−{inr(preview.excessKmFee)}</span></p>
                )}
                {preview.fuelFee > 0 && (
                  <p className="flex justify-between"><span className="text-muted">{content.return_fuel_fee}</span><span className="font-bold text-coral">−{inr(preview.fuelFee)}</span></p>
                )}
                <p className="flex justify-between"><span className="text-muted">{content.return_charges}</span><span className="font-bold">{inr(preview.charges)}</span></p>
                <p className="mt-1 flex justify-between border-t border-line pt-1">
                  <span className="font-extrabold text-forest">{preview.extraDue > 0 ? content.return_extra_due : content.return_refund_due}</span>
                  <span className={cn('font-extrabold', preview.extraDue > 0 ? 'text-coral' : 'text-forest')}>{inr(preview.extraDue > 0 ? preview.extraDue : preview.refundDue)}</span>
                </p>
              </div>
              {km.limited && km.excess > 0 && (
                <label className="flex items-start gap-2 rounded-xl border border-line bg-white px-2.5 py-2 text-[0.66rem] font-semibold">
                  <input
                    type="checkbox"
                    checked={Boolean(form.waiveKm)}
                    onChange={(event) => setField(settleTarget.id, 'waiveKm', event.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-line accent-forest"
                  />
                  <span className="min-w-0">
                    {form.waiveKm ? content.return_km_waived : `${content.return_km_waive} · −${inr(km.fee)}`}
                  </span>
                </label>
              )}
              {preview.refundDue > 0 && (
                <label className="block" htmlFor="settle-refund-method">
                  <span className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">{content.return_refund_method_label}</span>
                  <select
                    id="settle-refund-method"
                    value={form.refundMethod ?? 'original'}
                    onChange={(event) => setField(settleTarget.id, 'refundMethod', event.target.value)}
                    className="field mt-1"
                  >
                    {REFUND_METHODS.map((method) => <option key={method} value={method}>{(REFUND_METHOD_LABELS[method] || method).replace(/^\w/, (char) => char.toUpperCase())}</option>)}
                  </select>
                </label>
              )}
              <p className="flex items-center gap-1.5 text-[0.64rem] text-muted"><X className="h-3 w-3" /> This closes the trip and notifies the customer.</p>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
