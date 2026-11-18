import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Bell, CalendarCheck, Check, ClipboardCheck, Mail, Phone, Search, ShieldCheck, User, UserX, X,
} from 'lucide-react';
import { EmptyState, LoadError, Modal, PageLoader, SearchField, StatusPill } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import ReturnsPanel from '../../components/admin/ReturnsPanel.jsx';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { getSiteContent } from '../../lib/site.js';
import { cn, inr, longDate, timeLabel } from '../../lib/format.js';
import { activeChecks, DESK_CHECK_KEYS, deskBoardCounts, deskChecklist, deskReady, filterDeskBookings, pickupReminderEligible } from '../../lib/desk.js';
import { kmDisclosure } from '../../lib/km.js';
import { FUEL_LEVELS } from '../../lib/returns.js';
import {
  CLEANLINESS, CLEANLINESS_LABELS, DAMAGE_AREAS, inspectionProblems,
} from '../../lib/inspection.js';
import { daysBetween, todayISO } from '../../lib/pricing.js';

const DEPOSIT_METHOD_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card / POS', transfer: 'Bank transfer', other: 'Other' };

const READY_TONE = {
  ok: 'bg-forest/15 text-forest border-forest/30',
  todo: 'bg-amber-50 border-amber-200 text-amber-900',
  warn: 'bg-coral/15 text-ink border-coral/30',
  info: 'bg-aqua/15 text-forest border-aqua/30',
};

const DOC_TONE = {
  expired: 'border-coral/40 bg-coral/10 text-ink',
  expiring: 'border-sun/50 bg-sun/15 text-ink',
  untracked: 'border-line bg-paper text-muted',
};

