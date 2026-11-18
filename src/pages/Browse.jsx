import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bookmark, CalendarDays, Check, ChevronRight, Filter, LayoutGrid, Map as MapIcon, MapPin, RotateCcw, Rows3, Search, SlidersHorizontal, Sparkles, Trash2, X,
} from 'lucide-react';
import SearchWidget from '../components/SearchWidget.jsx';
import VehicleCard from '../components/VehicleCard.jsx';
import CompareTray from '../components/CompareTray.jsx';
import { Drawer, EmptyState, Modal, Skeleton, Tag, Toggle } from '../components/ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { RENTAL_TIMES, addDaysISO, todayISO } from '../lib/pricing.js';
import { cn, inr, shortDate, timeLabel } from '../lib/format.js';
import { getSiteContent, sitePolicy, tripProblem } from '../lib/site.js';
import { clearRememberedTrip, readRememberedTrip, mergeTripDefaults } from '../lib/tripMemory.js';
import { deleteSavedSearch, listSavedSearches, saveSearch } from '../lib/savedSearches.js';
import {
  BIKE_GEARS,
  FUELS_BY_KIND,
  KIND_LABELS,
  TRANSMISSIONS,
  VEHICLE_KINDS,
  kindForType,
  typesForKind,
} from '../lib/constants.js';

const emptyFilters = {
  kind: 'car', type: [], transmission: '', gears: '', engineCc: '', fuel: [], seats: '',
  maxPrice: null, awd: false, location: '', q: '',
};

// Canonical spec for pushing the chip filters into the URL (and back). The
// round-trip is lossless so syncing can never feed itself a "different" value.
const FILTER_PARAMS = [
  { key: 'q', write: (f) => f.q || null, read: (p) => p.get('q') ?? '', field: 'q' },
  { key: 'price', write: (f) => f.maxPrice == null ? null : String(f.maxPrice), read: (p) => (/^\d+$/.test(p.get('price') ?? '') ? Number(p.get('price')) : null), field: 'maxPrice' },
  { key: 'fuel', write: (f) => f.fuel?.join(',') || null, read: (p) => (p.get('fuel') ?? '').split(',').filter(Boolean), field: 'fuel' },
  { key: 'seats', write: (f) => f.seats || null, read: (p) => p.get('seats') ?? '', field: 'seats' },
  { key: 'gears', write: (f) => f.gears || null, read: (p) => p.get('gears') ?? '', field: 'gears' },
  { key: 'engine', write: (f) => f.engineCc || null, read: (p) => p.get('engine') ?? '', field: 'engineCc' },
  { key: 'transmission', write: (f) => f.transmission || null, read: (p) => p.get('transmission') ?? '', field: 'transmission' },
  { key: 'awd', write: (f) => f.awd ? '1' : null, read: (p) => p.get('awd') === '1', field: 'awd' },
];

// Kind/type are written to the URL so a shared link survives a reload, but the
// hydration effect restores them (validating against what the fleet offers), so
// these are write-only here — reading them back lives with the trip hydration.
const WRITE_ONLY_PARAMS = [
  { key: 'kind', value: (f) => f.kind || null },
  { key: 'type', value: (f) => (f.type?.length ? f.type.join(',') : null) },
];

