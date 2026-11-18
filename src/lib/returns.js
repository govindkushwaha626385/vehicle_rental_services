import { todayISO, addDaysISO, daysBetween, isValidDate } from './pricing.js';
import { localDay, shortDate } from './format.js';
import { excessKm, kmDriven } from './km.js';

/**
 * Return & deposit-settlement engine.
 *
 * One pure module shared by the demo adapter, the Supabase adapter and the
 * desk UI. Deposits are due at pick-up, so settlement is always a staff action
 * at drop-off: inspect, deduct for late/damage/cleaning, release the rest.
 * Everything is guarded — missing dates, missing inspections and zero deposits
 * all resolve to safe numbers.
 */

export const RETURN_CHECK_KEYS = Object.freeze(['keys', 'fuel', 'condition', 'cleaning', 'deposit']);

export const RETURN_CHECK_LABELS = Object.freeze({
  keys: 'Keys & documents',
  fuel: 'Fuel level recorded',
  condition: 'Walk-around & photos',
  cleaning: 'Cleaning check',
  deposit: 'Deposit settlement agreed',
});

export const FUEL_LEVELS = Object.freeze(['Full', '3/4', '1/2', '1/4', 'Empty']);

// How the released remainder of the deposit travels back to the customer.
// Mirrors the deposit-collection methods so the pick-up and drop-off sides of
// the same float read the same vocabulary.
export const REFUND_METHODS = Object.freeze(['original', 'bank', 'upi', 'cash', 'other']);

export const REFUND_METHOD_LABELS = Object.freeze({
  original: 'original payment method',
  bank: 'bank transfer',
  upi: 'UPI',
  cash: 'cash',
  other: 'other',
});

export const SEVERITIES = Object.freeze(['none', 'minor', 'moderate', 'major']);

export const SETTLEMENT_LABELS = Object.freeze({
  released: 'Deposit released',
  partial: 'Partially released',
  settled: 'Fully deducted',
  extra: 'Extra payment due',
});

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
// The ₹1,00,000 ceiling applies to each *input* (damage, cleaning, the legacy
// per-day late rate) and is enforced by `inspectionPayload`. It must not clamp
// a computed total: a 20-day late return at ₹12,000/day is ₹2,40,000 and the
// customer owes it, not a silently reduced ₹1,00,000. The hourly late total is
// validated as a total (up to ₹10,00,000) for the same reason.
const money = (value) => Math.max(0, Math.round(num(value)));
// A security deposit is allowed to be much larger than an individual damage or
// cleaning charge (rate rules cap it at ₹10,00,000). Clamping it to the charge
// ceiling would silently under-refund the customer.
const depositMoney = (value) => Math.max(0, Math.min(10000000, Math.round(num(value))));
const DAY_MS = 86_400_000;
const parseDate = (value) => {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : null;
};
const instant = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return parseDate(value);
};

/**
 * Whole hours the vehicle is late against the drop-off date **and time**,
 * after the admin grace window. This is the billing clock: a car due back at
 * 18:00 and returned at 09:00 the next morning is 15 hours late, not "one
 * day", so it is never charged a full 24-hour block for a part-day overrun.
 * Date-only statuses (`lateDays`) stay calendar-based on purpose — they drive
 * the ops queue, not the money.
 */
export function lateHours(booking = {}, at = new Date(), graceMinutes = 0) {
  const date = String(booking.endDate ?? '').slice(0, 10);
  const time = String(booking.dropoffTime || '10:00').slice(0, 5);
  const due = Date.parse(`${date}T${time}:00`);
  const reference = booking.status === 'completed' && booking.completedAt
    ? instant(booking.completedAt)
    : instant(at);
  if (!Number.isFinite(due) || reference === null) return 0;
  const grace = Math.max(0, Math.round(num(graceMinutes))) * 60_000;
  const overrun = reference - due - grace;
  return overrun > 0 ? Math.ceil(overrun / 3_600_000) : 0;
}

