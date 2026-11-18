/** Lightweight "recently viewed" tracking — stored per browser, no account needed. */

const KEY = 'rove_recent_vehicles_v1';
const MAX = 6;

export function recordRecentVehicle(vehicle = {}) {
  if (!vehicle.id) return;
  const entry = {
    id: vehicle.id,
    name: vehicle.name,
    pricePerDay: vehicle.pricePerDay,
    imageUrl: vehicle.imageUrl,
    location: vehicle.location,
    type: vehicle.type,
    at: Date.now(),
  };
  try {
    const current = readRecent();
    const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — viewing history is a nice-to-have */
  }
}

export function readRecent(limit = 4) {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id).slice(0, limit) : [];
  } catch {
    return [];
  }
}

export function clearRecent() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}