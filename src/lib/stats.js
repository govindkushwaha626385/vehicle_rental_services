import { addDaysISO, daysBetween, isValidDate, todayISO } from './pricing.js';
import { localDay, monthLabel, shortDate } from './format.js';
import { BIKE_TYPES, BOOKING_STATUSES } from './constants.js';
import { returnForecast, returnTimeliness, returnsSummary, isReturnOpen, lateDays, lateReturnsByVehicle } from './returns.js';
import { availabilityBoard, waitlistSummary } from './availabilityAlerts.js';
import { maintenanceSummary } from './maintenance.js';
import { fleetDocuments } from './fleetDocs.js';
import { fleetRadar, fleetRadarStats } from './fleetHealth.js';
import { kmSummary } from './km.js';
import { reviewSummary } from './reviews.js';

const monthKeys = (count = 6) => {
  const keys = [];
  const now = new Date();
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    keys.push(key);
  }
  return keys;
};

const localISO = (date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

/**
 * Calendar day for a timestamp in the viewer's local day.
 *
 * `createdAt` and payment timestamps are UTC ISO strings while the daily
 * buckets are built from local dates. Slicing the UTC string would push a
 * 00:30 IST booking into the previous day's chart and overstate its lead time
 * by one day. Date-only strings pass through unchanged.
 */
const dayOf = (value) => {
  const text = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text.slice(0, 10) : localISO(date);
};

const addDate = (iso, days) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localISO(date);
};

/** Bucket a 24-hour clock into the demand slot used by the heatmaps. */
const slotForHour = (hour) => {  const value = Number(hour);
  if (!Number.isFinite(value)) return 'early';
  if (value >= 21 || value < 6) return 'night';
  if (value >= 17) return 'evening';
  if (value >= 12) return 'afternoon';
  if (value >= 9) return 'morning';
  return 'early';
};

/** Last n ISO dates ending today. */
const dayKeys = (count = 30, todayArg = new Date()) => {
  const keys = [];
  const now = typeof todayArg === 'string' ? new Date(`${todayArg}T00:00:00`) : todayArg;
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - index);
    keys.push(localISO(date));
  }
  return keys;
};

/** Scale a series and compute tidy chart ticks without ever dividing by zero. */
export function chartNormalize(values = [], steps = 4) {
  const clean = values.map((value) => (Number.isFinite(value) ? value : 0));
  const max = clean.length ? Math.max(...clean) : 0;
  const scale = max > 0 ? max : 1;
  const ticks = [];
  for (let index = 0; index <= steps; index += 1) {
    ticks.push((max / steps) * index);
  }
  return { values: clean, max, scale, ticks };
}

const roundInt = (value) => (Number.isFinite(value) ? Math.round(value) : 0);

const percentOf = (part, whole) => {
  if (!whole) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
};

/**
 * Cumulative booking funnel from current status counts.
 *
 * A completed trip passed through confirmed and started on the way, so the
 * stages must be cumulative — otherwise the bars exceed 100% whenever fewer
 * requests are pending than have completed. Cancelled and rejected requests
 * only count at the requested stage because we do not store status history.
 */
export function bookingFunnel(conversion = {}) {
  const count = (status) => Number(conversion?.[status]) || 0;
  return {
    requested: BOOKING_STATUSES.reduce((sum, status) => sum + count(status), 0),
    confirmed: count('confirmed') + count('active') + count('completed'),
    active: count('active') + count('completed'),
    completed: count('completed'),
  };
}

/**
 * Book-ahead buckets for the lead-time distribution. The upper bound is
 * inclusive; a 14-day lead falls in "1–2 weeks".
 */
const LEAD_BUCKETS = Object.freeze([
  { label: 'Same day', max: 0 },
  { label: '1–3 days', max: 3 },
  { label: '4–7 days', max: 7 },
  { label: '1–2 weeks', max: 14 },
  { label: '2–4 weeks', max: 30 },
  { label: '1–3 months', max: 90 },
  { label: '3+ months', max: Infinity },
]);

/**
 * Abandoned-checkout recovery. Attempts carry the intent created when a
 * customer opens payment: vehicle, dates and the amount they were about to
 * pay. Converted attempts (a booking followed) are excluded; the remainder is
 * a sales pipeline the operator can call back. Created timestamps resolve to
 * the local calendar day so a 00:30 IST drop-off lands on the right bucket.
 */
