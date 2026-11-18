import { isValidDate, todayISO } from './pricing.js';

/**
 * Fleet compliance: registration (RC), insurance and pollution (PUC) document
 * expiry tracking.
 *
 * In India a rental is legally void the moment insurance or the pollution
 * certificate lapses, so these dates are operational, not decorative. Pure
 * and shared: the demo adapter, Supabase adapter, Fleet form and Dashboard
 * all read the same logic. Missing dates are "untracked" rather than silently
 * ok — an operator must be told a document is not on file.
 */

export const FLEET_DOCS = Object.freeze([
  { key: 'insuranceExpiry', label: 'Insurance' },
  { key: 'pucExpiry', label: 'PUC / pollution' },
]);

export const DOC_STATUS = Object.freeze({ ok: 'ok', expiring: 'expiring', expired: 'expired', untracked: 'untracked' });

const DAY_MS = 86_400_000;

/** Status for one expiry date. Today is injectable for tests. */
export function docStatus(expiry, today = todayISO(), warnDays = 30) {
  if (!expiry || !isValidDate(String(expiry).slice(0, 10))) return { status: DOC_STATUS.untracked, daysLeft: null };
  const daysLeft = (Date.parse(String(expiry).slice(0, 10)) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
  const whole = Math.ceil(daysLeft);
  if (whole < 0) return { status: DOC_STATUS.expired, daysLeft: whole };
  if (whole <= warnDays) return { status: DOC_STATUS.expiring, daysLeft: whole };
  return { status: DOC_STATUS.ok, daysLeft: whole };
}

/** Per-vehicle compliance summary, never throwing on missing data. */
export function vehicleDocs(vehicle = {}, today = todayISO()) {
  const docs = {};
  FLEET_DOCS.forEach((doc) => { docs[doc.key] = { key: doc.key, label: doc.label, ...docStatus(vehicle?.[doc.key], today) }; });
  const tracked = Object.values(docs).filter((doc) => doc.status !== DOC_STATUS.untracked);
  return {
    registrationNumber: String(vehicle?.registrationNumber ?? '').trim(),
    docs,
    documentCount: tracked.length,
    isExpired: tracked.some((doc) => doc.status === DOC_STATUS.expired),
    isExpiring: tracked.some((doc) => doc.status === DOC_STATUS.expiring),
  };
}

/** Compliance roll-up over the fleet, most urgent first. */
export function fleetDocuments(vehicles = [], today = todayISO()) {
  const rows = (Array.isArray(vehicles) ? vehicles : [])
    .map((vehicle) => ({ id: vehicle.id, name: vehicle.name, location: vehicle.location, ...vehicleDocs(vehicle, today) }));
  const rank = (row) => (row.isExpired ? 0 : row.isExpiring ? 1 : 2);
  return {
    vehicles: rows,
    total: rows.length,
    expired: rows.filter((row) => row.isExpired),
    expiring: rows.filter((row) => row.isExpiring && !row.isExpired),
    watchlist: [...rows.filter((row) => row.isExpired || row.isExpiring)]
      .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name))),
    isClean: !rows.some((row) => row.isExpired || row.isExpiring),
  };
}

/** Form validation for one document expiry date being saved on a vehicle. */
export function docDateProblem(value, label) {
  if (value === '' || value === null || value === undefined) return null;
  const date = String(value).slice(0, 10);
  if (!isValidDate(date)) return `Choose a valid ${label} expiry date.`;
  // An expired date is a legitimate state to record (the document lapsed) —
  // only malformed values are rejected here.
  return null;
}

/** All document-related problems for a vehicle form snapshot. */
export function fleetDocProblems(vehicle = {}) {
  const problems = {};
  FLEET_DOCS.forEach((doc) => {
    const problem = docDateProblem(vehicle?.[doc.key], doc.label);
    if (problem) problems[doc.key] = problem;
  });
  return problems;
}

/** Human line for the dashboard/watchlist: "Insurance expired 12d ago". */
export function docSummaryLine(doc) {
  if (!doc || doc.status === DOC_STATUS.untracked) return '';
  const days = doc.daysLeft === null ? 0 : Math.abs(doc.daysLeft);
  if (doc.status === DOC_STATUS.expired) return `${doc.label} expired ${days}d ago`;
  if (doc.status === DOC_STATUS.expiring) return `${doc.label} expires in ${days}d`;
  return `${doc.label} valid`;
}

/**
 * Same line, but never blank: a missing expiry is a data gap the desk must see
 * ("Insurance expiry not on file"), not something to silently omit.
 */
export function docNote(doc) {
  if (!doc) return '';
  if (doc.status === DOC_STATUS.untracked) return `${doc.label} expiry not on file`;
  return docSummaryLine(doc);
}
