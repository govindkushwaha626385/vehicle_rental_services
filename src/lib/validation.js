/** Reusable, dependency-free validators shared by customer and admin forms. */

import { isValidDate, todayISO } from './pricing.js';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isEmail = (value) => EMAIL_RE.test(String(value ?? '').trim());

export const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/**
 * Phone numbers are deliberately permissive: Indian and international formats
 * are both accepted, but we require enough digits to make the number useful.
 */
export function phoneProblem(value, { required = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return required ? 'Enter a phone number.' : null;
  if (!/^[+()0-9\s.-]+$/.test(raw)) return 'Use digits, spaces, brackets, dots or a leading +.';
  const digits = digitsOnly(raw);
  if (digits.length < 8 || digits.length > 15) return 'Enter a phone number with 8–15 digits.';
  return null;
}

export function urlProblem(value, { required = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return required ? 'Add a URL.' : null;
  if (raw.startsWith('/') || raw.startsWith('data:image/')) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'Use an http:// or https:// URL.';
    return null;
  } catch {
    return 'That does not look like a valid URL.';
  }
}

/**
 * Optional map coordinates for a hub.
 *
 * "Optional" must mean *absent*, never 0,0: (0,0) is a real point in the Gulf
 * of Guinea, so defaulting a blank field to zero silently turns an un-mapped
 * hub into a mappable one. Both fields are required together, and the range
 * check mirrors the SQL column and the storefront map bounds.
 *
 * Returns null when valid (matching phoneProblem/urlProblem).
 */
export function coordinatesProblem(latValue, lngValue) {
  const hasLat = String(latValue ?? '').trim() !== '';
  const hasLng = String(lngValue ?? '').trim() !== '';
  if (!hasLat && !hasLng) return null;
  if (hasLat !== hasLng) return 'Enter both latitude and longitude, or leave both blank.';
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Enter a latitude between -90 and 90.';
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Enter a longitude between -180 and 180.';
  return null;
}

/** Normalise optional coordinates to numbers, or null when the hub is un-mapped. */
export function normalizeCoordinates(latValue, lngValue) {
  if (coordinatesProblem(latValue, lngValue)) return { lat: null, lng: null };
  const hasLat = String(latValue ?? '').trim() !== '';
  return hasLat
    ? { lat: Number(latValue), lng: Number(lngValue) }
    : { lat: null, lng: null };
}

export function dateRangeProblem(start, end, { allowSameDay = false } = {}) {
  if (!start || !end) return 'Choose both dates.';
  if (allowSameDay ? end < start : end <= start) {
    return allowSameDay ? 'End date cannot be before the start date.' : 'End date must be after the start date.';
  }
  return null;
}

/**
 * Is the driving licence valid for the whole rental?
 *
 * A licence that expires mid-trip makes the second half of the rental illegal
 * to drive, so rentals need the expiry to cover the drop-off date. The field
 * is optional at booking time (the desk can still ask for it at handover), but
 * once a customer enters a date it is checked everywhere — checkout, the
 * adapters and the handover desk all share this one message so a promise made
 * at checkout can never be edited around later.
 *
 * @param driver   { licenseExpiry, ... } the driver record
 * @param dates    { endDate }            last day of the rental
 * @param options  { policy, today }      `licence_validity_required` gate + injectable clock
 * @returns human-facing error string, or null when valid (or when not enforced)
 */
export function licenceExpiryProblem(driver = {}, dates = {}, { policy = {}, today = todayISO() } = {}) {
  const expiry = String(driver?.licenseExpiry ?? '').trim();
  if (!expiry) return null;
  if (!isValidDate(expiry)) return 'Enter a valid licence expiry date.';
  if (expiry < today) return 'Your licence has already expired — renew it or book with another driver.';
  const required = policy?.licenceValidityRequired ?? policy?.licence_validity_required ?? true;
  if (required !== false && String(required) !== 'false' && dates?.endDate && expiry < dates.endDate) {
    return 'Your licence expires during the rental — it stays valid until the drop-off date.';
  }
  return null;
}
