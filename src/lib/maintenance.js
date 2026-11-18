import { addDaysISO, daysBetween, isValidDate, todayISO } from './pricing.js';
import { financialYearStart } from './finance.js';

/**
 * Fleet maintenance domain logic.
 *
 * The model is intentionally simple: every vehicle carries a current odometer
 * and the baseline of its last service. Work is recorded as immutable service
 * logs. A service resets the baseline, while repairs and bodywork keep the
 * existing service interval running. Workshop downtime itself lives in the
 * existing vehicle blocks, so the availability calendar remains the single
 * source of truth for dates a vehicle cannot be rented.
 */

export const SERVICE_KINDS = Object.freeze([
  { key: 'service', label: 'Scheduled service', resets: true },
  { key: 'inspection', label: 'Inspection', resets: true },
  { key: 'tyre', label: 'Tyres & brakes', resets: true },
  { key: 'repair', label: 'Repair', resets: false },
  { key: 'bodywork', label: 'Bodywork', resets: false },
]);

export const SERVICE_KIND_KEYS = Object.freeze(SERVICE_KINDS.map((kind) => kind.key));

export const SERVICE_BANDS = Object.freeze({
  overdue: { label: 'Overdue', tone: 'bad' },
  due: { label: 'Due soon', tone: 'warn' },
  watch: { label: 'Watch', tone: 'info' },
  fresh: { label: 'Healthy', tone: 'ok' },
  untracked: { label: 'Needs baseline', tone: 'muted' },
});

export const DEFAULT_SERVICE_INTERVAL_KM = 10000;
export const DEFAULT_SERVICE_INTERVAL_DAYS = 180;
export const DEFAULT_BIKE_SERVICE_INTERVAL_KM = 4000;
export const DEFAULT_BIKE_SERVICE_INTERVAL_DAYS = 120;

const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
};

const nonNegative = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

/** Resolve the service interval configured on a vehicle, with bike-aware defaults. */
export function serviceIntervals(vehicle = {}) {
  const isBike = vehicle.kind === 'bike';
  return {
    km: positive(vehicle.serviceIntervalKm, isBike ? DEFAULT_BIKE_SERVICE_INTERVAL_KM : DEFAULT_SERVICE_INTERVAL_KM),
    days: positive(vehicle.serviceIntervalDays, isBike ? DEFAULT_BIKE_SERVICE_INTERVAL_DAYS : DEFAULT_SERVICE_INTERVAL_DAYS),
  };
}

/** Latest resetting log, used when a vehicle row has no explicit baseline. */
export function latestServiceReset(logs = []) {
  return (Array.isArray(logs) ? logs : [])
    .filter((log) => log && log.resetsService !== false && isValidDate(log.serviceDate))
    .sort((a, b) => String(b.serviceDate).localeCompare(String(a.serviceDate))
      || Number(b.odometer || 0) - Number(a.odometer || 0))[0] ?? null;
}

function baselineFor(vehicle = {}, logs = []) {
  const fallback = latestServiceReset(logs);
  const date = isValidDate(vehicle.lastServiceDate)
    ? vehicle.lastServiceDate
    : (fallback?.serviceDate ?? null);
  const odometer = nonNegative(vehicle.lastServiceOdometer) ?? nonNegative(fallback?.odometer);
  return { date, odometer };
}

export function serviceBand(progress = 0) {
  if (!Number.isFinite(progress)) return 'untracked';
  if (progress >= 1) return 'overdue';
  if (progress >= 0.85) return 'due';
  if (progress >= 0.65) return 'watch';
  return 'fresh';
}

/**
 * Real service-due state for one vehicle. `progress` is the larger of the
 * kilometre and calendar wear, so whichever limit arrives first wins.
 */
