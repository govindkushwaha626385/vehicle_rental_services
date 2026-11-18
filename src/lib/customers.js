import { todayISO } from './pricing.js';
import { localDay } from './format.js';

/**
 * Customer intelligence used by the admin CRM (`/admin/customers`).
 *
 * One pure function computes the same rows for the demo and Supabase adapters,
 * so lifetime value, segmentation and churn risk can never drift between the
 * two. Everything is defensive: missing dates, guests without accounts, and
 * bookings for deleted vehicles all resolve to safe values.
 */

export const SEGMENTS = Object.freeze(['vip', 'loyal', 'active', 'lapsed', 'prospect', 'dormant']);

/**
 * Internal key that groups every booking of one customer, whether they signed
 * in (account id) or checked out as a guest (normalised email). Booking-level
 * money must never bleed across people, and two "guest" rows with no email are
 * deliberately not merged — an empty key means the booking is ungroupable and
 * is skipped by the money roll-up.
 */
export const customerMoneyKey = (booking = {}) => {
  const id = booking.customer?.id || booking.userId || '';
  if (id) return `acct:${id}`;
  const email = String(booking.customer?.email || booking.guestEmail || '').trim().toLowerCase();
  return email ? `guest:${email}` : '';
};

/**
 * Per-customer money position across every booking, for the booking drawer.
 * Built from the same fields the rest of the product reports, so the number a
 * staff member sees cannot drift from the dashboard or the customer's own
 * account: `balanceDue`/`creditDue` travel straight from the booking shape,
 * and the deposit float reuses the returns-desk definition (active, or
 * completed-but-unsettled) of "still held".
 *
 * Returns a Map keyed by `customerMoneyKey` with
 * `{ name, outstanding, creditDue, depositsHeld, awaiting, awaitingAmount }`.
 */
export const buildCustomerMoneyMap = (bookings = []) => {
  const map = new Map();
  (Array.isArray(bookings) ? bookings : []).forEach((booking) => {
    const key = customerMoneyKey(booking);
    if (!key) return;
    const entry = map.get(key) ?? {
      key,
      name: booking.customer?.name || booking.guestName || 'Guest',
      outstanding: 0,
      creditDue: 0,
      depositsHeld: 0,
      awaiting: 0,
      awaitingAmount: 0,
    };
    entry.outstanding += ['confirmed', 'active', 'completed'].includes(booking.status)
      ? Math.max(0, Number(booking.balanceDue) || 0)
      : 0;
    entry.creditDue += ['confirmed', 'active', 'completed'].includes(booking.status)
      ? Math.max(0, Number(booking.creditDue) || 0)
      : 0;
    const depositOpen = booking.status === 'active'
      || (booking.status === 'completed' && !booking.depositSettlement);
    if (depositOpen) entry.depositsHeld += Math.max(0, Number(booking.holdAmount) || 0);
    if (booking.status === 'completed' && !booking.depositSettlement) {
      entry.awaiting += 1;
      entry.awaitingAmount += Math.max(0, Number(booking.holdAmount) || 0);
    }
    map.set(key, entry);
  });
  return map;
};

export const SEGMENT_LABELS = Object.freeze({
  vip: 'VIP',
  loyal: 'Repeat',
  active: 'Active',
  lapsed: 'Lapsed',
  prospect: 'Prospect',
  dormant: 'Dormant',
});

export const SEGMENT_TONES = Object.freeze({
  vip: 'bg-lime/30 text-ink',
  loyal: 'bg-aqua/25 text-forest',
  active: 'bg-sun/25 text-ink',
  lapsed: 'bg-coral/20 text-ink',
  prospect: 'bg-stone-100 text-muted',
  dormant: 'bg-stone-200 text-stone-600',
});

export const RISK_LABELS = Object.freeze({ low: 'Low', medium: 'Watch', high: 'At risk' });

export const LIFETIME_STATUSES = Object.freeze(['completed']);
export const UPCOMING_STATUSES = Object.freeze(['pending', 'confirmed', 'active']);

