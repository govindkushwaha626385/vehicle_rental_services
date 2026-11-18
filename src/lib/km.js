import { daysBetween } from './pricing.js';

/**
 * Kilometre allowance & excess-distance engine.
 *
 * Indian self-drive rentals usually include a daily distance allowance and bill
 * the difference at drop-off. This module is the single source of truth for
 * those terms so the fleet form, the storefront, checkout, the returns desk and
 * both adapters agree on every number.
 *
 * Rules:
 *  - 0 included km means genuinely unlimited kilometres (the historical
 *    promise). A rate without an allowance is rejected by the form validator
 *    because it could never bill anything.
 *  - The allowance is per rental day, using the same day count as pricing.
 *  - Excess distance can only be charged when both odometer readings exist;
 *    an untracked hand-over never invents a reading.
 *  - A waived fee still records the excess distance for analytics.
 */

export const KM_CAP_MAX = 2000; // included km per rental day
export const KM_RATE_MAX = 500; // ₹ per extra km

const whole = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
};

/** Kilometres covered between pick-up and drop-off, or null when unknown. */
export function kmDriven(pickup, dropoff) {
  const from = pickup?.odometer === null || pickup?.odometer === undefined || pickup?.odometer === ''
    ? null
    : whole(pickup.odometer, NaN);
  const to = dropoff?.odometer === null || dropoff?.odometer === undefined || dropoff?.odometer === ''
    ? null
    : whole(dropoff.odometer, NaN);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return to - from;
}

/** Effective, self-consistent terms for a vehicle. */
export function kmTerms(vehicle = {}) {
  const kmCap = Math.max(0, whole(vehicle?.kmCap, 0));
  const kmExtraRate = Math.max(0, whole(vehicle?.kmExtraRate, 0));
  const limited = kmCap > 0 && kmExtraRate > 0;
  return {
    kmCap: limited ? kmCap : 0,
    kmExtraRate: limited ? kmExtraRate : 0,
    limited,
  };
}

/**
 * Form validation for the two fleet fields. Returns an object of field errors
 * so the adapter can surface the first one exactly like every other vehicle
 * rule (whole rupees, valid ranges).
 */
export function kmVehicleProblems(vehicle = {}) {
  const problems = {};
  const capRaw = vehicle?.kmCap;
  const rateRaw = vehicle?.kmExtraRate;
  const cap = capRaw === '' || capRaw === null || capRaw === undefined ? 0 : Number(capRaw);
  const rate = rateRaw === '' || rateRaw === null || rateRaw === undefined ? 0 : Number(rateRaw);

  if (!Number.isInteger(cap) || cap < 0 || cap > KM_CAP_MAX) {
    problems.kmCap = `Included km per day must be a whole number from 0 to ${KM_CAP_MAX.toLocaleString('en-IN')} (0 = unlimited).`;
  }
  if (!Number.isInteger(rate) || rate < 0 || rate > KM_RATE_MAX) {
    problems.kmExtraRate = `Extra-km rate must be a whole number from 0 to ₹${KM_RATE_MAX.toLocaleString('en-IN')} per km.`;
  }
  // A rate with no allowance would silently never bill, and an allowance with
  // no rate would promise a cap it cannot enforce. Reject both halves rather
  // than storing a setting that cannot work.
  if (!problems.kmCap && !problems.kmExtraRate) {
    if (cap > 0 && rate <= 0) problems.kmExtraRate = 'Add an extra-km rate, or set included km to 0 for unlimited.';
    if (cap <= 0 && rate > 0) problems.kmCap = 'Set included km per day above 0 to charge for extra distance.';
  }
  return problems;
}

/** Customer-facing summary for the vehicle page, checkout and vouchers. */
export function kmDisclosure(vehicle = {}) {
  const terms = kmTerms(vehicle);
  if (!terms.limited) {
    return { ...terms, label: 'Unlimited kilometres' };
  }
  return {
    ...terms,
    label: `${terms.kmCap.toLocaleString('en-IN')} km/day included · ₹${terms.kmExtraRate.toLocaleString('en-IN')}/extra km`,
  };
}

