import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ChartLine, Coins, Download, HandCoins, PieChart, RotateCcw, ShieldCheck, Star, TrendingUp, Users, Wallet, Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import BarChart from '../../components/charts/BarChart.jsx';
import Donut from '../../components/charts/Donut.jsx';
import Heatmap from '../../components/charts/Heatmap.jsx';
import KpiCard from '../../components/charts/KpiCard.jsx';
import LineChart from '../../components/charts/LineChart.jsx';
import FleetContribution from '../../components/admin/FleetContribution.jsx';
import { Stars } from '../../components/ui.jsx';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { analyticsCsv } from '../../lib/analyticsCsv.js';
import { getSiteContent } from '../../lib/site.js';
import { downloadCsv } from '../../lib/csv.js';
import { cn, inr, inrShort, shortDate } from '../../lib/format.js';
import { todayISO } from '../../lib/pricing.js';
import { REFUND_METHOD_LABELS } from '../../lib/returns.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HEAT_SLOT_KEYS = ['early', 'morning', 'afternoon', 'evening', 'night'];

export default function AnalyticsPage() {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = getSiteContent(meta.settings);
  const [stats, setStats] = useState(null);
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.adminStats()
      .then((next) => { if (alive) setStats(next); })
      .catch((nextError) => {
        if (!alive) return;
        setError(nextError.message || content.analytics_error_copy);
        push(nextError.message, 'error');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const tripWord = (count) => `${count} ${count === 1 ? content.analytics_units_trip : content.analytics_units_trips}`;

  if (loading && !stats) {
    return <div className="h-96 animate-pulse rounded-2xl bg-stone-200/70" />;
  }

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

  const analytics = stats?.analytics;
  const km = analytics?.km ?? {
    trips: 0, driven: 0, avgDriven: 0, excess: 0, excessKmFees: 0, cappedTrips: 0, byVehicle: [],
  };
  const extensions = analytics?.extensions ?? { count: 0, revenueDelta: 0, byMonth: [], recent: [] };
  const returnTimes = analytics?.returnTimes ?? { settled: 0, onTime: 0, late: 0, onTimeRate: 0, avgLateDays: 0 };
  const lateReturns = analytics?.lateReturns ?? [];
  const utilizationTrend = analytics?.utilizationTrend ?? [];
  if (content.analytics_enabled === false || !analytics) {
    return (
      <div className="rounded-3xl border border-dashed border-moss/25 bg-white/65 px-6 py-14 text-center">
        <PieChart className="h-8 w-8 text-moss" />
        <h1 className="mt-3 text-lg font-extrabold tracking-tight">Analytics is switched off</h1>
        <p className="mt-1 max-w-sm text-sm leading-6 text-muted">Turn it back on from Admin → Content → Feature toggles to see the charts here.</p>
      </div>
    );
  }

  const maintenance = analytics.maintenance ?? {
    overdue: 0, due: 0, inWorkshop: 0, spendYtd: 0, spend90: 0, visits: 0, avgCost: 0,
    monthly: [], byKind: [], vendors: [], attention: [], downtimeDays: 0, upcomingWorkshop: 0,
  };
  const deposits = analytics.deposits ?? {
    settled: 0, depositsHeld: 0, depositsReleased: 0, depositsDeducted: 0,
    damageRecovered: 0, lateFees: 0, cleaningFees: 0, fuelFees: 0, excessKmFees: 0, extraDue: 0, overdue: 0,
    awaiting: 0, awaitingAmount: 0, awaitingAvgDays: 0, awaitingMaxDays: 0,
    refundsByMethod: [],
  };
  const reviews = analytics.reviews ?? {
    count: 0, average: 0, distribution: [], recent: { count: 0, average: 0 }, trend: [],
    byVehicle: [], lowRated: [], fiveStarShare: 0, lowShare: 0,
  };
  // Best and weakest ratings, without repeating a vehicle when the fleet is small.
  const ratedVehicles = reviews.byVehicle.filter((row) => row.count > 0);
  const bestVehicles = ratedVehicles.slice(0, 3);
  const worstVehicles = ratedVehicles.slice(-3).filter((row) => !bestVehicles.some((best) => best.vehicleId === row.vehicleId));

  const slice = (field, size = range) => analytics.daily.slice(-size).map((row) => ({ label: row.label, value: row[field] }));
  const sum = (field, size = range) => analytics.daily.slice(-size).reduce((total, row) => total + (row[field] || 0), 0);
  const priorWindow = (size = range) => analytics.daily.slice(-range - size, -range);
  const hasPrior = (size = range) => priorWindow(size).length > 0;
  const priorSum = (field, size = range) => priorWindow(size).reduce((total, row) => total + (row[field] || 0), 0);
  // `null` means "no earlier period to compare against" (e.g. a 90-day window
  // when only 90 days of history exist) — the KPI then shows no fake delta.
  const delta = (field) => {
    const current = sum(field, range);
    const previous = priorSum(field, range);
    if (!hasPrior(range)) return null;
    return previous > 0 ? Math.round(((current - previous) / previous) * 100) : (current > 0 ? null : 0);
  };
  const priorHint = hasPrior(range)
    ? content.analytics_prior_hint_tpl.replace('{days}', String(range))
    : content.analytics_prior_none;
  const rangeLabel = range === 7
    ? content.analytics_range_7
    : range === 90 ? content.analytics_range_90 : content.analytics_range_30;

  // Completion and cancellation are window-accurate here (the stat's all-time
  // completedRate is reserved for the Dashboard top band).
  const resolvedInWindow = sum('completed', range) + sum('cancelled', range);
  const completionInWindow = resolvedInWindow > 0 ? Math.round((sum('completed', range) / resolvedInWindow) * 100) : 0;
  const cancellationInWindow = resolvedInWindow > 0 ? Math.round((sum('cancelled', range) / resolvedInWindow) * 100) : 0;
  // The average booking value follows the selected window, like every other
  // money KPI on this page. (The Dashboard keeps the all-time value.)
  const completedInWindow = sum('completed', range);
  const avgBookingValueInWindow = completedInWindow > 0
    ? Math.round(sum('recognized', range) / completedInWindow)
    : 0;

  const heatLabels = { early: content.analytics_heat_early, morning: content.analytics_heat_morning, afternoon: content.analytics_heat_afternoon, evening: content.analytics_heat_evening, night: content.analytics_heat_night };

  const exportNow = () => {
    setExporting(true);
    try {
      downloadCsv(`rove-analytics-${todayISO()}.csv`, analyticsCsv(analytics, range));
      push(content.analytics_exported, 'success');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{content.analytics_page_eyebrow}</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{content.analytics_page_title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted">{content.analytics_page_intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-line bg-white p-0.5" role="group" aria-label={content.analytics_range_label}>
            {[7, 30, 90].map((days) => (
              <button key={days} type="button" onClick={() => setRange(days)} aria-pressed={range === days} className={`rounded-full px-2.5 py-1 text-[0.58rem] font-bold transition ${range === days ? 'bg-ink text-lime' : 'text-muted hover:text-ink'}`}>
                {days === 7 ? content.analytics_range_7 : days === 30 ? content.analytics_range_30 : content.analytics_range_90}
              </button>
            ))}
          </div>
          <button type="button" onClick={exportNow} disabled={exporting} className="btn btn-white btn-sm">
            <Download className="h-3.5 w-3.5" /> {content.analytics_export}
          </button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={content.analytics_revenue_label} value={inrShort(sum('recognized'))} hint={priorHint} delta={delta('recognized')} icon={Coins} tone="bg-gradient-to-br from-lime to-lime-deep text-ink" spark={analytics.daily.slice(-range).map((row) => row.recognized)} />
        <KpiCard label={content.analytics_gst_label} value={inrShort(sum('gst'))} hint={priorHint} delta={delta('gst')} icon={Wallet} tone="bg-aqua/25 text-forest" spark={analytics.daily.slice(-range).map((row) => row.gst)} />
        <KpiCard label={content.analytics_bookings_label} value={sum('created')} hint={priorHint} delta={delta('created')} icon={ChartLine} tone="bg-sun/25 text-ink" spark={analytics.daily.slice(-range).map((row) => row.created)} />
        <KpiCard label={content.analytics_completion_label} value={`${completionInWindow}%`} hint={content.analytics_complete_rate.replace('{percent}', String(completionInWindow))} icon={TrendingUp} tone="bg-forest/15 text-forest" spark={analytics.daily.slice(-range).map((row) => row.completed)} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <KpiCard label={content.analytics_cancel_label} value={`${cancellationInWindow}%`} hint={content.analytics_cancel_hint.replace('{count}', String(sum('cancelled', range))).replace('{s}', sum('cancelled', range) === 1 ? '' : 's')} icon={HandCoins} tone="bg-coral/15 text-coral" />
        <KpiCard label={content.analytics_cash_received_label} value={inrShort(sum('received'))} hint={content.analytics_cash_hint} icon={Coins} tone="bg-aqua/25 text-forest" />
        <KpiCard label={content.analytics_float_label} value={inrShort(analytics.depositFloat ?? deposits.depositsHeld)} hint={content.analytics_float_hint} icon={ShieldCheck} tone="bg-gradient-to-br from-lime to-lime-deep text-ink" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="stat-card"><Wallet className="h-4 w-4 text-aqua" /><p className="mt-2 text-xl font-extrabold">{inrShort(analytics.outstandingTotal)}</p><p className="text-[0.6rem] uppercase tracking-wider text-muted">{content.analytics_outstanding_label}</p></div>
        <div className="stat-card"><Users className="h-4 w-4 text-sun" /><p className="mt-2 text-xl font-extrabold">{inrShort(avgBookingValueInWindow)}</p><p className="text-[0.6rem] uppercase tracking-wider text-muted">{content.analytics_avg_value_label}</p></div>
        <div className="stat-card"><Users className="h-4 w-4 text-moss" /><p className="mt-2 text-xl font-extrabold">{analytics.activeRentals}</p><p className="text-[0.6rem] uppercase tracking-wider text-muted">{content.analytics_active_label}</p></div>
        <div className="stat-card"><Users className="h-4 w-4 text-sun" /><p className="mt-2 text-xl font-extrabold">{analytics.repeatRate}%</p><p className="text-[0.6rem] uppercase tracking-wider text-muted">{content.analytics_repeat_label}</p></div>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-extrabold">{content.analytics_section_money}</h2>
        <p className="mt-0.5 text-[0.64rem] text-muted">Recognised revenue vs cash actually captured, plus the GST stream.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-line p-3"><LineChart data={slice('recognized')} ariaLabel="Recognised revenue" description={content.analytics_chart_revenue_desc} colorIndex={0} format={inrShort} /></div>
          <div className="rounded-xl border border-line p-3"><LineChart data={slice('received')} ariaLabel="Cash received" description={content.analytics_chart_cash_desc} colorIndex={3} format={inrShort} /></div>
          <div className="rounded-xl border border-line p-3"><LineChart data={slice('gst')} ariaLabel="GST collected" description="GST collected each day from completed trips." colorIndex={2} format={inrShort} /></div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-extrabold">{content.analytics_section_deposits}</h2>
        <p className="mt-0.5 text-[0.64rem] text-muted">Settled at drop-off by the desk — what came back, what was deducted and what is still held.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-xl border border-line p-3"><p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Deposits held</p><p className="mt-1 text-lg font-extrabold">{inrShort(deposits.depositsHeld)}</p><p className="text-[0.58rem] text-muted">{deposits.overdue} overdue · {deposits.awaiting} awaiting settle{deposits.awaitingMaxDays > 0 ? ` · oldest ${deposits.awaitingMaxDays}d` : ''}</p></div>
          <div className="rounded-xl border border-line p-3"><p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Awaiting settlement</p><p className="mt-1 text-lg font-extrabold text-amber-700">{inrShort(deposits.awaitingAmount)}</p><p className="text-[0.58rem] text-muted">{deposits.awaiting === 0 ? 'none waiting' : `${deposits.awaiting} trip${deposits.awaiting === 1 ? '' : 's'} · avg ${deposits.awaitingAvgDays}d waiting`}</p></div>
          <div className="rounded-xl border border-line p-3"><p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Released</p><p className="mt-1 text-lg font-extrabold text-forest">{inrShort(deposits.depositsReleased)}</p><p className="text-[0.58rem] text-muted">{deposits.settled} settled</p></div>
          <div className="rounded-xl border border-line p-3"><p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Deducted</p><p className="mt-1 text-lg font-extrabold text-coral">{inrShort(deposits.depositsDeducted)}</p><p className="text-[0.58rem] text-muted">damage · late · cleaning · km</p></div>
          <div className="rounded-xl border border-line p-3"><p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Extra due</p><p className="mt-1 text-lg font-extrabold">{inrShort(deposits.extraDue)}</p><p className="text-[0.58rem] text-muted">beyond the deposit</p></div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Charges by reason</p>
            <div className="mt-2">
              <BarChart
                rows={[
                  { label: 'Damage', value: deposits.damageRecovered },
                  { label: 'Late fees', value: deposits.lateFees },
                  { label: 'Cleaning', value: deposits.cleaningFees },
                  { label: 'Fuel', value: deposits.fuelFees },
                  { label: 'Excess km', value: deposits.excessKmFees },
                ]}
                ariaLabel="Deposit charges by reason"
                format={inrShort}
                emptyTitle="No deductions yet"
              />
            </div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Deposit book</p>
            <div className="mt-2">
              <BarChart
                rows={[
                  { label: 'Held', value: deposits.depositsHeld },
                  { label: 'Released', value: deposits.depositsReleased },
                  { label: 'Deducted', value: deposits.depositsDeducted },
                ]}
                ariaLabel="Deposit book"
                format={inrShort}
                emptyTitle="No deposits yet"
              />
            </div>
          </div>
        </div>
        {(deposits.refundsByMethod ?? []).length > 0 && (
          <div className="mt-4 rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Refunds by method</p>
            <p className="mt-0.5 text-[0.58rem] text-muted">How the released deposits travelled back — the drop-off twin of the pick-up collection record.</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {(deposits.refundsByMethod ?? []).map((row) => (
                <span key={row.method} className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-[0.58rem] font-bold text-muted">{row.count} {(REFUND_METHOD_LABELS[row.method] || row.method).replace(/^\w/, (char) => char.toUpperCase())}</span>
              ))}
            </div>
            <div className="mt-2">
              <BarChart
                rows={(deposits.refundsByMethod ?? []).map((row) => ({ label: (REFUND_METHOD_LABELS[row.method] || row.method).replace(/^\w/, (char) => char.toUpperCase()), value: row.count }))}
                ariaLabel="Deposit refunds by method"
                format={(value) => `${value} refund${value === 1 ? '' : 's'}`}
                emptyTitle="No refunds recorded"
              />
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold">{content.analytics_returns_label}</h2>
            <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_returns_desc}</p>
          </div>
          {returnTimes.settled > 0 && (
            <span className="rounded-full border border-forest/25 bg-forest/10 px-2.5 py-0.5 text-[0.6rem] font-extrabold text-forest">
              {content.analytics_returns_avg_late
                .replace('{days}', String(returnTimes.avgLateDays))
                .replace('{s}', returnTimes.avgLateDays === 1 ? '' : 's')}
            </span>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{returnTimes.settled} settled</p>
            <div className="mt-2">
              <Donut
                segments={[
                  { label: content.analytics_returns_on_time, value: returnTimes.onTime },
                  { label: content.analytics_returns_late, value: returnTimes.late },
                ]}
                centerLabel={`${returnTimes.onTimeRate}% on time`}
                ariaLabel="On-time versus late returns"
                emptyTitle={content.analytics_returns_empty}
              />
            </div>
          </div>
          <div className="grid gap-2 content-start">
            <div className="rounded-xl border border-line bg-paper/60 p-3">
              <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_returns_on_time}</p>
              <p className="mt-1 text-lg font-extrabold text-forest">{returnTimes.onTime}</p>
            </div>
            <div className="rounded-xl border border-line bg-paper/60 p-3">
              <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_returns_late}</p>
              <p className="mt-1 text-lg font-extrabold text-coral">{returnTimes.late}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-line/70 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold">{content.analytics_late_vehicle_title}</h3>
              <p className="mt-0.5 text-[0.62rem] text-muted">{content.analytics_late_vehicle_desc}</p>
            </div>
            {lateReturns.length > 0 && (
              <span className="rounded-full border border-coral/25 bg-coral/10 px-2.5 py-0.5 text-[0.58rem] font-extrabold text-ink">
                {lateReturns.length} vehicle{lateReturns.length === 1 ? '' : 's'} with late returns
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-line p-3">
              <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Late hours by vehicle</p>
              <div className="mt-2">
                <BarChart
                  rows={lateReturns.map((row) => ({ label: row.vehicle, value: row.lateHours }))}
                  ariaLabel="Late hours by vehicle"
                  format={(value) => `${Number(value).toLocaleString('en-IN')}h late`}
                  emptyTitle={content.analytics_late_vehicle_empty}
                />
              </div>
            </div>
            <div className="rounded-xl border border-line p-3">
              <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Late-fee revenue by vehicle</p>
              <div className="mt-2">
                <BarChart
                  rows={lateReturns.map((row) => ({ label: row.vehicle, value: row.lateFees }))}
                  ariaLabel="Late-fee revenue by vehicle"
                  format={inrShort}
                  emptyTitle={content.analytics_late_vehicle_empty}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-extrabold">{content.analytics_customer_mix_title}</h2>
        <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_customer_mix_desc}</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Revenue by customer type</p>
            <div className="mt-2">
              <Donut
                segments={[
                  { label: content.analytics_new_revenue_label, value: analytics.customerMix.newRevenue },
                  { label: content.analytics_returning_revenue_label, value: analytics.customerMix.returningRevenue },
                ]}
                centerLabel={`${analytics.customerMix.returningShare}% repeat`}
                ariaLabel="Revenue from first-time versus returning customers"
              />
            </div>
            <p className="mt-2 text-[0.6rem] text-muted">{analytics.customerMix.newTrips} first trips · {analytics.customerMix.returningTrips} repeat trips</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_trip_length_label}</p>
            <p className="mt-0.5 text-[0.58rem] text-muted">{content.analytics_trip_length_desc}</p>
            <div className="mt-2">
              <BarChart
                rows={analytics.tripLengthMix.map((row) => ({ label: row.label, value: row.count }))}
                ariaLabel={content.analytics_trip_length_label}
                format={(value) => tripWord(value)}
                emptyTitle={content.analytics_trip_length_label}
                emptyDescription={content.analytics_trip_length_desc}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold">{content.analytics_customer_acquisition_title}</h2>
            <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_customer_acquisition_desc}</p>
          </div>
          <span className="badge bg-lime/20 text-ink">
            {content.analytics_customer_acquisition_total
              .replace('{count}', String(analytics.customerAcquisitionTrend?.total ?? 0))
              .replace('{recent}', String(analytics.customerAcquisitionTrend?.thisMonth ?? 0))}
          </span>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_customer_acquisition_monthly}</p>
            {analytics.customerAcquisitionTrend?.monthly?.length ? (
              <LineChart
                data={analytics.customerAcquisitionTrend.monthly.map((row) => ({ label: row.label, value: row.count }))}
                ariaLabel={content.analytics_customer_acquisition_title}
                description={content.analytics_customer_acquisition_desc}
                colorIndex={0}
                height={150}
              />
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-line bg-paper px-3 py-4 text-center text-[0.66rem] text-muted">No registration data yet.</p>
            )}
          </div>
          <div className="rounded-xl border border-line p-3">
            <BarChart
              rows={analytics.tripLengthMix.map((row) => ({ label: row.label, value: row.count }))}
              ariaLabel={content.analytics_trip_length_label}
              format={(value) => tripWord(value)}
              emptyTitle={content.analytics_trip_length_label}
              emptyDescription={content.analytics_trip_length_desc}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-extrabold"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {content.analytics_reviews_title}</h2>
            <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_reviews_desc}</p>
          </div>
          <Link to="/admin/reviews" className="btn btn-white btn-sm">{content.analytics_reviews_open}</Link>
        </div>

        {reviews.count === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-line px-4 py-8 text-center">
            <p className="text-[0.72rem] font-extrabold">{content.analytics_reviews_empty}</p>
            <p className="mt-1 text-[0.64rem] text-muted">{content.analytics_reviews_empty_desc}</p>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_avg}</p>
                <p className="mt-1 flex items-baseline gap-1 text-lg font-extrabold">
                  {reviews.average.toFixed(1)}<span className="text-[0.62rem] font-bold text-muted">/ 5</span>
                </p>
                <Stars value={reviews.average} showValue={false} size="h-3 w-3" className="mt-1" />
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_total}</p>
                <p className="mt-1 text-lg font-extrabold">{reviews.count}</p>
                <p className="text-[0.58rem] text-muted">{content.analytics_reviews_five} · {reviews.fiveStarShare}%</p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_recent}</p>
                <p className="mt-1 text-lg font-extrabold">{reviews.recent.count}</p>
                <p className="text-[0.58rem] text-muted">
                  {reviews.recent.count ? content.analytics_reviews_avg_tpl.replace('{rating}', reviews.recent.average.toFixed(1)) : content.analytics_reviews_empty}
                </p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_replied}</p>
                <p className="mt-1 text-lg font-extrabold">{reviews.replyRate ?? 0}%</p>
                <p className="text-[0.58rem] text-muted">
                  {content.analytics_reviews_replied_tpl
                    .replace('{replied}', String(reviews.replied ?? 0))
                    .replace('{total}', String(reviews.count))}
                </p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_low}</p>
                <p className="mt-1 text-lg font-extrabold">{reviews.lowShare}%</p>
                <p className="text-[0.58rem] text-muted">{content.analytics_reviews_low_tpl.replace('{count}', String(reviews.lowCount ?? 0)).replace('{total}', String(reviews.count))}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_dist}</p>
                <ul className="mt-2 space-y-1.5" aria-label={content.analytics_reviews_dist}>
                  {reviews.distribution.map((row) => (
                    <li key={row.stars} className="flex items-center gap-2">
                      <span className="w-7 shrink-0 text-[0.62rem] font-bold text-muted">{row.stars}★</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                        <span className="block h-full rounded-full bg-amber-400" style={{ width: `${row.share}%` }} />
                      </span>
                      <span className="w-8 shrink-0 text-right text-[0.6rem] font-semibold">{row.count}</span>
                      <span className="w-8 shrink-0 text-right text-[0.56rem] text-muted">{row.share}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_trend}</p>
                <p className="mt-0.5 text-[0.58rem] text-muted">{content.analytics_reviews_trend_desc}</p>
                <div className="mt-2">
                  <LineChart
                    data={reviews.trend.map((row) => ({ label: row.label, value: row.average }))}
                    ariaLabel={content.analytics_reviews_trend}
                    format={(value) => Number(value).toFixed(1)}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_vehicle}</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-emerald-700">Top rated</p>
                    <ul className="mt-1.5 space-y-1">
                      {bestVehicles.map((row) => (
                        <li key={row.vehicleId} className="flex items-center justify-between gap-2 text-[0.64rem]">
                          <span className="min-w-0 truncate font-semibold">{row.name}</span>
                          <span className="shrink-0 font-bold text-emerald-700">{row.average.toFixed(1)} <span className="font-normal text-muted">({row.count})</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-rose-700">Needs attention</p>
                    <ul className="mt-1.5 space-y-1">
                      {worstVehicles.length ? worstVehicles.map((row) => (
                        <li key={row.vehicleId} className="flex items-center justify-between gap-2 text-[0.64rem]">
                          <span className="min-w-0 truncate font-semibold">{row.name}</span>
                          <span className="shrink-0 font-bold text-rose-700">{row.average.toFixed(1)} <span className="font-normal text-muted">({row.count})</span></span>
                        </li>
                      )) : <li className="text-[0.62rem] text-muted">Not enough reviews to rank.</li>}
                    </ul>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_reviews_low_title}</p>
                {reviews.lowRated.length ? (
                  <ul className="mt-2 divide-y divide-line/70">
                    {reviews.lowRated.map((row) => (
                      <li key={row.id} className="py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-[0.66rem] font-extrabold">{row.author}</p>
                          <span className="shrink-0 text-[0.6rem] font-bold text-amber-700">{row.rating}★</span>
                        </div>
                        <p className="truncate text-[0.56rem] text-muted">{row.vehicle} · {shortDate(row.createdAt)}</p>
                        {row.comment && <p className="mt-0.5 line-clamp-2 text-[0.6rem] leading-4 text-muted">{row.comment}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-5 text-center text-[0.66rem] text-muted">{content.analytics_reviews_low_none}</p>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-extrabold">{content.analytics_cancel_reasons_title}</h2>
        <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_cancel_reasons_desc}</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <BarChart
              rows={(analytics.cancellationReasons ?? []).map((row) => ({ label: row.label, value: row.count }))}
              ariaLabel={content.analytics_cancel_reasons_title}
              format={(value) => tripWord(value)}
              emptyTitle={content.analytics_cancel_reasons_title}
              emptyDescription={content.analytics_cancel_reasons_none}
            />
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_no_show_title}</p>
            <p className="mt-0.5 text-[0.58rem] text-muted">{content.analytics_no_show_desc}</p>
            {(stats.noShows ?? []).length ? (
              <ul className="mt-2 divide-y divide-line/70 text-[0.66rem]">
                {(stats.noShows ?? []).map((row) => (
                  <li key={row.code} className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="font-mono font-bold">{row.code}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{row.customer || 'Guest'} · {row.vehicle || 'Vehicle removed'}</span>
                    <span className="font-semibold text-muted">{shortDate(row.startDate)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[0.64rem] text-muted">{content.analytics_no_show_none}</p>
            )}
            <p className="mt-2 text-[0.56rem] leading-4 text-muted">{content.analytics_no_show_days}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-extrabold"><Wrench className="h-4 w-4 text-forest" /> {content.analytics_section_maintenance}</h2>
            <p className="mt-0.5 text-[0.64rem] text-muted">Real odometer and interval tracking — overdue work, workshop spend and which vehicles are eating the budget.</p>
          </div>
          <Link to="/admin/maintenance" className="btn btn-white btn-sm">Open maintenance desk</Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
            <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-rose-700">Overdue service</p>
            <p className="mt-1 text-lg font-extrabold text-rose-800">{maintenance.overdue}</p>
            <p className="text-[0.58rem] text-muted">{maintenance.inWorkshop} in workshop now</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-amber-800">Due soon</p>
            <p className="mt-1 text-lg font-extrabold">{maintenance.due}</p>
            <p className="text-[0.58rem] text-muted">Within 15% of an interval</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Spend YTD</p>
            <p className="mt-1 text-lg font-extrabold">{inrShort(maintenance.spendYtd)}</p>
            <p className="text-[0.58rem] text-muted">{inrShort(maintenance.spend90)} · last 90 days</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Workshop load</p>
            <p className="mt-1 text-lg font-extrabold">{maintenance.downtimeDays}d</p>
            <p className="text-[0.58rem] text-muted">{maintenance.upcomingWorkshop} block{maintenance.upcomingWorkshop === 1 ? '' : 's'} ahead</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Spend by month</p>
            <div className="mt-2"><BarChart rows={maintenance.monthly.map((row) => ({ label: row.label, value: row.cost }))} ariaLabel="Workshop spend by month" format={inrShort} emptyTitle="No workshop spend yet" /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Spend by work type</p>
            <div className="mt-2"><BarChart rows={maintenance.byKind.map((row) => ({ label: row.label, value: row.cost }))} ariaLabel="Workshop spend by work type" format={inrShort} emptyTitle="No work logged yet" /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Top workshops</p>
            <div className="mt-2"><BarChart rows={maintenance.vendors.map((row) => ({ label: row.label, value: row.cost }))} ariaLabel="Workshop spend by vendor" format={inrShort} emptyTitle="No vendors yet" /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Needs a slot</p>
            {maintenance.attention.length ? (
              <ul className="mt-2 divide-y divide-line/70">
                {maintenance.attention.slice(0, 5).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[0.68rem] font-extrabold">{row.name}</p>
                      <p className="truncate text-[0.56rem] text-muted">{row.reason}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.55rem] font-extrabold ${row.band === 'overdue' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{row.progress}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-5 text-center text-[0.66rem] text-muted">No service backlog. Every tracked vehicle is inside its window.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-extrabold">{content.analytics_section_demand}</h2>
        <p className="mt-0.5 text-[0.64rem] text-muted">New bookings, trips started and when pick-ups happen.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <LineChart data={slice('created')} ariaLabel="Bookings created" description={content.analytics_chart_bookings_desc} colorIndex={1} format={(value) => tripWord(value)} />
          </div>
          <div className="rounded-xl border border-line p-3">
            <LineChart data={slice('started')} ariaLabel="Trips started" description="Trips that actually started, by day." colorIndex={4} format={(value) => tripWord(value)} />
          </div>
        </div>
        <div className="mt-4">
          <div className="rounded-xl border border-line p-3">
            <p className="flex items-center justify-between text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">
              {content.analytics_chart_heat}
              <span className="text-[0.55rem] normal-case text-muted">{content.analytics_chart_heat_desc}</span>
            </p>
            <div className="mt-2 overflow-x-auto">
              <Heatmap rows={analytics.heat} weekdays={WEEKDAYS} slots={HEAT_SLOT_KEYS} slotLabels={heatLabels} ariaLabel={content.analytics_chart_heat} />
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-line p-3">
            <p className="flex items-center justify-between text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">
              {content.analytics_chart_heat_dropoff}
              <span className="text-[0.55rem] normal-case text-muted">{content.analytics_chart_heat_dropoff_desc}</span>
            </p>
            <div className="mt-2 overflow-x-auto">
              <Heatmap rows={analytics.dropoffHeat ?? []} weekdays={WEEKDAYS} slots={HEAT_SLOT_KEYS} slotLabels={heatLabels} ariaLabel={content.analytics_chart_heat_dropoff} emptyTitle={content.analytics_chart_heat_dropoff} emptyDescription={content.analytics_chart_heat_dropoff_desc} />
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_chart_weekday}</p>
            <div className="mt-2"><BarChart rows={analytics.weekdayMix.map((row) => ({ label: row.label, value: row.count }))} ariaLabel={content.analytics_chart_weekday} format={(value) => tripWord(value)} /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_hours_label}</p>
            <div className="mt-2"><BarChart rows={(analytics.hours ?? []).map((row) => ({ label: row.label, value: row.value }))} ariaLabel={content.analytics_hours_label} format={(value) => tripWord(value)} emptyTitle={content.analytics_hours_label} emptyDescription={content.analytics_hours_desc} /></div>
          </div>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_lead_mix_label}</p>
            <p className="mt-0.5 text-[0.56rem] text-muted">{content.analytics_lead_mix_desc}</p>
            <div className="mt-2"><BarChart rows={(analytics.leadTimeMix ?? []).map((row) => ({ label: row.label, value: row.count }))} ariaLabel={content.analytics_lead_mix_label} format={(value) => tripWord(value)} emptyTitle={content.analytics_lead_mix_label} emptyDescription={content.analytics_lead_mix_desc} /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_dropoff_label}</p>
            <div className="mt-2"><BarChart rows={(analytics.dropoffHours ?? []).map((row) => ({ label: row.label, value: row.value }))} ariaLabel={content.analytics_dropoff_label} format={(value) => tripWord(value)} emptyTitle={content.analytics_dropoff_label} emptyDescription={content.analytics_dropoff_desc} /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_weekday_revenue_label}</p>
            <div className="mt-2"><BarChart rows={(analytics.weekdayRevenue ?? []).map((row) => ({ label: row.label, value: row.revenue }))} ariaLabel={content.analytics_weekday_revenue_label} format={inrShort} emptyTitle={content.analytics_weekday_revenue_label} emptyDescription={content.analytics_weekday_revenue_desc} /></div>
          </div>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_chart_hubs} · {content.analytics_units_trips}</p>
            <div className="mt-2"><BarChart rows={analytics.hubMix.map((row) => ({ label: row.label, value: row.count }))} ariaLabel={content.analytics_chart_hubs} format={(value) => tripWord(value)} /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_revenue_vehicle_label}</p>
            <div className="mt-2"><BarChart rows={(stats.topVehicles ?? []).map((row) => ({ label: row.name, value: row.revenue }))} ariaLabel={content.analytics_revenue_vehicle_label} format={inrShort} emptyTitle={content.analytics_revenue_vehicle_label} emptyDescription={content.analytics_revenue_vehicle_desc} /></div>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Waitlist demand</p>
            <div className="flex flex-wrap items-center gap-1.5 text-[0.58rem] font-extrabold">
              <span className="rounded-full bg-paper px-2 py-0.5 text-muted">{analytics.waitlist?.total ?? 0} watching</span>
              <span className="rounded-full border border-forest/25 bg-forest/10 px-2 py-0.5 text-forest">{analytics.waitlist?.ready ?? 0} ready to notify</span>
              <span className="rounded-full border border-line bg-white px-2 py-0.5 text-muted">{analytics.waitlist?.notified ?? 0} notified</span>
            </div>
          </div>
          {(analytics.waitlist?.topWatched ?? []).length ? (
            <div className="mt-2">
              <BarChart rows={analytics.waitlist.topWatched} ariaLabel="Most watched vehicles" format={(value) => `${value} alert${value === 1 ? '' : 's'}`} emptyTitle="No watchlist activity yet" />
            </div>
          ) : (
            <p className="mt-2 text-[0.66rem] text-muted">No customers are watching sold-out windows yet. Alerts appear here as soon as one is saved.</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold">{content.analytics_km_label}</h2>
            <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_km_desc}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[0.58rem] font-extrabold">
            <span className="rounded-full bg-paper px-2 py-0.5 text-muted">{km.trips} trip{km.trips === 1 ? '' : 's'} measured</span>
            <span className="rounded-full border border-line bg-white px-2 py-0.5 text-ink">{km.driven.toLocaleString('en-IN')} km driven</span>
            <span className="rounded-full border border-line bg-white px-2 py-0.5 text-ink">{km.excess.toLocaleString('en-IN')} km excess</span>
            <span className="rounded-full border border-forest/25 bg-forest/10 px-2 py-0.5 text-forest">{inr(km.excessKmFees)} billed</span>
          </div>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Distance by vehicle</p>
            <div className="mt-2">
              <BarChart
                rows={km.byVehicle}
                ariaLabel={content.analytics_km_label}
                format={(value) => `${Number(value).toLocaleString('en-IN')} km`}
                emptyTitle={content.analytics_km_label}
                emptyDescription={content.analytics_km_empty}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-xl border border-line bg-paper/60 p-3">
              <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Average per trip</p>
              <p className="mt-1 text-lg font-extrabold">{km.avgDriven.toLocaleString('en-IN')} <span className="text-[0.62rem] font-bold text-muted">km</span></p>
            </div>
            <div className="rounded-xl border border-line bg-paper/60 p-3">
              <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Trips with an allowance</p>
              <p className="mt-1 text-lg font-extrabold">{km.cappedTrips}</p>
            </div>
            <div className="rounded-xl border border-line bg-paper/60 p-3">
              <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Excess-km fees</p>
              <p className="mt-1 text-lg font-extrabold">{inr(km.excessKmFees)}</p>
              <p className="text-[0.56rem] text-muted">collected</p>
            </div>
          </div>
        </div>
      </section>

      {analytics.checkout && (analytics.checkout.count30d > 0 || analytics.checkout.value30d > 0) && (
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold">{content.analytics_checkout_title}</h2>
            <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_checkout_desc}</p>
          </div>
          <span className={`badge ${analytics.checkout.count30d ? 'bg-amber-100 text-amber-900' : 'bg-lime/20 text-ink'}`}>
            {content.analytics_checkout_count
              .replace('{count}', String(analytics.checkout.count30d))
              .replace('{value}', analytics.checkout.value30d ? inrShort(analytics.checkout.value30d) : '₹0')}
          </span>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_checkout_recent}</p>
            {analytics.checkout.recent?.length ? (
              <div role="list" className="mt-2 space-y-2" aria-label="Abandoned checkout attempts">
                {analytics.checkout.recent.map((attempt) => (
                  <div key={attempt.id} role="listitem" className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-paper px-2.5 py-1.5 text-[0.64rem]">
                    <span className="min-w-0 flex-1 truncate font-semibold">{attempt.vehicleName || 'Vehicle'}</span>
                    <span className="shrink-0 text-muted">{shortDate(attempt.startDate)} → {shortDate(attempt.endDate)}</span>
                    <span className="shrink-0 font-extrabold text-amber-800">{inrShort(attempt.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-lg border border-dashed border-line bg-paper px-3 py-4 text-center text-[0.64rem] text-muted">No abandoned checkouts in the last 30 days.</p>
            )}
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">30-day snapshot</p>
              <span className="text-[0.58rem] text-muted">{analytics.checkout.count24h > 0 ? `${analytics.checkout.count24h} in the last 24h` : ''}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-paper/60 p-3">
                <p className="text-[0.52rem] font-extrabold uppercase tracking-wider text-muted">Abandoned</p>
                <p className="mt-0.5 text-lg font-extrabold text-coral">{analytics.checkout.count30d}</p>
                <p className="text-[0.56rem] text-muted">checkouts</p>
              </div>
              <div className="rounded-xl border border-line bg-paper/60 p-3">
                <p className="text-[0.52rem] font-extrabold uppercase tracking-wider text-muted">Lost revenue</p>
                <p className="mt-0.5 text-lg font-extrabold text-amber-900">{inrShort(analytics.checkout.value30d)}</p>
                <p className="text-[0.56rem] text-muted">in unpaid baskets</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      )}

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold">{content.analytics_extensions_label}</h2>
            <p className="mt-0.5 text-[0.64rem] text-muted">{content.analytics_extensions_desc}</p>
          </div>
          <span className="rounded-full border border-forest/25 bg-forest/10 px-2.5 py-0.5 text-[0.6rem] font-extrabold text-forest">
            {content.analytics_extensions_revenue
              .replace('{count}', String(extensions.count))
              .replace('{s}', extensions.count === 1 ? '' : 's')
              .replace('{amount}', inr(extensions.revenueDelta))}
          </span>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="min-h-0">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_extensions_recent}</p>
            {extensions.count > 0 ? (
              <ul className="mt-1 divide-y divide-line rounded-xl border border-line">
                {extensions.recent.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.66rem]">
                    <span className="min-w-0 text-muted">{entry.summary}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-[0.58rem] text-muted">{entry.by} · {shortDate(entry.at)}</span>
                      <span className={cn('font-extrabold', Number(entry.delta) > 0 ? 'text-forest' : 'text-muted')}>
                        {Number(entry.delta) > 0 ? `+${inr(entry.delta)}` : inr(0)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[0.66rem] text-muted">{content.analytics_extensions_empty}</p>
            )}
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Extra revenue by month</p>
            <div className="mt-2">
              <BarChart rows={extensions.byMonth} ariaLabel="Extension revenue by month" format={inrShort} emptyTitle={content.analytics_extensions_empty} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-extrabold">{content.analytics_section_fleet_mix}</h2>
        <p className="mt-0.5 text-[0.64rem] text-muted">Where bookings and revenue actually sit — by category and hub.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Category share (bookings)</p>
            <div className="mt-2"><Donut segments={analytics.typeMix.map((row) => ({ label: row.label, value: row.count }))} centerLabel={content.analytics_units_trips} ariaLabel="Category share" /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Category revenue</p>
            <div className="mt-2"><BarChart rows={analytics.typeMixByRevenue.map((row) => ({ label: row.label, value: row.revenue }))} ariaLabel="Category revenue" format={inrShort} /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Hub revenue</p>
            <div className="mt-2"><BarChart rows={analytics.hubMixByRevenue.map((row) => ({ label: row.label, value: row.revenue }))} ariaLabel="Hub revenue" format={inrShort} /></div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Utilisation (next 30 days)</p>
            <div className="mt-2"><BarChart rows={stats.utilizationByVehicle.map((row) => ({ label: row.name, value: row.utilization }))} ariaLabel="Fleet utilisation" max={100} format={(value) => `${value}%`} /></div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_util_trend_title}</p>
            <div className="mt-2">
              <LineChart
                data={utilizationTrend.slice(-range)}
                ariaLabel="Historic fleet utilisation trend"
                description={content.analytics_util_trend_desc}
                format={(value) => `${value}%`}
                colorIndex={3}
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="rounded-xl border border-line bg-paper/60 p-3">
              <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Peak utilisation</p>
              <p className="mt-1 text-lg font-extrabold">
                {utilizationTrend.length ? `${Math.max(...utilizationTrend.map((row) => row.value))}%` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-paper/60 p-3">
              <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Average utilisation</p>
              <p className="mt-1 text-lg font-extrabold">
                {utilizationTrend.length ? `${Math.round(utilizationTrend.reduce((sum, row) => sum + row.value, 0) / utilizationTrend.length)}%` : '—'}
              </p>
            </div>
            <p className="text-[0.6rem] leading-4 text-muted">Booked or on-rent vehicles each day as a share of the bookable fleet — maintenance excluded.</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold">{content.analytics_contribution_title}</h2>
            <p className="mt-0.5 max-w-2xl text-[0.64rem] text-muted">{content.analytics_contribution_desc}</p>
          </div>
          <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-[0.56rem] font-bold text-muted">{rangeLabel}</span>
        </div>
        <div className="mt-4">
          <FleetContribution rows={analytics.fleetContribution ?? []} range={range} content={content} />
        </div>
      </section>

      <p className="text-center text-[0.6rem] text-muted">
        <Activity className="h-3 w-3" /> All figures come from the same read model as the dashboard band — {analytics.daily.length} days held, switch to narrow the window.
      </p>
    </div>
  );
}