/**
 * Late fee for a return, in the currency the customer was promised:
 * `lateFeePerHour` for every started hour after the grace window, capped so a
 * part-day can never cost more than a full day. Complete 24-hour blocks bill
 * at the daily rate. Both rates come from the one admin policy figure
 * (`lateFeePerDay = lateFeePerHour × 24`).
 */
export function lateCharge(booking = {}, rates = {}, at = new Date()) {
  const hourlyRaw = Math.max(0, Math.round(num(rates.lateFeePerHour)));
  const dailyRaw = Math.max(0, Math.round(num(rates.lateFeePerDay)));
  const graceMinutes = Math.max(0, Math.round(num(rates.graceMinutes)));
  const hours = lateHours(booking, at, graceMinutes);
  const dailyRate = dailyRaw > 0 ? dailyRaw : hourlyRaw * 24;
  const hourlyRate = hourlyRaw > 0 ? hourlyRaw : dailyRate > 0 ? dailyRate / 24 : 0;
  if (!hours) {
    return { hours: 0, days: 0, partialHours: 0, charge: 0, hourlyRate: Math.round(hourlyRate), dailyRate, graceMinutes };
  }
  const days = Math.floor(hours / 24);
  const partialHours = hours % 24;
  const partial = Math.min(Math.round(partialHours * hourlyRate), dailyRate || 0);
  const charge = days * dailyRate + partial;
  return { hours, days, partialHours, charge, hourlyRate: Math.round(hourlyRate), dailyRate, graceMinutes };
}

