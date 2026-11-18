import { useEffect, useMemo, useState } from 'react';
import {
  BellRing, CalendarPlus, CalendarRange, Check, ChevronLeft, ChevronRight, Lock, Pencil,
  Trash2, Wrench,
} from 'lucide-react';
import { EmptyState, LoadError, Modal, SearchField, StatusPill, TableScrollHint } from '../../components/ui.jsx';
import { Link } from 'react-router-dom';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { api } from '../../lib/api.js';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { getSiteContent } from '../../lib/site.js';
import { addDaysISO, todayISO } from '../../lib/pricing.js';
import { cn, dateRange } from '../../lib/format.js';

const BLOCK_KINDS = [
  { key: 'maintenance', label: 'Maintenance', icon: Wrench, dot: 'bg-sun', badge: 'bg-amber-50 text-amber-900 border-amber-200' },
  { key: 'private', label: 'Internal use', icon: Lock, dot: 'bg-violet', badge: 'bg-violet-50 text-violet-900 border-violet-200' },
  { key: 'buffer', label: 'Turnaround', icon: CalendarRange, dot: 'bg-aqua', badge: 'bg-cyan-50 text-cyan-900 border-cyan-200' },
  { key: 'other', label: 'Unavailable', icon: CalendarRange, dot: 'bg-stone-400', badge: 'bg-stone-100 text-stone-700 border-stone-200' },
];

const kindMeta = (kind) => BLOCK_KINDS.find((item) => item.key === kind) ?? BLOCK_KINDS[0];

const pad = (value) => String(value).padStart(2, '0');

function monthDays(month) {
  const [year, number] = month.split('-').map(Number);
  const count = new Date(year, number, 0).getDate();
  return Array.from({ length: count }, (_, index) => {
    const date = `${month}-${pad(index + 1)}`;
    const weekday = new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });
    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
    return { date, day: index + 1, weekday, weekend: dayOfWeek === 0 || dayOfWeek === 6 };
  });
}

