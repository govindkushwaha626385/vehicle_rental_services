export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const toISO = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const todayISO = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Pick-up and drop-off slots offered by every booking surface. Keeping the
// list in one module prevents a crafted or stale URL from producing a select
// with no matching option.
export const RENTAL_TIMES = Object.freeze(Array.from({ length: 27 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}));

export const isRentalTime = (value) => RENTAL_TIMES.includes(value);

export const dayNumber = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
};

export const addDaysISO = (iso, amount) => {
  const [year, month, day] = iso.split('-').map(Number);
  return toISO(new Date(Date.UTC(year, month - 1, day + amount)));
};

export const daysBetween = (start, end) => dayNumber(end) - dayNumber(start);

export const isValidDate = (value) => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const isWeekendISO = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 5 || weekday === 6;
};

export const ageFromDob = (dob) => {
  if (!isValidDate(dob)) return null;
  const [year, month, day] = dob.split('-').map(Number);
  // Compare calendar dates in IST so a rider is old enough on their birthday
  // even when the browser is west of India.
  const now = new Date(Date.now() + 5.5 * 3600000);
  let age = now.getUTCFullYear() - year;
  const monthNow = now.getUTCMonth() + 1;
  if (monthNow < month || (monthNow === month && now.getUTCDate() < day)) age -= 1;
  return age >= 0 ? age : null;
};

export function promoProblem(promo, days, { isFirstBooking = true } = {}) {
  if (!promo) return 'That promo code does not exist.';
  if (!promo.active) return 'This promo code is no longer active.';
  if (promo.expiresAt && promo.expiresAt < todayISO()) return 'This promo code has expired.';
  if (promo.usageLimit > 0 && promo.usedCount >= promo.usageLimit) {
    return 'This promo code has reached its usage limit.';
  }
  if (days < promo.minDays) return `This code requires a rental of at least ${promo.minDays} days.`;
  if (promo.firstBookingOnly && !isFirstBooking) {
    return 'This promo is valid only for your first booking.';
  }
  return null;
}

export function calculateQuote({
  vehicle,
  startDate,
  endDate,
  extras = [],
  extrasCatalog = [],
  insuranceTiers = [],
  insurance = 'basic',
  promo = null,
  settings = {},
  pickupLocation = '',
  dropoffLocation = '',
  paymentPlan = 'full',
  skipValidation = false,
}) {
  if (!vehicle) throw new Error('Vehicle not found.');
  if (!skipValidation) {
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      throw new Error('Please choose valid pick-up and drop-off dates.');
    }
    if (startDate < todayISO()) throw new Error('Pick-up date cannot be in the past.');
    const minDays = Math.max(1, Math.round(Number(settings.min_rental_days) || 1));
    const maxDays = Math.max(minDays, Math.round(Number(settings.max_rental_days) || 45));
    const maxAdvanceDays = Math.max(1, Math.round(Number(settings.max_advance_days) || 365));
    const check = daysBetween(startDate, endDate);
    if (check < minDays) {
      throw new Error(`The minimum rental is ${minDays} day${minDays === 1 ? '' : 's'}.`);
    }
    if (check > maxDays) throw new Error(`Rentals are limited to ${maxDays} days.`);
    if (dayNumber(startDate) - dayNumber(todayISO()) > maxAdvanceDays) {
      throw new Error(`Bookings can be made up to ${maxAdvanceDays} days in advance.`);
    }
  }

  const days = daysBetween(startDate, endDate);
  if (days < 1) throw new Error('Drop-off must be at least one day after pick-up');

  const weekendMultiplier = Number(settings.weekend_multiplier) || 1;
  const seasonalMultiplier = Number(settings.seasonal_multiplier) || 1;
  const seasonalStart = settings.seasonal_start;
  const seasonalEnd = settings.seasonal_end;

  let baseTotal = 0;
  const nightly = [];
  for (let index = 0; index < days; index += 1) {
    const date = addDaysISO(startDate, index);
    const weekend = isWeekendISO(date);
    const seasonal = Boolean(seasonalStart && seasonalEnd && date >= seasonalStart && date <= seasonalEnd);
    const multiplier = Math.max(weekend ? weekendMultiplier : 1, seasonal ? seasonalMultiplier : 1);
    const amount = Math.round(vehicle.pricePerDay * multiplier);
    baseTotal += amount;
    nightly.push({ date, amount, weekend, seasonal });
  }

  const catalog = new Map(extrasCatalog.map((item) => [item.key, item]));
  const chosen = [...new Set(extras)].filter((key) => catalog.has(key));
  // Whole rupees everywhere: the SQL engine stores these in integer columns and
  // Razorpay charges in paise. Rounding here keeps a legacy decimal catalog row
  // from producing a fractional invoice total.
  const extrasTotal = Math.round(chosen.reduce((sum, key) => sum + Number(catalog.get(key).pricePerDay), 0) * days);

  const tiers = (Array.isArray(insuranceTiers)
    ? insuranceTiers
    : Object.values(insuranceTiers || {})).filter((item) => item.active !== false);
  const tier = tiers.find((item) => item.key === insurance) || tiers[0] || {
    key: 'basic', label: 'Basic', pricePerDay: 0, deductible: 75000, blurb: '',
  };
  const insuranceTotal = Math.round(Number(tier.pricePerDay) * days);

  const oneWayEnabled = String(settings?.one_way_enabled ?? 'true') !== 'false';
  const oneWayFee = oneWayEnabled && pickupLocation && dropoffLocation && pickupLocation !== dropoffLocation
    ? Math.round(Number(settings.one_way_fee) || 0)
    : 0;

  let discount = 0;
  let promoApplied = null;
  if (promo && days >= (promo.minDays || 1)) {
    const value = Number(promo.value) || 0;
    const raw = promo.type === 'percent'
      ? Math.round((baseTotal * value) / 100)
      : Math.round(value);
    // A legacy or malformed promo must never discount more than the rental
    // base or push the total negative. The UI and adapters now reject these
    // values, but the quote engine stays safe for rows written before that rule.
    discount = Math.min(Math.max(0, raw), baseTotal);
    if (discount > 0) promoApplied = { code: promo.code, type: promo.type, value: promo.value };
  }

  const taxRate = Math.max(0, Number(settings.tax_rate) || 0);
  const taxInclusive = settings.tax_inclusive === 'true' || settings.tax_inclusive === true;
  const taxOnExtras = settings.tax_on_extras !== 'false' && settings.tax_on_extras !== false;
  const taxOnInsurance = settings.tax_on_insurance !== 'false' && settings.tax_on_insurance !== false;
  const taxOnOneWay = settings.tax_on_one_way !== 'false' && settings.tax_on_one_way !== false;

  // Components the admin excluded from the tax base are still charged — they
  // simply do not attract tax. Splitting taxed and untaxed money keeps the
  // total honest in both inclusive and exclusive modes (previously an untaxed
  // extra vanished from the bill entirely).
  const taxedComponents = baseTotal
    + (taxOnExtras ? extrasTotal : 0)
    + (taxOnInsurance ? insuranceTotal : 0)
    + (taxOnOneWay ? oneWayFee : 0);
  const untaxedTotal = (taxOnExtras ? 0 : extrasTotal)
    + (taxOnInsurance ? 0 : insuranceTotal)
    + (taxOnOneWay ? 0 : oneWayFee);
  const taxableGross = Math.max(0, taxedComponents - discount);

  // Inclusive pricing means the listed taxable components already contain tax,
  // so the tax amount is extracted instead of added on top. Keeping both modes
  // in one place prevents the client and SQL quote engines drifting.
  const fees = taxInclusive
    ? (taxRate > 0 ? Math.round((taxableGross * taxRate) / (100 + taxRate)) : 0)
    : Math.round((taxableGross * taxRate) / 100);
  const total = taxInclusive ? taxableGross + untaxedTotal : taxableGross + untaxedTotal + fees;
  const taxable = taxInclusive ? taxableGross - fees : taxableGross;
  const depositPercent = Math.min(100, Math.max(1, Math.round(Number(settings.deposit_percent) || 25)));
  const depositDue = Math.round((total * depositPercent) / 100);
  const amountDue = paymentPlan === 'deposit' ? depositDue : total;

  return {
    days,
    nightlyRate: Math.round(baseTotal / days),
    baseTotal,
    extrasTotal,
    insuranceTotal,
    oneWayFee,
    discount,
    fees,
    untaxedTotal,
    taxRate,
    taxInclusive,
    taxOnExtras,
    taxOnInsurance,
    taxOnOneWay,
    taxable,
    total,
    depositDue,
    depositPercent,
    amountDue,
    balanceDue: total - amountDue,
    nightly,
    extras: chosen.map((key) => {
      const item = catalog.get(key);
      return {
        key,
        label: item.label,
        pricePerDay: Number(item.pricePerDay),
      };
    }),
    insurance: tier,
    promoApplied,
  };
}