/** Compact human duration for a late return: "5h", "1d", "3d 4h". */
export function lateDuration(hours = 0) {
  const total = Math.max(0, Math.round(num(hours)));
  if (!total) return '0h';
  const days = Math.floor(total / 24);
  const rest = total % 24;
  if (!days) return `${rest}h`;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** Whole days the vehicle is late against the booking end date. */
export function lateDays(booking = {}, today = todayISO()) {
  // Active trips are late up to today. Completed trips are judged against
  // their recorded completion date. A completed-but-unsettled return with no
  // record of when it closed is still open on the returns desk, so it stays
  // late up to today instead of silently forgiving every late day (which
  // would settle a months-overdue deposit with ₹0 in late charges).
  const reference = booking.status === 'completed' && booking.completedAt
    ? localDay(booking.completedAt)
    : today;
  const end = parseDate(booking.endDate);
  const now = parseDate(reference);
  if (end === null || now === null) return 0;
  return Math.max(0, Math.round((now - end) / DAY_MS));
}

/** Is this booking still open on the returns desk? */
export function isReturnOpen(booking = {}) {
  if (booking.depositSettlement) return false;
  if (booking.status === 'active') return true;
  return booking.status === 'completed';
}

/** Per-booking return checklist, derived from the booking + inspection. */
export function returnChecklist(booking = {}, options = {}) {
  const { today = todayISO(), checked = [] } = options;
  const saved = new Set(Array.isArray(checked) ? checked : []);
  const late = lateDays(booking, today);
  const inspection = booking.inspection ?? null;
  const deposit = num(booking.holdAmount);
  const items = [
    { key: 'keys', status: 'todo', note: 'Collect keys, RC and both documents.' },
    {
      key: 'fuel',
      status: inspection?.fuel ? 'ok' : 'todo',
      note: inspection?.fuel ? `Returned at ${inspection.fuel}` : 'Record the fuel level at drop-off.',
    },
    {
      key: 'condition',
      status: inspection ? 'ok' : 'todo',
      note: inspection
        ? (num(inspection.damageFee) > 0 ? 'Damage recorded with a charge' : 'No chargeable damage recorded')
        : 'Walk around the vehicle and capture photos.',
    },
    {
      key: 'cleaning',
      status: inspection ? 'ok' : 'todo',
      note: inspection ? (num(inspection.cleaningFee) > 0 ? 'Cleaning fee applied' : 'Returned clean') : 'Check interior and exterior cleaning.',
    },
    {
      key: 'deposit',
      status: deposit > 0 ? 'info' : 'ok',
      note: deposit > 0 ? 'Settle before closing' : 'No deposit held on this booking',
    },
  ];
  if (late > 0) {
    items.push({
      key: 'late',
      status: 'warn',
      note: `${late} day${late === 1 ? '' : 's'} late — the late fee is included in the settlement.`,
    });
  }
  return {
    lateDays: late,
    deposit,
    checked: saved,
    ready: RETURN_CHECK_KEYS.every((key) => saved.has(key)),
    checks: items,
  };
}

/**
 * Validate the inspection form. Returns the clean inspection payload the
 * adapters persist (timestamps are added by the caller).
 */
export function inspectionPayload({
  fuel = 'Full',
  damageFee = 0,
  cleaningFee = 0,
  fuelFee = 0,
  lateFeePerDay = 0,
  lateFee = null,
  damageNote = '',
  severity = 'none',
} = {}) {
  if (!FUEL_LEVELS.includes(fuel)) throw new Error('Choose a valid fuel level.');
  if (!SEVERITIES.includes(severity)) throw new Error('Choose a valid damage severity.');
  const note = String(damageNote ?? '').trim();
  if (note.length > 500) throw new Error('Keep the damage note under 500 characters.');
  const amounts = [
    ['Damage', damageFee],
    ['Cleaning', cleaningFee],
    ['Refuelling', fuelFee],
    ['Late fee', lateFeePerDay],
  ];
  amounts.forEach(([label, value]) => {
    if (!Number.isInteger(Number(value))) throw new Error('Enter whole-rupee amounts.');
    // Silently clamping a typo (200000 → 100000) would settle the wrong money,
    // so out-of-range charges are rejected instead.
    if (Number(value) < 0) throw new Error(`${label} cannot be negative.`);
    if (Number(value) > 100000) throw new Error(`Keep the ${label.toLowerCase()} under ₹1,00,000.`);
  });
  // The desk bills late time as one computed amount (hourly, daily-capped), so
  // it is validated as a total rather than a per-day rate. Long overruns can
  // legitimately exceed the per-day ceiling.
  const lateTotal = lateFee === null || lateFee === undefined || lateFee === '' ? null : Number(lateFee);
  if (lateTotal !== null) {
    if (!Number.isInteger(lateTotal)) throw new Error('Enter whole-rupee amounts.');
    if (lateTotal < 0) throw new Error('Late fee cannot be negative.');
    if (lateTotal > 1000000) throw new Error('Keep the late fee under ₹10,00,000.');
  }
  if (money(damageFee) > 0 && note.length < 3) throw new Error('Add a short note for any damage charge.');
  return {
    fuel,
    severity: money(damageFee) > 0 ? severity : 'none',
    damageFee: money(damageFee),
    cleaningFee: money(cleaningFee),
    fuelFee: money(fuelFee),
    lateFeePerDay: money(lateFeePerDay),
    lateFee: lateTotal === null ? null : money(lateTotal),
    damageNote: note,
  };
}

/**
 * Deposit settlement maths. Never negative, never silently swallows an
 * overage: charges beyond the deposit become an explicit extra amount due.
 */
export function settlementFor({
  holdAmount = 0,
  lateDays: late = 0,
  lateFeePerDay = 0,
  lateFee = null,
  lateHours: hoursLate = 0,
  damageFee = 0,
  cleaningFee = 0,
  fuelFee = 0,
  excessKmFee = 0,
} = {}) {
  const deposit = depositMoney(holdAmount);
  const days = Math.max(0, Math.round(num(late)));
  const perDay = money(lateFeePerDay);
  // `lateFee` is the desk's computed total (hourly, daily-capped, grace-aware).
  // It wins when present; older callers keep the day-block maths.
  const explicitLate = lateFee === null || lateFee === undefined || lateFee === ''
    ? null
    : money(lateFee);
  const lateAmount = explicitLate ?? money(days * perDay);
  const damage = money(damageFee);
  const cleaning = money(cleaningFee);
  // Refuelling is the admin-set service fee (plus any fuel cost the operator
  // enters) for a vehicle that comes back below its hand-over level.
  const fuel = money(fuelFee);
  // Excess distance is a computed charge, not a free-text fee: the adapter
  // derives it from the two odometer readings and the vehicle's allowance, so
  // it arrives here as a number. Like late fees it is never clamped to the
  // per-charge ceiling; a long trip can legitimately owe more.
  const excess = money(excessKmFee);
  const charges = lateAmount + damage + cleaning + fuel + excess;
  const refundDue = Math.max(0, deposit - charges);
  const extraDue = Math.max(0, charges - deposit);
  const status = charges === 0
    ? 'released'
    : refundDue > 0 ? 'partial' : extraDue > 0 ? 'extra' : 'settled';
  return {
    deposit,
    lateDays: days,
    lateHours: Math.max(0, Math.round(num(hoursLate))),
    lateFee: lateAmount,
    damageFee: damage,
    cleaningFee: cleaning,
    fuelFee: fuel,
    excessKmFee: excess,
    charges,
    refundDue,
    extraDue,
    status,
    label: SETTLEMENT_LABELS[status],
  };
}

/** Build the full settlement record persisted on the booking. */
export function settlementRecord({
  booking = {},
  inspection = {},
  checked = [],
  today = todayISO(),
  waiveKm = false,
  refundMethod = null,
} = {}) {
  if (booking.depositSettlement) throw new Error('This return has already been settled.');
  const payload = inspectionPayload(inspection);
  const days = lateDays(booking, today);
  const pickupOdometer = booking.pickupOdometer ?? booking.pickupInspection?.odometer ?? null;
  const returnOdometer = inspection?.odometer;
  const driven = kmDriven({ odometer: pickupOdometer }, { odometer: returnOdometer });
  const km = excessKm({
    driven,
    kmCap: booking.kmCap ?? booking.vehicle?.kmCap,
    kmExtraRate: booking.kmExtraRate ?? booking.vehicle?.kmExtraRate,
    startDate: booking.startDate,
    endDate: booking.endDate,
    days: booking.days,
    waived: waiveKm,
  });
  const totals = settlementFor({
    holdAmount: booking.holdAmount,
    lateDays: days,
    lateHours: lateHours(booking),
    lateFeePerDay: payload.lateFeePerDay,
    lateFee: payload.lateFee,
    damageFee: payload.damageFee,
    cleaningFee: payload.cleaningFee,
    fuelFee: payload.fuelFee,
    excessKmFee: km.fee,
  });
  const settlement = {
    ...totals,
    kmAllowance: km.allowance,
    kmDriven: driven,
    excessKm: km.excess,
    excessKmRate: km.rate,
    kmWaived: km.waived,
    currency: 'INR',
    chargedAt: null,
    checkedBy: 'staff',
  };
  // How the released remainder goes back to the customer. Memory collected at
  // pick-up (method) is settled here (refund method); only a genuine refund
  // records a route — a fully-deducted or extra-due settlement sends nothing.
  if (settlement.refundDue > 0 && REFUND_METHODS.includes(refundMethod)) {
    settlement.refundMethod = refundMethod;
  }
  return {
    checked: RETURN_CHECK_KEYS.filter((key) => (Array.isArray(checked) ? checked : []).includes(key)),
    inspection: { ...payload, recordedAt: null },
    settlement,
    vehicles: booking.vehicleId ?? booking.vehicle?.id ?? null,
  };
}

export function returnForecast(bookings = [], today = todayISO()) {
  const open = (Array.isArray(bookings) ? bookings : []).filter((booking) => isReturnOpen(booking));
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addDaysISO(today, index);
    days.push({
      label: shortDate(date),
      value: open.filter((booking) => booking.endDate === date).length,
    });
  }
  return {
    days,
    dueToday: days[0]?.value ?? 0,
    next7: open.filter((booking) => booking.endDate >= today && booking.endDate <= addDaysISO(today, 6)).length,
  };
}

