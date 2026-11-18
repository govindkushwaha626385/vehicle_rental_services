import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, Bell, CalendarCheck, CalendarRange, Car, ChartColumn, ChartLine, ChevronRight, ClipboardCheck, Clock, Coins, Download, HandCoins, IndianRupee, Inbox as InboxIcon, Percent, RotateCcw, ShieldCheck, TrendingUp, Users, Wrench,
} from 'lucide-react';
import { StatusPill, TableScrollHint } from '../../components/ui.jsx';
import BarChart from '../../components/charts/BarChart.jsx';
import Donut from '../../components/charts/Donut.jsx';
import Heatmap from '../../components/charts/Heatmap.jsx';
import KpiCard from '../../components/charts/KpiCard.jsx';
import LineChart from '../../components/charts/LineChart.jsx';
import { api } from '../../lib/api.js';
import { analyticsCsv } from '../../lib/analyticsCsv.js';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { getSiteContent } from '../../lib/site.js';
import { bookingFunnel } from '../../lib/stats.js';
import { todayISO } from '../../lib/pricing.js';
import { downloadCsv } from '../../lib/csv.js';
import { cn, inr, inrShort, longDate, monthLabel, timeLabel } from '../../lib/format.js';
import { deskReady } from '../../lib/desk.js';

// Staff notifications carry a kind and (usually) a deep link. Matching the icon
// and tone to the kind turns the dashboard feed into a scannable shift handover
// instead of a wall of identical dots.
const EVENT_TONES = {
  booking_pending: { icon: CalendarCheck, tone: 'bg-amber-100 text-amber-800' },
  change_request: { icon: CalendarCheck, tone: 'bg-amber-100 text-amber-800' },
  booking_confirmed: { icon: CalendarCheck, tone: 'bg-lime/25 text-ink' },
  booking_completed: { icon: ClipboardCheck, tone: 'bg-sand text-ink' },
  trip_started: { icon: Car, tone: 'bg-aqua/20 text-ink' },
  service_overdue: { icon: Wrench, tone: 'bg-rose-100 text-rose-700' },
  contact_message: { icon: InboxIcon, tone: 'bg-aqua/20 text-ink' },
  deposit_due: { icon: Coins, tone: 'bg-lime/30 text-ink' },
  deposit_collected: { icon: Coins, tone: 'bg-lime/30 text-ink' },
  deposit_settled: { icon: Coins, tone: 'bg-lime/30 text-ink' },
};
const eventMeta = (kind) => EVENT_TONES[kind] ?? { icon: Bell, tone: 'bg-stone-100 text-muted' };

