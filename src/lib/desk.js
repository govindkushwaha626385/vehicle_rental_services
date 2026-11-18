import { ageFromDob, addDaysISO, isValidDate, todayISO } from './pricing.js';
import { BIKE_TYPES } from './constants.js';
import { DOC_STATUS, docNote, vehicleDocs } from './fleetDocs.js';
import { licenceExpiryProblem } from './validation.js';

/**
 * Pure handover checklist for the daily desk.
 *
 * Shared by the demo adapter, the Supabase adapter and the /admin/desk page so
 * the "is this pick-up ready?" logic lives in exactly one place. Everything is
 * guarded for missing driver/profile data — the page should never crash on an
 * incomplete booking.
 */

const isBikeBooking = (booking) => booking?.vehicle?.kind === 'bike'
  || BIKE_TYPES.includes(booking?.vehicle?.type);

/** Minimum eligible age for the booking's vehicle kind. */
export function minimumAge(booking = {}, policy = {}) {
  const base = isBikeBooking(booking)
    ? (Number(policy.minBikeAge) || 18)
    : (Number(policy.minAge) || 21);
  // A specific vehicle can be stricter than the site policy, but never more
  // permissive — the same rule the checkout validator applies.
  return Math.max(base, Number(booking?.vehicle?.minAge) || 0);
}

