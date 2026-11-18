/**
 * Shared validation for the settings that drive every quote.
 *
 * Settings → Financial defaults and Pricing → Rate rules edit the same rows, so
 * they must enforce identical limits. Both adapters also run this before a
 * write, which keeps the demo and Supabase paths in lockstep and stops a UI bug
 * from persisting a quote-breaking value.
 */
import { isValidDate } from './pricing.js';

/** The settings Pricing → Rate rules owns (and saves). */
export const RATE_RULE_KEYS = Object.freeze([
  'tax_rate',
  'deposit_percent',
  'hold_amount',
  'one_way_fee',
  'weekend_multiplier',
  'seasonal_multiplier',
  'seasonal_start',
  'seasonal_end',
  'min_age',
  'max_rental_days',
]);

/** Snapshot of just the rate-rule fields, for dirty tracking and saves. */
export function rateRuleValues(settings = {}) {
  return Object.fromEntries(RATE_RULE_KEYS.map((key) => [key, settings[key] ?? '']));
}

/**
 * Field-level errors for the rate-rule settings. The tax message names the
 * configured tax label (GST, VAT, …) so it never contradicts the invoice copy.
 */
export function rateRuleErrors(values = {}) {
  const errors = {};
  const taxLabel = String(values.tax_label ?? '').trim() || 'GST';
  const numeric = {
    tax_rate: [0, 30, `${taxLabel} must be between 0 and 30%.`],
    deposit_percent: [1, 100, 'Deposit must be between 1 and 100%.'],
    hold_amount: [0, 1000000, 'Security deposit must be between ₹0 and ₹10,00,000.'],
    one_way_fee: [0, 100000, 'One-way fee must be between ₹0 and ₹1,00,000.'],
    weekend_multiplier: [1, 5, 'Weekend multiplier must be between 1 and 5.'],
    seasonal_multiplier: [1, 5, 'Seasonal multiplier must be between 1 and 5.'],
    min_age: [16, 90, 'Minimum age must be between 16 and 90.'],
    min_rental_days: [1, 30, 'Minimum rental must be between 1 and 30 days.'],
    max_rental_days: [1, 365, 'Maximum rental must be between 1 and 365 days.'],
  };
  Object.entries(numeric).forEach(([key, [min, max, message]]) => {
    const raw = String(values[key] ?? '').trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < min || value > max) {
      errors[key] = message;
    } else if (['hold_amount', 'one_way_fee'].includes(key) && !Number.isInteger(value)) {
      // Money settings are whole rupees in both the demo state and Postgres
      // integer columns; a decimal here would make the two engines disagree.
      errors[key] = 'Use a whole rupee amount.';
    }
  });

  // Both dates or neither: a lone date silently disables seasonal pricing.
  const seasonalStart = String(values.seasonal_start ?? '').trim();
  const seasonalEnd = String(values.seasonal_end ?? '').trim();
  if (Boolean(seasonalStart) !== Boolean(seasonalEnd)) {
    errors[seasonalStart ? 'seasonal_end' : 'seasonal_start'] = 'Set both season dates, or leave both blank.';
  } else if (seasonalStart && seasonalEnd) {
    if (!isValidDate(seasonalStart)) errors.seasonal_start = 'Choose a valid season start date.';
    if (!isValidDate(seasonalEnd)) errors.seasonal_end = 'Choose a valid season end date.';
    if (!errors.seasonal_start && !errors.seasonal_end && seasonalEnd < seasonalStart) {
      errors.seasonal_end = 'Season cannot end before it starts.';
    }
  }

  const minDays = Number(values.min_rental_days);
  const maxDays = Number(values.max_rental_days);
  if (Number.isFinite(minDays) && Number.isFinite(maxDays) && maxDays > 0 && maxDays < minDays) {
    errors.max_rental_days = 'Maximum must be at least the minimum rental period.';
  }
  return errors;
}

/**
 * Errors relevant to a partial settings patch. Adapters accept patches that
 * touch unrelated keys (email templates, theme, …), so only complain about the
 * rate-rule fields the caller is actually writing.
 */
export function rateRulePatchErrors(patch = {}) {
  const errors = rateRuleErrors(patch);
  const touched = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  const seasonalTouched = touched('seasonal_start') || touched('seasonal_end');
  const rentalTouched = touched('min_rental_days') || touched('max_rental_days');
  return Object.fromEntries(Object.entries(errors).filter(([key]) => (
    touched(key)
    || (seasonalTouched && (key === 'seasonal_start' || key === 'seasonal_end'))
    || (rentalTouched && (key === 'min_rental_days' || key === 'max_rental_days'))
  )));
}