/**
 * The distance included on one trip. `days` wins when present (it is the same
 * day count the fare was priced on); otherwise the dates are used. Missing
 * dates fall back to a single day so a malformed legacy row cannot produce
 * NaN or an infinite allowance.
 */
export function kmAllowance({ kmCap, startDate, endDate, days } = {}) {
  const cap = Math.max(0, whole(kmCap, 0));
  if (!cap) return null;
  let tripDays = whole(days, 0);
  if (tripDays <= 0 && startDate && endDate) tripDays = daysBetween(startDate, endDate);
  if (tripDays <= 0) tripDays = 1;
  return cap * tripDays;
}

/**
 * Excess-km maths at drop-off.
 *
 * `limited` describes the vehicle terms (so the desk can show an allowance
 * even before an odometer is entered). `fee` is what should actually be
 * charged: zero when the distance is unknown, within the allowance, or waived.
 */
export function excessKm({
  driven = null,
  kmCap = 0,
  kmExtraRate = 0,
  startDate,
  endDate,
  days,
  waived = false,
} = {}) {
  const allowance = kmAllowance({ kmCap, startDate, endDate, days });
  const rate = Math.max(0, whole(kmExtraRate, 0));
  const limited = Boolean(allowance && rate);
  const distance = driven === null || driven === undefined || driven === ''
    ? null
    : Math.max(0, whole(driven, 0));

  if (!limited || distance === null) {
    return { limited, allowance, driven: distance, excess: 0, rate, fee: 0, waived: false };
  }
  const excess = Math.max(0, distance - allowance);
  const waivedNow = Boolean(waived) && excess > 0;
  return {
    limited,
    allowance,
    driven: distance,
    excess,
    rate,
    fee: waivedNow ? 0 : excess * rate,
    waived: waivedNow,
  };
}

/**
 * Fleet-wide distance roll-up for analytics. Only completed trips with both
 * odometer readings count, so a half-recorded trip cannot skew the average.
 * Billed fees come from the stored settlement (so waivers are respected while
 * the excess distance itself is still reported).
 */
export function kmSummary(bookings = []) {
  const list = (Array.isArray(bookings) ? bookings : []).filter((booking) => booking.status === 'completed');
  let driven = 0;
  let measured = 0;
  let excess = 0;
  let excessKmFees = 0;
  let cappedTrips = 0;
  const byVehicle = new Map();

  list.forEach((booking) => {
    const from = booking.pickupOdometer ?? booking.pickupInspection?.odometer ?? null;
    const to = booking.returnOdometer ?? booking.inspection?.odometer ?? null;
    const distance = kmDriven({ odometer: from }, { odometer: to });
    const km = excessKm({
      driven: distance,
      kmCap: booking.kmCap ?? booking.vehicle?.kmCap,
      kmExtraRate: booking.kmExtraRate ?? booking.vehicle?.kmExtraRate,
      startDate: booking.startDate,
      endDate: booking.endDate,
      days: booking.days,
    });
    const billed = Number(booking.depositSettlement?.excessKmFee);
    if (Number.isFinite(billed) && billed > 0) excessKmFees += billed;
    if (distance === null) return;

    measured += 1;
    driven += distance;
    excess += km.excess;
    if (km.limited) cappedTrips += 1;

    const id = booking.vehicle?.id ?? booking.vehicleId ?? 'unknown';
    const row = byVehicle.get(id) || { label: booking.vehicle?.name || 'Unknown vehicle', value: 0, excess: 0 };
    row.value += distance;
    row.excess += km.excess;
    byVehicle.set(id, row);
  });

  return {
    trips: measured,
    driven,
    avgDriven: measured ? Math.round(driven / measured) : 0,
    excess,
    excessKmFees,
    cappedTrips,
    byVehicle: [...byVehicle.values()]
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
  };
}