export default function Browse() {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const [params, setParams] = useSearchParams();
  const bikesEnabled = meta.settings?.bikes_enabled !== 'false';
  const kinds = VEHICLE_KINDS.filter((kind) => bikesEnabled || kind !== 'bike');
  const policy = sitePolicy(meta.settings);
  const mapEnabled = meta.settings?.map_view_enabled !== 'false';
  const defaultDays = Math.min(policy.maxDays, Math.max(policy.minDays, 5));
  const rawRequestedKind = params.get('kind') || (params.get('type') ? kindForType(params.get('type')) : 'car');
  const requestedKind = VEHICLE_KINDS.includes(rawRequestedKind) ? rawRequestedKind : 'car';
  const rawType = params.get('type') || '';
  const requestedType = typesForKind(requestedKind).includes(rawType) ? rawType : '';

  const [trip, setTrip] = useState(() => {
    const fallbackFrom = addDaysISO(todayISO(), 2);
    const dateProblem = tripProblem(params.get('from'), params.get('to'), meta.settings);
    return {
      location: params.get('location') || meta.locations[0]?.name || '',
      dropoff: params.get('dropoff') || params.get('location') || meta.locations[0]?.name || '',
      from: dateProblem ? fallbackFrom : params.get('from'),
      to: dateProblem ? addDaysISO(fallbackFrom, defaultDays) : params.get('to'),
      pickupTime: RENTAL_TIMES.includes(params.get('pickupTime')) ? params.get('pickupTime') : '10:00',
      dropoffTime: RENTAL_TIMES.includes(params.get('dropoffTime')) ? params.get('dropoffTime') : '10:00',
    };
  });

  const [filters, setFilters] = useState(() => ({
    ...emptyFilters,
    kind: !bikesEnabled && requestedKind === 'bike' ? 'car' : requestedKind,
    type: !bikesEnabled && requestedKind === 'bike' ? [] : (requestedType ? [requestedType] : []),
    location: params.get('location') || '',
    // Deep-link / back-forward: restore the chip filters the URL carries.
    q: params.get('q') ?? '',
    maxPrice: (/^\d+$/.test(params.get('price') ?? '') ? Number(params.get('price')) : null),
    fuel: (params.get('fuel') ?? '').split(',').filter(Boolean),
    seats: params.get('seats') ?? '',
    gears: params.get('gears') ?? '',
    engineCc: params.get('engine') ?? '',
    transmission: params.get('transmission') ?? '',
    awd: params.get('awd') === '1',
  }));

  const [sort, setSort] = useState('recommended');
  const [view, setView] = useState(() => {
    try {
      const stored = localStorage.getItem('rove_browse_view');
      return ['grid', 'list', 'map'].includes(stored) ? stored : 'grid';
    } catch {
      return 'grid';
    }
  });
  const effectiveView = view === 'map' && !mapEnabled ? 'grid' : view;
  const [vehicles, setVehicles] = useState([]);
  const [bounds, setBounds] = useState({ min: 0, max: 30000 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [remembered, setRemembered] = useState(() => (content.remember_trip_enabled ? readRememberedTrip() : null));
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedName, setSavedName] = useState('');
  const [savedItems, setSavedItems] = useState(listSavedSearches);

  const changeView = (next) => {
    setView(next);
    try {
      localStorage.setItem('rove_browse_view', next);
    } catch {
      /* storage can be unavailable in private mode */
    }
    // Make the map a shareable deep link too (e.g. the Hubs page map button).
    const nextParams = new URLSearchParams(params);
    nextParams.set('view', next);
    setParams(nextParams, { replace: true });
  };

  // A `?view=map|grid|list` link wins over the stored preference for that visit.
  useEffect(() => {
    const urlView = params.get('view');
    if (!urlView || !['grid', 'list', 'map'].includes(urlView)) return;
    setView(urlView === 'map' && !mapEnabled ? 'grid' : urlView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Keep the chip filters shareable: every change is mirrored into the URL
  // (replace, no history spam) so Back/Forward and a copied link restore the
  // exact filtered view. The round-trip is canonical, so this can never write
  // back a value that the hydrate effect would then re-apply.
  useEffect(() => {
    const next = new URLSearchParams(params);
    let changed = false;
    FILTER_PARAMS.forEach(({ key, write }) => {
      // The price slider's untouched position IS the default cap — sharing
      // that as a "filter" is noise. Only a user-tightened cap becomes a URL.
      let value = write(filters);
      if (key === 'price' && (filters.maxPrice == null || (bounds.max > 0 && filters.maxPrice >= bounds.max))) {
        value = null;
      }
      const current = next.get(key);
      if (value === null || value === '') {
        if (current !== null) { next.delete(key); changed = true; }
      } else if (current !== String(value)) {
        next.set(key, String(value));
        changed = true;
      }
    });
    WRITE_ONLY_PARAMS.forEach(({ key, value }) => {
      const nextValue = value(filters);
      const current = next.get(key);
      if (nextValue === null || nextValue === '') {
        if (current !== null) { next.delete(key); changed = true; }
      } else if (current !== String(nextValue)) {
        next.set(key, String(nextValue));
        changed = true;
      }
    });
    if (changed) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, params, bounds.max]);

  useEffect(() => {
    // Re-hydrate on every URL change. `kind`, `type`, `location` and the trip
    // are written into the URL by onSearch/deep links, so Back/Forward and
    // same-route link clicks must restore all of them — not just the chip
    // filters — or the page shows results that no longer match the address bar.
    setFilters((current) => {
      const next = { ...current };
      let touched = false;

      const requestedKind = params.get('kind') || (params.get('type') ? kindForType(params.get('type')) : 'car');
      const kind = VEHICLE_KINDS.includes(requestedKind) ? requestedKind : 'car';
      const safeKind = !bikesEnabled && kind === 'bike' ? 'car' : kind;
      if (next.kind !== safeKind) { next.kind = safeKind; touched = true; }

      // type is comma-joined in the URL; keep only types this kind actually offers.
      const requestedTypes = (params.get('type') || '').split(',').filter(Boolean);
      const validForKind = requestedTypes.filter((type) => typesForKind(kind).includes(type));
      const safeType = safeKind !== kind ? [] : validForKind;
      const typeSame = next.type?.length === safeType.length && next.type.every((value, index) => value === safeType[index]);
      if (!typeSame) { next.type = safeType; touched = true; }

      const urlLocation = params.get('location') || '';
      if (next.location !== urlLocation) { next.location = urlLocation; touched = true; }

      FILTER_PARAMS.forEach(({ read, field }) => {
        const value = read(params);
        if (next[field] !== value) {
          next[field] = value;
          touched = true;
        }
      });
      return touched ? next : current;
    });

    setTrip((current) => {
      const fallbackFrom = addDaysISO(todayISO(), 2);
      const dateProblem = tripProblem(params.get('from'), params.get('to'), meta.settings);
      const next = {
        location: params.get('location') || meta.locations[0]?.name || '',
        dropoff: params.get('dropoff') || params.get('location') || meta.locations[0]?.name || '',
        from: dateProblem ? fallbackFrom : params.get('from'),
        to: dateProblem ? addDaysISO(fallbackFrom, defaultDays) : params.get('to'),
        pickupTime: RENTAL_TIMES.includes(params.get('pickupTime')) ? params.get('pickupTime') : '10:00',
        dropoffTime: RENTAL_TIMES.includes(params.get('dropoffTime')) ? params.get('dropoffTime') : '10:00',
      };
      let changed = false;
      Object.keys(next).forEach((key) => { if (current[key] !== next[key]) changed = true; });
      return changed ? next : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, meta.locations, meta.settings]);

  // Map mode already loads every hub, so changing the selected hub is a
  // client-side filter. Keying the request on the map-adjusted filters avoids
  // a redundant round trip (and map flicker) on every pin click.
  const requestKey = JSON.stringify({
    ...filters,
    location: effectiveView === 'map' ? '' : filters.location,
  });

  useEffect(() => {
    if (!meta.locations.length) return;
    setTrip((current) => {
      const location = meta.locations.some((item) => item.name === current.location)
        ? current.location
        : meta.locations[0].name;
      const dropoff = meta.locations.some((item) => item.name === current.dropoff)
        ? current.dropoff
        : location;
      return location === current.location && dropoff === current.dropoff
        ? current
        : { ...current, location, dropoff };
    });
    setFilters((current) => {
      if (!current.location || meta.locations.some((item) => item.name === current.location)) return current;
      return { ...current, location: '' };
    });
  }, [meta.locations]);

  useEffect(() => {
    if (bikesEnabled) return;
    setFilters((current) => (current.kind === 'bike' ? {
      ...current,
      kind: 'car',
      type: [],
      gears: '',
      engineCc: '',
      helmetCount: '',
    } : current));
  }, [bikesEnabled]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.listVehicles({
      q: filters.q,
      kind: filters.kind,
      type: filters.type.join(','),
      gears: filters.gears,
      engineCc: filters.engineCc,
      location: effectiveView === 'map' ? '' : filters.location,
      transmission: filters.transmission,
      fuel: filters.fuel.join(','),
      seats: filters.seats,
      maxPrice: filters.maxPrice ?? '',
      awd: filters.awd,
      sort,
      from: trip.from,
      to: trip.to,
    })
      .then((result) => {
        if (!alive) return;
        setVehicles(result.vehicles ?? []);
        if (result.priceBounds) {
          setBounds(result.priceBounds);
          setFilters((current) => (
            current.maxPrice === null ? { ...current, maxPrice: result.priceBounds.max } : current
          ));
        }
      })
      .catch((nextError) => { if (alive) setError(nextError.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [requestKey, sort, trip.from, trip.to, retryKey]);

  const activeChips = useMemo(() => {
    const chips = [];
    filters.type.forEach((type) => chips.push({ key: `type-${type}`, label: type, clear: () => toggleType(type) }));
    if (filters.location) chips.push({ key: 'location', label: filters.location, clear: () => update('location', '') });
    if (filters.kind === 'bike') {
      if (filters.gears) chips.push({ key: 'gears', label: filters.gears, clear: () => update('gears', '') });
      if (filters.engineCc) chips.push({ key: 'engineCc', label: `${filters.engineCc}cc+`, clear: () => update('engineCc', '') });
    } else {
      if (filters.transmission) chips.push({ key: 'transmission', label: filters.transmission, clear: () => update('transmission', '') });
      if (filters.seats) chips.push({ key: 'seats', label: `${filters.seats}+ seats`, clear: () => update('seats', '') });
      if (filters.awd) chips.push({ key: 'awd', label: 'AWD', clear: () => update('awd', false) });
    }
    filters.fuel.forEach((fuel) => chips.push({ key: `fuel-${fuel}`, label: fuel, clear: () => toggleFuel(fuel) }));
    if (filters.maxPrice !== null && filters.maxPrice < bounds.max) {
      chips.push({ key: 'price', label: `Up to ${inr(filters.maxPrice)}`, clear: () => update('maxPrice', bounds.max) });
    }
    if (filters.q) chips.push({ key: 'q', label: `“${filters.q}”`, clear: () => update('q', '') });
    return chips;
  }, [filters, bounds.max]);

  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const toggleType = (type) => setFilters((current) => ({
    ...current,
    type: current.type.includes(type) ? current.type.filter((item) => item !== type) : [...current.type, type],
  }));
  const toggleFuel = (fuel) => setFilters((current) => ({
    ...current,
    fuel: current.fuel.includes(fuel) ? current.fuel.filter((item) => item !== fuel) : [...current.fuel, fuel],
  }));
  const changeKind = (kind) => {
    if (kind === 'bike' && !bikesEnabled) return;
    setFilters((current) => {
      const allowed = typesForKind(kind);
      const allowedFuels = FUELS_BY_KIND[kind] ?? [];
      return {
        ...current,
        kind,
        type: current.type.filter((type) => allowed.includes(type)),
        fuel: current.fuel.filter((fuel) => allowedFuels.includes(fuel)),
        transmission: kind === 'bike' ? '' : current.transmission,
        gears: kind === 'bike' ? current.gears : '',
        engineCc: kind === 'bike' ? current.engineCc : '',
        seats: kind === 'bike' ? '' : current.seats,
        awd: kind === 'bike' ? false : current.awd,
        maxPrice: null,
      };
    });
  }
  const clearAll = () => setFilters((current) => ({ ...emptyFilters, kind: current.kind, maxPrice: bounds.max }));
  const isFiltered = activeChips.length > 0;

  // Hub coverage for map mode. Counts come from the currently loaded result set
  // (map mode fetches every hub, then filters the visible list client-side).
  const hubStats = useMemo(() => {
    const counts = new Map();
    vehicles.forEach((vehicle) => counts.set(vehicle.location, (counts.get(vehicle.location) || 0) + 1));
    return meta.locations.map((location) => {
      const lat = Number(location.lat);
      const lng = Number(location.lng);
      const mapped = Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= 8 && lat <= 35 && lng >= 68 && lng <= 97;
      return {
        ...location,
        count: counts.get(location.name) || 0,
        mapped,
        left: mapped ? `${((lng - 68) / (97 - 68)) * 100}%` : null,
        top: mapped ? `${((35 - lat) / (35 - 8)) * 100}%` : null,
      };
    });
  }, [meta.locations, vehicles]);
  const mapPins = hubStats.filter((hub) => hub.mapped);
  const selectedHub = hubStats.find((hub) => hub.name === filters.location) || null;
  const visibleVehicles = effectiveView === 'map' && filters.location
    ? vehicles.filter((vehicle) => vehicle.location === filters.location)
    : vehicles;
  const kindLabel = filters.kind === 'bike' ? 'bikes' : 'cars';
  const kindSingular = filters.kind === 'bike' ? 'bike' : 'car';

  const onSearch = (values) => {
    setTrip(values);
    setFilters((current) => ({
      ...current,
      kind: values.kind || current.kind,
      type: values.type ? [values.type] : [],
      location: values.location,
    }));
    const next = new URLSearchParams();
    next.set('location', values.location);
    next.set('dropoff', values.dropoff);
    next.set('from', values.from);
    next.set('to', values.to);
    next.set('pickupTime', values.pickupTime);
    next.set('dropoffTime', values.dropoffTime);
    if (values.kind) next.set('kind', values.kind);
    if (values.type) next.set('type', values.type);
    setParams(next, { replace: true });
    setSearchOpen(false);
  };

  const sameAsRemembered = remembered
    && filters.location === remembered.location
    && trip.dropoff === remembered.dropoff
    && trip.from === remembered.from
    && trip.to === remembered.to
    && (trip.pickupTime || '10:00') === (remembered.pickupTime || '10:00')
    && (trip.dropoffTime || '10:00') === (remembered.dropoffTime || '10:00')
    && filters.kind === (remembered.kind && VEHICLE_KINDS.includes(remembered.kind) ? remembered.kind : 'car');

  const applyRemembered = () => {
    if (!remembered) return;
    setTrip((current) => ({
      ...current,
      location: remembered.location,
      dropoff: remembered.dropoff,
      from: remembered.from,
      to: remembered.to,
      pickupTime: remembered.pickupTime || current.pickupTime,
      dropoffTime: remembered.dropoffTime || current.dropoffTime,
    }));
    setFilters((current) => ({
      ...current,
      location: remembered.location,
      // The remember strip can only store kind recorded at the time; on a
      // cars-only installation that must not leak a bike filter back in.
      kind: remembered.kind === 'bike' && !bikesEnabled ? 'car' : (remembered.kind === 'bike' ? 'bike' : 'car'),
      type: (!bikesEnabled && remembered.kind === 'bike') ? [] : (remembered.type ? [remembered.type] : []),
    }));
    const next = new URLSearchParams();
    next.set('location', remembered.location);
    next.set('dropoff', remembered.dropoff);
    next.set('from', remembered.from);
    next.set('to', remembered.to);
    if (remembered.pickupTime) next.set('pickupTime', remembered.pickupTime);
    if (remembered.dropoffTime) next.set('dropoffTime', remembered.dropoffTime);
    if (remembered.kind) next.set('kind', remembered.kind);
    if (remembered.type) next.set('type', remembered.type);
    setParams(next, { replace: true });
    setRemembered(null);
  };

  const forgetRemembered = () => {
    clearRememberedTrip();
    setRemembered(null);
  };

  // The URL only carries the trip + kind; save the whole filter set too so a
// saved search restores the exact view (price cap, fuel, seats, AWD …) and so
// two searches that differ only by a filter are not treated as duplicates.
const filterSignature = () => JSON.stringify({
  kind: filters.kind,
  type: filters.type,
  transmission: filters.transmission,
  gears: filters.gears,
  engineCc: filters.engineCc,
  fuel: filters.fuel,
  seats: filters.seats,
  awd: filters.awd,
  maxPrice: filters.maxPrice,
  q: filters.q,
  location: filters.location,
});

const trySaveSearch = () => {
    const result = saveSearch({
      label: savedName,
      params: params.toString(),
      summary: `${trip.location || content.browse_any_hub} · ${shortDate(trip.from)} – ${shortDate(trip.to)}`,
      filters: filterSignature(),
    });
    if (result.limit) { push(content.saved_limit, 'info'); return; }
    if (result.duplicate) { push(content.saved_duplicate, 'info'); return; }
    setSavedItems(result.items);
    setSavedName('');
    push(content.saved_saved, 'success');
  };

  const applySavedSearch = (entry) => {
    const saved = new URLSearchParams(entry.params);
    const merged = mergeTripDefaults(policy, {
      location: saved.get('location') || '',
      dropoff: saved.get('dropoff') || saved.get('location') || '',
      from: saved.get('from') || '',
      to: saved.get('to') || '',
      pickupTime: saved.get('pickupTime') || '',
      dropoffTime: saved.get('dropoffTime') || '',
      kind: saved.get('kind') || 'car',
      type: saved.get('type') || '',
    }, {});
    setTrip({
      location: merged.location,
      dropoff: merged.dropoff,
      from: merged.from,
      to: merged.to,
      pickupTime: merged.pickupTime,
      dropoffTime: merged.dropoffTime,
    });
    setFilters((current) => {
      let saved = {};
      try { saved = entry.filters ? JSON.parse(entry.filters) : {}; } catch { saved = {}; }
      return {
        ...current,
        location: merged.location,
        kind: merged.kind === 'bike' ? 'bike' : 'car',
        type: merged.type ? [merged.type] : [],
        // Restore the full filter set that was live when the search was saved.
        ...Object.fromEntries(Object.entries(emptyFilters).filter(([key]) => key in saved).map(([key]) => [key, saved[key]])),
      };
    });
    setParams(new URLSearchParams({
      location: merged.location,
      dropoff: merged.dropoff,
      from: merged.from,
      to: merged.to,
      pickupTime: merged.pickupTime,
      dropoffTime: merged.dropoffTime,
      kind: merged.kind,
      type: merged.type,
    }), { replace: true });
    setSavedOpen(false);
  };

  const removeSavedSearch = (id) => {
    setSavedItems(deleteSavedSearch(id));
    push(content.saved_remove, 'success');
  };

  return (
    <div className="pb-20">
      <section className="relative overflow-hidden border-b border-line bg-paper/75">
        <div className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-lime/20 blur-[90px]" />
        <div className="pointer-events-none absolute -right-24 top-0 h-72 w-72 rounded-full bg-aqua/20 blur-[100px]" />
        <div className="container-x relative py-8 sm:py-10">
          <nav className="mb-4 flex flex-wrap items-center gap-1.5 text-[0.68rem] font-semibold text-muted" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-ink">{content.browse_crumb_home}</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-ink" aria-current="page">{content.browse_crumb_fleet}</span>
          </nav>
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow mb-2">{content.browse_eyebrow}</p>
              <h1 className="display text-4xl leading-none sm:text-5xl lg:text-[3.6rem]">{content.browse_title}</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
                {loading
                  ? content.browse_loading
                  : `${visibleVehicles.length} ${visibleVehicles.length === 1
                    ? (filters.kind === 'bike' ? 'bike' : 'car')
                    : (filters.kind === 'bike' ? 'bikes' : 'cars')} available ${content.browse_available_suffix}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSavedOpen(true)}
                aria-label={content.saved_save_aria}
                title={content.saved_save}
                className="rounded-full border border-line bg-white/60 p-2.5 text-ink/70 transition hover:bg-white hover:text-ink"
              >
                <Bookmark className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setSearchOpen(true)} className="btn btn-white btn-sm">
                <CalendarDays className="h-3.5 w-3.5" /> {content.browse_edit_trip}
              </button>
              <button type="button" onClick={() => setFiltersOpen(true)} className="btn btn-dark btn-sm lg:hidden">
                <SlidersHorizontal className="h-3.5 w-3.5" /> {content.browse_filters} {isFiltered && `(${activeChips.length})`}
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-white px-4 py-3 text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold"><MapPin className="h-3.5 w-3.5 text-muted" /> {trip.location || content.browse_any_hub}</span>
            <span className="hidden h-4 w-px bg-line sm:block" />
            <span className="inline-flex items-center gap-1.5 font-bold"><CalendarDays className="h-3.5 w-3.5 text-muted" /> {shortDate(trip.from)} – {shortDate(trip.to)}</span>
            <span className="text-muted">{timeLabel(trip.pickupTime)} pick-up</span>
            <span className="hidden h-4 w-px bg-line sm:block" />
            <span className="inline-flex items-center gap-1.5 text-muted"><MapPin className="h-3.5 w-3.5" /> {content.browse_dropoff_prefix} {trip.dropoff}</span>
            <button type="button" onClick={() => setSearchOpen(true)} className="ml-auto text-[0.7rem] font-bold text-forest underline decoration-lime decoration-2 underline-offset-4">{content.browse_change}</button>
          </div>

          {remembered && !sameAsRemembered && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-lime/25 bg-lime/10 px-3.5 py-2.5 text-[0.72rem] text-ink">
              <span className="inline-flex items-center gap-1.5 font-bold"><Sparkles className="h-3.5 w-3.5 text-forest" /> {content.remember_strip_hint}</span>
              <span className="text-muted">
                {remembered.location} · {shortDate(remembered.from)} – {shortDate(remembered.to)}
                {remembered.kind === 'bike' ? ' · bikes' : ''}
              </span>
              <button type="button" onClick={applyRemembered} className="ml-auto btn btn-lime btn-sm !h-8">{content.remember_apply}</button>
              <button type="button" onClick={forgetRemembered} className="text-[0.68rem] font-bold text-rose-700 underline underline-offset-4">{content.remember_clear}</button>
            </div>
          )}
        </div>
      </section>

      <div className="container-x pt-7">
        <div className="mb-4 flex w-fit items-center gap-1 rounded-full border border-line bg-white p-1">
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => changeKind(kind)}
              aria-pressed={filters.kind === kind}
              className={cn('rounded-full px-4 py-2 text-[0.72rem] font-extrabold uppercase tracking-[0.06em] transition', filters.kind === kind ? 'bg-ink text-lime shadow-[0_8px_20px_-14px_rgba(10,15,11,0.8)]' : 'text-muted hover:bg-white hover:text-ink')}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>

        <div className="no-scrollbar -mx-1 mb-6 flex items-center gap-2 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => update('type', [])}
            className={cn('shrink-0 rounded-full border px-3.5 py-2 text-[0.72rem] font-bold transition', filters.type.length === 0 ? 'border-ink bg-ink text-cream' : 'border-line bg-white text-ink hover:border-ink')}
          >
            {filters.kind === 'bike' ? content.browse_all_bikes : content.browse_all_cars}
          </button>
          {typesForKind(filters.kind).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => update('type', filters.type.includes(type) ? filters.type.filter((item) => item !== type) : [...filters.type, type])}
              className={cn('shrink-0 rounded-full border px-3.5 py-2 text-[0.72rem] font-bold transition', filters.type.includes(type) ? 'border-ink bg-ink text-cream' : 'border-line bg-white text-ink hover:border-ink')}
            >
              {type}
            </button>
          ))}
        </div>

        <div className="grid gap-7 lg:grid-cols-[16.5rem_1fr]">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <FilterPanel
                filters={filters}
                update={update}
                toggleType={toggleType}
                toggleFuel={toggleFuel}
                changeKind={changeKind}
                kinds={kinds}
                bounds={bounds}
                meta={meta}
                content={content}
                clearAll={clearAll}
                isFiltered={isFiltered}
              />
            </div>
          </aside>

          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {activeChips.map((chip) => (
                  <Tag key={chip.key} label={chip.label} variant="info" removable onRemove={chip.clear} />
                ))}
                {isFiltered && (
                  <button type="button" onClick={clearAll} className="text-[0.66rem] font-bold text-rose-700 underline underline-offset-4">{content.browse_clear_all}</button>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <label htmlFor="sort" className="text-[0.66rem] font-bold uppercase tracking-wider text-muted">{content.browse_sort_label}</label>
                <select id="sort" value={sort} onChange={(event) => setSort(event.target.value)} className="field h-9 w-auto py-1.5 text-[0.72rem] font-bold">
                  <option value="recommended">{content.browse_sort_recommended}</option>
                  <option value="price-asc">{content.browse_sort_price_asc}</option>
                  <option value="price-desc">{content.browse_sort_price_desc}</option>
                  <option value="rating">{content.browse_sort_rating}</option>
                  <option value="newest">{content.browse_sort_newest}</option>
                </select>
                <span className="hidden h-6 w-px bg-line sm:block" />
                <div className="flex items-center gap-1 rounded-full border border-line bg-white p-1" role="group" aria-label={content.browse_layout_label}>
                  <button
                    type="button"
                    onClick={() => changeView('grid')}
                    aria-pressed={effectiveView === 'grid'}
                    aria-label={content.browse_view_grid}
                    className={cn('flex h-7 w-7 items-center justify-center rounded-full transition', effectiveView === 'grid' ? 'bg-ink text-cream shadow-sm' : 'text-muted hover:text-ink')}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => changeView('list')}
                    aria-pressed={effectiveView === 'list'}
                    aria-label={content.browse_view_list}
                    className={cn('flex h-7 w-7 items-center justify-center rounded-full transition', effectiveView === 'list' ? 'bg-ink text-cream shadow-sm' : 'text-muted hover:text-ink')}
                  >
                    <Rows3 className="h-3.5 w-3.5" />
                  </button>
                  {mapEnabled && (
                    <button
                      type="button"
                      onClick={() => changeView('map')}
                      aria-pressed={effectiveView === 'map'}
                      aria-label={content.browse_view_map}
                      className={cn('flex h-7 w-7 items-center justify-center rounded-full transition', effectiveView === 'map' ? 'bg-ink text-cream shadow-sm' : 'text-muted hover:text-ink')}
                    >
                      <MapIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                <span className="flex items-center gap-2"><RotateCcw className="h-4 w-4 shrink-0" /> {error}</span>
                <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="btn btn-white btn-sm">{content.browse_retry}</button>
              </div>
            )}

            {loading ? (
              <div className={cn('grid gap-4', effectiveView === 'list' ? 'grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-3')}>
                {[1, 2, 3, 4, 5, 6].map((item) => (
                  <div key={item} className={cn('overflow-hidden rounded-3xl border border-line bg-white', effectiveView === 'list' && 'sm:flex')}>
                    <Skeleton className={cn('rounded-none', effectiveView === 'list' ? 'aspect-[16/10] sm:w-[38%]' : 'aspect-[16/10]')} />
                    <div className={cn('space-y-3 p-5', effectiveView === 'list' && 'flex-1')}><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-9 w-full" /></div>
                  </div>
                ))}
              </div>
            ) : null}

            {!loading && effectiveView === 'map' && vehicles.length > 0 && (
              <div className="mb-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="relative min-h-[21rem] overflow-hidden rounded-3xl bg-ink p-5 text-cream sm:min-h-[25rem]">
                  <div className="absolute inset-0 bg-grain opacity-40" />
                  <div
                    className="absolute inset-0 opacity-25"
                    style={{
                      backgroundImage: 'linear-gradient(rgba(217,247,95,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(217,247,95,0.16) 1px, transparent 1px)',
                      backgroundSize: '58px 58px',
                    }}
                  />
                  <svg className="absolute inset-0 h-full w-full opacity-25" viewBox="0 0 600 400" fill="none" aria-hidden="true">
                    <path d="M86 310C150 248 182 196 262 162S398 126 492 56" stroke="#D9F75F" strokeWidth="1.5" strokeDasharray="5 7" />
                    <path d="M64 120C142 142 200 98 264 120S386 226 532 190" stroke="#D9F75F" strokeWidth="1" strokeDasharray="3 8" />
                  </svg>

                  <div className="relative z-10 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-cream/55">{content.browse_map_title}</p>
                      <p className="mt-1 truncate text-lg font-extrabold tracking-tight sm:text-xl">
                        {selectedHub ? selectedHub.city : `${vehicles.length} ${kindLabel} ready`}
                      </p>
                      <p className="mt-0.5 truncate text-[0.62rem] text-cream/50">
                        {shortDate(trip.from)} – {shortDate(trip.to)} · {selectedHub ? selectedHub.name : 'All hubs'}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-line bg-white/85 px-2.5 py-1 text-[0.55rem] font-extrabold uppercase tracking-[0.08em] text-muted" role="status" aria-live="polite">
                      {loading ? 'Checking availability…' : `${selectedHub ? visibleVehicles.length : vehicles.length} matching`}
                    </span>
                  </div>

                  <div className="absolute inset-x-3 bottom-[4.5rem] top-[5.5rem]">
                    {mapPins.map((hub) => {
                      const active = filters.location === hub.name;
                      return (
                        <button
                          key={hub.id}
                          type="button"
                          onClick={() => update('location', active ? '' : hub.name)}
                          aria-pressed={active}
                          aria-label={`${hub.name}: ${hub.count} ${hub.count === 1 ? kindSingular : kindLabel} available`}
                          className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
                          style={{ left: hub.left, top: hub.top }}
                        >
                          {active && <span className="absolute inset-0 -m-3 animate-ping rounded-full bg-lime/20" />}
                          <span className={cn(
                            'relative flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5 text-[0.56rem] font-extrabold shadow-[0_0_0_4px_rgba(10,15,11,0.35)] transition group-hover:scale-110 group-focus-visible:scale-110',
                            active
                              ? 'border-lime bg-lime text-ink'
                              : hub.count
                                ? 'border-lime/50 bg-ink/90 text-lime'
                                : 'border-white/20 bg-ink/80 text-cream/40'
                          )}>
                            {hub.count}
                          </span>
                          <span className={cn(
                            'pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-ink/95 px-2 py-0.5 text-[0.55rem] font-bold text-cream opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100',
                            active && 'opacity-100'
                          )}>
                            {hub.city}
                          </span>
                        </button>
                      );
                    })}

                    {mapPins.length === 0 && (
                      <div className="flex h-full items-center justify-center px-6 text-center">
                        <p className="max-w-xs text-xs leading-5 text-cream/60">{content.browse_map_missing}</p>
                      </div>
                    )}
                  </div>

                  <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.55rem] font-bold uppercase tracking-[0.16em] text-cream/45">{content.browse_map_selected}</p>
                      <p className="mt-0.5 truncate text-sm font-extrabold">{selectedHub ? selectedHub.name : content.browse_map_all_hubs}</p>
                    </div>
                    {selectedHub && (
                      <button
                        type="button"
                        onClick={() => update('location', '')}
                        className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[0.6rem] font-extrabold text-cream backdrop-blur transition hover:bg-white hover:text-ink"
                      >
                        {content.browse_map_all_hubs}
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-line bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[0.56rem] font-bold uppercase tracking-[0.14em] text-muted">{content.browse_map_coverage}</p>
                      <p className="text-sm font-extrabold">{selectedHub ? selectedHub.city : content.browse_map_all_hubs}</p>
                    </div>
                    <span className="shrink-0 text-[0.6rem] font-semibold text-muted">{hubStats.length} hubs</span>
                  </div>
                  <div className="mt-3 max-h-[17.5rem] space-y-1.5 overflow-y-auto pr-1 sm:max-h-[21.5rem]">
                    {hubStats.map((hub) => {
                      const active = filters.location === hub.name;
                      return (
                        <button
                          key={hub.id}
                          type="button"
                          onClick={() => update('location', active ? '' : hub.name)}
                          aria-pressed={active}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                            active ? 'border-ink bg-ink text-cream' : 'border-line bg-paper hover:border-ink'
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[0.72rem] font-extrabold">{hub.city}</span>
                            <span className={cn('block truncate text-[0.58rem]', active ? 'text-cream/55' : 'text-muted')}>{hub.name}</span>
                          </span>
                          <span className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-extrabold',
                            active ? 'bg-lime text-ink' : hub.count ? 'bg-lime/25 text-ink' : 'bg-stone-100 text-muted'
                          )}>
                            {hub.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {!loading && visibleVehicles.length === 0 && (
              <EmptyState
                icon={Search}
                title={effectiveView === 'map' && filters.location
                  ? content.browse_empty_map_title
                  : content.browse_empty_title}
                description={effectiveView === 'map' && filters.location
                  ? content.browse_empty_map_description
                  : content.browse_empty_description}
                action={effectiveView === 'map' && filters.location
                  ? <button type="button" onClick={() => update('location', '')} className="btn btn-dark"><RotateCcw className="h-4 w-4" /> {content.browse_empty_map_cta}</button>
                  : <button type="button" onClick={clearAll} className="btn btn-dark"><RotateCcw className="h-4 w-4" /> {content.browse_empty_cta}</button>}
              />
            )}

            {!loading && visibleVehicles.length > 0 && (
              <>
                <h2 className="sr-only">
                  {visibleVehicles.length} {visibleVehicles.length === 1
                    ? (filters.kind === 'bike' ? 'bike' : 'car')
                    : (filters.kind === 'bike' ? 'bikes' : 'cars')} available
                </h2>
                <div className={cn('stagger grid gap-4', effectiveView === 'list' ? 'grid-cols-1 gap-3' : 'sm:grid-cols-2 xl:grid-cols-3')}>
                  {visibleVehicles.map((vehicle) => (
                    <VehicleCard key={vehicle.id} vehicle={vehicle} search={params.toString()} variant={effectiveView === 'list' ? 'list' : 'grid'} />
                  ))}
                </div>
                <p className="mt-8 text-center text-[0.68rem] text-muted">
                  Showing {visibleVehicles.length} {kindLabel} · availability checked for {shortDate(trip.from)} – {shortDate(trip.to)}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <Drawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={content.browse_filters}
        description={content.browse_filters_description}
        width="max-w-md"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={clearAll} className="btn btn-outline flex-1">{content.browse_reset}</button>
            <button type="button" onClick={() => setFiltersOpen(false)} className="btn btn-dark flex-1">{content.browse_show_results} {visibleVehicles.length} {kindLabel}</button>
          </div>
        )}
      >
        <FilterPanel
          filters={filters}
          update={update}
          toggleType={toggleType}
          toggleFuel={toggleFuel}
          changeKind={changeKind}
          kinds={kinds}
          bounds={bounds}
          meta={meta}
          content={content}
          clearAll={clearAll}
          isFiltered={isFiltered}
          mobile
        />
      </Drawer>

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title={content.browse_search_title} description={content.browse_search_description} size="lg">
        <SearchWidget variant="compact" initial={trip} onSearch={onSearch} className="border-0 p-0 shadow-none" />
        <p className="mt-4 text-[0.68rem] leading-5 text-muted">{content.browse_search_note}</p>
      </Modal>

      <Drawer
        open={savedOpen}
        onClose={() => setSavedOpen(false)}
        title={content.saved_title}
        description={content.saved_empty_copy}
        width="max-w-md"
      >
        <form onSubmit={(event) => { event.preventDefault(); trySaveSearch(); }}>
          <label className="label" htmlFor="saved-search-name">{content.saved_name_label}</label>
          <div className="flex gap-2">
            <input
              id="saved-search-name"
              type="text"
              value={savedName}
              onChange={(event) => setSavedName(event.target.value)}
              placeholder={content.saved_name_placeholder}
              maxLength={40}
              className="field flex-1"
            />
            <button type="submit" disabled={!savedName.trim()} className="btn btn-dark btn-sm shrink-0">{content.saved_submit}</button>
          </div>
        </form>

        <div className="mt-4 space-y-2">
          {savedItems.length ? savedItems.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-paper px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.78rem] font-extrabold">{entry.label}</p>
                {entry.summary && <p className="mt-0.5 truncate text-[0.62rem] text-muted">{entry.summary}</p>}
              </div>
              <button type="button" onClick={() => applySavedSearch(entry)} className="btn btn-dark btn-sm shrink-0">
                {content.saved_apply}
              </button>
              <button
                type="button"
                onClick={() => removeSavedSearch(entry.id)}
                aria-label={`${content.saved_delete} — ${entry.label}`}
                className="rounded-full p-1.5 text-muted transition hover:bg-rose-50 hover:text-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )) : (
            <EmptyState
              icon={Bookmark}
              title={content.saved_empty}
              description={content.saved_empty_copy}
              className="py-8"
            />
          )}
        </div>
        <p className="mt-3 text-[0.62rem] text-muted">{content.saved_limit}</p>
      </Drawer>

      <CompareTray />
    </div>
  );
}

function FilterPanel({ filters, update, toggleType, toggleFuel, changeKind, kinds = VEHICLE_KINDS, bounds, meta, content, clearAll, isFiltered, mobile = false }) {
  const isBike = filters.kind === 'bike';
  return (
    <div className={cn('space-y-6', !mobile && 'rounded-3xl border border-white/80 bg-white/85 p-5 shadow-card backdrop-blur-sm')}>
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-2 text-sm font-extrabold"><Filter className="h-4 w-4" /> {content.browse_filters}</p>
        {isFiltered && <button type="button" onClick={clearAll} className="text-[0.66rem] font-bold text-rose-700">{content.browse_reset}</button>}
      </div>

      {mobile && (
        <div>
          <p className="label">{content.browse_filter_kind}</p>
          <div className="flex gap-2">
            {kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => changeKind(kind)}
                className={cn('flex-1 rounded-xl border px-2 py-2 text-[0.7rem] font-bold transition', filters.kind === kind ? 'border-ink bg-ink text-cream' : 'border-line bg-paper hover:border-ink')}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="label">{content.browse_filter_search}</p>
        <div className="input-group">
          <Search className="input-icon h-4 w-4" />
          <input
            value={filters.q}
            onChange={(event) => update('q', event.target.value)}
            placeholder={content.browse_filter_search_placeholder}
            className="field"
            aria-label={content.browse_filter_search_aria}
          />
        </div>
      </div>

      <div>
        <p className="label">{content.browse_filter_hub}</p>
        <select value={filters.location} onChange={(event) => update('location', event.target.value)} className="field">
          <option value="">{content.browse_all_hubs}</option>
          {meta.locations.map((location) => <option key={location.id} value={location.name}>{location.name}</option>)}
        </select>
      </div>

      <div>
        <p className="label">{isBike ? content.browse_filter_bike_type : content.browse_filter_body_type}</p>
        <div className="grid grid-cols-2 gap-2">
          {typesForKind(filters.kind).map((type) => (
            <label key={type} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-[0.72rem] font-semibold transition focus-within:ring-2 focus-within:ring-forest/30 focus-within:ring-offset-1', filters.type.includes(type) ? 'border-ink bg-ink text-cream' : 'border-line bg-paper hover:border-ink')}>
              <input type="checkbox" checked={filters.type.includes(type)} onChange={() => toggleType(type)} className="sr-only" />
              <span className={cn('flex h-4 w-4 items-center justify-center rounded border', filters.type.includes(type) ? 'border-lime bg-lime text-ink' : 'border-stone-300 bg-white')}>
                {filters.type.includes(type) && <Check className="h-3 w-3" />}
              </span>
              {type}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="label mb-0">{content.browse_filter_max_price}</p>
          <span className="text-[0.72rem] font-extrabold">{inr(filters.maxPrice ?? bounds.max)}</span>
        </div>
        <input
          type="range"
          min={bounds.min || 0}
          max={bounds.max || 30000}
          step={500}
          value={filters.maxPrice ?? bounds.max}
          onChange={(event) => update('maxPrice', Number(event.target.value))}
          className="w-full"
          aria-label={content.browse_filter_max_price_aria}
        />
        <div className="mt-1 flex justify-between text-[0.6rem] text-muted"><span>{inr(bounds.min)}</span><span>{inr(bounds.max)}</span></div>
      </div>

      {isBike ? (
        <>
          <div>
            <p className="label">{content.browse_filter_gears}</p>
            <div className="flex gap-2">
              {BIKE_GEARS.map((gear) => (
                <button
                  key={gear}
                  type="button"
                  onClick={() => update('gears', filters.gears === gear ? '' : gear)}
                  className={cn('flex-1 rounded-xl border px-2 py-2 text-[0.7rem] font-bold transition', filters.gears === gear ? 'border-ink bg-ink text-cream' : 'border-line bg-paper hover:border-ink')}
                >
                  {gear}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label">{content.browse_filter_engine}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 110, 160, 250].map((cc) => (
                <button
                  key={cc}
                  type="button"
                  onClick={() => update('engineCc', filters.engineCc === String(cc) ? '' : String(cc))}
                  className={cn('rounded-xl border py-2 text-[0.7rem] font-bold transition', filters.engineCc === String(cc) ? 'border-ink bg-ink text-cream' : 'border-line bg-paper hover:border-ink')}
                >
                  {cc ? `${cc}+` : content.browse_filter_any}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <p className="label">{content.browse_filter_transmission}</p>
            <div className="flex gap-2">
              {TRANSMISSIONS.map((transmission) => (
                <button
                  key={transmission}
                  type="button"
                  onClick={() => update('transmission', filters.transmission === transmission ? '' : transmission)}
                  className={cn('flex-1 rounded-xl border px-2 py-2 text-[0.7rem] font-bold transition', filters.transmission === transmission ? 'border-ink bg-ink text-cream' : 'border-line bg-paper hover:border-ink')}
                >
                  {transmission}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label">{content.browse_filter_seats}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {[2, 4, 5, 7].map((seats) => (
                <button
                  key={seats}
                  type="button"
                  onClick={() => update('seats', filters.seats === String(seats) ? '' : String(seats))}
                  className={cn('rounded-xl border py-2 text-[0.7rem] font-bold transition', filters.seats === String(seats) ? 'border-ink bg-ink text-cream' : 'border-line bg-paper hover:border-ink')}
                >
                  {seats}+
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div>
        <p className="label">{content.browse_filter_fuel}</p>
        <div className="grid grid-cols-2 gap-2">
          {(FUELS_BY_KIND[filters.kind] ?? []).map((fuel) => (
            <label key={fuel} className={cn('flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-[0.72rem] font-semibold transition focus-within:ring-2 focus-within:ring-forest/30 focus-within:ring-offset-1', filters.fuel.includes(fuel) ? 'border-ink bg-ink text-cream' : 'border-line bg-paper hover:border-ink')}>
              <input type="checkbox" checked={filters.fuel.includes(fuel)} onChange={() => toggleFuel(fuel)} className="sr-only" />
              <span className={cn('flex h-4 w-4 items-center justify-center rounded border', filters.fuel.includes(fuel) ? 'border-lime bg-lime text-ink' : 'border-stone-300 bg-white')}>
                {filters.fuel.includes(fuel) && <Check className="h-3 w-3" />}
              </span>
              {fuel}
            </label>
          ))}
        </div>
      </div>

      {!isBike && (
        <div className="rounded-xl border border-line bg-paper p-3">
          <Toggle
            checked={filters.awd}
            onChange={(value) => update('awd', value)}
            label={content.browse_filter_awd_label}
            description={content.browse_filter_awd_description}
          />
        </div>
      )}

      <div className="rounded-xl bg-lime/25 p-3 text-[0.66rem] leading-5 text-ink/70">
        {isBike ? content.browse_filter_tip_bike : content.browse_filter_tip_car}
      </div>
    </div>
  );
}