const DAY_MS = 86_400_000;
const dayNumber = (value) => {
  const time = Date.parse(`${localDay(value)}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
};
const daysBetween = (from, to = todayISO()) => {
  const start = dayNumber(from);
  const end = dayNumber(to);
  if (start === null || end === null) return null;
  return Math.max(0, Math.round((end - start) / DAY_MS));
};

const mostCommon = (values = []) => {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  let best = '';
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) { best = value; bestCount = count; }
  });
  return best;
};

export function segmentFor({ completedTrips = 0, totalBookings = 0, lifetimeValue = 0, joinedDaysAgo = 0, hasUpcoming = false } = {}) {
  if (completedTrips >= 4 || lifetimeValue >= 150000) return 'vip';
  if (completedTrips >= 2) return 'loyal';
  if (completedTrips >= 1) return 'active';
  if (totalBookings > 0) return hasUpcoming ? 'prospect' : 'lapsed';
  if (joinedDaysAgo > 120) return 'dormant';
  return 'prospect';
}

export function riskFor({ completedTrips = 0, daysSinceActivity = null } = {}) {
  if (daysSinceActivity === null) return 'low';
  if (completedTrips > 0 && daysSinceActivity > 180) return 'high';
  if (completedTrips > 0 && daysSinceActivity > 90) return 'medium';
  return 'low';
}

/**
 * Build the customer read model.
 *
 * @param {Array} customers [{ id, name, email, phone, createdAt, account }]
 * @param {Array} bookings  [{ userId, status, total, startDate, createdAt, vehicleType, hub }]
 */
export function segmentCustomers(customers = [], bookings = [], options = {}) {
  const { today = todayISO() } = options;
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const safeBookings = Array.isArray(bookings) ? bookings : [];
  const byCustomer = new Map();

  safeBookings.forEach((booking) => {
    const key = booking.userId || (booking.guestEmail ? `guest:${String(booking.guestEmail).toLowerCase()}` : '');
    if (!key) return;
    if (!byCustomer.has(key)) byCustomer.set(key, []);
    byCustomer.get(key).push(booking);
  });

  return safeCustomers.map((customer) => {
    const rows = byCustomer.get(customer.id) ?? [];
    const completed = rows.filter((booking) => LIFETIME_STATUSES.includes(booking.status));
    const upcoming = rows.filter((booking) => UPCOMING_STATUSES.includes(booking.status));
    const lifetimeValue = completed.reduce((sum, booking) => sum + (Number(booking.total) || 0), 0);
    const lastTrip = completed
      .map((booking) => booking.startDate || booking.createdAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const nextTrip = upcoming
      .map((booking) => booking.startDate)
      .filter((date) => date && date >= today)
      .sort()[0] ?? null;
    // Churn risk follows actual completed trips. A recent cancelled or pending
    // booking must not reset the clock on a customer who has not rented in a
    // year — that would quietly hide them from the win-back list.
    const lastActivity = lastTrip;
    const joinedDaysAgo = daysBetween(customer.createdAt, today) ?? 0;
    const segment = segmentFor({
      completedTrips: completed.length,
      totalBookings: rows.length,
      lifetimeValue,
      joinedDaysAgo,
      hasUpcoming: upcoming.length > 0,
    });

    return {
      id: customer.id,
      name: customer.name || 'Guest',
      email: customer.email || '',
      phone: customer.phone || '',
      account: customer.account !== false,
      joinedAt: customer.createdAt ?? null,
      totalBookings: rows.length,
      completedTrips: completed.length,
      cancelledTrips: rows.filter((booking) => booking.status === 'cancelled').length,
      lifetimeValue,
      avgValue: completed.length ? Math.round(lifetimeValue / completed.length) : 0,
      lastTripDate: lastTrip,
      nextTripDate: nextTrip,
      daysSinceLastTrip: lastTrip ? daysBetween(lastTrip, today) : null,
      favouriteType: mostCommon(rows.filter((booking) => !['cancelled', 'rejected'].includes(booking.status)).map((booking) => booking.vehicleType)),
      favouriteVehicle: mostCommon(rows.filter((booking) => !['cancelled', 'rejected'].includes(booking.status)).map((booking) => booking.vehicleName)),
      favouriteHub: mostCommon(rows.filter((booking) => !['cancelled', 'rejected'].includes(booking.status)).map((booking) => booking.hub)),
      segment,
      risk: riskFor({ completedTrips: completed.length, daysSinceActivity: lastActivity ? daysBetween(lastActivity, today) : null }),
    };
  });
}

export function crmSummary(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const withTrips = list.filter((row) => row.completedTrips > 0);
  const repeat = withTrips.filter((row) => row.completedTrips >= 2).length;
  const atRisk = list.filter((row) => row.risk === 'high');
  const ltv = list.reduce((sum, row) => sum + row.lifetimeValue, 0);
  return {
    total: list.length,
    vip: list.filter((row) => row.segment === 'vip').length,
    loyal: list.filter((row) => row.segment === 'loyal').length,
    active: list.filter((row) => row.segment === 'active').length,
    lapsed: list.filter((row) => row.segment === 'lapsed').length,
    prospect: list.filter((row) => row.segment === 'prospect').length,
    dormant: list.filter((row) => row.segment === 'dormant').length,
    guests: list.filter((row) => !row.account).length,
    repeatRate: withTrips.length ? Math.round((repeat / withTrips.length) * 100) : 0,
    totalLtv: ltv,
    avgLtv: list.length ? Math.round(ltv / list.length) : 0,
    atRisk: atRisk.length,
    atRiskValue: atRisk.reduce((sum, row) => sum + row.lifetimeValue, 0),
  };
}

/** Segment distribution for the donut, ordered by size. */
export function segmentMix(rows = []) {
  const summary = crmSummary(rows);
  return SEGMENTS
    .map((segment) => ({ label: SEGMENT_LABELS[segment], value: summary[segment], key: segment }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Highest-value customers first — used for the "top customers" chart. */
export function topCustomers(rows = [], limit = 8) {
  return [...(Array.isArray(rows) ? rows : [])]
    .filter((row) => row.lifetimeValue > 0)
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
    .slice(0, limit);
}

/** Win-back audience: known customers whose last trip has gone quiet. */
export function winbackAudience(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    row.risk === 'high' || row.segment === 'lapsed' || row.segment === 'dormant'
  ));
}
