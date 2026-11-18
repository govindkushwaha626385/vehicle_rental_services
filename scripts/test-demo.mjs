#!/usr/bin/env node
/**
 * Fast contract test for the localStorage demo API.
 *
 * It exercises the same flows the UI uses (quote → pay → voucher → cancel and
 * the admin mutations) without a browser or network. Run with:
 *
 *   npm run test:demo
 */
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
  setItem: (key, value) => store.set(String(key), String(value)),
  removeItem: (key) => store.delete(String(key)),
  clear: () => store.clear(),
};
globalThis.window = new EventTarget();
// Legacy browser FileReader used by the demo image uploads.
globalThis.FileReader = class {
  readAsDataURL(file) {
    this.result = `data:${(file && file.type) || 'image/png'};base64,AA==`;
    if (this.onload) this.onload();
  }
};

const { demoApi } = await import('../src/demo/api.js');
const {
  PAGE_TEXT_KEYS, contentForm, contentPayload, emphasize, fillCopy, getSiteContent, tripProblem,
  cancellationRefund, lateFeeTermsText, lateChargeFor, sitePolicy,
} = await import('../src/lib/site.js');
const { computeFinance, financialYearStart, invoiceNumber } = await import('../src/lib/finance.js');
const { buildDataExport } = await import('../src/lib/dataExport.js');
const { licenceExpiryProblem } = await import('../src/lib/validation.js');
const {
  buildPaletteItems, filterPaletteItems,
} = await import('../src/lib/paletteItems.js');
const {
  COMPARE_MAX, cheapestVehicleId, clearCompare, isComparing, pruneCompare, readCompare, removeFromCompare, rowWinnerIndex, toggleCompare,
} = await import('../src/lib/compare.js');
const {
  clearRememberedTrip, mergeTripDefaults, readRememberedTrip, rememberTrip,
} = await import('../src/lib/tripMemory.js');
const {
  DEFAULT_NOTIFICATION_PREFS, NOTIFICATION_PREF_KEYS, normalizeNotificationPrefs, prefForKind, shouldNotify, validNotificationPrefs,
} = await import('../src/lib/notifications.js');
const {
  SAVED_SEARCH_MAX, clearSavedSearches, deleteSavedSearch, listSavedSearches, saveSearch,
} = await import('../src/lib/savedSearches.js');
const {
  DEFAULT_BIKE_SERVICE_INTERVAL_DAYS, DEFAULT_BIKE_SERVICE_INTERVAL_KM, DEFAULT_SERVICE_INTERVAL_DAYS,
  DEFAULT_SERVICE_INTERVAL_KM, applyServiceEntry, maintenanceSummary, serviceBoard, serviceEntry,
  serviceIntervals, serviceStatus,
} = await import('../src/lib/maintenance.js');
const {
  ANALYTICS_CSV_HEADERS, analyticsCsv, analyticsCsvRows,
} = await import('../src/lib/analyticsCsv.js');
const {
  availabilityStrip, stripSummary,
} = await import('../src/lib/availabilityStrip.js');
const {
  tripProgress, tripProgressPercent,
} = await import('../src/lib/tripProgress.js');
const { bookingFunnel, checkoutSummary, computeAdminStats, seasonalReadiness, utilizationSeries } = await import('../src/lib/stats.js');
const { docStatus, fleetDocuments, fleetDocProblems, vehicleDocs } = await import('../src/lib/fleetDocs.js');
const {
  RATE_RULE_KEYS, rateRuleErrors, rateRulePatchErrors, rateRuleValues,
} = await import('../src/lib/rateRules.js');
const { calculateQuote, promoProblem } = await import('../src/lib/pricing.js');
const { addDaysISO, todayISO } = await import('../src/lib/pricing.js');
const { typicalDayRate, seasonalPricingActive } = await import('../src/lib/pricing.js');

const log = (label) => console.log(`  ✓ ${label}`);
const driver = {
  name: 'Maya Chen',
  email: 'demo@rove.rent',
  phone: '+91 98765 43210',
  license: 'MH0220210003003',
  dob: '1994-05-01',
};
const isoOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const localToday = new Date().toLocaleDateString('en-CA');

await demoApi.resetDemoData();

// ---------------------------------------------------------------------------
// Catalogue and pricing
// ---------------------------------------------------------------------------

const meta = await demoApi.getMeta();
assert.equal(meta.currency, 'INR');
assert.ok(meta.locations.length >= 7);
assert.ok(meta.extras.some((extra) => extra.key === 'gps'));
log('catalogue meta loads with locations, extras and insurance');

const { vehicles } = await demoApi.listVehicles({ sort: 'recommended' });
assert.ok(vehicles.length > 0);
const porsche = vehicles.find((vehicle) => vehicle.id === 'veh-911') || vehicles[0];
log(`fleet loads (${vehicles.length} vehicles)`);

const startDate = '2027-09-10';
const endDate = '2027-09-13';
const quoteResult = await demoApi.quote({
  vehicleId: porsche.id,
  startDate,
  endDate,
  extras: ['gps'],
  insurance: 'standard',
  pickupLocation: porsche.location,
  dropoffLocation: porsche.location,
  paymentPlan: 'full',
});
assert.equal(quoteResult.available, true);
const quote = quoteResult.quote;
assert.equal(quote.extrasTotal, 300 * quote.days, 'extras must be charged per day');
assert.equal(quote.insuranceTotal, 600 * quote.days);
assert.equal(
  quote.total,
  quote.baseTotal + quote.extrasTotal + quote.insuranceTotal + quote.oneWayFee - quote.discount + quote.fees
);
log(`quote totals are internally consistent (₹${quote.total})`);

// One-way rentals are an admin toggle: when off, the relocation fee is never
// quoted and mismatched hubs are rejected end to end.
const oneWayFixture = (oneWayEnabled) => calculateQuote({
  vehicle: { pricePerDay: 2000 },
  startDate: '2027-10-01',
  endDate: '2027-10-03',
  extrasCatalog: [],
  insuranceTiers: [{ key: 'basic', pricePerDay: 0, active: true }],
  insurance: 'basic',
  pickupLocation: 'Hub A',
  dropoffLocation: 'Hub B',
  settings: {
    tax_rate: 18, deposit_percent: 25, min_rental_days: 1, max_rental_days: 45, max_advance_days: 365,
    one_way_fee: 1500, one_way_enabled: oneWayEnabled ? 'true' : 'false',
  },
  skipValidation: true,
});
assert.equal(oneWayFixture(true).oneWayFee, 1500, 'the relocation fee applies when one-way is enabled');
assert.equal(oneWayFixture(false).oneWayFee, 0, 'the relocation fee is never quoted when one-way is off');
assert.equal(sitePolicy({ one_way_enabled: 'false' }).oneWayEnabled, false, 'the policy exposes the one-way switch');
assert.equal(sitePolicy({}).oneWayEnabled, true, 'one-way defaults to on');

const clampQuote = calculateQuote({
  vehicle: { pricePerDay: 2000 },
  startDate: '2027-09-10',
  endDate: '2027-09-12',
  extrasCatalog: [],
  insuranceTiers: [{ key: 'basic', pricePerDay: 0, active: true }],
  insurance: 'basic',
  promo: {
    code: 'LEGACY150', type: 'percent', value: 150, active: true, minDays: 1, usageLimit: 0, usedCount: 0,
  },
  settings: {
    tax_rate: 18, deposit_percent: 25, min_rental_days: 1, max_rental_days: 45, max_advance_days: 365,
  },
  skipValidation: true,
});
assert.equal(clampQuote.discount, clampQuote.baseTotal, 'a malformed percent promo cannot discount more than the rental base');
assert.ok(clampQuote.total >= 0, 'a malformed promo cannot produce a negative total');
const negativePromoQuote = calculateQuote({
  vehicle: { pricePerDay: 2000 },
  startDate: '2027-09-10',
  endDate: '2027-09-12',
  extrasCatalog: [],
  insuranceTiers: [{ key: 'basic', pricePerDay: 0, active: true }],
  insurance: 'basic',
  promo: {
    code: 'NEGATIVE', type: 'fixed', value: -500, active: true, minDays: 1, usageLimit: 0, usedCount: 0,
  },
  settings: {
    tax_rate: 18, deposit_percent: 25, min_rental_days: 1, max_rental_days: 45, max_advance_days: 365,
  },
  skipValidation: true,
});
assert.equal(negativePromoQuote.discount, 0, 'a negative promo cannot increase the total');

// ---------------------------------------------------------------------------
// Typical all-in day rate (vehicle cards)
// ---------------------------------------------------------------------------

const stdTiers = [
  { key: 'standard', pricePerDay: 320, active: true, label: 'Standard' },
  { key: 'basic', pricePerDay: 0, active: true, label: 'Basic' },
];
assert.equal(
  typicalDayRate({ pricePerDay: 2000 }, { tax_rate: 18 }, stdTiers),
  Math.round((2000 + 320) * 1.18),
  'exclusive all-in includes standard protection + tax',
);
assert.equal(
  typicalDayRate({ pricePerDay: 2360 }, { tax_rate: 18, tax_inclusive: 'true' }, stdTiers),
  2360 + 320,
  'inclusive all-in adds protection only (tax already embedded)',
);
assert.equal(
  typicalDayRate({ pricePerDay: 2000 }, { tax_rate: 18, tax_on_insurance: 'false' }, stdTiers),
  Math.round(2000 + 2000 * 0.18 + 320),
  'untaxed protection is still charged, just not taxed',
);
assert.equal(
  typicalDayRate({ pricePerDay: 1000 }, { tax_rate: 18 }, []),
  1180,
  'without a default tier the estimate is nightly + tax',
);
assert.equal(typicalDayRate({}, { tax_rate: 18 }, stdTiers), null, 'missing price yields null');
assert.equal(typicalDayRate({ pricePerDay: 0 }, { tax_rate: 18 }, stdTiers), null, 'zero price yields null');
assert.ok(
  seasonalPricingActive({}, { today: '2026-12-20' }) === null
  && seasonalPricingActive({ seasonal_start: '', seasonal_end: '2027-01-05' }, { today: '2026-12-20' }) === null
  && seasonalPricingActive({ seasonal_start: '2026-12-15', seasonal_end: '2027-01-05' }, { today: '2026-10-30' }).active === false
  && seasonalPricingActive({ seasonal_start: '2026-12-15', seasonal_end: '2027-01-05' }, { today: '2026-12-25' }).active === true
  && seasonalPricingActive({ seasonal_start: '2026-12-15', seasonal_end: '2027-01-05' }, { today: '2027-01-06' }).active === false,
  'seasonal pricing window activation is edge-correct (missing, before, inside, after)',
);
log('seasonal pricing window: missing/before/inside/after are edge-correct');
assert.equal(promoProblem({ firstBookingOnly: true, active: true }, 3, { isFirstBooking: true }), null, 'a first-time customer may use a first-booking promo');
assert.equal(promoProblem({ firstBookingOnly: true, active: true }, 3, { isFirstBooking: false }), 'This promo is valid only for your first booking.', 'a returning customer cannot use a first-booking promo');
assert.equal(promoProblem({ firstBookingOnly: true, active: true }, 3), null, 'the flag is not enforced unless a customer is known');

// The "as low as ₹X/day" badge on cards and hub rows is only honest if it
// equals the checkout price for a one-day, standard-protection rental. Lock
// the invariant across every tax mode the storefront can run in.
const dayRateCrossCheck = (vehicle, settings) => {
  const merged = { tax_rate: 18, deposit_percent: 25, min_rental_days: 1, max_rental_days: 45, max_advance_days: 365, ...settings };
  const rate = typicalDayRate(vehicle, merged, stdTiers);
  const engine = calculateQuote({
    vehicle,
    startDate: '2027-09-10',
    endDate: '2027-09-11',
    extrasCatalog: [],
    insuranceTiers: stdTiers,
    insurance: 'standard',
    pickupLocation: 'Hub A',
    dropoffLocation: 'Hub A',
    settings: merged,
    skipValidation: true,
  });
  return { rate, total: engine.total };
};
[['exclusive', {}], ['inclusive', { tax_inclusive: 'true' }], ['untaxed protection', { tax_on_insurance: 'false' }]].forEach(([label, extra]) => {
  const sample = dayRateCrossCheck({ pricePerDay: 2000 }, extra);
  assert.equal(sample.rate, sample.total, `the all-in badge equals the one-day checkout total (${label})`);
});
log('typical all-in day rate mirrors the quote engine (exclusive / inclusive / untaxed insurance)');

// ---------------------------------------------------------------------------
// Bikes are a first-class kind
// ---------------------------------------------------------------------------

const allVehicles = (await demoApi.listVehicles({ sort: 'recommended' })).vehicles;
const bikes = allVehicles.filter((vehicle) => vehicle.kind === 'bike');
assert.ok(bikes.length >= 8, `fleet must include at least 8 bikes (found ${bikes.length})`);
assert.ok(
  bikes.every((bike) => (
    bike.seats === 2
    && Number.isFinite(Number(bike.engineCc))
    && (Number(bike.engineCc) > 0 || String(bike.mileage).includes('range'))
    && bike.mileage && bike.gears && bike.licenseClass && Number(bike.minAge) >= 18
  )),
  'every bike needs seats, engine data, mileage, gears, licence class and minimum rider age',
);
log(`bike fleet loads (${bikes.length} bikes with engine, mileage, gears and licence data)`);

assert.ok(Array.isArray(meta.bikeTypes) && meta.bikeTypes.length >= 6, 'meta must expose bike types');
assert.ok(Array.isArray(meta.kinds) && meta.kinds.includes('bike') && meta.kinds.includes('car'), 'meta must expose both kinds');
log('meta exposes bike types and vehicle kinds');

const kindFiltered = (await demoApi.listVehicles({ kind: 'bike' })).vehicles;
assert.equal(kindFiltered.length, bikes.length, 'listVehicles({ kind: "bike" }) must return only bikes');
assert.ok(kindFiltered.every((vehicle) => vehicle.kind === 'bike'), 'kind filter must not leak cars');
const carFiltered = (await demoApi.listVehicles({ kind: 'car' })).vehicles;
assert.ok(carFiltered.length > 0 && carFiltered.every((vehicle) => vehicle.kind === 'car'), 'kind filter must return cars');
log('listVehicles filters the fleet by kind');

const bike = bikes.find((vehicle) => vehicle.type === 'Cruiser') || bikes[0];
const bikeQuoteResult = await demoApi.quote({
  vehicleId: bike.id,
  startDate,
  endDate,
  extras: ['gps'],
  insurance: 'standard',
  pickupLocation: bike.location,
  dropoffLocation: bike.location,
  paymentPlan: 'full',
});
assert.equal(bikeQuoteResult.available, true, 'a bike must be quotable');
const bikeQuote = bikeQuoteResult.quote;
assert.equal(bikeQuote.days, quote.days, 'same dates must give the same number of days');
assert.equal(bikeQuote.extrasTotal, 300 * bikeQuote.days, 'bike extras must be charged per day');
assert.equal(bikeQuote.insuranceTotal, 600 * bikeQuote.days);
assert.equal(
  bikeQuote.total,
  bikeQuote.baseTotal + bikeQuote.extrasTotal + bikeQuote.insuranceTotal + bikeQuote.oneWayFee - bikeQuote.discount + bikeQuote.fees,
);
assert.ok(bikeQuote.total > 0, 'bike quote total must be positive');
log(`bike quote totals are internally consistent (₹${bikeQuote.total})`);

// ---------------------------------------------------------------------------
// Nightly price explorer mirrors the quote's per-day arithmetic
// ---------------------------------------------------------------------------

const rates = await demoApi.vehicleDayRates(porsche.id, '2027-09-10', '2027-09-20');
const weekendNight = rates.find((row) => row.weekend && !row.seasonal);
const weekdayNight = rates.find((row) => !row.weekend && !row.seasonal);
assert.ok(weekendNight && weekdayNight, 'day rates must include weekend and weekday nights');
const baseRate = Number(porsche.pricePerDay);
assert.equal(weekendNight.rate, Math.round(baseRate * 1.15), 'weekend night should apply the weekend multiplier');
assert.equal(weekdayNight.rate, baseRate, 'weekday night should be the base rate');
const quoteNights = new Map(quote.nightly.map((night) => [night.date, night.amount]));
rates.forEach((row) => {
  if (quoteNights.has(row.date)) {
    assert.equal(row.rate, quoteNights.get(row.date), `nightly rate for ${row.date} must match the quote`);
  }
});
const seasonalRates = await demoApi.vehicleDayRates(porsche.id, '2026-12-10', '2026-12-20');
assert.ok(seasonalRates.some((row) => row.seasonal), 'December nights inside the season window must be flagged seasonal');
assert.equal(seasonalRates.find((row) => row.date === '2026-12-16').rate, Math.round(baseRate * 1.25), 'seasonal night should apply the seasonal multiplier');
log('price explorer day rates match the quote arithmetic and seasonality');

// ---------------------------------------------------------------------------
// Customer checkout, voucher and cancellation
// ---------------------------------------------------------------------------

const customer = await demoApi.signIn('demo@rove.rent', 'demo123');
assert.equal(customer.role, 'customer');

// KYC: licence upload verifies the current user in demo mode.
const kyc = await demoApi.uploadLicence(fakeImageFile());
assert.equal(kyc.verified, true, 'licence upload returns verified=true in demo mode');
const kycSession = await demoApi.getSession();
assert.equal(kycSession.user.licenceVerified, true, 'licenceVerified persists on the session user');

// Contact form: stores and confirms a submission.
const contact = await demoApi.submitContact({
  name: 'Test Person',
  email: 'test@example.com',
  phone: '+91 90000 00000',
  message: 'This is a test message from the demo contract suite.',
});
assert.equal(contact.ok, true, 'contact form accepts a valid submission');

function fakeImageFile() {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  return new File([bytes], 'licence.png', { type: 'image/png' });
}

const draft = {
  vehicleId: porsche.id,
  startDate,
  endDate,
  pickupTime: '10:00',
  dropoffTime: '10:00',
  pickupLocation: porsche.location,
  dropoffLocation: porsche.location,
  extras: ['gps'],
  insurance: 'standard',
  promoCode: '',
  paymentPlan: 'full',
  notes: 'Test booking',
  driver,
  agreedTerms: true,
  agreedLicense: true,
};

const intentBefore = (JSON.parse(localStorage.getItem('rove_demo_state_v3')).checkoutAttempts ?? []).length;
const order = await demoApi.beginPayment(draft);
assert.equal(order.demo, true);
assert.equal(order.amount, quote.amountDue * 100);
const intentBeforePayment = JSON.parse(localStorage.getItem('rove_demo_state_v3')).checkoutAttempts ?? [];
assert.equal(
  intentBeforePayment.length,
  intentBefore + 1,
  'opening payment records an abandoned-checkout candidate',
);
assert.ok(
  intentBeforePayment.some((attempt) => attempt.vehicleId === porsche.id && !attempt.convertedAt),
  'the new intent is unconverted before the customer pays',
);

const confirmation = await demoApi.confirmPayment({
  draft,
  payment: { brand: 'Visa', last4: '4242', reference: 'pay_test_1' },
});
assert.match(confirmation.code, /^RV-/);
assert.equal(confirmation.booking.amountPaid, quote.total);
assert.equal(confirmation.booking.payments.length, 1, 'only the captured rental payment is recorded');
assert.equal(confirmation.booking.payments.some((payment) => payment.kind === 'hold'), false, 'security deposit is not recorded as a card authorisation');
assert.ok(confirmation.booking.holdAmount > 0, 'the security deposit amount is snapshotted on the booking');
const intentAfter = JSON.parse(localStorage.getItem('rove_demo_state_v3')).checkoutAttempts ?? [];
assert.ok(
  intentAfter.some((attempt) => attempt.vehicleId === porsche.id && Boolean(attempt.convertedAt)),
  'a completed payment marks the matching checkout intent as converted',
);
const replay = await demoApi.confirmPayment({
  draft,
  payment: { brand: 'Visa', last4: '4242', reference: 'pay_test_1' },
});
assert.equal(replay.code, confirmation.code);
assert.equal(replay.alreadyProcessed, true, 'retrying a captured payment must not duplicate the booking');
log(`checkout confirms ${confirmation.code} with a voucher and deposit due at pick-up`);

const myBookings = await demoApi.getMyBookings();
assert.ok(myBookings.some((booking) => booking.code === confirmation.code));
const voucher = await demoApi.getBooking(confirmation.code);
assert.equal(voucher.code, confirmation.code);
assert.equal(voucher.vehicle.kind, porsche.kind, 'the booking vehicle exposes its kind');
assert.equal(voucher.vehicle.minAge, porsche.minAge, 'the booking vehicle exposes its minimum age');
assert.ok(voucher.vehicle.registrationNumber, 'the voucher vehicle carries its registration number');
assert.ok(voucher.vehicle.insuranceExpiry || voucher.vehicle.pucExpiry, 'the voucher vehicle carries its compliance expiries');

// Booking-shape contract: every field the UI and the desk read must survive the
// adapter round trip, or a page silently renders a blank. This is the seat-belt
// for the deposit/extension/km/licence fields added over time.
const bookingShapeHeld = ['code', 'id', 'status', 'total', 'holdAmount', 'depositDue', 'amountPaid', 'balanceDue', 'creditDue', 'startDate', 'endDate', 'pickupTime', 'dropoffTime', 'pickupLocation', 'dropoffLocation', 'days', 'paymentPlan', 'paymentStatus', 'taxRate', 'fees', 'kmCap', 'kmExtraRate'];
bookingShapeHeld.forEach((field) => {
  assert.ok(confirmation.booking[field] !== undefined, `booking shape holds ${field}`);
});
['deskChecks', 'returnChecks', 'depositSettlement', 'depositCollected', 'driver', 'vehicle', 'customer', 'tripChanges', 'changeRequest'].forEach((field) => {
  assert.ok(field in confirmation.booking, `booking shape carries the ${field} object slot`);
});
assert.equal(typeof confirmation.booking.driver, 'object', 'the driver object is present');
assert.ok('licenseExpiry' in confirmation.booking.driver, 'the driver exposes the licence-expiry slot');
assert.ok('depositCollected' in confirmation.booking, 'the deposit collection slot round-trips');
const shapeInr = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
assert.equal(shapeInr(confirmation.booking.holdAmount), true, 'the deposit amount is a sane number');
assert.equal(shapeInr(confirmation.booking.balanceDue), true, 'the balance is a sane number');
assert.equal(shapeInr(confirmation.booking.kmCap), true, 'the kilometre cap is a sane number');

// A signed-out customer must still be able to reopen a booking they made while
// signed in, using the same code + email contract the Supabase RPC enforces.
await demoApi.signOut();
const guestVoucher = await demoApi.getBooking(confirmation.code, customer.email);
assert.equal(guestVoucher.code, confirmation.code, 'account email reopens a booking after signing out');
let wrongEmailMessage = '';
try {
  await demoApi.getBooking(confirmation.code, 'nobody@example.com');
} catch (error) {
  wrongEmailMessage = error.message;
}
let unknownCodeMessage = '';
try {
  await demoApi.getBooking('RV-NOPE00', customer.email);
} catch (error) {
  unknownCodeMessage = error.message;
}
assert.match(wrongEmailMessage, /could not find a booking with that code and email/i, 'a wrong email is rejected');
assert.equal(unknownCodeMessage, wrongEmailMessage, 'unknown codes and wrong emails are indistinguishable');
// Viewing a voucher with code + email is not the same as cancelling it: a
// registered booking must be cancelled from the signed-in owner's account.
let signedOutCancelMessage = '';
try {
  await demoApi.cancelBooking({ code: confirmation.code, email: customer.email });
} catch (error) {
  signedOutCancelMessage = error.message;
}
assert.match(signedOutCancelMessage, /only be cancelled from the account/i, 'a signed-out owner cannot cancel a registered booking by email');

// A guest booking has no account, so the code + verified email is the whole
// identity proof and cancellation must work with them.
const guestCancelDraft = {
  ...draft,
  startDate: isoOffset(70),
  endDate: isoOffset(73),
  driver: { ...driver, email: 'guest-cancel@example.com', licenseExpiry: isoOffset(80) },
  notes: 'Guest cancellation test',
};
await demoApi.beginPayment(guestCancelDraft);
const guestCancelBooking = await demoApi.confirmPayment({
  draft: guestCancelDraft,
  payment: { brand: 'Visa', last4: '4242', reference: 'pay_test_guest_cancel' },
});
assert.equal(guestCancelBooking.booking.driver.licenseExpiry, isoOffset(80), 'the licence expiry travels with the driver record');
assert.equal((await demoApi.getBooking(guestCancelBooking.code, 'guest-cancel@example.com')).driver.licenseExpiry, isoOffset(80), 'the voucher shape exposes the licence expiry');
const guestCancel = await demoApi.cancelBooking({
  code: guestCancelBooking.code,
  email: 'guest-cancel@example.com',
  reason: 'Guest changed plans',
});
assert.equal(guestCancel.booking.status, 'cancelled', 'guest bookings can be cancelled with code + email');
await demoApi.signIn('demo@rove.rent', 'demo123');
log('guest lookup: account email works, wrong email and unknown code stay indistinguishable');
log('cancel authorization: registered bookings need the signed-in owner; guest bookings use code + email');

// One-way rentals switch: when off, cross-hub bookings are refused end to end.
await demoApi.signIn('admin@rove.rent', 'admin123');
await demoApi.adminSaveSettings({ one_way_enabled: 'false' });
await demoApi.signIn('demo@rove.rent', 'demo123');
let crossHubRejected = false;
try {
  await demoApi.confirmPayment({
    draft: { ...draft, startDate: isoOffset(130), endDate: isoOffset(133), pickupLocation: 'Bengaluru — Indiranagar', dropoffLocation: 'Mumbai — Bandra West' },
    payment: { brand: 'Visa', last4: '4242', reference: 'pay_one_way_off' },
  });
} catch (error) { crossHubRejected = /same hub/i.test(error.message); }
assert.equal(crossHubRejected, true, 'a cross-hub booking is refused when one-way is off');
const sameHubOk = await demoApi.confirmPayment({
  draft: { ...draft, startDate: isoOffset(134), endDate: isoOffset(137), pickupLocation: 'Bengaluru — Indiranagar', dropoffLocation: 'Bengaluru — Indiranagar' },
  payment: { brand: 'Visa', last4: '4242', reference: 'pay_same_hub' },
});
assert.equal(sameHubOk.booking.pickupLocation, sameHubOk.booking.dropoffLocation, 'a same-hub booking goes through when one-way is off');
await demoApi.signIn('admin@rove.rent', 'admin123');
await demoApi.adminSaveSettings({ one_way_enabled: 'true' });
await demoApi.signIn('demo@rove.rent', 'demo123');
log('one-way switch: disabled quotes no fee and refuses cross-hub trips');

// First-booking promos: admin creates one, returning customers are refused,
// a genuine first-time customer gets the discount.
await demoApi.signIn('admin@rove.rent', 'admin123');
const wellcomePromos = await demoApi.adminSavePromo({
  code: 'WELCOME1', type: 'percent', value: 20, minDays: 1, active: true, usageLimit: 10, firstBookingOnly: true,
});
assert.equal(wellcomePromos.find((promo) => promo.code === 'WELCOME1').firstBookingOnly, true, 'the admin form persists the first-booking flag');
await demoApi.signIn('demo@rove.rent', 'demo123'); // Maya has completed trips
let welcomeBlocked = false;
try {
  await demoApi.quote({
    vehicleId: porsche.id, startDate: isoOffset(140), endDate: isoOffset(143),
    insurance: 'standard', promoCode: 'WELCOME1', pickupLocation: porsche.location, dropoffLocation: porsche.location,
  });
} catch (error) { welcomeBlocked = /first booking/i.test(error.message); }
assert.equal(welcomeBlocked, true, 'a returning customer is refused a first-booking promo');
await demoApi.signOut(); // a guest with no history unlocks the offer
const welcomeFirst = await demoApi.quote({
  vehicleId: porsche.id, startDate: isoOffset(148), endDate: isoOffset(151),
  insurance: 'standard', promoCode: 'WELCOME1', pickupLocation: porsche.location, dropoffLocation: porsche.location,
});
assert.ok(welcomeFirst.quote.discount > 0, 'a first-time (guest) quote unlocks the first-booking discount');
await demoApi.signIn('admin@rove.rent', 'admin123');
await demoApi.adminDeletePromo(wellcomePromos.find((promo) => promo.code === 'WELCOME1').id);
await demoApi.signIn('demo@rove.rent', 'demo123');

// Licence validity rules: a licence that expires inside the rental is refused.
const licenceExpiryDriver = { ...driver, licenseExpiry: isoOffset(1) };
let licenceMidRental = false;
try {
  await demoApi.confirmPayment({
    draft: { ...draft, startDate: isoOffset(120), endDate: isoOffset(124), driver: licenceExpiryDriver },
    payment: { brand: 'Visa', last4: '4242', reference: 'pay_licence_test' },
  });
} catch (error) { licenceMidRental = /expires during the rental/i.test(error.message); }
assert.equal(licenceMidRental, true, 'an expiry inside the rental is refused at checkout');
let licenceExpired = false;
try {
  await demoApi.confirmPayment({
    draft: { ...draft, startDate: isoOffset(120), endDate: isoOffset(124), driver: { ...driver, licenseExpiry: '2020-01-01' } },
    payment: { brand: 'Visa', last4: '4242', reference: 'pay_licence_expired' },
  });
} catch (error) { licenceExpired = /already expired/i.test(error.message); }
assert.equal(licenceExpired, true, 'an already-expired licence is refused');
// Pure rule: dates are symmetric with the desk, and the toggle gives control.
assert.equal(licenceExpiryProblem({ licenseExpiry: '' }, { endDate: isoOffset(10) }, {}), null, 'an empty expiry stays optional');
assert.equal(licenceExpiryProblem({ licenseExpiry: isoOffset(12) }, { endDate: isoOffset(10) }, { policy: {}, today: isoOffset(0) }), null, 'an expiry after the drop-off is fine');
assert.equal(licenceExpiryProblem({ licenseExpiry: isoOffset(8) }, { endDate: isoOffset(10) }, { policy: {}, today: isoOffset(0) }), 'Your licence expires during the rental — it stays valid until the drop-off date.', 'a mid-rental expiry is refused once entered');
assert.equal(licenceExpiryProblem({ licenseExpiry: isoOffset(8) }, { endDate: isoOffset(10) }, { policy: { licenceValidityRequired: false }, today: isoOffset(0) }), null, 'the licence-validity gate can be relaxed');
assert.equal(licenceExpiryProblem({ licenseExpiry: 'not-a-date' }, { endDate: isoOffset(10) }, { policy: {}, today: isoOffset(0) }), 'Enter a valid licence expiry date.', 'a malformed expiry is rejected');

const notifications = await demoApi.myNotifications();
assert.ok(
  notifications.some((item) => item.kind === 'booking_confirmed' && item.bookingCode === confirmation.code),
  'confirming a booking notifies the customer'
);
assert.ok((await demoApi.unreadNotificationCount()) >= 1, 'the unread badge reflects the new notification');
await demoApi.markAllNotificationsRead();
assert.equal(await demoApi.unreadNotificationCount(), 0, 'mark-all-read clears the badge');
log('notifications inbox: confirmations, unread badge and mark-read');

let duplicateBlocked = false;
try {
  await demoApi.beginPayment(draft);
} catch {
  duplicateBlocked = true;
}
assert.equal(duplicateBlocked, true, 'overlapping dates must be blocked');
const ownTripQuote = await demoApi.quote({ ...draft, excludeBookingId: confirmation.booking.id });
assert.equal(ownTripQuote.available, true, 'a change quote ignores the booking being changed');
const otherTripQuote = await demoApi.quote({ ...draft, excludeBookingId: null });
assert.equal(otherTripQuote.available, false, 'another customer still cannot book the same dates');
log('double-booking guard rejects overlapping dates');

const cancelled = await demoApi.cancelBooking({ code: confirmation.code });
assert.equal(cancelled.booking.status, 'cancelled');
assert.equal(cancelled.booking.amountPaid, 0);
assert.equal(cancelled.refundAmount, quote.total);
assert.ok(cancelled.booking.payments.some((payment) => payment.kind === 'refund'));
log('cancellation refunds a booking outside 48 hours');

// ---------------------------------------------------------------------------
// Booking a bike end to end
// ---------------------------------------------------------------------------

const bikeDraft = {
  ...draft,
  vehicleId: bike.id,
  pickupLocation: bike.location,
  dropoffLocation: bike.location,
  notes: 'Bike booking test',
};

const bikeOrder = await demoApi.beginPayment(bikeDraft);
assert.equal(bikeOrder.demo, true);
assert.equal(bikeOrder.amount, bikeQuote.amountDue * 100);

const bikeConfirmation = await demoApi.confirmPayment({
  draft: bikeDraft,
  payment: { brand: 'Visa', last4: '4242', reference: 'pay_test_bike' },
});
assert.match(bikeConfirmation.code, /^RV-/);
assert.equal(bikeConfirmation.booking.amountPaid, bikeQuote.total);
assert.equal(bikeConfirmation.booking.payments.length, 1, 'only the captured rental payment is recorded');
assert.equal(bikeConfirmation.booking.payments.some((payment) => payment.kind === 'hold'), false, 'bike deposits are due at pick-up, not pre-authorised');
assert.equal(bikeConfirmation.booking.kmCap, Number(bike.kmCap), 'the booking snapshots the quoted bike allowance');
assert.equal(bikeConfirmation.booking.kmExtraRate, Number(bike.kmExtraRate), 'the booking snapshots the quoted extra-km rate');

const bikeBookings = await demoApi.getMyBookings();
assert.ok(bikeBookings.some((booking) => booking.code === bikeConfirmation.code), 'bike booking appears in account');
const bikeVoucher = await demoApi.getBooking(bikeConfirmation.code);
assert.equal(bikeVoucher.code, bikeConfirmation.code);
log(`bike booking confirms ${bikeConfirmation.code} and appears in the account`);

await demoApi.cancelBooking({ code: bikeConfirmation.code });

// A pick-up inside the cancellation window refunds the configured percentage.
// Dates are relative so this assertion keeps working whenever the suite runs.
const nearDraft = {
  ...draft,
  startDate: isoOffset(1),
  endDate: isoOffset(4),
  notes: 'Near-term cancellation test',
};
const nearOrder = await demoApi.beginPayment(nearDraft);
const nearConfirmation = await demoApi.confirmPayment({
  draft: nearDraft,
  payment: { brand: 'Visa', last4: '4242', reference: 'pay_test_near' },
});
const nearCancellation = await demoApi.cancelBooking({
  code: nearConfirmation.code,
  reason: 'Plans changed inside the window',
});
assert.equal(
  nearCancellation.refundAmount,
  Math.round(nearOrder.quote.total * 0.5),
  'a cancellation inside the default 48-hour window refunds 50%',
);
assert.equal(nearCancellation.booking.cancellationReason, 'Plans changed inside the window');
assert.equal(nearCancellation.booking.cancelledBy, 'customer');
log('cancellation inside the window applies the configured refund percentage');