export function returnCheckPayload(checked = []) {
  const list = Array.isArray(checked) ? checked : [];
  return Object.fromEntries(RETURN_CHECK_KEYS.map((key) => [key, list.includes(key)]));
}

/**
 * On-time vs late return mix for settled trips.
 *
 * The settlement stores the number of late days at drop-off, so this reads
 * the authoritative figure instead of re-deriving it from dates (a completed
 * trip counts exactly the lateness it was settled with). Customers who
 * legitimately extend before returning appear as on-time here — they did not
 * breach the agreement.
 */
export function returnTimeliness(bookings = []) {
  const settled = (Array.isArray(bookings) ? bookings : [])
    .filter((booking) => booking?.depositSettlement)
    .map((booking) => {
      const lateDays = Math.max(0, Math.round(Number(booking.depositSettlement?.lateDays) || 0));
      const hours = Math.max(0, Math.round(Number(booking.depositSettlement?.lateHours) || 0));
      // Hour-level billing records sub-day lateness; legacy settlements only
      // stored whole days. Both are read without inventing lateness.
      return { lateDays, lateHours: hours || lateDays * 24 };
    });
  const late = settled.filter((row) => row.lateHours > 0).length;
  const onTime = settled.length - late;
  const totalLateHours = settled.reduce((sum, row) => sum + row.lateHours, 0);
  return {
    settled: settled.length,
    onTime,
    late,
    onTimeRate: settled.length ? Math.round((onTime / settled.length) * 100) : 0,
    avgLateDays: late ? Math.round((totalLateHours / 24 / late) * 10) / 10 : 0,
  };
}

