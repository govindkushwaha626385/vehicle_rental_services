import { todayISO } from './pricing.js';

/**
 * Pure fleet-health heuristics used by the Fleet page's maintenance radar.
 * With no odometer in the model, "service due" is derived from how much the
 * vehicle has been worked (bookings + trips + age): vehicles that are worked
 * hard or old get flagged sooner. All values guarded for missing data.
 */

const STATUS_WEIGHT = { completed: 1, cancelled: 0.35, rejected: 0.2 };

export const FLEET_STATUSES = ['available', 'rented', 'maintenance'];
export const BULK_FLEET_STATUSES = ['available', 'rented', 'maintenance'];

/**
 * Work score in "days of wear" from the booking history available to staff.
 *
 * Booking days and the lifetime trip counter measure different things, so they
 * are never added together (that double-counted every completed trip). Use the
 * booking history when it exists, otherwise fall back to the trip counter as a
 * coarse wear proxy.
 */
export function wearDays(vehicle = {}, bookings = []) {
  const rows = Array.isArray(bookings)
    ? bookings.filter((booking) => booking.vehicle?.id === vehicle.id || booking.vehicleId === vehicle.id)
    : [];
  if (rows.length) {
    return Math.round(rows.reduce(
      (sum, booking) => sum + (Number(booking.days) || 0) * (STATUS_WEIGHT[booking.status] ?? 0.6),
      0,
    ));
  }
  return Number(vehicle.trips) || 0;
}

/** Age in years since the model year, floored at 0. */
export function vehicleAgeYears(vehicle = {}) {
  const age = Number(todayISO().slice(0, 4)) - Number(vehicle.year || todayISO().slice(0, 4));
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}

/** Service-due score 0-100. 0 = fresh, 100 = immediately due. */
export function serviceDueScore(vehicle = {}, bookings = []) {
  const wear = wearDays(vehicle, bookings);
  const age = vehicleAgeYears(vehicle);
  const util = Math.max(0, Math.min(100, Number(vehicle.utilization) || 0));
  // Rough model: ~40 "wear units" ≈ service window; older fleets and heavier
  // utilisation bring it up.
  const score = Math.round(Math.min(100, ((wear / 40) * 0.6 + (age / 6) * 0.25 + (util / 100) * 0.15) * 100));
  return Math.max(0, Math.min(100, score));
}

export function serviceBand(score = 0) {
  if (score >= 75) return 'overdue';
  if (score >= 45) return 'due';
  if (score >= 20) return 'watch';
  return 'fresh';
}

/**
 * Fleet radar: every serviceable vehicle sorted by how due it is, with a
 * band, score and surface copy already resolved.
 */
export function fleetRadar(vehicles = [], bookings = [], { includeMaintenance = true } = {}) {
  return (Array.isArray(vehicles) ? vehicles : [])
    .filter((vehicle) => includeMaintenance || vehicle.status !== 'maintenance')
    .map((vehicle) => {
      const score = serviceDueScore(vehicle, bookings);
      return {
        id: vehicle.id,
        name: vehicle.name,
        type: vehicle.type,
        status: vehicle.status,
        age: vehicleAgeYears(vehicle),
        wear: wearDays(vehicle, bookings),
        score,
        band: serviceBand(score),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export const fleetRadarStats = (radar = []) => ({
  total: radar.length,
  overdue: radar.filter((row) => row.band === 'overdue').length,
  due: radar.filter((row) => row.band === 'due').length,
  fresh: radar.filter((row) => row.band === 'fresh').length,
});