// Overpayment after a reprice is a credit, not part of the rental charge. A
// cancellation must return the credit in full and apply the policy only to the
// trip's own value.
const refundPolicy = { cancellation_window_hours: '48', cancellation_refund_percent: '50' };
const insideWindowNow = new Date('2026-06-09T12:00:00+05:30').getTime();
const overpaidCancellation = cancellationRefund(
  { startDate: '2026-06-09', pickupTime: '10:00', total: 1000 },
  2500,
  refundPolicy,
  insideWindowNow,
);
assert.equal(overpaidCancellation.credit, 1500, 'overpayment is exposed as a customer credit');
assert.equal(overpaidCancellation.refundAmount, 2000, 'cancellation returns the credit in full plus 50% of the trip');
const underpaidCancellation = cancellationRefund(
  { startDate: '2026-06-09', pickupTime: '10:00', total: 1000 },
  400,
  refundPolicy,
  insideWindowNow,
);
assert.equal(underpaidCancellation.refundAmount, 200, 'the policy applies to the amount actually paid');
const fullyPaidCancellation = cancellationRefund(
  { startDate: '2026-06-09', pickupTime: '10:00', total: 1000 },
  1000,
  refundPolicy,
  insideWindowNow,
);
assert.equal(fullyPaidCancellation.refundAmount, 500, 'a fully paid booking refunds the configured percentage');
log('cancellation refunds the overpayment credit in full');

// ---------------------------------------------------------------------------
// Admin mutations
// ---------------------------------------------------------------------------

const admin = await demoApi.signIn('admin@rove.rent', 'admin123');
assert.equal(admin.role, 'admin');

// Availability blocks: seeded blocks must affect quotes and browse results,
// staff can add/edit/remove them, and conflicts are rejected.
const seededBlocks = await demoApi.adminVehicleBlocks();
assert.ok(seededBlocks.length >= 2, 'demo data seeds availability blocks');
assert.ok(seededBlocks.every((block) => block.vehicle?.name), 'blocks include vehicle context');

const m4Block = seededBlocks.find((block) => block.vehicleId === 'veh-m4' && block.kind === 'maintenance');
assert.ok(m4Block, 'seeded maintenance block exists');
const blockedQuote = await demoApi.quote({
  vehicleId: 'veh-m4',
  startDate: m4Block.startDate,
  endDate: m4Block.endDate,
  pickupLocation: m4Block.vehicle.location,
  dropoffLocation: m4Block.vehicle.location,
});
assert.equal(blockedQuote.available, false, 'a quote overlapping a block must be unavailable');
assert.match(blockedQuote.unavailableReason, /maintenance/i);
const browseAroundBlock = await demoApi.listVehicles({
  sort: 'recommended',
  from: m4Block.startDate,
  to: m4Block.endDate,
});
assert.ok(
  !browseAroundBlock.vehicles.some((vehicle) => vehicle.id === 'veh-m4'),
  'blocked vehicles are removed from date-filtered browse results',
);

const blockVehicle = vehicles.find((vehicle) => vehicle.id === 'veh-a5') || porsche;
const blockStart = '2027-08-20';
const blockEnd = '2027-08-22';
const createdBlock = await demoApi.adminSaveVehicleBlock({
  vehicleId: blockVehicle.id,
  startDate: blockStart,
  endDate: blockEnd,
  kind: 'private',
  reason: 'Test internal booking',
  notes: 'Created by the contract suite.',
});
assert.equal(createdBlock.kind, 'private');
assert.equal(createdBlock.vehicle.id, blockVehicle.id);
const blockQuote = await demoApi.quote({
  vehicleId: blockVehicle.id,
  startDate: blockStart,
  endDate: blockEnd,
  pickupLocation: blockVehicle.location,
  dropoffLocation: blockVehicle.location,
});
assert.equal(blockQuote.available, false, 'new blocks affect quotes immediately');
assert.match(blockQuote.unavailableReason, /internal booking/i);

let blockBookingBlocked = false;
try {
  await demoApi.beginPayment({
    ...draft,
    vehicleId: blockVehicle.id,
    startDate: blockStart,
    endDate: blockEnd,
    pickupLocation: blockVehicle.location,
    dropoffLocation: blockVehicle.location,
  });
} catch (error) {
  blockBookingBlocked = /internal booking/i.test(error.message);
}
assert.equal(blockBookingBlocked, true, 'checkout cannot bypass an availability block');

const updatedBlock = await demoApi.adminSaveVehicleBlock({
  ...createdBlock,
  endDate: '2027-08-23',
  reason: 'Extended internal booking',
});
assert.equal(updatedBlock.reason, 'Extended internal booking');
let overlappingBlockRejected = false;
try {
  await demoApi.adminSaveVehicleBlock({
    vehicleId: 'veh-m4',
    startDate: isoOffset(10),
    endDate: isoOffset(12),
    kind: 'maintenance',
  });
} catch (error) {
  overlappingBlockRejected = /active booking/i.test(error.message);
}
assert.equal(overlappingBlockRejected, true, 'a block cannot overlap an active booking');
await demoApi.adminDeleteVehicleBlock(createdBlock.id);
const blocksAfterDelete = await demoApi.adminVehicleBlocks();
assert.ok(!blocksAfterDelete.some((block) => block.id === createdBlock.id), 'deleted blocks leave the calendar');
log('availability blocks affect quotes, browse, checkout and guard bookings');

const auditLogs = await demoApi.adminAuditLogs({ limit: 300 });
assert.ok(auditLogs.length >= 5, 'admin mutation audit entries are recorded');
assert.ok(auditLogs.some((entry) => entry.entityType === 'vehicle_blocks'), 'block changes are audited');
assert.ok(auditLogs.some((entry) => entry.entityType === 'settings'), 'setting changes are audited');
assert.ok(auditLogs.some((entry) => entry.action === 'insert'), 'creates are audited');
assert.ok(auditLogs.some((entry) => entry.action === 'update'), 'updates are audited');
assert.ok(auditLogs[0].createdAt >= auditLogs[auditLogs.length - 1].createdAt, 'audit entries are newest first');
log('audit log records staff changes in reverse chronological order');

const manager = await demoApi.signIn('manager@rove.rent', 'manager123');
assert.equal(manager.role, 'manager');
const deskEvents = await demoApi.staffNotifications();
assert.ok(deskEvents.some((item) => item.kind === 'booking_new'), 'staff events include new bookings');
const emailLog = await demoApi.adminNotificationLog();
assert.ok(
  emailLog.some((row) => row.kind === 'booking_confirmed' && row.recipient === 'demo@rove.rent' && row.status === 'queued'),
  'a confirmation email is queued for the notify dispatcher'
);
log('staff notifications feed and transactional email queue are populated');

const exportCustomer = await demoApi.signIn('demo@rove.rent', 'demo123');
const exportableBookings = await demoApi.getMyBookings();
const exportableFavorites = await demoApi.getFavorites();
const dataExport = buildDataExport({ user: exportCustomer, bookings: exportableBookings, favorites: exportableFavorites });
assert.ok(dataExport.generatedAt && dataExport.exporter === 'Rove', 'export carries metadata');
assert.equal(dataExport.account.email, 'demo@rove.rent', 'export identifies the signed-in account');
assert.ok(dataExport.trips.length >= 1, 'export includes trips');
assert.equal(dataExport.totals.trips, dataExport.trips.length, 'export totals match its trips');
const serialized = JSON.stringify(dataExport);
assert.ok(!serialized.includes('token') && !serialized.includes('password'), 'export never includes credentials');
log('data export assembles trips, payments and account info without secrets');
let managerAuditDenied = false;
try {
  await demoApi.adminAuditLogs();
} catch (error) {
  managerAuditDenied = /super admin access/i.test(error.message);
}
assert.equal(managerAuditDenied, true, 'managers cannot read the audit log');
let managerSettingsDenied = false;
try {
  await demoApi.adminSaveSettings({ tax_rate: '19' });
} catch (error) {
  managerSettingsDenied = /admin access/i.test(error.message);
}
assert.equal(managerSettingsDenied, true, 'managers cannot change rate rules or settings');
const backAsAdmin = await demoApi.signIn('admin@rove.rent', 'admin123');
assert.equal(backAsAdmin.role, 'admin');
log('audit log stays restricted to super admins');

const tiers = await demoApi.adminInsuranceTiers();
assert.equal(tiers.length, 3);
const basicTier = tiers.find((tier) => tier.key === 'basic');
const standardTier = tiers.find((tier) => tier.key === 'standard');
const fullTier = tiers.find((tier) => tier.key === 'full');
const savedTier = await demoApi.adminSaveInsuranceTier({ ...basicTier, blurb: 'Test protection copy.' });
assert.equal(savedTier.blurb, 'Test protection copy.');
const publicMeta = await demoApi.getMeta();
assert.equal(publicMeta.insuranceTiers.find((tier) => tier.key === 'basic').blurb, 'Test protection copy.');
await demoApi.adminSaveInsuranceTier(basicTier);

await demoApi.adminSaveInsuranceTier({ ...standardTier, active: false });
const fallbackQuote = await demoApi.quote({
  vehicleId: porsche.id,
  startDate,
  endDate,
  extras: [],
  insurance: 'standard',
  pickupLocation: porsche.location,
  dropoffLocation: porsche.location,
  paymentPlan: 'full',
});
assert.equal(fallbackQuote.quote.insurance.key, 'basic', 'a hidden tier must fall back to the first active tier');
await demoApi.adminSaveInsuranceTier(standardTier);

await demoApi.adminSaveInsuranceTier({ ...standardTier, active: false });
await demoApi.adminSaveInsuranceTier({ ...fullTier, active: false });
let lastTierBlocked = false;
try {
  await demoApi.adminSaveInsuranceTier({ ...basicTier, active: false });
} catch (error) {
  lastTierBlocked = /at least one protection tier active/i.test(error.message);
}
assert.equal(lastTierBlocked, true, 'the last active protection tier cannot be hidden');
await demoApi.adminSaveInsuranceTier(standardTier);
await demoApi.adminSaveInsuranceTier(fullTier);
log('protection tiers are editable, fall back safely and keep one active');

const stats = await demoApi.adminStats();
assert.ok(stats.fleetSize >= 8);
assert.ok(stats.revenue >= 0);
log('admin dashboard stats load');

// The analytics roll-up must reconcile to the source rows directly — a drift
// here would plant a wrong number on every deposit surface at once.
const statsRows = await demoApi.adminBookings();
const statsDeposits = stats.analytics?.deposits ?? {};
const openHolds = statsRows
  .filter((booking) => booking.status === 'active' || (booking.status === 'completed' && !booking.depositSettlement))
  .reduce((sum, booking) => sum + (Number(booking.holdAmount) || 0), 0);
assert.equal(statsDeposits.depositsHeld, openHolds, 'the analytics deposit float reconciles to the source rows');
const awaitingRows = statsRows.filter((booking) => booking.status === 'completed' && !booking.depositSettlement);
assert.equal(statsDeposits.awaiting, awaitingRows.length, 'the awaiting-settlement count reconciles');
assert.equal(statsDeposits.awaitingAmount, awaitingRows.reduce((sum, booking) => sum + (Number(booking.holdAmount) || 0), 0), 'the awaiting amount reconciles');
const released = statsRows
  .filter((booking) => booking.depositSettlement)
  .reduce((sum, booking) => sum + (Number(booking.depositSettlement.refundDue) || 0), 0);
assert.equal(statsDeposits.depositsReleased, released, 'released deposits reconcile');
const outstandingDirect = statsRows
  .filter((booking) => ['confirmed', 'active', 'completed'].includes(booking.status))
  .reduce((sum, booking) => sum + (Number(booking.balanceDue) || 0), 0);
assert.equal(stats.analytics.outstandingTotal, outstandingDirect, 'the outstanding balance reconciles');

// Staff type-ahead behind the ⌘K palette: one call finds bookings, cars and people.
const searchSeed = (await demoApi.adminBookings())[0];
const byCode = await demoApi.adminSearch({ query: searchSeed.code });
assert.equal(byCode.bookings[0]?.code, searchSeed.code, 'a booking code finds the booking');
assert.ok(byCode.bookings[0].customerName, 'a booking hit carries the customer name');
assert.ok(byCode.bookings[0].vehicleName, 'a booking hit carries the vehicle name');

const shortQuery = await demoApi.adminSearch({ query: 'a' });
assert.deepEqual(shortQuery, { bookings: [], vehicles: [], customers: [] }, 'a one-character query never touches the data');

const vehicleHit = await demoApi.adminSearch({ query: 'GLE' });
assert.ok(vehicleHit.vehicles.some((row) => /GLE/i.test(row.name)), 'a model name finds the vehicle');
assert.ok(vehicleHit.bookings.length >= 1, 'a vehicle match also surfaces its bookings');

const guestHit = await demoApi.adminSearch({ query: 'Elena Rossi' });
assert.ok(guestHit.customers.some((row) => /elena/i.test(row.email)), 'a guest is searchable by name');
assert.ok(guestHit.bookings.some((row) => /Elena/i.test(row.customerName)), 'a guest booking is searchable by name');

const capped = await demoApi.adminSearch({ query: 'RV-', limit: 2 });
assert.equal(capped.bookings.length, 2, 'results respect the requested cap');

await demoApi.signIn('demo@rove.rent', 'demo123');
await assert.rejects(() => demoApi.adminSearch({ query: 'RV-D1027' }), /staff only/i, 'customers cannot use the staff type-ahead');
await demoApi.signIn('admin@rove.rent', 'admin123');
log('console type-ahead: codes, vehicles, guests, caps and staff-only access');


// Deep analytics series are present, finite and internally consistent.
const analytics = stats.analytics;
assert.ok(analytics, 'analytics block is present');
assert.equal(analytics.daily.length, 90, 'daily analytics cover a 90-day window (range filters apply on the client)');
assert.ok(analytics.daily.every((row) => (
  ['created', 'started', 'completed', 'cancelled', 'recognized', 'received'].every((field) => Number.isFinite(row[field]))
)), 'daily series contain only finite numbers');
const dailyRows = analytics.daily.filter((row) => row.started > 0 || row.created > 0);
assert.ok(dailyRows.every((row) => row.label), 'daily rows carry a readable label');
assert.ok(analytics.revenue30 >= 0 && analytics.created30 >= 0, '30-day totals are finite');
assert.ok(analytics.revenueDelta >= -1000 && analytics.revenueDelta <= 1000, 'revenue delta stays sane');
assert.ok(analytics.typeMix.length >= 1, 'category mix is populated');
assert.equal(
  analytics.typeMix.reduce((sum, item) => sum + item.count, 0),
  analytics.conversion.pending + analytics.conversion.confirmed + analytics.conversion.active
    + analytics.conversion.completed,
  'category mix counts trips, not cancelled or rejected requests',
);
assert.ok(analytics.hubMix.length >= 1, 'hub mix is populated');
// The category and hub mixes are labelled "trips" in the admin UI. A cancelled
// request never became a trip, so it must not inflate either mix.
const mixFixture = computeAdminStats([
  {
    id: 'mix-1', status: 'completed', total: 1000, fees: 0, startDate: '2026-05-01', endDate: '2026-05-02',
    pickupLocation: 'Hub A', vehicle: { id: 'mix-vehicle', type: 'SUV' }, customer: { email: 'mix-a@example.com' }, payments: [],
  },
  {
    id: 'mix-2', status: 'cancelled', total: 1000, fees: 0, startDate: '2026-05-03', endDate: '2026-05-04',
    pickupLocation: 'Hub A', vehicle: { id: 'mix-vehicle', type: 'SUV' }, customer: { email: 'mix-b@example.com' }, payments: [],
  },
], [{ id: 'mix-vehicle', name: 'Mix SUV', type: 'SUV', status: 'available' }], [], [], []);
assert.equal(mixFixture.analytics.typeMix.find((row) => row.label === 'SUV').count, 1, 'a cancelled request is not a trip in the category mix');
assert.equal(mixFixture.analytics.hubMix.find((row) => row.label === 'Hub A').count, 1, 'a cancelled request is not a trip in the hub mix');

// ---------------------------------------------------------------------------
// Review analytics
// ---------------------------------------------------------------------------
const { reviewSummary } = await import('../src/lib/reviews.js');
const reviewFixture = reviewSummary([
  { id: 'r1', vehicleId: 'v-a', rating: 5, createdAt: '2026-10-28T10:00:00.000Z', author: 'A', comment: 'Great', reply: 'Thanks for riding with us.' },
  { id: 'r2', vehicleId: 'v-a', rating: 3, createdAt: '2026-10-02T10:00:00.000Z', author: 'B', comment: 'Okay' },
  { id: 'r3', vehicleId: 'v-b', rating: 4, createdAt: '2026-08-15T10:00:00.000Z', author: 'C', comment: 'Good' },
  { id: 'r4', vehicleId: 'v-b', rating: 1, createdAt: '2026-07-01T10:00:00.000Z', author: 'D', comment: 'Bad' },
  { id: 'r5', vehicleId: 'v-a', rating: 9, createdAt: '2026-10-29T10:00:00.000Z' },
], { vehicles: [{ id: 'v-a', name: 'Alpha' }, { id: 'v-b', name: 'Beta' }], today: '2026-10-30' });
assert.equal(reviewFixture.count, 4, 'ratings outside 1–5 are ignored');
assert.equal(reviewFixture.average, 3.3, 'average is rounded to one decimal');
assert.deepEqual(reviewFixture.distribution.map((row) => row.count), [1, 1, 1, 0, 1], 'star mix counts every bucket');
assert.equal(reviewFixture.distribution.find((row) => row.stars === 5).share, 25, 'star share is a percentage');
assert.equal(reviewFixture.recent.count, 2, 'the 30-day pulse uses the injected clock');
assert.equal(reviewFixture.recent.average, 4, 'the recent average only counts the window');
assert.equal(reviewFixture.trend.length, 6, 'six months of trend');
assert.equal(reviewFixture.trend.at(-1).key, '2026-10', 'the trend ends on the current month');
assert.equal(reviewFixture.byVehicle[0].name, 'Alpha', 'best-rated vehicle first');
assert.equal(reviewFixture.byVehicle[0].average, 4, 'per-vehicle average');
assert.deepEqual(reviewFixture.lowRated.map((row) => row.id), ['r2', 'r4'], 'low ratings list newest first');
assert.equal(reviewFixture.fiveStarShare, 25, 'five-star share');
assert.equal(reviewFixture.lowShare, 25, 'two-star-or-below share');
assert.equal(reviewFixture.replied, 1, 'replies are counted');
assert.equal(reviewFixture.replyRate, 25, 'reply rate is a percentage');

const reviewsInStats = computeAdminStats([], [], [], [], [], [], [
  { id: 's1', vehicleId: 'v-a', rating: 5, createdAt: '2026-10-28T10:00:00.000Z' },
  { id: 's2', vehicleId: 'v-a', rating: 4, createdAt: '2026-10-27T10:00:00.000Z' },
]);
assert.equal(reviewsInStats.analytics.reviews.count, 2, 'stats expose the review summary');
assert.equal(reviewsInStats.analytics.reviews.average, 4.5, 'stats carry the review average');

const utilizationFixture = computeAdminStats(
  [
    { id: 'u1', status: 'confirmed', total: 1000, fees: 0, startDate: isoOffset(0), endDate: isoOffset(10), vehicle: { id: 'u-a' }, customer: { email: 'u1@example.com' }, payments: [] },
    { id: 'u2', status: 'confirmed', total: 1000, fees: 0, startDate: isoOffset(0), endDate: isoOffset(10), vehicle: { id: 'u-b' }, customer: { email: 'u2@example.com' }, payments: [] },
    { id: 'u3', status: 'confirmed', total: 1000, fees: 0, startDate: isoOffset(0), endDate: isoOffset(1), vehicle: { id: 'u-c' }, customer: { email: 'u3@example.com' }, payments: [] },
  ],
  [
    { id: 'u-a', name: 'A', status: 'available' },
    { id: 'u-b', name: 'B', status: 'available' },
    { id: 'u-c', name: 'C', status: 'available' },
  ],
  [], [], [],
);
assert.equal(utilizationFixture.utilization, 23, 'fleet utilization averages raw booked days, not rounded per-vehicle percentages');

const topFixture = computeAdminStats(
  [
    { id: 't1', status: 'completed', total: 50000, fees: 0, startDate: isoOffset(-5), endDate: isoOffset(-4), vehicle: { id: 'v-high', name: 'High' }, customer: { email: 't1@example.com' }, payments: [] },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `t2-${index}`, status: 'cancelled', total: 1000, fees: 0, startDate: isoOffset(-10), endDate: isoOffset(-9), vehicle: { id: 'v-many', name: 'Many' }, customer: { email: `t2-${index}@example.com` }, payments: [],
    })),
  ],
  [
    { id: 'v-high', name: 'High', status: 'available' },
    { id: 'v-many', name: 'Many', status: 'available' },
  ],
  [], [], [],
);
assert.equal(topFixture.topVehicles[0].id, 'v-high', 'top vehicles are selected by recognised revenue, not raw booking count');

// Per-vehicle contribution: revenue minus workshop spend, scoped per window.
const contributionFixture = computeAdminStats(
  [
    { id: 'c1', status: 'completed', total: 50000, fees: 0, startDate: isoOffset(-5), endDate: isoOffset(-2), vehicle: { id: 'c-earner', name: 'Earner' }, customer: { email: 'c1@example.com' }, payments: [] },
    { id: 'c2', status: 'cancelled', total: 99999, fees: 0, startDate: isoOffset(-4), endDate: isoOffset(-1), vehicle: { id: 'c-earner', name: 'Earner' }, customer: { email: 'c2@example.com' }, payments: [] },
    { id: 'c3', status: 'completed', total: 5000, fees: 0, startDate: isoOffset(-40), endDate: isoOffset(-38), vehicle: { id: 'c-pit', name: 'Pit' }, customer: { email: 'c3@example.com' }, payments: [] },
  ],
  [
    { id: 'c-earner', name: 'Earner', status: 'available', type: 'SUV' },
    { id: 'c-pit', name: 'Pit', status: 'available', type: 'Sedan' },
    { id: 'c-idle', name: 'Idle', status: 'available', type: 'Sedan' },
  ],
  [], [],
  [
    { id: 's1', vehicleId: 'c-earner', serviceDate: isoOffset(-3), cost: 10000 },
    { id: 's2', vehicleId: 'c-earner', serviceDate: 'not-a-date', cost: 999999 },
    { id: 's3', vehicleId: 'c-earner', serviceDate: isoOffset(3), cost: 888888 },
    { id: 's4', vehicleId: 'c-pit', serviceDate: isoOffset(-2), cost: 20000 },
  ],
  [],
);
const contributionRows = contributionFixture.analytics.fleetContribution;
assert.equal(contributionRows.length, 3, 'every fleet vehicle is measured, including idle ones');
const earnerRow = contributionRows.find((row) => row.id === 'c-earner');
const pitRow = contributionRows.find((row) => row.id === 'c-pit');
const idleRow = contributionRows.find((row) => row.id === 'c-idle');
assert.ok(earnerRow && pitRow && idleRow, 'every vehicle is listed');
assert.deepEqual(earnerRow.byWindow[30], { trips: 1, revenue: 50000, service: 10000, contribution: 40000 }, 'contribution subtracts service spend from completed revenue only');
assert.deepEqual(pitRow.byWindow[30], { trips: 0, revenue: 0, service: 20000, contribution: -20000 }, 'a vehicle can contribute negatively inside the window');
assert.deepEqual(idleRow.byWindow[30], { trips: 0, revenue: 0, service: 0, contribution: 0 }, 'an idle vehicle still reports a zeroed window');
assert.equal(pitRow.byWindow[90].trips, 1, 'the 90-day window picks up older completed trips');
assert.equal(earnerRow.allTime.service, 10000, 'invalid and future service dates never count');
assert.equal(earnerRow.byWindow[7].trips, 1, 'the 7-day window includes a trip picked up five days ago');

// The live demo rows must tie out to the series the rest of the page shows.
assert.equal(
  analytics.fleetContribution.reduce((sum, row) => sum + row.byWindow[30].revenue, 0),
  analytics.daily.slice(-30).reduce((sum, row) => sum + row.recognized, 0),
  'per-vehicle revenue ties out to the recognised-revenue series',
);
const demoServiceLogs = JSON.parse(localStorage.getItem('rove_demo_state_v3')).serviceLogs ?? [];
const validServiceSpend = demoServiceLogs.reduce((sum, log) => (
  log?.vehicleId && log.serviceDate && log.serviceDate <= isoOffset(0)
    ? sum + (Number(log.cost) || 0)
    : sum
), 0);
assert.equal(
  analytics.fleetContribution.reduce((sum, row) => sum + row.allTime.service, 0),
  validServiceSpend,
  'per-vehicle service spend ties out to valid workshop logs',
);
log('fleet contribution: per-window revenue, service spend and negative performers');

assert.ok(analytics.completedRate >= 0 && analytics.completedRate <= 100, 'completion rate stays within bounds');
assert.ok(analytics.avgBookingValue >= 0, 'average booking value is finite');
assert.ok(analytics.repeatRate >= 0 && analytics.repeatRate <= 100, 'repeat rate stays within bounds');
const weekdayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
assert.equal(analytics.weekdayMix.length, weekdayOrder.length, 'weekday mix covers every day');
assert.ok(
  analytics.weekdayMix.every((row) => weekdayOrder.includes(row.label) && Number.isInteger(row.count)),
  'weekday mix rows are labelled and numeric',
);
assert.ok(
  analytics.heat.every((cell) => weekdayOrder.includes(cell.weekday) && analytics.heatSlots.includes(cell.slot) && cell.count >= 0),
  'pick-up heatmap cells are well-formed',
);
assert.ok(
  Array.isArray(analytics.dropoffHeat) && analytics.dropoffHeat.every((cell) => weekdayOrder.includes(cell.weekday) && analytics.heatSlots.includes(cell.slot) && cell.count >= 0),
  'drop-off heatmap cells are well-formed and use the same slot buckets',
);
assert.ok(analytics.hours.length >= 1, 'pick-up hours are bucketed');
assert.ok(Array.isArray(analytics.dropoffHours) && analytics.dropoffHours.every((row) => Number.isFinite(row.value)), 'drop-off hours are bucketed for the return wave');
assert.ok(Array.isArray(analytics.weekdayRevenue) && analytics.weekdayRevenue.every((row) => Number.isFinite(row.revenue)), 'weekday revenue mix is present');
assert.ok(Array.isArray(analytics.cancellationReasons) && analytics.cancellationReasons.every((row) => row.count >= 1), 'cancellation reasons are aggregated');
assert.ok(analytics.cancellationReasons.every((row) => typeof row.label === 'string' && row.label.trim()), 'cancellation reasons are labelled');
assert.ok(Number.isInteger(stats.noShowCount) && stats.noShowCount >= 0, 'no-show count is an integer');
assert.ok(Array.isArray(stats.noShows) && stats.noShows.every((row) => row.code && row.startDate), 'the no-show list exposes booking context');
assert.ok(analytics.forecastRows.length <= 14, 'the 14-day pipeline is capped');
assert.ok(analytics.forecastRows.every((row) => Number.isFinite(row.value)), 'pipeline values are finite');
assert.ok(analytics.promoPerformance.every((row) => row.uses >= 1 && Number.isFinite(row.revenue)), 'promo performance rows are sane');
assert.equal(
  analytics.fleetHealth.available + analytics.fleetHealth.rented + analytics.fleetHealth.service,
  analytics.fleetHealth.total,
  'fleet health buckets add up to the fleet size',
);
assert.ok(analytics.gstTotal >= 0, 'GST collected is finite');
assert.ok(analytics.outstandingTotal >= 0, 'outstanding balances are finite');
assert.ok(analytics.depositFloat >= 0, 'deposit float is finite');
assert.ok(analytics.deposits && Number.isFinite(analytics.deposits.depositsHeld), 'deposit book is summarised in analytics');
assert.ok(analytics.deposits.overdue >= 0, 'overdue returns are counted in analytics');
assert.ok(analytics.waitlist && Number.isFinite(analytics.waitlist.total), 'waitlist demand is summarised in analytics');
assert.ok(analytics.typeMixByRevenue.length >= 0 && analytics.hubMixByRevenue.length >= 0, 'revenue mixes are present');
assert.ok(analytics.daily.every((row) => Number.isFinite(row.gst)), 'daily GST stream is finite');
log('admin analytics: daily trends, mixes, funnel and retention shape is consistent');

// KYC review: staff can revoke and re-verify a customer's licence.
const adminUsers = await demoApi.adminUsers();
const maya = adminUsers.find((item) => item.email === 'demo@rove.rent');
assert.equal(maya.licenceVerified, true, 'customer licence starts verified after upload');
assert.ok(maya.licenceUrl, 'licence scan is stored on the customer profile');
const revoked = await demoApi.adminVerifyLicence(maya.id, false);
assert.equal(revoked.licenceVerified, false, 'staff can send a licence back for review');
const reverified = await demoApi.adminVerifyLicence(maya.id, true);
assert.equal(reverified.licenceVerified, true, 'staff can approve a licence');
log('admin KYC review round-trip');

// Contact inbox: list, triage with private notes and delete.
const inbox = await demoApi.adminContactMessages();
const testMessage = inbox.find((message) => message.email === 'test@example.com');
assert.ok(testMessage, 'the submitted contact message appears in the staff inbox');
assert.equal(testMessage.status, 'new');
const triaged = await demoApi.adminUpdateContactMessage({
  id: testMessage.id,
  status: 'resolved',
  staffNotes: 'Replied by email with a test response.',
});
assert.equal(triaged.status, 'resolved');
assert.match(triaged.staffNotes, /Replied by email/);
// Subject tag: defaults to General, is editable by staff, and survives the round trip.
assert.equal(testMessage.subject ?? 'General', 'General', 'a subjectless submission defaults to General');
const reTagged = await demoApi.adminUpdateContactMessage({ id: testMessage.id, subject: 'Booking & payment' });
assert.equal(reTagged.subject, 'Booking & payment', 'staff can re-tag a message subject');
let badSubjectRejected = false;
try {
  await demoApi.adminUpdateContactMessage({ id: testMessage.id, subject: 'Not a real subject' });
} catch (error) { badSubjectRejected = /subject/i.test(error.message); }
assert.equal(badSubjectRejected, true, 'an unknown subject tag is rejected');
// Two B2B seeds mean the group-and-corporate triage filter has real work.
const b2bCount = (await demoApi.adminContactMessages()).filter((m) => m.subject === 'Group & corporate').length;
assert.ok(b2bCount >= 2, `group & corporate seeds are taggable (found ${b2bCount})`);
await demoApi.adminDeleteContactMessage(testMessage.id);
const inboxAfterDelete = await demoApi.adminContactMessages();
assert.ok(!inboxAfterDelete.some((message) => message.id === testMessage.id), 'deleted messages leave the inbox');
log('contact inbox triage and delete round-trip');

const reviewsBefore = await demoApi.adminReviews();
assert.ok(Array.isArray(reviewsBefore) && reviewsBefore.length > 0, 'staff can list all customer reviews');
const firstReview = reviewsBefore[0];
await demoApi.adminDeleteReview(firstReview.id);
const reviewsAfter = await demoApi.adminReviews();
assert.ok(!reviewsAfter.some((review) => review.id === firstReview.id), 'removed reviews leave the moderation list');
const auditAfterDelete = await demoApi.adminAuditLogs();
assert.ok(auditAfterDelete.some((entry) => entry.entityType === 'reviews' && entry.action === 'delete'), 'review removals are audited');
log('review moderation: staff list, remove and audit');

// ---------------------------------------------------------------------------
// Review replies
// ---------------------------------------------------------------------------
await demoApi.signIn('admin@rove.rent', 'admin123');
const seededReplies = (await demoApi.adminReviews()).filter((review) => review.reply);
assert.ok(seededReplies.length >= 3, 'the demo ships with staff replies');
const replyVehicle = await demoApi.getVehicle(seededReplies[0].vehicleId);
assert.ok(replyVehicle.reviews.some((review) => review.reply), 'replies reach the public vehicle page');

const replyTarget = (await demoApi.adminReviews()).find((review) => !review.reply);
assert.ok(replyTarget, 'there is an unanswered review to reply to');
const replied = await demoApi.adminReplyToReview({ id: replyTarget.id, reply: '  Thanks for the feedback — we have shared it with the hub team.  ' });
assert.equal(replied.reply, 'Thanks for the feedback — we have shared it with the hub team.', 'replies are trimmed');
assert.ok(replied.repliedAt, 'a reply is timestamped');
const afterReply = (await demoApi.adminReviews()).find((review) => review.id === replyTarget.id);
assert.equal(afterReply.reply, replied.reply, 'the reply shows in the moderation list');
const publicAfter = await demoApi.getVehicle(replyTarget.vehicleId);
assert.ok(
  publicAfter.reviews.some((review) => review.id === replyTarget.id && review.reply === replied.reply),
  'the reply is public on the vehicle page',
);
let longReply = false;
try { await demoApi.adminReplyToReview({ id: replyTarget.id, reply: 'x'.repeat(1201) }); } catch (error) { longReply = /1,200/.test(error.message); }
assert.equal(longReply, true, 'replies are capped at 1,200 characters');
const cleared = await demoApi.adminReplyToReview({ id: replyTarget.id, reply: '   ' });
assert.equal(cleared.reply, null, 'an empty reply clears the response');
assert.equal(
  (await demoApi.adminReviews()).find((review) => review.id === replyTarget.id).reply,
  null,
  'cleared replies disappear from the list',
);

await demoApi.adminSaveSettings({ review_replies_enabled: 'false' });
let repliesOff = false;
try { await demoApi.adminReplyToReview({ id: replyTarget.id, reply: 'Blocked' }); } catch (error) { repliesOff = /switched off/.test(error.message); }
assert.equal(repliesOff, true, 'the master switch refuses new replies');
const hidden = await demoApi.getVehicle(seededReplies[0].vehicleId);
assert.ok(hidden.reviews.every((review) => !review.reply), 'existing replies are hidden while the switch is off');
await demoApi.adminSaveSettings({ review_replies_enabled: 'true' });

await demoApi.signIn('demo@rove.rent', 'demo123');
let customerBlocked = false;
try { await demoApi.adminReplyToReview({ id: replyTarget.id, reply: 'Nope' }); } catch (error) { customerBlocked = /staff only/i.test(error.message); }
assert.equal(customerBlocked, true, 'customers cannot reply on behalf of Rove');
log('review replies: publish, cap, clear, switch and staff-only');
// Later blocks assume the moderation session is still a staff member.
await demoApi.signIn('admin@rove.rent', 'admin123');

const linked = await demoApi.submitContact({
  name: 'Riya Menon',
  email: 'riya@example.com',
  phone: '+91 91000 00000',
  message: 'Need help adding insurance onto the booking before pick-up tomorrow.',
  bookingCode: 'RV-D1028',
});
assert.ok(linked.ok && linked.bookingCode === 'RV-D1028', 'trip-linked messages keep their booking code');
const linkedInbox = await demoApi.adminContactMessages();
const linkedMessage = linkedInbox.find((message) => message.email === 'riya@example.com');
assert.ok(linkedMessage && linkedMessage.bookingCode === 'RV-D1028', 'staff inbox shows the linked booking code');
let invalidRejected = false;
try {
  await demoApi.submitContact({
    name: 'Riya Menon',
    email: 'riya@example.com',
    message: 'A booking code that is clearly not right.',
    bookingCode: 'NOPE!',
  });
} catch (error) {
  invalidRejected = /booking code/i.test(error.message);
}
assert.equal(invalidRejected, true, 'invalid booking codes are rejected');
log('trip-linked support messages carry the booking code into the inbox');

const dynamicMeta = await demoApi.getMeta();
assert.ok(dynamicMeta.settings.hero_title, 'content hero title is exposed to the customer app');
assert.equal(dynamicMeta.settings.cancellation_refund_percent, '50');
log('admin content and policy settings are exposed through meta');

