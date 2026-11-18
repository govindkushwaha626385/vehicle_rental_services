/**
 * Pick the single trip a signed-in customer most needs to see when they land
 * on the storefront.
 *
 * Priority is deliberately operational, not chronological:
 *   1. An active rental — the car is out and the drop-off date is the thing
 *      the customer is most likely to need (extend it, check the time).
 *   2. The soonest confirmed/pending pick-up. A confirmed booking whose start
 *      date has already passed still wins, because the customer needs to know
 *      the pick-up was missed rather than being shown a later trip.
 *
 * Completed, cancelled and rejected bookings never qualify. The function is
 * pure so the choice can be contract-tested independently of the page.
 */
const UPCOMING_STATUSES = ['confirmed', 'pending'];

const byCode = (a, b) => String(a.code ?? '').localeCompare(String(b.code ?? ''));

export function nextTrip(bookings = []) {
  const list = Array.isArray(bookings) ? bookings.filter((booking) => booking?.status) : [];

  const active = list
    .filter((booking) => booking.status === 'active')
    // The rental that is due back first is the one to surface.
    .sort((a, b) => String(a.endDate ?? '').localeCompare(String(b.endDate ?? '')) || byCode(a, b));
  if (active.length) return active[0];

  const upcoming = list
    .filter((booking) => UPCOMING_STATUSES.includes(booking.status) && booking.startDate)
    .sort((a, b) => (
      String(a.startDate).localeCompare(String(b.startDate))
      // Same day: a confirmed trip is more certain than a pending one.
      || (a.status === b.status ? 0 : a.status === 'confirmed' ? -1 : 1)
      || byCode(a, b)
    ));
  return upcoming[0] ?? null;
}
