import { todayISO } from './pricing.js';

/**
 * Availability watchlist engine.
 *
 * Alerts are just intent: "tell me if this vehicle frees up for these dates".
 * This module turns that intent into answers — is the window free today, which
 * alerts are ready to notify, and what does the waitlist look like — with one
 * implementation shared by the demo adapter, Supabase adapter and analytics.
 *
 * Date windows use the booking convention: start is inclusive, end is the day
 * the vehicle is free again, so two windows overlap only when
 * `aStart < bEnd && bStart < aEnd`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BLOCKING_STATUSES = Object.freeze(['pending', 'confirmed', 'active']);
const UNAVAILABLE_VEHICLE = Object.freeze(['maintenance', 'retired', 'inactive']);

const isDate = (value) => DATE_RE.test(String(value ?? ''));

export function windowsOverlap(aStart, aEnd, bStart, bEnd) {
  if (![aStart, aEnd, bStart, bEnd].every(isDate)) return false;
  return aStart < bEnd && bStart < aEnd;
}

/** True when the vehicle has no live booking or block in the window. */
export function vehicleFreeInWindow({
  vehicle = null,
  vehicleId = null,
  startDate,
  endDate,
  bookings = [],
  blocks = [],
  excludeBookingId = null,
} = {}) {
  const id = vehicle?.id ?? vehicleId;
  if (!id || !isDate(startDate) || !isDate(endDate) || startDate >= endDate) return false;
  if (vehicle && UNAVAILABLE_VEHICLE.includes(vehicle.status)) return false;
  const bookingClash = (Array.isArray(bookings) ? bookings : []).some((booking) => (
    // Demo bookings expose `vehicleId`; the Supabase `booking_json` serializer
    // only nests the id under `vehicle.id`. Read both so the watchlist cannot
    // call a booked vehicle free in one adapter and busy in the other.
    (booking.vehicleId ?? booking.vehicle?.id) === id
    && booking.id !== excludeBookingId
    && BLOCKING_STATUSES.includes(booking.status)
    && windowsOverlap(startDate, endDate, booking.startDate, booking.endDate)
  ));
  if (bookingClash) return false;
  return !(Array.isArray(blocks) ? blocks : []).some((block) => (
    block.vehicleId === id && windowsOverlap(startDate, endDate, block.startDate, block.endDate)
  ));
}

const vehicleName = (vehicle) => vehicle?.name || 'Vehicle';
const customerName = (user) => user?.name || user?.fullName || 'Customer';

/**
 * Every live alert with its current availability. Expired watch windows are
 * dropped, maintenance vehicles are never "ready", and notified alerts stay in
 * the list so the customer sees confirmation rather than a disappearing entry.
 */
export function availabilityBoard({
  users = [],
  bookings = [],
  vehicles = [],
  blocks = [],
  today = todayISO(),
} = {}) {
  const vehiclesById = new Map((vehicles ?? []).map((vehicle) => [vehicle.id, vehicle]));
  const rows = [];
  (Array.isArray(users) ? users : []).forEach((user) => {
    (Array.isArray(user.alerts) ? user.alerts : []).forEach((alert) => {
      if (alert.active === false) return;
      if (!isDate(alert.startDate) || !isDate(alert.endDate)) return;
      if (alert.endDate <= today) return;
      const vehicle = vehiclesById.get(alert.vehicleId) ?? null;
      if (!vehicle) return;
      const free = vehicleFreeInWindow({
        vehicle,
        startDate: alert.startDate,
        endDate: alert.endDate,
        bookings,
        blocks,
      });
      const notified = Boolean(alert.notifiedAt);
      rows.push({
        alertId: alert.id,
        userId: user.id,
        customerName: customerName(user),
        customerEmail: user.email ?? '',
        vehicleId: alert.vehicleId,
        vehicleName: vehicleName(vehicle),
        vehicleImage: vehicle.imageUrl ?? '',
        vehicleStatus: vehicle.status ?? '',
        startDate: alert.startDate,
        endDate: alert.endDate,
        free,
        notified,
        ready: free && !notified,
        notifiedAt: alert.notifiedAt ?? null,
        waitingSince: alert.createdAt ?? null,
        matchReason: alert.matchReason ?? null,
      });
    });
  });
  rows.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return String(a.startDate).localeCompare(String(b.startDate));
  });
  const watched = new Map();
  rows.forEach((row) => {
    const entry = watched.get(row.vehicleId) ?? { label: row.vehicleName, value: 0 };
    entry.value += 1;
    watched.set(row.vehicleId, entry);
  });
  return {
    rows,
    total: rows.length,
    ready: rows.filter((row) => row.ready).length,
    waiting: rows.filter((row) => !row.free && !row.notified).length,
    notified: rows.filter((row) => row.notified).length,
    topWatched: [...watched.values()].sort((a, b) => b.value - a.value).slice(0, 5),
  };
}

/** Immutable update stamped when a customer is told their window opened. */
export function markAlertNotified(alert = {}, { at, reason = 'Vehicle released', vehicleName: name = '' } = {}) {
  return {
    ...alert,
    notifiedAt: at,
    matchedAt: at,
    matchReason: reason,
    matchVehicleName: name,
  };
}

/** Analytics roll-up: safe on an empty board. */
export function waitlistSummary(board = {}) {
  return {
    total: Number(board.total) || 0,
    ready: Number(board.ready) || 0,
    waiting: Number(board.waiting) || 0,
    notified: Number(board.notified) || 0,
    topWatched: Array.isArray(board.topWatched) ? board.topWatched : [],
  };
}