// Page copy round-trips through the admin form shape and feeds the storefront
// helpers (list normalisation, split lists, placeholders and emphasis).
const contentFormValues = contentForm(dynamicMeta.settings);
assert.ok(
  PAGE_TEXT_KEYS.every((key) => key in contentFormValues),
  'every page-copy key has an editable form field',
);
const copyPatch = contentPayload({
  ...contentFormValues,
  site_name: 'Vroom',
  about_values: [{ title: 'Care', copy: 'We care.' }],
  nav_links: [{ label: 'Home', to: '/' }, { label: 'Fleet', to: '/browse' }],
});
const reread = getSiteContent({ ...dynamicMeta.settings, ...copyPatch });
assert.equal(reread.site_name, 'Vroom', 'site name round-trips');
assert.deepEqual(
  reread.about_values,
  [{ title: 'Care', copy: 'We care.' }],
  'about values round-trip as a list',
);
assert.equal(reread.nav_links.length, 2, 'navigation links round-trip as a list');
assert.equal(reread.home_avatar_initials.length, 4, 'comma-separated page copy becomes a list');
assert.equal(getSiteContent({}).dashboard_show_desk, true, 'dashboard widgets default to visible');
assert.equal(getSiteContent({ dashboard_show_finance: 'false' }).dashboard_show_finance, false, 'a dashboard widget can be switched off');
const latePolicy = getSiteContent({ late_fee_per_hour: '500' });
assert.equal(latePolicy.policy.lateFee, 500, 'the hourly late fee parses from the admin setting');
assert.equal(latePolicy.policy.lateFeePerDay, 12000, 'the daily late fee is the hourly policy scaled');
assert.equal(getSiteContent({ late_fee_per_hour: '0' }).policy.lateFeePerDay, 0, 'a zero hourly fee yields no daily fee');
assert.equal(contentForm({ dashboard_show_fleet: 'false' }).dashboard_show_fleet, false, 'the content form carries dashboard visibility toggles');
assert.equal(contentPayload({ dashboard_show_fleet: false }).dashboard_show_fleet, 'false', 'the content payload serialises dashboard toggles to strings');
assert.equal(getSiteContent({}).home_show_social, true, 'homepage sections default on');
assert.equal(getSiteContent({ home_show_catalog: 'false' }).home_show_catalog, false, 'a homepage section can be switched off');
assert.equal(contentForm({ home_show_locations: 'false' }).home_show_locations, false, 'the content form carries homepage section toggles');
assert.equal(
  fillCopy('{hubs} · {email}', reread, 3),
  `3 hubs · ${reread.support_email}`,
  'placeholders fill from live policy and contact values',
);
assert.deepEqual(
  emphasize('a *b* c'),
  [{ text: 'a ', italic: false }, { text: 'b', italic: true }, { text: ' c', italic: false }],
  'emphasis splits into plain and italic parts',
);
log('page copy round-trips through settings and fills placeholders');

const createdVehicle = await demoApi.adminSaveVehicle({
  name: 'Test Roadster',
  brand: 'Rove Labs',
  type: 'Sports',
  year: 2026,
  seats: 2,
  luggage: 1,
  transmission: 'Automatic',
  fuel: 'Petrol',
  awd: false,
  efficiency: '12 km/l',
  pricePerDay: 12345,
  location: meta.locations[0].name,
  status: 'available',
  description: 'Temporary test vehicle.',
  features: ['Test mode'],
  images: ['https://images.unsplash.com/photo-1503376780353-7e6692767b70'],
});
assert.equal(createdVehicle.name, 'Test Roadster');
let badVehiclePrice = false;
try {
  await demoApi.adminSaveVehicle({ ...createdVehicle, pricePerDay: -1 });
} catch (error) {
  badVehiclePrice = /between ₹500/i.test(error.message);
}
assert.equal(badVehiclePrice, true, 'a vehicle cannot be saved with a non-positive daily price');
let badVehicleAge = false;
try {
  await demoApi.adminSaveVehicle({ ...createdVehicle, minAge: 5 });
} catch (error) {
  badVehicleAge = /between 16 and 90/i.test(error.message);
}
assert.equal(badVehicleAge, true, 'a vehicle minimum age must stay within 16 and 90');
await demoApi.adminDeleteVehicle(createdVehicle.id);
log('fleet create/delete round-trip');

const promos = await demoApi.adminSavePromo({
  code: 'TEST25',
  description: 'Test promo',
  type: 'percent',
  value: 25,
  minDays: 1,
  active: true,
  usageLimit: 0,
});
const testPromo = promos.find((promo) => promo.code === 'TEST25');
assert.ok(testPromo);
await demoApi.adminDeletePromo(testPromo.id);
log('promo create/delete round-trip');

const extras = await demoApi.adminSaveExtra({
  label: 'Test WiFi',
  description: 'Temporary extra',
  pricePerDay: 275,
  active: true,
});
const testExtra = extras.find((extra) => extra.label === 'Test WiFi');
assert.ok(testExtra);
await demoApi.adminDeleteExtra(testExtra.id);
log('extra create/delete round-trip');

const locations = await demoApi.adminSaveLocation({
  name: 'Rove Test Hub',
  city: 'Pune',
  address: 'Test address',
  phone: '+91 90000 00000',
  active: true,
});
const testLocation = locations.find((location) => location.name === 'Rove Test Hub');
assert.ok(testLocation);
assert.equal(testLocation.lat, null, 'a hub saved without coordinates is stored as "not mapped", never 0,0');
assert.equal(testLocation.lng, null, 'a hub saved without coordinates has no longitude');
let duplicateHub = false;
try {
  await demoApi.adminSaveLocation({
    name: 'rove test hub',
    city: 'Pune',
    address: 'Another address',
    active: true,
  });
} catch (error) {
  duplicateHub = /already exists/i.test(error.message);
}
assert.equal(duplicateHub, true, 'hub names must be unique regardless of case');
let halfCoordinate = false;
try {
  await demoApi.adminSaveLocation({ name: 'Rove Half Coordinate', lat: '19.07', active: true });
} catch (error) {
  halfCoordinate = /both latitude and longitude/i.test(error.message);
}
assert.equal(halfCoordinate, true, 'a lone coordinate is rejected so a hub cannot be half-mapped');
let badCoordinate = false;
try {
  await demoApi.adminSaveLocation({ name: 'Rove Bad Coordinate', lat: '99', lng: '73', active: true });
} catch (error) {
  badCoordinate = /latitude between/i.test(error.message);
}
assert.equal(badCoordinate, true, 'an out-of-range latitude is rejected');
const mappedHub = (await demoApi.adminSaveLocation({
  name: 'Rove Mapped Hub', lat: '19.076', lng: '72.8777', active: true,
})).find((location) => location.name === 'Rove Mapped Hub');
assert.equal(mappedHub.lat, 19.076, 'real coordinates are stored as numbers');
assert.equal(mappedHub.lng, 72.8777, 'real coordinates are stored as numbers');
await demoApi.adminDeleteLocation(mappedHub.id);
const { coordinatesProblem, normalizeCoordinates } = await import('../src/lib/validation.js');
assert.equal(coordinatesProblem('', ''), null, 'blank coordinates are valid and mean "not mapped"');
assert.equal(coordinatesProblem('19.07', ''), 'Enter both latitude and longitude, or leave both blank.', 'one-sided coordinates are rejected');
assert.equal(coordinatesProblem('91', '73'), 'Enter a latitude between -90 and 90.', 'latitude is bounded');
assert.equal(coordinatesProblem('19', '181'), 'Enter a longitude between -180 and 180.', 'longitude is bounded');
assert.deepEqual(normalizeCoordinates('', ''), { lat: null, lng: null }, 'blank coordinates normalise to null');
assert.deepEqual(normalizeCoordinates('19.076', '72.8777'), { lat: 19.076, lng: 72.8777 }, 'real coordinates normalise to numbers');
assert.deepEqual(normalizeCoordinates('abc', 'def'), { lat: null, lng: null }, 'unparseable coordinates normalise to null rather than NaN');
await demoApi.adminDeleteLocation(testLocation.id);

const usedHub = meta.locations.find((location) => vehicles.some((vehicle) => vehicle.location === location.name));
assert.ok(usedHub, 'seed data should have a hub with vehicles');
let hubRenameBlocked = false;
try {
  await demoApi.adminSaveLocation({ ...usedHub, name: 'Renamed Hub' });
} catch (error) {
  hubRenameBlocked = /already used by vehicles or bookings/i.test(error.message);
}
assert.equal(hubRenameBlocked, true, 'a hub with vehicles or bookings cannot be renamed');
let hubDeleteBlocked = false;
try {
  await demoApi.adminDeleteLocation(usedHub.id);
} catch (error) {
  hubDeleteBlocked = /vehicles or bookings attached/i.test(error.message);
}
assert.equal(hubDeleteBlocked, true, 'a hub with vehicles or bookings cannot be deleted');
log('location create/delete/rename safeguards work');

const users = await demoApi.adminUsers();
const target = users.find((user) => user.role === 'customer' && user.status === 'active');
assert.ok(target);
const suspended = await demoApi.adminUpdateUser(target.id, { status: 'suspended' });
assert.equal(suspended.status, 'suspended');
await demoApi.adminUpdateUser(target.id, { status: 'active' });
log('admin can suspend and reactivate a customer');

const settings = await demoApi.adminSettings();
const changed = await demoApi.adminSaveSettings({ ...settings, tax_rate: '19' });
assert.equal(changed.tax_rate, '19');
await demoApi.adminSaveSettings(settings);
log('settings save and restore');

// Tax controls: exclusive adds tax on the taxable subtotal, inclusive extracts
// it from the listed total, and each component can be excluded from the base.
const taxQuoteArgs = {
  vehicleId: porsche.id,
  startDate,
  endDate,
  extras: ['gps'],
  insurance: 'standard',
  pickupLocation: porsche.location,
  dropoffLocation: porsche.location,
  paymentPlan: 'full',
};
const exclusiveQuote = (await demoApi.quote(taxQuoteArgs)).quote;
assert.equal(exclusiveQuote.taxInclusive, false);
assert.equal(exclusiveQuote.untaxedTotal, 0, 'every component is taxable by default');
assert.equal(
  exclusiveQuote.fees,
  Math.round(
    (exclusiveQuote.baseTotal + exclusiveQuote.extrasTotal + exclusiveQuote.insuranceTotal
      + exclusiveQuote.oneWayFee - exclusiveQuote.discount) * 18 / 100
  ),
  'exclusive tax applies to every taxable component'
);
assert.equal(
  exclusiveQuote.total,
  exclusiveQuote.taxable + exclusiveQuote.untaxedTotal + exclusiveQuote.fees,
  'exclusive total is taxable + untaxed + tax'
);
await demoApi.adminSaveSettings({ ...settings, tax_inclusive: 'true' });
const inclusiveQuote = (await demoApi.quote(taxQuoteArgs)).quote;
assert.equal(inclusiveQuote.taxInclusive, true);
assert.equal(
  inclusiveQuote.total,
  exclusiveQuote.baseTotal + exclusiveQuote.extrasTotal + exclusiveQuote.insuranceTotal
    + exclusiveQuote.oneWayFee - exclusiveQuote.discount,
  'inclusive tax must not be added on top of listed prices'
);
assert.equal(
  inclusiveQuote.fees,
  Math.round(
    (inclusiveQuote.baseTotal + inclusiveQuote.extrasTotal + inclusiveQuote.insuranceTotal
      + inclusiveQuote.oneWayFee - inclusiveQuote.discount) * 18 / 118
  ),
  'inclusive tax is extracted from the total'
);
assert.equal(inclusiveQuote.taxable, inclusiveQuote.total - inclusiveQuote.fees);
assert.equal(inclusiveQuote.untaxedTotal, 0, 'inclusive pricing with every component taxable has no untaxed bucket');
await demoApi.adminSaveSettings({ ...settings, tax_on_extras: 'false', tax_on_insurance: 'false', tax_on_one_way: 'false' });
const reducedQuote = (await demoApi.quote({
  ...taxQuoteArgs,
  pickupLocation: porsche.location,
  dropoffLocation: meta.locations.find((location) => location.name !== porsche.location).name,
})).quote;
assert.equal(reducedQuote.taxOnExtras, false);
assert.equal(reducedQuote.taxOnInsurance, false);
assert.equal(reducedQuote.taxOnOneWay, false);
assert.equal(
  reducedQuote.fees,
  Math.round((reducedQuote.baseTotal - reducedQuote.discount) * 18 / 100),
  'taxable-component toggles remove extras, protection and one-way fees from the tax base'
);
assert.equal(
  reducedQuote.untaxedTotal,
  reducedQuote.extrasTotal + reducedQuote.insuranceTotal + reducedQuote.oneWayFee,
  'components excluded from tax are still charged in a separate bucket'
);
assert.equal(
  reducedQuote.total,
  reducedQuote.taxable + reducedQuote.untaxedTotal + reducedQuote.fees,
  'untaxed extras, protection and one-way fees remain in the total'
);
await demoApi.adminSaveSettings(settings);
log('tax mode and taxable-component controls round-trip through quotes');

// Booking approval: paid bookings can arrive as pending when auto-confirm is
// off, then staff can edit the trip and cancel with a customer-facing reason.
await demoApi.adminSaveSettings({ ...settings, booking_auto_confirm: 'false' });
const approvalDraft = {
  ...draft,
  startDate: '2027-10-10',
  endDate: '2027-10-12',
  notes: 'Approval flow test',
};
const approvalOrder = await demoApi.beginPayment(approvalDraft);
const approvalConfirmation = await demoApi.confirmPayment({
  draft: approvalDraft,
  payment: { brand: 'Visa', last4: '4242', reference: 'pay_test_approval' },
});
assert.equal(approvalConfirmation.booking.status, 'pending', 'auto-confirm off must create a pending booking');
assert.equal(approvalConfirmation.booking.amountPaid, approvalOrder.quote.total, 'payment is captured before approval');
const otherHub = meta.locations.find((location) => location.name !== porsche.location).name;
const tripEdited = await demoApi.adminUpdateBooking({
  bookingId: approvalConfirmation.booking.id,
  pickupLocation: otherHub,
  dropoffLocation: otherHub,
  pickupTime: '11:30',
  dropoffTime: '12:00',
});
assert.equal(tripEdited.pickupLocation, otherHub, 'staff can move the pick-up hub');
assert.equal(tripEdited.pickupTime, '11:30', 'staff can change the pick-up time');
assert.equal(tripEdited.oneWayFee, 0, 'same-hub edits do not add a one-way fee');
const approvedBooking = await demoApi.adminUpdateBooking({
  bookingId: tripEdited.id,
  status: 'confirmed',
  notes: 'Approved after trip edit',
});
assert.equal(approvedBooking.status, 'confirmed', 'staff can approve a pending booking');
const cancelledByStaff = await demoApi.adminUpdateBooking({
  bookingId: approvedBooking.id,
  status: 'cancelled',
  reason: 'Vehicle needs an urgent service check',
  refund: true,
});
assert.equal(cancelledByStaff.status, 'cancelled');
assert.equal(cancelledByStaff.cancellationReason, 'Vehicle needs an urgent service check');
assert.equal(cancelledByStaff.cancelledBy, 'staff');
assert.equal(cancelledByStaff.amountPaid, 0, 'staff cancellation with refund clears the captured amount');
await demoApi.adminSaveSettings(settings);
log('booking approval, trip editing and staff cancellation reasons work');

// Fleet merchandising: featured, display order and badge survive an admin save
// and are exposed to the customer catalogue.
const adminFleet = await demoApi.adminVehicles();
const merchandised = adminFleet.find((vehicle) => vehicle.id === porsche.id);
assert.ok(merchandised, 'admin fleet includes the featured Porsche');
const savedMerch = await demoApi.adminSaveVehicle({
  ...merchandised,
  featured: true,
  displayOrder: 1,
  badge: 'Test badge',
});
assert.equal(savedMerch.featured, true);
assert.equal(savedMerch.displayOrder, 1);
assert.equal(savedMerch.badge, 'Test badge');
const publicMerch = (await demoApi.getVehicle(porsche.id)).vehicle;
assert.equal(publicMerch.featured, true, 'featured flag reaches the customer catalogue');
assert.equal(publicMerch.badge, 'Test badge', 'card badge reaches the customer catalogue');
await demoApi.adminSaveVehicle(merchandised);
log('fleet featured, order and badge controls round-trip');

log('appearance theme settings round-trip');
const { normalizeThemeSettings, resolveTheme } = await import('../src/lib/theme.js');
assert.equal(normalizeThemeSettings({}).theme_accent, 'lime', 'theme defaults to lime');
assert.equal(normalizeThemeSettings({ theme_accent: 'nope', theme_radius: 'nope' }).theme_radius, 'soft', 'invalid theme values fall back safely');
const themed = await demoApi.adminSaveSettings({ ...settings, theme_accent: 'glacier', theme_radius: 'sharp', theme_motion: 'calm', map_view_enabled: 'false' });
assert.equal(themed.theme_accent, 'glacier', 'accent saves through settings');
assert.equal(themed.theme_radius, 'sharp', 'radius saves through settings');
assert.equal(themed.map_view_enabled, 'false', 'map visibility saves through settings');
const themedMeta = await demoApi.getMeta();
const resolvedTheme = resolveTheme(themedMeta.settings);
assert.equal(resolvedTheme.accent.accent, '#83e7ff', 'public meta exposes the saved accent');
assert.equal(resolvedTheme.radius.card, '0.9rem', 'radius token resolves from the preset');
assert.equal(resolvedTheme.motionId, 'calm', 'motion preset resolves');
await demoApi.adminSaveSettings(settings);

// Rental rules: minimum days, advance window and the bikes toggle all come
// from settings rather than being hard-coded in the quote engine.
await demoApi.adminSaveSettings({ ...settings, min_rental_days: '3' });
let minDaysBlocked = false;
try {
  await demoApi.quote({
    vehicleId: porsche.id,
    startDate: '2027-06-01',
    endDate: '2027-06-03',
    pickupLocation: porsche.location,
    dropoffLocation: porsche.location,
  });
} catch (error) {
  minDaysBlocked = /minimum rental is 3 days/i.test(error.message);
}
assert.equal(minDaysBlocked, true, 'a two-day quote must respect a three-day minimum');

await demoApi.adminSaveSettings({ ...settings, min_rental_days: '1', max_advance_days: '30' });
let advanceBlocked = false;
try {
  await demoApi.quote({
    vehicleId: porsche.id,
    startDate: '2027-06-01',
    endDate: '2027-06-04',
    pickupLocation: porsche.location,
    dropoffLocation: porsche.location,
  });
} catch (error) {
  advanceBlocked = /up to 30 days in advance/i.test(error.message);
}
assert.equal(advanceBlocked, true, 'quotes beyond the advance window must be rejected');
await demoApi.adminSaveSettings(settings);
log('minimum rental and advance-window rules are admin-controlled');

await demoApi.adminSaveSettings({ ...settings, bikes_enabled: 'false' });
const carsOnly = await demoApi.listVehicles({ sort: 'recommended' });
assert.ok(carsOnly.vehicles.length > 0 && carsOnly.vehicles.every((vehicle) => vehicle.kind === 'car'));
let bikeHidden = false;
try {
  await demoApi.getVehicle(bike.id);
} catch (error) {
  bikeHidden = /temporarily unavailable/i.test(error.message);
}
assert.equal(bikeHidden, true, 'bike detail pages are unavailable when the toggle is off');
let bikeQuoteBlocked = false;
try {
  await demoApi.quote({
    vehicleId: bike.id,
    startDate: '2027-06-01',
    endDate: '2027-06-04',
    pickupLocation: bike.location,
    dropoffLocation: bike.location,
  });
} catch (error) {
  bikeQuoteBlocked = /temporarily unavailable/i.test(error.message);
}
assert.equal(bikeQuoteBlocked, true, 'bike quotes are blocked when the toggle is off');
await demoApi.adminSaveSettings(settings);
log('bikes toggle hides and blocks two-wheelers');

const bookings = await demoApi.adminBookings();
const pending = bookings.find((booking) => booking.status === 'pending');
if (pending) {
  const approved = await demoApi.adminUpdateBooking({ bookingId: pending.id, status: 'confirmed', notes: 'Approved in test' });
  assert.equal(approved.status, 'confirmed');
  log('admin can approve a pending booking');
}

// Finance is a pure view over the same booking ledger. Keep the invoice
// register, GST split and payment reconciliation covered by the contract test.
const finance = computeFinance(bookings, settings, { from: '2000-01-01', to: '2099-12-31' });
assert.ok(finance.invoices.length > 0, 'the finance register includes trips');
assert.equal(
  finance.summary.invoiced,
  finance.invoices.reduce((sum, invoice) => sum + invoice.total, 0),
  'invoice totals must equal the register'
);
assert.equal(
  finance.summary.gst,
  finance.invoices.reduce((sum, invoice) => sum + invoice.gst, 0),
  'GST totals must equal the register'
);
assert.ok(finance.invoices.every((invoice) => invoice.total === invoice.taxable + invoice.untaxedTotal + invoice.gst), 'each invoice splits taxable value, untaxed components and GST');
const untaxedFinance = computeFinance([{
  id: 'fin-untaxed', code: 'RV-UNTAX', status: 'completed', startDate: '2026-05-01', endDate: '2026-05-03',
  total: 2560, fees: 360, taxable: 2000, untaxedTotal: 200, amountPaid: 2560,
  customer: { name: 'Untaxed Rider' }, payments: [],
}], { invoice_prefix: 'INV/' }, {});
assert.equal(untaxedFinance.invoices[0].taxable, 2000, 'stored taxable value excludes untaxed components');
assert.equal(untaxedFinance.invoices[0].untaxedTotal, 200, 'the invoice exposes untaxed components separately');
assert.equal(untaxedFinance.invoices[0].gst, 360, 'GST stays on the taxable bucket only');
assert.equal(untaxedFinance.invoices[0].total, 2560, 'the invoice total still includes untaxed components');
assert.equal(untaxedFinance.invoices[0].creditDue, 0, 'a fully paid invoice has no customer credit');
const creditFinance = computeFinance([{
  id: 'fin-credit', code: 'RV-CREDIT', status: 'confirmed', startDate: '2026-06-01', endDate: '2026-06-02',
  total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 2500,
  customer: { name: 'Credit Rider' }, payments: [],
}], { invoice_prefix: 'INV/' }, {});
assert.equal(creditFinance.invoices[0].creditDue, 1500, 'overpayment is surfaced as a customer credit');
assert.equal(creditFinance.summary.customerCredit, 1500, 'the finance summary rolls up customer credit');
assert.equal(creditFinance.invoices[0].balance, 0, 'an overpaid invoice never shows a negative balance');
const pendingFinance = computeFinance([{
  id: 'fin-pending', code: 'RV-PEND', status: 'pending', startDate: '2026-07-01', endDate: '2026-07-02',
  total: 5000, fees: 0, taxable: 5000, untaxedTotal: 0, amountPaid: 0,
  customer: { name: 'Pending Rider' }, payments: [],
}], { invoice_prefix: 'INV/' }, {});
assert.equal(pendingFinance.invoices.length, 0, 'a pending request is not an invoice');
assert.equal(pendingFinance.summary.outstanding, 0, 'a pending request is not a receivable');
const completedUnpaid = computeFinance([{
  id: 'fin-done', code: 'RV-DONE', status: 'completed', startDate: '2026-07-01', endDate: '2026-07-02',
  total: 5000, fees: 0, taxable: 5000, untaxedTotal: 0, amountPaid: 1000,
  customer: { name: 'Completed Rider' }, payments: [],
}], { invoice_prefix: 'INV/' }, {});
assert.equal(completedUnpaid.summary.outstanding, 4000, 'completed trips with a balance stay outstanding');
assert.ok(finance.invoices.every((invoice) => invoice.invoiceNo.startsWith(settings.invoice_prefix)), 'invoice numbers use the admin prefix');
assert.ok(finance.taxRows.length > 0, 'the GST summary groups invoices by tax rate');
assert.equal(finance.summary.netCollected, finance.summary.grossCollected - finance.summary.refunds, 'net collected reconciles payments and refunds');
assert.equal(finance.payments.some((payment) => payment.kind === 'hold'), false, 'security deposits never enter the payment ledger');
// A UTC payment timestamp near midnight must be filtered by the local day the
// admin selected, not the UTC slice of the ISO string.
const latePaymentAt = '2026-07-01T19:30:00.000Z';
const latePaymentDate = new Date(latePaymentAt);
const latePaymentDay = `${latePaymentDate.getFullYear()}-${String(latePaymentDate.getMonth() + 1).padStart(2, '0')}-${String(latePaymentDate.getDate()).padStart(2, '0')}`;
const latePaymentFinance = computeFinance([{
  id: 'fin-late', code: 'RV-LATE', status: 'completed', startDate: '2026-07-01', endDate: '2026-07-02',
  total: 5000, fees: 0, taxable: 5000, untaxedTotal: 0, amountPaid: 5000,
  customer: { name: 'Late Rider' },
  payments: [{ id: 'pay-late', kind: 'payment', status: 'succeeded', amount: 5000, createdAt: latePaymentAt }],
}], { invoice_prefix: 'INV/' }, { from: latePaymentDay, to: latePaymentDay });
assert.equal(latePaymentFinance.payments.length, 1, 'a payment timestamp is bucketed by the local calendar day');
const depositDueBookings = bookings.filter((booking) => booking.status === 'confirmed');
assert.equal(
  finance.summary.depositsDue,
  depositDueBookings.reduce((sum, booking) => sum + (Number(booking.holdAmount) || 0), 0),
  'deposits due at pick-up come from confirmed bookings only'
);
// An active trip's security deposit is already held at the desk, so it must not
// appear again as "due". This pure fixture proves the status boundary.
const depositBoundary = computeFinance([
  {
    id: 'fin-dep-confirmed', code: 'RV-DEPC', status: 'confirmed', startDate: '2026-08-01', endDate: '2026-08-02',
    total: 2000, fees: 0, taxable: 2000, untaxedTotal: 0, amountPaid: 2000, holdAmount: 5000,
    customer: { name: 'Confirmed Rider' }, payments: [],
  },
  {
    id: 'fin-dep-active', code: 'RV-DEPA', status: 'active', startDate: '2026-07-01', endDate: '2026-07-02',
    total: 2000, fees: 0, taxable: 2000, untaxedTotal: 0, amountPaid: 2000, holdAmount: 5000,
    customer: { name: 'Active Rider' }, payments: [],
  },
], { invoice_prefix: 'INV/' }, {});
assert.equal(depositBoundary.summary.depositsDue, 5000, 'only confirmed bookings still owe the security deposit');
assert.equal(depositBoundary.summary.depositCount, 1, 'an active trip counts as held, not due');
assert.equal(depositBoundary.summary.heldOnRent, 5000, 'the deposit ledger holds the active trip deposit');
// The deposit ledger mirrors the returns desk end to end.
const depositLedger = computeFinance([
  { id: 'd1', code: 'RV-DD1', status: 'confirmed', startDate: '2026-08-01', endDate: '2026-08-02', total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 1000, holdAmount: 5000, customer: { name: 'A' }, payments: [] },
  { id: 'd2', code: 'RV-DD2', status: 'confirmed', startDate: '2026-08-03', endDate: '2026-08-04', total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 1000, holdAmount: 5000, depositCollected: { method: 'cash', amount: 5000 }, customer: { name: 'B' }, payments: [] },
  { id: 'd3', code: 'RV-DD3', status: 'active', startDate: '2026-07-01', endDate: '2026-07-02', total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 1000, holdAmount: 5000, customer: { name: 'C' }, payments: [] },
  { id: 'd4', code: 'RV-DD4', status: 'completed', startDate: '2026-06-01', endDate: '2026-06-02', total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 1000, holdAmount: 3000, customer: { name: 'D' }, payments: [] },
  { id: 'd5', code: 'RV-DD5', status: 'completed', startDate: '2026-05-01', endDate: '2026-05-02', total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 1000, holdAmount: 5000, depositSettlement: { refundDue: 4200, extraDue: 0, charges: 800 }, customer: { name: 'E' }, payments: [] },
  { id: 'd6', code: 'RV-DD6', status: 'completed', startDate: '2026-04-01', endDate: '2026-04-02', total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 1000, holdAmount: 5000, depositSettlement: { refundDue: 0, extraDue: 2500, charges: 7500 }, customer: { name: 'F' }, payments: [] },
], { invoice_prefix: 'INV/' }, {});
assert.equal(depositLedger.summary.depositsDue, 5000, 'the ledger counts only confirmed deposits still uncollected');
assert.equal(depositLedger.summary.heldOnRent, 5000, 'the ledger separates money held on active trips');
assert.equal(depositLedger.summary.awaitingDepositCount, 1, 'the ledger flags completed trips awaiting settlement');
assert.equal(depositLedger.summary.awaitingDepositAmount, 3000, '... with the deposit money still on the books');
assert.ok(depositLedger.summary.awaitingDepositAvgDays >= 0, 'the ledger always reports a sane backlog age');
const agedLedger = computeFinance([
  { id: 'a1', code: 'RV-AG1', status: 'completed', startDate: '2026-05-01', endDate: '2026-05-03', total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 1000, holdAmount: 5000, completedAt: '2026-05-10T10:00:00.000Z', customer: { name: 'A' }, payments: [] },
  { id: 'a2', code: 'RV-AG2', status: 'completed', startDate: '2026-05-01', endDate: '2026-05-03', total: 1000, fees: 0, taxable: 1000, untaxedTotal: 0, amountPaid: 1000, holdAmount: 2000, completedAt: '2026-05-20T10:00:00.000Z', customer: { name: 'B' }, payments: [] },
], { invoice_prefix: 'INV/' }, { today: '2026-05-30' });
assert.equal(agedLedger.summary.awaitingDepositCount, 2, 'the aged ledger counts every unsettled completion');
assert.equal(agedLedger.summary.awaitingDepositAvgDays, 15, 'the backlog age comes from the completion stamps (20d and 10d)');
assert.equal(agedLedger.summary.awaitingDepositMaxDays, 20, '... and reports the oldest single wait');
assert.equal(depositLedger.summary.releasedDeposits, 4200, 'the ledger sums refunds already released');
assert.equal(depositLedger.summary.extraDueDeposits, 2500, '... and charges owed beyond the deposit');
assert.equal(invoiceNumber({ invoice_prefix: 'TEST/' }, 'RV-ABC123'), 'TEST/RV-ABC123');
assert.equal(
  invoiceNumber({}, 'RV-OLD', '2025-05-10'),
  'INV/25-26/RV-OLD',
  'the invoice fallback follows the trip financial year, not today',
);
assert.equal(financialYearStart('2026-03-31'), '2025-04-01');
assert.equal(financialYearStart('2026-04-01'), '2026-04-01');
log('finance register, GST split and payment reconciliation are consistent');

// Guest checkout can be disabled without touching the customer UI.
await demoApi.adminSaveSettings({ ...settings, guest_checkout_enabled: 'false' });
await demoApi.signOut();
const guestDraft = {
  ...draft,
  startDate: '2027-11-01',
  endDate: '2027-11-04',
  driver: { ...driver, email: 'guest@example.com' },
};
let guestBlocked = false;
try {
  await demoApi.beginPayment(guestDraft);
} catch (error) {
  guestBlocked = /guest checkout is currently unavailable/i.test(error.message);
}
assert.equal(guestBlocked, true, 'guest checkout must be rejected when the admin disables it');

const restoredAdmin = await demoApi.signIn('admin@rove.rent', 'admin123');
assert.equal(restoredAdmin.role, 'admin');
await demoApi.adminSaveSettings(settings);
log('guest checkout is admin-controlled');

let badProfilePhone = false;
try {
  await demoApi.updateProfile({ phone: 'not-a-phone' });
} catch (error) {
  badProfilePhone = /phone|digits/i.test(error.message);
}
assert.equal(badProfilePhone, true, 'profile updates must reject malformed phone numbers');
const cleanProfile = await demoApi.updateProfile({ phone: restoredAdmin.phone || '+91 98765 43210' });
assert.equal(cleanProfile.phone, restoredAdmin.phone || '+91 98765 43210');
log('profile updates are validated');

assert.equal(getSiteContent({ ...settings, faqs: '[]' }).faqs.length, 0, 'an explicitly empty FAQ list must stay empty');
assert.ok(getSiteContent(settings).faqs.length > 0, 'missing FAQ content still gets sensible defaults');
const defaultFaqs = getSiteContent({}) .faqs;
assert.ok(defaultFaqs.some((item) => /extend|late/i.test(String(item.question))), 'the default FAQs explain how to extend a late return');
log('FAQ content can be cleared without defaults reappearing');

await demoApi.signOut();
assert.equal((await demoApi.getSession()).user, null);
log('sign-out clears the session');

// ---------------------------------------------------------------------------
// Vehicle comparison shortlist
// ---------------------------------------------------------------------------

const compareVehicles = [
  { id: 'veh-911', name: 'Porsche 911 Carrera', kind: 'car', pricePerDay: 24000 },
  { id: 'veh-camry', name: 'Toyota Camry Hybrid', kind: 'car', pricePerDay: 5500 },
  { id: 'veh-swift', name: 'Maruti Suzuki Swift', kind: 'car', pricePerDay: 1800 },
  { id: 'veh-tesla', name: 'Tesla Model Y Long Range', kind: 'car', pricePerDay: 9500 },
];
clearCompare();
assert.deepEqual(readCompare(), [], 'shortlist starts empty');
assert.equal(isComparing('veh-911'), false, 'nothing is compared when empty');

compareVehicles.slice(0, 3).forEach(toggleCompare);
assert.equal(readCompare().length, 3, 'three vehicles fit in the shortlist');
assert.equal(isComparing('veh-911'), true, 'added vehicles report as comparing');

const [added, toggledOff] = [toggleCompare(compareVehicles[3]), toggleCompare(compareVehicles[0])];
assert.equal(added.limit, true, 'a fourth vehicle hits the comparison limit');
assert.equal(toggledOff.added, false, 're-clicking a compared vehicle while full removes it instead');
assert.equal(toggledOff.limit, false, 'toggling an existing row off never reports a limit');
assert.equal(readCompare().some((item) => item.id === 'veh-911'), false, 're-click removed the vehicle from the shortlist');
assert.equal(readCompare().length, 2, 'toggling off frees a slot');

const afterRemove = removeFromCompare('veh-911');
assert.equal(afterRemove.length, 2, 'removing frees a slot');
assert.equal(readCompare().length, 2, 'removal persists');
assert.equal(toggleCompare(compareVehicles[3]).added, true, 'a freed slot accepts a new vehicle');
assert.equal(readCompare().some((item) => item.id === 'veh-tesla'), true, 'the new vehicle is stored');
assert.equal(readCompare().length, 3);
assert.deepEqual(pruneCompare(['veh-camry']).map((item) => item.id), ['veh-camry'], 'pruning drops stale ids');
clearCompare();
assert.equal(readCompare().length, 0, 'clearing empties the shortlist');
const snapshotShape = toggleCompare(compareVehicles[0]) && readCompare()[0];
assert.equal(typeof snapshotShape.id === 'string' && typeof snapshotShape.name === 'string', true, 'shortlist stores a safe snapshot');
clearCompare();
log('comparison shortlist caps at three and survives removals, pruning and clears');

localStorage.setItem('rove_compare_v1', 'not-json{');
assert.deepEqual(readCompare(), [], 'corrupt shortlist storage reads as empty');
localStorage.setItem('rove_compare_v1', JSON.stringify([
  { id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'a', name: 'duplicate' }, null, 'junk', { name: 'no-id' },
]));
const sanitized = readCompare();
assert.equal(sanitized.length, 2, 'shortlist read dedupes ids and drops invalid rows');
assert.deepEqual(sanitized.map((item) => item.id), ['a', 'b'], 'dedupe keeps the first occurrence in order');
clearCompare();