export function checkoutSummary(attempts = [], today = todayISO()) {
  const thirtyDaysAgo = addDaysISO(today, -30);
  const yesterday = addDaysISO(today, -1);
  const amount = (attempt) => Math.max(0, Number(attempt.amountDue ?? attempt.total ?? 0));
  const list = (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => attempt && attempt.vehicleId && !attempt.convertedAt)
    .map((attempt) => ({ ...attempt, amount: amount(attempt), day: localDay(attempt.createdAt) }))
    .filter((attempt) => attempt.day >= thirtyDaysAgo);
  return {
    count30d: list.length,
    value30d: list.reduce((sum, attempt) => sum + attempt.amount, 0),
    count24h: list.filter((attempt) => attempt.day >= yesterday).length,
    recent: [...list]
      .sort((a, b) => (b.amount - a.amount) || String(b.day).localeCompare(String(a.day)))
      .slice(0, 5),
  };
}

/**
 * Trip-extension summary: how often customers (or the desk) moved a return
 * later and how much revenue those extra days added. Read from the booking's
 * append-only tripChanges so waivers, cancellations and re-quotes never blur
 * the count.
 */
export function extensionSummary(bookings = []) {
  const events = (Array.isArray(bookings) ? bookings : [])
    .flatMap((booking) => (Array.isArray(booking.tripChanges) ? booking.tripChanges : [])
      .filter((entry) => entry?.type === 'extension')
      .map((entry) => ({ ...entry, delta: Number(entry.delta) || 0 })));
  const months = monthKeys(6);
  return {
    count: events.length,
    revenueDelta: events.reduce((sum, entry) => sum + entry.delta, 0),
    byMonth: months.map((month) => ({
      label: month,
      value: events
        .filter((entry) => String(entry.at).slice(0, 7) === month)
        .reduce((sum, entry) => sum + entry.delta, 0),
    })),
    recent: [...events]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 5)
      .map((entry) => ({
        at: entry.at,
        by: entry.by,
        summary: entry.summary,
        delta: entry.delta,
      })),
  };
}

/**
 * Fleet utilisation, day by day, for the last `days` calendar days.
 *
 * A vehicle counts as occupied on day D when a `confirmed` or `active` booking
 * covers it (half-open window `startDate <= D < endDate`), which is exactly
 * what the forward-looking dashboard KPI assumes — cancelled/rejected freed the
 * vehicle, maintenance removes capacity entirely. The result is a percentage of
 * the bookable fleet per day, so historic demand pressure is as easy to read as
 * the 30-day-forward utilisation bar.
 */
export function utilizationSeries(bookings = [], vehicles = [], { days = 90, today = todayISO() } = {}) {
  const keys = dayKeys(days, today);
  const bookable = (Array.isArray(vehicles) ? vehicles : []).filter((vehicle) => vehicle.status !== 'maintenance').length;
  if (!bookable) return keys.map((date) => ({ date, label: shortDate(date), value: 0 }));
  const occupied = new Map(keys.map((date) => [date, new Set()]));
  const fleet = new Map(
    (Array.isArray(vehicles) ? vehicles : []).map((vehicle) => [vehicle.id, vehicle.status]),
  );
  (Array.isArray(bookings) ? bookings : []).forEach((booking) => {
    if (!['confirmed', 'active'].includes(booking.status)) return;
    const vehicleId = booking.vehicle?.id || booking.vehicleId;
    if (!vehicleId || fleet.get(vehicleId) === 'maintenance') return;
    const date = booking.startDate || '';
    let cursor = date;
    const end = booking.endDate || date;
    // Date keys are ASCII-sortable ISO strings.
    while (cursor && cursor < end) {
      const bucket = occupied.get(cursor);
      if (bucket) bucket.add(vehicleId);
      cursor = addDate(cursor, 1);
    }
  });
  return keys.map((date) => ({
    date,
    label: shortDate(date),
    value: Math.min(100, Math.round((occupied.get(date).size / bookable) * 100)),
  }));
}

/**
 * Peak-season readiness: how available the fleet is during the admin-configured
 * festive window (or a sensible default), and which vehicles pose a risk.
 *
 * A vehicle counts as spoken-for on day D when a confirmed/active booking covers
 * it (half-open window), or a maintenance block does. A vehicle in the
 * maintenance state removes capacity entirely. The result reconciles with
 * utilisation by construction: same statuses, same window semantics.
 *
 * `windowFor` injectable so adapters and tests keep the calendar deterministic;
 * returns `null` when no window applies.
 */