export default function Dashboard() {
  const { push } = useToast();
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [events, setEvents] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [range, setRange] = useState(30);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    Promise.all([
      api.adminStats(),
      Promise.resolve(typeof api.staffNotifications === 'function' ? api.staffNotifications(6) : []),
      Promise.resolve(typeof api.adminContactMessages === 'function' ? api.adminContactMessages() : []),
    ])
      .then(([nextStats, nextEvents, nextMessages]) => {
        if (!alive) return;
        setStats(nextStats);
        setEvents(nextEvents ?? []);
        setInbox(nextMessages ?? []);
      })
      .catch((nextError) => {
        if (!alive) return;
        setError(nextError.message || content.analytics_error_copy);
        push(nextError.message, 'error');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  if (error && !stats) {
    return (
      <div className="rounded-3xl border border-dashed border-rose-200 bg-white/70 px-6 py-14 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-rose-600" />
        <h1 className="mt-3 text-lg font-extrabold tracking-tight">{content.analytics_error_title}</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted">{error || content.analytics_error_copy}</p>
        <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="btn btn-dark mt-5">
          <RotateCcw className="h-4 w-4" /> {content.analytics_retry}
        </button>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 animate-pulse rounded-xl bg-stone-200/70" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-stone-200/70" />)}
        </div>
        <div className="h-72 animate-pulse rounded-2xl bg-stone-200/70" />
      </div>
    );
  }

  if (!stats) return null;

  const monthDelta = stats.revenueLastMonth
    ? Math.round(((stats.revenueThisMonth - stats.revenueLastMonth) / stats.revenueLastMonth) * 100)
    : null;
  const monthHint = monthDelta === null
    ? (stats.revenueThisMonth > 0 ? 'No revenue last month' : 'No revenue yet')
    : `${monthDelta >= 0 ? '+' : ''}${monthDelta}% vs last month`;
  const maxMonthly = Math.max(...stats.monthly.map((row) => row.revenue), 1);

  const analytics = stats.analytics;
  const depositBook = analytics?.deposits ?? {};
  const awaitingSettlement = Number(depositBook.awaiting) || 0;
  const fleetRadar = analytics?.fleetRadar ?? [];
  const fleetRadarStats = analytics?.fleetRadarStats ?? { total: 0, overdue: 0, due: 0, fresh: 0 };
  const returnsWeek = analytics?.returnsWeek ?? { days: [], dueToday: 0, next7: 0 };
  const lateOffenders = analytics?.lateReturns ?? [];
  const utilizationTrend = analytics?.utilizationTrend ?? [];
  const utilizationTrendDays = utilizationTrend.slice(-14);
  const utilizationTrendAvg = utilizationTrendDays.length
    ? Math.round(utilizationTrendDays.reduce((sum, row) => sum + row.value, 0) / utilizationTrendDays.length)
    : null;
  const showAnalytics = content.analytics_enabled !== false && analytics !== undefined;
  const slice = (field) => (analytics?.daily ?? []).slice(-range).map((row) => ({ label: row.label, value: row[field] }));
  const spark = (field) => (analytics?.daily ?? []).slice(-range).map((row) => row[field]);
  const tripWord = (count) => `${count} ${count === 1 ? content.analytics_units_trip : content.analytics_units_trips}`;
  const funnel = analytics ? bookingFunnel(analytics.conversion) : { requested: 0, confirmed: 0, active: 0, completed: 0 };
  const funnelBase = Math.max(funnel.requested, 1);
  const statusTotal = stats
    ? Object.values(stats.statusCounts ?? {}).reduce((sum, value) => sum + value, 0) || 1
    : 1;

  const exportAnalytics = () => {
    if (!analytics || exporting) return;
    setExporting(true);
    try {
      downloadCsv(`rove-analytics-${todayISO()}.csv`, analyticsCsv(analytics, range));
      push(content.analytics_exported, 'success');
    } finally {
      setExporting(false);
    }
  };

  const heatLabels = { early: content.analytics_heat_early, morning: content.analytics_heat_morning, afternoon: content.analytics_heat_afternoon, evening: content.analytics_heat_evening, night: content.analytics_heat_night };
  const HEAT_SLOT_KEYS = ['early', 'morning', 'afternoon', 'evening', 'night'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const cards = [
    { label: 'Total revenue', value: inr(stats.revenue), hint: `${stats.trips} completed trips`, icon: IndianRupee, tone: 'bg-gradient-to-br from-lime to-lime-deep text-ink' },
    { label: 'Revenue this month', value: inr(stats.revenueThisMonth), hint: monthHint, icon: TrendingUp, tone: 'bg-gradient-to-br from-aqua/70 to-aqua/25 text-forest' },
    { label: 'Active rentals', value: stats.activeRentals, hint: `${stats.pending} awaiting approval`, icon: CalendarCheck, tone: 'bg-gradient-to-br from-sun/80 to-sun/25 text-ink' },
    { label: 'Fleet utilisation', value: `${stats.utilization}%`, hint: `${stats.available} available · ${stats.rented} on rent`, icon: Percent, tone: 'bg-gradient-to-br from-coral/60 to-coral/20 text-ink' },
  ];

  const statusBar = {
    pending: 'bg-sun',
    confirmed: 'bg-aqua',
    active: 'bg-lime-deep',
    completed: 'bg-forest',
    cancelled: 'bg-rose-400',
    rejected: 'bg-stone-400',
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Dashboard</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/15 bg-ok/8 px-2.5 py-1 text-[0.56rem] font-extrabold uppercase tracking-[0.12em] text-ok">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-50" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
              </span>
              Live
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">Live view of revenue, fleet health and what needs attention today.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading} className="btn btn-ghost btn-sm" aria-label="Refresh dashboard">
            <RotateCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
          </button>
          <Link to="/admin/bookings" className="btn btn-dark btn-sm">Review bookings <ArrowRight className="h-3.5 w-3.5" /></Link>
          <Link to="/admin/fleet" className="btn btn-white btn-sm">Manage fleet</Link>
        </div>
      </header>

      <div className="relative overflow-hidden rounded-2xl border border-line bg-white/80 p-4 shadow-card backdrop-blur-sm">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-lime via-aqua to-coral" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pl-2">
          <span className="icon-tile h-9 w-9 shrink-0 text-forest"><CalendarCheck className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-muted">Needs attention</p>
            <p className="mt-0.5 text-sm font-extrabold">
              {stats.pending > 0 || stats.serviceOverdue > 0 || stats.overdueReturns > 0 || awaitingSettlement > 0
                ? [
                  stats.overdueReturns > 0 ? `${stats.overdueReturns} overdue return${stats.overdueReturns === 1 ? '' : 's'} on the road` : '',
                  awaitingSettlement > 0 ? `${awaitingSettlement} deposit${awaitingSettlement === 1 ? '' : 's'} awaiting settlement` : '',
                  stats.pending > 0 ? `${stats.pending} booking${stats.pending === 1 ? '' : 's'} waiting for approval` : '',
                  stats.serviceOverdue > 0 ? `${stats.serviceOverdue} vehicle${stats.serviceOverdue === 1 ? '' : 's'} overdue for service` : '',
                  stats.noShowCount > 0 ? `${stats.noShowCount} no-show${stats.noShowCount === 1 ? '' : 's'} to follow up` : '',
                ].filter(Boolean).join(' · ')
                : 'Nothing waiting — the queue is clear'}
            </p>
          </div>
          <div className="flex items-center gap-4 text-[0.65rem]">
            <span className="text-muted"><b className="font-extrabold text-ink">{stats.activeRentals}</b> active</span>
            <span className="hidden text-muted sm:inline"><b className="font-extrabold text-ink">{stats.inService}</b> in service</span>
            {stats.serviceDue > 0 && <span className="hidden text-muted md:inline"><b className="font-extrabold text-ink">{stats.serviceDue}</b> due soon</span>}
            <Link to="/admin/bookings" className="inline-flex items-center gap-1 font-extrabold text-forest transition hover:text-ink">
              Review <ArrowRight className="h-3 w-3" />
            </Link>
            {stats.overdueReturns > 0 && (
              <Link to="/admin/desk?tab=returns" className="inline-flex items-center gap-1 font-extrabold text-forest transition hover:text-ink">
                <ClipboardCheck className="h-3 w-3" /> Returns desk
              </Link>
            )}
            {awaitingSettlement > 0 && (
              <Link to="/admin/desk?tab=returns" className="inline-flex items-center gap-1 font-extrabold text-amber-700 transition hover:text-ink">
                <ShieldCheck className="h-3 w-3" /> Settle deposits
              </Link>
            )}
            {stats.serviceOverdue > 0 && (
              <Link to="/admin/maintenance" className="inline-flex items-center gap-1 font-extrabold text-forest transition hover:text-ink">
                <Wrench className="h-3 w-3" /> Service
              </Link>
            )}
          </div>
        </div>
      </div>

      {(() => {
        // Revenue-line enquiries (B2B / groups / weddings) carry a real
        // potential booking value that does not show in the ops queue. Surface
        // any open ones so they cannot sit quietly under general support.
        const openB2b = inbox
          .filter((message) => (message.subject || 'General') === 'Group & corporate')
          .filter((message) => message.status !== 'resolved');
        if (!openB2b.length) return null;
        const names = [...new Set(openB2b.map((m) => m.name))];
        return (
          <div className="rounded-2xl border border-sun/40 bg-sun/10 p-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="icon-tile h-8 w-8 shrink-0 text-amber-800"><HandCoins className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-muted">{content.dashboard_b2b_title}</p>
                <p className="mt-0.5 text-sm font-extrabold text-ink">
                  {content.dashboard_b2b_open.replace('{count}', String(openB2b.length)).replace('{names}', names.join(', '))}
                </p>
              </div>
              <Link to={`/admin/inbox?subject=${encodeURIComponent('Group & corporate')}`} className="btn btn-ghost btn-sm">
                {content.dashboard_b2b_reply} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        );
      })()}

      {/* Peak-season readiness — festive window availability + risk ---------- */}
      {(() => {
        const peak = analytics?.seasonalReadiness;
        if (!peak) return null;
        const risk = peak.atRisk ?? [];
        return (
          <div className="rounded-2xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="icon-tile h-9 w-9 shrink-0 text-forest"><CalendarRange className="h-4 w-4" /></span>
                <div>
                  <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.12em] text-muted">{content.dashboard_peak_title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {content.dashboard_peak_window.replace('{start}', peak.start).replace('{end}', peak.end)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge bg-lime/25 text-ink">
                  {content.dashboard_peak_pct.replace('{percent}', String(peak.availabilityPct))}
                </span>
                {risk.length > 0 && (
                  <span className="badge bg-coral/15 text-ink">
                    {content.dashboard_peak_risk.replace('{count}', String(risk.length))}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-100">
                <div
                  className={`h-full rounded-full ${peak.availabilityPct >= 60 ? 'bg-lime-deep' : peak.availabilityPct >= 35 ? 'bg-sun' : 'bg-coral'}`}
                  style={{ width: `${Math.max(2, peak.availabilityPct)}%` }}
                />
              </div>
              <span className="shrink-0 text-[0.62rem] font-extrabold text-ink">
                {content.dashboard_peak_available.replace('{count}', String(peak.availableCount)).replace('{capacity}', String(peak.capacity))}
              </span>
            </div>

            {(peak.topHeld?.length > 0 || risk.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {peak.topHeld?.length > 0 && (
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[0.56rem] font-bold text-ink">
                    Held: {peak.topHeld.join(', ')}
                  </span>
                )}
                {risk.map((row) => (
                  <span key={row.id} className="rounded-full border border-coral/30 bg-coral/10 px-2 py-0.5 text-[0.56rem] font-bold text-ink">
                    <Wrench className="mr-0.5 inline h-2.5 w-2.5" /> {row.name}
                  </span>
                ))}
                <Link to="/admin/calendar" className="ml-auto inline-flex items-center gap-1 text-[0.6rem] font-bold text-forest hover:underline">
                  {content.dashboard_peak_view} <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        );
      })()}

      {/* Day timeline — hourly view of today's pick-ups and returns ---------- */}
      {(() => {
        const timelineHours = Array.from({ length: 17 }, (_, i) => i + 6); // 06:00 – 22:00
        const pickupByHour = new Map();
        const returnByHour = new Map();
        (stats.pickupsToday ?? []).forEach((b) => {
          const h = parseInt(String(b.pickupTime || '10:00').split(':')[0], 10);
          pickupByHour.set(h, (pickupByHour.get(h) || 0) + 1);
        });
        (stats.returnsToday ?? []).forEach((b) => {
          const h = parseInt(String(b.dropoffTime || '10:00').split(':')[0], 10);
          returnByHour.set(h, (returnByHour.get(h) || 0) + 1);
        });
        const maxCount = [...pickupByHour.values(), ...returnByHour.values()].reduce((a, b) => Math.max(a, b), 1);
        return (
          <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white/90 shadow-card">
            <div className="px-4 py-2.5 sm:px-5">
              <p className="text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted">Today's schedule</p>
              <p className="mt-0.5 text-[0.65rem] text-muted">Pick-ups and returns by hour.</p>
            </div>
            <div className="overflow-x-auto pb-2 px-4">
              <div className="flex min-w-[32rem] items-end gap-1.5">
                {timelineHours.map((hour) => {
                  const pickups = pickupByHour.get(hour) || 0;
                  const returns = returnByHour.get(hour) || 0;
                  // Fixed-pixel bars: percentage heights resolve against the
                  // flex row's auto height and collapse to 0px, so compute
                  // pixel heights from a constant 96px chart instead.
                  const chartHeight = 96;
                  const pickupH = pickups > 0 ? Math.max(6, Math.round((pickups / maxCount) * chartHeight)) : 0;
                  const returnH = returns > 0 ? Math.max(6, Math.round((returns / maxCount) * chartHeight)) : 0;
                  return (
                    <div key={hour} className="flex shrink-0 flex-col items-center gap-0.5" style={{ width: '1.7rem' }}>
                      <div className="flex w-full flex-col items-center justify-end gap-0.5" style={{ height: `${Math.max(pickupH, returnH)}px` }}>
                        {pickups > 0 && (
                          <div className="w-4/5 rounded-t bg-gradient-to-t from-lime-deep to-lime" style={{ height: `${pickupH}px` }} title={`${pickups} pick-up${pickups === 1 ? '' : 's'}`} />
                        )}
                        {returns > 0 && (
                          <div className="w-4/5 rounded-t bg-gradient-to-t from-aqua to-cyan-300" style={{ height: `${returnH}px` }} title={`${returns} return${returns === 1 ? '' : 's'}`} />
                        )}
                      </div>
                      <span className="text-[0.5rem] font-bold text-muted">{String(hour).padStart(2, '0')}:00</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[0.55rem] text-muted">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-lime" /> Pick-ups</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-aqua" /> Returns</span>
              </div>
            </div>

            <div className="mt-3 border-t border-line/80 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-[0.6rem]">
                <span className="font-extrabold uppercase tracking-wider text-muted">{content.analytics_returns_week}</span>
                <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-forest/25 bg-forest/10 px-2 py-0.5 font-extrabold text-forest">
                  {content.analytics_returns_due_today.replace('{count}', String(returnsWeek.dueToday))}
                </span>
              </div>
              <div className="mt-2 flex items-end gap-1.5">
                {(() => {
                  const weekMax = Math.max(1, ...returnsWeek.days.map((day) => day.value));
                  return returnsWeek.days.map((day) => {
                    const h = day.value > 0 ? Math.max(5, Math.round((day.value / weekMax) * 48)) : 0;
                    return (
                      <div key={day.label} className="flex min-w-[2.1rem] flex-1 flex-col items-center gap-0.5">
                        <div className={day.value > 0 ? 'h-1.5 w-4/5 rounded-t bg-gradient-to-t from-aqua to-cyan-300' : 'h-0.5 w-1/2 rounded bg-line/40'} style={{ height: `${day.value > 0 ? h : 3}px` }} title={day.value > 0 ? `${day.value} return${day.value === 1 ? '' : 's'}` : undefined} />
                        <span className="w-full truncate text-center text-[0.48rem] font-bold text-muted">{day.label}</span>
                      </div>
                    );
                  });
                })()}
              </div>
              {lateOffenders.length > 0 && (
                <div className="mt-3 rounded-xl border border-coral/20 bg-coral/[0.05] px-2.5 py-2">
                  <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{content.dashboard_late_offenders}</p>
                  <ul className="mt-1 space-y-1">
                    {lateOffenders.slice(0, 3).map((row) => (
                      <li key={row.vehicle} className="flex items-center justify-between gap-2 text-[0.62rem]">
                        <span className="min-w-0 truncate font-bold text-ink">{row.vehicle}</span>
                        <span className="shrink-0 text-muted">
                          {row.late} late · {row.lateHours}h · <span className="font-bold text-coral">{inr(row.lateFees)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/admin/analytics" className="mt-1 block text-[0.56rem] font-bold text-forest underline underline-offset-2">
                    {content.analytics_returns_label} →
                  </Link>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {showAnalytics && (
        <section className="overflow-hidden rounded-3xl border border-line bg-white/90 shadow-card">
          <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <p className="eyebrow">{content.analytics_eyebrow}</p>
              <h2 className="mt-1 text-lg font-extrabold tracking-tight">{content.analytics_title}</h2>
              <p className="mt-0.5 text-xs text-muted">{content.analytics_description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-[0.56rem] font-extrabold uppercase tracking-[0.12em] text-muted">
                <Activity className="h-3 w-3 text-forest" /> {content.analytics_days}
              </span>
              <div className="rounded-full border border-line bg-white p-0.5" role="group" aria-label={content.analytics_range_label}>
                {[7, 30, 90].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setRange(days)}
                    aria-pressed={range === days}
                    className={`rounded-full px-2.5 py-1 text-[0.58rem] font-bold transition ${range === days ? 'bg-ink text-lime' : 'text-muted hover:text-ink'}`}
                  >
                    {days === 7 ? content.analytics_range_7 : days === 30 ? content.analytics_range_30 : content.analytics_range_90}
                  </button>
                ))}
              </div>
              <button type="button" onClick={exportAnalytics} disabled={exporting} className="btn btn-white btn-sm">
                <Download className="h-3.5 w-3.5" /> {content.analytics_export}
              </button>
              <Link to="/admin/analytics" className="btn btn-dark btn-sm">
                <ChartLine className="h-3.5 w-3.5" /> Full analytics
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={content.analytics_revenue_label} value={inrShort(analytics.revenue30)} hint={content.analytics_prior_hint} delta={analytics.revenueDelta} icon={Coins} tone="bg-gradient-to-br from-lime to-lime-deep text-ink" spark={spark('recognized')} />
            <KpiCard label={content.analytics_bookings_label} value={analytics.created30} hint={content.analytics_prior_hint} delta={analytics.createdDelta} icon={ChartColumn} tone="bg-aqua/25 text-forest" spark={spark('created')} />
            <KpiCard label={content.analytics_avg_value_label} value={inr(analytics.avgBookingValue)} hint={tripWord(stats.trips)} icon={IndianRupee} tone="bg-sun/25 text-ink" spark={spark('recognized')} />
            <KpiCard label={content.analytics_completion_label} value={`${analytics.completedRate}%`} hint={content.analytics_complete_rate.replace('{percent}', String(analytics.completedRate))} icon={Percent} tone="bg-coral/25 text-ink" spark={spark('completed')} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="stat-card"><Coins className="h-4 w-4 text-moss" /><p className="mt-2 text-xl font-extrabold">{inrShort(analytics.received30)}</p><p className="text-[0.6rem] uppercase tracking-wider text-muted">{content.analytics_cash_label}</p></div>
            <div className="stat-card"><Users className="h-4 w-4 text-aqua" /><p className="mt-2 text-xl font-extrabold">{analytics.repeatRate}%</p><p className="text-[0.6rem] uppercase tracking-wider text-muted">{content.analytics_repeat_label}</p></div>
            <div className="stat-card"><CalendarCheck className="h-4 w-4 text-sun" /><p className="mt-2 text-xl font-extrabold">{analytics.leadTimeDays ?? '—'}{analytics.leadTimeDays !== null ? 'd' : ''}</p><p className="text-[0.6rem] uppercase tracking-wider text-muted">{content.analytics_lead_label}</p></div>
            <div className="stat-card"><TrendingUp className="h-4 w-4 text-forest" /><p className="mt-2 text-xl font-extrabold">{analytics.avgTripDays ?? '—'}{analytics.avgTripDays !== null ? 'd' : ''}</p><p className="text-[0.6rem] uppercase tracking-wider text-muted">{content.analytics_trip_label}</p></div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_revenue}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_chart_revenue_desc}</p>
              <div className="mt-3"><LineChart data={slice('recognized')} ariaLabel={content.analytics_chart_revenue} description={content.analytics_chart_revenue_desc} colorIndex={0} format={inrShort} /></div>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_cash}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_chart_cash_desc}</p>
              <div className="mt-3"><LineChart data={slice('received')} ariaLabel={content.analytics_chart_cash} description={content.analytics_chart_cash_desc} colorIndex={3} format={inrShort} /></div>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_bookings}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_chart_bookings_desc}</p>
              <div className="mt-3"><LineChart data={slice('created')} ariaLabel={content.analytics_chart_bookings} description={content.analytics_chart_bookings_desc} colorIndex={1} format={(value) => `${value} ${value === 1 ? content.analytics_units_trip : content.analytics_units_trips}`} /></div>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_funnel}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_funnel_desc}</p>
              <div className="mt-3 space-y-2">
                {[
                  ['requested', content.analytics_funnel_requested, 'bg-sun'],
                  ['confirmed', content.analytics_funnel_confirmed, 'bg-aqua'],
                  ['active', content.analytics_funnel_active, 'bg-lime-deep'],
                  ['completed', content.analytics_funnel_completed, 'bg-forest'],
                ].map(([key, label, tone]) => {
                  const count = funnel[key];
                  const width = Math.round((count / funnelBase) * 100);
                  return (
                    <div key={key} aria-label={`${label}: ${count}`}>
                      <div className="flex items-center justify-between text-[0.66rem]">
                        <span className="font-semibold">{label}</span>
                        <span className="font-extrabold">{count}</span>
                      </div>
                      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stone-100">
                        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: count > 0 ? `${Math.max(width, 3)}%` : '0%' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_mix}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{tripWord(analytics.typeMix.reduce((sum, item) => sum + item.count, 0))} in total</p>
              <div className="mt-3">
                <Donut segments={analytics.typeMix.map((item) => ({ label: item.label, value: item.count }))} centerLabel={content.analytics_units_trips} ariaLabel={content.analytics_chart_mix} />
              </div>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_hubs}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_chart_hubs}</p>
              <div className="mt-3">
                <BarChart rows={analytics.hubMix.map((item) => ({ label: item.label, value: item.count }))} ariaLabel={content.analytics_chart_hubs} format={(value) => tripWord(value)} />
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_forecast}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_chart_forecast_desc}</p>
              <p className="mt-2 text-xl font-extrabold tracking-tight">{inrShort(analytics.forecastRows.reduce((sum, row) => sum + row.value, 0))} <span className="text-[0.62rem] font-semibold text-muted">booked ahead</span></p>
              <div className="mt-3"><LineChart data={analytics.forecastRows} ariaLabel={content.analytics_chart_forecast} description={content.analytics_chart_forecast_desc} colorIndex={2} format={inrShort} /></div>
            </div>
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_weekday}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_chart_weekday_desc}</p>
              <div className="mt-3">
                <BarChart rows={analytics.weekdayMix.map((item) => ({ label: item.label, value: item.count }))} ariaLabel={content.analytics_chart_weekday} format={(value) => tripWord(value)} />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-line p-4">
            <h3 className="text-sm font-extrabold">{content.analytics_chart_heat}</h3>
            <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_chart_heat_desc}</p>
            <div className="mt-3 overflow-x-auto">
              <Heatmap rows={analytics.heat} weekdays={WEEKDAYS} slots={HEAT_SLOT_KEYS} slotLabels={heatLabels} ariaLabel={content.analytics_chart_heat} />
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_chart_fleet}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_chart_fleet_desc}</p>
              <div className="mt-3">
                <Donut
                  segments={[
                    { label: content.analytics_fleet_available, value: analytics.fleetHealth.available },
                    { label: content.analytics_fleet_rented, value: analytics.fleetHealth.rented },
                    { label: content.analytics_fleet_service, value: analytics.fleetHealth.service },
                  ]}
                  centerLabel={String(analytics.fleetHealth.total)}
                  ariaLabel={content.analytics_chart_fleet}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-paper/60 py-1.5"><p className="text-sm font-extrabold text-forest">{fleetRadarStats.fresh}</p><p className="text-[0.5rem] font-bold uppercase tracking-wider text-muted">{content.fleet_health_fresh}</p></div>
                <div className="rounded-lg bg-paper/60 py-1.5"><p className="text-sm font-extrabold text-amber-700">{fleetRadarStats.due}</p><p className="text-[0.5rem] font-bold uppercase tracking-wider text-muted">{content.fleet_health_due}</p></div>
                <div className="rounded-lg bg-paper/60 py-1.5"><p className="text-sm font-extrabold text-coral">{fleetRadarStats.overdue}</p><p className="text-[0.5rem] font-bold uppercase tracking-wider text-muted">{content.fleet_health_overdue}</p></div>
              </div>
              {fleetRadar[0] && (
                <ul className="mt-2 space-y-1 text-[0.62rem]" aria-label={content.fleet_health_most_due}>
                  {fleetRadar.slice(0, 3).map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1">
                      <span className={cn('font-bold', row.band === 'overdue' ? 'text-coral' : row.band === 'due' ? 'text-amber-700' : 'text-forest')}>{row.name}</span>
                      <span className="text-muted">{row.score}/100 · <span className="font-semibold">{row.band === 'overdue' ? content.fleet_health_overdue : row.band === 'due' ? content.fleet_health_due : content.fleet_health_fresh}</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-line p-4">
              <h3 className="text-sm font-extrabold">{content.analytics_promo_title}</h3>
              <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_promo_desc}</p>
              {analytics.promoPerformance.length ? (
                <table className="mt-3 w-full text-left">
                  <caption className="sr-only">{content.analytics_promo_title}</caption>
                  <thead>
                    <tr className="text-[0.56rem] font-bold uppercase tracking-wider text-muted">
                      <th className="py-1.5">Code</th>
                      <th className="py-1.5 text-right">{content.analytics_promo_uses}</th>
                      <th className="py-1.5 text-right">{content.analytics_promo_revenue}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/80">
                    {analytics.promoPerformance.map((promo) => (
                      <tr key={promo.code} className="text-[0.7rem]">
                        <td className="py-1.5 font-mono font-extrabold">{promo.code}</td>
                        <td className="py-1.5 text-right font-extrabold">{promo.uses}</td>
                        <td className="py-1.5 text-right text-muted">{inrShort(promo.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-3 text-[0.68rem] text-muted">{content.analytics_promo_desc}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {content.dashboard_show_desk && (
      <section className="overflow-hidden rounded-2xl border border-line bg-white/90 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div>
            <p className="text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted">Desk</p>
            <h2 className="mt-0.5 text-sm font-extrabold">Today's pick-ups &amp; returns</h2>
          </div>
          <Link to="/admin/bookings" className="inline-flex items-center gap-1 text-[0.68rem] font-extrabold text-forest transition hover:text-ink">
            Open bookings <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid gap-0 divide-x divide-line sm:grid-cols-2">
          <div className="min-w-0 p-3 sm:p-4">
            <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-muted">
              <CalendarCheck className="h-3 w-3" /> Pick-ups · {stats.pickupsToday.length}
            </p>
            {(() => {
              const total = stats.pickupsToday.length;
              const ready = stats.pickupsToday.filter((booking) => deskReady(booking, content.policy)).length;
              const blocked = total - ready;
              if (!total) return null;
              return (
                <p className={cn('mt-1', 'text-[0.58rem]')}>
                  <span className={cn('font-extrabold', blocked ? 'text-amber-800' : 'text-forest')}>
                    {ready} of {total} {content.dashboard_desk_ready}
                  </span>
                  {blocked > 0 && (
                    <span title={content.dashboard_desk_ready_tip}>
                      {' '}· {blocked} need{blocked === 1 ? 's' : ''} attention
                    </span>
                  )}
                </p>
              );
            })()}
            {stats.pickupsToday.length ? (
              <ul className="mt-1.5 divide-y divide-line/80">
                {stats.pickupsToday.slice(0, 6).map((booking) => (
                  <li key={booking.id} className="flex items-center gap-2 px-2 py-1.5">
                    <StatusPill status={booking.status} />
                    <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold">{booking.customer?.name || 'Guest'}</span>
                    <span className="hidden max-w-[10rem] truncate text-[0.6rem] text-muted md:inline">{booking.vehicle?.name}</span>
                    <span className="whitespace-nowrap text-[0.6rem] font-bold">{timeLabel(booking.pickupTime)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[0.66rem] leading-4 text-muted">No pick-ups scheduled for today. Enjoy the quiet desk.</p>
            )}
          </div>
          <div className="min-w-0 p-3 sm:p-4">
            <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-muted">
              <Clock className="h-3 w-3" /> Returns · {stats.returnsToday.length}
            </p>
            {stats.returnsToday.length ? (
              <ul className="mt-1.5 divide-y divide-line/80">
                {stats.returnsToday.slice(0, 6).map((booking) => (
                  <li key={booking.id} className="flex items-center gap-2 px-2 py-1.5">
                    <StatusPill status={booking.status} />
                    <span className="min-w-0 flex-1 truncate text-[0.7rem] font-semibold">{booking.customer?.name || 'Guest'}</span>
                    <span className="hidden max-w-[10rem] truncate text-[0.6rem] text-muted md:inline">{booking.vehicle?.name}</span>
                    <span className="whitespace-nowrap text-[0.6rem] font-bold">{booking.returnTime || timeLabel(booking.dropoffTime)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[0.66rem] leading-4 text-muted">No returns expected today.</p>
            )}
          </div>
        </div>
      </section>
      )}

      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="stat-card">
            <div className="flex items-start justify-between">
              <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted">{card.label}</p>
              <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${card.tone}`}>
                <card.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-extrabold tracking-tight">{card.value}</p>
            <p className="mt-0.5 text-[0.65rem] text-muted">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {content.dashboard_show_finance && (
        <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold">Revenue, last 6 months</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Completed rentals only, GST inclusive.</p>
            </div>
            <span className="rounded-full bg-lime/30 px-2.5 py-1 text-[0.6rem] font-extrabold">{inrShort(stats.monthly.reduce((sum, row) => sum + row.revenue, 0))} total</span>
          </div>
          <div className="mt-6 flex h-48 items-stretch gap-3">
            {stats.monthly.map((row, index) => (
              <div key={row.key} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="bar-grow relative w-full rounded-t-lg bg-gradient-to-t from-forest via-moss to-lime-deep transition-all hover:from-ink hover:to-lime"
                    style={{ height: `${Math.max(4, (row.revenue / maxMonthly) * 100)}%`, animationDelay: `${index * 55}ms` }}
                    title={`${row.trips} trips · ${inr(row.revenue)}`}
                  >
                    <span className="pointer-events-none absolute inset-x-0 -top-5 text-center text-[0.58rem] font-bold text-muted">{row.revenue ? inrShort(row.revenue) : ''}</span>
                  </div>
                </div>
                <span className="text-[0.6rem] font-bold text-muted">{row.label}</span>
              </div>
            ))}
          </div>
        </section>
        )}

        {content.dashboard_show_pipeline && (
        <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <h2 className="text-sm font-extrabold">Booking pipeline</h2>
          <p className="mt-0.5 text-[0.65rem] text-muted">All bookings by status.</p>
          <div className="mt-4 space-y-3">
            {Object.entries(stats.statusCounts).map(([status, count]) => {
              return (
                <div key={status}>
                  <div className="flex items-center justify-between text-[0.68rem]">
                    <StatusPill status={status} />
                    <span className="font-extrabold">{count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100">
                    <div className={cn('h-full rounded-full transition-all', statusBar[status] || 'bg-forest')} style={{ width: `${(count / statusTotal) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        )}

      </div>

      {content.dashboard_show_sales && analytics?.checkout && (
        <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold">Checkout recovery</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Customers who opened payment but didn't finish — a call can win the booking back.</p>
            </div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[0.6rem] font-extrabold text-amber-900">
              {analytics.checkout.count30d} in 30 days · {inrShort(analytics.checkout.value30d)} at risk
            </span>
          </div>
          {analytics.checkout.recent.length ? (
            <ul className="mt-3 space-y-2">
              {analytics.checkout.recent.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/80 bg-paper/70 px-3 py-2">
                  <Link to={`/vehicles/${attempt.vehicleId}?from=${attempt.startDate}&to=${attempt.endDate}`} className="truncate text-[0.72rem] font-extrabold hover:text-forest hover:underline">
                    {attempt.vehicleName || 'Vehicle'}
                  </Link>
                  <span className="whitespace-nowrap text-[0.62rem] text-muted">{longDate(attempt.startDate)} → {longDate(attempt.endDate)}</span>
                  <span className="shrink-0 text-[0.72rem] font-extrabold text-ink">{inrShort(attempt.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[0.66rem] text-muted">No abandoned checkouts in the last 30 days.</p>
          )}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        {content.dashboard_show_recent && (
        <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold">Recent bookings</h2>
            <Link to="/admin/bookings" className="text-[0.68rem] font-bold text-forest hover:underline">View all</Link>
          </div>
          <TableScrollHint className="mt-3" />
          <div className="mt-2 table-wrap" role="region" aria-label="Recent bookings table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr><th>Code</th><th>Customer</th><th>Vehicle</th><th>Dates</th><th className="text-right">Total</th><th>Status</th></tr>
              </thead>
              <tbody>
                {stats.recent.map((booking) => (
                  <tr key={booking.id}>
                    <td className="font-mono text-[0.68rem] font-bold">{booking.code}</td>
                    <td className="max-w-[10rem] truncate">{booking.customer?.name || 'Guest'}</td>
                    <td className="max-w-[12rem] truncate">{booking.vehicle?.name}</td>
                    <td className="whitespace-nowrap text-[0.68rem] text-muted">{longDate(booking.startDate)} → {longDate(booking.endDate)}</td>
                    <td className="text-right font-bold">{inr(booking.total)}</td>
                    <td><StatusPill status={booking.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        <div className="space-y-4">
          {content.dashboard_show_recent && events.length > 0 && (
          <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold">Recent events</h2>
              <Link to="/admin/bookings" className="text-[0.68rem] font-bold text-forest hover:underline">Bookings</Link>
            </div>
            <ul className="mt-3 space-y-2.5">
              {events.map((event) => {
                const tone = eventMeta(event.kind);
                const Icon = tone.icon;
                const inner = (
                  <>
                    <span className={cn('mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', tone.tone)}>
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.7rem] font-extrabold text-ink">{event.title}</p>
                      {event.body && <p className="mt-0.5 line-clamp-2 text-[0.62rem] leading-4 text-muted">{event.body}</p>}
                      <p className="mt-0.5 text-[0.54rem] font-bold uppercase tracking-wider text-muted/70">
                        {event.bookingCode ? `${event.bookingCode} · ` : ''}{(event.kind || 'update').replace(/_/g, ' ')}
                      </p>
                    </div>
                  </>
                );
                return (
                  <li key={event.id}>
                    {event.link ? (
                      <Link
                        to={event.link}
                        className="group flex items-start gap-2.5 rounded-xl border border-line/80 bg-paper/70 px-2.5 py-2 transition hover:border-forest/30 hover:bg-lime/[0.06] focus-visible:border-forest/40"
                      >
                        {inner}
                        <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted/40 transition group-hover:translate-x-0.5 group-hover:text-forest" />
                      </Link>
                    ) : (
                      <div className="flex items-start gap-2.5 rounded-xl border border-line/80 bg-paper/70 px-2.5 py-2">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          )}

          {content.dashboard_show_fleet && analytics?.compliance && !analytics.compliance.isClean && (
            <section className="min-w-0 rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold">Compliance</h2>
                <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[0.58rem] font-extrabold text-rose-700">
                  {analytics.compliance.expired.length} expired · {analytics.compliance.expiring.length} expiring
                </span>
              </div>
              {analytics.compliance.watchlist.length ? (
                <ul className="mt-2.5 space-y-2">
                  {analytics.compliance.watchlist.slice(0, 4).map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-rose-200/60 bg-rose-50/20 px-2.5 py-1.5">
                      <Link to={`/vehicles/${row.id}`} className="truncate text-[0.7rem] font-extrabold hover:text-rose-700 hover:underline">{row.name}</Link>
                      <span className="shrink-0 text-[0.56rem] text-rose-700">
                        {Object.values(row.docs).filter((doc) => doc.status !== 'ok').map((doc) => (doc.status === 'expired' ? `${doc.label} expired` : `${doc.label} ${doc.daysLeft}d`)).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          )}

          {content.dashboard_show_fleet && (
          <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
            <h2 className="text-sm font-extrabold">{content.dashboard_top_vehicles}</h2>
            <p className="mt-0.5 text-[0.6rem] text-muted">{content.dashboard_top_vehicles_desc}</p>
            <div className="mt-3 space-y-3">
              {[...stats.topVehicles].sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).map((vehicle) => {
                const util = stats.utilizationByVehicle.find((row) => row.id === vehicle.id)?.utilization;
                return (
                  <Link key={vehicle.id} to={`/vehicles/${vehicle.id}`} className="group flex items-center gap-3 rounded-xl bg-white/60 transition hover:bg-lime/[0.08]">
                    {vehicle.imageUrl ? (
                      <img src={vehicle.imageUrl} alt="" className="h-11 w-14 rounded-lg object-cover ring-1 ring-line" />
                    ) : (
                      <span className="flex h-11 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-sand to-white"><Car className="h-4 w-4 text-muted" /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.74rem] font-extrabold">{vehicle.name}</p>
                      <p className="text-[0.6rem] text-muted">
                        {content.dashboard_top_bookings.replace('{count}', String(vehicle.bookings)).replace('{s}', vehicle.bookings === 1 ? '' : 's')}
                        {util !== undefined ? ` · ${content.dashboard_top_util.replace('{percent}', String(Math.round(Number(util))))}` : ''}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted shrink-0 transition group-hover:translate-x-0.5 group-hover:text-forest" />
                  </Link>
                );
              })}
            </div>
          </section>
          )}

          {content.dashboard_show_fleet && (
          <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
            <h2 className="text-sm font-extrabold">{content.dashboard_util_title}</h2>
            <div className="mt-3 space-y-2.5">
              {stats.utilizationByVehicle.map((vehicle) => (
                <div key={vehicle.id}>
                  <div className="flex items-center justify-between text-[0.68rem]">
                    <span className="truncate font-semibold">{vehicle.name}</span>
                    <span className="font-extrabold">{vehicle.utilization}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100">
                    <div className={`h-full rounded-full ${vehicle.utilization > 70 ? 'bg-lime-deep' : 'bg-forest/70'}`} style={{ width: `${vehicle.utilization}%` }} />
                  </div>
                </div>
              ))}
              {utilizationTrendDays.length > 0 && (
                <div className="mt-4 border-t border-line/70 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">Fleet utilisation · past 14 days</p>
                    {utilizationTrendAvg !== null && <span className="text-[0.58rem] font-bold text-muted">{utilizationTrendAvg}% avg</span>}
                  </div>
                  <div className="mt-2">
                    <LineChart data={utilizationTrendDays} ariaLabel="Fleet utilisation trend" description="Fleet utilisation over the past 14 days" format={(value) => `${value}%`} colorIndex={3} />
                  </div>
                </div>
              )}
            </div>
          </section>
          )}

          <section className="grid grid-cols-2 gap-3">
            <div className="stat-card">
              <Users className="h-4 w-4 text-moss" />
              <p className="mt-2 text-xl font-extrabold">{stats.customers}</p>
              <p className="text-[0.6rem] uppercase tracking-wider text-muted">Customers</p>
            </div>
            <div className="stat-card">
              <Clock className="h-4 w-4 text-coral" />
              <p className="mt-2 text-xl font-extrabold">{stats.pending}</p>
              <p className="text-[0.6rem] uppercase tracking-wider text-muted">Pending</p>
            </div>
            <div className="stat-card">
              <Car className="h-4 w-4 text-aqua" />
              <p className="mt-2 text-xl font-extrabold">{stats.fleetSize}</p>
              <p className="text-[0.6rem] uppercase tracking-wider text-muted">Fleet size</p>
            </div>
            <div className="stat-card">
              <Percent className="h-4 w-4 text-lime-deep" />
              <p className="mt-2 text-xl font-extrabold">{stats.inService}</p>
              <p className="text-[0.6rem] uppercase tracking-wider text-muted">In service</p>
            </div>
          </section>
        </div>
      </div>

      <p className="text-center text-[0.6rem] text-muted">Figures update live from {monthLabel(stats.monthly[0]?.key)} to today.</p>
    </div>
  );
}