// Comparison decision heuristics — honest winners only.
assert.equal(rowWinnerIndex([100, 90, 120]), 1, 'low-is-best picks the cheapest in a row');
assert.equal(rowWinnerIndex([4.5, 3.9, 4.8], { lowIsBest: false }), 2, 'rating picks the highest');
assert.equal(rowWinnerIndex([100, 100, 120]), -1, 'a tie never claims a winner');
assert.equal(rowWinnerIndex(['n/a', 'n/a']), -1, 'non-numeric rows have no winner');
assert.equal(rowWinnerIndex([100, null, 120]), -1, 'a missing value blocks a row winner instead of counting as zero');
assert.equal(rowWinnerIndex([100, '', 120]), -1, 'an empty value blocks a row winner instead of counting as zero');
assert.equal(cheapestVehicleId([{ id: 'a', pricePerDay: 200 }, { id: 'b', pricePerDay: 150 }]), 'b', 'the cheapest shortlist vehicle is identified');
assert.equal(cheapestVehicleId([{ id: 'a', pricePerDay: 150 }, { id: 'b', pricePerDay: 150 }]), null, 'a price tie stays unclaimed');
assert.equal(cheapestVehicleId([]), null, 'an empty shortlist has no value pick');
log('compare decision heuristics: low/high best, ties are never claimed');

// ---------------------------------------------------------------------------
// Storefront ⌘K palette
// ---------------------------------------------------------------------------

const paletteMeta = {
  locations: [
    { name: 'Bengaluru — Indiranagar', city: 'Bengaluru' },
    { name: 'Goa — Panaji', city: 'Goa' },
  ],
};
const paletteContent = getSiteContent({});
const paletteItems = buildPaletteItems({
  content: paletteContent,
  meta: paletteMeta,
  user: null,
  isStaff: false,
  recent: [{ id: 'veh-911', name: 'Porsche 911 Carrera', type: 'Sports' }],
});
const labels = paletteItems.map((item) => item.label);
assert.ok(labels.includes('Fleet') && labels.includes('All cars'), 'palette lists core pages');
assert.ok(labels.includes('Compare'), 'palette lists comparison when enabled');
assert.ok(labels.includes('Porsche 911 Carrera'), 'palette lists recently viewed vehicles');
assert.ok(labels.includes('Bengaluru — Indiranagar') && labels.includes('Goa — Panaji'), 'palette lists every hub');
assert.ok(paletteItems.some((item) => item.group === 'hubs'), 'palette items carry groups');
assert.ok(paletteItems.some((item) => item.label === 'Sign in') && paletteItems.some((item) => item.label === 'Create an account'), 'signed-out palette offers auth actions');
assert.ok(filterPaletteItems(paletteItems, 'compare').every((item) => /compare/i.test(`${item.label} ${item.detail} ${item.keywords || ''}`)), 'palette filtering narrows to matching rows');
log('palette builder groups pages, hubs, recents and actions from content');

const bikesOff = buildPaletteItems({
  content: getSiteContent({ bikes_enabled: 'false' }),
  meta: paletteMeta,
  user: null,
});
assert.equal(bikesOff.some((item) => item.label === 'All bikes'), false, 'bike types disappear when bikes are disabled');
assert.equal(bikesOff.some((item) => item.icon === 'bike'), false, 'no bike rows remain when two-wheelers are off');
const compareOff = buildPaletteItems({
  content: getSiteContent({ compare_enabled: 'false' }),
  meta: paletteMeta,
  user: null,
});
assert.equal(compareOff.some((item) => item.label === 'Compare'), false, 'palette drops comparison when the admin disables it');
const signedIn = buildPaletteItems({
  content: getSiteContent({}),
  meta: paletteMeta,
  user: { role: 'customer' },
  isStaff: false,
});
assert.ok(signedIn.some((item) => item.to === '/account' && item.group === 'actions'), 'signed-in palette offers account actions');
const staff = buildPaletteItems({ content: getSiteContent({}), meta: paletteMeta, user: { role: 'admin' }, isStaff: true });
assert.ok(staff.some((item) => item.label === 'Admin console'), 'staff see the console in the palette');
log('palette honours bikes, comparison and auth state');

// ---------------------------------------------------------------------------
// Remember-my-trip memory
// ---------------------------------------------------------------------------

clearRememberedTrip();
assert.equal(readRememberedTrip(), null, 'trip memory starts empty');
const rememberedNow = rememberTrip({
  location: 'Mumbai — Bandra West',
  dropoff: 'Pune — Koregaon Park',
  from: '2027-11-10',
  to: '2027-11-14',
  pickupTime: '10:00',
  dropoffTime: '10:00',
  kind: 'car',
  type: 'SUV',
});
assert.ok(rememberedNow, 'a complete search is remembered');
assert.equal(readRememberedTrip().location, 'Mumbai — Bandra West', 'the remembered hub round-trips');
assert.equal(rememberTrip({ location: '', dropoff: '', from: '', to: '' }), null, 'an incomplete search is not remembered');
const prefill = mergeTripDefaults({ minDays: 3 }, readRememberedTrip(), {});
assert.equal(prefill.location, 'Mumbai — Bandra West', 'prefill carries the remembered hub');
assert.equal(prefill.dropoff, 'Pune — Koregaon Park', 'prefill carries the remembered drop-off');
assert.equal(prefill.to, '2027-11-14', 'prefill keeps future dates as-is');
const explicit = mergeTripDefaults({ minDays: 3 }, readRememberedTrip(), { location: 'Goa — Panaji' });
assert.equal(explicit.location, 'Goa — Panaji', 'an explicit trip wins over the memory');

localStorage.setItem('rove_trip_memory_v1', JSON.stringify({ ...readRememberedTrip(), from: '2020-01-01', to: '2020-01-05', at: Date.now() }));
const pastMemory = mergeTripDefaults({ minDays: 3 }, readRememberedTrip(), {});
assert.equal(pastMemory.from > '2020-01-01', true, 'expired remembered dates are rolled forward');
localStorage.setItem('rove_trip_memory_v1', '{not-json');
assert.equal(readRememberedTrip(), null, 'corrupt trip memory reads as absent');
clearRememberedTrip();
assert.equal(readRememberedTrip(), null, 'clearing removes the trip memory');
log('trip memory prefills searches, rolls stale dates forward and clears cleanly');

assert.ok(PAGE_TEXT_KEYS.includes('remember_strip_hint'), 'trip-memory copy keys are part of the admin content contract');
const memoryOff = getSiteContent({ remember_trip_enabled: 'false' });
assert.equal(memoryOff.remember_trip_enabled, false, 'trip memory is admin-controllable');
const memoryForm = contentForm({ remember_trip_enabled: 'false' });
assert.equal(memoryForm.remember_trip_enabled, false, 'the remember toggle is editable from the content form');
const memoryRoundTrip = getSiteContent(contentPayload(memoryForm));
assert.equal(memoryRoundTrip.remember_trip_enabled, false, 'the remember toggle round-trips through settings');
log('trip memory ships an admin toggle and copy keys that round-trip through settings');

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

clearSavedSearches();
assert.deepEqual(listSavedSearches(), [], 'saved searches start empty');
assert.equal(saveSearch({ label: 'Goa weekend', params: 'location=Goa&from=2027-01-01&to=2027-01-04' }).ok, true, 'a valid search saves');
assert.equal(saveSearch({ label: 'Goa again', params: 'location=Goa&from=2027-01-01&to=2027-01-04' }).duplicate, true, 'identical params are treated as duplicates');
assert.equal(saveSearch({ label: 'Goa price-capped', params: 'location=Goa&from=2027-01-01&to=2027-01-04', filters: '{"maxPrice":12000}' }).ok, true, 'the same dates with a different filter save as a distinct view');
assert.equal(saveSearch({ label: 'Goa price-capped again', params: 'location=Goa&from=2027-01-01&to=2027-01-04', filters: '{"maxPrice":12000}' }).duplicate, true, 'identical params AND filters are duplicates');
assert.equal(listSavedSearches().length, 2, 'both saved views persist with their filter set');
assert.equal(listSavedSearches().find((item) => item.label === 'Goa price-capped').filters, '{"maxPrice":12000}', 'the filter set round-trips with the entry');
clearSavedSearches();
for (let i = 0; i < SAVED_SEARCH_MAX; i += 1) saveSearch({ label: `Search ${i}`, params: `params-${i}` });
const overLimit = saveSearch({ label: 'Too many', params: 'params-overflow' });
assert.equal(overLimit.limit, true, 'saved searches cap at the documented limit');
const afterDelete = deleteSavedSearch(listSavedSearches()[0].id);
assert.equal(afterDelete.length, SAVED_SEARCH_MAX - 1, 'deleting a saved search frees a slot');
clearSavedSearches();
log('saved searches cap, dedupe and delete cleanly');

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

assert.deepEqual(
  Object.keys(normalizeNotificationPrefs({})).sort(),
  [...NOTIFICATION_PREF_KEYS].sort(),
  'notification prefs always include the canonical keys'
);
assert.equal(normalizeNotificationPrefs({ booking_confirmed: false }).booking_confirmed, false, 'an explicit false preference is preserved');
assert.equal(normalizeNotificationPrefs({}).promotions, false, 'promotions default to off');
assert.equal(validNotificationPrefs({ trip_updates: true }), true, 'valid preference patches pass');
assert.equal(validNotificationPrefs({ trip_updates: 'yes' }), false, 'non-boolean preference patches are rejected');
assert.equal(validNotificationPrefs({ unknown_key: true }), false, 'unknown preference keys are rejected');

// The saved preferences actually gate sends (email + in-app).
assert.equal(prefForKind('booking_confirmed'), 'booking_confirmed', 'booking confirmations are gated by the confirmation pref');
assert.equal(prefForKind('trip-extended'), 'trip_updates', 'extension emails are gated by trip updates');
assert.equal(prefForKind('trip_extension'), 'trip_updates', 'in-app kinds are normalised the same way');
assert.equal(prefForKind('return-due-reminder'), 'trip_updates', 'return reminders are gated by trip updates');
assert.equal(prefForKind('booking_cancelled'), 'cancellations_refunds', 'cancellations map to the refund bucket');
assert.equal(prefForKind('deposit-settled'), 'cancellations_refunds', 'deposit refunds map to the refund bucket');
assert.equal(prefForKind('winback-offer'), 'promotions', 'outreach respects the promotions opt-in');
assert.equal(prefForKind('something-else'), 'trip_updates', 'unknown kinds fall into the broad updates bucket');
assert.equal(shouldNotify('trip-extended', { trip_updates: false }), false, 'an opted-out bucket suppresses the send');
assert.equal(shouldNotify('trip-extended', { trip_updates: true }), true, 'an opted-in bucket allows the send');
assert.equal(shouldNotify('booking_cancelled', { trip_updates: false }), true, 'only the matching bucket gates a kind');
assert.equal(shouldNotify('trip-extended', {}), true, 'missing prefs default to allowed');

const prefUser = await demoApi.signIn('demo@rove.rent', 'demo123');
assert.equal(prefUser.role, 'customer');
const prefsBefore = await demoApi.getNotificationPreferences();
assert.equal(prefsBefore.promotions, false, 'promotions start off for a fresh account');
const prefsAfter = await demoApi.updateNotificationPreferences({ promotions: true, trip_updates: false });
assert.equal(prefsAfter.promotions, true, 'preferences update');
assert.equal(prefsAfter.trip_updates, false, 'preference updates land per key');
const prefsRefetched = await demoApi.getNotificationPreferences();
assert.equal(prefsRefetched.promotions, true, 'preferences persist across reads');
let invalidPrefs = false;
try {
  await demoApi.updateNotificationPreferences({ promotions: 'yes' });
} catch (error) {
  invalidPrefs = /invalid notification preference/i.test(error.message);
}
assert.equal(invalidPrefs, true, 'invalid preference values are rejected by the API');
await demoApi.updateNotificationPreferences({ promotions: false, trip_updates: true });
log('notification preferences round-trip per customer with validation');

// ---------------------------------------------------------------------------
// Self-serve trip change requests
// ---------------------------------------------------------------------------

await demoApi.signIn('demo@rove.rent', 'demo123');
const changeBookings = await demoApi.getMyBookings();
const changeDonors = changeBookings
  .filter((booking) => (
    ['pending', 'confirmed'].includes(booking.status)
    && booking.startDate >= isoOffset(0)
    // A seeded pending request (the demo's own change request) must not
    // collide with the flow test's second request.
    && (!booking.changeRequest || booking.changeRequest.status !== 'pending')
  ));
assert.ok(changeDonors.length >= 2, 'demo customer has upcoming bookings to change');
const tripA = changeDonors[0];
const tripB = changeDonors[1];

const submitRequest = async (booking, offset) => demoApi.submitChangeRequest({
  bookingId: booking.id,
  startDate: isoOffset(offset),
  endDate: isoOffset(offset + 4),
  pickupLocation: booking.pickupLocation,
  dropoffLocation: booking.dropoffLocation,
  pickupTime: '10:00',
  dropoffTime: '10:00',
});

const submitted = await submitRequest(tripA, 45);
assert.equal(submitted.ok, true, 'customer can request a trip change');
const pendingAfter = (await demoApi.getMyBookings()).find((booking) => booking.id === tripA.id);
assert.equal(pendingAfter.changeRequest?.status, 'pending', 'the requested change is pending');

await demoApi.signIn('admin@rove.rent', 'admin123');
const staffSees = (await demoApi.adminBookings()).find((booking) => booking.id === tripA.id);
assert.equal(staffSees.changeRequest?.status, 'pending', 'staff see the pending request');
const approved = await demoApi.resolveChangeRequest({ bookingId: tripA.id, decision: 'approve' });
assert.equal(approved.ok, true, 'staff can approve a change');
const afterApprove = (await demoApi.adminBookings()).find((booking) => booking.id === tripA.id);
assert.equal(afterApprove.startDate, isoOffset(45), 'approval applies the requoted dates');
assert.equal(afterApprove.changeRequest?.status, 'approved', 'the request is marked approved');
assert.equal(afterApprove.tripChanges.length, 1, 'approval records a trip-change entry');

await demoApi.signIn('demo@rove.rent', 'demo123');
assert.equal((await submitRequest(tripB, 60)).ok, true, 'customer files a second change request');
await demoApi.signIn('admin@rove.rent', 'admin123');
const declined = await demoApi.resolveChangeRequest({
  bookingId: tripB.id,
  decision: 'decline',
  reason: 'The SUV is already booked for those dates.',
});
assert.equal(declined.ok, true, 'staff can decline a change');
const afterDecline = (await demoApi.adminBookings()).find((booking) => booking.id === tripB.id);
assert.equal(afterDecline.startDate, tripB.startDate, 'a declined change leaves the booking untouched');
assert.equal(afterDecline.changeRequest?.status, 'declined', 'the request is marked declined');

await demoApi.signIn('demo@rove.rent', 'demo123');
assert.equal((await submitRequest(tripA, 70)).ok, true, 'customer can request again after a decision');
const pendingAgain = (await demoApi.getMyBookings()).find((booking) => booking.id === tripA.id);
assert.equal(pendingAgain.changeRequest?.status, 'pending', 'a second request is pending');
const withdrawn = await demoApi.cancelChangeRequest({ bookingId: tripA.id });
assert.equal(withdrawn.ok, true, 'customer can withdraw a pending request');
const afterWithdraw = (await demoApi.getMyBookings()).find((booking) => booking.id === tripA.id);
assert.equal(afterWithdraw.changeRequest, null, 'withdrawing clears the pending request');

const changeInbox = await demoApi.myNotifications();
assert.ok(changeInbox.some((notification) => notification.kind === 'trip_change_requested'), 'customer is notified when a change is requested');
assert.ok(changeInbox.some((notification) => notification.kind === 'trip_change_approved'), 'customer is notified when a change is approved');
assert.ok(changeInbox.some((notification) => notification.kind === 'trip_change_declined'), 'customer is notified when a change is declined');

// A shorter trip lowers the total below what was already paid. That difference
// must surface as a refundable credit, not silently inflate collected revenue.
await demoApi.signIn('demo@rove.rent', 'demo123');
const creditVehicle = vehicles.find((vehicle) => vehicle.status === 'available' && vehicle.kind !== 'bike');
const creditDraft = {
  ...draft,
  vehicleId: creditVehicle.id,
  startDate: isoOffset(150),
  endDate: isoOffset(155),
  pickupLocation: creditVehicle.location,
  dropoffLocation: creditVehicle.location,
  paymentPlan: 'full',
  promoCode: '',
};
const creditBooking = await demoApi.confirmPayment({
  draft: creditDraft,
  payment: { brand: 'Visa', last4: '4242', reference: 'pay_credit_1' },
});
assert.equal(creditBooking.booking.amountPaid, creditBooking.booking.total, 'the credit fixture is paid in full');
const creditRequest = await demoApi.submitChangeRequest({
  bookingId: creditBooking.booking.id,
  startDate: isoOffset(160),
  endDate: isoOffset(161),
  pickupLocation: creditVehicle.location,
  dropoffLocation: creditVehicle.location,
  pickupTime: '10:00',
  dropoffTime: '10:00',
});
assert.equal(creditRequest.ok, true, 'a shorter change request is accepted');
await demoApi.signIn('admin@rove.rent', 'admin123');
await demoApi.resolveChangeRequest({ bookingId: creditBooking.booking.id, decision: 'approve' });
const credited = (await demoApi.adminBookings()).find((booking) => booking.id === creditBooking.booking.id);
assert.ok(credited.creditDue > 0, 'a downward reprice leaves a refundable customer credit');
assert.equal(credited.creditDue, credited.amountPaid - credited.total, 'the credit equals the overpayment');
const creditRefund = await demoApi.adminRefundCredit({ bookingId: creditBooking.booking.id });
assert.equal(creditRefund.refundAmount, credited.creditDue, 'the credit refund matches the overpayment');
const afterCredit = (await demoApi.adminBookings()).find((booking) => booking.id === creditBooking.booking.id);
assert.equal(afterCredit.creditDue, 0, 'the credit is cleared after refunding');
assert.equal(afterCredit.amountPaid, afterCredit.total, 'paid now matches the new total');
assert.ok(afterCredit.payments.some((payment) => payment.kind === 'refund' && payment.amount === creditRefund.refundAmount), 'the refund is recorded in the payment ledger');
log('change-request credits: downward reprice, credit surface and refund');

// In-person payments: a confirmed booking with a remaining balance gets a
// desk-recorded payment that lands in the ledger and marks it paid.
const deskBookings = await demoApi.adminBookings();
const deskTarget = deskBookings.find((booking) => (
  ['confirmed', 'active'].includes(booking.status) && Number(booking.balanceDue) > 0
));
assert.ok(deskTarget, 'a confirmed booking with a balance exists to record against');
const deskBalance = Number(deskTarget.balanceDue);
if (deskBalance > 0) {
  const recorded = await demoApi.adminRecordPayment({
    bookingId: deskTarget.id,
    amount: deskBalance,
    method: 'cash',
    reference: 'REC-1001',
  });
  assert.ok(recorded.booking.payments.some((payment) => payment.kind === 'balance' && Number(payment.amount) === deskBalance), 'the desk payment lands in the ledger');
  assert.ok(Number(recorded.booking.amountPaid) >= Number(recorded.booking.total), 'recording the balance marks the booking paid');
  let overpaid = false;
  try {
    await demoApi.adminRecordPayment({ bookingId: deskTarget.id, amount: 1, method: 'cash' });
  } catch (error) {
    overpaid = /balance/i.test(error.message);
  }
  assert.ok(overpaid || Number(recorded.booking.balanceDue) === 0, 'over-recording is rejected once the balance is settled');
}
log('desk payments: record cash/UPI against a balance and mark the invoice paid');

await demoApi.signIn('admin@rove.rent', 'admin123');
const preToggleSettings = await demoApi.adminSettings();
await demoApi.adminSaveSettings({ change_request_enabled: 'false' });
await demoApi.signIn('demo@rove.rent', 'demo123');
let changeBlocked = false;
try {
  await submitRequest(tripB, 80);
} catch (error) {
  changeBlocked = /currently unavailable/i.test(error.message);
}
assert.equal(changeBlocked, true, 'the change-request toggle gates the feature');
await demoApi.signIn('admin@rove.rent', 'admin123');
await demoApi.adminSaveSettings(preToggleSettings);
log('self-serve trip changes flow end-to-end with staff approval and decline');

await demoApi.signIn('admin@rove.rent', 'admin123');
const preBulk = await demoApi.adminBookings();
const bulkPending = preBulk.filter((booking) => booking.status === 'pending');
if (bulkPending.length >= 2) {
  const bulkIds = bulkPending.slice(0, 2).map((booking) => booking.id);
  const bulkApproved = await demoApi.adminBulkUpdateBookings({ ids: bulkIds, status: 'confirmed' });
  assert.equal(bulkApproved.updated, 2, 'bulk approve updates every valid pending row');
  const bulkRejected = await demoApi.adminBulkUpdateBookings({ ids: bulkIds, status: 'rejected', reason: 'Cannot apply' });
  assert.equal(bulkRejected.skipped.length, 2, 'bulk skips rows that cannot transition');
  const remainingPending = (await demoApi.adminBookings()).filter((booking) => booking.status === 'pending');
  if (remainingPending.length >= 1) {
    const rejectId = remainingPending[0].id;
    const bulkRejectOne = await demoApi.adminBulkUpdateBookings({ ids: [rejectId], status: 'rejected', reason: 'Fleet freeze this week' });
    assert.equal(bulkRejectOne.updated, 1, 'bulk reject with a reason updates the row');
    const afterReject = (await demoApi.adminBookings()).find((booking) => booking.id === rejectId);
    assert.equal(afterReject.status, 'rejected', 'rejected rows land as rejected');
    assert.ok(/Fleet freeze this week/.test(afterReject.cancellationReason || ''), 'the bulk reject reason is attached for the customer');
  }
}
log('bulk booking actions approve and reject with per-row safety');

// ---------------------------------------------------------------------------
// Handover desk
// ---------------------------------------------------------------------------

const { DESK_CHECK_KEYS, activeChecks, deskBoardCounts, deskChecklist, deskCheckPayload, deskReady, docWarnings, driverAge, filterDeskBookings, minimumAge, pickupReminderEligible } = await import('../src/lib/desk.js');
const deskBooking = {
  driver: { license: 'MH0220210003003', dob: '1994-05-01' },
  vehicle: { type: 'SUV' },
  insurance: { label: 'Standard' },
  paymentStatus: 'paid',
  holdAmount: 5000,
};
const deskPolicy = { minAge: 21, minBikeAge: 18 };
const deskCheck = deskChecklist(deskBooking, deskPolicy);
assert.equal(deskCheck.licensed, true, 'a licence on file clears the licence check');
assert.ok(Number.isInteger(driverAge(deskBooking)), 'driver age is computed from DOB');
assert.ok(deskCheck.age >= deskPolicy.minAge, 'age meets the minimum');
assert.equal(deskReady(deskBooking, deskPolicy), true, 'a complete booking is ready to hand over');
assert.equal(deskChecklist({ ...deskBooking, driver: { ...deskBooking.driver, dob: '2015-01-01' } }, deskPolicy).checks.find((check) => check.key === 'age').status, 'warn', 'underage drivers are flagged as a warning');
assert.equal(deskChecklist({ ...deskBooking, driver: { ...deskBooking.driver, dob: '' } }, deskPolicy).checks.find((check) => check.key === 'age').status, 'todo', 'a missing DOB is a to-do, never a crash');
assert.equal(deskReady({ ...deskBooking, driver: {} }, deskPolicy), false, 'a missing licence blocks handover');
// The licence must stay valid for the whole rental.
const expiringBooking = { ...deskBooking, driver: { ...deskBooking.driver, licenseExpiry: '2026-11-15' }, endDate: '2026-11-20' };
const expiringCheck = deskChecklist(expiringBooking, deskPolicy);
assert.equal(expiringCheck.licenceValid, false, 'an expiry inside the rental fails the licence validity check');
assert.equal(expiringCheck.checks.find((check) => check.key === 'licence').status, 'warn', 'a mid-rental licence expiry is flagged for the desk');
assert.equal(deskReady(expiringBooking, deskPolicy), false, 'a licence that expires during the trip blocks handover by default');
assert.equal(deskReady(expiringBooking, { ...deskPolicy, licenceValidityRequired: false }, todayISO()), true, 'the admin can relax the licence-validity gate');
assert.equal(deskReady({ ...deskBooking, driver: { ...deskBooking.driver, licenseExpiry: '2026-12-01' }, endDate: '2026-11-20' }, deskPolicy), true, 'an expiry after the drop-off is fine');
assert.equal(deskReady({ ...deskBooking, driver: { ...deskBooking.driver, licenseExpiry: '2020-01-01' }, endDate: '2026-11-20' }, deskPolicy), false, 'an already-expired licence always blocks');
assert.equal(minimumAge({ vehicle: { type: 'Sport Bike' } }, deskPolicy), 18, 'bike rentals use the bike minimum age');
assert.equal(minimumAge({ vehicle: { type: 'SUV', minAge: 25 } }, deskPolicy), 25, 'a car-specific minimum age overrides the site policy');
assert.equal(minimumAge({ vehicle: { type: 'SUV', minAge: 18 } }, deskPolicy), 21, 'a vehicle can never be more permissive than the site policy');
assert.equal(deskChecklist({ ...deskBooking, vehicle: { type: 'SUV', minAge: 25 } }, deskPolicy).minAge, 25, 'the desk checklist uses the vehicle-specific minimum age');
const payload = deskCheckPayload(['licence', 'age', 'not-a-key']);
assert.equal(Object.keys(payload).length, DESK_CHECK_KEYS.length, 'checklist payloads only carry known keys');
assert.deepEqual(activeChecks(payload), ['licence', 'age'], 'active checks round-trip from the payload');

// The pick-up board: one definition of "today" and "needs attention", and a
// search that finds a customer by name, code, phone or registration.
const boardToday = '2026-10-27';
const boardRows = [
  {
    ...deskBooking,
    id: 'a',
    code: 'RV-A',
    startDate: boardToday,
    customer: { name: 'Maya Chen' },
    driver: { ...deskBooking.driver, phone: '+91 98765 43210' },
    vehicle: { type: 'SUV', name: 'Camry', registrationNumber: 'MH01AB1234' },
  },
  { ...deskBooking, id: 'b', code: 'RV-B', startDate: boardToday, driver: {}, customer: { name: 'Arjun Rao' }, vehicle: { type: 'SUV' } },
  { ...deskBooking, id: 'c', code: 'RV-C', startDate: '2026-10-29', customer: { name: 'Maya Chen' }, vehicle: { type: 'SUV' } },
  { ...deskBooking, id: 'd', code: 'RV-D', startDate: '2026-10-25', customer: { name: 'No Show' }, vehicle: { type: 'SUV' } },
];
const boardCounts = deskBoardCounts(boardRows, { today: boardToday, policy: deskPolicy });
assert.deepEqual(boardCounts, { all: 4, today: 2, attention: 2 }, 'the board counts every scope consistently');
assert.deepEqual(
  filterDeskBookings(boardRows, { query: 'maya', today: boardToday, policy: deskPolicy }).map((row) => row.id),
  ['a', 'c'],
  'search matches the customer name',
);
assert.deepEqual(
  filterDeskBookings(boardRows, { query: 'mh01ab', today: boardToday, policy: deskPolicy }).map((row) => row.id),
  ['a'],
  'search matches the registration (case-insensitive)',
);
assert.deepEqual(
  filterDeskBookings(boardRows, { query: '98765', today: boardToday, policy: deskPolicy }).map((row) => row.id),
  ['a'],
  'search matches the driver phone',
);
assert.deepEqual(
  filterDeskBookings(boardRows, { scope: 'today', today: boardToday, policy: deskPolicy }).map((row) => row.id),
  ['a', 'b'],
  'the Today scope keeps only handovers dated today',
);
assert.deepEqual(
  filterDeskBookings(boardRows, { scope: 'attention', today: boardToday, policy: deskPolicy }).map((row) => row.id),
  ['b', 'd'],
  'needs attention means overdue or not ready',
);
assert.equal(filterDeskBookings(boardRows, { query: 'nobody', today: boardToday }).length, 0, 'a miss returns an empty board');
assert.equal(filterDeskBookings(boardRows, { query: '   ', scope: 'bogus', today: boardToday }).length, 4, 'blank or unknown filters never hide rows');
assert.equal(deskBoardCounts([], {}).all, 0, 'an empty board counts as zero without throwing');
assert.ok(PAGE_TEXT_KEYS.includes('desk_scope_attention') && PAGE_TEXT_KEYS.includes('desk_ready_today'), 'the desk board labels are editable in Content');

// Compliance at handover — a lapsed document must be visible, and optionally block.
const docDay = '2026-10-27';
const lapsedDocBooking = { ...deskBooking, vehicle: { type: 'SUV', insuranceExpiry: '2026-10-15', pucExpiry: '2027-04-01' } };
assert.equal(docWarnings(lapsedDocBooking, docDay).length, 1, 'only lapsed or expiring documents are flagged at the desk');
assert.equal(docWarnings(lapsedDocBooking, docDay)[0].status, 'expired', 'a past insurance date is expired');
assert.ok(/expired/.test(docWarnings(lapsedDocBooking, docDay)[0].note), 'the warning reads like a human line');
assert.equal(docWarnings({ ...deskBooking, vehicle: { type: 'SUV', insuranceExpiry: '2027-04-01', pucExpiry: '2027-04-01' } }, docDay).length, 0, 'valid documents raise no warnings');
assert.equal(docWarnings({ ...deskBooking, vehicle: { type: 'SUV' } }, docDay).length, 2, 'missing expiry dates are surfaced, never silently ok');
assert.equal(docWarnings({ ...deskBooking, vehicle: { type: 'SUV' } }, docDay)[0].status, 'untracked', 'a missing date is untracked');
assert.equal(docWarnings({ ...deskBooking, vehicle: null }, docDay).length, 0, 'a booking without a vehicle snapshot never throws');
assert.equal(deskReady(lapsedDocBooking, deskPolicy, docDay), true, 'expired documents do not block by default');
assert.equal(deskReady(lapsedDocBooking, { ...deskPolicy, blockExpiredDocs: true }, docDay), false, 'the opt-in compliance gate blocks handover on an expired document');
assert.equal(deskReady({ ...deskBooking, vehicle: { type: 'SUV' } }, { ...deskPolicy, blockExpiredDocs: true }, docDay), true, 'an untracked date stays a warning, not a block');
assert.equal(deskChecklist(lapsedDocBooking, deskPolicy, docDay).docsBlocking, true, 'the checklist reports a document block');
assert.equal(deskChecklist(lapsedDocBooking, deskPolicy, docDay).docWarnings.length, 1, 'the checklist carries the document warnings');
assert.equal(getSiteContent({ block_expired_docs: 'true' }).policy.blockExpiredDocs, true, 'the compliance gate is admin-controlled');
assert.equal(getSiteContent({}).policy.blockExpiredDocs, false, 'the compliance gate is off by default');
// The optional deposit gate: keys only change hands once the money is in.
const depositGate = { ...deskPolicy, requireDepositAtDesk: true };
const depositBooking = { ...deskBooking, holdAmount: 5000 };
assert.equal(deskReady(depositBooking, depositGate), false, 'the deposit gate blocks handover until the deposit is ticked');
assert.equal(deskReady({ ...depositBooking, deskChecks: { deposit: true } }, depositGate), true, 'a ticked deposit clears the gate');
assert.equal(deskReady({ ...depositBooking, holdAmount: 0 }, depositGate), true, 'a booking with no deposit is never blocked');
assert.equal(deskReady(depositBooking, deskPolicy), true, 'the deposit gate is off by default');
assert.equal(
  deskChecklist(depositBooking, depositGate).checks.find((check) => check.key === 'deposit').status,
  'warn',
  'an uncollected deposit is a visible blocked item',
);
assert.equal(getSiteContent({ require_deposit_at_desk: 'true' }).policy.requireDepositAtDesk, true, 'the deposit gate is admin-controlled');
assert.equal(getSiteContent({}).policy.requireDepositAtDesk, false, 'the deposit gate is off unless enabled');
assert.ok(PAGE_TEXT_KEYS.includes('desk_docs_label') && PAGE_TEXT_KEYS.includes('desk_docs_blocked'), 'the desk document copy is editable in Content');
assert.ok(PAGE_TEXT_KEYS.includes('desk_checks_autosave'), 'the auto-save note is editable in Content');
log('desk checklist logic guards licence, age, documents and payload shape');

await demoApi.signIn('admin@rove.rent', 'admin123');
const deskList = await demoApi.adminDeskBookings();
assert.ok(Array.isArray(deskList), 'the desk lists pick-ups');
const deskBookingRow = deskList.find((booking) => ['pending', 'confirmed', 'active'].includes(booking.status) && booking.startDate >= isoOffset(0));
assert.ok(deskBookingRow, 'at least one pick-up appears on the desk');
const savedDesk = await demoApi.adminSaveDeskChecks({ bookingId: deskBookingRow.id, checked: ['licence', 'age', 'bogus'] });
assert.deepEqual(activeChecks(savedDesk.deskChecks), ['licence', 'age'], 'saved desk checks persist and drop invalid keys');
log('handover desk lists pick-ups and persists checklist state');

// Overdue pick-ups — a confirmed booking whose day passed must stay on the
// desk so staff can still hand over late or close it out as a no-show.
const allBookingsForDesk = await demoApi.adminBookings();
assert.equal(deskList.filter((row) => row.status === 'active').length, 0, 'the pick-up desk only lists bookings that have not started');
const overdueFixture = allBookingsForDesk.find((booking) => (booking.vehicleId ?? booking.vehicle?.id) === 'veh-c300' && booking.status === 'confirmed');
assert.ok(overdueFixture, 'a confirmed booking exists to move into the past');
// Well past the 14-day pending window: a confirmed commitment must still show.
await demoApi.adminUpdateBooking({ bookingId: overdueFixture.id, startDate: isoOffset(-30), endDate: isoOffset(-27) });
const overdueDesk = await demoApi.adminDeskBookings();
assert.ok(overdueDesk.some((row) => row.id === overdueFixture.id), 'a confirmed booking stays on the pick-up desk no matter how overdue');
const futureDeskRow = overdueDesk.find((row) => row.id !== overdueFixture.id && row.status === 'confirmed' && row.startDate >= isoOffset(0));
if (futureDeskRow) {
  await assert.rejects(
    () => demoApi.adminMarkNoShow({ bookingId: futureDeskRow.id }),
    /not overdue/,
    'a future pick-up cannot be marked as a no-show',
  );
}
const noShow = await demoApi.adminMarkNoShow({ bookingId: overdueFixture.id });
assert.equal(noShow.status, 'cancelled', 'marking a no-show cancels the booking');
assert.ok(/no-show/i.test(noShow.cancellationReason || ''), 'the no-show reason is recorded for the customer');
const deskAfterNoShow = await demoApi.adminDeskBookings();
assert.ok(!deskAfterNoShow.some((row) => row.id === overdueFixture.id), 'a no-show leaves the pick-up desk');
await assert.rejects(
  () => demoApi.adminMarkNoShow({ bookingId: overdueFixture.id }),
  /Only a confirmed booking/,
  'a closed booking cannot be marked as a no-show twice',
);
log('overdue pick-ups stay on the desk and can be closed as a no-show');

// ---------------------------------------------------------------------------
// Fleet health radar + bulk fleet status
// ---------------------------------------------------------------------------

