import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarPlus, CheckCircle2, ClipboardList, Download, Gauge, History, Plus, RefreshCw,
  ShieldCheck, Trash2, Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import BarChart from '../../components/charts/BarChart.jsx';
import KpiCard from '../../components/charts/KpiCard.jsx';
import { Drawer, EmptyState, LoadError, Modal, SearchField, StatusPill, Toggle } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { getSiteContent } from '../../lib/site.js';
import { downloadCsv } from '../../lib/csv.js';
import {
  SERVICE_BANDS, SERVICE_KINDS, maintenanceSummary, odometerProblem, serviceBoard,
  serviceBoardStats, serviceEntry, serviceIntervals,
} from '../../lib/maintenance.js';
import { addDaysISO, todayISO } from '../../lib/pricing.js';
import { cn, dateRange, inr, inrShort, longDate, shortDate } from '../../lib/format.js';

const BAND_TONE = {
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  due: 'border-amber-200 bg-amber-50 text-amber-800',
  watch: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  fresh: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  untracked: 'border-stone-200 bg-stone-100 text-stone-600',
};

const KIND_LABEL = Object.fromEntries(SERVICE_KINDS.map((kind) => [kind.key, kind.label]));

const km = (value) => (value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-IN')} km`);

/**
 * "12 days over" reads better than a clamped "0 days" once a service is
 * overdue. Returns '' for untracked vehicles so callers can omit the line.
 */
const remainingDaysLabel = (row) => {
  if (!row?.tracked || row.daysRemaining === null || row.daysRemaining === undefined) return '';
  const days = Number(row.daysRemaining);
  if (!Number.isFinite(days)) return '';
  const label = Math.abs(days) === 1 ? 'day' : 'days';
  return days < 0 ? `${Math.abs(days)} ${label} over` : `${days} ${label} left`;
};

const blankLog = (vehicle) => {
  const kind = SERVICE_KINDS[0];
  return {
    vehicleId: vehicle?.id ?? '',
    serviceDate: todayISO(),
    odometer: vehicle?.odometer ?? '',
    kind: kind.key,
    cost: '',
    vendor: '',
    reference: '',
    notes: '',
    resetsService: kind.resets,
    returnToService: vehicle?.status === 'maintenance',
  };
};

const blankOdometer = (vehicle) => ({
  vehicleId: vehicle?.id ?? '',
  odometer: vehicle?.odometer ?? '',
  note: '',
});

const blankBlock = (vehicle) => ({
  vehicleId: vehicle?.id ?? '',
  startDate: todayISO(),
  endDate: addDaysISO(todayISO(), 2),
  reason: 'Scheduled service',
  notes: '',
});

export default function Maintenance() {
  const { isAdmin } = useAuth();
  const { meta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta?.settings), [meta?.settings]);
  const [vehicles, setVehicles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestGuard = useRequestGuard();
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState('');
  const [hubFilter, setHubFilter] = useState('');
  const [visibleCount, setVisibleCount] = useState(18);
  const [logForm, setLogForm] = useState(null);
  const [odometerForm, setOdometerForm] = useState(null);
  const [blockForm, setBlockForm] = useState(null);
  const [historyVehicle, setHistoryVehicle] = useState(null);
  const [deleteLog, setDeleteLog] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const [nextVehicles, nextLogs, nextBlocks] = await Promise.all([
        api.adminVehicles(),
        api.adminServiceLogs(),
        api.adminVehicleBlocks(),
      ]);
      if (!requestGuard.isCurrent(guard)) return;
      setVehicles(nextVehicles);
      setLogs(nextLogs);
      setBlocks(nextBlocks);
    } catch (error) {
      if (!requestGuard.isCurrent(guard)) return;
      setLoadError(error.message);
      push(error.message, 'error');
    } finally {
      if (requestGuard.isCurrent(guard)) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const board = useMemo(() => serviceBoard(vehicles, { logs }), [vehicles, logs]);
  const stats = useMemo(() => serviceBoardStats(board), [board]);
  const summary = useMemo(() => maintenanceSummary(vehicles, logs, blocks), [vehicles, logs, blocks]);

  const hubs = useMemo(
    () => [...new Set(vehicles.map((vehicle) => vehicle.location).filter(Boolean))].sort(),
    [vehicles]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return board.filter((row) => {
      const matchesSearch = !needle
        || `${row.name} ${row.brand} ${row.type} ${row.location}`.toLowerCase().includes(needle);
      const matchesBand = !bandFilter || row.band === bandFilter;
      const matchesHub = !hubFilter || row.location === hubFilter;
      return matchesSearch && matchesBand && matchesHub;
    });
  }, [board, search, bandFilter, hubFilter]);

  const visible = filtered.slice(0, visibleCount);
  const workshopBlocks = useMemo(
    () => blocks
      .filter((block) => block.kind === 'maintenance' && block.endDate >= todayISO())
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 6),
    [blocks]
  );
  const historyLogs = useMemo(
    () => (historyVehicle
      ? logs.filter((log) => log.vehicleId === historyVehicle.id)
        .sort((a, b) => String(b.serviceDate).localeCompare(String(a.serviceDate)))
      : []),
    [logs, historyVehicle]
  );
  const historySpend = historyLogs.reduce((sum, log) => sum + (Number(log.cost) || 0), 0);
  // Use the same bike-aware defaults as the board. Falling back to 180 days /
  // 10,000 km here made a bike's next service look further away than it is.
  const historyIntervals = historyVehicle ? serviceIntervals(historyVehicle) : null;
  const historyHasBaseline = Boolean(historyVehicle?.lastServiceDate)
    && historyVehicle?.lastServiceOdometer !== null
    && historyVehicle?.lastServiceOdometer !== undefined;
  const historyNextDate = historyHasBaseline
    ? addDaysISO(historyVehicle.lastServiceDate, historyIntervals.days)
    : null;
  const historyNextOdometer = historyHasBaseline
    ? Number(historyVehicle.lastServiceOdometer) + historyIntervals.km
    : null;

  const vehicleFor = (id) => vehicles.find((vehicle) => vehicle.id === id) ?? null;

  const openLog = (vehicle) => setLogForm(blankLog(vehicle));
  const openOdometer = (vehicle) => setOdometerForm(blankOdometer(vehicle));
  const openSchedule = (vehicle = vehicles[0]) => setBlockForm(blankBlock(vehicle));

  const setLog = (key, value) => setLogForm((current) => ({ ...current, [key]: value }));
  const setOdometer = (key, value) => setOdometerForm((current) => ({ ...current, [key]: value }));
  const setBlock = (key, value) => setBlockForm((current) => ({ ...current, [key]: value }));

  const saveLog = async () => {
    if (!logForm || saving) return;
    const vehicle = vehicleFor(logForm.vehicleId);
    const result = serviceEntry(logForm, vehicle);
    if (!result.ok) {
      push(result.problem, 'error');
      return;
    }
    setSaving(true);
    try {
      await api.adminSaveServiceLog(logForm);
      push(
        logForm.returnToService
          ? 'Service logged and the vehicle is available again.'
          : 'Service logged. The service baseline is updated.',
        'success',
      );
      setLogForm(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveOdometer = async () => {
    if (!odometerForm || saving) return;
    const vehicle = vehicleFor(odometerForm.vehicleId);
    const problem = odometerProblem(odometerForm.odometer, vehicle);
    if (problem) {
      push(problem, 'error');
      return;
    }
    setSaving(true);
    try {
      await api.adminSetOdometer(odometerForm);
      push(content.maintenance_odometer, 'success');
      setOdometerForm(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveBlock = async () => {
    if (!blockForm || saving) return;
    if (blockForm.startDate >= blockForm.endDate) {
      push(content.maintenance_workshop_range, 'error');
      return;
    }
    setSaving(true);
    try {
      await api.adminSaveVehicleBlock({ ...blockForm, kind: 'maintenance' });
      push(content.maintenance_workshop_added, 'success');
      setBlockForm(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeLog = async () => {
    if (!deleteLog || saving) return;
    setSaving(true);
    try {
      await api.adminDeleteServiceLog(deleteLog.id);
      push(content.maintenance_entry_removed, 'success');
      setDeleteLog(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const setBand = (band) => {
    setBandFilter(band);
    setVisibleCount(18);
  };

  const exportBoard = () => {
    if (!filtered.length) return;
    const rows = [
      [
        'vehicle', 'brand', 'type', 'hub', 'status', 'service_band', 'progress_pct',
        'odometer_km', 'last_service_date', 'last_service_odometer_km', 'interval_km', 'interval_days',
        'km_since_service', 'days_since_service', 'km_remaining', 'days_remaining',
        'next_due_date', 'next_due_odometer_km', 'workshop_visits', 'lifetime_spend_inr',
      ],
      ...filtered.map((row) => [
        row.name, row.brand, row.type, row.location, row.status, row.band, row.progress,
        row.odometer ?? '', row.lastServiceDate ?? '', row.lastServiceOdometer ?? '',
        row.intervalKm, row.intervalDays, row.kmSinceService ?? '', row.daysSinceService ?? '',
        row.kmRemaining ?? '', row.daysRemaining ?? '', row.dueDate ?? '', row.dueOdometer ?? '',
        row.visits, row.spend,
      ]),
    ];
    downloadCsv(`rove-maintenance-${todayISO()}.csv`, rows);
    push(content.maintenance_exported.replace('{count}', String(filtered.length)).replace('{s}', filtered.length === 1 ? '' : 's'), 'success');
  };

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="eyebrow">Fleet operations</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Maintenance & service</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted">
          Real odometer and interval tracking for {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}. Log workshop work, schedule downtime on the availability calendar and keep every service decision auditable.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={load} disabled={loading} className="btn btn-white btn-sm" aria-label="Refresh the service board">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
        </button>
        <button type="button" onClick={() => openSchedule()} className="btn btn-white btn-sm" disabled={!vehicles.length}>
          <CalendarPlus className="h-3.5 w-3.5" /> Schedule downtime
        </button>
        <button type="button" onClick={() => openLog(vehicles[0])} className="btn btn-dark btn-sm" disabled={!vehicles.length}>
          <Plus className="h-3.5 w-3.5" /> Log service
        </button>
      </div>
    </header>
  );

  if (loading && !vehicles.length) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-64 animate-pulse rounded-xl bg-stone-200/70" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-stone-200/70" />)}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-stone-200/70" />
      </div>
    );
  }

  if (loadError && !vehicles.length) {
    return (
      <div className="space-y-5">
        {header}
        <LoadError
          title="The service board could not load"
          message={loadError}
          hint="No maintenance action can be taken until the fleet and workshop history load."
          onRetry={load}
        />
      </div>
    );
  }

  const attention = board.filter((row) => ['overdue', 'due'].includes(row.band));

  return (
    <div className="space-y-5">
      {header}

      <div className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border p-4',
        attention.length ? 'border-amber-200 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/60',
      )}>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', attention.length ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>
          {attention.length ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.6rem] font-extrabold uppercase tracking-[0.13em] text-muted">Service queue</p>
          <p className="mt-0.5 text-sm font-extrabold">
            {attention.length
              ? `${stats.overdue} overdue · ${stats.due} due soon — ${attention.slice(0, 2).map((row) => row.name).join(' · ')}${attention.length > 2 ? ` +${attention.length - 2} more` : ''}`
              : 'Every tracked vehicle is inside its service window.'}
          </p>
        </div>
        {attention.length > 0 && (
          <button type="button" onClick={() => setBand(stats.overdue ? 'overdue' : 'due')} className="btn btn-white btn-sm">
            Review queue <ClipboardList className="h-3.5 w-3.5" />
          </button>
        )}
        <Link to="/admin/calendar" className="text-[0.66rem] font-extrabold text-forest underline underline-offset-4">Open calendar</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Overdue service" value={stats.overdue} hint={`${stats.tracked} of ${stats.total} vehicles tracked`} icon={AlertTriangle} tone="bg-rose-50 text-rose-700" />
        <KpiCard label="Due soon" value={stats.due} hint="Within 15% of either service interval" icon={Wrench} tone="bg-amber-50 text-amber-800" />
        <KpiCard label="In workshop" value={stats.inWorkshop} hint={`${summary.upcomingWorkshop} downtime block${summary.upcomingWorkshop === 1 ? '' : 's'} in the next 30 days`} icon={CalendarPlus} tone="bg-cyan-50 text-cyan-800" />
        <KpiCard label="Service spend YTD" value={inrShort(summary.spendYtd)} hint={`${inrShort(summary.spend90)} in the last 90 days`} icon={Gauge} tone="bg-lime/25 text-forest" spark={summary.monthly.map((row) => row.cost)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted">Next in line</p>
              <h2 className="mt-0.5 text-sm font-extrabold">Vehicles that need a workshop slot</h2>
            </div>
            <span className="rounded-full border border-line bg-paper px-2.5 py-1 text-[0.58rem] font-extrabold text-muted">{summary.downtimeDays} downtime day{summary.downtimeDays === 1 ? '' : 's'} ahead</span>
          </div>
          {summary.attention.length ? (
            <div className="mt-3 divide-y divide-line/70">
              {summary.attention.slice(0, 5).map((row) => (
                <div key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg border text-[0.58rem] font-extrabold', BAND_TONE[row.band])}>{row.progress}%</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.76rem] font-extrabold">{row.name}</p>
                    <p className="mt-0.5 text-[0.62rem] text-muted">
                      {row.reason}
                      {row.tracked && row.kmRemaining > 0 ? ` · ${km(row.kmRemaining)} left` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => openLog(vehicleFor(row.id))} className="btn btn-white btn-sm">Log service</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-6 text-center">
              <ShieldCheck className="mx-auto h-5 w-5 text-emerald-700" />
              <p className="mt-1.5 text-sm font-extrabold">No service backlog</p>
              <p className="mt-0.5 text-[0.66rem] text-muted">Keep logging odometer readings after each return to keep this accurate.</p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-white p-4 shadow-card">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted">Workshop diary</p>
              <h2 className="mt-0.5 text-sm font-extrabold">Scheduled downtime</h2>
            </div>
            <button type="button" onClick={() => openSchedule()} className="text-[0.62rem] font-extrabold text-forest underline underline-offset-4">Add block</button>
          </div>
          {workshopBlocks.length ? (
            <ul className="mt-3 space-y-2">
              {workshopBlocks.map((block) => (
                <li key={block.id} className="rounded-xl border border-line bg-paper/60 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[0.72rem] font-extrabold">{block.vehicle?.name ?? 'Vehicle'}</p>
                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.55rem] font-extrabold text-amber-800">{shortDate(block.startDate)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[0.62rem] text-muted">{block.reason || 'Maintenance'} · {dateRange(block.startDate, block.endDate)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-line bg-paper/50 px-4 py-6 text-center text-[0.68rem] text-muted">No workshop blocks ahead. Schedule one before a service so the vehicle cannot be booked.</p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted">Cost control</p>
            <h2 className="mt-0.5 text-sm font-extrabold">Workshop spend · last 6 months</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[0.6rem] text-muted">
            <span className="rounded-full bg-paper px-2 py-0.5">{summary.visits} visits logged</span>
            <span className="rounded-full bg-paper px-2 py-0.5">avg {inrShort(summary.avgCost)}</span>
            <Link to="/admin/analytics" className="font-extrabold text-forest underline underline-offset-4">Full analytics</Link>
          </div>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <BarChart rows={summary.monthly.map((row) => ({ label: row.label, value: row.cost }))} ariaLabel="Workshop spend by month" format={inrShort} emptyTitle="No workshop spend yet" emptyDescription="Log a service to start tracking cost." />
          <BarChart rows={summary.byKind.map((row) => ({ label: row.label, value: row.cost }))} ariaLabel="Workshop spend by work type" format={inrShort} emptyTitle="No work types yet" emptyDescription="Service, repairs and inspections will appear here." />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="eyebrow">Service board</p>
            <h2 className="mt-1 text-lg font-extrabold tracking-tight">Every vehicle, ranked by urgency</h2>
            <p className="mt-0.5 text-[0.66rem] text-muted">Distance and calendar wear are tracked separately; whichever limit arrives first decides the band.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.62rem] font-bold text-muted">{filtered.length} vehicle{filtered.length === 1 ? '' : 's'}</span>
            <button type="button" onClick={exportBoard} disabled={!filtered.length} className="btn btn-white btn-sm">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
          <SearchField value={search} onChange={(value) => { setSearch(value); setVisibleCount(18); }} placeholder="Search vehicle, hub or type" label="Search maintenance board" className="min-w-[13rem] flex-1" />
          <select value={bandFilter} onChange={(event) => setBand(event.target.value)} className="field w-auto" aria-label="Filter by service band">
            <option value="">All service bands</option>
            {Object.entries(SERVICE_BANDS).map(([band, meta]) => <option key={band} value={band}>{meta.label}</option>)}
          </select>
          <select value={hubFilter} onChange={(event) => { setHubFilter(event.target.value); setVisibleCount(18); }} className="field w-auto" aria-label="Filter by hub">
            <option value="">All hubs</option>
            {hubs.map((hub) => <option key={hub} value={hub}>{hub}</option>)}
          </select>
          {(search || bandFilter || hubFilter) && (
            <button type="button" onClick={() => { setSearch(''); setBandFilter(''); setHubFilter(''); }} className="text-[0.64rem] font-extrabold text-muted underline underline-offset-4">Clear</button>
          )}
        </div>

        {filtered.length ? (
          <>
            <div className="grid gap-3 xl:grid-cols-2">
              {visible.map((row) => (
                <article key={row.id} className="rounded-2xl border border-line bg-white p-4 shadow-card">
                  <div className="flex items-start gap-3">
                    {row.imageUrl ? (
                      <img src={row.imageUrl} alt="" className="h-12 w-16 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-xl bg-sand"><Wrench className="h-4 w-4 text-muted" /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="truncate text-sm font-extrabold">{row.name}</h3>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[0.55rem] font-extrabold', BAND_TONE[row.band])}>{row.label}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[0.62rem] text-muted">{row.brand} · {row.type} · {row.year} · {row.location}</p>
                    </div>
                    <StatusPill status={row.status} />
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-2 text-[0.58rem] font-bold text-muted">
                      <span>{row.band === 'overdue' ? 'Service window exceeded' : row.band === 'untracked' ? 'Add a baseline to track this vehicle' : `${row.progress}% of the service window used`}</span>
                      {row.tracked && <span>{row.progress}%</span>}
                    </div>
                    <div
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100"
                      role={row.tracked ? 'progressbar' : undefined}
                      aria-label={row.tracked ? `Service interval used for ${row.name}` : undefined}
                      aria-valuemin={row.tracked ? 0 : undefined}
                      aria-valuemax={row.tracked ? 100 : undefined}
                      aria-valuenow={row.tracked ? Math.min(100, row.progress) : undefined}
                    >
                      <div
                        className={cn('h-full rounded-full', row.band === 'overdue' ? 'bg-rose-500' : row.band === 'due' ? 'bg-amber-500' : row.band === 'watch' ? 'bg-cyan-500' : row.band === 'fresh' ? 'bg-emerald-500' : 'bg-stone-300')}
                        style={{ width: `${Math.min(100, Math.max(3, row.progress))}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-lg bg-paper/70 px-2.5 py-2">
                      <p className="text-[0.52rem] font-extrabold uppercase tracking-wider text-muted">Odometer</p>
                      <p className="mt-0.5 text-[0.7rem] font-extrabold">{km(row.odometer)}</p>
                    </div>
                    <div className="rounded-lg bg-paper/70 px-2.5 py-2">
                      <p className="text-[0.52rem] font-extrabold uppercase tracking-wider text-muted">Last service</p>
                      <p className="mt-0.5 text-[0.7rem] font-extrabold">{row.lastServiceDate ? shortDate(row.lastServiceDate) : '—'}</p>
                      <p className="text-[0.54rem] text-muted">{km(row.lastServiceOdometer)}</p>
                    </div>
                    <div className="rounded-lg bg-paper/70 px-2.5 py-2">
                      <p className="text-[0.52rem] font-extrabold uppercase tracking-wider text-muted">Next due</p>
                      <p className="mt-0.5 text-[0.7rem] font-extrabold">{row.dueDate ? shortDate(row.dueDate) : '—'}</p>
                      <p className="text-[0.54rem] text-muted">{row.dueOdometer ? km(row.dueOdometer) : '—'}</p>
                    </div>
                    <div className="rounded-lg bg-paper/70 px-2.5 py-2">
                      <p className="text-[0.52rem] font-extrabold uppercase tracking-wider text-muted">Remaining</p>
                      <p className="mt-0.5 text-[0.7rem] font-extrabold">{row.kmRemaining !== null ? km(row.kmRemaining) : '—'}</p>
                      <p className="text-[0.54rem] text-muted">{remainingDaysLabel(row) || '—'}</p>
                    </div>
                  </div>

                  <p className="mt-2 text-[0.62rem] leading-4 text-muted">{row.reason}</p>
                  <p className="mt-1 text-[0.6rem] text-muted">
                    Lifetime workshop spend <b className="font-extrabold text-ink">{inrShort(row.spend)}</b> across {row.visits} visit{row.visits === 1 ? '' : 's'}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => openLog(vehicleFor(row.id))} className="btn btn-dark btn-sm">Log service</button>
                    <button type="button" onClick={() => setHistoryVehicle(vehicleFor(row.id))} className="btn btn-white btn-sm"><History className="h-3.5 w-3.5" /> History</button>
                    <button type="button" onClick={() => openOdometer(vehicleFor(row.id))} className="btn btn-ghost btn-sm">Update km</button>
                    <button type="button" onClick={() => openSchedule(vehicleFor(row.id))} className="btn btn-ghost btn-sm">Schedule</button>
                  </div>
                </article>
              ))}
            </div>
            {visible.length < filtered.length && (
              <div className="pt-1 text-center">
                <button type="button" onClick={() => setVisibleCount((count) => count + 18)} className="btn btn-white btn-sm">
                  Show {Math.min(18, filtered.length - visible.length)} more vehicles
                </button>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={Wrench}
            title="No vehicles match"
            description="Clear the filters or add a service baseline from a vehicle's edit drawer."
            action={<button type="button" onClick={() => { setSearch(''); setBandFilter(''); setHubFilter(''); }} className="btn btn-dark">Clear filters</button>}
          />
        )}
      </section>

      {/* Log service -------------------------------------------------------- */}
      <Modal
        open={Boolean(logForm)}
        onClose={() => (saving ? null : setLogForm(null))}
        title={`Log service${logForm ? ` · ${vehicleFor(logForm.vehicleId)?.name ?? ''}` : ''}`}
        description="The vehicle odometer moves forward, and resetting work moves the next-service baseline."
        size="md"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setLogForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={saveLog} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Save service'}</button>
          </div>
        )}
      >
        {logForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vehicle" className="sm:col-span-2">
              <select
                value={logForm.vehicleId}
                onChange={(event) => {
                  const vehicle = vehicleFor(event.target.value);
                  setLogForm((current) => ({ ...current, vehicleId: event.target.value, odometer: vehicle?.odometer ?? current.odometer }));
                }}
                className="field"
              >
                {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.location}</option>)}
              </select>
            </Field>
            <Field label="Service date">
              <input type="date" max={todayISO()} value={logForm.serviceDate} onChange={(event) => setLog('serviceDate', event.target.value)} className="field" />
            </Field>
            <Field label="Odometer (km)">
              <input type="number" min={vehicleFor(logForm.vehicleId)?.odometer ?? 0} value={logForm.odometer} onChange={(event) => setLog('odometer', event.target.value)} className="field" placeholder="Current reading" />
            </Field>
            <Field label="Work type">
              <select
                value={logForm.kind}
                onChange={(event) => {
                  const kind = SERVICE_KINDS.find((item) => item.key === event.target.value);
                  setLogForm((current) => ({ ...current, kind: event.target.value, resetsService: Boolean(kind?.resets) }));
                }}
                className="field"
              >
                {SERVICE_KINDS.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
              </select>
            </Field>
            <Field label="Cost (₹)">
              <input type="number" min="0" value={logForm.cost} onChange={(event) => setLog('cost', event.target.value)} className="field" placeholder="0" />
            </Field>
            <Field label="Workshop / vendor">
              <input value={logForm.vendor} onChange={(event) => setLog('vendor', event.target.value)} maxLength={80} className="field" placeholder="Bandra Auto Works" />
            </Field>
            <Field label="Invoice / work order">
              <input value={logForm.reference} onChange={(event) => setLog('reference', event.target.value)} maxLength={60} className="field" placeholder="WO-0042" />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <textarea rows={3} value={logForm.notes} onChange={(event) => setLog('notes', event.target.value)} maxLength={600} className="field resize-none" placeholder="Parts replaced, observations, next action…" />
            </Field>
            <div className="rounded-xl border border-line bg-paper p-3 sm:col-span-2">
              <Toggle
                checked={Boolean(logForm.resetsService)}
                onChange={(value) => setLog('resetsService', value)}
                label="Reset the next-service interval"
                description="Use this for services, inspections and tyre work. Repairs and bodywork usually keep the existing interval running."
              />
              {vehicleFor(logForm.vehicleId)?.status === 'maintenance' && (
                <div className="mt-3 border-t border-line pt-3">
                  <Toggle
                    checked={Boolean(logForm.returnToService)}
                    onChange={(value) => setLog('returnToService', value)}
                    label="Return vehicle to available"
                    description="Releases the vehicle to customers and notifies anyone watching its dates."
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Update odometer ---------------------------------------------------- */}
      <Modal
        open={Boolean(odometerForm)}
        onClose={() => (saving ? null : setOdometerForm(null))}
        title={`Update odometer${odometerForm ? ` · ${vehicleFor(odometerForm.vehicleId)?.name ?? ''}` : ''}`}
        description="Record the latest reading after a return or at the end of the day."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setOdometerForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={saveOdometer} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Update reading'}</button>
          </div>
        )}
      >
        {odometerForm && (
          <div className="space-y-3">
            <Field label="New odometer (km)">
              <input type="number" min={vehicleFor(odometerForm.vehicleId)?.odometer ?? 0} value={odometerForm.odometer} onChange={(event) => setOdometer('odometer', event.target.value)} className="field" />
            </Field>
            <p className="text-[0.62rem] text-muted">Current reading: <b className="text-ink">{km(vehicleFor(odometerForm.vehicleId)?.odometer)}</b>. Readings can only move forward.</p>
            <Field label="Note (optional)">
              <input value={odometerForm.note} onChange={(event) => setOdometer('note', event.target.value)} maxLength={240} className="field" placeholder="Returned from RV-D1042" />
            </Field>
          </div>
        )}
      </Modal>

      {/* Schedule downtime -------------------------------------------------- */}
      <Modal
        open={Boolean(blockForm)}
        onClose={() => (saving ? null : setBlockForm(null))}
        title="Schedule workshop downtime"
        description="This creates a maintenance block on the availability calendar so the vehicle cannot be booked."
        size="md"
        footer={(
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/calendar" className="btn btn-white" onClick={() => setBlockForm(null)}>Open calendar</Link>
            <button type="button" onClick={() => setBlockForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={saveBlock} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Block these dates'}</button>
          </div>
        )}
      >
        {blockForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vehicle" className="sm:col-span-2">
              <select value={blockForm.vehicleId} onChange={(event) => setBlock('vehicleId', event.target.value)} className="field">
                {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.location}</option>)}
              </select>
            </Field>
            <Field label="Workshop starts">
              <input type="date" min={todayISO()} value={blockForm.startDate} onChange={(event) => setBlock('startDate', event.target.value)} className="field" />
            </Field>
            <Field label="Vehicle back on the road">
              <input type="date" min={blockForm.startDate || todayISO()} value={blockForm.endDate} onChange={(event) => setBlock('endDate', event.target.value)} className="field" />
            </Field>
            <Field label="Reason" className="sm:col-span-2">
              <input value={blockForm.reason} onChange={(event) => setBlock('reason', event.target.value)} maxLength={120} className="field" placeholder="Scheduled brake and tyre service" />
            </Field>
            <Field label="Workshop notes" className="sm:col-span-2">
              <textarea rows={3} value={blockForm.notes} onChange={(event) => setBlock('notes', event.target.value)} maxLength={600} className="field resize-none" placeholder="Slot confirmed, collection time, parts ordered…" />
            </Field>
            <p className="text-[0.62rem] leading-4 text-muted sm:col-span-2">The block ends the day the vehicle is back. Existing bookings must be moved or cancelled first — the calendar will explain any conflict.</p>
          </div>
        )}
      </Modal>

      {/* Service history ---------------------------------------------------- */}
      <Drawer
        open={Boolean(historyVehicle)}
        onClose={() => setHistoryVehicle(null)}
        title={`Service history · ${historyVehicle?.name ?? ''}`}
        description="Every workshop entry, newest first. The vehicle baseline follows the latest resetting service."
        width="max-w-xl"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setHistoryVehicle(null)} className="btn btn-white flex-1">Close</button>
            <button type="button" onClick={() => { const vehicle = historyVehicle; setHistoryVehicle(null); openLog(vehicle); }} className="btn btn-dark flex-1">Log service</button>
          </div>
        )}
      >
        {historyVehicle && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Odometer" value={km(historyVehicle.odometer)} />
              <Stat label="Last service" value={historyVehicle.lastServiceDate ? shortDate(historyVehicle.lastServiceDate) : '—'} />
              <Stat label="Visits" value={historyLogs.length} />
              <Stat label="Total spend" value={inrShort(historySpend)} />
            </div>
            <p className="rounded-xl border border-line bg-paper/70 px-3 py-2 text-[0.64rem] leading-5 text-muted">
              {historyHasBaseline
                ? `Next service is due around ${longDate(historyNextDate)} or at ${km(historyNextOdometer)}, whichever comes first.`
                : 'Next service is due once a baseline is added — log the first resetting service to start tracking this vehicle.'}
            </p>
            {historyLogs.length ? (
              <ul className="space-y-2">
                {historyLogs.map((log) => (
                  <li key={log.id} className="rounded-xl border border-line p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lime/20 text-forest"><Wrench className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-[0.74rem] font-extrabold">{KIND_LABEL[log.kind] ?? log.kind}</p>
                          <span className="rounded-full bg-paper px-1.5 py-0.5 text-[0.54rem] font-bold text-muted">{shortDate(log.serviceDate)}</span>
                          {log.resetsService && <span className="rounded-full bg-lime/20 px-1.5 py-0.5 text-[0.54rem] font-extrabold text-forest">Baseline reset</span>}
                        </div>
                        <p className="mt-0.5 text-[0.64rem] text-muted">{km(log.odometer)} · {log.vendor || 'Workshop not recorded'}{log.reference ? ` · ${log.reference}` : ''}</p>
                        {log.notes && <p className="mt-1 text-[0.64rem] leading-4 text-muted">{log.notes}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-[0.72rem] font-extrabold">{inr(log.cost)}</span>
                        {isAdmin && (
                          <button type="button" onClick={() => setDeleteLog(log)} className="rounded-md p-1.5 text-muted transition hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove service entry from ${shortDate(log.serviceDate)}`}>
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[0.68rem] text-muted">No workshop history yet. Log the first service to start the record.</p>
            )}
          </div>
        )}
      </Drawer>

      {/* Delete service entry ----------------------------------------------- */}
      <Modal
        open={Boolean(deleteLog)}
        onClose={() => (saving ? null : setDeleteLog(null))}
        title="Remove this service entry?"
        description="This is for correcting a mistaken entry. The vehicle baseline is recalculated from the remaining history."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteLog(null)} disabled={saving} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={removeLog} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Removing…' : 'Remove entry'}</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">
          Removing the {deleteLog ? `${KIND_LABEL[deleteLog.kind] ?? deleteLog.kind} from ${shortDate(deleteLog.serviceDate)}` : 'entry'} will also reset the next-service baseline if it was a resetting service.
        </p>
      </Modal>
    </div>
  );
}

function Field({ label, children, className }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-paper/60 px-2.5 py-2">
      <p className="text-[0.52rem] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-[0.72rem] font-extrabold">{value}</p>
    </div>
  );
}
