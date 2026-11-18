import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, MapPin, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { RENTAL_TIMES as TIMES, addDaysISO, daysBetween, todayISO } from '../lib/pricing.js';
import { cn, shortDate } from '../lib/format.js';
import { KIND_LABELS, VEHICLE_KINDS, kindForType, typesForKind } from '../lib/constants.js';
import { getSiteContent, maxAdvanceDate, sitePolicy, tripProblem } from '../lib/site.js';
import { mergeTripDefaults, readRememberedTrip, rememberTrip } from '../lib/tripMemory.js';

export default function SearchWidget({ initial = {}, variant = 'hero', className, onSearch }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const navigate = useNavigate();
  const locations = meta.locations;
  const policy = sitePolicy(meta.settings);
  const content = getSiteContent(meta.settings);
  const taxInclusive = meta.settings?.tax_inclusive === 'true';
  const taxLabel = String(meta.settings?.tax_label || 'GST').trim() || 'GST';
  const bikesEnabled = meta.settings.bikes_enabled !== 'false';
  const kinds = VEHICLE_KINDS.filter((kind) => bikesEnabled || kind !== 'bike');

  // When no explicit trip is passed in (home, routes), prefill from the
  // remembered trip so repeat shoppers start exactly where they left off.
  const hasExplicitInitial = initial && Object.keys(initial).length > 0;
  const remembered = !hasExplicitInitial && content.remember_trip_enabled ? readRememberedTrip() : null;
  const prefilled = remembered ? mergeTripDefaults(policy, remembered, {}) : null;
  const initialKind = (prefilled?.kind || initial.kind);
  const requestedKind = VEHICLE_KINDS.includes(initialKind)
    ? initialKind
    : (initial.type ? kindForType(initial.type) : 'car');
  const initialKindSafe = !bikesEnabled && requestedKind === 'bike' ? 'car' : requestedKind;
  const defaultDays = Math.min(policy.maxDays, Math.max(policy.minDays, 5));
  const initialType = typesForKind(initialKindSafe).includes(prefilled?.type || initial.type)
    ? (prefilled?.type || initial.type)
    : '';
  const initialPickup = TIMES.includes(prefilled?.pickupTime || initial.pickupTime || '10:00')
    ? (prefilled?.pickupTime || initial.pickupTime || '10:00')
    : '10:00';
  const initialDropoff = TIMES.includes(prefilled?.dropoffTime || initial.dropoffTime || '10:00')
    ? (prefilled?.dropoffTime || initial.dropoffTime || '10:00')
    : '10:00';

  const [values, setValues] = useState({
    kind: initialKindSafe,
    location: prefilled?.location || initial.location || locations[0]?.name || '',
    dropoff: prefilled?.dropoff || initial.dropoff || initial.location || locations[0]?.name || '',
    from: prefilled?.from || initial.from || addDaysISO(todayISO(), 2),
    to: prefilled?.to || initial.to || addDaysISO(todayISO(), defaultDays),
    pickupTime: initialPickup,
    dropoffTime: initialDropoff,
    type: initialType,
  });

  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  const setKind = (nextKind) => setValues((current) => {
    const allowed = typesForKind(nextKind);
    return {
      ...current,
      kind: nextKind,
      type: allowed.includes(current.type) ? current.type : '',
    };
  });

  useEffect(() => {
    if (bikesEnabled) return;
    setValues((current) => (
      current.kind === 'bike' ? { ...current, kind: 'car', type: '' } : current
    ));
  }, [bikesEnabled]);

  useEffect(() => {
    if (!locations.length) return;
    setValues((current) => {
      const location = locations.some((item) => item.name === current.location)
        ? current.location
        : locations[0].name;
      const dropoff = locations.some((item) => item.name === current.dropoff)
        ? current.dropoff
        : location;
      return {
        ...current,
        location,
        dropoff,
        pickupTime: TIMES.includes(current.pickupTime) ? current.pickupTime : '10:00',
        dropoffTime: TIMES.includes(current.dropoffTime) ? current.dropoffTime : '10:00',
      };
    });
  }, [locations]);

  const updatePickupLocation = (value) => {
    setValues((current) => ({
      ...current,
      location: value,
      dropoff: current.dropoff === current.location ? value : current.dropoff,
    }));
  };

  const submit = (event) => {
    event.preventDefault();
    if (!values.location || !values.dropoff) {
      push(content.search_error_hubs, 'error');
      return;
    }
    if (!values.from || !values.to) {
      push(content.search_error_dates, 'error');
      return;
    }
    if (!TIMES.includes(values.pickupTime) || !TIMES.includes(values.dropoffTime)) {
      push(content.search_error_times, 'error');
      return;
    }
    const problem = tripProblem(values.from, values.to, meta.settings);
    if (problem) {
      push(problem, 'error');
      return;
    }
    if (content.remember_trip_enabled) rememberTrip(values);
    if (onSearch) {
      onSearch(values);
      return;
    }
    const params = new URLSearchParams();
    params.set('location', values.location);
    params.set('dropoff', values.dropoff);
    params.set('from', values.from);
    params.set('to', values.to);
    params.set('pickupTime', values.pickupTime);
    params.set('dropoffTime', values.dropoffTime);
    if (values.kind) params.set('kind', values.kind);
    if (values.type) params.set('type', values.type);
    navigate(`/browse?${params.toString()}`);
  };

  const isHero = variant === 'hero';
  const dayCount = (() => {
    if (!values.from || !values.to) return 0;
    const start = new Date(`${values.from}T00:00:00`);
    const end = new Date(`${values.to}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
    return Math.max(0, Math.round((end - start) / 86400000));
  })();

  // Quick date chips: common trip windows, kept inside the advance limit AND
// long enough to satisfy the configured minimum rental.
  const daysUntil = (weekday) => ((weekday - new Date().getDay()) + 7) % 7 || 7;
  const today = todayISO();
  const cap = maxAdvanceDate(meta.settings);
  const bound = (value) => (value > cap ? cap : value);
  const stretch = (from, to) => {
    const safeFrom = bound(from);
    const length = daysBetween(safeFrom, bound(to));
    return safeFrom <= cap
      ? { from: safeFrom, to: length < policy.minDays ? addDaysISO(safeFrom, policy.minDays) : bound(to) }
      : { from: safeFrom, to: safeFrom };
  };
  const friday = daysUntil(5);
  const monday = daysUntil(1);
  const quickDates = [
    { label: content.search_this_weekend, ...stretch(addDaysISO(today, friday), addDaysISO(today, friday + 3)) },
    { label: content.search_next_weekend, ...stretch(addDaysISO(today, friday + 7), addDaysISO(today, friday + 10)) },
    { label: content.search_next_week, ...stretch(addDaysISO(today, monday), addDaysISO(today, monday + 4)) },
    { label: content.search_this_month, ...stretch(addDaysISO(today, 2), addDaysISO(today, 15)) },
  ];

  return (
    <form
      onSubmit={submit}
      className={cn(
        'gradient-border relative rounded-[1.65rem] p-3 shadow-[0_30px_80px_-40px_rgba(10,15,11,0.7)] sm:p-4',
        isHero ? 'lg:p-3.5' : 'bg-white',
        className
      )}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-fit items-center gap-1 rounded-full border border-line/80 bg-gradient-to-r from-white via-paper to-white p-1 shadow-inner">
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKind(kind)}
              aria-pressed={values.kind === kind}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[0.68rem] font-extrabold uppercase tracking-[0.08em] transition',
                values.kind === kind ? 'bg-ink text-lime shadow-[0_8px_18px_-12px_rgba(10,15,11,0.8)]' : 'text-muted hover:bg-white hover:text-ink'
              )}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        {dayCount > 0 && (
          <span
            key={`${values.from}-${values.to}`}
            className="snap-nudge inline-flex items-center gap-1.5 rounded-full border border-line bg-white/85 px-2.5 py-1 text-[0.62rem] font-extrabold text-ink"
            aria-live="polite"
          >
            <CalendarDays className="h-3 w-3 text-lime-deep" />
            {dayCount} {dayCount === 1 ? content.search_day_singular : content.search_day_plural}
            <span className="hidden font-semibold text-muted sm:inline"> · {shortDate(values.from)} – {shortDate(values.to)}</span>
          </span>
        )}
      </div>

      <div className={cn('grid gap-2', isHero ? 'lg:grid-cols-[1.08fr_1.08fr_1.03fr_1.03fr_0.78fr_auto]' : 'lg:grid-cols-2 xl:grid-cols-4')}>
        <div className="group rounded-2xl bg-white/95 px-3.5 py-3 ring-1 ring-inset ring-line/80 transition hover:bg-white hover:shadow-[0_10px_24px_-24px_rgba(10,15,11,0.55)] focus-within:bg-white focus-within:ring-2 focus-within:ring-moss/45">
          <label htmlFor="search-pickup" className="mb-1 flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-muted">
            <MapPin className="h-3 w-3" /> {content.search_pickup_label}
          </label>
          <select
            id="search-pickup"
            value={values.location}
            onChange={(event) => updatePickupLocation(event.target.value)}
            className="w-full appearance-none bg-transparent pr-4 text-[0.82rem] font-bold text-ink focus:outline-none"
          >
            {locations.map((location) => (
              <option key={location.id} value={location.name}>{location.name}</option>
            ))}
          </select>
        </div>

        <div className="group rounded-2xl bg-white/95 px-3.5 py-3 ring-1 ring-inset ring-line/80 transition hover:bg-white hover:shadow-[0_10px_24px_-24px_rgba(10,15,11,0.55)] focus-within:bg-white focus-within:ring-2 focus-within:ring-moss/45">
          <label htmlFor="search-dropoff" className="mb-1 flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-muted">
            <MapPin className="h-3 w-3" /> {content.search_dropoff_label}
          </label>
          <select
            id="search-dropoff"
            value={values.dropoff}
            onChange={(event) => set('dropoff', event.target.value)}
            className="w-full appearance-none bg-transparent pr-4 text-[0.82rem] font-bold text-ink focus:outline-none"
          >
            {locations.map((location) => (
              <option key={location.id} value={location.name}>{location.name}</option>
            ))}
          </select>
        </div>

        <div className="group rounded-2xl bg-white/95 px-3.5 py-3 ring-1 ring-inset ring-line/80 transition hover:bg-white hover:shadow-[0_10px_24px_-24px_rgba(10,15,11,0.55)] focus-within:bg-white focus-within:ring-2 focus-within:ring-moss/45">
          <label htmlFor="search-from" className="mb-1 flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-muted">
            <CalendarDays className="h-3 w-3" /> {content.search_pickup_date_label}
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="search-from"
              type="date"
              min={todayISO()}
              max={maxAdvanceDate(meta.settings)}
              value={values.from}
              onChange={(event) => {
                const next = event.target.value;
                setValues((current) => ({
                  ...current,
                  from: next,
                  to: current.to <= next ? addDaysISO(next, policy.minDays) : current.to,
                }));
              }}
              className="min-w-0 flex-1 bg-transparent text-[0.78rem] font-bold focus:outline-none"
            />
            <select
              aria-label={content.search_pickup_time_aria}
              value={values.pickupTime}
              onChange={(event) => set('pickupTime', event.target.value)}
              className="appearance-none bg-transparent text-[0.7rem] font-semibold text-muted focus:outline-none"
            >
              {TIMES.map((time) => <option key={time} value={time}>{formatTime(time)}</option>)}
            </select>
          </div>
        </div>

        <div className="group rounded-2xl bg-white/95 px-3.5 py-3 ring-1 ring-inset ring-line/80 transition hover:bg-white hover:shadow-[0_10px_24px_-24px_rgba(10,15,11,0.55)] focus-within:bg-white focus-within:ring-2 focus-within:ring-moss/45">
          <label htmlFor="search-to" className="mb-1 flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-muted">
            <CalendarDays className="h-3 w-3" /> {content.search_dropoff_date_label}
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="search-to"
              type="date"
              min={addDaysISO(values.from, policy.minDays)}
              value={values.to}
              onChange={(event) => set('to', event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[0.78rem] font-bold focus:outline-none"
            />
            <select
              aria-label={content.search_dropoff_time_aria}
              value={values.dropoffTime}
              onChange={(event) => set('dropoffTime', event.target.value)}
              className="appearance-none bg-transparent text-[0.7rem] font-semibold text-muted focus:outline-none"
            >
              {TIMES.map((time) => <option key={time} value={time}>{formatTime(time)}</option>)}
            </select>
          </div>
        </div>

        <div className="group rounded-2xl bg-white/95 px-3.5 py-3 ring-1 ring-inset ring-line/80 transition hover:bg-white hover:shadow-[0_10px_24px_-24px_rgba(10,15,11,0.55)] focus-within:bg-white focus-within:ring-2 focus-within:ring-moss/45">
          <label htmlFor="search-type" className="mb-1 block text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-muted">
            {values.kind === 'bike' ? content.search_bike_type_label : content.search_car_type_label}
          </label>
          <select
            id="search-type"
            value={values.type}
            onChange={(event) => set('type', event.target.value)}
            className="w-full appearance-none bg-transparent pr-4 text-[0.82rem] font-bold text-ink focus:outline-none"
          >
            <option value="">{content.search_any_type}</option>
            {typesForKind(values.kind).map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>

        <button type="submit" className="btn btn-lime h-full min-h-[4.05rem] w-full gap-2 rounded-2xl px-5 lg:w-auto">
          <Search className="h-4 w-4" />
          <span className={isHero ? 'lg:hidden xl:inline' : ''}>{values.kind === 'bike' ? content.search_find_bikes : content.search_find_cars}</span>
        </button>
      </div>
      {isHero && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">{content.search_quick_dates}</span>
          {quickDates.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setValues((current) => ({ ...current, from: preset.from, to: preset.to }))}
              aria-pressed={preset.from === values.from && preset.to === values.to}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[0.62rem] font-bold transition',
                preset.from === values.from && preset.to === values.to
                  ? 'border-ink bg-ink text-cream'
                  : 'border-line bg-white/90 text-ink hover:border-ink hover:text-ink'
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      {isHero && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1.5 pb-0.5 text-[0.6rem] font-semibold text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-lime-deep" />
            {taxInclusive ? `All-in prices include ${taxLabel} and insurance` : `${taxLabel} and insurance are added at checkout`}
          </span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-moss" /> {policy.fullRefundCopy}</span>
        </div>
      )}
    </form>
  );
}

function formatTime(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'pm' : 'am'}`;
}