const { serviceDueScore, serviceBand, fleetRadar, fleetRadarStats } = await import('../src/lib/fleetHealth.js');
assert.ok(serviceDueScore({ trips: 0, year: new Date().getFullYear() }) >= 0, 'service score never goes negative');
assert.equal(serviceBand(90), 'overdue', 'high scores are overdue');
assert.equal(serviceBand(50), 'due', 'mid scores are due soon');
assert.equal(serviceBand(10), 'fresh', 'low scores are fresh');
const radar = fleetRadar([{ id: 'a', name: 'A', year: '2020', trips: 80 }, { id: 'b', name: 'B', year: '2025', trips: 2 }], []);
assert.ok(radar.length === 2 && radar[0].score >= radar[1].score, 'radar sorts by service due');
const radarStats = fleetRadarStats(radar);
assert.equal(radarStats.total, 2, 'radar stats total');
const statsWithRadar = computeAdminStats([], [{ id: 'a', name: 'A', year: '2020', trips: 80, status: 'available', location: '' }], [], [], []);
assert.equal(statsWithRadar.analytics.fleetRadar.length, 1, 'the dashboard read model carries the fleet radar');
assert.equal(statsWithRadar.analytics.fleetRadarStats.total, 1, 'the dashboard read model carries the fleet radar totals');
await demoApi.signIn('admin@rove.rent', 'admin123');
const fleetVehicles = await demoApi.adminVehicles();
if (fleetVehicles.length >= 2) {
  const bulkFleet = await demoApi.adminBulkUpdateVehicles({ ids: [fleetVehicles[0].id, fleetVehicles[1].id], status: 'maintenance' });
  assert.equal(bulkFleet.updated, 2, 'bulk fleet status updates every valid vehicle');
  await demoApi.adminBulkUpdateVehicles({ ids: [fleetVehicles[0].id, fleetVehicles[1].id], status: 'available' });
  let badFleetStatus = false;
  try { await demoApi.adminBulkUpdateVehicles({ ids: [fleetVehicles[0].id], status: 'parked' }); } catch (error) { badFleetStatus = /valid fleet status/i.test(error.message); }
  assert.equal(badFleetStatus, true, 'bulk fleet rejects unknown statuses');
}
log('fleet radar and bulk fleet status round-trip');

// ---------------------------------------------------------------------------
// Email & notification templates
// ---------------------------------------------------------------------------

const {
  EMAIL_TEMPLATE_KINDS: TEMPLATE_KINDS, EMAIL_TEMPLATE_DEFAULTS, EMAIL_TEMPLATE_LABELS, TEMPLATE_PLACEHOLDERS,
  emailTemplateLabel, renderTemplate, templateContent, templateOverrides, templateFor, templatesPayload, templatesForm, unknownPlaceholders,
} = await import('../src/lib/emailTemplates.js');
assert.equal(TEMPLATE_KINDS.length >= 6, true, 'the template catalog covers every transactional email');
assert.ok(TEMPLATE_KINDS.every((kind) => EMAIL_TEMPLATE_DEFAULTS[kind]), 'every kind has a default');
assert.ok(TEMPLATE_KINDS.every((kind) => EMAIL_TEMPLATE_LABELS[kind]), 'every kind has a human label');
assert.equal(emailTemplateLabel('booking_confirmed'), 'Booking confirmed', 'labels are human readable');
assert.equal(TEMPLATE_PLACEHOLDERS.includes('vehicle'), true, 'the placeholder list is exported for the editor');
assert.ok(
  TEMPLATE_PLACEHOLDERS.includes('km') && TEMPLATE_PLACEHOLDERS.includes('late'),
  'kilometre and late-return terms are first-class template tokens'
);
assert.ok(EMAIL_TEMPLATE_DEFAULTS.booking_confirmed.body.includes('{km}'), 'the shipped confirmation includes the kilometre line');
assert.ok(EMAIL_TEMPLATE_DEFAULTS.booking_confirmed.body.includes('{late}'), 'the shipped confirmation includes the late-return terms');
assert.equal(renderTemplate('{km} / {late}', { km: 'K', late: 'L' }), 'K / L', 'km and late tokens interpolate');
assert.deepEqual(unknownPlaceholders('Hi {name}, {nmae} and {nmae} at {hub}'), ['nmae'], 'unknown placeholders are de-duplicated');
assert.deepEqual(unknownPlaceholders('No tokens here'), [], 'plain text has no unknown placeholders');
assert.equal(renderTemplate('Hi {name}, booking {code} at {hub}', { name: 'Maya', code: 'RV-1', hub: 'Goa' }), 'Hi Maya, booking RV-1 at Goa', 'placeholders interpolate');
assert.equal(renderTemplate('{site} ride', {}), 'Rove ride', 'the site placeholder defaults to Rove');
assert.equal(templateOverrides({ email_subject_booking_confirmed: '  Ride on!  ' })['booking_confirmed'].custom, true, 'custom subjects are detected');
await demoApi.signIn('admin@rove.rent', 'admin123');
const tplList = await demoApi.adminEmailTemplates();
assert.ok(tplList.length === TEMPLATE_KINDS.length, 'the admin can list every template');
assert.ok(tplList.every((row) => row.label === emailTemplateLabel(row.kind)), 'listed labels match the shared catalog');
const savedTpl = await demoApi.adminSaveEmailTemplate({ kind: 'booking_confirmed', subject: 'Your {site} ride {code} is confirmed', body: 'Hi {name}, see you at {hub}.' });
assert.equal(savedTpl.ok, true, 'the admin can save a template');
let emptyBody = false;
try { await demoApi.adminSaveEmailTemplate({ kind: 'booking_confirmed', subject: 'Still here', body: '   ' }); } catch (error) { emptyBody = /body/.test(error.message); }
assert.equal(emptyBody, true, 'an empty body is rejected instead of silently falling back');
await demoApi.adminSaveEmailTemplate({ kind: 'booking_confirmed', subject: EMAIL_TEMPLATE_DEFAULTS.booking_confirmed.subject, body: EMAIL_TEMPLATE_DEFAULTS.booking_confirmed.body });
log('email templates list, edit and round-trip with validation');

// Overrides apply per half. Editing only the body must not discard the
// caller's subject (or the other way round) — the bug this contract pins down.
const cancelSubjectOnly = templateFor({ email_subject_booking_cancelled: 'Override {code}' }, 'booking_cancelled');
assert.deepEqual(
  templateContent(cancelSubjectOnly, { subject: 'Caller subject', body: 'Caller body' }),
  { subject: 'Override {code}', body: 'Caller body' },
  'a subject-only override keeps the transactional body'
);
const cancelBodyOnly = templateFor({ email_body_booking_cancelled: 'Override body {code}' }, 'booking_cancelled');
assert.equal(cancelBodyOnly.custom, false, 'a body-only override is not mistaken for a subject override');
assert.deepEqual(
  templateContent(cancelBodyOnly, { subject: 'Caller subject', body: 'Caller body' }),
  { subject: 'Caller subject', body: 'Override body {code}' },
  'a body-only override actually replaces the sent body'
);
const bothTemplates = templateFor(
  { email_subject_booking_cancelled: 'S {code}', email_body_booking_cancelled: 'B {code}' },
  'booking_cancelled'
);
assert.deepEqual(
  templateContent(bothTemplates, { subject: 'Caller', body: 'Caller' }),
  { subject: 'S {code}', body: 'B {code}' },
  'subject and body overrides apply together'
);
assert.equal(
  templateContent(templateFor({}, 'booking_cancelled'), { subject: '', body: '' }).subject,
  EMAIL_TEMPLATE_DEFAULTS.booking_cancelled.subject,
  'the shipped subject is used when no override or caller subject exists'
);
log('email overrides resolve per half instead of all-or-nothing');

// Outbox: readable delivery history + one-click resend.
const outboxBefore = await demoApi.adminNotificationLog(200);
assert.ok(outboxBefore.length >= 1, 'the outbox lists queued messages');
assert.ok(outboxBefore.every((row) => row.meta && typeof row.meta === 'object'), 'outbox rows carry meta for booking deep links');
const confirmationRow = outboxBefore.find((row) => row.kind === 'booking_confirmed' && row.recipient === 'demo@rove.rent');
assert.ok(confirmationRow, 'a confirmation email is visible in the outbox');
assert.ok(confirmationRow.body.includes('Kilometres:'), 'the confirmation discloses the kilometre allowance');
assert.ok(
  /Late returns are billed|No late fee applies/.test(confirmationRow.body),
  'the confirmation discloses the late-return terms'
);
const resendSource = outboxBefore.find((row) => row.channel === 'email' && row.recipient);
const resentCopy = await demoApi.adminResendEmail({ id: resendSource.id });
assert.equal(resentCopy.status, 'queued', 'a resend is queued for the dispatcher');
assert.equal(resentCopy.meta.resentFrom, resendSource.id, 'the resend points back at the original');
assert.equal(resentCopy.body, resendSource.body, 'a resend keeps the exact rendered body');
const outboxAfter = await demoApi.adminNotificationLog(200);
assert.equal(outboxAfter.length, outboxBefore.length + 1, 'the resend joins the outbox');
assert.ok(outboxAfter.some((row) => row.id === resentCopy.id), 'the new copy is readable immediately');
let resendMissing = false;
try { await demoApi.adminResendEmail({ id: 'eml-does-not-exist' }); } catch (error) { resendMissing = /not found/i.test(error.message); }
assert.equal(resendMissing, true, 'resending an unknown email fails with a clear message');

// Opting out is respected by resend, not just by new mail.
await demoApi.signIn('demo@rove.rent', 'demo123');
await demoApi.updateNotificationPreferences({ booking_confirmed: false });
await demoApi.signIn('admin@rove.rent', 'admin123');
let optedOutResend = false;
try { await demoApi.adminResendEmail({ id: confirmationRow.id }); } catch (error) { optedOutResend = /opted out/i.test(error.message); }
assert.equal(optedOutResend, true, 'a resend respects the customer opt-out');
await demoApi.signIn('demo@rove.rent', 'demo123');
await demoApi.updateNotificationPreferences({ booking_confirmed: true });
await demoApi.signIn('admin@rove.rent', 'admin123');
log('outbox lists rendered messages and resends with opt-out protection');

// ---------------------------------------------------------------------------
// Availability alerts
// ---------------------------------------------------------------------------

await demoApi.signIn('jordan@example.com', 'demo123');
assert.deepEqual(await demoApi.listAvailabilityAlerts(), [], 'the watchlist starts empty');
const alertVehicle = (await demoApi.listVehicles()).vehicles[0];
const createdAlert = await demoApi.createAvailabilityAlert({ vehicleId: alertVehicle.id, startDate: isoOffset(12), endDate: isoOffset(16) });
assert.equal(createdAlert.ok, true, 'a customer can create an availability alert');
assert.equal((await demoApi.listAvailabilityAlerts()).length, 1, 'created alerts appear in the watchlist');
let alertDup = false;
try { await demoApi.createAvailabilityAlert({ vehicleId: alertVehicle.id, startDate: isoOffset(12), endDate: isoOffset(16) }); } catch (error) { alertDup = /already/.test(error.message); }
assert.equal(alertDup, true, 'duplicate alerts are rejected');
let pastAlert = false;
try { await demoApi.createAvailabilityAlert({ vehicleId: alertVehicle.id, startDate: '2020-01-01', endDate: '2020-01-04' }); } catch (error) { pastAlert = true; }
assert.equal(pastAlert, true, 'past windows are rejected');
await demoApi.deleteAvailabilityAlert({ alertId: createdAlert.alert.id });
assert.equal((await demoApi.listAvailabilityAlerts()).length, 0, 'alerts can be removed');
log('availability alerts create, dedupe, validate and delete');

// ---------------------------------------------------------------------------
// Customer CRM: segmentation, lifetime value and bulk outreach
// ---------------------------------------------------------------------------

const {
  segmentCustomers: buildCustomers, crmSummary: summariseCustomers, segmentMix: mixCustomers, winbackAudience: winback,
  customerMoneyKey, buildCustomerMoneyMap,
} = await import('../src/lib/customers.js');

// Per-customer money position (booking drawer snapshot) -----------------------
assert.equal(customerMoneyKey({ userId: 'usr-1' }), 'acct:usr-1', 'an account booking groups by user id');
assert.equal(customerMoneyKey({ customer: { id: 'usr-2' } }), 'acct:usr-2', 'the customer object id wins for account rows');
assert.equal(customerMoneyKey({ guestEmail: 'GUEST@x.io' }), 'guest:guest@x.io', 'a guest groups by normalised email');
assert.equal(customerMoneyKey({}), '', 'an anonymous ungroupable booking has no key');
const moneyMap = buildCustomerMoneyMap([
  { userId: 'usr-maya', customer: { id: 'usr-maya', name: 'Maya Chen' }, status: 'confirmed', balanceDue: 47043, creditDue: 0, holdAmount: 5000 },
  { userId: 'usr-maya', status: 'pending', balanceDue: 99999, creditDue: 0, holdAmount: 5000 },
  { userId: 'usr-maya', status: 'active', balanceDue: 0, creditDue: 0, holdAmount: 5000 },
  { userId: 'usr-maya', status: 'completed', balanceDue: 0, creditDue: 1500, holdAmount: 5000 },
  { userId: 'usr-maya', status: 'completed', balanceDue: 0, creditDue: 0, holdAmount: 3000, depositSettlement: {} },
  { guestEmail: 'guest@x.io', status: 'active', balanceDue: 12000, holdAmount: 2000 },
]);
const mayaMoney = moneyMap.get('acct:usr-maya');
assert.equal(mayaMoney.name, 'Maya Chen', 'the snapshot carries the customer name');
assert.equal(mayaMoney.outstanding, 47043, 'outstanding sums only confirmed/active/completed balances, never unapproved quotes');
assert.equal(mayaMoney.creditDue, 1500, 'credit sums overpayments');
assert.equal(mayaMoney.depositsHeld, 10000, 'deposits held span active + completed-unsettled');
assert.equal(mayaMoney.awaiting, 1, 'the awaiting count covers unsettled completions only');
assert.equal(mayaMoney.awaitingAmount, 5000, '... and the money behind them');
assert.equal(moneyMap.get('guest:guest@x.io').outstanding, 12000, 'guest money rolls up separately from accounts');

const crmFixture = buildCustomers(
  [
    { id: 'c1', name: 'VIP Vera', email: 'vera@example.com', createdAt: isoOffset(-400), account: true },
    { id: 'c2', name: 'New Nina', email: 'nina@example.com', createdAt: isoOffset(-5), account: true },
    { id: 'c3', name: 'Guest Gita', email: 'gita@example.com', createdAt: isoOffset(-200), account: false },
  ],
  [
    { userId: 'c1', status: 'completed', total: 50000, startDate: isoOffset(-200), createdAt: isoOffset(-210) },
    { userId: 'c1', status: 'completed', total: 60000, startDate: isoOffset(-100), createdAt: isoOffset(-110) },
    { userId: 'c1', status: 'completed', total: 50000, startDate: isoOffset(-30), createdAt: isoOffset(-40) },
    { userId: 'c1', status: 'completed', total: 50000, startDate: isoOffset(-5), createdAt: isoOffset(-10) },
    { userId: 'c2', status: 'pending', total: 30000, startDate: isoOffset(10), createdAt: isoOffset(-1) },
    { userId: 'c3', status: 'completed', total: 20000, startDate: isoOffset(-300), createdAt: isoOffset(-310) },
  ],
);
const crmVip = crmFixture.find((row) => row.id === 'c1');
const crmNew = crmFixture.find((row) => row.id === 'c2');
const crmGuest = crmFixture.find((row) => row.id === 'c3');
assert.equal(crmVip.segment, 'vip', 'four completed trips make a VIP');
assert.equal(crmVip.lifetimeValue, 210000, 'lifetime value only counts completed trips');
assert.equal(crmNew.segment, 'prospect', 'a fresh customer with no completed trips is a prospect');
assert.ok(crmNew.nextTripDate, 'upcoming trips surface as the next trip date');
assert.equal(crmGuest.account, false, 'guests are flagged separately');
assert.equal(crmGuest.risk, 'high', 'a guest quiet for 300 days is at risk');

const favouriteFixture = buildCustomers(
  [{ id: 'f1', name: 'Fav Fan', email: 'fav@example.com', createdAt: isoOffset(-30), account: true }],
  [
    { userId: 'f1', status: 'completed', total: 1000, startDate: isoOffset(-20), vehicleType: 'SUV', hub: 'Hub A' },
    { userId: 'f1', status: 'rejected', total: 1000, startDate: isoOffset(-10), vehicleType: 'Bike', hub: 'Hub B' },
  ],
);
assert.equal(favouriteFixture[0].favouriteType, 'SUV', 'a rejected request does not become the favourite type');
assert.equal(favouriteFixture[0].favouriteHub, 'Hub A', 'a rejected request does not become the favourite hub');

const crmStats = summariseCustomers(crmFixture);
assert.equal(crmStats.total, 3, 'summary counts every customer');
assert.equal(crmStats.vip, 1, 'summary counts VIPs');
assert.equal(crmStats.repeatRate, 50, 'repeat rate is measured against customers who have travelled');
assert.equal(crmStats.atRisk, 1, 'summary counts at-risk relationships');
assert.equal(mixCustomers(crmFixture).reduce((sum, row) => sum + row.value, 0), 3, 'segment mix adds up to all customers');
assert.equal(winback(crmFixture).some((row) => row.id === 'c3'), true, 'win-back audience includes at-risk customers');

await demoApi.signIn('admin@rove.rent', 'admin123');
const crmData = await demoApi.adminCustomers();
assert.ok(crmData.customers.length >= 3, 'the admin can list customers');
assert.equal(crmData.summary.total, crmData.customers.length, 'summary totals match the customer list');
const mailable = crmData.customers.filter((row) => row.email && !row.isGuest).slice(0, 2);
assert.equal(mailable.length, 2, 'at least two registered customers exist for outreach');
// Campaigns respect the promotions opt-in, so opt the recipients in first.
for (const customer of mailable) {
  await demoApi.signIn(customer.email, 'demo123');
  await demoApi.updateNotificationPreferences({ promotions: true });
}
await demoApi.signIn('admin@rove.rent', 'admin123');
const logBefore = (await demoApi.adminNotificationLog(200)).length;
const bulkMail = await demoApi.adminEmailCustomers({ customerIds: mailable.map((row) => row.id), template: 'winback_offer' });
assert.equal(bulkMail.sent, mailable.length, 'bulk outreach reaches every selected customer with an email');
assert.equal(bulkMail.skipped.length, 0, 'no opted-in customer is skipped');
const logAfter = await demoApi.adminNotificationLog(200);
assert.equal(logAfter.length, logBefore + mailable.length, 'every outreach message is queued for the dispatcher');
assert.ok(logAfter.slice(0, mailable.length).every((row) => row.kind === 'winback_offer' && row.subject && row.body), 'queued outreach has a rendered subject and body');
for (const customer of mailable) {
  await demoApi.signIn(customer.email, 'demo123');
  await demoApi.updateNotificationPreferences({ promotions: false });
}
await demoApi.signIn('admin@rove.rent', 'admin123');
// A customer who never opted in to promotions is reported as skipped.
const optOutMail = await demoApi.adminEmailCustomers({ customerIds: [mailable[0].id], template: 'winback_offer' });
assert.equal(optOutMail.sent, 0, 'a promotions opt-out stops the campaign');
assert.equal(optOutMail.skipped.length, 1, 'the desk is told exactly who was skipped and why');
let emptyMail = false;
try { await demoApi.adminEmailCustomers({ customerIds: [], template: 'winback_offer' }); } catch (error) { emptyMail = /at least one/i.test(error.message); }
assert.equal(emptyMail, true, 'bulk outreach requires a selection');
let badTemplate = false;
try { await demoApi.adminEmailCustomers({ customerIds: [mailable[0].id], template: 'not_a_template' }); } catch (error) { badTemplate = /valid message template/i.test(error.message); }
assert.equal(badTemplate, true, 'bulk outreach rejects unknown templates');
log('customer 360 segmentation, lifetime value and bulk outreach');

// ---------------------------------------------------------------------------
// Returns desk: inspection validation and deposit settlement
// ---------------------------------------------------------------------------

const {
  lateDays: daysLate, lateHours: hoursLate, lateCharge, lateDuration: lateDurationH,
  returnChecklist: buildReturnChecklist,
  settlementFor: settleMath, inspectionPayload, settlementRecord, returnCheckPayload: checkPayload,
  returnsSummary: summariseDeposits, returnTimeliness, returnForecast, lateReturnsByVehicle, lateRepeatOffenders,
  filterReturnBookings, depositOutcome, settlementWaitDays, maxAwaitingDays, depositRefundRows,
} = await import('../src/lib/returns.js');
const {
  inspectionLine, inspectionProblems, kmDriven, normalizeInspection, returnCondition,
} = await import('../src/lib/inspection.js');
const {
  excessKm, kmAllowance, kmDisclosure, kmSummary, kmVehicleProblems,
} = await import('../src/lib/km.js');
const {
  advanceEnd, defaultExtension, extendProblem, extensionsEnabled, nextSlotAfter,
} = await import('../src/lib/extend.js');
const {
  extensionSummary,
} = await import('../src/lib/stats.js');
const {
  tripHistoryEntries,
} = await import('../src/lib/tripHistory.js');
const {
  tripCountdown,
} = await import('../src/lib/tripCountdown.js');
const {
  nextTrip,
} = await import('../src/lib/upcoming.js');

// ---------------------------------------------------------------------------
// Trip extension: pure validation and quick-slot maths
// ---------------------------------------------------------------------------
const extendNow = new Date('2026-03-05T09:00:00');
assert.equal(extendProblem({ startDate: '2026-03-01', endDate: '2026-03-06', dropoffTime: '10:00' }, { endDate: '2026-03-07', dropoffTime: '10:00' }, { policy: { maxDays: 45 }, now: extendNow }), null, 'a later return date extends cleanly');
assert.equal(extendProblem({ startDate: '2026-03-01', endDate: '2026-03-06', dropoffTime: '10:00' }, { endDate: '2026-03-06', dropoffTime: '12:00' }, { policy: {}, now: extendNow }), null, 'a later time on the same day is a valid extension');
assert.equal(extendProblem({ startDate: '2026-03-01', endDate: '2026-03-06', dropoffTime: '10:00' }, { endDate: '2026-03-06', dropoffTime: '10:00' }, { policy: {}, now: extendNow }), 'The new return must be later than the current drop-off.', 'an unchanged return is rejected');
assert.equal(extendProblem({ startDate: '2026-03-01', endDate: '2026-03-06', dropoffTime: '10:00' }, { endDate: '2026-03-05', dropoffTime: '10:00' }, { policy: {}, now: extendNow }), 'The new return must be later than the current drop-off.', 'shortening the return is rejected');
assert.equal(extendProblem({ startDate: '2026-03-01', endDate: '2026-03-05', dropoffTime: '06:00' }, { endDate: '2026-03-05', dropoffTime: '08:00' }, { policy: {}, now: extendNow }), 'This return time has already passed — choose a later date or time.', 'a slot that has already passed today is rejected');
assert.equal(extendProblem({ startDate: '2026-03-01', endDate: '2026-03-06', dropoffTime: '10:00' }, { endDate: '2026-04-10', dropoffTime: '10:00' }, { policy: { maxDays: 30 }, now: extendNow }), 'Rentals are limited to 30 days.', 'an extension past the max rental length is rejected');
assert.equal(extendProblem({ startDate: '2026-03-01', endDate: '2026-03-06', dropoffTime: '10:00' }, { endDate: '2026-03-10', dropoffTime: '25:00' }, { policy: {}, now: extendNow }), 'Choose a valid return date and drop-off slot.', 'an invalid drop-off slot is rejected');
assert.equal(extensionsEnabled({ extensions_enabled: 'false' }), false, 'the extension toggle can be switched off');
assert.equal(extensionsEnabled({}), true, 'extensions default to on');
assert.deepEqual(advanceEnd({ endDate: '2026-03-01', dropoffTime: '23:30' }, 2), { endDate: '2026-03-02', dropoffTime: '01:30' }, '+2 hours rolls across midnight');
assert.deepEqual(advanceEnd({ endDate: '2026-03-01', dropoffTime: '10:00' }, 24), { endDate: '2026-03-02', dropoffTime: '10:00' }, '+1 day keeps the same slot');
assert.deepEqual(defaultExtension({ endDate: isoOffset(5), dropoffTime: '12:00' }), { endDate: isoOffset(5), dropoffTime: '12:00' }, 'an upcoming return starts from the booked end');
const overdueStart = defaultExtension({ endDate: '2000-01-01', dropoffTime: '10:00' });
assert.equal(overdueStart.endDate >= isoOffset(0), true, 'an overdue return seeds from today, not the past');
const sameDayNow = new Date('2026-03-05T18:01:00');
assert.deepEqual(defaultExtension({ endDate: '2026-03-05', dropoffTime: '10:00' }, sameDayNow), { endDate: '2026-03-05', dropoffTime: '18:30' }, 'a same-day slot the clock has passed seeds from the next future slot');
assert.deepEqual(defaultExtension({ endDate: '2026-03-05', dropoffTime: '19:00' }, sameDayNow), { endDate: '2026-03-05', dropoffTime: '19:00' }, 'a still-future same-day slot stays put');
assert.deepEqual(defaultExtension({ endDate: '2026-03-05', dropoffTime: '18:00' }, new Date('2026-03-05T18:00:00')), { endDate: '2026-03-05', dropoffTime: '18:30' }, 'an extension seeded exactly on the minute is nudged to a strictly later slot');
assert.deepEqual(defaultExtension({ endDate: '2026-03-04', dropoffTime: '10:00' }, sameDayNow), { endDate: '2026-03-05', dropoffTime: '18:30' }, 'a past day seeds from now, not the old drop-off');
assert.deepEqual(defaultExtension(null, sameDayNow), { endDate: '2026-03-06', dropoffTime: '10:00' }, 'a missing booking seeds tomorrow morning');
assert.equal(nextSlotAfter(new Date('2026-03-01T10:00:00')).dropoffTime, '10:00', 'a time exactly on the grid stays on the grid');
assert.equal(nextSlotAfter(new Date('2026-03-01T10:14:00')).dropoffTime, '10:30', 'a partial slot rounds up to the grid');
assert.deepEqual(extensionSummary([
  { tripChanges: [
    { type: 'extension', delta: 2400, at: '2026-03-01T00:00:00Z', by: 'Maya Chen', summary: 'a' },
    { type: 'change', delta: -1000, at: '2026-03-02T00:00:00Z', by: 'Staff' },
  ] },
  { tripChanges: [{ type: 'extension', delta: 600, at: '2026-03-03T00:00:00Z', by: 'Desk' }] },
]).count, 2, 'the extension summary counts only extension events');
assert.equal(extensionSummary([
  { tripChanges: [{ type: 'extension', delta: 2400 }, { type: 'extension', delta: 600 }] },
]).revenueDelta, 3000, 'the extension summary sums the extra revenue');
const trailContent = {
  amend_history_extension: 'Return extended · {summary}',
  amend_history_extension_noop: 'Return extended',
  amend_history_change: 'Dates / hubs changed · {summary}',
  amend_history_by: 'Actioned by {by}',
  amend_history_delta_more: '{amount} more due',
  amend_history_delta_less: '{amount} credited',
};
const historyLines = tripHistoryEntries({
  code: 'RV-HST',
  tripChanges: [
    { type: 'extension', at: '2026-03-01T10:00:00Z', by: 'Maya Chen', delta: 2400, summary: 'Return 2026-02-25 10:00 → 2026-03-01 10:00' },
    { type: 'change', at: '2026-02-20T10:00:00Z', by: 'Avery Ross', delta: -1000, summary: '2026-02-20 → 2026-02-25' },
  ],
}, trailContent);
assert.equal(historyLines.length, 2, 'the trip-activity trail maps every change row');
assert.equal(historyLines[0].type, 'extension', 'an extension row is labelled as an extension');
assert.equal(historyLines[1].type, 'change', 'a staff date edit is labelled as a change');
assert.ok(historyLines[0].title.includes('Return extended'), 'the extension title wraps the summary');
assert.ok(historyLines[0].detail.includes('more due'), 'a positive delta reads as more due');
assert.ok(historyLines[1].detail.includes('credited'), 'a negative delta reads as credited');
const thisMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const monthlyExtensions = extensionSummary([
  { tripChanges: [{ type: 'extension', delta: 2400, at: `${thisMonthKey}-10T09:00:00Z` }] },
  { tripChanges: [{ type: 'change', delta: 500, at: `${thisMonthKey}-11T09:00:00Z` }] },
]);
assert.equal(monthlyExtensions.byMonth.find((row) => row.label === thisMonthKey)?.value, 2400, 'the monthly extension bar counts only extension revenue');
const countdownToday = '2026-10-28';
assert.deepEqual(
  tripCountdown({ status: 'active', startDate: '2026-10-20', endDate: '2026-10-26', dropoffTime: '18:00' }, { today: countdownToday }),
  { key: 'overdue', days: 2, labelHint: 'overdue' },
  'an overdue active trip reads as overdue from the same rule as the desk',
);
assert.equal(tripCountdown({ status: 'active', startDate: '2026-10-20', endDate: '2026-10-28', dropoffTime: '18:00' }, { today: countdownToday }).key, 'due_today', 'a trip ending today is due today');
assert.equal(tripCountdown({ status: 'active', startDate: '2026-10-20', endDate: '2026-10-29', dropoffTime: '18:00' }, { today: countdownToday }).key, 'due_tomorrow', 'a trip ending tomorrow is due tomorrow');
assert.equal(tripCountdown({ status: 'active', startDate: '2026-10-20', endDate: '2026-10-31', dropoffTime: '18:00' }, { today: countdownToday }).days, 3, 'a future return counts the days left');
assert.equal(tripCountdown({ status: 'confirmed', startDate: '2026-10-28', endDate: '2026-11-01', pickupTime: '10:00' }, { today: countdownToday }).key, 'starts_today', 'an upcoming trip starting today is pick-up today');
assert.equal(tripCountdown({ status: 'confirmed', startDate: '2026-10-30', endDate: '2026-11-02' }, { today: countdownToday }).days, 2, 'an upcoming trip counts days until pick-up');
assert.equal(tripCountdown({ status: 'pending', startDate: '2026-10-29', endDate: '2026-10-31' }, { today: countdownToday }).key, 'starts_tomorrow', 'a pending trip starting tomorrow is pick-up tomorrow');
assert.equal(tripCountdown({ status: 'confirmed', startDate: '2026-10-25', endDate: '2026-10-29' }, { today: countdownToday }).days, 3, 'an un-started trip with a past pick-up counts the missed days');
assert.equal(tripCountdown({ status: 'completed', startDate: '2026-10-20', endDate: '2026-10-26' }, { today: countdownToday }), null, 'closed trips get no countdown');
assert.equal(tripCountdown(null, { today: countdownToday }), null, 'missing bookings get no countdown');
// The storefront's next-trip card picks the one trip worth surfacing.
const tripBoard = [
  { code: 'RV-N1', status: 'confirmed', startDate: '2026-11-04', endDate: '2026-11-06' },
  { code: 'RV-N2', status: 'active', startDate: '2026-10-25', endDate: '2026-10-30' },
  { code: 'RV-N3', status: 'confirmed', startDate: '2026-11-02', endDate: '2026-11-03' },
  { code: 'RV-N4', status: 'pending', startDate: '2026-11-02', endDate: '2026-11-03' },
  { code: 'RV-N5', status: 'completed', startDate: '2026-10-01', endDate: '2026-10-02' },
  { code: 'RV-N6', status: 'cancelled', startDate: '2026-10-03', endDate: '2026-10-04' },
];
assert.equal(nextTrip(tripBoard).code, 'RV-N2', 'an active rental always wins the next-trip card');
assert.equal(nextTrip(tripBoard.filter((trip) => trip.status !== 'active')).code, 'RV-N3', 'the soonest confirmed pick-up wins when nothing is out');
assert.equal(
  nextTrip([
    { code: 'RV-N7', status: 'pending', startDate: '2026-11-02', endDate: '2026-11-03' },
    { code: 'RV-N8', status: 'confirmed', startDate: '2026-11-02', endDate: '2026-11-03' },
  ]).code,
  'RV-N8',
  'on the same day a confirmed trip outranks a pending one',
);
assert.equal(nextTrip([{ code: 'RV-N9', status: 'completed', startDate: '2026-10-01', endDate: '2026-10-02' }]), null, 'closed trips never fill the card');
assert.equal(nextTrip([]), null, 'an empty account gets no next-trip card');
assert.equal(nextTrip(null), null, 'the next-trip selector is safe on a null list');
assert.equal(getSiteContent({}).home_show_upcoming_trip, true, 'the next-trip card is on by default');
assert.equal(getSiteContent({ home_show_upcoming_trip: 'false' }).home_show_upcoming_trip, false, 'the next-trip card is admin-controlled');
log('trip extension: pure validation, quick slots, activity trail, countdown and summary');

assert.equal(inspectionProblems({ odometer: '', fuel: 'Full', cleanliness: 'clean' })[0], 'Enter the odometer reading in kilometres.', 'a hand-over needs an odometer');
assert.equal(inspectionProblems({ odometer: 41000, fuel: '', cleanliness: 'clean' }).length, 1, 'a hand-over needs a fuel level');
assert.equal(inspectionProblems({ odometer: 41000, fuel: 'Full', cleanliness: '', }).length, 1, 'a hand-over needs a cleanliness level');
assert.equal(inspectionProblems({ odometer: 2_000_001, fuel: 'Full', cleanliness: 'clean' })[0], 'Keep the odometer under 20,00,000 km.', 'the odometer ceiling matches the workshop log');
assert.equal(inspectionProblems({ odometer: '41 250', fuel: 'Full', cleanliness: 'clean' }).length, 1, 'a non-numeric odometer is rejected');
assert.equal(inspectionProblems({ odometer: 41000, fuel: 'Full', cleanliness: 'clean' }, { minOdometer: 41250 })[0], 'Odometer cannot be lower than the pick-up reading (41,250 km).', 'a drop-off cannot read below the pick-up');
assert.equal(inspectionProblems({ odometer: '', fuel: 'Full', cleanliness: 'clean' }, { requireOdometer: false }).length, 0, 'a legacy return without a pick-up record may skip the odometer');
assert.deepEqual(normalizeInspection({ odometer: '41250', fuel: 'Full', cleanliness: 'clean', damage: ['front', 'front', 'nope'], note: '  ok  ' }).damage, ['front'], 'damage areas are de-duplicated and validated');
const pickupLine = inspectionLine({ odometer: 41250, fuel: 'Full', cleanliness: 'clean', damage: ['front'] });
assert.equal(pickupLine, '41,250 km · Fuel Full · Clean · Damage: Front bumper', 'the condition line reads like a human wrote it');
assert.equal(inspectionLine(null), 'No condition report on file', 'a missing report still says something meaningful');
assert.equal(kmDriven({ odometer: 41250 }, { odometer: 41980 }), 730, 'km driven is the odometer difference');
assert.equal(kmDriven({ odometer: 41980 }, { odometer: 41000 }), null, 'km driven refuses an impossible reading');
assert.equal(returnCondition({ odometer: 41980, fuel: 'Full', cleanliness: 'average' }, { pickupOdometer: 41250 }).odometer, 41980, 'a valid return read passes');
assert.throws(() => returnCondition({ odometer: 41000, fuel: 'Full', cleanliness: 'clean' }, { pickupOdometer: 41250 }), /lower than the pick-up reading/, 'a below-pickup return read throws');
assert.equal(returnCondition({ fuel: 'Full', cleanliness: 'clean' }, { pickupOdometer: null }).odometer, null, 'a legacy return stores no odometer instead of a fake zero');