/** Driver age for a booking, or null when we cannot tell yet. */
export function driverAge(booking = {}) {
  const dob = String(booking?.driver?.dob ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const age = ageFromDob(dob);
  return Number.isFinite(age) ? age : null;
}

export const DESK_CHECK_KEYS = ['licence', 'age', 'insurance', 'payment', 'deposit'];

/**
 * Read-only legal-compliance signals for the vehicle about to be handed over.
 *
 * Ticking a box cannot renew an insurance policy, so these are deliberately
 * *not* part of the saved checklist. A lapsed insurance or PUC makes the rental
 * void, so the desk must see it even when the operator has not opted into
 * blocking handover.
 */
export function docWarnings(booking = {}, today = todayISO()) {
  const vehicle = booking?.vehicle;
  if (!vehicle) return [];
  const { docs } = vehicleDocs(vehicle, today);
  return Object.values(docs)
    .filter((doc) => doc.status !== DOC_STATUS.ok)
    .map((doc) => ({
      key: doc.key,
      label: doc.label,
      status: doc.status,
      daysLeft: doc.daysLeft,
      note: docNote(doc),
    }));
}

/**
 * Build the checklist for one booking.
 * status: 'ok' | 'todo' | 'warn' | 'info'
 */
export function deskChecklist(booking = {}, policy = {}, today = todayISO()) {
  const driver = booking?.driver || {};
  const licence = String(driver.license ?? '').trim();
  const licenceExpiry = String(driver.licenseExpiry ?? '').trim();
  const age = driverAge(booking);
  const minAge = minimumAge(booking, policy);
  const vehicleType = booking?.vehicle?.type || 'vehicle';
  const isBike = isBikeBooking(booking);
  const depositDue = Number(booking?.holdAmount) > 0;
  const depositRequired = policy?.requireDepositAtDesk === true && depositDue;
  const depositCollected = booking?.deskChecks?.deposit === true;
  // Same rule the customer met at checkout: the licence must stay valid until
  // the drop-off. An expiry that lands inside the rental makes the second half
  // of the trip illegal to drive, so it is a handover blocker like a lapsed
  // insurance document.
  const licenceProblem = licence ? licenceExpiryProblem(
    driver,
    { endDate: booking?.endDate },
    { policy },
  ) : null;

  const checks = [
    {
      key: 'licence',
      label: 'Driving licence',
      status: licence ? (licenceProblem ? 'warn' : 'ok') : 'todo',
      note: licence
        ? `${isBike ? 'MCWG/MCWOG' : 'LMV'} · ${licence}${isValidDate(licenceExpiry) ? ` · expiry ${licenceExpiry}` : ''}${licenceProblem ? ` — ${licenceProblem}` : ''}`
        : 'Licence number missing — enter it at the desk.',
    },
    {
      key: 'age',
      label: `${isBike ? 'Rider' : 'Driver'} age`,
      status: age === null ? 'todo' : age >= minAge ? 'ok' : 'warn',
      note: age === null
        ? `Date of birth missing — minimum ${minAge} years.`
        : `${age} years (minimum ${minAge})`,
    },
    {
      key: 'insurance',
      label: 'Insurance',
      status: 'info',
      note: booking?.insurance?.label || 'Standard',
    },
    {
      key: 'payment',
      label: 'Payment',
      status: 'info',
      note: booking?.paymentStatus || 'unpaid',
    },
    {
      key: 'deposit',
      label: 'Deposit due at pick-up',
      status: depositRequired && !depositCollected ? 'warn' : 'info',
      note: !depositDue
        ? 'No security deposit'
        : depositRequired && !depositCollected
          ? 'Collect the deposit, then tick this before handover'
          : 'Collect before handover',
    },
  ];

  const documents = docWarnings(booking, today);

  return {
    age,
    minAge,
    type: vehicleType,
    isBike,
    licensed: licence !== '',
    licenceValid: !Boolean(licenceProblem),
    checks,
    blocking: checks.filter((check) => check.status === 'warn' || check.status === 'todo'),
    docWarnings: documents,
    // Only an *expired* document blocks; an untracked date is a data gap.
    docsBlocking: documents.some((doc) => doc.status === DOC_STATUS.expired),
  };
}

/**
 * True when the handover checklist is fully cleared.
 *
 * `policy.blockExpiredDocs` (Admin → Settings) additionally refuses handover
 * while the vehicle's insurance or PUC has lapsed — the legally required
 * default in India, but opt-in so stale demo data cannot lock the desk.
 */
export function deskReady(booking = {}, policy = {}, today = todayISO()) {
  const checklist = deskChecklist(booking, policy, today);
  const basics = checklist.licensed && checklist.age !== null && checklist.age >= checklist.minAge;
  if (!basics) return false;
  // The licence must stay valid for the whole rental; an expiry inside the
  // rental makes the second half illegal to drive. Defaults on, switchable in
  // Admin → Settings like the other handover gates.
  if (policy?.licenceValidityRequired !== false && !checklist.licenceValid) return false;
  // The optional deposit gate: money in hand before the keys change hands.
  if (policy?.requireDepositAtDesk === true
    && Number(booking?.holdAmount) > 0
    && booking?.deskChecks?.deposit !== true) return false;
  if (policy?.blockExpiredDocs !== true) return true;
  return !checklist.docsBlocking;
}

/** Can the desk nudge this confirmed customer about their upcoming pick-up? */
export const pickupReminderEligible = (booking = {}, today = todayISO()) => {
  if (booking?.status !== 'confirmed') return false;
  const start = String(booking?.startDate ?? '');
  return start === today || start === addDaysISO(today, 1);
};

/** Collapse a checklist into the persisted map keyed by check option. */
export function deskCheckPayload(checked = []) {
  const payload = {};
  DESK_CHECK_KEYS.forEach((key) => { payload[key] = checked?.includes?.(key) === true; });
  return payload;
}

export const activeChecks = (payload = {}) => Object.entries(payload)
  .filter(([, value]) => value === true)
  .map(([key]) => key);

// ---------------------------------------------------------------------------
// Desk board filtering
//
// The pick-up board can carry a week of handovers plus overdue no-shows. Staff
// standing at the counter need to find one person fast and see what still
// needs work. Both helpers are pure so the demo adapter, the Supabase adapter
// and the page share one definition of "today" and "needs attention".
// ---------------------------------------------------------------------------

const boardHaystack = (booking = {}) => [
  booking.code,
  booking.customer?.name,
  booking.customer?.email,
  booking.driver?.phone,
  booking.driver?.license,
  booking.vehicle?.name,
  booking.vehicle?.registrationNumber,
  booking.pickupLocation,
  booking.dropoffLocation,
].filter(Boolean).join(' ').toLowerCase();

/** A booking needs attention when it is overdue or the handover is not ready. */
export function deskNeedsAttention(booking = {}, policy = {}, today = todayISO()) {
  if (String(booking.startDate ?? '') < today) return true;
  return !deskReady(booking, policy, today);
}

/** Counts for the scope chips above the board. */
export function deskBoardCounts(bookings = [], { today = todayISO(), policy = {} } = {}) {
  return bookings.reduce((counts, booking) => {
    counts.all += 1;
    if (booking.startDate === today) counts.today += 1;
    if (deskNeedsAttention(booking, policy, today)) counts.attention += 1;
    return counts;
  }, { all: 0, today: 0, attention: 0 });
}

/**
 * Narrow the board by a free-text query and a scope. `scope` is one of
 * `all`, `today` or `attention`; an unknown scope behaves like `all`.
 */
export function filterDeskBookings(bookings = [], { query = '', scope = 'all', today = todayISO(), policy = {} } = {}) {
  const needle = String(query).trim().toLowerCase();
  return bookings.filter((booking) => {
    if (scope === 'today' && booking.startDate !== today) return false;
    if (scope === 'attention' && !deskNeedsAttention(booking, policy, today)) return false;
    return !needle || boardHaystack(booking).includes(needle);
  });
}