export default function Desk() {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const policy = content.policy;
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [checks, setChecks] = useState(new Map());
  const [dirty, setDirty] = useState(new Set());
  const [startTarget, setStartTarget] = useState(null);
  const [handover, setHandover] = useState({ odometer: '', fuel: '', cleanliness: 'clean', damage: [], note: '' });
  const [noShowTarget, setNoShowTarget] = useState(null);
  const [noShowRefund, setNoShowRefund] = useState(false);
  const [collectTarget, setCollectTarget] = useState(null);
  const [collectForm, setCollectForm] = useState({ amount: '', method: 'cash', reference: '' });
  const [collecting, setCollecting] = useState(false);
  const [remindingPickups, setRemindingPickups] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const requestGuard = useRequestGuard();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'returns' ? 'returns' : 'pickups';
  const setTab = (key) => setParams(key === 'returns' ? { tab: 'returns' } : {}, { replace: true });

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const rows = await api.adminDeskBookings();
      if (!requestGuard.isCurrent(guard)) return;
      setBookings(rows);
      const next = new Map();
      rows.forEach((booking) => {
        // A recorded collection IS the deposit-handled proof: seed the deposit
        // box ticked so the optional gate stays satisfied after a reload.
        if (!next.has(booking.id)) {
          next.set(booking.id, new Set([
            ...activeChecks(booking.deskChecks),
            ...(booking.depositCollected ? ['deposit'] : []),
          ]));
        }
      });
      setChecks(next);
      setDirty(new Set());
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

  // Readiness must follow what the operator has ticked right now, not only the
  // last save — otherwise a deposit tick would appear to do nothing until the
  // checklist is saved. The start action persists the ticks before flipping
  // the status, so the live view and the stored record stay in lockstep.
  const liveChecksFor = (booking) => {
    const saved = checks.get(booking.id);
    if (!saved) return booking;
    return {
      ...booking,
      deskChecks: Object.fromEntries(DESK_CHECK_KEYS.map((key) => [key, saved.has(key)])),
    };
  };

  const saveChecks = async (booking) => {
    setBusy(true);
    try {
      const checked = [...(checks.get(booking.id) ?? [])];
      await api.adminSaveDeskChecks({ bookingId: booking.id, checked });
      // Do not reload: a reload would wipe toggles another row has queued
      // while this save was in flight. Only the saved row is refreshed here.
      setBookings((current) => current.map((row) => (
        row.id === booking.id
          ? { ...row, deskChecks: checked.reduce((all, key) => ({ ...all, [key]: true }), {}) }
          : row
      )));
      const dirtyNext = new Set(dirty);
      dirtyNext.delete(booking.id);
      setDirty(dirtyNext);
      push(content.desk_saved_checks, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openCollect = (booking) => {
    setCollectForm({ amount: String(booking.holdAmount || ''), method: 'cash', reference: '' });
    setCollectTarget(booking);
  };

  const collectDeposit = async () => {
    if (!collectTarget || busy || collecting) return;
    const amount = Number(collectForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      push(content.desk_deposit_amount_error, 'error');
      return;
    }
    if (Number(collectTarget.holdAmount) > 0 && amount > Number(collectTarget.holdAmount)) {
      push(content.desk_deposit_amount_over, 'error');
      return;
    }
    setCollecting(true);
    try {
      const updated = await api.adminCollectDeposit({
        bookingId: collectTarget.id,
        amount,
        method: collectForm.method,
        reference: collectForm.reference,
      });
      // Recording the money IS the deposit-handled proof: tick the deposit box
      // (and persist it) so the optional deposit gate flips with the record.
      const checked = [...new Set([...(checks.get(collectTarget.id) ?? []), 'deposit'])];
      setChecks((current) => {
        const nextSk = new Map(current);
        nextSk.set(collectTarget.id, new Set(checked));
        return nextSk;
      });
      setDirty((current) => new Set([...current, collectTarget.id]));
      setBookings((current) => current.map((row) => (
        row.id === collectTarget.id
          ? { ...row, ...(updated ?? {}), deskChecks: { ...(row.deskChecks ?? {}), deposit: true } }
          : row
      )));
      await api.adminSaveDeskChecks({ bookingId: collectTarget.id, checked });
      push(content.desk_deposit_collected_success, 'success');
      setCollectTarget(null);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setCollecting(false);
    }
  };

  const remindablePickups = () => bookings.filter((booking) => (
    pickupReminderEligible(booking, today) && booking.lastPickupReminderDay !== today
  ));

  // The master switch (Admin → Settings → Operational reminders) hides the
  // reminder controls entirely; the server enforces it too, so off means off.
  const remindersOn = content.policy.operationalReminders !== false;

  const remindPickup = async (booking) => {
    if (remindingPickups.has(booking.id)) return;
    setRemindingPickups((current) => new Set([...current, booking.id]));
    try {
      await api.sendPickupReminder({ bookingId: booking.id });
      setBookings((current) => current.map((row) => (
        row.id === booking.id ? { ...row, lastPickupReminderDay: today } : row
      )));
      push(content.desk_pickup_reminded, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setRemindingPickups((current) => {
        const next = new Set(current);
        next.delete(booking.id);
        return next;
      });
    }
  };

  const remindAllPickups = async () => {
    const rows = remindablePickups();
    if (!rows.length) return;
    const results = await Promise.allSettled(rows.map((row) => api.sendPickupReminder({ bookingId: row.id })));
    const ok = results.filter((result) => result.status === 'fulfilled').length;
    await load();
    push(
      content.desk_reminded_pickups
        .replace('{count}', String(ok))
        .replace('{s}', ok === 1 ? '' : 's'),
      ok ? 'success' : 'error',
    );
  };

  const handoverProblems = startTarget ? inspectionProblems(handover) : [];
  const startKm = startTarget
    ? kmDisclosure({
      kmCap: startTarget.kmCap ?? startTarget.vehicle?.kmCap,
      kmExtraRate: startTarget.kmExtraRate ?? startTarget.vehicle?.kmExtraRate,
    })
    : null;

  const openStart = (booking) => {
    setHandover({ odometer: '', fuel: '', cleanliness: 'clean', damage: [], note: '' });
    setStartTarget(booking);
  };

  const toggleDamage = (key) => {
    setHandover((current) => ({
      ...current,
      damage: current.damage.includes(key)
        ? current.damage.filter((item) => item !== key)
        : [...current.damage, key],
    }));
  };

  const startTrip = async () => {
    if (!startTarget || busy) return;
    setBusy(true);
    try {
      // The checklist is the record of what was verified at handover. Persist
      // it before the status flip so an operator who ticks the boxes and hits
      // Start never loses the audit trail (and a failed save blocks the start).
      if (dirty.has(startTarget.id)) {
        await api.adminSaveDeskChecks({
          bookingId: startTarget.id,
          checked: [...(checks.get(startTarget.id) ?? [])],
        });
      }
      await api.adminStartTrip({ bookingId: startTarget.id, inspection: handover });
      push(content.desk_started, 'success');
      setStartTarget(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const markNoShow = async () => {
    if (!noShowTarget || busy) return;
    setBusy(true);
    try {
      await api.adminMarkNoShow({ bookingId: noShowTarget.id, refund: noShowRefund });
      push(content.desk_no_show_done, 'success');
      setNoShowTarget(null);
      setNoShowRefund(false);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openNoShow = (booking) => {
    setNoShowRefund(false);
    setNoShowTarget(booking);
  };

  const today = todayISO();
  const boardCounts = useMemo(() => deskBoardCounts(bookings, { today, policy }), [bookings, today, policy]);
  const visible = useMemo(
    () => filterDeskBookings(bookings, { query, scope, today, policy }),
    [bookings, query, scope, today, policy],
  );
  const grouped = useMemo(() => {
    const order = [];
    const map = new Map();
    visible.forEach((booking) => {
      const date = booking.startDate || 'unknown';
      if (!map.has(date)) { map.set(date, []); order.push(date); }
      map.get(date).push(booking);
    });
    return { order, map };
  }, [visible]);

  if (loading && !bookings.length) return <PageLoader />;

  const bookedAhead = bookings.reduce((sum, booking) => sum + (Number(booking.total) || 0), 0);
  const todayRows = bookings.filter((booking) => booking.startDate === today);
  const todayReady = todayRows.filter((booking) => deskReady(liveChecksFor(booking), policy, today)).length;
  const filtersActive = Boolean(query.trim()) || scope !== 'all';

  // Compliance signals across every pick-up on the board — one lapsed document
  // is enough to void a rental, so it belongs in the header, not buried in a row.
  const docAlerts = bookings.reduce((totals, booking) => {
    deskChecklist(booking, policy).docWarnings.forEach((doc) => {
      if (doc.status === 'expired') totals.expired += 1;
      else if (doc.status === 'expiring') totals.expiring += 1;
    });
    return totals;
  }, { expired: 0, expiring: 0 });

  const startChecklist = startTarget ? deskChecklist(liveChecksFor(startTarget), policy) : null;

  const renderChecklist = (booking, checklist) => {
    if (!booking || !checklist) return null;
    const saved = new Set(checks.get(booking.id) ?? []);
    return checklist.checks.map((check) => {
      const on = saved.has(check.key);
      const missing = (check.status === 'todo' || check.status === 'warn') && !on;
      return (
        <button
          key={check.key}
          type="button"
          onClick={() => toggle(booking.id, check.key)}
          aria-pressed={on}
          title={check.note}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition',
            on ? 'border-forest bg-forest/10 text-forest' : READY_TONE[check.status],
            missing ? 'ring-2 ring-inset ring-coral/40' : ''
          )}
        >
          <span className={cn('flex h-4.5 w-4.5 items-center justify-center rounded-md border', on ? 'border-forest bg-forest text-cream' : 'border-line bg-white')}>
            {on && <Check className="h-3 w-3" />}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[0.72rem] font-extrabold">{check.label}</span>
            <span className="block truncate text-[0.58rem] text-muted">{check.note}</span>
          </span>
        </button>
      );
    });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{content.desk_title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted">{tab === 'returns' ? content.desk_returns_subtitle : content.desk_subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-[0.7rem]">
          <span className="inline-flex items-center gap-1.5"><CalendarCheck className="h-3.5 w-3.5 text-muted" /> {longDate(today)}</span>
          {tab === 'pickups' ? (
            <>
              <span className="h-4 w-px bg-line" />
              <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-muted" /> {bookings.length} pick-ups</span>
              {todayRows.length > 0 && (
                <>
                  <span className="h-4 w-px bg-line" />
                  <span
                    className={cn('inline-flex items-center gap-1.5 font-bold', todayReady === todayRows.length ? 'text-forest' : 'text-amber-800')}
                    title={content.desk_ready_today_tip}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {content.desk_ready_today.replace('{ready}', String(todayReady)).replace('{total}', String(todayRows.length))}
                  </span>
                </>
              )}
              <span className="h-4 w-px bg-line" />
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-forest" /> {inr(bookedAhead)} booked ahead</span>
              {docAlerts.expired > 0 && (
                <>
                  <span className="h-4 w-px bg-line" />
                  <span className="inline-flex items-center gap-1.5 font-bold text-rose-700" title={content.desk_docs_blocked}>
                    <AlertTriangle className="h-3.5 w-3.5" /> {docAlerts.expired} expired doc{docAlerts.expired === 1 ? '' : 's'}
                  </span>
                </>
              )}
              {docAlerts.expired === 0 && docAlerts.expiring > 0 && (
                <>
                  <span className="h-4 w-px bg-line" />
                  <span className="inline-flex items-center gap-1.5 font-bold text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5" /> {docAlerts.expiring} doc{docAlerts.expiring === 1 ? '' : 's'} expiring
                  </span>
                </>
              )}
              {remindersOn && (() => {
                const remindable = remindablePickups().length;
                return remindable > 0 ? (
                  <>
                    <span className="h-4 w-px bg-line" />
                    <button
                      type="button"
                      onClick={remindAllPickups}
                      disabled={busy || remindingPickups.size > 0}
                      className="btn btn-ghost btn-sm"
                      title={content.desk_remind_pickups_tip}
                    >
                      <Bell className="h-3.5 w-3.5" /> {content.desk_remind_pickups}
                    </button>
                  </>
                ) : null;
              })()}
            </>
          ) : (
            <>
              <span className="h-4 w-px bg-line" />
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-forest" /> Deposit settlement</span>
            </>
          )}
        </div>
      </header>

      <div className="flex w-fit items-center gap-0.5 rounded-full border border-line bg-white p-1" role="tablist" aria-label="Desk mode">
        {[
          { key: 'pickups', label: content.desk_tab_pickups, icon: ClipboardCheck },
          { key: 'returns', label: content.desk_tab_returns, icon: ArrowRight },
        ].map((option) => {
          const Icon = option.icon;
          const active = tab === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(option.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.66rem] font-extrabold transition',
                active ? 'bg-ink text-lime' : 'text-muted hover:text-ink',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {option.label}
            </button>
          );
        })}
      </div>

      {tab === 'pickups' && bookings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={content.desk_search_placeholder}
            label={content.desk_search_aria}
            className="min-w-[13rem] flex-1"
          />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={content.desk_scope_aria}>
            {[
              { key: 'all', label: content.desk_scope_all, count: boardCounts.all, tone: 'ink' },
              { key: 'today', label: content.desk_scope_today, count: boardCounts.today, tone: 'forest' },
              { key: 'attention', label: content.desk_scope_attention, count: boardCounts.attention, tone: 'coral' },
            ].map((option) => {
              const active = scope === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScope(option.key)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[0.62rem] font-bold transition',
                    active
                      ? option.tone === 'coral'
                        ? 'border-coral bg-coral text-ink'
                        : 'border-ink bg-ink text-lime'
                      : option.tone === 'coral'
                        ? 'border-coral/40 bg-coral/10 text-ink hover:border-coral'
                        : 'border-line bg-white text-muted hover:border-ink/30 hover:text-ink',
                  )}
                >
                  {option.label}
                  <span className={cn('rounded-full px-1.5 text-[0.56rem] font-extrabold', active ? 'bg-white/20' : 'bg-paper text-muted')}>{option.count}</span>
                </button>
              );
            })}
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={() => { setQuery(''); setScope('all'); }}
              className="btn btn-ghost btn-sm"
            >
              <X className="h-3.5 w-3.5" /> {content.desk_clear_filters}
            </button>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {visible.length} of {bookings.length} pick-ups shown
          </p>
        </div>
      )}

      {tab === 'returns' && <ReturnsPanel />}

      {tab === 'pickups' && (loadError && !bookings.length ? (
        <LoadError
          title="The pick-up desk could not load"
          message={loadError}
          hint="No handovers have been changed. Retry before working the desk so you do not miss a pick-up."
          onRetry={() => load()}
        />
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={content.desk_empty}
          description={content.desk_empty_copy}
          action={<Link to="/admin/calendar" className="btn btn-white">{content.desk_empty_action}</Link>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={content.desk_no_match}
          description={content.desk_no_match_copy}
          action={(
            <button type="button" onClick={() => { setQuery(''); setScope('all'); }} className="btn btn-white">
              {content.desk_clear_filters}
            </button>
          )}
        />
      ) : (
        grouped.order.map((date) => {
          const rows = grouped.map.get(date);
          const isToday = date === today;
          const lateDays = date < today ? Math.max(1, daysBetween(date, today)) : 0;
          return (
            <section key={date} className={cn('rounded-3xl border bg-white/92 shadow-card', lateDays ? 'border-coral/40' : 'border-line')}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                <div>
                  {isToday && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/20 bg-ok/10 px-2.5 py-0.5 text-[0.56rem] font-extrabold uppercase tracking-[0.12em] text-ok">
                      <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-50" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" /></span>
                      {content.desk_today}
                    </span>
                  )}
                  {lateDays > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-coral/40 bg-coral/10 px-2.5 py-0.5 text-[0.56rem] font-extrabold uppercase tracking-[0.12em] text-ink">
                      <AlertTriangle className="h-3 w-3 text-coral" />
                      {content.desk_overdue} · {content.desk_overdue_days.replace('{days}', String(lateDays))}
                    </span>
                  )}
                  <h2 className={cn('text-sm font-extrabold', (isToday || lateDays) && 'text-xl tracking-tight')}>{longDate(date)}</h2>
                </div>
                <span className="rounded-full bg-paper px-2.5 py-1 text-[0.62rem] font-extrabold text-muted">{rows.length} pick-up{rows.length === 1 ? '' : 's'}</span>
              </div>

              <div className="mt-2 space-y-3 divide-y divide-line/70">
                {rows.map((booking) => {
                  const liveBooking = liveChecksFor(booking);
                  const checklist = deskChecklist(liveBooking, policy);
                  const ready = deskReady(liveBooking, policy);
                  const blockers = checklist.blocking
                    .map((check) => (check.note ? `${check.label}: ${check.note}` : check.label))
                    .filter(Boolean);
                  if (policy.blockExpiredDocs && checklist.docsBlocking) blockers.push(content.desk_docs_blocked);
                  const startBlocked = booking.status === 'confirmed' && !ready;
                  const blocking = checklist.checks.filter((check) => check.status === 'warn' || (check.status === 'todo' && check.key === 'licence') || (check.status === 'todo' && check.key === 'age'));
                  const docBlocking = policy.blockExpiredDocs
                    ? checklist.docWarnings.filter((doc) => doc.status === 'expired').length
                    : 0;
                  const blockingCount = blocking.length + docBlocking;
                  return (
                    <div key={booking.id} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:grid lg:grid-cols-[1fr_auto]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[0.62rem] font-bold text-muted">{booking.code}</span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[0.62rem] font-bold">
                            <CalendarCheck className="h-3 w-3 text-moss" /> {timeLabel(booking.pickupTime)}
                          </span>
                          <StatusPill status={booking.status} />
                          {booking.status === 'pending' ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[0.58rem] font-extrabold text-muted">
                              {content.desk_awaiting}
                            </span>
                          ) : ready ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-forest/30 bg-forest/10 px-2 py-0.5 text-[0.58rem] font-extrabold text-forest">
                              <Check className="h-3 w-3" /> {content.desk_ready}
                            </span>
                          ) : (
                            <span className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.58rem] font-extrabold',
                              blockingCount ? 'border-coral/30 bg-coral/10 text-ink' : 'border-sun/30 bg-sun/10 text-ink'
                            )}>
                              <X className={cn('h-3 w-3', blockingCount && 'text-coral')} /> {content.desk_blocked.replace('{count}', String(blockingCount)).replace('{s}', blockingCount === 1 ? '' : 's')}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm font-extrabold">{booking.customer?.name || 'Guest'}</p>
                        <p className="flex flex-wrap items-center gap-1 text-[0.68rem] text-muted">
                          <span>{booking.vehicle?.name || 'Vehicle removed'}</span>
                          {booking.vehicle?.registrationNumber ? (
                            <span className="rounded border border-line bg-paper px-1 py-0.5 font-mono text-[0.56rem] font-bold text-ink">{booking.vehicle.registrationNumber}</span>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <span>{booking.pickupLocation}</span>
                        </p>
                        {checklist.docWarnings.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="text-[0.54rem] font-extrabold uppercase tracking-[0.1em] text-muted">{content.desk_docs_label}</span>
                            {checklist.docWarnings.map((doc) => (
                              <span
                                key={doc.key}
                                title={doc.note}
                                className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.56rem] font-bold', DOC_TONE[doc.status] || DOC_TONE.untracked)}
                              >
                                <AlertTriangle className="h-2.5 w-2.5" /> {doc.note}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <p className="inline-flex items-center gap-1.5 text-[0.66rem] font-semibold text-forest">
                            <ShieldCheck className="h-3 w-3" /> {content.desk_deposit_due.replace('{amount}', inr(booking.holdAmount || 0))}
                          </p>
                          {booking.depositCollected ? (
                            <span
                              className="rounded-full border border-forest/25 bg-forest/10 px-2 py-0.5 text-[0.58rem] font-extrabold text-forest"
                              title={content.desk_deposit_collected_tip}
                            >
                              {content.desk_deposit_collected_badge.replace('{method}', DEPOSIT_METHOD_LABELS[booking.depositCollected.method] || booking.depositCollected.method)}
                            </span>
                          ) : Number(booking.holdAmount || 0) > 0 ? (
                            <button
                              type="button"
                              onClick={() => openCollect(booking)}
                              disabled={busy || collecting}
                              className="btn btn-ghost btn-sm"
                              aria-label={content.desk_deposit_collect_aria}
                            >
                              <ShieldCheck className="h-3 w-3" /> {content.desk_deposit_collect}
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">{renderChecklist(liveBooking, checklist)}</div>
                      </div>

                      <div className="grid gap-1.5 w-full sm:max-w-[17rem]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {booking.driver?.phone && <a href={`tel:${String(booking.driver.phone).replace(/[^\d+]/g, '')}`} className="btn btn-ghost btn-sm"><Phone className="h-3 w-3" /> {content.desk_call}</a>}
                          {booking.customer?.email && <a href={`mailto:${booking.customer.email}`} className="btn btn-ghost btn-sm"><Mail className="h-3 w-3" /></a>}
                          <Link to={`/confirmation/${booking.code}`} className="btn btn-ghost btn-sm">{content.desk_voucher}</Link>
                        </div>
                        <Link to={`/admin/bookings?code=${booking.code}`} className="btn btn-ghost btn-sm w-full" title={content.staff_view_booking_tip}>
                          <ClipboardCheck className="h-3.5 w-3.5" /> {content.staff_view_booking}
                        </Link>
                        {remindersOn && pickupReminderEligible(booking, today) && booking.lastPickupReminderDay !== today && (
                          <button
                            type="button"
                            onClick={() => remindPickup(booking)}
                            disabled={busy || remindingPickups.has(booking.id)}
                            className="btn btn-ghost btn-sm w-full"
                            title={content.desk_remind_pickup_tip}
                          >
                            <Bell className="h-3 w-3" /> {content.desk_remind_pickup}
                          </button>
                        )}
                        <button type="button" onClick={() => saveChecks(booking)} disabled={busy || !dirty.has(booking.id)} className="btn btn-white btn-sm w-full">
                          <ClipboardCheck className="h-3.5 w-3.5" /> {content.desk_save_checks}
                        </button>
                        <button
                          type="button"
                          onClick={() => openStart(booking)}
                          disabled={busy || !ready || booking.status !== 'confirmed'}
                          title={startBlocked ? blockers.join(' · ') : undefined}
                          aria-describedby={startBlocked ? `start-block-${booking.id}` : undefined}
                          className={cn('btn btn-lime btn-sm w-full', (!ready || booking.status !== 'confirmed') && 'disabled:cursor-not-allowed disabled:opacity-50')}
                        >
                          <ArrowRight className="h-3.5 w-3.5" /> {content.desk_start_trip}
                        </button>
                        {startBlocked && (
                          <p id={`start-block-${booking.id}`} className="rounded-lg bg-amber-50 px-2 py-1.5 text-[0.6rem] font-semibold leading-4 text-amber-900">
                            {blockers.length
                              ? content.desk_start_blocked.replace('{reasons}', blockers.join(' · '))
                              : content.desk_start_blocked_generic}
                          </p>
                        )}
                        {booking.status === 'pending' && (
                          <p className="rounded-lg bg-paper px-2 py-1.5 text-[0.6rem] font-semibold leading-4 text-muted">{content.desk_pending_note}</p>
                        )}
                        {policy.blockExpiredDocs && checklist.docsBlocking && (
                          <p className="rounded-lg bg-rose-50 px-2 py-1.5 text-[0.6rem] font-semibold leading-4 text-rose-800">{content.desk_docs_blocked}</p>
                        )}
                        {booking.status === 'confirmed' && booking.startDate < today && (
                          <button type="button" onClick={() => openNoShow(booking)} disabled={busy} className="btn btn-ghost btn-sm w-full text-rose-700">
                            <UserX className="h-3.5 w-3.5" /> {content.desk_no_show}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      ))}

      {tab === 'pickups' && (
      <Modal
        open={Boolean(startTarget)}
        onClose={() => (busy ? null : setStartTarget(null))}
        title={content.desk_start_confirm}
        description={startTarget?.code}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setStartTarget(null)} disabled={busy} className="btn btn-white flex-1">Not yet</button>
            <button
              type="button"
              onClick={startTrip}
              disabled={busy || (policy.blockExpiredDocs && Boolean(startChecklist?.docsBlocking)) || handoverProblems.length > 0}
              className="btn btn-dark flex-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? content.desk_starting : content.desk_start_trip}
            </button>
          </div>
        )}
      >
        <p className="text-sm text-muted">{startTarget?.customer?.name} · {startTarget?.pickupLocation}</p>
        <p className="mt-0.5 text-[0.72rem] font-semibold">
          {startTarget?.vehicle?.name || 'Vehicle removed'}
          {startTarget?.vehicle?.registrationNumber ? (
            <span className="ml-1.5 rounded border border-line bg-paper px-1 py-0.5 font-mono text-[0.6rem] font-bold">{startTarget.vehicle.registrationNumber}</span>
          ) : null}
        </p>
        {startKm && (
          <p className="mt-1 text-[0.68rem] font-semibold text-muted">
            {content.checkout_km_label}: {startKm.limited
              ? content.checkout_km_included
                .replace('{km}', startKm.kmCap.toLocaleString('en-IN'))
                .replace('{rate}', inr(startKm.kmExtraRate))
              : content.checkout_km_unlimited}
          </p>
        )}
        {startChecklist && startChecklist.docWarnings.length > 0 && (
          <div className="mt-3 rounded-2xl border border-coral/40 bg-coral/10 p-3">
            <p className="text-[0.58rem] font-extrabold uppercase tracking-[0.12em] text-ink">{content.desk_docs_label}</p>
            {startChecklist.docWarnings.map((doc) => (
              <p key={doc.key} className="mt-1 flex items-center gap-1.5 text-[0.68rem] font-semibold">
                <AlertTriangle className={cn('h-3 w-3 shrink-0', doc.status === 'expired' ? 'text-coral' : doc.status === 'expiring' ? 'text-amber-700' : 'text-muted')} />
                {doc.note}
              </p>
            ))}
          </div>
        )}
        <div className="mt-3 rounded-2xl border border-line bg-paper/70 p-3">
          {startChecklist ? startChecklist.checks.map((check) => (
            <p key={check.key} className="flex items-center gap-2 text-[0.7rem]">
              <span className={cn(
                'inline-flex h-4 w-4 items-center justify-center rounded-full',
                check.status === 'ok' ? 'bg-forest text-cream' : check.status === 'warn' ? 'bg-coral text-white' : check.status === 'todo' ? 'bg-sun text-ink' : 'bg-aqua text-forest'
              )}>
                {check.status === 'ok' ? <Check className="h-2.5 w-2.5" /> : '•'}
              </span>
              <span className="font-semibold">{check.label}</span>
              <span className="ml-auto truncate text-muted">{check.note}</span>
            </p>
          )) : null}
        </div>
        {dirty.has(startTarget?.id) && (
          <p className="mt-2 flex items-center gap-1.5 text-[0.62rem] font-semibold text-muted">
            <ClipboardCheck className="h-3 w-3 text-forest" /> {content.desk_checks_autosave}
          </p>
        )}
        <div className="mt-3 rounded-2xl border border-line bg-paper/70 p-3">
          <p className="text-[0.58rem] font-extrabold uppercase tracking-[0.12em] text-muted">Condition at pick-up</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-[0.62rem] font-bold text-muted">
              Odometer (km)
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="2000000"
                value={handover.odometer}
                onChange={(event) => setHandover((current) => ({ ...current, odometer: event.target.value }))}
                placeholder="e.g. 41250"
                className="field mt-1 w-full"
              />
            </label>
            <label className="block text-[0.62rem] font-bold text-muted">
              Fuel / battery
              <select
                value={handover.fuel}
                onChange={(event) => setHandover((current) => ({ ...current, fuel: event.target.value }))}
                className="field mt-1 w-full"
              >
                <option value="">Select level</option>
                {FUEL_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
            <label className="block text-[0.62rem] font-bold text-muted">
              Cleanliness
              <select
                value={handover.cleanliness}
                onChange={(event) => setHandover((current) => ({ ...current, cleanliness: event.target.value }))}
                className="field mt-1 w-full"
              >
                {CLEANLINESS.map((level) => <option key={level} value={level}>{CLEANLINESS_LABELS[level]}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-2">
            <p className="text-[0.62rem] font-bold text-muted">Existing damage</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {DAMAGE_AREAS.map((area) => {
                const on = handover.damage.includes(area.key);
                return (
                  <button
                    key={area.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDamage(area.key)}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[0.58rem] font-bold transition',
                      on ? 'border-coral/50 bg-coral/15 text-ink' : 'border-line bg-white text-muted hover:border-ink/30',
                    )}
                  >
                    {area.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="mt-2 block text-[0.62rem] font-bold text-muted">
            Notes
            <textarea
              rows={2}
              maxLength={500}
              value={handover.note}
              onChange={(event) => setHandover((current) => ({ ...current, note: event.target.value }))}
              placeholder="Anything the drop-off desk should know"
              className="field mt-1 w-full"
            />
          </label>
          {handoverProblems.length > 0 && (
            <p className="mt-2 text-[0.62rem] font-bold text-coral" role="alert">{handoverProblems[0]}</p>
          )}
        </div>
      </Modal>
      )}

      {tab === 'pickups' && (
      <Modal
        open={Boolean(noShowTarget)}
        onClose={() => (busy ? null : setNoShowTarget(null))}
        title={content.desk_no_show_title}
        description={noShowTarget ? `${noShowTarget.code} · ${longDate(noShowTarget.startDate)}` : ''}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setNoShowTarget(null)} disabled={busy} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={markNoShow} disabled={busy} className="btn bg-rose-600 text-white flex-1 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? 'Saving…' : content.desk_no_show}
            </button>
          </div>
        )}
      >
        <p className="text-sm text-muted">{content.desk_no_show_copy}</p>
        <div className="mt-3 rounded-2xl border border-line bg-paper/70 p-3 text-[0.72rem]">
          <p className="font-extrabold">{noShowTarget?.customer?.name || 'Guest'}</p>
          <p className="text-muted">{noShowTarget?.vehicle?.name || 'Vehicle removed'} · {noShowTarget?.pickupLocation}</p>
          {noShowTarget && daysBetween(noShowTarget.startDate, today) > 0 && (
            <p className="mt-1 font-semibold text-rose-700">
              {content.desk_overdue_days.replace('{days}', String(Math.max(1, daysBetween(noShowTarget.startDate, today))))}
            </p>
          )}
        </div>
        {Number(noShowTarget?.amountPaid) > 0 && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[0.68rem] font-semibold">
            <input
              type="checkbox"
              checked={noShowRefund}
              onChange={(event) => setNoShowRefund(event.target.checked)}
              className="h-4 w-4 rounded border-stone-300 accent-ink"
            />
            {content.desk_no_show_refund.replace('{amount}', inr(noShowTarget.amountPaid))}
          </label>
        )}
      </Modal>
      )}

      {tab === 'pickups' && (
      <Modal
        open={Boolean(collectTarget)}
        onClose={() => (collecting ? null : setCollectTarget(null))}
        title={content.desk_deposit_collect_title}
        description={collectTarget ? `${collectTarget.code} · ${collectTarget.vehicle?.name || 'Vehicle'}` : ''}
        size="sm"
      >
        <form onSubmit={(event) => { event.preventDefault(); collectDeposit(); }} noValidate>
          <p className="text-[0.7rem] leading-5 text-muted">
            {content.desk_deposit_collect_copy.replace('{amount}', collectTarget ? inr(collectTarget.holdAmount || 0) : '')}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="label" htmlFor="dep-collect-amount">
              {content.desk_deposit_amount_label}
              <input
                id="dep-collect-amount"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={collectForm.amount}
                onChange={(event) => setCollectForm((current) => ({ ...current, amount: event.target.value }))}
                autoFocus
                className="field mt-1"
              />
            </label>
            <label className="label" htmlFor="dep-collect-method">
              {content.desk_deposit_method_label}
              <select
                id="dep-collect-method"
                value={collectForm.method}
                onChange={(event) => setCollectForm((current) => ({ ...current, method: event.target.value }))}
                className="field mt-1"
              >
                {Object.entries(DEPOSIT_METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          </div>
          <label className="label mt-3" htmlFor="dep-collect-reference">
            {content.desk_deposit_reference_label}
            <input
              id="dep-collect-reference"
              type="text"
              maxLength={120}
              value={collectForm.reference}
              onChange={(event) => setCollectForm((current) => ({ ...current, reference: event.target.value }))}
              placeholder={content.desk_deposit_reference_placeholder}
              className="field mt-1"
            />
          </label>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" onClick={() => setCollectTarget(null)} disabled={collecting} className="btn btn-white btn-sm">
              {content.desk_deposit_cancel}
            </button>
            <button type="submit" disabled={collecting} className="btn btn-lime btn-sm">
              {collecting ? content.desk_deposit_collecting : content.desk_deposit_collect_confirm}
            </button>
          </div>
        </form>
      </Modal>
      )}
    </div>
  );
}