assert.equal(daysLate({ endDate: isoOffset(-3) }), 3, 'late days count from the drop-off date');
assert.equal(daysLate({ endDate: isoOffset(2) }), 0, 'future drop-offs are not late');
assert.equal(
  daysLate({ status: 'completed', endDate: isoOffset(-30) }),
  30,
  'a completed-but-unsettled return with no completion date stays late up to today (previously settled with zero charges)',
);
assert.equal(daysLate({ status: 'completed', endDate: isoOffset(-5), completedAt: `${isoOffset(-3)}T12:00:00.000Z` }), 2, 'completed trips use the recorded completion date');

const noCharges = settleMath({ holdAmount: 5000 });
assert.equal(noCharges.status, 'released', 'a clean return releases the whole deposit');
assert.equal(noCharges.refundDue, 5000, 'clean return refunds the full deposit');
assert.equal(noCharges.charges, 0, 'clean return has no charges');

const partial = settleMath({ holdAmount: 5000, lateDays: 2, lateFeePerDay: 1000, damageFee: 500 });
assert.equal(partial.charges, 2500, 'late and damage charges add up');
assert.equal(partial.refundDue, 2500, 'partial settlement refunds the remainder');
assert.equal(partial.status, 'partial', 'partial settlement is labelled correctly');

const over = settleMath({ holdAmount: 5000, damageFee: 8000 });
assert.equal(over.extraDue, 3000, 'charges beyond the deposit become an explicit extra due');
assert.equal(over.status, 'extra', 'over-deposit settlement is flagged');

const longLate = settleMath({ holdAmount: 5000, lateDays: 20, lateFeePerDay: 12000 });
assert.equal(longLate.lateFee, 240000, 'a long late return keeps the full day-rate product, not a silent cap');
assert.equal(longLate.extraDue, 235000, 'the late-fee overage becomes an explicit extra due');

// Customer-facing deposit outcome (Account trip chips) ----------------------
assert.deepEqual(depositOutcome({ status: 'completed', depositSettlement: over }), { key: 'extra', amount: 3000 }, 'an over-deposit settlement reads as an extra charge');
assert.deepEqual(depositOutcome({ status: 'completed', depositSettlement: partial }), { key: 'refunded', amount: 2500 }, 'a partial settlement leads with the net refund');
assert.deepEqual(depositOutcome({ status: 'completed', depositSettlement: { holdAmount: 5000, charges: 5000, refundDue: 0 } }), { key: 'deducted', amount: 5000 }, 'a fully-used deposit reads as deducted');
assert.deepEqual(depositOutcome({ status: 'completed', depositSettlement: { holdAmount: 5000, charges: 0, refundDue: 0 } }), { key: 'released', amount: 0 }, 'a zero-value settlement still confirms release');
assert.deepEqual(depositOutcome({ status: 'completed', depositSettlement: { charges: '800' } }), { key: 'deducted', amount: 800 }, 'legacy string settlements parse');
assert.deepEqual(depositOutcome({ status: 'active', holdAmount: 5000 }), { key: 'held', amount: 5000 }, 'an active trip shows the deposit held');
assert.deepEqual(depositOutcome({ status: 'completed', holdAmount: '5000' }), { key: 'awaiting', amount: 5000 }, 'a completed trip with no settlement awaits settlement');
assert.deepEqual(depositOutcome({ status: 'confirmed', holdAmount: 5000 }), { key: 'due', amount: 5000 }, 'a confirmed trip reminds the customer what is due at pick-up');
assert.deepEqual(depositOutcome({ status: 'pending', holdAmount: 5000 }), { key: 'due', amount: 5000 }, 'a pending trip shows the same deposit reminder');
assert.equal(depositOutcome({ status: 'active', holdAmount: 0 }), null, 'no deposit means no chip');
assert.equal(depositOutcome({ status: 'confirmed', holdAmount: 0 }), null, 'no deposit means no reminder');
assert.equal(depositOutcome({ status: 'cancelled', holdAmount: 5000 }), null, 'a cancelled trip never asks for a deposit');
assert.equal(depositOutcome({}), null, 'an empty booking is safe');
assert.equal(depositOutcome(null), null, 'a missing booking is safe');

// Hourly late billing ------------------------------------------------------
// The drop-off is a date *and* time; a car due at 10:00 and returned at 09:00
// the next morning is 23 hours late, never a whole extra day.
const dueTrip = { endDate: '2026-10-28', dropoffTime: '10:00', status: 'active' };
const at = (iso) => new Date(iso);
assert.equal(hoursLate(dueTrip, at('2026-10-28T10:30:00'), 60), 0, 'a return inside the grace window is free');
assert.equal(hoursLate(dueTrip, at('2026-10-28T11:01:00'), 60), 1, 'the first started hour past grace is billed');
assert.equal(hoursLate(dueTrip, at('2026-10-28T23:00:00'), 60), 12, 'a same-day overrun bills the started hours');
assert.equal(hoursLate(dueTrip, at('2026-10-29T09:00:00'), 0), 23, 'overnight lateness is measured from the drop-off time, not midnight');
assert.equal(hoursLate({ ...dueTrip, endDate: 'not-a-date' }, at('2026-10-29T09:00:00')), 0, 'a malformed date never invents lateness');
assert.equal(
  hoursLate({ ...dueTrip, status: 'completed', completedAt: '2026-10-29T09:00:00' }, at('2026-11-10T09:00:00')),
  23,
  'a completed trip is billed to its recorded completion time, not to today',
);

const lateRates = { lateFeePerHour: 500, lateFeePerDay: 12000, graceMinutes: 60 };
assert.equal(lateDurationH(0), '0h', 'a zero duration reads as zero hours');
assert.equal(lateDurationH(5), '5h', 'sub-day lateness reads in hours');
assert.equal(lateDurationH(24), '1d', 'a full day reads in days');
assert.equal(lateDurationH(52), '2d 4h', 'multi-day lateness keeps the remainder hours');
assert.equal(lateCharge(dueTrip, lateRates, at('2026-10-28T10:45:00')).charge, 0, 'grace keeps a short overrun free');
assert.equal(lateCharge(dueTrip, lateRates, at('2026-10-28T11:45:00')).charge, 500, 'one started hour bills the hourly rate');
assert.equal(lateCharge(dueTrip, lateRates, at('2026-10-29T09:00:00')).charge, 11000, 'a part-day bills hourly under the daily cap');
assert.equal(lateCharge(dueTrip, lateRates, at('2026-10-29T11:00:00')).charge, 12000, 'a full 24-hour block bills the daily rate');
assert.equal(lateCharge(dueTrip, lateRates, at('2026-10-29T11:30:00')).charge, 12500, 'started hours past a full day stay hourly');
assert.equal(
  lateCharge(dueTrip, { lateFeePerHour: 20000, lateFeePerDay: 12000, graceMinutes: 0 }, at('2026-10-28T10:30:00')).charge,
  12000,
  'a part-day charge never exceeds the daily cap',
);
assert.equal(
  lateCharge(dueTrip, { lateFeePerHour: 0, lateFeePerDay: 2400, graceMinutes: 0 }, at('2026-10-28T12:00:00')).charge,
  200,
  'a daily-only policy still prorates the hourly rate',
);
assert.equal(lateCharge(dueTrip, { lateFeePerHour: 0, lateFeePerDay: 0, graceMinutes: 0 }, at('2026-10-28T12:00:00')).charge, 0, 'no configured rate means no fee');
assert.equal(lateCharge(dueTrip, lateRates, at('2026-10-28T09:00:00')).charge, 0, 'an early return is never charged');

const hourlySettlement = settleMath({ holdAmount: 10000, lateDays: 0, lateFee: 7500, damageFee: 500 });
assert.equal(hourlySettlement.lateFee, 7500, 'the computed hourly total overrides day-block maths');
assert.equal(hourlySettlement.charges, 8000, 'hourly late fees join the other charges');
assert.equal(hourlySettlement.lateHours, 0, 'the settlement stays safe when hours are not provided');

const latePayload = inspectionPayload({ lateFee: 7500 });
assert.equal(latePayload.lateFee, 7500, 'the inspection keeps the hourly total');
assert.equal(inspectionPayload({}).lateFee, null, 'a legacy inspection has no hourly total');
let lateNegative = false;
try { inspectionPayload({ lateFee: -1 }); } catch (error) { lateNegative = /late fee cannot be negative/i.test(error.message); }
assert.equal(lateNegative, true, 'a negative late total is rejected');
let lateFractional = false;
try { inspectionPayload({ lateFee: 12.5 }); } catch (error) { lateFractional = /whole-rupee/i.test(error.message); }
assert.equal(lateFractional, true, 'a fractional late total is rejected');
let lateOversized = false;
try { inspectionPayload({ lateFee: 1000001 }); } catch (error) { lateOversized = /under ₹10,00,000/i.test(error.message); }
assert.equal(lateOversized, true, 'an absurd late total is rejected instead of silently clamped');

// One admin policy, one sentence on every customer surface.
const termsPolicy = sitePolicy({ late_fee_per_hour: '500', late_grace_minutes: '60' });
assert.equal(termsPolicy.lateGraceMinutes, 60, 'the grace window is read from the admin policy');
assert.equal(
  lateFeeTermsText('Late: {hourly}/h, {grace}, cap {daily}/day.', termsPolicy),
  'Late: ₹500/h, after a 60-minute grace, cap ₹12,000/day.',
  'late-return terms use the policy numbers and the editable template',
);
assert.equal(lateFeeTermsText('x {grace}', { lateFee: 0, lateFeePerDay: 0, lateGraceMinutes: 0 }), 'No late fee applies to this booking.', 'a zero fee is stated plainly');
assert.equal(sitePolicy({ late_grace_minutes: '99999' }).lateGraceMinutes, 1440, 'the grace window is clamped to a day');

// The customer's live meter and the desk share one policy mapping.
const livePolicy = sitePolicy({ late_fee_per_hour: '500', late_grace_minutes: '60' });
const liveMeter = lateChargeFor(dueTrip, livePolicy, at('2026-10-29T09:00:00'));
assert.equal(liveMeter.hours, 22, 'the meter applies the admin grace window');
assert.equal(liveMeter.charge, 11000, 'the meter bills the same amount the desk will settle');
assert.equal(lateChargeFor(dueTrip, livePolicy, at('2026-10-28T10:30:00')).hours, 0, 'an on-time customer sees no meter');
assert.equal(
  lateChargeFor(dueTrip, sitePolicy({ late_fee_per_hour: '0', late_grace_minutes: '0' }), at('2026-10-28T12:00:00')).charge,
  0,
  'a zero-fee policy never invents a late charge',
);

// The per-charge ceiling (₹1,00,000) must not clamp the security deposit itself;
// admins can configure deposits up to ₹10,00,000.
const largeDeposit = settleMath({ holdAmount: 200000, damageFee: 5000 });
assert.equal(largeDeposit.deposit, 200000, 'a large security deposit is not clamped to the charge ceiling');
assert.equal(largeDeposit.refundDue, 195000, 'the full deposit is refunded after deductions');

// Kilometre allowances ------------------------------------------------------
assert.equal(kmAllowance({ kmCap: 300, days: 3 }), 900, 'the allowance is the daily cap times the priced days');
assert.equal(kmAllowance({ kmCap: 300, startDate: '2026-03-01', endDate: '2026-03-04' }), 900, 'the allowance falls back to the date range');
assert.equal(kmAllowance({ kmCap: 0, days: 3 }), null, 'zero included km means unlimited');
assert.equal(excessKm({ driven: 1050, kmCap: 300, kmExtraRate: 12, days: 3 }).fee, 1800, 'excess distance is billed at the per-km rate');
assert.equal(excessKm({ driven: 900, kmCap: 300, kmExtraRate: 12, days: 3 }).fee, 0, 'a trip within the allowance is free');
assert.equal(excessKm({ driven: 1050, kmCap: 300, kmExtraRate: 12, days: 3, waived: true }).fee, 0, 'a waived fee is never charged');
assert.equal(excessKm({ driven: null, kmCap: 300, kmExtraRate: 12, days: 3 }).fee, 0, 'an unknown odometer never invents a fee');
assert.equal(excessKm({ driven: 900, kmCap: 0, kmExtraRate: 12, days: 3 }).limited, false, 'a rate without an allowance is inert');
assert.equal(kmDisclosure({ kmCap: 300, kmExtraRate: 12 }).label, '300 km/day included · ₹12/extra km', 'the customer sees the allowance and rate');
assert.equal(kmDisclosure({}).label, 'Unlimited kilometres', 'an uncapped vehicle stays unlimited');
assert.ok(kmVehicleProblems({ kmCap: 300, kmExtraRate: 0 }).kmExtraRate, 'a cap without a rate is rejected');
assert.ok(kmVehicleProblems({ kmCap: 0, kmExtraRate: 12 }).kmCap, 'a rate without a cap is rejected');
assert.deepEqual(kmVehicleProblems({ kmCap: 300, kmExtraRate: 12 }), {}, 'valid km terms pass');

const kmReturn = settlementRecord({
  booking: {
    holdAmount: 5000, status: 'active', startDate: '2026-03-01', endDate: '2026-03-04',
    pickupOdometer: 10000, kmCap: 300, kmExtraRate: 12,
  },
  inspection: { fuel: 'Full', odometer: 10950, damageFee: 0, cleaningFee: 0, lateFeePerDay: 0, severity: 'none' },
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
});
assert.equal(kmReturn.settlement.excessKm, 50, 'the settlement records the excess distance');
assert.equal(kmReturn.settlement.excessKmFee, 600, 'the settlement adds the excess-km fee to the charges');
assert.equal(kmReturn.settlement.charges, 600, 'excess km counts in the total charges');
assert.equal(kmReturn.settlement.refundDue, 4400, 'the rest of the deposit is refunded');
const kmWaived = settlementRecord({
  booking: {
    holdAmount: 5000, status: 'active', startDate: '2026-03-01', endDate: '2026-03-04',
    pickupOdometer: 10000, kmCap: 300, kmExtraRate: 12,
  },
  inspection: { fuel: 'Full', odometer: 10950, damageFee: 0, cleaningFee: 0, lateFeePerDay: 0, severity: 'none' },
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
  waiveKm: true,
});
assert.equal(kmWaived.settlement.excessKmFee, 0, 'a waived fee is not charged');
assert.equal(kmWaived.settlement.kmWaived, true, 'the waiver is recorded for the audit trail');
const withRefundRoute = settlementRecord({
  booking: { holdAmount: 5000, status: 'active', startDate: '2026-03-01', endDate: '2026-03-04', pickupOdometer: 10000, kmCap: 300, kmExtraRate: 12 },
  inspection: { fuel: 'Full', odometer: 10950, damageFee: 0, cleaningFee: 0, lateFeePerDay: 0, severity: 'none' },
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
  refundMethod: 'upi',
});
assert.equal(withRefundRoute.settlement.refundMethod, 'upi', 'a refund on release records its method');
const noRouteNoRefund = settlementRecord({
  booking: { holdAmount: 1000, status: 'active', startDate: '2026-03-01', endDate: '2026-03-04', pickupOdometer: 10000 },
  inspection: { fuel: 'Full', odometer: 10000, damageFee: 8000, cleaningFee: 0, lateFeePerDay: 0, severity: 'moderate', damageNote: 'Bumper cracked' },
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
  refundMethod: 'cash',
});
assert.equal(noRouteNoRefund.settlement.refundMethod, undefined, 'a fully-deducted settlement records no refund route');
const frozen = settlementRecord({
  booking: { holdAmount: 5000, status: 'active', startDate: '2026-03-01', endDate: '2026-03-04', pickupOdometer: 10000, kmCap: 300, kmExtraRate: 12 },
  inspection: { fuel: 'Full', odometer: 10950, damageFee: 0, cleaningFee: 0, lateFeePerDay: 0, severity: 'none' },
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
  refundMethod: 'not-a-method',
});
assert.equal(frozen.settlement.refundMethod, undefined, 'an unknown refund method is never invented');
const kmRollup = kmSummary([
  { status: 'completed', startDate: '2026-03-01', endDate: '2026-03-04', pickupOdometer: 10000, returnOdometer: 10950, kmCap: 300, kmExtraRate: 12, depositSettlement: { excessKmFee: 600 }, vehicle: { id: 'v1', name: 'Test car' } },
  { status: 'confirmed', pickupOdometer: 100, returnOdometer: 900 },
]);
assert.equal(kmRollup.trips, 1, 'only completed trips with both readings are measured');
assert.equal(kmRollup.driven, 950, 'driven distance rolls up');
assert.equal(kmRollup.excess, 50, 'excess distance rolls up');
assert.equal(kmRollup.excessKmFees, 600, 'billed excess-km fees roll up');
assert.equal(kmRollup.byVehicle[0].label, 'Test car', 'distance is grouped by vehicle');

let badFuel = false;
try { inspectionPayload({ fuel: 'Half-ish' }); } catch (error) { badFuel = /fuel/i.test(error.message); }
assert.equal(badFuel, true, 'invalid fuel levels are rejected');
let damageNote = false;
try { inspectionPayload({ damageFee: 1200, damageNote: '' }); } catch (error) { damageNote = /short note/i.test(error.message); }
assert.equal(damageNote, true, 'damage charges require a note');
let fractional = false;
try { inspectionPayload({ damageFee: 12.5 }); } catch (error) { fractional = /whole-rupee/i.test(error.message); }
assert.equal(fractional, true, 'fractional rupee amounts are rejected');
let negativeFee = false;
try { inspectionPayload({ damageFee: -500 }); } catch (error) { negativeFee = /negative/i.test(error.message); }
assert.equal(negativeFee, true, 'negative charges are rejected instead of silently clamped');
let oversizedFee = false;
try { inspectionPayload({ damageFee: 100001 }); } catch (error) { oversizedFee = /under/i.test(error.message); }
assert.equal(oversizedFee, true, 'charges above the cap are rejected instead of silently clamped');

const demoReturn = settlementRecord({
  booking: { holdAmount: 5000, endDate: isoOffset(-1), status: 'active', code: 'RV-TEST' },
  inspection: { fuel: '3/4', damageFee: 2000, damageNote: 'Scuffed alloy', cleaningFee: 500, lateFeePerDay: 1000, severity: 'minor' },
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
});
assert.equal(demoReturn.settlement.charges, 3500, 'late, damage and cleaning charges settle together');
assert.equal(demoReturn.settlement.refundDue, 1500, 'settlement refunds the balance');
assert.equal(demoReturn.inspection.damageFee, 2000, 'inspection keeps the damage amount');
assert.deepEqual(Object.values(checkPayload(['keys', 'fuel'])).filter(Boolean).length, 2, 'check payload round-trips');
const nestedReturn = settlementRecord({
  booking: { holdAmount: 0, endDate: isoOffset(-1), status: 'active', vehicle: { id: 'veh-1' } },
  inspection: { fuel: 'Full', damageFee: 0, cleaningFee: 0, lateFeePerDay: 0, severity: 'none' },
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
});
assert.equal(nestedReturn.vehicles, 'veh-1', 'the settlement keeps the vehicle id from a nested serializer shape');

const fuelReturn = settlementRecord({
  booking: { holdAmount: 8000, endDate: isoOffset(-1), status: 'active', code: 'RV-FUEL' },
  inspection: { fuel: '1/4', fuelFee: 1200, damageFee: 0, cleaningFee: 0, lateFeePerDay: 0, severity: 'none' },
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
});
assert.equal(fuelReturn.settlement.fuelFee, 1200, 'refuelling is its own deposit charge line');
assert.equal(fuelReturn.settlement.charges, 1200, 'the refuelling charge settles on its own');
assert.equal(fuelReturn.settlement.refundDue, 6800, 'refuelling reduces the refund the customer receives');
assert.equal(fuelReturn.inspection.fuelFee, 1200, 'the inspection record keeps the refuelling fee');
const fuelBad = settleMath({ holdAmount: 5000, damageFee: 0, cleaningFee: 0, fuelFee: 600 });
assert.equal(fuelBad.charges, 600, 'settlement maths includes a refuelling charge');
let fuelNegative = false;
try { inspectionPayload({ fuel: '3/4', fuelFee: -100 }); } catch (error) { fuelNegative = /refuelling/i.test(error.message); }
assert.equal(fuelNegative, true, 'negative refuelling fees are rejected');

// Recorded deposit collection at pick-up (desk) -----------------------------
// The desk did not just tick a box here: the amount, method, reference, who and
// when are stored so finance can trace the float, and only once per booking.
await demoApi.signIn('admin@rove.rent', 'admin123');
const collectRows = await demoApi.adminBookings();
const collectible = collectRows.find((booking) => (
  booking.status === 'confirmed' && Number(booking.holdAmount || 0) > 0 && !booking.depositCollected
));
assert.ok(collectible, 'a confirmed booking with a deposit is available for the collect flow');
const collectedRec = await demoApi.adminCollectDeposit({
  bookingId: collectible.id,
  amount: Number(collectible.holdAmount),
  method: 'upi',
  reference: 'UPI TXN 7f2c1',
});
assert.equal(collectedRec.depositCollected.amount, Number(collectible.holdAmount), 'the recorded amount matches the deposit due');
assert.equal(collectedRec.depositCollected.method, 'upi', 'the collection records the method');
assert.equal(collectedRec.depositCollected.reference, 'UPI TXN 7f2c1', 'the collection keeps the reference');
assert.equal(collectedRec.depositCollected.byName, 'Avery Ross', 'the collection records which staff member took it');
assert.ok(collectedRec.depositCollected.at, 'the collection is timestamped');
const collectedRow = (await demoApi.adminBookings()).find((booking) => booking.id === collectible.id);
assert.equal(collectedRow.depositCollected?.method, 'upi', 'the desk shape carries the collection record');
let collectTwice = false;
try { await demoApi.adminCollectDeposit({ bookingId: collectible.id, amount: 100, method: 'cash' }); } catch (error) { collectTwice = /already been collected/i.test(error.message); }
assert.equal(collectTwice, true, 'a deposit is collected exactly once');
const overRow = collectRows.find((booking) => (
  booking.status === 'confirmed' && Number(booking.holdAmount || 0) > 0 && !booking.depositCollected && booking.id !== collectible.id
));
if (overRow) {
  let collectOver = false;
  try { await demoApi.adminCollectDeposit({ bookingId: overRow.id, amount: 99999999, method: 'cash' }); } catch (error) { collectOver = /exceed/i.test(error.message); }
  assert.equal(collectOver, true, 'collection cannot exceed the deposit due');
  let collectBad = false;
  try { await demoApi.adminCollectDeposit({ bookingId: overRow.id, amount: -5, method: 'cash' }); } catch (error) { collectBad = /valid deposit amount/i.test(error.message); }
  assert.equal(collectBad, true, 'a nonsense amount is rejected');
}
const noDueRow = collectRows.find((booking) => booking.status === 'confirmed' && !Number(booking.holdAmount));
if (noDueRow) {
  let collectNoDue = false;
  try { await demoApi.adminCollectDeposit({ bookingId: noDueRow.id, amount: 500, method: 'cash' }); } catch (error) { collectNoDue = /no security deposit/i.test(error.message); }
  assert.equal(collectNoDue, true, 'a booking with no deposit due cannot record a phantom collection');
}

await demoApi.signIn('admin@rove.rent', 'admin123');
const allBookings = await demoApi.adminBookings();
const candidate = allBookings.find((booking) => booking.status === 'confirmed');
assert.ok(candidate, 'a confirmed booking exists for the returns flow');
// The desk persists the checklist before the status flip, so the handover
// record survives the trip starting.
await demoApi.adminSaveDeskChecks({ bookingId: candidate.id, checked: ['licence', 'age', 'payment', 'deposit'] });

let startBlocked = false;
try {
  await demoApi.adminStartTrip({ bookingId: candidate.id, inspection: { odometer: '', fuel: 'Full', cleanliness: 'clean' } });
} catch (error) { startBlocked = /odometer/i.test(error.message); }
assert.equal(startBlocked, true, 'handing over without an odometer is rejected');

const started = await demoApi.adminStartTrip({
  bookingId: candidate.id,
  inspection: { odometer: 41250, fuel: 'Full', cleanliness: 'clean', damage: ['front', 'wheels'], note: 'Kerb scuff on the front left alloy' },
});
assert.equal(started.status, 'active', 'a valid hand-over starts the trip');
assert.deepEqual(activeChecks(started.deskChecks), ['licence', 'age', 'payment', 'deposit'], 'the saved handover checklist survives the trip starting');
assert.equal(started.pickupInspection.odometer, 41250, 'the pick-up odometer is stored on the booking');
assert.deepEqual(started.pickupInspection.damage, ['front', 'wheels'], 'damage areas are stored in a stable order');
assert.equal(started.pickupOdometer, 41250, 'the flat pick-up odometer mirrors the report');
assert.equal(started.pickupInspection.recordedBy, 'usr-admin', 'the report records who handed the car over');
const voucherKm = await demoApi.getBooking(started.code);
assert.equal(voucherKm.kmCap, started.kmCap, 'the customer voucher carries the booked kilometre allowance');
assert.equal(voucherKm.vehicle.kmCap, started.kmCap, 'the voucher vehicle mirrors the allowance');
assert.equal(voucherKm.kmExtraRate, started.kmExtraRate, 'the customer voucher carries the booked extra-km rate');
assert.equal(
  kmDisclosure(voucherKm).limited,
  Number(started.kmCap) > 0 && Number(started.kmExtraRate) > 0,
  'the voucher disclosure agrees with the booking terms',
);
const fleetAfterStart = await demoApi.adminVehicles();
assert.equal(fleetAfterStart.find((vehicle) => vehicle.id === candidate.vehicleId)?.status, 'rented', 'starting a trip marks the car on rent');

// ---------------------------------------------------------------------------
// Trip extension: staff extends the active trip on the customer's behalf
// ---------------------------------------------------------------------------
const logBeforeExtension = (await demoApi.adminNotificationLog(200)).length;
const depositBeforeExtension = Number(started.depositDue) || 0;
const extendedEnd = addDaysISO(started.endDate, 1);
const extended = await demoApi.extendTrip({
  bookingId: started.id,
  endDate: extendedEnd,
  dropoffTime: started.dropoffTime || '10:00',
});
assert.equal(extended.endDate, extendedEnd, 'an extension moves the return date later');
assert.equal(extended.days, Number(started.days) + 1, 'an extension adds the rental day to the count');
assert.ok(Number(extended.total) > Number(started.total), 'an extension prices the extra day into the total');
assert.equal(Number(extended.depositDue), depositBeforeExtension, 'an extension never inflates the deposit already collected at pick-up');
assert.equal(
  extended.tripChanges.filter((entry) => entry.type === 'extension').length,
  (started.tripChanges ?? []).filter((entry) => entry.type === 'extension').length + 1,
  'an extension appends a trip-change log entry',
);
assert.equal(extended.status, 'active', 'an extension keeps the trip active');
assert.ok(
  (await demoApi.adminNotificationLog(200)).length >= logBeforeExtension + 1,
  'an extension queues the customer email',
);
let unchangedRejected = false;
try {
  await demoApi.extendTrip({ bookingId: started.id, endDate: extendedEnd, dropoffTime: started.dropoffTime || '10:00' });
} catch (error) { unchangedRejected = /later than the current drop-off/i.test(error.message); }
assert.equal(unchangedRejected, true, 'an extension back to the same return is rejected');
let pastSlotRejected = false;
try {
  await demoApi.extendTrip({ bookingId: started.id, endDate: '2000-01-01', dropoffTime: '10:00' });
} catch (error) { pastSlotRejected = /later than the current drop-off|already passed/i.test(error.message); }
assert.equal(pastSlotRejected, true, 'an extension into the past is rejected');

// Staff date edits join the same trip-activity trail as extensions.
const activeNow = (await demoApi.adminBookings()).find((row) => row.id === started.id);
const staffMoved = await demoApi.adminUpdateBooking({
  bookingId: started.id,
  startDate: activeNow.startDate,
  endDate: addDaysISO(activeNow.endDate, 1),
});
const staffEntry = staffMoved.tripChanges.at(-1);
assert.equal(staffEntry.type, 'change', 'a staff date edit enters the trip-activity trail');
assert.ok(Number(staffEntry.delta) > 0, 'a staff date edit records its price delta');
assert.equal(staffMoved.tripChanges.filter((entry) => entry.type === 'extension').length, 1, 'earlier extensions stay in the history');
const trailBeforeNoop = staffMoved.tripChanges.length;
await demoApi.adminUpdateBooking({ bookingId: started.id, startDate: staffMoved.startDate, endDate: staffMoved.endDate });
const afterNoop = (await demoApi.adminBookings()).find((row) => row.id === started.id);
assert.equal(afterNoop.tripChanges.length, trailBeforeNoop, 're-saving identical dates does not pollute the trail');

// Return-due reminders: the guard path (the full once-per-day flow is
// integration-tested against Postgres in validate-sql.sh).
let notOverdueRejected = false;
try {
  await demoApi.sendReturnReminder({ bookingId: started.id });
} catch (error) { notOverdueRejected = /not overdue yet/i.test(error.message); }
assert.equal(notOverdueRejected, true, 'reminding a trip that is not overdue yet is rejected');
log('trip extension: staff extends an active return end-to-end');

// Pick-up reminders: the guard paths (the full once-per-day flow is
// integration-tested against Postgres in validate-sql.sh).
let pickupActiveRejected = false;
try {
  await demoApi.sendPickupReminder({ bookingId: started.id });
} catch (error) { pickupActiveRejected = /confirmed pick-up/i.test(error.message); }
assert.equal(pickupActiveRejected, true, 'an active trip cannot be nudged as a pick-up');
let pickupCancelledRejected = false;
try {
  const cancelledRow = (await demoApi.adminBookings()).find((row) => row.code === guestCancelBooking.code);
  await demoApi.sendPickupReminder({ bookingId: cancelledRow.id });
} catch (error) { pickupCancelledRejected = /confirmed pick-up/i.test(error.message); }
assert.equal(pickupCancelledRejected, true, 'a cancelled booking cannot be nudged as a pick-up');
const liveRows = await demoApi.adminBookings();
const farBooking = liveRows.find((row) => (
  row.status === 'confirmed' && row.startDate && row.startDate > addDaysISO(todayISO(), 2)
));
if (farBooking) {
  let pickupWindowRejected = false;
  try {
    await demoApi.sendPickupReminder({ bookingId: farBooking.id });
  } catch (error) { pickupWindowRejected = /today or tomorrow/i.test(error.message); }
  assert.equal(pickupWindowRejected, true, 'only pick-ups today or tomorrow can be reminded');
}
// The desk eligibility rule is shared and pure.
assert.equal(pickupReminderEligible({ status: 'confirmed', startDate: '2026-11-01' }, '2026-11-01'), true, 'a pick-up today is remindable');
assert.equal(pickupReminderEligible({ status: 'confirmed', startDate: '2026-11-02' }, '2026-11-01'), true, 'a pick-up tomorrow is remindable');
assert.equal(pickupReminderEligible({ status: 'confirmed', startDate: '2026-11-03' }, '2026-11-01'), false, 'a pick-up later this week is outside the window');
assert.equal(pickupReminderEligible({ status: 'pending', startDate: '2026-11-01' }, '2026-11-01'), false, 'an unapproved booking is never nudged');
assert.equal(pickupReminderEligible({}), false, 'a missing booking is never remindable');

// The master switch (Admin → Settings) stops all reminders, fail-closed.
await demoApi.adminSaveSettings({ ...settings, operational_reminders: 'false' });
let pickupMuted = false;
try {
  await demoApi.sendPickupReminder({ bookingId: started.id });
} catch (error) { pickupMuted = /reminders are switched off/i.test(error.message); }
assert.equal(pickupMuted, true, 'the master switch blocks pick-up reminders inside the adapter');
let returnMuted = false;
try {
  await demoApi.sendReturnReminder({ bookingId: started.id });
} catch (error) { returnMuted = /reminders are switched off/i.test(error.message); }
assert.equal(returnMuted, true, '... and return reminders too');
await demoApi.adminSaveSettings({ ...settings, operational_reminders: 'true' });

const openReturns = await demoApi.adminReturnBookings();
assert.equal(openReturns.some((booking) => booking.id === candidate.id), true, 'active trips appear on the returns desk');

const savedChecks = await demoApi.adminSaveReturnChecks({ bookingId: candidate.id, checked: ['keys', 'fuel'] });
assert.equal(savedChecks.returnChecks.keys, true, 'return checklist state persists');
let settleIncomplete = false;
try { await demoApi.adminSettleReturn({ bookingId: candidate.id, checked: ['keys'] }); } catch (error) { settleIncomplete = /complete the return checklist/i.test(error.message); }
assert.equal(settleIncomplete, true, 'settlement requires the full checklist');

let belowPickup = false;
try {
  await demoApi.adminSettleReturn({
    bookingId: candidate.id,
    checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
    fuel: '1/2',
    odometer: 41000,
    cleanliness: 'average',
  });
} catch (error) { belowPickup = /lower than the pick-up reading/i.test(error.message); }
assert.equal(belowPickup, true, 'a drop-off reading below the pick-up is rejected before any money moves');

const logBeforeReturn = (await demoApi.adminNotificationLog(200)).length;
const settled = await demoApi.adminSettleReturn({
  bookingId: candidate.id,
  checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'],
  fuel: '1/2',
  odometer: 41980,
  cleanliness: 'average',
  damageFee: 1500,
  damageNote: 'Wheel kerb scuff',
  cleaningFee: 300,
  lateFeePerDay: 500,
  severity: 'minor',
  // How the released remainder travels back — recorded alongside the charges so
  // finance can show the same money leaving through a visible route.
  refundMethod: 'bank',
  // The seeded bikes carry a daily allowance; waive it so this fixture asserts
  // the same deposit maths regardless of which vehicle the demo picks.
  waiveKm: true,
});
assert.equal(settled.ok, true, 'a return settles');
assert.equal(settled.booking.status, 'completed', 'settling a return completes the trip');
assert.ok(settled.settlement.charges >= 1800, 'the settlement records the deductions');
assert.equal(settled.settlement.excessKmFee, 0, 'the waived excess-km fee is not charged on the live settlement');
assert.equal(settled.settlement.refundMethod, 'bank', 'the settlement records how the refund was sent');
assert.equal(settled.booking.depositSettlement.status, settled.settlement.status, 'the settlement is stored on the booking');
assert.equal(settled.booking.inspection.odometer, 41980, 'the return inspection keeps the odometer');
assert.equal(settled.booking.inspection.cleanliness, 'average', 'the return inspection keeps cleanliness');
assert.equal(settled.booking.returnOdometer, 41980, 'the flat return odometer mirrors the inspection');
assert.equal(kmDriven(settled.booking.pickupInspection, settled.booking.inspection), 730, 'km driven ties the two reports together');
assert.equal(settled.booking.pickupInspection.damage[0], 'front', 'the pick-up damage survives the settlement');
const fleetAfterReturn = await demoApi.adminVehicles();
assert.equal(fleetAfterReturn.find((vehicle) => vehicle.id === candidate.vehicleId)?.status, 'available', 'settling a return frees the car again');
let settledTwice = false;
try { await demoApi.adminSettleReturn({ bookingId: candidate.id, checked: ['keys', 'fuel', 'condition', 'cleaning', 'deposit'] }); } catch (error) { settledTwice = /already been settled/i.test(error.message); }
assert.equal(settledTwice, true, 'a settled return cannot be settled twice');
assert.equal((await demoApi.adminNotificationLog(200)).length, logBeforeReturn + 1, 'settlement queues a customer email');
assert.equal((await demoApi.adminReturnBookings()).some((booking) => booking.id === candidate.id), false, 'settled returns leave the open list');