/**
 * Which vehicles get returned late, and how much the late fees earn.
 *
 * One row per vehicle with at least one settled return. Hour-level billing
 * (`lateHours`) reads sub-day lateness; legacy whole-day settlements roll up to
 * hours so both are comparable. Sorted by most-late-hours first so the
 * operator sees the worst offenders on top.
 */
export function lateReturnsByVehicle(bookings = []) {
  const map = new Map();
  (Array.isArray(bookings) ? bookings : []).forEach((booking) => {
    const settlement = booking?.depositSettlement;
    if (!settlement) return;
    const key = booking.vehicle?.name || booking.vehicleId || 'Unknown';
    const row = map.get(key) ?? { vehicle: key, returns: 0, late: 0, lateHours: 0, lateFees: 0 };
    row.returns += 1;
    const hours = Math.max(0, Math.round(Number(settlement.lateHours) || 0))
      || (Math.max(0, Math.round(Number(settlement.lateDays) || 0)) * 24);
    if (hours > 0) { row.late += 1; row.lateHours += hours; }
    row.lateFees += Math.max(0, Math.round(Number(settlement.lateFee) || 0));
    map.set(key, row);
  });
  return [...map.values()].sort(
    (a, b) => b.lateHours - a.lateHours || b.lateFees - a.lateFees || String(a.vehicle).localeCompare(String(b.vehicle)),
  );
}

/**
 * Vehicles that keep coming back late — the "repeat offender" set.
 *
 * Counts settled late returns in the last `windowDays` (90 by default) and
 * returns vehicles that reached `threshold` or more. The desk shows this flag
 * before the next handover, because a pattern is cheapest to interrupt the
 * moment it is visible. Settlements are dated by their `settledAt` (falling
 * back to the booking's endDate/createdAt) so a run of old returns ages out.
 */