export function seasonalReadiness(
  bookings = [],
  vehicles = [],
  blocks = [],
  { start = '', end = '', today = todayISO() } = {},
) {
  const from = String(start || '').trim();
  const to = String(end || '').trim();
  // No configured (or already-past) window → nothing to prepare for.
  if (!from || !to || from > to || to < today) {
    return null;
  }
  const fleet = (Array.isArray(vehicles) ? vehicles : []).filter(
    (vehicle) => vehicle.status !== 'maintenance',
  );
  if (!fleet.length) return null;

  const spokenFor = (booking) => ['confirmed', 'active'].includes(booking.status);
  const overlapsWindow = (startDate, endDate) =>
    Boolean(startDate && endDate && startDate <= to && endDate > from);

  const busy = new Map(fleet.map((vehicle) => [vehicle.id, false]));
  (Array.isArray(bookings) ? bookings : [])
    .filter((booking) => spokenFor(booking) && overlapsWindow(booking.startDate, booking.endDate))
    .forEach((booking) => {
      const id = booking.vehicle?.id || booking.vehicleId;
      if (id && busy.has(id)) busy.set(id, true);
    });

  // Maintenance blocks also claim a vehicle (server keeps stock off the board).
  (Array.isArray(blocks) ? blocks : [])
    .filter((block) => overlapsWindow(block.startDate, block.endDate))
    .forEach((block) => {
      // Some adapters nest vehicle; demo passes plain vehicleId.
      const id = block.vehicle?.id || block.vehicleId;
      if (id && busy.has(id)) busy.set(id, true);
    });

  const held = [...busy.keys()].filter((id) => busy.get(id));
  const available = fleet.filter((vehicle) => !busy.get(vehicle.id));
  const capacity = fleet.length;
  const heldCount = held.length;

  // Risk = vehicles that genuinely cannot serve the peak because they are in
  // the workshop (server keeps maintenance stock off the board). A vehicle that
  // is merely *booked for* the window is already revenue — it belongs in the
  // held list, not the risk list — so those two signals never double-count.
  const risk = (Array.isArray(vehicles) ? vehicles : [])
    .filter((vehicle) => vehicle.status === 'maintenance')
    .map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name || 'Vehicle',
      status: vehicle.status,
      booked: false,
    }));

  return {
    start: from,
    end: to,
    capacity,
    heldCount,
    availableCount: available.length,
    availabilityPct: Math.round((available.length / capacity) * 100),
    booked: held.length,
    topHeld: fleet
      .filter((vehicle) => busy.get(vehicle.id))
      .sort((a, b) => ((a.name || '').localeCompare(b.name || '')))
      .slice(0, 6)
      .map((vehicle) => vehicle.name || 'Vehicle'),
    atRisk: risk.slice(0, 5),
  };
}