const settingsTaxInclusive = (settings) => settings?.tax_inclusive === 'true' || settings?.tax_inclusive === true;

/**
 * Typical all-in day rate for a vehicle card.
 *
 * Listing pages only show the base nightly rate, but customers decide between
 * cars on the fully-loaded price. This mirrors the quote engine for the most
 * common booking — one day, standard protection, no extras, no one-way, no
 * promo — so the number shown is exactly what checkout would quote for that
 * trip. It is deliberately an estimate (real quotes still round per booking and
 * add/remove components), which the UI labels as such.
 *
 * @param vehicle  { pricePerDay }
 * @param settings tax_inclusive | tax_rate | tax_on_insurance
 * @param tiers    insurance tier catalog (meta.insuranceTiers)
 * @returns integer rupees, or null when the vehicle has no usable base price.
 */
export function typicalDayRate(vehicle = {}, settings = {}, tiers = []) {
  const price = Number(vehicle?.pricePerDay);
  if (!Number.isFinite(price) || price <= 0) return null;
  const active = (Array.isArray(tiers) ? tiers : []).filter((tier) => tier.active !== false);
  const standard = active.find((tier) => tier.key === 'standard') || active[0] || null;
  const insurance = Math.round(Number(standard?.pricePerDay) || 0);
  const rate = Math.max(0, Number(settings?.tax_rate) || 0);
  const taxedInsurance = settings?.tax_on_insurance !== 'false' && settings?.tax_on_insurance !== false;

  if (settingsTaxInclusive(settings)) {
    // Listed components already contain tax — nothing is added on top.
    return Math.round(price + insurance);
  }
  const taxed = price + (taxedInsurance ? insurance : 0);
  const untaxed = taxedInsurance ? 0 : insurance;
  return Math.round(taxed + untaxed + (taxed * rate) / 100);
}

/**
 * Tell the storefront when the admin's seasonal pricing window is live. Quotes
 * already apply `seasonal_multiplier` inside the window; this exposes the same
 * dates so cards and the checkout can say "festive rates" instead of hiding it.
 *
 * Returns `null` when no window is configured; otherwise `{ start, end, active }`
 * where `active` means today falls inside it.
 */
export function seasonalPricingActive(settings = {}, { today = todayISO() } = {}) {
  const start = String(settings?.seasonal_start || '').trim();
  const end = String(settings?.seasonal_end || '').trim();
  if (!start || !end || start > end) return null;
  return { start, end, active: today >= start && today <= end };
}
