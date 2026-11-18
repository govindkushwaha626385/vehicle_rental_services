/**
 * Notification preferences shared by the demo adapter, the Supabase adapter
 * and the account page. One definition of keys/defaults keeps every surface
 * in agreement.
 */

export const NOTIFICATION_PREF_KEYS = Object.freeze([
  'booking_confirmed',
  'trip_updates',
  'cancellations_refunds',
  'promotions',
]);

export const DEFAULT_NOTIFICATION_PREFS = Object.freeze({
  booking_confirmed: true,
  trip_updates: true,
  cancellations_refunds: true,
  promotions: false,
});

/** Fold any stored shape into the canonical four booleans. */
export function normalizeNotificationPrefs(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  NOTIFICATION_PREF_KEYS.forEach((key) => {
    out[key] = typeof source[key] === 'boolean' ? source[key] : DEFAULT_NOTIFICATION_PREFS[key];
  });
  return out;
}

/** True when the given patch only touches known boolean keys. */
export function validNotificationPrefs(patch = {}) {
  return Object.entries(patch).every(([key, value]) => (
    NOTIFICATION_PREF_KEYS.includes(key) && typeof value === 'boolean'
  ));
}

/**
 * Which preference bucket gates a given notification/email kind. Kinds arrive
 * in two spellings (email templates hyphenate, in-app kinds snake_case), so
 * both are normalised first. Anything unrecognised lands in `trip_updates` —
 * the broad "status changes" bucket — rather than silently bypassing opt-outs.
 */
const PREF_BY_KIND = Object.freeze({
  'booking-confirmed': 'booking_confirmed',
  'booking-pending': 'booking_confirmed',
  'booking-active': 'trip_updates',
  'booking-completed': 'trip_updates',
  'booking-cancelled': 'cancellations_refunds',
  'booking-rejected': 'cancellations_refunds',
  'booking-refunded': 'cancellations_refunds',
  'deposit-settled': 'cancellations_refunds',
  'trip-change-requested': 'trip_updates',
  'trip-change-approved': 'trip_updates',
  'trip-change-declined': 'trip_updates',
  'trip-change-withdrawn': 'trip_updates',
  'trip-extended': 'trip_updates',
  'trip-extension': 'trip_updates',
  'return-due-reminder': 'trip_updates',
  'return-due': 'trip_updates',
  'availability-alert': 'trip_updates',
  'customer-message': 'trip_updates',
  'winback-offer': 'promotions',
});

export const prefForKind = (kind = '') => {
  const normalized = String(kind).toLowerCase().replace(/[_]/g, '-');
  return PREF_BY_KIND[normalized] || 'trip_updates';
};

/**
 * Should a recipient receive this kind? Missing prefs default to on, so only
 * an explicit opt-out suppresses anything.
 */
export function shouldNotify(kind = '', rawPrefs) {
  const prefs = normalizeNotificationPrefs(rawPrefs);
  return prefs[prefForKind(kind)] !== false;
}