export function computeAdminStats(bookings = [], vehicles = [], users = [], blocks = [], serviceLogs = [], checkoutAttempts = [], reviews = [], settings = {}) {
  const today = todayISO();
  const currentMonth = today.slice(0, 7);
  const thisMonthKeys = monthKeys(6);
  const previousMonth = thisMonthKeys[thisMonthKeys.length - 2];

  const completed = bookings.filter((booking) => booking.status === 'completed');
  const revenue = completed.reduce((sum, booking) => sum + (Number(booking.total) || 0), 0);
  const revenueThisMonth = completed
    .filter((booking) => booking.startDate?.startsWith(currentMonth))
    .reduce((sum, booking) => sum + (Number(booking.total) || 0), 0);
  const revenueLastMonth = completed
    .filter((booking) => booking.startDate?.startsWith(previousMonth))
    .reduce((sum, booking) => sum + (Number(booking.total) || 0), 0);

  const monthly = thisMonthKeys.map((key) => {
    const rows = completed.filter((booking) => booking.startDate?.startsWith(key));
    return {
      key,
      label: monthLabel(key),
      revenue: rows.reduce((sum, booking) => sum + (Number(booking.total) || 0), 0),
      trips: rows.length,
    };
  });

  const statusCounts = Object.fromEntries(BOOKING_STATUSES.map((status) => [status, 0]));
  bookings.forEach((booking) => {
    if (statusCounts[booking.status] !== undefined) statusCounts[booking.status] += 1;
  });

  // A confirmed booking that never started is a no-show — the pick-up date has
  // passed but staff have not marked it active. Read-only: surfacing it is the
  // desk's job, never an automatic cancellation.
  const noShows = bookings
    .filter((booking) => booking.status === 'confirmed' && String(booking.startDate || '') < today)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

  const bookableFleet = vehicles.filter((vehicle) => vehicle.status !== 'maintenance');
  const utilizationByVehicle = bookableFleet.map((vehicle) => {
    let days = 0;
    bookings
      .filter((booking) => booking.vehicle?.id === vehicle.id && ['confirmed', 'active'].includes(booking.status))
      .forEach((booking) => {
        const start = Math.max(0, daysBetween(today, booking.startDate));
        const end = Math.min(30, daysBetween(today, booking.endDate));
        days += Math.max(0, end - start);
      });
    return {
      id: vehicle.id,
      name: vehicle.name,
      status: vehicle.status,
      days,
      utilization: Math.min(100, Math.round((days / 30) * 100)),
    };
  }).sort((a, b) => b.utilization - a.utilization);

  // Average the raw booked days, not the rounded per-vehicle percentages:
  // summing rounded values would drift as the fleet grows.
  const bookedDays = utilizationByVehicle.reduce((sum, item) => sum + item.days, 0);
  const utilization = bookableFleet.length
    ? Math.min(100, Math.round((bookedDays / (bookableFleet.length * 30)) * 100))
    : 0;

  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const topMap = new Map();
  bookings.forEach((booking) => {
    const id = booking.vehicle?.id;
    if (!id) return;
    const current = topMap.get(id) || {
      id,
      name: booking.vehicle?.name,
      imageUrl: booking.vehicle?.imageUrl,
      bookings: 0,
      revenue: 0,
    };
    current.bookings += 1;
    if (booking.status === 'completed') current.revenue += Number(booking.total) || 0;
    topMap.set(id, current);
  });

  const DESK_STATUSES = ['pending', 'confirmed', 'active'];
  const pickupsToday = bookings
    .filter((booking) => booking.startDate === today && DESK_STATUSES.includes(booking.status))
    .sort((a, b) => String(a.pickupTime || '10:00').localeCompare(String(b.pickupTime || '10:00')));
  const returnsToday = bookings
    .filter((booking) => booking.endDate === today && DESK_STATUSES.includes(booking.status))
    .sort((a, b) => String(a.dropoffTime || '18:00').localeCompare(String(b.dropoffTime || '18:00')));

  // -------------------------------------------------------------------------
  // Deep analytics — daily trends, mixes, funnel and retention.
  // Every number is guarded so empty demo data never produces NaN or a crash.
  // -------------------------------------------------------------------------
  const days90 = dayKeys(90);
  const days30 = days90.slice(-30);
  const days30Prior = days90.slice(-60, -30);

  const byDay = new Map(days90.map((date) => [date, {
    date, created: 0, started: 0, completed: 0, cancelled: 0, recognized: 0, received: 0, gst: 0,
  }]));
  const weekdayCounts = new Map();
  const weekdayRevenueMap = new Map();
  const heatMap = new Map(); // `${weekday}\u0000${slot}` -> count
  const dropoffHeatMap = new Map(); // pick-up slot heat on return day
  const hourCounts = new Map();
  const dropoffHourCounts = new Map();
  const cancellationReasonCounts = new Map();
  const promoMap = new Map();
  const forecast = new Map();
  bookings.forEach((booking) => {
    const day = byDay.get(booking.startDate);
    if (day) {
      // Only trips that actually left the hub count as "started" — pending,
      // confirmed (including no-shows), cancelled and rejected never did.
      if (['active', 'completed'].includes(booking.status)) day.started += 1;
      if (booking.status === 'completed') {
        day.completed += 1;
        day.recognized += Number(booking.total) || 0;
        day.gst += Number(booking.fees) || 0;
      } else if (['cancelled', 'rejected'].includes(booking.status)) {
        day.cancelled += 1;
      }
    }
    const createdDay = byDay.get(dayOf(booking.createdAt));
    if (createdDay) createdDay.created += 1;
    (booking.payments ?? []).forEach((payment) => {
      // `refunded` is how Supabase marks an original payment that was fully
      // refunded; demo keeps it `succeeded`. Counting both keeps "cash received"
      // identical across adapters. Refund rows themselves are not cash in — the
      // finance ledger reports them separately.
      if (['payment', 'deposit', 'balance'].includes(payment.kind)
        && ['captured', 'succeeded', 'refunded'].includes(payment.status)) {
        const paidDay = byDay.get(dayOf(payment.createdAt));
        if (paidDay) paidDay.received += Number(payment.amount) || 0;
      }
    });

    // "When pick-ups actually happen" must not count bookings that were
    // cancelled or rejected — they never reached the hub.
    const happened = !['cancelled', 'rejected'].includes(booking.status);
    const start = booking.startDate || '';
    if (happened && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
      const weekday = new Date(`${start}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
      weekdayCounts.set(weekday, (weekdayCounts.get(weekday) || 0) + 1);
      if (booking.status === 'completed') {
        weekdayRevenueMap.set(weekday, (weekdayRevenueMap.get(weekday) || 0) + (Number(booking.total) || 0));
      }
    }
    const pickupHour = Number(String(booking.pickupTime || '12:00').split(':')[0]);
    if (happened && Number.isFinite(pickupHour)) {
      hourCounts.set(pickupHour, (hourCounts.get(pickupHour) || 0) + 1);
      if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        const weekday = new Date(`${start}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
        const key = `${weekday}|${slotForHour(pickupHour)}`;
        heatMap.set(key, (heatMap.get(key) || 0) + 1);
      }
    }
    const dropoffHour = Number(String(booking.dropoffTime || '18:00').split(':')[0]);
    if (happened && Number.isFinite(dropoffHour)) {
      dropoffHourCounts.set(dropoffHour, (dropoffHourCounts.get(dropoffHour) || 0) + 1);
      // Return-wave heat is keyed on the return day (endDate), not pick-up.
      const end = booking.endDate || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        const weekday = new Date(`${end}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
        const key = `${weekday}|${slotForHour(dropoffHour)}`;
        dropoffHeatMap.set(key, (dropoffHeatMap.get(key) || 0) + 1);
      }
    }
    if (booking.status === 'cancelled' || booking.status === 'rejected') {
      const reason = String(booking.cancellationReason ?? '').trim() || 'Not specified';
      cancellationReasonCounts.set(reason, (cancellationReasonCounts.get(reason) || 0) + 1);
    }
    if (booking.promoCode) {
      const promo = promoMap.get(booking.promoCode) || (promoMap.set(booking.promoCode, { code: booking.promoCode, uses: 0, revenue: 0 }), promoMap.get(booking.promoCode));
      promo.uses += 1;
      if (booking.status === 'completed') promo.revenue += Number(booking.total) || 0;
    }
    // Pipeline covers the next 14 calendar days, including today (half-open so
    // it is exactly 14 days, matching the label and the rest of the app).
    if (['confirmed', 'active'].includes(booking.status) && booking.startDate >= today && booking.startDate < addDate(today, 14)) {
      forecast.set(booking.startDate, (forecast.get(booking.startDate) || 0) + (Number(booking.total) || 0));
    }
  });
  const daily = days90.map((date) => ({ ...byDay.get(date), label: shortDate(date) }));
  const sumField = (rows, field) => rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  const revenue30 = sumField(daily.slice(-30), 'recognized');
  const received30 = sumField(daily.slice(-30), 'received');
  const created30 = sumField(daily.slice(-30), 'created');
  let revenuePrior = 0;
  let createdPrior = 0;
  bookings.forEach((booking) => {
    if (booking.status === 'completed' && days30Prior.includes(booking.startDate)) {
      revenuePrior += Number(booking.total) || 0;
    }
    if (days30Prior.includes(dayOf(booking.createdAt))) createdPrior += 1;
  });
  const revenueDelta = revenuePrior > 0 ? roundInt(((revenue30 - revenuePrior) / revenuePrior) * 100) : null;
  const createdDelta = createdPrior > 0 ? roundInt(((created30 - createdPrior) / createdPrior) * 100) : null;

  const typeMap = new Map();
  const hubMap = new Map();
  const perCustomer = new Map();
  const leadTimeBins = new Map();
  let leadDaysTotal = 0;
  let leadDaysCount = 0;
  let tripDaysTotal = 0;
  let tripDaysCount = 0;

  bookings.forEach((booking) => {
    // These mixes are labelled "trips" throughout the admin UI. A cancelled or
    // rejected request never became a trip, so it must not inflate the category
    // or hub totals (the demand charts already use the same boundary).
    const happened = !['cancelled', 'rejected'].includes(booking.status);
    const isBike = BIKE_TYPES.includes(booking.vehicle?.type);
    const typeLabel = isBike ? 'Bikes' : (booking.vehicle?.type || 'Other');
    const typeEntry = typeMap.get(typeLabel) || (typeMap.set(typeLabel, { label: typeLabel, count: 0, revenue: 0 }), typeMap.get(typeLabel));
    if (happened) typeEntry.count += 1;
    if (booking.status === 'completed') typeEntry.revenue += Number(booking.total) || 0;

    const hub = booking.pickupLocation || 'Unknown';
    const hubEntry = hubMap.get(hub) || (hubMap.set(hub, { label: hub, count: 0, revenue: 0 }), hubMap.get(hub));
    if (happened) hubEntry.count += 1;
    if (booking.status === 'completed') hubEntry.revenue += Number(booking.total) || 0;

    if (booking.customer?.email && booking.status === 'completed') {
      // Repeat rate counts completed rentals, matching the CRM and the
      // first-time/returning revenue split. Email is normalised so casing or
      // stray spaces cannot split one customer into two.
      const email = String(booking.customer.email).trim().toLowerCase();
      perCustomer.set(email, (perCustomer.get(email) || 0) + 1);
    }

    if (booking.createdAt && booking.startDate && !['cancelled', 'rejected'].includes(booking.status)) {
      const lead = daysBetween(dayOf(booking.createdAt), booking.startDate);
      if (lead >= 0 && lead <= 730) {
        leadDaysTotal += lead;
        leadDaysCount += 1;
        const bucket = LEAD_BUCKETS.find((item) => lead <= item.max) ?? LEAD_BUCKETS[LEAD_BUCKETS.length - 1];
        leadTimeBins.set(bucket.label, (leadTimeBins.get(bucket.label) || 0) + 1);
      }
    }
    if (booking.startDate && booking.endDate && booking.status === 'completed') {
      // Match the quote engine: `days` is the number of rental nights, so a
      // 1-night trip is one day — not two calendar dates. Only completed trips
      // count, matching the trip-length distribution.
      const trip = daysBetween(booking.startDate, booking.endDate);
      if (trip > 0) {
        tripDaysTotal += trip;
        tripDaysCount += 1;
      }
    }
  });

  const typeMix = [...typeMap.values()].filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);
  const hubMix = [...hubMap.values()].filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);
  const customersWithBookings = perCustomer.size;
  const repeatCustomers = [...perCustomer.values()].filter((count) => count >= 2).length;
  const repeatRate = percentOf(repeatCustomers, customersWithBookings);
  const leadTimeMix = LEAD_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: leadTimeBins.get(bucket.label) || 0,
  })).filter((item) => item.count > 0);
  const completedCount = statusCounts.completed;
  const resolvedCount = statusCounts.completed + statusCounts.cancelled + statusCounts.rejected;
  const completedRate = percentOf(statusCounts.completed, resolvedCount);
  const avgBookingValue = completedCount ? roundInt(sumField(completed, 'total') / completedCount) : 0;
  const leadTimeDays = leadDaysCount ? Math.round(leadDaysTotal / leadDaysCount) : null;
  const avgTripDays = tripDaysCount ? Math.round(tripDaysTotal / tripDaysCount) : null;

  const fleetAvailable = vehicles.filter((vehicle) => vehicle.status === 'available').length;
  const fleetRented = vehicles.filter((vehicle) => vehicle.status === 'rented').length;
  const fleetService = vehicles.filter((vehicle) => vehicle.status === 'maintenance').length;

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekdayRank = (label) => WEEKDAYS.indexOf(label);
  const weekdayMix = [...weekdayCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => weekdayRank(a.label) - weekdayRank(b.label));
  const HEAT_SLOTS = ['early', 'morning', 'afternoon', 'evening', 'night'];
  const heat = [...heatMap.entries()].map(([key, count]) => {
    const [weekday, slot] = key.split('|');
    return { weekday, slot, count };
  });
  const dropoffHeat = [...dropoffHeatMap.entries()].map(([key, count]) => {
    const [weekday, slot] = key.split('|');
    return { weekday, slot, count };
  });
  const heatSlots = HEAT_SLOTS;
  const hours = [...hourCounts.entries()]
    .map(([hour, count]) => ({ label: `${String(hour).padStart(2, '0')}:00`, value: count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const dropoffHours = [...dropoffHourCounts.entries()]
    .map(([hour, count]) => ({ label: `${String(hour).padStart(2, '0')}:00`, value: count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const cancellationReasons = [...cancellationReasonCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const weekdayRevenue = [...weekdayRevenueMap.entries()]
    .map(([label, revenue]) => ({ label, revenue }))
    .sort((a, b) => weekdayRank(a.label) - weekdayRank(b.label));
  const promoPerformance = [...promoMap.values()].sort((a, b) => b.uses - a.uses).slice(0, 6);
  const forecastRows = [...forecast.entries()].sort().map(([date, value]) => ({ date, label: shortDate(date), value }));
  const maintenance = maintenanceSummary(vehicles, serviceLogs, blocks, today);

  // Per-vehicle economics. Revenue follows the same basis as the Revenue KPI
  // (completed trip totals, attributed to the pick-up day), while service spend
  // is validated workshop cost. "Contribution" is revenue minus workshop spend
  // only — insurance, fuel and depreciation are not tracked here, so it is a
  // contribution figure rather than a profit figure.
  const CONTRIBUTION_WINDOWS = [7, 30, 90];
  const contributionStart = (days) => addDaysISO(today, -(days - 1));
  const completedByVehicle = new Map();
  completed.forEach((booking) => {
    const id = booking.vehicle?.id ?? booking.vehicleId;
    if (!id) return;
    const list = completedByVehicle.get(id) ?? [];
    list.push(booking);
    completedByVehicle.set(id, list);
  });
  const emptySpend = () => ({ all: 0, 7: 0, 30: 0, 90: 0 });
  const serviceSpendByVehicle = new Map();
  (Array.isArray(serviceLogs) ? serviceLogs : []).forEach((log) => {
    if (!log?.vehicleId || !isValidDate(log.serviceDate)) return;
    // A workshop visit dated in the future has not happened yet (and is almost
    // always a typo), so it must never reduce today's contribution.
    if (log.serviceDate > today) return;
    const entry = serviceSpendByVehicle.get(log.vehicleId) ?? emptySpend();
    const cost = Number(log.cost) || 0;
    entry.all += cost;
    CONTRIBUTION_WINDOWS.forEach((days) => {
      if (log.serviceDate >= contributionStart(days)) entry[days] += cost;
    });
    serviceSpendByVehicle.set(log.vehicleId, entry);
  });
  const fleetContribution = vehicles
    .map((vehicle) => {
      const trips = completedByVehicle.get(vehicle.id) ?? [];
      const spend = serviceSpendByVehicle.get(vehicle.id) ?? emptySpend();
      const byWindow = {};
      CONTRIBUTION_WINDOWS.forEach((days) => {
        const from = contributionStart(days);
        const rows = trips.filter((booking) => booking.startDate >= from && booking.startDate <= today);
        const windowRevenue = rows.reduce((sum, booking) => sum + (Number(booking.total) || 0), 0);
        byWindow[days] = {
          trips: rows.length,
          revenue: windowRevenue,
          service: spend[days],
          contribution: windowRevenue - spend[days],
        };
      });
      const allRevenue = trips.reduce((sum, booking) => sum + (Number(booking.total) || 0), 0);
      return {
        id: vehicle.id,
        name: vehicle.name,
        kind: vehicle.kind ?? 'car',
        type: vehicle.type,
        imageUrl: vehicle.imageUrl,
        location: vehicle.location,
        allTime: {
          trips: trips.length,
          revenue: allRevenue,
          service: spend.all,
          contribution: allRevenue - spend.all,
        },
        byWindow,
      };
    });
  const fleetHealth = {
    total: vehicles.length,
    available: fleetAvailable,
    rented: fleetRented,
    service: fleetService,
    serviceDue: maintenance.due,
    serviceOverdue: maintenance.overdue,
  };

  const gstTotal = completed.reduce((sum, booking) => sum + (Number(booking.fees) || 0), 0);
  const outstandingTotal = bookings
    .filter((booking) => ['confirmed', 'active', 'completed'].includes(booking.status))
    .reduce((sum, booking) => sum + (Number(booking.balanceDue) || 0), 0);
  const depositFloat = bookings
    .filter((booking) => isReturnOpen(booking))
    .reduce((sum, booking) => sum + (Number(booking.holdAmount) || 0), 0);
  const typeMixByRevenue = [...typeMap.values()].filter((item) => item.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const hubMixByRevenue = [...hubMap.values()].filter((item) => item.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const depositBook = returnsSummary(bookings);
  const waitlist = availabilityBoard({ users, bookings, vehicles, blocks });

  // First **completed** booking per customer (earliest start, id as a stable
  // tie-break) so revenue can be split between acquisition and repeat business.
  // A cancelled first attempt must not turn the customer's first real trip into
  // "returning" revenue.
  const firstByCustomer = new Map();
  completed.forEach((booking) => {
    const email = String(booking.customer?.email ?? '').trim().toLowerCase();
    if (!email || !booking.startDate) return;
    const key = `${booking.startDate}|${booking.id}`;
    const current = firstByCustomer.get(email);
    if (!current || key < current.key) firstByCustomer.set(email, { key, id: booking.id });
  });
  let newRevenue = 0;
  let returningRevenue = 0;
  let newTrips = 0;
  let returningTrips = 0;
  completed.forEach((booking) => {
    const total = Number(booking.total) || 0;
    const email = String(booking.customer?.email ?? '').trim().toLowerCase();
    const isReturning = Boolean(email) && firstByCustomer.get(email)?.id !== booking.id;
    if (isReturning) {
      returningRevenue += total;
      returningTrips += 1;
    } else {
      newRevenue += total;
      newTrips += 1;
    }
  });
  const customerMix = {
    newRevenue,
    returningRevenue,
    newTrips,
    returningTrips,
    returningShare: percentOf(returningRevenue, newRevenue + returningRevenue),
  };

  // Trip-length distribution (completed trips) — the shape behind avgTripDays.
  const tripBuckets = [
    { label: '1 day', min: 1, max: 1 },
    { label: '2–3 days', min: 2, max: 3 },
    { label: '4–7 days', min: 4, max: 7 },
    { label: '8–14 days', min: 8, max: 14 },
    { label: '15+ days', min: 15, max: Infinity },
  ];
  const tripLengthMix = tripBuckets.map((bucket) => ({ label: bucket.label, count: 0 }));
  completed.forEach((booking) => {
    if (!booking.startDate || !booking.endDate) return;
    const days = daysBetween(booking.startDate, booking.endDate);
    const index = tripBuckets.findIndex((bucket) => days >= bucket.min && days <= bucket.max);
    if (index >= 0) tripLengthMix[index].count += 1;
  });

  // Customer acquisition trend: monthly registration counts so the admin can
  // see at a glance whether sign-ups are growing. Keyed by month over 12 months.
  const customerAcquisitionTrend = (() => {
    const customers = (Array.isArray(users) ? users : []).filter((u) => u.role === 'customer' && u.createdAt);
    const map = new Map();
    monthKeys(12).forEach((key) => map.set(key, 0));
    customers.forEach((u) => {
      const month = String(u.createdAt).slice(0, 7);
      if (month.length === 7) map.set(month, (map.get(month) || 0) + 1);
    });
    return {
      monthly: [...map.entries()].map(([label, count]) => ({ label, count })),
      total: customers.length,
      thisMonth: map.get(today.slice(0, 7)) || 0,
    };
  })();

  return {
    revenue,
    trips: completed.length,
    revenueThisMonth,
    revenueLastMonth,
    pending: statusCounts.pending,
    activeRentals: bookings.filter((booking) => booking.status === 'active').length,
    overdueReturns: bookings.filter((booking) => booking.status === 'active' && lateDays(booking, today) > 0).length,
    serviceDue: maintenance.due,
    serviceOverdue: maintenance.overdue,
    serviceSpendYtd: maintenance.spendYtd,
    customers: users.filter((user) => user.role === 'customer').length,
    fleetSize: vehicles.length,
    available: fleetAvailable,
    rented: fleetRented,
    inService: fleetService,
    utilization,
    utilizationByVehicle: utilizationByVehicle.slice(0, 6),
    monthly,
    statusCounts,
    noShowCount: noShows.length,
    noShows: noShows.slice(0, 5).map((booking) => ({
      code: booking.code,
      startDate: booking.startDate,
      customer: booking.customer?.name,
      vehicle: booking.vehicle?.name,
    })),
    recent: [...bookings]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 8),
    pickupsToday,
    returnsToday,
    topVehicles: [...topMap.values()]
      .sort((a, b) => (b.revenue - a.revenue) || (b.bookings - a.bookings))
      .slice(0, 5)
      .map((item) => ({ ...item, imageUrl: item.imageUrl || vehicleMap.get(item.id)?.imageUrl })),
    analytics: {
      daily,
      days30,
      days90,
      revenue30,
      received30,
      created30,
      revenueDelta,
      createdDelta,
      typeMix,
      hubMix,
      conversion: statusCounts,
      completedRate,
      leadTimeDays,
      avgTripDays,
      repeatRate,
      repeatCustomers,
      customersWithBookings,
      customerMix,
      tripLengthMix,
      avgBookingValue,
      weekdayMix,
      weekdayRevenue,
      heat,
      dropoffHeat,
      heatSlots,
      hours,
      dropoffHours,
      leadTimeMix,
      cancellationReasons,
      promoPerformance,
      forecastRows,
      fleetHealth,
      fleetRadar: fleetRadar(vehicles, bookings),
      fleetRadarStats: fleetRadarStats(fleetRadar(vehicles, bookings)),
      utilizationTrend: utilizationSeries(bookings, vehicles, { days: 90 }),
      gstTotal,
      outstandingTotal,
      depositFloat,
      typeMixByRevenue,
      hubMixByRevenue,
      deposits: depositBook,
      returnTimes: returnTimeliness(bookings),
      lateReturns: lateReturnsByVehicle(bookings),
      returnsWeek: returnForecast(bookings, today),
      waitlist: waitlistSummary(waitlist),
      maintenance,
      fleetContribution,
      compliance: fleetDocuments(vehicles, today),
      checkout: checkoutSummary(checkoutAttempts, today),
      km: kmSummary(bookings),
      extensions: extensionSummary(bookings),
      customerAcquisitionTrend,
      seasonalReadiness: seasonalReadiness(bookings, vehicles, blocks, {
        start: String(settings?.seasonal_start || ''),
        end: String(settings?.seasonal_end || ''),
        today,
      }),
      reviews: reviewSummary(reviews, { vehicles, today }),
    },
  };
}