const depositSummary = summariseDeposits([
  { status: 'active', holdAmount: 5000 },
  { status: 'completed', holdAmount: 2000 },
  { status: 'active', holdAmount: 2000, depositSettlement: { deposit: 2000, refundDue: 500, charges: 1500, damageFee: 1000, lateFee: 500, cleaningFee: 0, extraDue: 0 } },
  { status: 'completed', holdAmount: 1000, depositSettlement: { deposit: 1000, refundDue: 0, charges: 4000, damageFee: 4000, lateFee: 0, cleaningFee: 0, extraDue: 3000 } },
]);
assert.equal(depositSummary.depositsHeld, 7000, 'the deposit book counts active and completed-unsettled deposits still held');
assert.equal(depositSummary.damageRecovered, 5000, 'the deposit book tracks damage recovered');
assert.equal(depositSummary.settled, 2, 'the deposit book counts settled returns');
assert.equal(depositSummary.depositsReleased, 500, 'released sums only money returned to customers');
assert.equal(depositSummary.depositsDeducted, 2500, 'deducted counts only money taken out of the deposit, not extraDue');
assert.equal(depositSummary.extraDue, 3000, 'charges beyond the deposit stay in the extra-due bucket');
assert.equal(depositSummary.awaiting, 1, 'the deposit book counts completed trips awaiting settlement');
assert.equal(depositSummary.awaitingAmount, 2000, '... and the deposit money still on the books for them');

// Settlement-backlog age: how long each completed deposit has been waiting ----
assert.equal(settlementWaitDays({ status: 'completed', completedAt: '2026-10-20T12:00:00.000Z' }, '2026-10-29'), 9, 'the wait is measured from the completion stamp');
assert.equal(settlementWaitDays({ status: 'completed', endDate: '2026-10-21' }, '2026-10-29'), 8, 'a missing completion stamp falls back to the booked end date');
assert.equal(settlementWaitDays({ status: 'completed', completedAt: '2026-10-29T08:00:00.000Z' }, '2026-10-29'), 0, 'a trip completed today has no backlog age yet');
assert.equal(settlementWaitDays({ status: 'completed', depositSettlement: {} }, '2026-10-29'), 0, 'a settled return never reads as waiting');
assert.equal(settlementWaitDays({ status: 'active', endDate: '2026-10-01' }, '2026-10-29'), 0, 'an active trip is not a settlement backlog');
assert.equal(settlementWaitDays({ status: 'completed', completedAt: 'not-a-date' }, '2026-10-29'), 0, 'malformed dates never invent a wait');
const agedDepositBook = summariseDeposits([
  { status: 'completed', holdAmount: 1000, completedAt: '2026-10-20T10:00:00.000Z' },
  { status: 'completed', holdAmount: 3000, completedAt: '2026-10-26T10:00:00.000Z' },
  { status: 'completed', holdAmount: 5000, depositSettlement: {} },
  { status: 'active', holdAmount: 9000 },
], '2026-10-29');
assert.equal(agedDepositBook.awaitingAvgDays, 6, 'the backlog reports its average wait (9d and 3d)');
assert.equal(agedDepositBook.awaitingMaxDays, 9, '... and the oldest single wait');
assert.equal(maxAwaitingDays([
  { status: 'completed', completedAt: '2026-10-20T10:00:00.000Z', depositSettlement: null },
  { status: 'completed', completedAt: '2026-10-26T10:00:00.000Z' },
  { status: 'active' },
], '2026-10-29'), 9, 'the shared oldest-wait helper matches the summary');
assert.equal(maxAwaitingDays([], '2026-10-29'), 0, 'an empty backlog has no oldest wait');
const depositRefundLedgerRows = depositRefundRows([
  { id: 'b1', code: 'RV-REF1', depositSettlement: { refundDue: 3500, chargedAt: '2026-11-02T10:00:00.000Z' }, vehicle: { name: 'Civic' } },
  { id: 'b2', code: 'RV-REF2', depositSettlement: { refundDue: 0, charges: 5000 }, completedAt: '2026-11-03T09:00:00.000Z', vehicle: { name: 'Swift' } },
  { id: 'b3', code: 'RV-REF3', depositSettlement: { refundDue: 2000 }, endDate: '2026-10-30', vehicle: { name: 'Bike' } },
]);
assert.equal(depositRefundLedgerRows.length, 2, 'only genuine deposit refunds become ledger rows');
assert.equal(depositRefundLedgerRows[0].amount, 3500, 'the row carries the refund amount');
assert.equal(depositRefundLedgerRows[0].depositRefund, true, '... and is tagged as a deposit refund');
assert.equal(depositRefundLedgerRows[1].createdAt, '2026-10-30', 'a missing stamp falls back to the booked end date');
assert.equal(depositRefundRows([]).length, 0, 'no bookings, no ledger rows');

// Refund routes: the released part of the deposit travels back visibly ---------
const routeBook = summariseDeposits([
  { status: 'completed', holdAmount: 5000, depositSettlement: { refundDue: 3500, refundMethod: 'bank' } },
  { status: 'completed', holdAmount: 5000, depositSettlement: { refundDue: 2000, refundMethod: 'upi' } },
  { status: 'completed', holdAmount: 5000, depositSettlement: { refundDue: 2500 } },
  { status: 'completed', holdAmount: 5000, depositSettlement: { refundDue: 0, charges: 5000 } },
]);
const routeCount = (method) => routeBook.refundsByMethod.find((row) => row.method === method)?.count ?? 0;
assert.equal(routeCount('bank'), 1, 'the refund book counts bank transfers');
assert.equal(routeCount('upi'), 1, '... and UPI refunds');
assert.equal(routeCount('original'), 1, '... defaulting an unrecorded refund to the original payment method');
assert.equal(routeBook.refundsByMethod.reduce((sum, row) => sum + row.count, 0), 3, '... and never counting a settlement with nothing to refund');
const kmDepositSummary = summariseDeposits([
  { status: 'completed', holdAmount: 5000, depositSettlement: { deposit: 5000, refundDue: 3200, charges: 1800, damageFee: 0, lateFee: 0, cleaningFee: 0, excessKmFee: 1800, excessKm: 150, extraDue: 0 } },
]);
assert.equal(kmDepositSummary.excessKmFees, 1800, 'the deposit book tracks excess-km fees');
assert.equal(kmDepositSummary.excessKm, 150, 'the deposit book tracks the excess distance behind those fees');
const timeliness = returnTimeliness([
  { depositSettlement: { lateDays: 0 } },
  { depositSettlement: { lateDays: 2 } },
  { depositSettlement: { lateDays: 1 } },
  { depositSettlement: { lateDays: 3 } },
  {},
]);
assert.equal(timeliness.settled, 4, 'punctuality counts only settled returns');
assert.equal(timeliness.onTime, 1, 'punctuality counts early/on-time returns');
assert.equal(timeliness.late, 3, 'punctuality counts late returns from their settled lateness');
assert.equal(timeliness.onTimeRate, 25, 'punctuality rate is exact');
assert.equal(timeliness.avgLateDays, 2, 'punctuality averages the late days');
assert.equal(returnTimeliness([]).onTimeRate, 0, 'punctuality is safe on an empty book');
assert.equal(returnTimeliness([{ depositSettlement: { lateDays: 0 } }]).avgLateDays, 0, 'punctuality has no average when nothing was late');
const hourlyPunctuality = returnTimeliness([
  { depositSettlement: { lateDays: 0, lateHours: 5 } },
  { depositSettlement: { lateDays: 0, lateHours: 0 } },
]);
assert.equal(hourlyPunctuality.late, 1, 'sub-day lateness counts as late now that it is billed');
assert.equal(hourlyPunctuality.avgLateDays, 0.2, 'punctuality keeps hour precision in the average');
assert.equal(hourlyPunctuality.onTimeRate, 50, 'sub-day punctuality is reflected in the on-time rate');
const lateByVehicle = lateReturnsByVehicle([
  { vehicle: { name: 'Duster' }, depositSettlement: { lateDays: 2, lateFee: 2400 } },
  { vehicle: { name: 'Duster' }, depositSettlement: { lateHours: 5, lateFee: 500 } },
  { vehicle: { name: 'Creta' }, depositSettlement: { lateHours: 0, lateFee: 0 } },
  { vehicle: { name: 'Creta' }, depositSettlement: { lateDays: 0, lateFee: 0 } },
  { depositSettlement: { lateDays: 1 } },
  {},
]);
assert.equal(lateByVehicle.length, 3, 'late returns roll up per vehicle, unknown vehicles grouped');
const duster = lateByVehicle.find((row) => row.vehicle === 'Duster');
assert.equal(duster.returns, 2, 'each settled return counted once');
assert.equal(duster.late, 2, 'both Duster returns were late');
assert.equal(duster.lateHours, 53, 'legacy days roll up to hours and add to billed hours');
assert.equal(duster.lateFees, 2900, 'late-fee revenue sums per vehicle');
assert.equal(lateByVehicle[0].vehicle, 'Duster', 'worst offender sorts first');
assert.equal(lateReturnsByVehicle([]).length, 0, 'late-return roll-up is safe on an empty book');
const repeatOffenders = lateRepeatOffenders([
  { vehicle: { name: 'Duster' }, endDate: '2026-09-01', depositSettlement: { lateDays: 1 } },
  { vehicle: { name: 'Duster' }, endDate: '2026-09-20', depositSettlement: { lateHours: 3 } },
  { vehicle: { name: 'Duster' }, endDate: '2026-10-05', depositSettlement: { lateDays: 0 } },
  { vehicle: { name: 'Creta' }, endDate: '2026-09-01', depositSettlement: { lateDays: 1 } },
  { vehicle: { name: 'Creta' }, endDate: '2026-09-10', depositSettlement: { lateDays: 0 } },
], { threshold: 2, today: '2026-10-28' });
assert.equal(repeatOffenders.length, 1, 'only vehicles past the threshold are flagged');
assert.equal(repeatOffenders[0].vehicle, 'Duster', 'repeat offenders sort by count first');
assert.equal(repeatOffenders[0].lateReturns, 2, 'only late settlements count toward the threshold');
assert.equal(lateRepeatOffenders([], { threshold: 2 }).length, 0, 'repeat-offender scan is safe on an empty book');
const agedOut = lateRepeatOffenders([
  { vehicle: { name: 'Duster' }, endDate: '2026-06-01', depositSettlement: { lateDays: 3 } },
], { threshold: 1, today: '2026-10-28' });
assert.equal(agedOut.length, 0, 'old returns age out of the 90-day window');
log('late returns roll up per vehicle (hours + fees, legacy days merged)');
const forecast = returnForecast([
  { status: 'active', endDate: '2026-10-28' },
  { status: 'active', endDate: '2026-10-30' },
  { status: 'completed', endDate: '2026-10-28' },
  { status: 'completed', endDate: '2026-10-31', depositSettlement: {} },
  { status: 'cancelled', endDate: '2026-11-02' },
], '2026-10-28');
assert.equal(forecast.days.length, 7, 'the return forecast covers a week');
assert.equal(forecast.dueToday, 2, 'the return forecast counts every open return ending today');
assert.equal(forecast.next7, 3, 'the seven-day forecast sums every open return in range');
assert.equal(forecast.days.filter((day) => day.value > 0).length, 2, 'the forecast buckets returns on their due dates');
assert.equal(returnForecast([]).dueToday, 0, 'the return forecast is safe on an empty book');
// The returns board search: one haystack for name, code, phone and plate.
const returnBoard = [
  { code: 'RV-R1', customer: { name: 'Maya Chen' }, driver: { phone: '+91 90000 11111' }, vehicle: { name: 'Camry', registrationNumber: 'KA05XY7788' } },
  { code: 'RV-R2', customer: { name: 'Arjun Rao' }, vehicle: { name: 'Duster', registrationNumber: 'MH12PQ3344' } },
];
assert.equal(filterReturnBookings(returnBoard, 'maya').length, 1, 'returns search matches the customer name');
assert.equal(filterReturnBookings(returnBoard, 'rv-r2')[0].code, 'RV-R2', 'returns search matches the code');
assert.equal(filterReturnBookings(returnBoard, '90000').length, 1, 'returns search matches the phone');
assert.equal(filterReturnBookings(returnBoard, 'ka05xy').length, 1, 'returns search matches the plate');
assert.equal(filterReturnBookings(returnBoard, 'nobody').length, 0, 'a miss returns an empty board');
assert.equal(filterReturnBookings(returnBoard, '   ').length, 2, 'a blank query keeps every return');
assert.equal(filterReturnBookings(null, 'x').length, 0, 'returns search is safe on a null book');
log('returns desk: checklist, inspection validation, settlement maths and demo flow');

// ---------------------------------------------------------------------------
// Availability watchlist: matching, release triggers and idempotent dispatch
// ---------------------------------------------------------------------------

const {
  windowsOverlap, vehicleFreeInWindow, availabilityBoard,
} = await import('../src/lib/availabilityAlerts.js');

assert.equal(windowsOverlap('2026-01-01', '2026-01-03', '2026-01-03', '2026-01-05'), false, 'touching windows do not overlap');
assert.equal(windowsOverlap('2026-01-01', '2026-01-05', '2026-01-03', '2026-01-04'), true, 'nested windows overlap');
assert.equal(windowsOverlap('bad', '2026-01-05', '2026-01-03', '2026-01-04'), false, 'invalid dates never overlap');
assert.equal(vehicleFreeInWindow({
  vehicle: { id: 'v1', status: 'maintenance' }, startDate: '2026-01-01', endDate: '2026-01-03',
}), false, 'maintenance vehicles are never free');
assert.equal(vehicleFreeInWindow({
  vehicle: { id: 'v1', status: 'available' }, startDate: '2026-01-01', endDate: '2026-01-03',
  bookings: [{ id: 'b1', vehicleId: 'v1', status: 'cancelled', startDate: '2026-01-01', endDate: '2026-01-03' }],
}), true, 'cancelled bookings release the window');
assert.equal(vehicleFreeInWindow({
  vehicle: { id: 'v1', status: 'available' }, startDate: '2026-01-01', endDate: '2026-01-03',
  bookings: [{ id: 'b1', vehicleId: 'v1', status: 'confirmed', startDate: '2026-01-02', endDate: '2026-01-04' }],
}), false, 'confirmed bookings block the window');
assert.equal(vehicleFreeInWindow({
  vehicle: { id: 'v1', status: 'available' }, startDate: '2026-01-01', endDate: '2026-01-03',
  bookings: [{ id: 'b1', vehicle: { id: 'v1' }, status: 'confirmed', startDate: '2026-01-02', endDate: '2026-01-04' }],
}), false, 'a serializer that nests the vehicle id still blocks the window');
assert.equal(vehicleFreeInWindow({
  vehicle: { id: 'v1', status: 'available' }, startDate: '2026-01-01', endDate: '2026-01-03',
  blocks: [{ vehicleId: 'v1', startDate: '2025-12-31', endDate: '2026-01-02' }],
}), false, 'availability blocks block the window');

const start = isoOffset(15);
const end = isoOffset(18);
const freeBoard = availabilityBoard({
  users: [{ id: 'u1', name: 'Ava', email: 'ava@example.com', alerts: [{ id: 'a1', vehicleId: 'v1', startDate: start, endDate: end }] }],
  vehicles: [{ id: 'v1', name: 'Test car', status: 'available' }],
  bookings: [],
  blocks: [],
  today: isoOffset(0),
});
assert.equal(freeBoard.ready, 1, 'a free window is ready to notify');
assert.equal(freeBoard.rows[0].customerName, 'Ava', 'the board carries customer details');
const blockedBoard = availabilityBoard({
  users: [{ id: 'u1', name: 'Ava', email: 'ava@example.com', alerts: [{ id: 'a1', vehicleId: 'v1', startDate: start, endDate: end }] }],
  vehicles: [{ id: 'v1', name: 'Test car', status: 'available' }],
  bookings: [{ id: 'b1', vehicleId: 'v1', status: 'pending', startDate: start, endDate: end }],
  blocks: [],
  today: isoOffset(0),
});
assert.equal(blockedBoard.waiting, 1, 'a live booking makes the alert wait');
assert.equal(blockedBoard.ready, 0, 'a waiting alert is not ready');

await demoApi.signIn('admin@rove.rent', 'admin123');
const fleet = await demoApi.adminVehicles();
const fleetBookings = await demoApi.adminBookings();
const fleetBlocks = await demoApi.adminVehicleBlocks();
const watchVehicle = fleet.find((vehicle) => vehicle.status !== 'maintenance');
assert.ok(watchVehicle, 'a bookable vehicle exists for the watchlist test');
let watchStart = '';
let watchEnd = '';
for (let offset = 15; offset <= 100; offset += 3) {
  const candidateStart = isoOffset(offset);
  const candidateEnd = isoOffset(offset + 3);
  const busy = fleetBookings.some((booking) => (
    booking.vehicleId === watchVehicle.id
    && ['pending', 'confirmed', 'active'].includes(booking.status)
    && windowsOverlap(candidateStart, candidateEnd, booking.startDate, booking.endDate)
  )) || fleetBlocks.some((block) => (
    block.vehicleId === watchVehicle.id
    && windowsOverlap(candidateStart, candidateEnd, block.startDate, block.endDate)
  ));
  if (!busy) { watchStart = candidateStart; watchEnd = candidateEnd; break; }
}
assert.ok(watchStart, 'a free window exists for the watchlist test');

await demoApi.signIn('demo@rove.rent', 'demo123');
const watchAlertCreated = await demoApi.createAvailabilityAlert({
  vehicleId: watchVehicle.id, startDate: watchStart, endDate: watchEnd,
});
const watchAlertId = watchAlertCreated.alert.id;
assert.equal((await demoApi.listAvailabilityAlerts()).some((alert) => alert.id === watchAlertId), true, 'customer watchlist returns the new alert');

await demoApi.signIn('admin@rove.rent', 'admin123');
const watchBlock = await demoApi.adminSaveVehicleBlock({
  vehicleId: watchVehicle.id,
  startDate: watchStart,
  endDate: watchEnd,
  kind: 'maintenance',
  reason: 'Watchlist contract test',
});
const waitingRows = await demoApi.adminAvailabilityAlerts();
const waitingAlert = waitingRows.rows.find((row) => row.alertId === watchAlertId);
assert.equal(waitingAlert?.free, false, 'a block keeps the watched window unavailable');
assert.equal(waitingAlert?.ready, false, 'blocked alerts are not dispatch candidates');
assert.equal((await demoApi.adminDispatchAvailabilityAlerts({ alertIds: [watchAlertId] })).dispatched, 0, 'blocked alerts are not notified');

const logBeforeWatch = (await demoApi.adminNotificationLog(300)).length;
await demoApi.adminDeleteVehicleBlock(watchBlock.id);
const matchedRows = await demoApi.adminAvailabilityAlerts();
const matchedAlert = matchedRows.rows.find((row) => row.alertId === watchAlertId);
assert.equal(matchedAlert?.notified, true, 'releasing a block auto-notifies the waiting customer');
assert.equal(matchedAlert?.ready, false, 'notified alerts leave the ready queue');
assert.match(matchedAlert?.matchReason ?? '', /block removed/i, 'the dispatch records why the window opened');
const watchLog = await demoApi.adminNotificationLog(300);
assert.ok(watchLog.length > logBeforeWatch, 'release queues a watchlist email');
assert.ok(watchLog.some((entry) => entry.kind === 'availability_alert' && entry.recipient === 'demo@rove.rent'), 'the watchlist email reaches the customer');
assert.equal((await demoApi.adminDispatchAvailabilityAlerts({ alertIds: [watchAlertId] })).dispatched, 0, 'dispatching is idempotent');

await demoApi.signIn('demo@rove.rent', 'demo123');
const refreshedAlert = (await demoApi.listAvailabilityAlerts()).find((alert) => alert.id === watchAlertId);
assert.equal(refreshedAlert?.notified, true, 'the customer sees the notification state');
assert.equal(refreshedAlert?.freeNow, true, 'the customer sees the window is free now');

// The primary industry case: a confirmed booking is cancelled and the vehicle
// it was holding frees up for a customer who is already watching that window.
const cancellable = fleetBookings.find((booking) => (
  booking.status === 'confirmed'
  && booking.startDate >= isoOffset(1)
  && fleet.find((vehicle) => vehicle.id === booking.vehicleId)?.status !== 'maintenance'
));
assert.ok(cancellable, 'a future confirmed booking exists for the cancellation trigger');
await demoApi.signIn('demo@rove.rent', 'demo123');
const cancelWatch = await demoApi.createAvailabilityAlert({
  vehicleId: cancellable.vehicleId,
  startDate: cancellable.startDate,
  endDate: cancellable.endDate,
});
await demoApi.signIn('admin@rove.rent', 'admin123');
await demoApi.adminUpdateBooking({ bookingId: cancellable.id, status: 'cancelled', reason: 'Watchlist cancellation test' });
const afterCancel = (await demoApi.adminAvailabilityAlerts()).rows.find((row) => row.alertId === cancelWatch.alert.id);
assert.equal(afterCancel?.notified, true, 'cancelling a booking auto-notifies the waiting customer');
assert.match(afterCancel?.matchReason ?? '', /cancelled/i, 'the dispatch records the cancellation trigger');
log('availability watchlist: matching, cancellation + block triggers, dispatch and customer state');

// ---------------------------------------------------------------------------
// Fleet maintenance
// ---------------------------------------------------------------------------
const maintenanceVehicles = await demoApi.adminVehicles();
const seededLogs = await demoApi.adminServiceLogs();
assert.ok(seededLogs.length > 0, 'demo fleet ships with workshop history');
assert.ok(seededLogs.every((log) => log.vehicle?.name), 'service logs include vehicle context');
const board = serviceBoard(maintenanceVehicles, { logs: seededLogs });
const boardStats = {
  overdue: board.filter((row) => row.band === 'overdue').length,
  due: board.filter((row) => row.band === 'due').length,
  tracked: board.filter((row) => row.tracked).length,
};
assert.ok(boardStats.overdue > 0, 'seeded fleet exposes an overdue service');
assert.ok(boardStats.due > 0, 'seeded fleet exposes a due-soon service');
assert.ok(boardStats.tracked >= maintenanceVehicles.length - 1, 'nearly every seeded vehicle has an odometer baseline');
assert.ok(board[0].progress >= board[board.length - 1].progress, 'service board is ranked by urgency');
assert.ok(board.some((row) => row.spend > 0 && row.visits > 0), 'the service board includes per-vehicle workshop spend');

// Overdue rows must say how far over they are: "0 km left" / "0 days" is not
// actionable once the interval has already been exceeded.
const overdueStatus = serviceStatus(
  {
    id: 'svc-overdue', odometer: 12000, lastServiceDate: '2026-01-01',
    lastServiceOdometer: 1000, serviceIntervalKm: 5000, serviceIntervalDays: 180,
  },
  { today: '2026-10-28' }
);
assert.equal(overdueStatus.band, 'overdue', 'the overdue band is computed from the larger wear');
assert.equal(overdueStatus.daysRemaining, -120, 'overdue days stay negative instead of clamping to zero');
assert.match(overdueStatus.reason, /overdue by 6,000 km and 120 days/i, 'the reason states both overages');
const dateOnlyOverdue = serviceStatus(
  { id: 'svc-date', odometer: 1500, lastServiceDate: '2026-01-01', lastServiceOdometer: 1000, serviceIntervalKm: 5000, serviceIntervalDays: 180 },
  { today: '2026-10-28' }
);
assert.match(dateOnlyOverdue.reason, /overdue by 120 days/i, 'a date-only overage reads naturally');
assert.equal(board.find((row) => row.band === 'overdue')?.reason.includes('overdue by'), true, 'seeded overdue rows explain the overage');

// Bike-aware defaults: the history drawer used to hardcode the car fallback,
// which made a bike's next service look months further away than it is.
assert.deepEqual(
  serviceIntervals({ kind: 'bike' }),
  { km: DEFAULT_BIKE_SERVICE_INTERVAL_KM, days: DEFAULT_BIKE_SERVICE_INTERVAL_DAYS },
  'bikes default to the bike service interval'
);
assert.deepEqual(
  serviceIntervals({ kind: 'car' }),
  { km: DEFAULT_SERVICE_INTERVAL_KM, days: DEFAULT_SERVICE_INTERVAL_DAYS },
  'cars keep the car service interval'
);
assert.deepEqual(
  serviceIntervals({ kind: 'bike', serviceIntervalKm: 3000, serviceIntervalDays: 90 }),
  { km: 3000, days: 90 },
  'explicit vehicle intervals win over the defaults'
);

const maintenanceSummaryResult = maintenanceSummary(maintenanceVehicles, seededLogs, []);
assert.ok(maintenanceSummaryResult.spend > 0, 'maintenance analytics sum workshop spend');
assert.ok(maintenanceSummaryResult.monthly.length === 6, 'maintenance spend has a six-month trend');
assert.ok(maintenanceSummaryResult.vendors.length > 0, 'maintenance analytics group spend by vendor');
const baselineVehicle = { id: 'svc-test', odometer: 5000, lastServiceDate: '2026-05-01', lastServiceOdometer: 4000 };
const backfilledService = applyServiceEntry(baselineVehicle, { serviceDate: '2026-04-01', odometer: 3800, resetsService: true });
assert.equal(backfilledService.lastServiceDate, '2026-05-01', 'backfilling an older service never moves the baseline backwards');
assert.equal(backfilledService.odometer, 5000, 'backfilling an older service never lowers the odometer');
const absurdOdometer = serviceEntry(
  { serviceDate: '2026-05-01', odometer: 2000001, cost: 100 },
  { id: 'svc-test', odometer: 5000 },
);
assert.equal(absurdOdometer.ok, false, 'a service entry cannot bypass the odometer ceiling');
assert.match(absurdOdometer.problem, /20,00,000/, 'the odometer ceiling message is explicit');
const newerService = applyServiceEntry(baselineVehicle, { serviceDate: '2026-06-01', odometer: 5500, resetsService: true });
assert.equal(newerService.lastServiceDate, '2026-06-01', 'a newer service moves the baseline forward');
assert.equal(newerService.lastServiceOdometer, 5500, 'a newer service stores its odometer');
const fySpend = maintenanceSummary([], [
  { serviceDate: '2026-03-15', cost: 1000, kind: 'service', resetsService: true },
  { serviceDate: '2026-04-15', cost: 2000, kind: 'service', resetsService: true },
  { serviceDate: '2026-10-01', cost: 3000, kind: 'service', resetsService: true },
], [], '2026-10-25');
assert.equal(fySpend.spendYtd, 5000, 'service spend YTD follows the Apr–Mar financial year');

const serviceTarget = board.find((row) => row.tracked)?.id
  ? maintenanceVehicles.find((vehicle) => vehicle.id === board.find((row) => row.tracked).id)
  : maintenanceVehicles[0];
assert.ok(serviceTarget, 'a vehicle is available for service logging');
const serviceOdometer = Number(serviceTarget.odometer) || 0;
const savedService = await demoApi.adminSaveServiceLog({
  vehicleId: serviceTarget.id,
  serviceDate: localToday,
  odometer: serviceOdometer + 120,
  kind: 'service',
  cost: 3450,
  vendor: 'Contract Test Workshop',
  reference: 'WO-TEST-1',
  notes: 'Contract test service.',
  resetsService: true,
});
assert.equal(savedService.cost, 3450);
assert.equal(savedService.resetsService, true);
assert.equal(savedService.vehicle.odometer, serviceOdometer + 120, 'service log moves the vehicle odometer');
const afterService = (await demoApi.adminVehicles()).find((vehicle) => vehicle.id === serviceTarget.id);
assert.equal(afterService.odometer, serviceOdometer + 120);
assert.equal(afterService.lastServiceDate, localToday, 'resetting service moves the service baseline');
assert.equal(afterService.lastServiceOdometer, serviceOdometer + 120);

let lowerOdometerRejected = false;
try {
  await demoApi.adminSaveServiceLog({
    vehicleId: serviceTarget.id,
    serviceDate: localToday,
    odometer: serviceOdometer - 1,
    kind: 'service',
    cost: 1000,
  });
} catch {
  lowerOdometerRejected = true;
}
assert.equal(lowerOdometerRejected, true, 'a service entry cannot lower the odometer');

let futureServiceRejected = false;
try {
  await demoApi.adminSaveServiceLog({
    vehicleId: serviceTarget.id,
    serviceDate: isoOffset(2),
    odometer: serviceOdometer + 130,
    kind: 'service',
    cost: 1000,
  });
} catch {
  futureServiceRejected = true;
}
assert.equal(futureServiceRejected, true, 'a service entry cannot be dated in the future');

const odometerUpdated = await demoApi.adminSetOdometer({
  vehicleId: serviceTarget.id,
  odometer: serviceOdometer + 150,
  note: 'Contract test return',
});
assert.equal(odometerUpdated.odometer, serviceOdometer + 150);

const maintenanceVehicle = maintenanceVehicles.find((vehicle) => vehicle.status === 'maintenance');
assert.ok(maintenanceVehicle, 'demo fleet has an in-workshop vehicle');
const returnedService = await demoApi.adminSaveServiceLog({
  vehicleId: maintenanceVehicle.id,
  serviceDate: localToday,
  odometer: Math.max(0, Number(maintenanceVehicle.odometer) || 0) + 20,
  kind: 'inspection',
  cost: 1800,
  vendor: 'Contract Test Workshop',
  returnToService: true,
});
assert.equal(returnedService.vehicle.odometer, Math.max(0, Number(maintenanceVehicle.odometer) || 0) + 20);
assert.equal(
  (await demoApi.adminVehicles()).find((vehicle) => vehicle.id === maintenanceVehicle.id)?.status,
  'available',
  'logging a service can return a vehicle to the bookable fleet',
);

await demoApi.adminDeleteServiceLog(savedService.id);
assert.ok(
  !(await demoApi.adminServiceLogs()).some((log) => log.id === savedService.id),
  'an admin can remove a mistaken service entry',
);
log('fleet maintenance: baselines, validation, history, return-to-service and analytics');

// ---------------------------------------------------------------------------
// Shared analytics CSV builder
// ---------------------------------------------------------------------------
const sampleDaily = Array.from({ length: 90 }, (_, index) => ({
  date: isoOffset(index - 89),
  label: 'x', created: index, started: index, completed: 0, cancelled: 0, recognized: index * 100, received: 0, gst: index,
}));
const sampleCsv = analyticsCsv({
  daily: sampleDaily,
  weekdayMix: [{ label: 'Mon', count: 3, revenue: 300 }],
  hubMix: [{ label: 'Hub A', count: 2, revenue: 200 }],
  typeMix: [{ label: 'SUV', count: 4, revenue: 400 }],
  km: { byVehicle: [{ label: 'Wrangler', value: 1350 }], excessKmFees: 1500 },
  extensions: { count: 2, revenueDelta: 6400, byMonth: [{ label: '2026-10', value: 6400 }] },
  returnTimes: { settled: 4, onTime: 3, late: 1, onTimeRate: 75, avgLateDays: 1.5 },
  lateReturns: [
    { vehicle: 'Duster', returns: 2, late: 2, lateHours: 53, lateFees: 2900 },
    { vehicle: 'Creta', returns: 2, late: 1, lateHours: 5, lateFees: 500 },
  ],
  fleetRadar: [{ id: 'a', name: 'Wrangler', score: 62, band: 'due' }],
}, 30);
assert.equal(sampleCsv[0].join(','), ANALYTICS_CSV_HEADERS.join(','), 'the analytics CSV keeps the shared 12-column header');
assert.ok(sampleCsv.every((row) => row.length === 12), 'every analytics CSV row has exactly 12 columns');
assert.equal(sampleCsv.filter((row) => row[0] === 'daily').length, 30, 'the daily block follows the selected range, not every day');
const categoryRows = sampleCsv.filter((row) => row[0] === 'category');
assert.equal(categoryRows.length, 1, 'category mixes appear under a consistent type tag');
assert.equal(categoryRows[0][10], '4', 'category count lands in the count column');
assert.equal(categoryRows[0][11], '400', 'category revenue lands in the revenue column');
const extensionRow = sampleCsv.find((row) => row[0] === 'extension');
assert.ok(extensionRow && extensionRow[11] === '6400', 'extension totals ride the shared CSV');
assert.ok(sampleCsv.some((row) => row[0] === 'extension_month' && row[9] === '2026-10' && row[11] === '6400'), 'extension month rows keep the shape');
assert.equal(sampleCsv.filter((row) => row[0] === 'punctuality').length, 3, 'punctuality exports its on-time/late/average rows');
assert.ok(sampleCsv.some((row) => row[0] === 'fleet_health' && row[10] === '62'), 'fleet health scores export per vehicle');
const lateReturnRow = sampleCsv.find((row) => row[0] === 'late_return' && row[9] === 'Duster');
assert.ok(lateReturnRow && lateReturnRow[10] === '2' && lateReturnRow[11] === '2900', 'late returns export count + fee revenue per vehicle');
const lateHoursRow = sampleCsv.find((row) => row[0] === 'late_hours' && row[9] === 'Duster');
assert.ok(lateHoursRow && lateHoursRow[10] === '53', 'late hours export in the count column');
assert.equal(sampleCsv.filter((row) => row[0] === 'late_return').length, 2, 'every late-return vehicle gets a row');
const utilCsv = analyticsCsv({
  daily: sampleDaily,
  utilizationTrend: sampleDaily.map((row) => ({ date: row.date, label: row.label, value: 42 })),
}, 7);
const utilRows = utilCsv.filter((row) => row[0] === 'utilization');
assert.equal(utilRows.length, 7, 'the utilisation block follows the selected range');
const acqCsv = analyticsCsv({
  daily: [],
  customerAcquisitionTrend: {
    total: 6,
    monthly: [
      { label: '2026-01', count: 1 },
      { label: '2026-02', count: 2 },
      { label: '2026-03', count: 0 },
    ],
  },
  checkout: {
    count30d: 4,
    value30d: 220000,
    count24h: 1,
    recent: [
      { id: 'a', vehicleName: 'Mustang', amount: 84000, startDate: '2026-11-20', endDate: '2026-11-24' },
    ],
  },
}, 30);
const acqTotal = acqCsv.find((row) => row[0] === 'acquisition');
assert.ok(acqTotal && acqTotal[10] === '6', 'acquisition total exports in the count column');
const signupRows = acqCsv.filter((row) => row[0] === 'signups');
assert.equal(signupRows.length, 2, 'zero-count months are skipped in the acquisition export');
assert.ok(signupRows.some((row) => row[9] === '2026-02' && row[10] === '2'), 'signup counts keep count + label shape');
const checkoutAbandoned = acqCsv.find((row) => row[0] === 'checkout_abandoned');
assert.ok(checkoutAbandoned && checkoutAbandoned[10] === '4' && checkoutAbandoned[11] === '220000', 'abandoned checkouts export count + lost revenue');
assert.ok(acqCsv.some((row) => row[0] === 'checkout_attempt' && row[9] === 'Mustang' && row[11] === '84000'), 'checkout attempts export vehicle + basket value');
log('analytics CSV: acquisition and abandoned-checkout rows keep the shared shape');
assert.equal(utilRows[0][10], '42', 'utilisation per cent exports in the count column');
assert.equal(utilRows[0][1], sampleDaily[sampleDaily.length - 7].date, 'utilisation rows keep their date');
assert.deepEqual(
  analyticsCsvRows({ daily: sampleDaily }, 7).map((row) => row[0]),
  Array.from({ length: 7 }, () => 'daily'),
  'rows expose a stable type column for onward tooling',
);
// The deposit book exports the same buckets the Finance ledger shows.
const depositCsv = analyticsCsv({ daily: sampleDaily, deposits: {
  depositsHeld: 120000,
  awaiting: 23,
  awaitingAmount: 115000,
  depositsReleased: 4200,
  depositsDeducted: 2500,
  extraDue: 3000,
  refundsByMethod: [{ method: 'bank', count: 3 }, { method: 'upi', count: 1 }],
} }, 7);
const depositRowOf = (type) => depositCsv.find((row) => row[0] === type);
assert.equal(depositCsv.every((row) => row.length === 12), true, 'deposit rows stay within the 12-column contract');
assert.equal(depositRowOf('deposit_float')[11], '120000', 'held deposits export as money');
assert.equal(depositRowOf('deposit_awaiting')[10], '23', 'the awaiting count exports in the count column');
assert.equal(depositRowOf('deposit_awaiting')[11], '115000', '... and the money behind it in revenue');
assert.equal(depositRowOf('deposit_released')[11], '4200', 'released refunds export as money');
assert.equal(depositRowOf('deposit_refund')[10], '3', 'refund-method rows tally by method');
assert.equal(depositCsv.filter((row) => row[0] === 'deposit_refund').length, 2, 'each refund method gets its own row');
const emptyDepositCsv = analyticsCsv({ daily: sampleDaily, deposits: {} }, 7);
assert.equal(emptyDepositCsv.some((row) => row[0].startsWith('deposit_')), false, 'an empty deposit book exports no phantom rows');
log('shared analytics CSV: fixed 12 columns, range-aware daily block and consistent mix tags');

