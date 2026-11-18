import { dayNumber, todayISO } from './pricing.js';
import { lateDays } from './returns.js';

/**
 * Trip countdown chips.
 *
 * Once a rental is out, "when is it due back?" is the single most important
 * line on the screen. This one formatter drives the chip on the account trip
 * card, the manage-booking page and the voucher hero, so every surface shows
 * the same, correctly-computed status:
 *
 *   active    → Overdue · Nd   / Due today · {time} / Due tomorrow /
 *               Returns in Nd
 *   confirmed → Pick-up today · {time} / Pick-up tomorrow / Starts in Nd
 *
 * Day arithmetic uses the same `lateDays` rule as the returns desk, so an
 * extended trip never shows a stale "overdue" label.
 */
export function tripCountdown(booking = {}, { today = todayISO() } = {}) {
  if (!booking || !booking.startDate || !booking.endDate) return null;

  if (booking.status === 'active') {
    const late = lateDays(booking, today);
    if (late > 0) return { key: 'overdue', days: late, labelHint: 'overdue' };
    const daysLeft = dayNumber(booking.endDate) - dayNumber(today);
    if (daysLeft <= 0) return { key: 'due_today', time: booking.dropoffTime || '10:00', labelHint: 'due_today' };
    if (daysLeft === 1) return { key: 'due_tomorrow', days: 1, labelHint: 'due_tomorrow' };
    return { key: 'returns_in', days: daysLeft, labelHint: 'returns_in' };
  }

  if (booking.status === 'confirmed' || booking.status === 'pending') {
    const untilStart = dayNumber(booking.startDate) - dayNumber(today);
    if (untilStart < 0) return { key: 'pickup_passed', days: -untilStart, labelHint: 'pickup_passed' };
    if (untilStart === 0) {
      return { key: 'starts_today', time: booking.pickupTime || '10:00', labelHint: 'starts_today' };
    }
    if (untilStart === 1) return { key: 'starts_tomorrow', days: 1, labelHint: 'starts_tomorrow' };
    return { key: 'starts_in', days: untilStart, labelHint: 'starts_in' };
  }

  return null;
}