export function lateRepeatOffenders(bookings = [], { threshold = 3, windowDays = 90, today = todayISO() } = {}) {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const windowStart = cutoff.toISOString().slice(0, 10);
  const counts = new Map();
  (Array.isArray(bookings) ? bookings : []).forEach((booking) => {
    const settlement = booking?.depositSettlement;
    if (!settlement) return;
    const when = String(settlement.settledAt || booking?.endDate || booking?.createdAt || '').slice(0, 10);
    if (!when || when < windowStart) return;
    const hours = Math.max(0, Math.round(Number(settlement.lateHours) || 0))
      || (Math.max(0, Math.round(Number(settlement.lateDays) || 0)) * 24);
    if (hours <= 0) return;
    const key = booking.vehicle?.name || booking.vehicleId || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([vehicle, count]) => ({ vehicle, lateReturns: count }))
    .sort((a, b) => b.lateReturns - a.lateReturns || String(a.vehicle).localeCompare(String(b.vehicle)));
}

/** Analytics roll-up for the deposit book. Safe on partial/legacy rows. */
export function returnsSummary(bookings = [], today = todayISO()) {
  const list = Array.isArray(bookings) ? bookings : [];
  const settled = list.filter((booking) => booking.depositSettlement);
  // Completed-but-unsettled returns still hold the customer's deposit, so they
  // belong in the float just like active trips — and are a distinct settlement
  // backlog the desk can clear before the money sits on the books.
  const open = list.filter((booking) => isReturnOpen(booking));
  const awaiting = list.filter((booking) => booking.status === 'completed' && !booking.depositSettlement);
  const sum = (field) => settled.reduce((total, booking) => total + num(booking.depositSettlement?.[field]), 0);
  // Only money actually taken out of the deposit counts as "deducted"; charges
  // beyond the deposit are collected separately as extraDue.
  const deductedFromDeposit = (booking) => {
    const charges = num(booking.depositSettlement?.charges);
    const deposit = num(booking.depositSettlement?.deposit) || num(booking.holdAmount);
    return Math.min(charges, deposit);
  };
  return {
    settled: settled.length,
    depositsHeld: open.reduce((total, booking) => total + num(booking.holdAmount), 0),
    depositsReleased: settled.reduce((total, booking) => total + num(booking.depositSettlement?.refundDue), 0),
    depositsDeducted: settled.reduce((total, booking) => total + deductedFromDeposit(booking), 0),
    damageRecovered: sum('damageFee'),
    lateFees: sum('lateFee'),
    cleaningFees: sum('cleaningFee'),
    fuelFees: sum('fuelFee'),
    excessKmFees: sum('excessKmFee'),
    excessKm: settled.reduce((total, booking) => total + num(booking.depositSettlement?.excessKm), 0),
    extraDue: settled.reduce((total, booking) => total + num(booking.depositSettlement?.extraDue), 0),
    // "Overdue return" means the vehicle has not come back yet; a completed but
    // unsettled trip is a settlement task, not a missing vehicle.
    overdue: open.filter((booking) => booking.status === 'active' && lateDays(booking, today) > 0).length,
    awaiting: awaiting.length,
    awaitingAmount: awaiting.reduce((total, booking) => total + num(booking.holdAmount), 0),
    // How long the backlog has been sitting: settle the oldest first releases
    // deposits (and customer goodwill) sooner.
    awaitingAvgDays: awaiting.length
      ? Math.round(awaiting.reduce((total, booking) => total + settlementWaitDays(booking, today), 0) / awaiting.length)
      : 0,
    awaitingMaxDays: maxAwaitingDays(awaiting, today),
    // How the released money travels back, for the refund-methods chart.
    refundsByMethod: REFUND_METHODS.map((method) => ({
      method,
      count: settled.filter((booking) => (
        num(booking.depositSettlement?.refundDue) > 0
        && (booking.depositSettlement?.refundMethod ?? 'original') === method
      )).length,
    })).filter((row) => row.count > 0),
  };
}

/**
 * Whole days a completed-but-unsettled deposit has been waiting for the desk,
 * measured from the recorded completion date (or the booked end date when the
 * completion stamp is missing) up to `today`. Never negative, and `today` is
 * injectable so tests (and the desk's "settle the oldest first" triage) stay
 * deterministic.
 */
export function settlementWaitDays(booking = {}, today = todayISO()) {
  if (booking.status !== 'completed' || booking.depositSettlement) return 0;
  const datePart = String(booking.completedAt ?? '').slice(0, 10);
  const from = isValidDate(datePart) ? datePart : booking.endDate;
  return isValidDate(from) ? Math.max(0, daysBetween(from, today)) : 0;
}

/**
 * The longest single wait in the settlement backlog — "settle the oldest
 * first" made concrete. Shared by the desk header and the analytics card so
 * both quote the same number.
 */
export const maxAwaitingDays = (bookings = [], today = todayISO()) =>
  (Array.isArray(bookings) ? bookings : [])
    .reduce((max, booking) => Math.max(max, settlementWaitDays(booking, today)), 0);

/**
 * Deposit-settlement refunds rendered as transaction rows for the customer's
 * own ledger. Deposit money moves at the desk, so these refunds never appear
 * in the online payment rows — this surfaces them ("where is my deposit?").
 * `createdAt` falls back through completion to the booked end so the row is
 * always sortable alongside real payments.
 */
export const depositRefundRows = (bookings = []) =>
  (Array.isArray(bookings) ? bookings : [])
    .filter((booking) => Math.max(0, Number(booking.depositSettlement?.refundDue) || 0) > 0)
    .map((booking) => ({
      id: `deposit-refund-${booking.id}`,
      kind: 'refund',
      amount: Math.max(0, Number(booking.depositSettlement.refundDue) || 0),
      createdAt: booking.depositSettlement?.chargedAt || booking.completedAt || booking.endDate,
      bookingCode: booking.code,
      vehicle: booking.vehicle?.name,
      depositRefund: true,
    }));

/**
 * Customer-facing summary of one booking's security deposit.
 *
 * The confirmation page shows the full settlement breakdown; this compact
 * outcome is for the Account trip list so a returning customer can see at a
 * glance whether the deposit is still held, awaiting settlement, refunded or
 * partly deducted — without opening the voucher.
 *
 * Returns { key, amount } or null. Keys map to admin-editable copy:
 *   refunded | deducted | extra | released | held | awaiting
 */
export function depositOutcome(booking = {}) {
  const settlement = booking?.depositSettlement;
  if (settlement) {
    const refundDue = Math.max(0, num(settlement.refundDue));
    const charges = Math.max(0, num(settlement.charges));
    const extraDue = Math.max(0, num(settlement.extraDue));
    if (extraDue > 0) return { key: 'extra', amount: extraDue };
    if (refundDue > 0) return { key: 'refunded', amount: refundDue };
    if (charges > 0) return { key: 'deducted', amount: charges };
    return { key: 'released', amount: 0 };
  }
  const hold = Math.max(0, num(booking?.holdAmount));
  if (hold <= 0) return null;
  if (booking?.status === 'active') return { key: 'held', amount: hold };
  if (booking?.status === 'completed') return { key: 'awaiting', amount: hold };
  // Not yet picked up? The deposit is what the customer must carry to the
  // desk — a "due at pick-up" reminder beats a blank card.
  if (booking?.status === 'confirmed' || booking?.status === 'pending') return { key: 'due', amount: hold };
  return null;
}

/**
 * Narrow the returns board by a free-text query so a customer standing at the
 * counter can be found by name, code, phone, plate or drop-off hub.
 */
export function filterReturnBookings(bookings = [], query = '') {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return Array.isArray(bookings) ? bookings : [];
  return (Array.isArray(bookings) ? bookings : []).filter((booking) => [
    booking.code,
    booking.customer?.name,
    booking.customer?.email,
    booking.driver?.phone,
    booking.vehicle?.name,
    booking.vehicle?.registrationNumber,
    booking.dropoffLocation,
    booking.pickupLocation,
  ].filter(Boolean).join(' ').toLowerCase().includes(needle));
}
