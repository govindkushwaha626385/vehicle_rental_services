/**
 * Local vehicle shortlist for side-by-side comparison.
 *
 * The tray and cards need to render without a network request, so we keep a
 * small snapshot of each vehicle alongside its id. The compare page re-fetches
 * the live record so price, availability and specs stay current.
 */

const KEY = 'rove_compare_v1';
export const COMPARE_MAX = 3;
export const COMPARE_EVENT = 'rove:compare';

const snapshot = (vehicle = {}) => ({
  id: vehicle.id,
  name: vehicle.name,
  brand: vehicle.brand,
  type: vehicle.type,
  kind: vehicle.kind ?? 'car',
  pricePerDay: Number(vehicle.pricePerDay) || 0,
  imageUrl: vehicle.imageUrl || '',
  location: vehicle.location || '',
});

export function readCompare() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .filter((item) => item && typeof item.id === 'string' && item.id)
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
      .map(snapshot)
      .slice(0, COMPARE_MAX);
  } catch {
    return [];
  }
}

function writeCompare(items) {
  const clean = [];
  const seen = new Set();
  items.forEach((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) return;
    seen.add(item.id);
    clean.push(snapshot(item));
  });
  try {
    localStorage.setItem(KEY, JSON.stringify(clean.slice(0, COMPARE_MAX)));
  } catch {
    /* storage unavailable — comparison simply does not persist */
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(COMPARE_EVENT, { detail: { items: clean } }));
    } catch {
      window.dispatchEvent(new Event(COMPARE_EVENT));
    }
  }
}

/** Keep only the given vehicle ids, dropping anything stale or deleted. */
export function pruneCompare(keepIds = []) {
  const allowed = new Set();
  (Array.isArray(keepIds) ? keepIds : []).forEach((id) => { allowed.add(id); });
  const current = readCompare();
  const kept = current.filter((item) => allowed.has(item.id));
  if (kept.length !== current.length) writeCompare(kept);
  return kept;
}

export function isComparing(id) {
  return readCompare().some((item) => item.id === id);
}

export function toggleCompare(vehicle = {}) {
  if (!vehicle.id) return { added: false, limit: false, items: readCompare() };
  const current = readCompare();
  const existing = current.some((item) => item.id === vehicle.id);

  if (existing) {
    const items = current.filter((item) => item.id !== vehicle.id);
    writeCompare(items);
    return { added: false, limit: false, items };
  }

  if (current.length >= COMPARE_MAX) {
    return { added: false, limit: true, items: current };
  }

  const items = [...current, snapshot(vehicle)];
  writeCompare(items);
  return { added: true, limit: false, items };
}

export function removeFromCompare(id) {
  const items = readCompare().filter((item) => item.id !== id);
  writeCompare(items);
  return items;
}

export function clearCompare() {
  writeCompare([]);
}

/**
 * Compare-decision heuristics — pure and unit-tested so the page can never
 * claim a winner it cannot justify.
 */

/** Index of the best value in a numeric row, or -1 when tied/no numbers. */
export function rowWinnerIndex(values = [], { lowIsBest = true } = {}) {
  // Missing specs must not masquerade as zero and win a "lowest" row. An empty
  // string or null is unknown, not a real measurement.
  const numbers = values.map((value) => (
    value === null || value === undefined || value === '' ? NaN : Number(value)
  ));
  if (!numbers.length || numbers.some((value) => !Number.isFinite(value))) return -1;
  const best = lowIsBest ? Math.min(...numbers) : Math.max(...numbers);
  const winners = [];
  numbers.forEach((value, index) => { if (value === best) winners.push(index); });
  return winners.length === 1 ? winners[0] : -1;
}

/** Id of the cheapest shortlisted vehicle; null on a tie or an empty list. */
export function cheapestVehicleId(vehicles = []) {
  const priced = vehicles
    .map((vehicle) => ({ id: vehicle.id, price: Number(vehicle.pricePerDay) }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0);
  if (!priced.length) return null;
  priced.sort((a, b) => a.price - b.price);
  return priced.length > 1 && priced[0].price === priced[1].price ? null : priced[0].id;
}