// ---------------------------------------------------------------------------
// Availability strip
// ---------------------------------------------------------------------------
const stripCells = availabilityStrip({
  today: '2026-11-01',
  upcoming: [
    { startDate: '2026-11-03', endDate: '2026-11-05' },
    { startDate: '2026-11-20', endDate: '2026-11-21', reason: 'block:maintenance' },
  ],
  days: 30,
});
assert.equal(stripCells.length, 30, 'the strip covers one full window');
assert.equal(stripCells[1].busy, false, 'an open day stays free');
assert.equal(stripCells[2].busy, true, 'a booked range marks its first day');
assert.equal(stripCells[3].busy, true, 'a booked range marks every night');
assert.equal(stripCells[4].busy, false, 'the drop-off day is free again, matching the quote engine');
assert.equal(stripCells[5].busy, false, 'the day after a booking frees up');
assert.equal(stripCells[19].busy, true, 'the maintenance block marks its first day');
assert.equal(stripCells[20].busy, false, 'a block ending on a day frees that day');
assert.equal(stripCells[19].reason, 'block:maintenance', 'blocked days carry their reason');
assert.equal(stripCells.slice(0, 7).filter((cell) => !cell.busy).length, 5, 'open days count correctly');
const stripTotal = stripSummary(stripCells);
assert.equal(stripTotal.openCount, 30 - 3, 'the summary counts open days');
assert.equal(stripTotal.firstOpenDate, '2026-11-01', 'the summary reports the nearest free day');
assert.equal(stripSummary(availabilityStrip({ today: '2026-11-01', upcoming: [{ startDate: '2026-11-01', endDate: '2026-12-01' }], days: 30 })).openCount, 0, 'a fully-booked window reports zero open days');
log('availability strip: day ranges, reasons, nearest-free-day and full-book edge');

// ---------------------------------------------------------------------------
// Trip progress
// ---------------------------------------------------------------------------
assert.equal(tripProgress({ status: 'pending' }).currentIndex, 0, 'a pending trip sits on the first milestone');
assert.equal(tripProgress({ status: 'confirmed' }).currentIndex, 1, 'a confirmed trip advances one step');
assert.equal(tripProgress({ status: 'active' }).currentIndex, 2, 'an active trip is on the rent milestone');
assert.equal(tripProgress({ status: 'completed' }).currentIndex, 3, 'a completed trip reaches the final milestone');
assert.equal(tripProgress({ status: 'cancelled' }).closed, true, 'a cancelled trip is closed');
assert.equal(tripProgress({ status: 'rejected' }).closedStatus, 'rejected', 'a rejected trip keeps its closed status');
assert.equal(tripProgressPercent(tripProgress({ status: 'pending' })), 25, 'pending shows a quarter progress bar');
assert.equal(tripProgressPercent(tripProgress({ status: 'completed' })), 100, 'completed fills the progress bar');
assert.equal(tripProgressPercent(tripProgress({ status: 'cancelled' })), 100, 'a closed trip renders at full width');
log('trip progress: milestone indexing, terminal closed state and bar percent');

// ---------------------------------------------------------------------------
// Admin analytics: first-time vs returning revenue + trip-length buckets
// ---------------------------------------------------------------------------
const statsBookings = [
  {
    id: 'b1', code: 'RV-1', status: 'completed', startDate: '2026-01-10', endDate: '2026-01-11', total: 2000,
    customer: { name: 'Repeat Rider', email: 'repeat@example.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
  },
  {
    id: 'b2', code: 'RV-2', status: 'completed', startDate: '2026-02-10', endDate: '2026-02-13', total: 5000,
    customer: { name: 'Repeat Rider', email: 'repeat@example.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
  },
  {
    id: 'b3', code: 'RV-3', status: 'completed', startDate: '2026-03-01', endDate: '2026-03-06', total: 3000,
    customer: { name: 'One Timer', email: 'once@example.com' }, vehicle: { type: 'Sedan' }, pickupLocation: 'Hub B',
  },
];
const statsResult = computeAdminStats(statsBookings, [], [], [], []);
assert.equal(statsResult.analytics.customerMix.newRevenue, 5000, 'first trips from each customer count as new revenue');
assert.equal(statsResult.analytics.customerMix.returningRevenue, 5000, 'later trips count as returning revenue');
assert.equal(statsResult.analytics.customerMix.newTrips, 2, 'one first trip per customer');
assert.equal(statsResult.analytics.customerMix.returningTrips, 1, 'one repeat trip');
assert.equal(statsResult.analytics.customerMix.returningShare, 50, 'returning share is half the recognised revenue');
assert.deepEqual(
  statsResult.analytics.tripLengthMix.map((row) => row.count),
  [1, 1, 1, 0, 0],
  'a 1-night, 3-night and 5-night trip land in the 1-day, 2–3-day and 4–7-day buckets',
);
assert.equal(statsResult.analytics.avgTripDays, 3, 'trip length uses rental nights, not inclusive calendar days');
const funnel = bookingFunnel({ pending: 1, confirmed: 2, active: 3, completed: 4, cancelled: 5, rejected: 6 });
assert.equal(funnel.requested, 21, 'the funnel starts with every request');
assert.equal(funnel.confirmed, 9, 'confirmed includes active and completed');
assert.equal(funnel.active, 7, 'started includes completed');
assert.equal(funnel.completed, 4, 'completed is the final stage');
assert.ok(
  funnel.requested >= funnel.confirmed && funnel.confirmed >= funnel.active && funnel.active >= funnel.completed,
  'funnel stages are cumulative and never grow',
);
const emptyCheckout = checkoutSummary([], '2026-10-26');
assert.equal(emptyCheckout.count30d, 0, 'no checkout attempts → nothing at risk');
assert.deepEqual(
  emptyCheckout.recent,
  [],
  'no checkout attempts → no recovery rows',
);
const checkoutSummaryRows = checkoutSummary([
  { id: 'chk-1', vehicleId: 'v1', startDate: '2026-10-01', endDate: '2026-10-03', amountDue: 5000, createdAt: `${isoOffset(-1)}T10:00:00.000Z` },
  { id: 'chk-2', vehicleId: 'v2', startDate: '2026-10-01', endDate: '2026-10-03', amountDue: 9000, createdAt: `${isoOffset(-3)}T10:00:00.000Z` },
  { id: 'chk-3', vehicleId: 'v3', startDate: '2026-10-01', endDate: '2026-10-03', amountDue: 9000, createdAt: `${isoOffset(-40)}T10:00:00.000Z`, convertedAt: '2026-09-01T00:00:00.000Z' },
  { id: 'chk-4', vehicleId: 'v4', startDate: '2026-10-01', endDate: '2026-10-03', amountDue: 9000, createdAt: `${isoOffset(-40)}T10:00:00.000Z` },
], isoOffset(0));
assert.equal(checkoutSummaryRows.count30d, 2, 'only unconverted attempts in the last 30 days count');
assert.equal(checkoutSummaryRows.value30d, 14000, 'at-risk value sums the recent unconverted attempts');
assert.equal(checkoutSummaryRows.recent[0].id, 'chk-2', 'the largest at-risk attempt sorts first');
assert.equal(checkoutSummaryRows.count24h, 1, 'the 24h counter reflects only recent drops');
const leadMixStats = computeAdminStats([
  { id: 'ld-1', status: 'completed', startDate: '2026-10-02', endDate: '2026-10-03', total: 1000, createdAt: '2026-10-02T09:00:00.000Z', customer: { email: 'a@x.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A' },
  { id: 'ld-2', status: 'completed', startDate: '2026-10-20', endDate: '2026-10-22', total: 1000, createdAt: '2026-10-01T09:00:00.000Z', customer: { email: 'b@x.com' }, vehicle: { type: 'Sedan' }, pickupLocation: 'Hub B' },
  { id: 'ld-3', status: 'confirmed', startDate: '2026-12-01', endDate: '2026-12-03', total: 0, createdAt: '2026-10-01T09:00:00.000Z', customer: { email: 'c@x.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A' },
], [], [], [], []);
const leadMix = leadMixStats.analytics.leadTimeMix;
assert.ok(
  leadMix.some((row) => row.label === 'Same day' && row.count === 1),
  'same-day bookings land in the same-day bucket',
);
assert.ok(
  leadMix.some((row) => row.label === '2–4 weeks' && row.count === 1),
  '19-day leads land in the 2–4 week bucket',
);
assert.ok(
  leadMix.some((row) => row.label === '1–3 months' && row.count === 1),
  '61-day leads land in the 1–3 month bucket',
);
const complianceToday = '2026-10-27';
assert.equal(docStatus('2026-10-01', complianceToday).status, 'expired', 'a lapsed document is expired');
assert.equal(docStatus('2026-11-05', complianceToday).status, 'expiring', 'a document inside the warning window is expiring');
assert.equal(docStatus('2027-06-01', complianceToday).status, 'ok', 'a valid document is fine');
assert.equal(docStatus('', complianceToday).status, 'untracked', 'a missing date is flagged untracked, not silently ok');
const docVehicles = [
  { id: 'v-exp', name: 'Expired Cruiser', insuranceExpiry: '2026-10-01', pucExpiry: '2027-05-01' },
  { id: 'v-soon', name: 'Timely Scooter', pucExpiry: '2026-11-01' },
  { id: 'v-ok', name: 'Healthy Hatch', registrationNumber: 'KA-01-AB-0001', insuranceExpiry: '2027-08-01' },
];
const docs = fleetDocuments(docVehicles, complianceToday);
assert.equal(docs.expired.length, 1, 'only the lapsed vehicle is expired');
assert.equal(docs.expiring.length, 1, 'the scooter is expiring soon');
assert.ok(docs.watchlist[0].id === 'v-exp', 'the expired vehicle leads the watchlist');
assert.equal(vehicleDocs(docVehicles[2]).registrationNumber, 'KA-01-AB-0001', 'the registration number surfaces');
assert.deepEqual(fleetDocProblems({ insuranceExpiry: 'not-a-date' }), { insuranceExpiry: 'Choose a valid Insurance expiry date.' }, 'malformed document dates are rejected');
const complianceInStats = computeAdminStats([], docVehicles, [], [], [], []);
assert.equal(complianceInStats.analytics.compliance.expired.length, 1, 'admin stats surface fleet compliance');
const caseStats = computeAdminStats([
  {
    id: 'case-1', status: 'completed', startDate: '2026-01-01', endDate: '2026-01-02', total: 1000,
    customer: { email: 'Case@Example.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
  },
  {
    id: 'case-2', status: 'completed', startDate: '2026-02-01', endDate: '2026-02-02', total: 1000,
    customer: { email: 'case@example.com ' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
  },
], [], [], [], []);
assert.equal(caseStats.analytics.repeatRate, 100, 'email casing and spaces do not split a repeat customer');
// A UTC timestamp near midnight must land on the local day the admin sees, not
// the UTC slice of the ISO string.
const boundaryTimestamp = `${isoOffset(-5)}T19:30:00.000Z`;
const boundaryDate = new Date(boundaryTimestamp);
const boundaryLocalDay = `${boundaryDate.getFullYear()}-${String(boundaryDate.getMonth() + 1).padStart(2, '0')}-${String(boundaryDate.getDate()).padStart(2, '0')}`;
const boundaryStats = computeAdminStats([{
  id: 'b-local', code: 'RV-LOCAL', status: 'pending', startDate: isoOffset(3), endDate: isoOffset(4), total: 0,
  customer: { email: 'local@example.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
  createdAt: boundaryTimestamp,
}], [], [], [], []);
assert.equal(
  boundaryStats.analytics.daily.find((row) => row.date === boundaryLocalDay)?.created,
  1,
  'a UTC timestamp is bucketed on the local calendar day the admin sees',
);
log('admin stats: customer mix and trip-length distribution');

// Windowed analytics must not count cancelled trips as started, refunds as cash
// received, or a cancelled first attempt as a returning customer.
const windowStats = computeAdminStats([
  {
    id: 'w0', code: 'RV-W0', status: 'cancelled', startDate: isoOffset(-20), endDate: isoOffset(-19), total: 900,
    customer: { email: 'x@example.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
    createdAt: `${isoOffset(-25)}T10:00:00.000Z`,
  },
  {
    id: 'w1', code: 'RV-W1', status: 'completed', startDate: isoOffset(-5), endDate: isoOffset(-4), total: 1000,
    customer: { email: 'x@example.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
    createdAt: `${isoOffset(-10)}T10:00:00.000Z`,
    payments: [
      { kind: 'payment', status: 'succeeded', amount: 1000, createdAt: `${isoOffset(-9)}T10:00:00.000Z` },
      { kind: 'refund', status: 'refunded', amount: 400, createdAt: `${isoOffset(-8)}T10:00:00.000Z` },
    ],
  },
  {
    id: 'w2', code: 'RV-W2', status: 'cancelled', startDate: isoOffset(-3), endDate: isoOffset(-2), total: 2000,
    customer: { email: 'y@example.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
    createdAt: `${isoOffset(-12)}T10:00:00.000Z`,
  },
  {
    id: 'w3', code: 'RV-W3', status: 'completed', startDate: isoOffset(-2), endDate: isoOffset(-1), total: 3000,
    customer: { email: 'x@example.com' }, vehicle: { type: 'SUV' }, pickupLocation: 'Hub A',
    createdAt: `${isoOffset(-6)}T10:00:00.000Z`,
  },
  {
    id: 'w4', code: 'RV-W4', status: 'completed', startDate: isoOffset(-1), endDate: isoOffset(0), total: 500,
    customer: { email: 'y@example.com' }, vehicle: { type: 'Sedan' }, pickupLocation: 'Hub B',
    createdAt: `${isoOffset(-4)}T10:00:00.000Z`,
  },
], [], [], [], []);
const startedDay = windowStats.analytics.daily.find((row) => row.date === isoOffset(-5));
const receivedDay = windowStats.analytics.daily.find((row) => row.date === isoOffset(-9));
const refundDay = windowStats.analytics.daily.find((row) => row.date === isoOffset(-8));
const cancelledDay = windowStats.analytics.daily.find((row) => row.date === isoOffset(-3));
assert.equal(startedDay.started, 1, 'completed trips count as started');
assert.equal(receivedDay.received, 1000, 'captured payments count as cash received');
assert.equal(refundDay.received, 0, 'refund rows are not counted as cash received');
assert.equal(cancelledDay.started, 0, 'a cancelled trip never counts as started');
assert.equal(windowStats.analytics.repeatRate, 50, 'repeat rate counts customers with 2+ completed trips');
assert.equal(windowStats.analytics.customerMix.newRevenue, 1500, 'a cancelled first attempt does not turn the first completed trip into returning revenue');
assert.equal(windowStats.analytics.customerMix.returningRevenue, 3000, 'only later completed trips count as returning revenue');
log('admin stats: started/received windows, repeat rate and first completed trip');

// ---------------------------------------------------------------------------
// Historic fleet utilisation trend
// ---------------------------------------------------------------------------
const utilBookings = [
  { id: 'b1', vehicle: { id: 'v1' }, status: 'confirmed', startDate: '2026-10-01', endDate: '2026-10-04' },
  { id: 'b2', vehicle: { id: 'v2' }, status: 'active', startDate: '2026-10-02', endDate: '2026-10-03' },
  { id: 'b3', vehicle: { id: 'v3' }, status: 'cancelled', startDate: '2026-10-01', endDate: '2026-10-05' },
  { id: 'b4', vehicle: { id: 'v1' }, status: 'confirmed', startDate: '2026-10-10', endDate: '2026-10-12' },
];
const utilVehicles = [
  { id: 'v1', status: 'available' },
  { id: 'v2', status: 'available' },
  { id: 'v3', status: 'available' },
  { id: 'v4', status: 'maintenance' },
];
const utilTrend = utilizationSeries(utilBookings, utilVehicles, { days: 6, today: '2026-10-06' });
assert.equal(utilTrend.length, 6, 'the utilisation series covers exactly the requested days');
const oct1 = utilTrend.find((row) => row.date === '2026-10-01');
assert.equal(oct1.value, 33, 'a confirmed booking occupies its vehicle every day of the half-open window');
const oct2 = utilTrend.find((row) => row.date === '2026-10-02');
assert.equal(oct2.value, 67, 'two different vehicles on the same day: 2 of 3 bookable');
const oct3 = utilTrend.find((row) => row.date === '2026-10-03');
assert.equal(oct3.value, 33, 'the active trip that ended on 10-03 does not occupy 10-03 (half-open)');
const oct5 = utilTrend.find((row) => row.date === '2026-10-05');
assert.equal(oct5.value, 0, 'cancel + maintenance never count as occupied capacity');
const oct10 = utilizationSeries(utilBookings, utilVehicles, { days: 5, today: '2026-10-12' }).find((row) => row.date === '2026-10-10');
assert.equal(oct10.value, 33, 'future-forward bookings count toward utilisation on their start day');
assert.equal(utilizationSeries([], [], { days: 5, today: '2026-10-06' }).length, 5, 'the utilisation series still returns days for an empty fleet');
assert.ok(utilizationSeries([], []).every((row) => row.value === 0), 'an empty fleet reads as 0% every day');

// ---------------------------------------------------------------------------
// Peak-season readiness
// ---------------------------------------------------------------------------
const readinessVehicles = [
  { id: 'v1', name: 'Porsche', status: 'available' },
  { id: 'v2', name: 'Camry', status: 'available' },
  { id: 'v3', name: 'Wrangler', status: 'available' },
  { id: 'v4', name: 'Velar', status: 'maintenance' },
];
const readinessBookings = [
  { id: 'b1', status: 'confirmed', vehicleId: 'v1', startDate: '2026-12-20', endDate: '2026-12-24' },
  { id: 'b2', status: 'cancelled', vehicleId: 'v2', startDate: '2026-12-21', endDate: '2026-12-23' },
  { id: 'b3', status: 'confirmed', vehicleId: 'v3', startDate: '2026-12-22', endDate: '2026-12-26' },
];
// Window covers all three bookings; cancelled does not hold v2.
const readiness = seasonalReadiness(readinessBookings, readinessVehicles, [], {
  start: '2026-12-15', end: '2027-01-05', today: '2026-10-30',
});
assert.equal(readiness.capacity, 3, 'capacity excludes vehicles already in the workshop');
assert.equal(readiness.booked, 2, 'cancelled bookings do not hold a vehicle');
assert.equal(readiness.availableCount, 1, 'only v2 is available (v1 + v3 are booked; v4 is in the workshop)');
assert.equal(readiness.availabilityPct, 33, 'availability is a percentage of bookable capacity');
assert.ok(readiness.topHeld.includes('Porsche') && readiness.topHeld.includes('Wrangler'), 'held vehicles are listed by name');
assert.ok(readiness.atRisk.some((row) => row.id === 'v4'), 'a maintenance vehicle is flagged at risk');
assert.equal(readiness.atRisk.length, 1, 'only workshop vehicles are actionable risk — booked ones are not double-counted');
// A window that has already passed, or a missing window, reads as "not applicable".
assert.equal(seasonalReadiness(readinessBookings, readinessVehicles, [], { start: '2026-01-01', end: '2026-01-10', today: '2026-10-30' }), null, 'a past window is not actionable');
assert.equal(seasonalReadiness(readinessBookings, readinessVehicles, [], { start: '', end: '', today: '2026-10-30' }), null, 'no configured window means no readiness signal');
const readinessInStats = computeAdminStats(readinessBookings, readinessVehicles, [], [], [], [], [], { seasonal_start: '2026-12-15', seasonal_end: '2027-01-05' });
assert.equal(readinessInStats.analytics.seasonalReadiness.booked, 2, 'computeAdminStats exposes seasonal readiness from settings');
log('peak-season readiness: window aware, cancelled-free, maintenance-risk surfaced');
// The dashboard's hourly timeline counts every pick-up/return of the day — a
// slice of six would undercount a busy desk, so the full day must survive.
const busyToday = Array.from({ length: 9 }, (_, index) => ({
  id: `today-${index}`,
  customer: { name: `C${index}` },
  vehicle: { id: `v${index}` },
  status: 'confirmed',
  startDate: todayISO(),
  endDate: todayISO(),
  pickupTime: `${String(7 + index).padStart(2, '0')}:30`,
  dropoffTime: '18:00',
}));
const busyStats = computeAdminStats(busyToday, utilVehicles, [], [], [], []);
assert.equal(busyStats.pickupsToday.length, 9, 'pick-ups today are not capped for the day-list or the hourly timeline');
const times = busyStats.pickupsToday.map((row) => row.pickupTime);
assert.ok(times.every((value, index) => index === 0 || times[index - 1] <= value), 'pick-ups stay sorted by pick-up time');
log('admin stats: historic fleet utilisation by day (half-open windows, maintenance excluded)');
log('admin stats: historic fleet utilisation by day (half-open windows, maintenance excluded)');

// ---------------------------------------------------------------------------
// Trip-date policy: precise messages for inverted, zero-day and valid ranges
// ---------------------------------------------------------------------------
assert.equal(
  tripProblem(isoOffset(3), isoOffset(2), {}),
  'Drop-off must be on or after pick-up.',
  'an inverted date range gets its own message, not a minimum-rental message',
);
assert.equal(tripProblem(isoOffset(2), isoOffset(3), {}), null, 'a one-day trip is valid under the default policy');
assert.match(
  tripProblem(isoOffset(2), isoOffset(2), {}),
  /minimum rental/i,
  'a zero-day trip falls under the minimum rental',
);
log('trip dates: inverted, zero-day and valid ranges');

// ---------------------------------------------------------------------------
// Calendar invites: two one-hour reminders, escaped text and content overrides
// ---------------------------------------------------------------------------
const { buildBookingICS } = await import('../src/lib/calendar.js');
const icsBooking = {
  code: 'RV-TEST01',
  vehicle: { name: 'Tesla Model Y' },
  startDate: '2026-11-02',
  endDate: '2026-11-05',
  pickupTime: '10:00',
  dropoffTime: '18:00',
  pickupLocation: 'Mumbai, Bandra; West',
  dropoffLocation: 'Pune',
};
const ics = buildBookingICS(icsBooking, { pickupTitle: 'Collect', dropoffTitle: 'Return' });
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2, 'one event for pick-up and one for drop-off');
assert.match(ics, /SUMMARY:Collect · Tesla Model Y/);
assert.match(ics, /SUMMARY:Return · Tesla Model Y/);
assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261102T100000/);
assert.match(ics, /DTEND;TZID=Asia\/Kolkata:20261102T110000/, 'the pick-up reminder lasts one hour, not the whole rental');
assert.match(ics, /DTSTART;TZID=Asia\/Kolkata:20261105T180000/);
assert.match(ics, /DTEND;TZID=Asia\/Kolkata:20261105T190000/);
assert.match(ics, /LOCATION:Mumbai\\, Bandra\\; West/, 'commas and semicolons are escaped for ICS');
assert.match(ics, /DESCRIPTION:Booking RV-TEST01\./, 'the booking code is in the invite');
const icsLate = buildBookingICS({ ...icsBooking, pickupTime: '23:30' });
assert.match(icsLate, /DTEND;TZID=Asia\/Kolkata:20261103T003000/, 'a late pick-up rolls the one-hour reminder into the next day');
const icsPadded = buildBookingICS({ ...icsBooking, pickupTime: '9:05' });
assert.match(icsPadded, /DTSTART;TZID=Asia\/Kolkata:20261102T090500/, 'single-digit hours are zero-padded for ICS');
log('calendar invites: two one-hour events, escaped text and content overrides');

// ---------------------------------------------------------------------------
// Rate-rule validation: one shared rule set for Settings, Pricing and adapters
// ---------------------------------------------------------------------------
const goodRules = {
  tax_rate: '18', deposit_percent: '10', hold_amount: '5000', one_way_fee: '1500',
  weekend_multiplier: '1.2', seasonal_multiplier: '1.5', seasonal_start: '', seasonal_end: '',
  min_age: '21', max_rental_days: '45', min_rental_days: '1',
};
assert.deepEqual(rateRuleErrors(goodRules), {}, 'valid rate rules produce no errors');
assert.equal(Object.keys(rateRuleValues(goodRules)).length, RATE_RULE_KEYS.length, 'rateRuleValues snapshots every rule key');

assert.match(rateRuleErrors({ ...goodRules, tax_rate: '45' }).tax_rate, /GST must be between 0 and 30%/, 'tax above 30% is rejected');
assert.match(
  rateRuleErrors({ ...goodRules, tax_label: 'VAT', tax_rate: '45' }).tax_rate,
  /VAT must be between 0 and 30%/,
  'the tax message uses the configured label',
);
assert.ok(rateRuleErrors({ ...goodRules, deposit_percent: '0' }).deposit_percent, 'a 0% deposit is rejected');
assert.ok(rateRuleErrors({ ...goodRules, min_age: '15' }).min_age, 'drivers under 16 are rejected');
assert.ok(rateRuleErrors({ ...goodRules, max_rental_days: '400' }).max_rental_days, 'rentals beyond a year are rejected');
assert.ok(rateRuleErrors({ ...goodRules, min_rental_days: '0' }).min_rental_days, 'a 0-day minimum rental is rejected');
assert.ok(rateRuleErrors({ ...goodRules, min_rental_days: '31' }).min_rental_days, 'a minimum rental beyond 30 days is rejected');
assert.match(
  rateRuleErrors({ ...goodRules, one_way_fee: '1500.5' }).one_way_fee,
  /whole rupee/,
  'a fractional one-way fee is rejected so demo and SQL totals stay identical',
);
assert.match(
  rateRuleErrors({ ...goodRules, hold_amount: '5000.5' }).hold_amount,
  /whole rupee/,
  'a fractional security deposit is rejected',
);
assert.equal(
  rateRuleErrors({ ...goodRules, min_rental_days: '5', max_rental_days: '3' }).max_rental_days,
  'Maximum must be at least the minimum rental period.',
  'max rental days cannot undercut the minimum',
);

const loneSeason = rateRuleErrors({ ...goodRules, seasonal_start: '2026-06-01' });
assert.ok(loneSeason.seasonal_end, 'a lone season start flags the missing end');
assert.ok(
  rateRuleErrors({ ...goodRules, seasonal_start: '2026-06-01', seasonal_end: '2026-05-01' }).seasonal_end,
  'a season cannot end before it starts',
);
assert.deepEqual(
  rateRuleErrors({ ...goodRules, seasonal_start: '2026-06-01', seasonal_end: '2026-06-30' }),
  {},
  'a complete, ordered season is valid',
);

assert.deepEqual(rateRulePatchErrors({ email_subject_booking_confirmed: 'Hi' }), {}, 'unrelated settings patches skip rate-rule validation');
assert.ok(rateRulePatchErrors({ tax_rate: '45' }).tax_rate, 'partial patches still validate the keys they write');
assert.ok(
  rateRulePatchErrors({ seasonal_start: '2026-06-01' }).seasonal_end,
  'partial seasonal patches validate the pair',
);

const ruleSettings = await demoApi.adminSettings();
let invalidRulePatch = '';
try {
  await demoApi.adminSaveSettings({ tax_rate: '45' });
} catch (error) {
  invalidRulePatch = error.message;
}
assert.match(invalidRulePatch, /must be between 0 and 30/, 'the demo adapter rejects an invalid rate-rule patch');
assert.equal((await demoApi.adminSettings()).tax_rate, ruleSettings.tax_rate, 'a rejected patch leaves settings untouched');
await demoApi.adminSaveSettings({ tax_rate: ruleSettings.tax_rate });
log('rate rules: shared validation, patch scoping and adapter enforcement');

const { bookingPaymentState, bookingPaymentSummary, inrShort, localDay, longDate } = await import('../src/lib/format.js');
assert.equal(inrShort(-5000), '-₹5k', 'negative compact currency puts the sign before the symbol');
assert.equal(inrShort(99999), '₹100k', 'compact currency rounds up without a dangling decimal');
const utcStamp = '2026-07-01T19:30:00.000Z';
const utcLocal = new Date(utcStamp);
const utcLocalDay = `${utcLocal.getFullYear()}-${String(utcLocal.getMonth() + 1).padStart(2, '0')}-${String(utcLocal.getDate()).padStart(2, '0')}`;
assert.equal(localDay(utcStamp), utcLocalDay, 'a timestamp resolves to the local calendar day');
assert.equal(localDay('2026-07-01'), '2026-07-01', 'date-only strings pass through unchanged');
assert.equal(
  longDate(utcStamp),
  new Date(`${utcLocalDay}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
  'longDate accepts a raw timestamp instead of an Invalid Date',
);
assert.equal(
  bookingPaymentState({ paymentStatus: 'paid', balanceDue: 1200 }),
  'partially_paid',
  'an upward reprice shows part paid, not paid in full',
);
assert.equal(
  bookingPaymentState({ paymentStatus: 'paid', balanceDue: 0 }),
  'paid',
  'a fully settled booking stays paid',
);
assert.equal(
  bookingPaymentState({ paymentStatus: 'deposit_paid', balanceDue: 4000 }),
  'deposit_paid',
  'a deposit plan keeps its deposit label',
);
assert.equal(
  bookingPaymentState({ status: 'cancelled', paymentStatus: 'paid', balanceDue: 1200 }),
  'paid',
  'a closed booking does not show a settled balance as part paid',
);
assert.equal(
  bookingPaymentSummary({ status: 'confirmed', total: 5000, amountPaid: 6000, payments: [] }),
  'Paid ₹6,000 · ₹1,000 credit due',
  'a downward reprice surfaces the customer credit on the manage/account card',
);
assert.equal(
  bookingPaymentSummary({ status: 'cancelled', total: 5000, amountPaid: 6000, payments: [] }),
  'Paid ₹6,000',
  'a closed booking does not advertise a live credit',
);
log('payment state: stale paid status is shown as part paid when a balance remains');

// ---------------------------------------------------------------------------
// Notification preferences are enforced, not saved-and-forgotten
// ---------------------------------------------------------------------------
await demoApi.signIn('demo@rove.rent', 'demo123');
await demoApi.updateNotificationPreferences({ trip_updates: false });
const gatedBooking = (await demoApi.getMyBookings()).find((booking) => booking.status === 'confirmed');
assert.ok(gatedBooking, 'a confirmed booking exists to exercise the preference gate');
const gatedNotifsBefore = (await demoApi.myNotifications()).length;
await demoApi.signIn('admin@rove.rent', 'admin123');
const gatedEmailsBeforeList = (await demoApi.adminNotificationLog(500))
  .filter((entry) => entry.recipient === 'demo@rove.rent');
const gatedEmailsBefore = gatedEmailsBeforeList.length;
await demoApi.adminUpdateBooking({ bookingId: gatedBooking.id, status: 'active' });
await demoApi.signIn('demo@rove.rent', 'demo123');
assert.equal(
  (await demoApi.myNotifications()).length,
  gatedNotifsBefore,
  'an opted-out trip-update alert is not shown in-app',
);
await demoApi.signIn('admin@rove.rent', 'admin123');
const gatedEmailsAfterList = (await demoApi.adminNotificationLog(500))
  .filter((entry) => entry.recipient === 'demo@rove.rent');
assert.equal(gatedEmailsAfterList.length, gatedEmailsBefore, 'an opted-out trip-update email is not queued');
assert.equal(
  gatedEmailsAfterList.filter((entry) => entry.kind === 'booking_active').length,
  gatedEmailsBeforeList.filter((entry) => entry.kind === 'booking_active').length,
  'the trip-started email respects the trip-updates opt-out',
);
await demoApi.signIn('demo@rove.rent', 'demo123');
await demoApi.updateNotificationPreferences({ trip_updates: true });
log('notification preferences gate both the inbox and the email queue');

// ---------------------------------------------------------------------------
// Content console grouping
// ---------------------------------------------------------------------------
const {
  CONTENT_GROUP_META, CONTENT_GROUP_ORDER, contentGroupFor, groupContentKeys,
} = await import('../src/lib/contentGroups.js');
assert.equal(contentGroupFor('late_meter_title'), 'account', 'late-meter copy belongs to the customer account group');
assert.equal(contentGroupFor('late_fee_terms'), 'desk', 'late-fee terms belong to the handover desk group');
assert.equal(contentGroupFor('inbox_reply_title'), 'inbox', 'inbox composer copy has its own group');
assert.equal(contentGroupFor('bookings_status_filter'), 'bookings', 'bookings console copy has its own group');
assert.equal(contentGroupFor('drawer_discard_copy'), 'bookings', 'drawer copy is grouped with bookings');
assert.equal(contentGroupFor('dashboard_top_vehicles'), 'dashboard', 'dashboard copy has its own group');
assert.equal(contentGroupFor('default_meta_title'), 'seo', 'unknown keys fall back to SEO');
const grouped = groupContentKeys(PAGE_TEXT_KEYS);
const groupedKeys = grouped.flatMap((group) => group.keys);
assert.equal(groupedKeys.length, PAGE_TEXT_KEYS.length, 'every copy key lands in exactly one group');
assert.deepEqual([...groupedKeys].sort(), [...PAGE_TEXT_KEYS].sort(), 'grouping is lossless');
assert.ok(grouped.every((group) => CONTENT_GROUP_META[group.id]?.title), 'every rendered group has a heading');
assert.ok(grouped.every((group) => group.keys.length > 0), 'empty groups are dropped');
const groupIds = grouped.map((group) => group.id);
assert.equal(new Set(groupIds).size, groupIds.length, 'no group renders twice');
assert.equal(groupIds.at(-1), 'seo', 'the catch-all group renders last');
assert.ok(CONTENT_GROUP_ORDER.every((id) => CONTENT_GROUP_META[id]), 'every ordered group has metadata');
const seoOnly = grouped.find((group) => group.id === 'seo').keys;
assert.ok(seoOnly.every((key) => contentGroupFor(key) === 'seo'), 'SEO holds only true fallbacks');
log('content console groups every storefront key exactly once');

console.log('\nDemo API contract tests passed.\n');