function shiftMonth(month, offset) {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(year, number - 1 + offset, 1, 12);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function monthLabel(month) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function defaultBlockForm(month, vehicles) {
  const today = todayISO();
  const startDate = today.startsWith(month) ? today : `${month}-01`;
  return {
    id: '',
    vehicleId: vehicles[0]?.id ?? '',
    startDate,
    endDate: addDaysISO(startDate, 2),
    kind: 'maintenance',
    reason: '',
    notes: '',
  };
}

export default function Calendar() {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta?.settings), [meta?.settings]);
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [vehicles, setVehicles] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestGuard = useRequestGuard();
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [blockForm, setBlockForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [waitlist, setWaitlist] = useState(null);
  const [notifying, setNotifying] = useState('');

  const loadWaitlist = async () => {
    if (typeof api.adminAvailabilityAlerts !== 'function') return;
    try {
      setWaitlist(await api.adminAvailabilityAlerts());
    } catch {
      // The calendar must stay usable even if the watchlist query fails.
      setWaitlist(null);
    }
  };

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const [nextVehicles, nextBookings, nextBlocks] = await Promise.all([
        api.adminVehicles(),
        api.adminBookings(),
        api.adminVehicleBlocks(),
      ]);
      if (!requestGuard.isCurrent(guard)) return;
      setVehicles(nextVehicles);
      setBookings(nextBookings);
      setBlocks(nextBlocks);
      await loadWaitlist();
    } catch (error) {
      if (!requestGuard.isCurrent(guard)) return;
      setLoadError(error.message);
      push(error.message, 'error');
    } finally {
      if (requestGuard.isCurrent(guard)) setLoading(false);
    }
  };

  const notifyWaitlist = async (alertId = null) => {
    setNotifying(alertId ?? 'all');
    try {
      const result = await api.adminDispatchAvailabilityAlerts(alertId ? { alertIds: [alertId] } : {});
      push(
        result.dispatched
          ? `Notified ${result.dispatched} customer${result.dispatched === 1 ? '' : 's'} — watchlist email queued.`
          : 'No watched windows are free yet.',
        result.dispatched ? 'success' : 'info',
      );
      await loadWaitlist();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setNotifying('');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(() => monthDays(month), [month]);
  const monthStart = days[0]?.date ?? `${month}-01`;
  const monthEnd = addDaysISO(days[days.length - 1]?.date ?? `${month}-01`, 1);

  const locations = useMemo(
    () => [...new Set(vehicles.map((vehicle) => vehicle.location).filter(Boolean))].sort(),
    [vehicles]
  );

  const filteredVehicles = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesSearch = !needle
        || `${vehicle.name} ${vehicle.brand} ${vehicle.location}`.toLowerCase().includes(needle);
      return matchesSearch && (!location || vehicle.location === location);
    });
  }, [vehicles, search, location]);

  const activeBookings = useMemo(
    () => bookings.filter((booking) => ['pending', 'confirmed', 'active'].includes(booking.status)),
    [bookings]
  );

  // Group once per vehicle so each calendar cell is a short scan, not a full
  // pass over every booking in the system (hundreds of vehicles × 31 days).
  const bookingsByVehicle = useMemo(() => {
    const map = new Map();
    activeBookings.forEach((booking) => {
      const id = booking.vehicleId ?? booking.vehicle?.id;
      if (!id) return;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(booking);
    });
    return map;
  }, [activeBookings]);

  const blocksByVehicle = useMemo(() => {
    const map = new Map();
    blocks.forEach((block) => {
      if (!block.vehicleId) return;
      if (!map.has(block.vehicleId)) map.set(block.vehicleId, []);
      map.get(block.vehicleId).push(block);
    });
    return map;
  }, [blocks]);

  const monthBookings = useMemo(
    () => activeBookings
      .filter((booking) => booking.startDate < monthEnd && booking.endDate > monthStart)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [activeBookings, monthStart, monthEnd]
  );

  const monthBlocks = useMemo(
    () => blocks
      .filter((block) => block.startDate < monthEnd && block.endDate > monthStart)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [blocks, monthStart, monthEnd]
  );

  const cellOccupancy = (vehicleId, date) => {
    const booking = (bookingsByVehicle.get(vehicleId) ?? []).find((item) => (
      item.startDate <= date && item.endDate > date
    ));
    const block = (blocksByVehicle.get(vehicleId) ?? []).find((item) => (
      item.startDate <= date && item.endDate > date
    ));
    return { booking, block };
  };

  const openNewBlock = () => {
    setBlockForm(defaultBlockForm(month, filteredVehicles.length ? filteredVehicles : vehicles));
  };

  const openEditBlock = (block) => {
    setBlockForm({
      id: block.id,
      vehicleId: block.vehicleId,
      startDate: block.startDate,
      endDate: block.endDate,
      kind: block.kind,
      reason: block.reason ?? '',
      notes: block.notes ?? '',
    });
  };

  const setBlock = (key, value) => setBlockForm((current) => ({ ...current, [key]: value }));

  // Live validation for the block modal: the server rejects overlaps, but the
  // operator should see the clash while typing, not after pressing Save.
  const blockCheck = useMemo(() => {
    if (!blockForm) return { invalidDates: false, booking: null, block: null };
    const { vehicleId, startDate, endDate, id } = blockForm;
    const invalidDates = !startDate || !endDate || startDate >= endDate;
    if (invalidDates || !vehicleId) return { invalidDates, booking: null, block: null };
    const booking = activeBookings.find((item) => (
      (item.vehicleId ?? item.vehicle?.id) === vehicleId
      && item.startDate < endDate
      && item.endDate > startDate
    )) ?? null;
    const block = blocks.find((item) => (
      item.vehicleId === vehicleId
      && item.id !== id
      && item.startDate < endDate
      && item.endDate > startDate
    )) ?? null;
    return { invalidDates, booking, block };
  }, [blockForm, activeBookings, blocks]);
  const blockBlocked = blockCheck.invalidDates || Boolean(blockCheck.booking) || Boolean(blockCheck.block);

  const saveBlock = async () => {
    setSaving(true);
    try {
      await api.adminSaveVehicleBlock(blockForm);
      push(blockForm.id ? content.calendar_block_updated : content.calendar_block_created, 'success');
      setBlockForm(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeBlock = async () => {
    setSaving(true);
    try {
      await api.adminDeleteVehicleBlock(deleteTarget.id);
      push(content.calendar_block_removed, 'success');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Availability calendar</h1>
          <p className="mt-1 text-xs text-muted">
            {vehicles.length} vehicles · {monthBookings.length} bookings · {monthBlocks.length} block{monthBlocks.length === 1 ? '' : 's'} this month
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border border-line bg-white p-1 shadow-sm">
            <button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} className="rounded-full p-3 text-muted transition hover:bg-paper hover:text-ink" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[8.4rem] text-center text-xs font-extrabold" aria-live="polite">{monthLabel(month)}</span>
            <button type="button" onClick={() => setMonth((value) => shiftMonth(value, 1))} className="rounded-full p-3 text-muted transition hover:bg-paper hover:text-ink" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button type="button" onClick={() => setMonth(todayISO().slice(0, 7))} className="btn btn-white btn-sm min-h-10">Today</button>
          <button type="button" onClick={openNewBlock} className="btn btn-dark btn-sm min-h-10">
            <CalendarPlus className="h-3.5 w-3.5" /> Block dates
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        <SearchField value={search} onChange={setSearch} placeholder="Search vehicle, brand or hub" label="Search vehicles in calendar" className="min-w-[13rem] flex-1" />
        <select value={location} onChange={(event) => setLocation(event.target.value)} className="field w-auto" aria-label="Filter calendar by hub">
          <option value="">All hubs</option>
          {locations.map((hub) => <option key={hub} value={hub}>{hub}</option>)}
        </select>
        <div className="flex flex-wrap items-center gap-3 text-[0.6rem] font-bold text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-ink" /> Confirmed</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-amber-400" /> Pending</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-emerald-500" /> Active</span>
          {BLOCK_KINDS.map((kind) => (
            <span key={kind.key} className="inline-flex items-center gap-1.5">
              <span className={cn('h-1.5 w-4 rounded-full', kind.dot)} /> {kind.label}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-80 animate-pulse rounded-2xl bg-stone-200/70" />
      ) : loadError && !vehicles.length ? (
        <LoadError
          title="The calendar could not load"
          message={loadError}
          hint="An empty month here would look like free capacity. Retry before taking a booking or block."
          onRetry={() => load()}
        />
      ) : filteredVehicles.length ? (
        <>
          <TableScrollHint className="mt-3" />
          <div className="table-wrap" role="region" aria-label="Fleet availability calendar" tabIndex={0}>
            <table className="w-full min-w-[1010px] border-collapse text-left text-[0.65rem]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 min-w-[13rem] border-b border-line bg-[#faf7ed] px-3 py-2 text-left text-[0.58rem] font-extrabold uppercase tracking-[0.14em] text-muted">Vehicle</th>
                  {days.map((day) => (
                    <th
                      key={day.date}
                      scope="col"
                      className={cn(
                        'min-w-[1.85rem] border-b border-l border-line/70 px-0 py-1.5 text-center font-bold',
                        day.weekend ? 'bg-sand/30' : 'bg-[#faf7ed]'
                      )}
                    >
                      <span className="block text-[0.48rem] font-extrabold uppercase text-muted/80">{day.weekday}</span>
                      <span className={cn(
                        'mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-0.5 text-[0.62rem]',
                        day.date === todayISO() ? 'bg-ink text-lime' : 'text-ink'
                      )}>{day.day}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <th scope="row" className="sticky left-0 z-10 min-w-[13rem] border-b border-line bg-white px-3 py-2 text-left font-normal">
                      <div className="flex items-center gap-2">
                        {vehicle.imageUrl ? (
                          <img src={vehicle.imageUrl} alt="" className="h-8 w-11 rounded-md object-cover" />
                        ) : (
                          <span className="flex h-8 w-11 items-center justify-center rounded-md bg-sand"><CalendarRange className="h-3.5 w-3.5 text-muted" /></span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-[0.7rem] font-extrabold text-ink">{vehicle.name}</p>
                          <p className="truncate text-[0.55rem] text-muted">
                            {vehicle.brand} · {vehicle.location}
                            {vehicle.status !== 'available' ? ` · ${vehicle.status}` : ''}
                          </p>
                        </div>
                      </div>
                    </th>
                    {days.map((day) => {
                      const { booking, block } = cellOccupancy(vehicle.id, day.date);
                      const title = [
                        vehicle.name,
                        day.date,
                        booking ? `${booking.code} · ${booking.status}` : '',
                        block ? `${kindMeta(block.kind).label} · ${block.reason || 'Blocked'}` : '',
                      ].filter(Boolean).join(' · ');
                      return (
                        <td
                          key={day.date}
                          title={title}
                          className={cn(
                            'border-b border-l border-line/50 p-0.5 align-middle',
                            day.weekend && 'bg-sand/15',
                            day.date === todayISO() && 'bg-lime/10'
                          )}
                        >
                          {booking ? (
                            <Link
                              to={`/admin/bookings?code=${encodeURIComponent(booking.code)}`}
                              aria-label={`${booking.code}, ${booking.status}, ${day.date}. Open in Bookings.`}
                              className="flex min-h-8 flex-col items-center justify-center gap-1 rounded-md transition hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"
                            >
                              <span className={cn(
                                'h-1.5 w-full rounded-full',
                                booking.status === 'pending' ? 'bg-amber-400' : booking.status === 'active' ? 'bg-emerald-500' : 'bg-ink'
                              )} />
                              {block && <span className={cn('h-1.5 w-full rounded-full', kindMeta(block.kind).dot)} />}
                              {booking.startDate === day.date && (
                                <span className="max-w-full truncate px-0.5 text-[0.45rem] font-extrabold text-muted">
                                  {booking.code.replace(/^RV-/, '')}
                                </span>
                              )}
                            </Link>
                          ) : (
                            <div className="flex min-h-8 flex-col items-center justify-center gap-1">
                              {block && <span className={cn('h-1.5 w-full rounded-full', kindMeta(block.kind).dot)} />}
                              {block && (
                                <span className="sr-only">{kindMeta(block.kind).label} · {block.reason || 'Blocked'}</span>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState
          icon={CalendarRange}
          title="No vehicles match"
          description="Adjust the search or hub filter to see availability."
          action={<button type="button" onClick={() => { setSearch(''); setLocation(''); }} className="btn btn-dark">Clear filters</button>}
        />
      )}

      {waitlist && waitlist.total > 0 && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-extrabold">
                <BellRing className="h-4 w-4 text-forest" /> Waitlist demand
                <span className="rounded-full bg-paper px-2 py-0.5 text-[0.55rem] font-extrabold uppercase tracking-wider text-muted">
                  {waitlist.total} watching
                </span>
                {waitlist.ready > 0 && (
                  <span className="rounded-full border border-forest/30 bg-forest/10 px-2 py-0.5 text-[0.55rem] font-extrabold uppercase tracking-wider text-forest">
                    {waitlist.ready} ready
                  </span>
                )}
              </h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">
                Customers waiting on sold-out windows. Cancellations, date changes and released blocks notify them automatically.
              </p>
            </div>
            {waitlist.ready > 0 && (
              <button type="button" onClick={() => notifyWaitlist()} disabled={Boolean(notifying)} className="btn btn-lime btn-sm min-h-10">
                <BellRing className="h-3.5 w-3.5" /> {notifying === 'all' ? 'Notifying…' : `Notify all ${waitlist.ready}`}
              </button>
            )}
          </div>

          {waitlist.ready > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {waitlist.rows.filter((row) => row.ready).map((row) => (
                <article key={row.alertId} className="flex items-start gap-3 rounded-xl border border-forest/25 bg-forest/5 p-3">
                  {row.vehicleImage ? (
                    <img src={row.vehicleImage} alt="" className="h-11 w-14 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg bg-white"><CalendarRange className="h-4 w-4 text-muted" /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.72rem] font-extrabold">{row.vehicleName}</p>
                    <p className="text-[0.58rem] text-muted">{row.customerName} · {row.customerEmail || 'no email'}</p>
                    <p className="mt-0.5 text-[0.6rem] font-bold text-forest">{dateRange(row.startDate, row.endDate)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => notifyWaitlist(row.alertId)}
                    disabled={Boolean(notifying)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-forest text-cream transition hover:bg-ink disabled:opacity-50"
                    aria-label={`Notify ${row.customerName} that ${row.vehicleName} is free`}
                    title="Notify this customer"
                  >
                    {notifying === row.alertId ? <Check className="h-4 w-4 animate-pulse" /> : <BellRing className="h-4 w-4" />}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-line bg-paper px-3 py-3 text-[0.68rem] text-muted">
              {waitlist.waiting > 0
                ? `No watched window is free right now — ${waitlist.waiting} still waiting${waitlist.notified ? ` · ${waitlist.notified} already notified` : ''}.`
                : `${waitlist.notified} customer${waitlist.notified === 1 ? '' : 's'} already notified — nothing else is waiting.`}
            </p>
          )}
        </section>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="min-w-0 rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold">Blocked dates</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Blocks remove a vehicle from quotes and booking.</p>
            </div>
            <button type="button" onClick={openNewBlock} className="btn btn-white btn-sm min-h-10"><CalendarPlus className="h-3.5 w-3.5" /> Add</button>
          </div>
          <div className="mt-3 space-y-2">
            {monthBlocks.length ? monthBlocks.map((block) => {
              const meta = kindMeta(block.kind);
              const Icon = meta.icon;
              return (
                <article key={block.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-paper p-3">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border', meta.badge)}><Icon className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-extrabold">
                      {block.vehicle?.name ?? 'Vehicle'}
                      <span className={cn('ml-2 rounded-full border px-1.5 py-0.5 text-[0.5rem] font-extrabold uppercase tracking-wider', meta.badge)}>{meta.label}</span>
                    </p>
                    <p className="mt-0.5 text-[0.62rem] text-muted">{dateRange(block.startDate, block.endDate)}</p>
                    <p className="mt-1 text-[0.65rem] leading-5 text-muted">{block.reason || 'No reason recorded.'}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openEditBlock(block)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-white hover:text-ink" aria-label={`Edit block for ${block.vehicle?.name ?? 'vehicle'}`}><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setDeleteTarget(block)} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-rose-50 hover:text-rose-700" aria-label={`Delete block for ${block.vehicle?.name ?? 'vehicle'}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </article>
              );
            }) : (
              <p className="rounded-xl border border-dashed border-line bg-paper px-3 py-5 text-center text-[0.68rem] text-muted">No blocks this month.</p>
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold">Bookings this month</h2>
              <p className="mt-0.5 text-[0.65rem] text-muted">Pending, confirmed and on-rent vehicles.</p>
            </div>
            <span className="badge bg-sand text-ink">{monthBookings.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {monthBookings.length ? monthBookings.map((booking) => (
              <Link
                key={booking.id}
                to={`/admin/bookings?code=${encodeURIComponent(booking.code)}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-paper p-3 transition hover:border-ink/30 hover:bg-white"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-lime"><CalendarRange className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-extrabold">{booking.code} · {booking.vehicle?.name ?? 'Vehicle'}</p>
                  <p className="mt-0.5 text-[0.62rem] text-muted">{dateRange(booking.startDate, booking.endDate)}</p>
                </div>
                <StatusPill status={booking.status} />
              </Link>
            )) : (
              <p className="rounded-xl border border-dashed border-line bg-paper px-3 py-5 text-center text-[0.68rem] text-muted">No bookings this month.</p>
            )}
          </div>
        </section>
      </div>

      <Modal
        open={Boolean(blockForm)}
        onClose={() => (saving ? null : setBlockForm(null))}
        title={blockForm?.id ? 'Edit availability block' : 'Block vehicle dates'}
        description="Blocked dates are removed from quotes and cannot be booked by customers."
        size="md"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setBlockForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={saveBlock} disabled={saving || blockBlocked} className="btn btn-dark flex-1">{saving ? 'Saving…' : 'Save block'}</button>
          </div>
        )}
      >
        {blockForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="block-vehicle">Vehicle</label>
              <select id="block-vehicle" value={blockForm.vehicleId} onChange={(event) => setBlock('vehicleId', event.target.value)} className="field">
                <option value="">Choose a vehicle</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.location}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="block-start">Block starts</label>
              <input id="block-start" type="date" value={blockForm.startDate} onChange={(event) => setBlock('startDate', event.target.value)} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="block-end">Vehicle free again on</label>
              <input id="block-end" type="date" min={blockForm.startDate ? addDaysISO(blockForm.startDate, 1) : undefined} value={blockForm.endDate} onChange={(event) => setBlock('endDate', event.target.value)} className="field" />
              <p className="mt-1.5 text-[0.68rem] leading-4 text-muted">The vehicle can be booked from this date.</p>
            </div>
            {blockBlocked && (
              <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[0.68rem] font-semibold leading-5 text-rose-800 sm:col-span-2">
                {blockCheck.invalidDates
                  ? 'The vehicle must be free again after the block starts.'
                  : blockCheck.booking
                    ? `These dates overlap booking ${blockCheck.booking.code} (${dateRange(blockCheck.booking.startDate, blockCheck.booking.endDate)}). Move or cancel that booking first.`
                    : `These dates overlap another block (${dateRange(blockCheck.block.startDate, blockCheck.block.endDate)}). Edit that block instead.`}
              </p>
            )}
            <div className="sm:col-span-2">
              <label className="label" htmlFor="block-kind">Reason type</label>
              <select id="block-kind" value={blockForm.kind} onChange={(event) => setBlock('kind', event.target.value)} className="field">
                {BLOCK_KINDS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="block-reason">Customer-facing summary</label>
              <input id="block-reason" value={blockForm.reason} onChange={(event) => setBlock('reason', event.target.value)} className="field" placeholder="Scheduled brake service" maxLength={120} />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="block-notes">Internal notes</label>
              <textarea id="block-notes" rows={3} value={blockForm.notes} onChange={(event) => setBlock('notes', event.target.value)} className="field resize-none" placeholder="Workshop, contact or handover details…" maxLength={600} />
            </div>
            {blockForm.id && (
              <p className="rounded-xl border border-line bg-paper p-3 text-[0.68rem] leading-5 text-muted sm:col-span-2">
                Need to release one day? Edit the block first. Overlapping blocks are rejected automatically.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => (saving ? null : setDeleteTarget(null))}
        title={content.calendar_remove_title}
        description={content.calendar_remove_desc}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={saving} className="btn btn-white flex-1">{content.calendar_remove_keep}</button>
            <button type="button" onClick={removeBlock} disabled={saving} className="btn btn-dark flex-1">{saving ? content.calendar_remove_progress : content.calendar_remove_confirm}</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">
          {content.calendar_remove_available_from
            .replace('{name}', deleteTarget?.vehicle?.name || content.calendar_remove_this_vehicle)
            .replace('{dates}', deleteTarget ? dateRange(deleteTarget.startDate, deleteTarget.endDate) : content.calendar_remove_desc_placeholder)}
        </p>
      </Modal>
    </div>
  );
}