export function serviceStatus(vehicle = {}, { logs = [], today = todayISO() } = {}) {
  const intervals = serviceIntervals(vehicle);
  const baseline = baselineFor(vehicle, logs);
  const odometer = nonNegative(vehicle.odometer);
  const tracked = odometer !== null && baseline.odometer !== null && Boolean(baseline.date);

  if (!tracked) {
    return {
      tracked: false,
      band: 'untracked',
      label: SERVICE_BANDS.untracked.label,
      progress: 0,
      score: 0,
      odometer,
      intervalKm: intervals.km,
      intervalDays: intervals.days,
      lastServiceDate: baseline.date,
      lastServiceOdometer: baseline.odometer,
      kmSinceService: null,
      daysSinceService: null,
      kmRemaining: null,
      daysRemaining: null,
      dueDate: null,
      dueOdometer: null,
      reason: 'Add an odometer and a last-service baseline to start tracking.',
    };
  }

  const kmSinceService = Math.max(0, odometer - baseline.odometer);
  const daysSinceService = Math.max(0, daysBetween(baseline.date, today));
  const kmProgress = kmSinceService / intervals.km;
  const dayProgress = daysSinceService / intervals.days;
  const progress = Math.max(kmProgress, dayProgress);
  const band = serviceBand(progress);
  const kmRemaining = Math.max(0, intervals.km - kmSinceService);
  const daysRemaining = intervals.days - daysSinceService;

  // Say how far over the limit a vehicle is, not just that it is over. The
  // board already shows "0 km left" once the interval is exceeded, so the
  // magnitude has to live in the reason line to be actionable.
  const kmOver = Math.max(0, kmSinceService - intervals.km);
  const daysOver = Math.max(0, daysSinceService - intervals.days);
  const reasons = [];
  if (band === 'overdue') {
    if (kmOver > 0 && daysOver > 0) {
      reasons.push(`Service overdue by ${kmOver.toLocaleString('en-IN')} km and ${daysOver} day${daysOver === 1 ? '' : 's'}`);
    } else if (kmOver > 0) {
      reasons.push(`Service overdue by ${kmOver.toLocaleString('en-IN')} km`);
    } else {
      reasons.push(`Service overdue by ${daysOver} day${daysOver === 1 ? '' : 's'}`);
    }
  } else if (band === 'due') {
    reasons.push(kmProgress >= dayProgress
      ? `${kmRemaining.toLocaleString('en-IN')} km to the service interval`
      : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} to the service date`);
  } else if (band === 'watch') {
    reasons.push('Inside the service planning window');
  } else {
    reasons.push('Within both service intervals');
  }

  return {
    tracked: true,
    band,
    label: SERVICE_BANDS[band].label,
    progress: Math.round(progress * 100),
    score: Math.min(999, Math.round(progress * 100)),
    odometer,
    intervalKm: intervals.km,
    intervalDays: intervals.days,
    lastServiceDate: baseline.date,
    lastServiceOdometer: baseline.odometer,
    kmSinceService,
    daysSinceService,
    kmRemaining,
    daysRemaining,
    dueDate: addDaysISO(baseline.date, intervals.days),
    dueOdometer: baseline.odometer + intervals.km,
    reason: reasons[0],
  };
}

/** Service board rows for every vehicle, most urgent first. */
export function serviceBoard(vehicles = [], { logs = [], today = todayISO() } = {}) {
  const logsByVehicle = new Map();
  (Array.isArray(logs) ? logs : []).forEach((log) => {
    if (!log?.vehicleId) return;
    const list = logsByVehicle.get(log.vehicleId) ?? [];
    list.push(log);
    logsByVehicle.set(log.vehicleId, list);
  });

  const bandOrder = { overdue: 0, due: 1, watch: 2, fresh: 3, untracked: 4 };
  return (Array.isArray(vehicles) ? vehicles : [])
    .map((vehicle) => {
      const vehicleLogs = logsByVehicle.get(vehicle.id) ?? [];
      const status = serviceStatus(vehicle, {
        logs: vehicleLogs,
        today,
      });
      return {
        id: vehicle.id,
        name: vehicle.name,
        brand: vehicle.brand,
        kind: vehicle.kind ?? 'car',
        type: vehicle.type,
        location: vehicle.location,
        imageUrl: vehicle.imageUrl,
        status: vehicle.status,
        year: vehicle.year,
        spend: vehicleLogs.reduce((sum, log) => sum + (Number(log.cost) || 0), 0),
        visits: vehicleLogs.length,
        lastServiceCost: latestServiceReset(vehicleLogs)?.cost ?? 0,
        ...status,
      };
    })
    .sort((a, b) => (bandOrder[a.band] ?? 9) - (bandOrder[b.band] ?? 9)
      || b.progress - a.progress
      || String(a.name).localeCompare(String(b.name)));
}

export function serviceBoardStats(rows = []) {
  const count = (band) => rows.filter((row) => row.band === band).length;
  return {
    total: rows.length,
    overdue: count('overdue'),
    due: count('due'),
    watch: count('watch'),
    fresh: count('fresh'),
    untracked: count('untracked'),
    tracked: rows.filter((row) => row.tracked).length,
    inWorkshop: rows.filter((row) => row.status === 'maintenance').length,
  };
}

/**
 * Validate a service log entry. Returns `{ ok, problem, value }`, where value
 * is a clean payload safe to persist. The same function powers demo and live
 * adapters, so both reject exactly the same entries.
 */
export function serviceEntry(payload = {}, vehicle = {}, { today = todayISO() } = {}) {
  const serviceDate = String(payload.serviceDate ?? '').slice(0, 10);
  if (!vehicle?.id) return { ok: false, problem: 'Choose a vehicle to service.' };
  if (!isValidDate(serviceDate)) return { ok: false, problem: 'Choose a valid service date.' };
  if (serviceDate > today) return { ok: false, problem: 'Service date cannot be in the future.' };

  const odometer = nonNegative(payload.odometer);
  if (odometer === null) return { ok: false, problem: 'Enter the odometer reading in kilometres.' };
  if (odometer > 2000000) return { ok: false, problem: 'Keep the odometer under 20,00,000 km.' };
  const currentOdometer = nonNegative(vehicle.odometer);
  if (currentOdometer !== null && odometer < currentOdometer) {
    return { ok: false, problem: `Odometer cannot be lower than the current reading (${currentOdometer.toLocaleString('en-IN')} km).` };
  }

  const kind = SERVICE_KIND_KEYS.includes(payload.kind) ? payload.kind : 'service';
  const cost = Number(payload.cost);
  if (!Number.isFinite(cost) || cost < 0) return { ok: false, problem: 'Enter a valid cost (₹0 or more).' };
  if (cost > 10000000) return { ok: false, problem: 'Keep the service cost under ₹1,00,00,000.' };

  const vendor = String(payload.vendor ?? '').trim().slice(0, 80);
  const reference = String(payload.reference ?? '').trim().slice(0, 60);
  const notes = String(payload.notes ?? '').trim().slice(0, 600);
  const kindMeta = SERVICE_KINDS.find((item) => item.key === kind);
  const resetsService = payload.resetsService === undefined
    ? Boolean(kindMeta?.resets)
    : Boolean(payload.resetsService);

  return {
    ok: true,
    problem: null,
    value: {
      serviceDate,
      odometer,
      kind,
      cost: Math.round(cost),
      vendor,
      reference,
      notes,
      resetsService,
    },
  };
}

/** Pure vehicle update after a service entry is accepted. */
export function applyServiceEntry(vehicle = {}, entry = {}) {
  const odometer = Math.max(
    nonNegative(vehicle.odometer) ?? 0,
    nonNegative(entry.odometer) ?? 0,
  );
  const next = { ...vehicle, odometer };
  if (entry.resetsService) {
    // Backfilling an older service must never move the baseline backwards —
    // the SQL trigger applies the same rule, so demo and Supabase stay in step.
    const current = isValidDate(vehicle.lastServiceDate) ? vehicle.lastServiceDate : null;
    if (!current || entry.serviceDate >= current) {
      next.lastServiceDate = entry.serviceDate;
      next.lastServiceOdometer = entry.odometer;
    }
  }
  return next;
}

export function odometerProblem(value, vehicle = {}) {
  const odometer = nonNegative(value);
  if (odometer === null) return 'Enter the odometer reading in kilometres.';
  const current = nonNegative(vehicle.odometer);
  if (current !== null && odometer < current) {
    return `Odometer cannot be lower than the current reading (${current.toLocaleString('en-IN')} km).`;
  }
  if (odometer > 2000000) return 'Keep the odometer under 20,00,000 km.';
  return null;
}

const monthKey = (date) => String(date ?? '').slice(0, 7);
const monthLabel = (key) => {
  const [year, month] = String(key).split('-').map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
};

function lastMonths(today, count = 6) {
  const [year, month] = today.split('-').map(Number);
  const keys = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(year, month - 1 - index, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

/**
 * Aggregated maintenance analytics for the admin dashboard and analytics page.
 * Downtime is read from maintenance blocks, never from service logs, so the
 * calendar remains the only place staff schedule vehicle unavailability.
 */
export function maintenanceSummary(vehicles = [], logs = [], blocks = [], today = todayISO()) {
  const rows = serviceBoard(vehicles, { logs, today });
  const stats = serviceBoardStats(rows);
  const month = today.slice(0, 7);
  const ninetyDaysAgo = addDaysISO(today, -90);
  // The finance module runs on the Indian financial year (Apr–Mar); "YTD" on
  // this page must use the same boundary or the two dashboards disagree.
  const fyStart = financialYearStart(today);

  const safeLogs = (Array.isArray(logs) ? logs : [])
    .filter((log) => log && isValidDate(log.serviceDate))
    .sort((a, b) => String(b.serviceDate).localeCompare(String(a.serviceDate)));

  const spend = safeLogs.reduce((sum, log) => sum + (Number(log.cost) || 0), 0);
  const spendYtd = safeLogs
    .filter((log) => log.serviceDate >= fyStart && log.serviceDate <= today)
    .reduce((sum, log) => sum + (Number(log.cost) || 0), 0);
  const spendMonth = safeLogs
    .filter((log) => String(log.serviceDate).startsWith(month))
    .reduce((sum, log) => sum + (Number(log.cost) || 0), 0);
  const spend90 = safeLogs
    .filter((log) => log.serviceDate >= ninetyDaysAgo && log.serviceDate <= today)
    .reduce((sum, log) => sum + (Number(log.cost) || 0), 0);

  const byKind = SERVICE_KINDS.map((kind) => {
    const kindLogs = safeLogs.filter((log) => log.kind === kind.key);
    return {
      key: kind.key,
      label: kind.label,
      visits: kindLogs.length,
      cost: kindLogs.reduce((sum, log) => sum + (Number(log.cost) || 0), 0),
    };
  }).filter((row) => row.visits > 0).sort((a, b) => b.cost - a.cost);

  const vendorMap = new Map();
  safeLogs.forEach((log) => {
    const vendor = String(log.vendor ?? '').trim() || 'Unassigned workshop';
    const entry = vendorMap.get(vendor) ?? { label: vendor, visits: 0, cost: 0 };
    entry.visits += 1;
    entry.cost += Number(log.cost) || 0;
    vendorMap.set(vendor, entry);
  });
  const vendors = [...vendorMap.values()].sort((a, b) => b.cost - a.cost).slice(0, 8);

  const monthly = lastMonths(today, 6).map((key) => {
    const monthLogs = safeLogs.filter((log) => monthKey(log.serviceDate) === key);
    return {
      key,
      label: monthLabel(key),
      cost: monthLogs.reduce((sum, log) => sum + (Number(log.cost) || 0), 0),
      visits: monthLogs.length,
    };
  });

  const maintenanceBlocks = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.kind === 'maintenance' && block.startDate < addDaysISO(today, 31) && block.endDate > today);

  const downtimeDays = maintenanceBlocks.reduce((sum, block) => {
    const start = block.startDate > today ? block.startDate : today;
    const end = block.endDate < addDaysISO(today, 31) ? block.endDate : addDaysISO(today, 31);
    return sum + Math.max(0, daysBetween(start, end));
  }, 0);

  return {
    ...stats,
    spend,
    spendYtd,
    spendMonth,
    spend90,
    visits: safeLogs.length,
    avgCost: safeLogs.length ? Math.round(spend / safeLogs.length) : 0,
    byKind,
    vendors,
    monthly,
    upcomingWorkshop: maintenanceBlocks.length,
    downtimeDays,
    attention: rows.filter((row) => ['overdue', 'due'].includes(row.band)).slice(0, 8),
    rows,
  };
}
