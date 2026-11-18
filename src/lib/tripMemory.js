import { addDaysISO, todayISO } from './pricing.js';

/**
 * Per-device "remember your trip" memory.
 *
 * On every successful search we snapshot the hubs, dates, times and vehicle
 * kind so the search widget can prefill next time, Browse can offer a
 * "resume your last trip" strip, and "Book again" can carry the trip forward.
 * Pure of React so it is cheap to contract-test in the demo suite.
 */

export const TRIP_MEMORY_KEY = 'rove_trip_memory_v1';
const MAX_AGE_MS = 90 * 24 * 3600 * 1000; // forget a trip memory after 90 days

const kindOf = (value) => (value === 'bike' ? 'bike' : value === 'car' ? 'car' : '');

export function rememberTrip(values = {}) {
  const snapshot = {
    location: String(values.location ?? '').trim(),
    dropoff: String(values.dropoff ?? '').trim(),
    from: String(values.from ?? '').trim(),
    to: String(values.to ?? '').trim(),
    pickupTime: String(values.pickupTime ?? '').trim(),
    dropoffTime: String(values.dropoffTime ?? '').trim(),
    kind: kindOf(values.kind),
    type: String(values.type ?? '').trim(),
    at: Date.now(),
  };
  // A memory without hubs or dates is meaningless.
  if (!snapshot.location || !snapshot.dropoff || !snapshot.from || !snapshot.to) return null;
  if (!snapshot.type) delete snapshot.type;
  if (!snapshot.kind) delete snapshot.kind;
  try {
    localStorage.setItem(TRIP_MEMORY_KEY, JSON.stringify(snapshot));
  } catch {
    /* storage unavailable — remembering is a nice-to-have */
  }
  return snapshot;
}

export function readRememberedTrip() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRIP_MEMORY_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object'
      || !parsed.location || !parsed.dropoff || !parsed.from || !parsed.to) return null;
    const age = Date.now() - Number(parsed.at || 0);
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
    return {
      location: String(parsed.location),
      dropoff: String(parsed.dropoff),
      from: String(parsed.from),
      to: String(parsed.to),
      pickupTime: String(parsed.pickupTime || ''),
      dropoffTime: String(parsed.dropoffTime || ''),
      kind: kindOf(parsed.kind),
      type: String(parsed.type || ''),
    };
  } catch {
    return null;
  }
}

export function clearRememberedTrip() {
  try {
    localStorage.removeItem(TRIP_MEMORY_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/**
 * Build prefill search values, giving an explicit caller-provided trip
 * priority and moving remembered dates into the future so the widget never
 * opens on an expired trip.
 */
export function mergeTripDefaults(policy = {}, remembered = null, provided = {}) {
  const minDays = Math.max(1, Number(policy.minDays) || 1);
  const earliest = addDaysISO(todayISO(), 2);
  const rememberFrom = remembered && remembered.from >= earliest ? remembered.from : '';
  const from = String(provided.from || rememberFrom || earliest);
  const rememberTo = remembered && remembered.to > from ? remembered.to : '';
  const to = String(provided.to || rememberTo || addDaysISO(from, minDays));
  const rememberPickup = remembered?.pickupTime || '10:00';
  const rememberDropoff = remembered?.dropoffTime || '10:00';
  return {
    location: String(provided.location || remembered?.location || ''),
    dropoff: String(provided.dropoff || provided.location || remembered?.dropoff || remembered?.location || ''),
    from,
    to,
    pickupTime: String(provided.pickupTime || rememberPickup),
    dropoffTime: String(provided.dropoffTime || rememberDropoff),
    kind: provided.kind || remembered?.kind || 'car',
    type: String(provided.type || remembered?.type || ''),
  };
}