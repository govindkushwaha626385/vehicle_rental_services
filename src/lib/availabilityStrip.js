import { addDaysISO, todayISO } from './pricing.js';

/**
 * Next-N-day availability strip for a vehicle detail page.
 *
 * Given the vehicle's upcoming occupied windows (bookings and workshop blocks
 * both arrive as { startDate, endDate } ranges), produce one cell per day with
 * a label and a reason. Pure + shared by the demo adapter, the Supabase RPC
 * adapter and the UI, so the strip is byte-for-byte identical in both backends.
 *
 * Windows follow the booking convention: `startDate` is occupied and `endDate`
 * is the day the vehicle is free again (`start <= day < end`). The quote
 * engine and the admin calendar use the same half-open rule, so "next free
 * day" can never be one day late.
 */

export const STRIP_DEFAULT_DAYS = 30;

const inRange = (range, date) => range.startDate <= date && date < range.endDate;

/** Cells for the next `days` days. `today` is injectable for tests. */
export function availabilityStrip({ upcoming = [], today = todayISO(), days = STRIP_DEFAULT_DAYS } = {}) {
  const ranges = Array.isArray(upcoming) ? upcoming : [];
  const cells = [];
  for (let index = 0; index < days; index += 1) {
    const date = addDaysISO(today, index);
    const busyRange = ranges.find((range) => inRange(range, date));
    cells.push({
      date,
      index,
      busy: Boolean(busyRange),
      reason: busyRange ? String(busyRange.reason || 'booked') : '',
    });
  }
  return cells;
}

/** How many of the next `days` days are open, plus the nearest free date. */
export function stripSummary(cells = []) {
  const open = cells.filter((cell) => !cell.busy);
  const firstOpen = open.length ? open[0] : null;
  return {
    openCount: open.length,
    total: cells.length,
    firstOpenDate: firstOpen ? firstOpen.date : null,
    fullyBooked: open.length === 0,
  };
}

/** True when any of the next `days` days is occupied. */
export function hasBusyDays(cells = []) {
  return cells.some((cell) => cell.busy);
}