import { daysBetween, isValidDate, toISO } from './pricing.js';

/**
 * Trip-extension engine.
 *
 * Real rentals spend most of their "help!" hours on one question: the return
 * is due and the customer needs more time — another hour, the rest of today,
 * or a couple of extra days. This module is the single guard used by the
 * storefront (self-serve extension), the admin desk (quick extension at the
 * drop-off point) and both adapters, so every surface rejects the same
 * impossible proposals:
 *
 *  - the new drop-off must be strictly later than the booked one;
 *  - the new drop-off must not be in the past (a same-day slot the clock has
 *    already passed is rejected, nudging the customer to pick a later one);
 *  - an extension must never create an over-long contract (policy.maxDays);
 *  - a proposal that leaves the end date before the trip started is nonsense
 *    and is rejected by the same "later than the current drop-off" rule.
 *
 * Pricing is deliberately NOT validated here: the adapters re-quote through
 * the same engine used at checkout, so previews and approvals always agree.
 */

const pad = (value) => String(value).padStart(2, '0');

// Extensions happen at real-world drop-off moments, often outside the
// booking's 7am–8pm slot list ("I'll be there at 10:30pm"). The validator
// accepts any valid 24h clock time instead of the offered slot list.
export const EXTEND_TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Wall-clock epoch (local) for a date + drop-off slot. */
const slotEpoch = (iso = '2026-01-01', time = '10:00') => {
  if (!isValidDate(iso)) return Number.NaN;
  const [hour, minute] = String(time).split(':').map(Number);
  return new Date(`${iso}T${pad(Number.isFinite(hour) ? hour : 10)}:${pad(Number.isFinite(minute) ? minute : 0)}:00`).getTime();
};

/**
 * Validate an extension proposal. Returns a human-facing error string when
 * the change is invalid, otherwise `null`.
 *
 * @param booking       the active booking (endDate, dropoffTime, startDate)
 * @param next          { endDate, dropoffTime }
 * @param policy        { maxDays } from sitePolicy()
 * @param now           clock injectable for tests
 */
export function extendProblem(booking = {}, next = {}, { policy = {}, now = new Date() } = {}) {
  const endDate = next?.endDate;
  const dropoffTime = next?.dropoffTime;
  if (!isValidDate(endDate) || typeof dropoffTime !== 'string' || !EXTEND_TIME_RE.test(dropoffTime)) {
    return 'Choose a valid return date and drop-off slot.';
  }
  const currentEnd = booking?.endDate;
  if (!isValidDate(currentEnd)) return 'Choose a valid return date.';

  const proposed = slotEpoch(endDate, dropoffTime);
  const current = slotEpoch(currentEnd, booking.dropoffTime || '10:00');
  if (proposed <= current) return 'The new return must be later than the current drop-off.';
  // The clock check covers both "already returned" and "that time has passed
  // today" without a second date comparison — and stays injectable for tests.
  if (proposed <= now.getTime()) return 'This return time has already passed — choose a later date or time.';

  const totalDays = daysBetween(booking.startDate, endDate);
  if (Number.isFinite(totalDays) && Number(policy.maxDays) > 0 && totalDays > Number(policy.maxDays)) {
    return `Rentals are limited to ${policy.maxDays} days.`;
  }
  return null;
}

/**
 * Is self-serve trip extension switched on for this storefront? Reads the
 * same `extensions_enabled` setting exposed to the Content console. Defaults
 * to on, matching the change-request toggle.
 */
export const extensionsEnabled = (settings = {}) => String(settings?.extensions_enabled ?? 'true') !== 'false';

/**
 * Move a drop-off proposal forward by whole hours, rolling across midnight
 * cleanly. Used by the "+1 hour / +3 hours" quick actions on both the
 * customer modal and the desk form.
 */
export function advanceEnd({ endDate, dropoffTime } = {}, hours = 0) {
  if (!isValidDate(endDate) || typeof dropoffTime !== 'string' || !EXTEND_TIME_RE.test(dropoffTime)) {
    return { endDate, dropoffTime };
  }
  const [year, month, day] = endDate.split('-').map(Number);
  const [hh, mm] = dropoffTime.split(':').map(Number);
  const total = hh * 60 + mm + Number(hours) * 60;
  const rolled = ((total % 1440) + 1440) % 1440;
  const dayOffset = Math.floor(total / 1440);
  return {
    endDate: toISO(new Date(Date.UTC(year, month - 1, day + dayOffset))),
    dropoffTime: `${pad(Math.floor(rolled / 60))}:${pad(rolled % 60)}`,
  };
}

/**
 * The next drop-off slot on or after `when` (defaults to now), rounded up to
 * the rental grid. A late customer seeded here gets presets that mean "+2
 * hours from right now", which is exactly what "I'll be there in two hours"
 * means on the phone.
 */
export function nextSlotAfter(when = new Date()) {
  const minutes = when.getHours() * 60 + when.getMinutes();
  const slot = Math.ceil(minutes / 30) * 30;
  const date = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  const day = toISO(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
  if (slot >= 1440) {
    return { endDate: addDays(day, 1), dropoffTime: '00:00' };
  }
  return { endDate: day, dropoffTime: `${pad(Math.floor(slot / 60))}:${pad(slot % 60)}` };
}

const addDays = (iso, amount) => {
  const [year, month, day] = iso.split('-').map(Number);
  return toISO(new Date(Date.UTC(year, month - 1, day + amount)));
};

/**
 * A sensible starting proposal for an extension form. An upcoming return
 * starts from the booked end; a trip whose drop-off slot has already passed
 * (even by a few minutes, on the same day) starts from the next slot after
 * now so the "+2 hours" presets mean "two hours from right now" rather than
 * re-proposing a time the validator will reject.
 */
export function defaultExtension(booking, now = new Date()) {
  if (!booking) {
    const day = toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
    return { endDate: addDays(day, 1), dropoffTime: '10:00' };
  }
  const endDate = booking.endDate;
  const dropoffTime = booking.dropoffTime || '10:00';
  if (isValidDate(endDate) && EXTEND_TIME_RE.test(dropoffTime)
    && slotEpoch(endDate, dropoffTime) > now.getTime()) {
    return { endDate, dropoffTime };
  }
  const slot = nextSlotAfter(now);
  // `nextSlotAfter` rounds up to the half-hour grid and may land exactly on
  // the current minute (e.g. 18:00 at 18:00). Extensions must be strictly
  // later, so nudge a boundary hit one slot forward.
  if (slotEpoch(slot.endDate, slot.dropoffTime) <= now.getTime()) {
    return advanceEnd(slot, 0.5);
  }
  return slot;
}
