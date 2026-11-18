import { buildDemoState, DEMO_KEY, DEMO_VERSION } from './seed.js';
import { demoSettings } from './data.js';
import {
  calculateQuote,
  daysBetween,
  addDaysISO,
  isValidDate,
  isRentalTime,
  isWeekendISO,
  promoProblem,
  todayISO,
  ageFromDob,
} from '../lib/pricing.js';
import {
  ALLOWED_TRANSITIONS,
  BIKE_GEARS,
  BIKE_TYPES,
  FUELS_BY_KIND,
  KIND_LABELS,
  LICENSE_BY_KIND,
  TYPES_BY_KIND,
  VEHICLE_KINDS,
  VEHICLE_TYPES,
} from '../lib/constants.js';
import { computeAdminStats } from '../lib/stats.js';
import { cancellationRefund, getSiteContent, lateFeeTermsText, sitePolicy } from '../lib/site.js';
import { coordinatesProblem, isEmail, licenceExpiryProblem, normalizeCoordinates, phoneProblem, urlProblem } from '../lib/validation.js';
import { NOTIFICATION_PREF_KEYS, normalizeNotificationPrefs, shouldNotify, validNotificationPrefs } from '../lib/notifications.js';
import { DESK_CHECK_KEYS, deskCheckPayload } from '../lib/desk.js';
import { BULK_FLEET_STATUSES } from '../lib/fleetHealth.js';
import { availabilityBoard, markAlertNotified, vehicleFreeInWindow } from '../lib/availabilityAlerts.js';
import { EMAIL_TEMPLATE_KINDS, EMAIL_TEMPLATE_DEFAULTS, emailTemplateKey, emailTemplateLabel, renderTemplate, templateContent, templateFor, templatesForm } from '../lib/emailTemplates.js';
import { crmSummary, segmentCustomers } from '../lib/customers.js';
import { rateRulePatchErrors } from '../lib/rateRules.js';
import { RETURN_CHECK_KEYS, returnCheckPayload, settlementRecord, lateDays } from '../lib/returns.js';
import { inspectionProblems, normalizeInspection, returnCondition } from '../lib/inspection.js';
import {
  applyServiceEntry,
  maintenanceSummary,
  odometerProblem,
  serviceEntry,
} from '../lib/maintenance.js';
import { fleetDocProblems } from '../lib/fleetDocs.js';
import { kmDisclosure, kmTerms, kmVehicleProblems } from '../lib/km.js';
import { extendProblem, extensionsEnabled } from '../lib/extend.js';

let cache = null;

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowISO = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

const notify = (state, { audience, userId = null, kind, title, body = '', bookingCode = '', link = '' }) => {
  state.notifications = state.notifications ?? [];
  // Respect the recipient's saved preferences: an opt-out must actually stop
  // the alert, not just sit on the profile page.
  if (audience === 'user' && userId) {
    const recipient = state.users.find((item) => item.id === userId);
    if (recipient && !shouldNotify(kind, recipient.notifPrefs)) return;
  }
  state.notifications.push({
    id: uid('ntf'),
    audience, // 'user' | 'staff'
    userId,
    kind,
    title,
    body,
    bookingCode,
    link,
    readAt: null,
    createdAt: nowISO(),
  });
};

/**
 * Queue a transactional email for the notify dispatcher. Demo mode never sends
 * anything — rows stay queued so the contract tests can assert the pipeline.
 */
const queueEmail = (state, { kind = 'generic', email, subject, body = '', meta = {}, raw = false }) => {
  if (!email) return;
  // Same preference gate as in-app alerts: opt-outs apply to email too.
  const recipient = state.users.find((item) => String(item.email).toLowerCase() === String(email).toLowerCase());
  if (recipient && !shouldNotify(kind, recipient.notifPrefs)) return;
  state.notificationLog = state.notificationLog ?? [];
  const template = raw
    ? { subject: '', body: '', custom: false, subjectCustom: false, bodyCustom: false }
    : templateFor(state.settings, kind);
  const content = templateContent(template, { subject, body });
  const renderedSubject = renderTemplate(content.subject, meta);
  const renderedBody = renderTemplate(content.body, meta);
  state.notificationLog.push({
    id: uid('eml'),
    kind,
    channel: 'email',
    recipient: email,
    subject: renderedSubject,
    body: renderedBody,
    meta,
    status: 'queued',
    createdAt: nowISO(),
  });
};

const bookingEmailFor = (booking, state) => {
  if (!booking.userId) return booking.guestEmail || '';
  const owner = state.users.find((item) => item.id === booking.userId);
  return owner?.email || '';
};

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === DEMO_VERSION) {
        // Older demo snapshots predate blocks and audit history. Add the new
        // collections and settings in place instead of wiping demo data.
        parsed.vehicleBlocks ??= [];
        parsed.auditLogs ??= [];
        parsed.contactMessages ??= [];
        parsed.serviceLogs ??= [];
        parsed.checkoutAttempts ??= [];
        parsed.vehicles = (parsed.vehicles ?? []).map((vehicle) => ({
          ...vehicle,
          odometer: vehicle.odometer ?? (vehicle.kind === 'bike' ? 9000 : 24000),
          serviceIntervalKm: vehicle.serviceIntervalKm ?? (vehicle.kind === 'bike' ? 4000 : 10000),
          serviceIntervalDays: vehicle.serviceIntervalDays ?? (vehicle.kind === 'bike' ? 120 : 180),
          lastServiceDate: vehicle.lastServiceDate ?? null,
          lastServiceOdometer: vehicle.lastServiceOdometer ?? (vehicle.odometer ?? null),
        }));
        parsed.settings = { ...demoSettings, ...(parsed.settings ?? {}) };
        // Earlier demo builds wrote a fake authorised "hold" payment row for
        // every booking. The security deposit is due at pick-up, not charged
        // online, so remove those simulated rows and snapshot the policy on
        // each booking instead.
        parsed.payments = (parsed.payments ?? []).filter((payment) => payment.kind !== 'hold');
        parsed.bookings = (parsed.bookings ?? []).map((booking) => ({
          ...booking,
          holdAmount: booking.holdAmount ?? Number(parsed.settings.hold_amount ?? 0),
        }));
        cache = parsed;
        return cache;
      }
    }
  } catch {
    /* corrupted demo state: rebuild */
  }
  cache = buildDemoState();
  try {
    persist({ rollback: false });
  } catch {
    // The demo still works in memory when storage is unavailable.
  }
  return cache;
}

function persist({ rollback = true } = {}) {
  if (!cache) return;
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Demo state could not be saved', error);
    if (rollback) cache = null;
    throw new Error('Demo storage is full. Remove an uploaded image or reset the demo data, then try again.');
  }
}

function emitAuth() {
  window.dispatchEvent(new Event('rove:demo-auth'));
}

const publicUser = (user) => {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
};

function currentUser(state) {
  return state.users.find((user) => user.id === state.sessionUserId) ?? null;
}

const isStaff = (user) => Boolean(user && ['manager', 'admin'].includes(user.role) && user.status === 'active');
const isAdmin = (user) => Boolean(user && user.role === 'admin' && user.status === 'active');

function requireUser(state) {
  const user = currentUser(state);
  if (!user) throw new Error('Please sign in to continue.');
  if (user.status !== 'active') throw new Error('This account is suspended.');
  return user;
}

function requireStaff(state) {
  const user = requireUser(state);
  if (!isStaff(user)) throw new Error('This area is for Rove staff only.');
  return user;
}

function requireAdmin(state) {
  const user = requireUser(state);
  if (!isAdmin(user)) throw new Error('Super admin access is required.');
  return user;
}

const BLOCK_KINDS = ['maintenance', 'private', 'buffer', 'other'];

function blockForRange(state, vehicleId, startDate, endDate, excludeId = null) {
  return (state.vehicleBlocks ?? []).find((block) => (
    block.vehicleId === vehicleId
    && block.id !== excludeId
    && block.startDate < endDate
    && block.endDate > startDate
  )) ?? null;
}

function blockReason(block) {
  if (!block) return null;
  if (block.kind === 'maintenance') return 'This vehicle is scheduled for maintenance during those dates.';
  if (block.kind === 'private') return 'This vehicle is reserved for an internal booking during those dates.';
  if (block.kind === 'buffer') return 'This vehicle needs a turnaround buffer between rentals.';
  return 'This vehicle is unavailable for those dates.';
}

function recordAudit(state, {
  action,
  entityType,
  entityId = '',
  summary = '',
  metadata = {},
}) {
  const actor = currentUser(state);
  state.auditLogs ??= [];
  state.auditLogs.unshift({
    id: uid('aud'),
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? 'System',
    actorRole: actor?.role ?? 'system',
    action,
    entityType,
    entityId: String(entityId ?? ''),
    summary: summary || `${entityType} ${action}${entityId ? ` · ${entityId}` : ''}`,
    metadata,
    createdAt: nowISO(),
  });
  if (state.auditLogs.length > 1000) state.auditLogs.length = 1000;
}

function shapeVehicleBlock(block, state) {
  const vehicle = state.vehicles.find((item) => item.id === block.vehicleId);
  return {
    ...clone(block),
    vehicle: vehicle
      ? {
        id: vehicle.id,
        name: vehicle.name,
        brand: vehicle.brand,
        location: vehicle.location,
        imageUrl: vehicle.imageUrl,
      }
      : null,
  };
}

function shapeServiceLog(log, state) {
  const vehicle = state.vehicles.find((item) => item.id === log.vehicleId);
  return {
    ...clone(log),
    vehicle: vehicle
      ? {
        id: vehicle.id,
        name: vehicle.name,
        brand: vehicle.brand,
        kind: vehicle.kind,
        location: vehicle.location,
        imageUrl: vehicle.imageUrl,
        odometer: vehicle.odometer,
      }
      : null,
  };
}

function decorateVehicle(vehicle, state, userId = state.sessionUserId) {
  if (!vehicle) return null;
  const reviews = state.reviews.filter((review) => review.vehicleId === vehicle.id);
  const reviewsOff = state.settings.reviews_enabled === 'false';
  return {
    ...clone(vehicle),
    reviewCount: reviewsOff ? 0 : reviews.length,
    favorite: state.favorites.some((favorite) => favorite.userId === userId && favorite.vehicleId === vehicle.id),
    bookingCount: state.bookings.filter((booking) => booking.vehicleId === vehicle.id).length,
  };
}

function bookingExtras(state, keys = []) {
  return keys
    .map((key) => state.extras.find((extra) => extra.key === key))
    .filter(Boolean)
    .map((extra) => ({ key: extra.key, label: extra.label, pricePerDay: extra.pricePerDay }));
}

function shapeBooking(booking, state) {
  if (!booking) return null;
  const vehicle = state.vehicles.find((item) => item.id === booking.vehicleId);
  const user = booking.userId ? state.users.find((item) => item.id === booking.userId) : null;
  const tier = state.insuranceTiers.find((item) => item.key === booking.insurance) ?? state.insuranceTiers[0];
  const payments = state.payments
    .filter((payment) => payment.bookingId === booking.id && payment.kind !== 'hold')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const reviewed = state.reviews.some((review) => review.bookingId === booking.id);
  const pickupAt = new Date(`${booking.startDate}T${booking.pickupTime || '10:00'}:00+05:30`);

  return {
    id: booking.id,
    code: booking.code,
    vehicleId: booking.vehicleId,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    paymentPlan: booking.paymentPlan,
    changeRequest: booking.changeRequest ?? null,
    tripChanges: booking.tripChanges ?? [],
    deskChecks: booking.deskChecks ?? {},
    returnChecks: booking.returnChecks ?? {},
    inspection: booking.inspection ?? null,
    pickupInspection: booking.pickupInspection ?? null,
    pickupOdometer: booking.pickupOdometer ?? booking.pickupInspection?.odometer ?? null,
    returnOdometer: booking.returnOdometer ?? booking.inspection?.odometer ?? null,
    depositSettlement: booking.depositSettlement ?? null,
    depositCollected: booking.depositCollected ?? null,
    pickupLocation: booking.pickupLocation,
    dropoffLocation: booking.dropoffLocation,
    startDate: booking.startDate,
    endDate: booking.endDate,
    pickupTime: booking.pickupTime,
    dropoffTime: booking.dropoffTime,
    days: booking.days,
    extras: bookingExtras(state, booking.extras),
    extraKeys: booking.extras,
    insurance: {
      key: tier.key,
      label: tier.label,
      pricePerDay: tier.pricePerDay,
      deductible: tier.deductible,
      blurb: tier.blurb,
    },
    baseTotal: booking.baseTotal,
    extrasTotal: booking.extrasTotal,
    insuranceTotal: booking.insuranceTotal,
    oneWayFee: booking.oneWayFee,
    fees: booking.fees,
    taxRate: booking.taxRate ?? (Number(state.settings.tax_rate) || 0),
    taxInclusive: Boolean(booking.taxInclusive),
    // Legacy demo bookings predate the taxable split; `total - fees` is exact
    // for them because they never contained untaxed components.
    taxable: Number.isFinite(Number(booking.taxable))
      ? Number(booking.taxable)
      : Math.max(0, Number(booking.total || 0) - Number(booking.fees || 0)),
    untaxedTotal: Number(booking.untaxedTotal) || 0,
    discount: booking.discount,
    total: booking.total,
    depositDue: booking.depositDue,
    amountPaid: booking.amountPaid,
    balanceDue: Math.max(0, booking.total - booking.amountPaid),
    // Money the customer paid above the current total after a downward
    // reprice — owed back to them until staff refund it.
    creditDue: Math.max(0, (Number(booking.amountPaid) || 0) - (Number(booking.total) || 0)),
    promoCode: booking.promoCode,
    driver: { ...(booking.driver ?? {}), licenseExpiry: booking.driver?.licenseExpiry ?? null },
    notes: booking.notes,
    createdAt: booking.createdAt,
    cancelledAt: booking.cancelledAt,
    completedAt: booking.completedAt ?? null,
    pickupAt: `${booking.startDate}T${booking.pickupTime}:00`,
    holdAmount: Number(booking.holdAmount ?? state.settings.hold_amount ?? 0),
    kmCap: Number(booking.kmCap ?? vehicle?.kmCap ?? 0),
    kmExtraRate: Number(booking.kmExtraRate || vehicle?.kmExtraRate || 0),
    vehicle: {
      id: vehicle?.id,
      name: vehicle?.name,
      brand: vehicle?.brand,
      kind: vehicle?.kind,
      type: vehicle?.type,
      minAge: vehicle?.minAge,
      imageUrl: vehicle?.imageUrl,
      pricePerDay: vehicle?.pricePerDay,
      location: vehicle?.location,
      kmCap: Number(booking.kmCap ?? vehicle?.kmCap ?? 0),
      kmExtraRate: Number(booking.kmExtraRate || vehicle?.kmExtraRate || 0),
      registrationNumber: vehicle?.registrationNumber ?? '',
      insuranceExpiry: vehicle?.insuranceExpiry ?? null,
      pucExpiry: vehicle?.pucExpiry ?? null,
    },
    customer: {
      name: user?.name ?? booking.guestName,
      email: user?.email ?? booking.guestEmail,
      phone: user?.phone ?? booking.guestPhone,
      isGuest: !booking.userId,
    },
    reviewed,
    canCancel: ['pending', 'confirmed'].includes(booking.status) && pickupAt.getTime() > Date.now(),
    canReview: state.settings.reviews_enabled !== 'false'
      && booking.status === 'completed'
      && Boolean(booking.userId)
      && !reviewed,
    cancellationReason: booking.cancellationReason ?? '',
    cancelledBy: booking.cancelledBy ?? '',
    payments: payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      brand: payment.brand,
      last4: payment.last4,
      reference: payment.reference,
      createdAt: payment.createdAt,
    })),
  };
}

function accessBooking(state, { bookingId, code, email }) {
  const booking = state.bookings.find((item) => item.id === bookingId || item.code === String(code || '').toUpperCase());
  if (!booking) throw new Error('Booking not found.');
  const user = currentUser(state);
  const owner = user && booking.userId === user.id;
  const staff = isStaff(user);
  const guest = !booking.userId
    && email
    && String(email).toLowerCase() === String(booking.guestEmail).toLowerCase();
  if (!owner && !staff && !guest) {
    throw new Error(booking.userId
      ? 'This booking can only be cancelled from the account that made it.'
      : 'We could not find a booking with those details.');
  }
  return { booking, user, staff, owner };
}

function vehicleAvailable(state, vehicle, startDate, endDate, excludeId = null) {
  if (!vehicle || vehicle.status === 'maintenance') return false;
  if (blockForRange(state, vehicle.id, startDate, endDate)) return false;
  return !state.bookings.some((booking) => (
    booking.vehicleId === vehicle.id
    && booking.id !== excludeId
    && ['pending', 'confirmed', 'active'].includes(booking.status)
    && booking.startDate < endDate
    && booking.endDate > startDate
  ));
}

function findPromo(state, code, days, isFirstBooking = true) {
  if (!code) return null;
  const promo = state.promos.find((item) => item.code === String(code).trim().toUpperCase());
  if (!promo) throw new Error('That promo code does not exist.');
  const problem = promoProblem(promo, days, { isFirstBooking });
  if (problem) throw new Error(problem);
  return promo;
}

function buildQuote(state, payload, { skipValidation = false } = {}) {
  const vehicle = state.vehicles.find((item) => item.id === payload.vehicleId);
  if (!vehicle) throw new Error('Vehicle not found.');
  if (vehicle.kind === 'bike' && state.settings.bikes_enabled === 'false') {
    throw new Error('Two-wheelers are temporarily unavailable. Browse our cars instead.');
  }
  const startDate = String(payload.startDate);
  const endDate = String(payload.endDate);
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    throw new Error('Please choose valid pick-up and drop-off dates.');
  }
  const days = daysBetween(startDate, endDate);
  if (days < 1) throw new Error('Drop-off must be after pick-up.');
  // A "first booking" promo is only for customers with no completed trip yet.
  const signedIn = currentUser(state);
  const isFirstBooking = !signedIn || !state.bookings.some((booking) => (
    booking.userId === signedIn.id && booking.status === 'completed'
  ));
  const promo = findPromo(state, payload.promoCode, days, isFirstBooking);
  const quote = calculateQuote({
    vehicle,
    startDate,
    endDate,
    extras: payload.extras ?? [],
    extrasCatalog: state.extras.filter((extra) => extra.active),
    insuranceTiers: state.insuranceTiers,
    insurance: payload.insurance ?? 'basic',
    promo,
    settings: state.settings,
    pickupLocation: payload.pickupLocation || vehicle.location,
    dropoffLocation: payload.dropoffLocation || vehicle.location,
    paymentPlan: payload.paymentPlan === 'deposit' ? 'deposit' : 'full',
    skipValidation,
  });
  const block = blockForRange(state, vehicle.id, startDate, endDate);
  // A customer changing their own trip must not be blocked by the booking
  // they are changing. The checkout/booking guard still checks every row.
  const available = !block && vehicleAvailable(state, vehicle, startDate, endDate, payload.excludeBookingId || null);
  return {
    quote,
    available,
    unavailableReason: vehicle.status === 'maintenance'
      ? `This ${vehicle.kind === 'bike' ? 'bike' : 'car'} is currently in service. Please choose another vehicle.`
      : block
        ? blockReason(block)
        : available ? null : 'Those dates are already booked. Try different dates or another vehicle.',
    vehicle: decorateVehicle(vehicle, state),
    promo,
  };
}

function validateDraft(draft, state) {
  if (!draft.agreedTerms || !draft.agreedLicense) {
    throw new Error('Please accept the rental terms and licence verification notice.');
  }
  const signedIn = currentUser(state);
  if (signedIn && signedIn.status !== 'active') {
    throw new Error('This account is suspended. Contact support to continue.');
  }
  if (!signedIn && state.settings.guest_checkout_enabled === 'false') {
    throw new Error('Please sign in to continue — guest checkout is currently unavailable.');
  }
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if ((draft.pickupTime && !timeRe.test(String(draft.pickupTime)))
    || (draft.dropoffTime && !timeRe.test(String(draft.dropoffTime)))) {
    throw new Error('Pick-up and drop-off times are required.');
  }
  if (!draft.pickupLocation || !draft.dropoffLocation) {
    throw new Error('Pick-up and drop-off locations are required.');
  }
  if (String(state.settings?.one_way_enabled ?? 'true') === 'false'
    && draft.pickupLocation !== draft.dropoffLocation) {
    throw new Error('One-way rentals are switched off — pick up and drop off at the same hub.');
  }
  const driver = draft.driver || {};
  if (!driver.name || driver.name.trim().length < 2) throw new Error('Please enter the driver full name.');
  if (!isEmail(driver.email)) throw new Error('Please enter a valid email address.');
  const phoneError = phoneProblem(driver.phone, { required: true });
  if (phoneError) throw new Error(phoneError);
  if (!driver.license || driver.license.trim().length < 4) throw new Error('Please enter a valid licence number.');
  if (!isValidDate(driver.dob || '')) throw new Error('Please enter the driver date of birth.');
  const policy = sitePolicy(state.settings);
  const vehicle = state.vehicles.find((item) => item.id === draft.vehicleId);
  const bike = vehicle?.kind === 'bike';
  const minAge = Math.max(
    bike ? policy.minBikeAge : policy.minAge,
    Number(vehicle?.minAge) || 0,
  );
  const age = ageFromDob(driver.dob);
  if (age === null || age < minAge) {
    throw new Error(`${bike ? 'Riders' : 'Drivers'} must be at least ${minAge} years old.`);
  }
  if (age > 85) throw new Error('Please contact us directly for drivers over 85.');
  // The licence must stay valid for the whole rental. Enforced once here so a
  // promise made at checkout cannot be edited around later by another form.
  const licenceProblem = licenceExpiryProblem(
    driver,
    { endDate: draft.endDate },
    { policy },
  );
  if (licenceProblem) throw new Error(licenceProblem);
}

function refundBooking(state, booking, amount, kind = 'refund') {
  if (amount <= 0) return 0;
  state.payments.push({
    id: uid('pay'),
    bookingId: booking.id,
    kind,
    amount,
    currency: 'INR',
    status: 'refunded',
    brand: 'Visa',
    last4: '4242',
    reference: uid('refund_demo'),
    orderId: booking.razorpayOrderId,
    createdAt: nowISO(),
  });
  return amount;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getSession() {
  const state = load();
  return { user: publicUser(currentUser(state)) };
}

function onAuthStateChange(callback) {
  const handler = () => callback();
  window.addEventListener('rove:demo-auth', handler);
  return () => window.removeEventListener('rove:demo-auth', handler);
}

async function signIn(email, password) {
  const state = load();
  const user = state.users.find((item) => item.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user || user.password !== password) throw new Error('Incorrect email or password.');
  if (user.status !== 'active') {
    throw new Error(`This account is suspended. Contact ${state.settings.support_email || 'support'} for help.`);
  }
  state.sessionUserId = user.id;
  persist();
  emitAuth();
  return publicUser(user);
}

async function signUp({ name, email, password, phone = '' }) {
  const state = load();
  if (!name || name.trim().length < 2) throw new Error('Please enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '')) throw new Error('Please enter a valid email address.');
  const phoneError = phoneProblem(phone);
  if (phoneError) throw new Error(phoneError);
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (state.users.some((user) => user.email.toLowerCase() === email.trim().toLowerCase())) {
    throw new Error('An account with that email already exists.');
  }
  const user = {
    id: uid('usr'),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
    role: 'customer',
    status: 'active',
    phone: phone.trim(),
    licenseNumber: '',
    cardBrand: '',
    cardLast4: '',
    createdAt: nowISO(),
    bookings: 0,
    spend: 0,
  };
  state.users.push(user);
  state.sessionUserId = user.id;
  persist();
  emitAuth();
  return publicUser(user);
}

async function signOut() {
  const state = load();
  state.sessionUserId = null;
  persist();
  emitAuth();
}

async function updateProfile(patch) {
  const state = load();
  const user = requireUser(state);
  if (patch.name !== undefined) {
    const name = String(patch.name ?? '').trim();
    if (name.length < 2) throw new Error('Please enter your full name.');
    user.name = name.slice(0, 80);
  }
  if (patch.phone !== undefined) {
    const phone = String(patch.phone ?? '').trim();
    const phoneError = phoneProblem(phone);
    if (phoneError) throw new Error(phoneError);
    user.phone = phone.slice(0, 32);
  }
  if (patch.licenseNumber !== undefined) {
    const license = String(patch.licenseNumber ?? '').trim();
    if (license && license.length < 4) throw new Error('Please enter a valid licence number.');
    user.licenseNumber = license.slice(0, 40);
  }
  persist();
  emitAuth();
  return publicUser(user);
}

async function getNotificationPreferences() {
  const state = load();
  const user = requireUser(state);
  return normalizeNotificationPrefs(user.notifPrefs);
}

async function updateNotificationPreferences(prefs = {}) {
  const state = load();
  const user = requireUser(state);
  if (!validNotificationPrefs(prefs)) throw new Error('Invalid notification preference.');
  user.notifPrefs = { ...normalizeNotificationPrefs(user.notifPrefs), ...prefs };
  persist();
  emitAuth();
  return { ...user.notifPrefs };
}

async function sendPasswordReset(email) {
  const state = load();
  const exists = state.users.some((user) => user.email.toLowerCase() === String(email).trim().toLowerCase());
  return {
    message: exists
      ? 'Demo mode: password reset emails are not sent. Use the demo account buttons or create a new account.'
      : 'If that email is registered, a reset link is on its way.',
    demo: true,
  };
}

async function updatePassword() {
  return { ok: true, demo: true };
}

async function resetDemoData() {
  localStorage.removeItem(DEMO_KEY);
  cache = buildDemoState();
  persist();
  emitAuth();
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

async function getMeta() {
  const state = load();
  return {
    types: VEHICLE_TYPES,
    bikeTypes: BIKE_TYPES,
    kinds: VEHICLE_KINDS,
    kindLabels: KIND_LABELS,
    typesByKind: TYPES_BY_KIND,
    fuelsByKind: FUELS_BY_KIND,
    bikeGears: BIKE_GEARS,
    licenseByKind: LICENSE_BY_KIND,
    locations: clone(state.locations).filter((location) => location.active).sort((a, b) => a.name.localeCompare(b.name)),
    extras: clone(state.extras).filter((extra) => extra.active),
    insuranceTiers: clone(state.insuranceTiers).filter((tier) => tier.active),
    settings: clone(state.settings),
    currency: 'INR',
  };
}

async function listVehicles(filters = {}) {
  const state = load();
  const {
    q, type, kind, gears, engineCc, helmetCount, location, transmission, fuel, seats,
    minPrice, maxPrice, awd, sort = 'recommended', from, to,
  } = filters;

  const bikesEnabled = state.settings.bikes_enabled !== 'false';
  let vehicles = state.vehicles.filter((vehicle) => vehicle.status !== 'maintenance');
  if (!bikesEnabled) vehicles = vehicles.filter((vehicle) => vehicle.kind !== 'bike');
  const types = Array.isArray(type) ? type : String(type || '').split(',').filter(Boolean);
  const fuels = Array.isArray(fuel) ? fuel : String(fuel || '').split(',').filter(Boolean);
  const kinds = Array.isArray(kind) ? kind : String(kind || '').split(',').filter(Boolean);
  const gearList = Array.isArray(gears) ? gears : String(gears || '').split(',').filter(Boolean);

  if (q) {
    const needle = String(q).toLowerCase();
    vehicles = vehicles.filter((vehicle) => (
      `${vehicle.name} ${vehicle.brand} ${vehicle.type} ${vehicle.location}`.toLowerCase().includes(needle)
    ));
  }
  if (types.length) vehicles = vehicles.filter((vehicle) => types.includes(vehicle.type));
  if (location) vehicles = vehicles.filter((vehicle) => vehicle.location === location);
  if (transmission) vehicles = vehicles.filter((vehicle) => vehicle.transmission === transmission);
  if (fuels.length) vehicles = vehicles.filter((vehicle) => fuels.includes(vehicle.fuel));
  if (kinds.length) vehicles = vehicles.filter((vehicle) => kinds.includes(vehicle.kind ?? 'car'));
  if (gearList.length) vehicles = vehicles.filter((vehicle) => gearList.includes(vehicle.gears));
  if (engineCc) {
    const minCc = Number(engineCc);
    if (Number.isFinite(minCc)) vehicles = vehicles.filter((vehicle) => Number(vehicle.engineCc) >= minCc);
  }
  if (helmetCount) {
    const minHelmets = Number(helmetCount);
    if (Number.isFinite(minHelmets)) vehicles = vehicles.filter((vehicle) => Number(vehicle.helmetCount ?? 0) >= minHelmets);
  }
  if (seats) vehicles = vehicles.filter((vehicle) => vehicle.seats >= Number(seats));
  if (minPrice) vehicles = vehicles.filter((vehicle) => vehicle.pricePerDay >= Number(minPrice));
  if (maxPrice) vehicles = vehicles.filter((vehicle) => vehicle.pricePerDay <= Number(maxPrice));
  if (String(awd) === 'true') vehicles = vehicles.filter((vehicle) => vehicle.awd);

  if (from && to && isValidDate(from) && isValidDate(to) && from < to) {
    vehicles = vehicles.filter((vehicle) => vehicleAvailable(state, vehicle, from, to));
  }

  const sorters = {
    'price-asc': (a, b) => a.pricePerDay - b.pricePerDay,
    'price-desc': (a, b) => b.pricePerDay - a.pricePerDay,
    rating: (a, b) => b.rating - a.rating,
    newest: (a, b) => b.year - a.year,
    recommended: (a, b) => b.rating - a.rating || b.trips - a.trips,
  };
  vehicles = [...vehicles].sort(sorters[sort] || sorters.recommended);

  const priceUniverse = state.vehicles
    .filter((vehicle) => vehicle.status !== 'maintenance')
    .filter((vehicle) => bikesEnabled || vehicle.kind !== 'bike')
    .filter((vehicle) => (kinds.length ? kinds.includes(vehicle.kind ?? 'car') : true))
    .map((vehicle) => vehicle.pricePerDay);
  const prices = priceUniverse.length ? priceUniverse : [0];
  return {
    vehicles: vehicles.map((vehicle) => decorateVehicle(vehicle, state)),
    total: vehicles.length,
    priceBounds: { min: Math.min(...prices), max: Math.max(...prices) },
  };
}

async function vehicleDayRates(vehicleId, from, to) {
  const state = load();
  const vehicle = state.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) throw new Error('Vehicle not found.');
  if (vehicle.kind === 'bike' && state.settings.bikes_enabled === 'false') {
    throw new Error('Two-wheelers are temporarily unavailable. Browse our cars instead.');
  }
  const settings = state.settings;
  const weekendMultiplier = Number(settings.weekend_multiplier) || 1;
  const seasonalMultiplier = Number(settings.seasonal_multiplier) || 1;
  const seasonalStart = String(settings.seasonal_start || '');
  const seasonalEnd = String(settings.seasonal_end || '');
  const start = !isValidDate(from) || from < todayISO() ? todayISO() : from;
  const end = !isValidDate(to) || to < start ? start : to;
  const days = Math.min(90, Math.max(0, daysBetween(start, end)));
  const rows = [];
  for (let index = 0; index <= days; index += 1) {
    const date = addDaysISO(start, index);
    const weekend = isWeekendISO(date);
    const seasonal = Boolean(seasonalStart && seasonalEnd && date >= seasonalStart && date <= seasonalEnd);
    const multiplier = Math.max(weekend ? weekendMultiplier : 1, seasonal ? seasonalMultiplier : 1);
    rows.push({ date, rate: Math.round(vehicle.pricePerDay * multiplier), weekend, seasonal });
  }
  return rows;
}

async function getVehicle(id) {
  const state = load();
  const vehicle = state.vehicles.find((item) => item.id === id);
  if (!vehicle) throw new Error('Vehicle not found.');
  if (vehicle.kind === 'bike' && state.settings.bikes_enabled === 'false') {
    throw new Error('Two-wheelers are temporarily unavailable. Browse our cars instead.');
  }
  const reviews = state.settings.reviews_enabled === 'false' ? [] : state.reviews
    .filter((review) => review.vehicleId === id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((review) => ({
      id: review.id,
      author: review.author,
      rating: review.rating,
      comment: review.comment,
      reply: state.settings.review_replies_enabled === 'false' ? null : (review.reply ?? null),
      repliedAt: state.settings.review_replies_enabled === 'false' ? null : (review.repliedAt ?? null),
      createdAt: review.createdAt,
    }));
  const upcomingBookings = state.bookings
    .filter((booking) => booking.vehicleId === id
      && ['pending', 'confirmed', 'active'].includes(booking.status)
      && booking.endDate >= todayISO())
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((booking) => ({ startDate: booking.startDate, endDate: booking.endDate }));
  const upcomingBlocks = (state.vehicleBlocks ?? [])
    .filter((block) => block.vehicleId === id && block.endDate >= todayISO())
    .map((block) => ({ startDate: block.startDate, endDate: block.endDate, reason: block.kind }));
  return {
    vehicle: decorateVehicle(vehicle, state),
    reviews,
    upcoming: [...upcomingBlocks, ...upcomingBookings].slice(0, 40).sort((a, b) => a.startDate.localeCompare(b.startDate)),
  };
}

async function quote(payload) {
  const state = load();
  // Extension previews quote a trip that has already started, so the past-date
  // guard must be skippable here. The server-authoritative extendTrip path
  // re-validates everything before anything is persisted.
  const result = buildQuote(state, payload, { skipValidation: Boolean(payload?.skipValidation) });
  return {
    quote: result.quote,
    available: result.available,
    unavailableReason: result.unavailableReason,
    vehicle: result.vehicle,
    kind: result.vehicle?.kind ?? 'car',
    bikeDetails: result.vehicle?.kind === 'bike'
      ? {
        engineCc: result.vehicle.engineCc,
        mileage: result.vehicle.mileage,
        gears: result.vehicle.gears,
        helmetCount: result.vehicle.helmetCount,
        licenseClass: result.vehicle.licenseClass,
        minAge: result.vehicle.minAge,
      }
      : null,
  };
}

async function toggleFavorite(vehicleId) {
  const state = load();
  const user = requireUser(state);
  const index = state.favorites.findIndex((favorite) => favorite.userId === user.id && favorite.vehicleId === vehicleId);
  if (index >= 0) state.favorites.splice(index, 1);
  else state.favorites.push({ userId: user.id, vehicleId });
  persist();
  return { favorite: index < 0 };
}

async function getFavorites() {
  const state = load();
  const user = requireUser(state);
  const bikesOff = state.settings.bikes_enabled === 'false';
  const vehicles = state.favorites
    .filter((favorite) => favorite.userId === user.id)
    .map((favorite) => state.vehicles.find((vehicle) => vehicle.id === favorite.vehicleId))
    .filter((vehicle) => vehicle && vehicle.status !== 'maintenance')
    .filter((vehicle) => !bikesOff || vehicle.kind !== 'bike');
  return vehicles.map((vehicle) => decorateVehicle(vehicle, state));
}

// ---------------------------------------------------------------------------
// Bookings & payments
// ---------------------------------------------------------------------------

async function getMyBookings() {
  const state = load();
  const user = requireUser(state);
  const bookings = state.bookings
    .filter((booking) => booking.userId === user.id)
    .map((booking) => shapeBooking(booking, state));
  const order = { active: 0, confirmed: 1, pending: 2 };
  return bookings.sort((a, b) => {
    const rank = (order[a.status] ?? 3) - (order[b.status] ?? 3);
    if (rank !== 0) return rank;
    return String(b.startDate).localeCompare(String(a.startDate));
  });
}

async function getBooking(code, email = null) {
  const state = load();
  const booking = state.bookings.find((item) => item.code === String(code).toUpperCase());
  // Same message whether the code is unknown or the email is wrong: revealing
  // which half matched would turn this into a booking-code oracle.
  const miss = new Error('We could not find a booking with that code and email.');
  if (!booking) throw miss;
  const user = currentUser(state);
  const owner = booking.userId ? state.users.find((item) => item.id === booking.userId) : null;
  const bookingEmail = owner?.email || booking.guestEmail || '';
  const privileged = isStaff(user)
    || (user && booking.userId === user.id)
    || (email && String(email).toLowerCase() === String(bookingEmail).toLowerCase());
  if (!privileged) throw miss;
  return shapeBooking(booking, state);
}

async function lookupBooking(code, email) {
  return getBooking(code, email);
}

async function beginPayment(draft) {
  const state = load();
  validateDraft(draft, state);
  const result = buildQuote(state, draft);
  if (!result.available) throw new Error(result.unavailableReason || 'Those dates are not available.');
  // A checkout intent is the seed of a sale. Record it the moment the customer
  // opens payment so the admin "checkout recovery" widget can follow up on
  // those who never complete it. confirmPayment marks it converted.
  state.checkoutAttempts ??= [];
  state.checkoutAttempts.push({
    id: uid('chk'),
    vehicleId: draft.vehicleId,
    vehicleName: result.vehicle?.name ?? '',
    startDate: draft.startDate,
    endDate: draft.endDate,
    amountDue: result.quote.amountDue,
    total: result.quote.total,
    createdAt: nowISO(),
  });
  persist();
  return {
    demo: true,
    available: true,
    keyId: null,
    orderId: `order_demo_${Date.now()}`,
    amount: Math.round(result.quote.amountDue * 100),
    currency: 'INR',
    quote: result.quote,
    paymentPlan: draft.paymentPlan,
  };
}

async function confirmPayment({ draft, payment = {} }) {
  const state = load();
  const reference = String(payment.reference ?? '');
  if (reference) {
    const existingPayment = state.payments.find((item) => item.reference === reference);
    const existingBooking = existingPayment && state.bookings.find((item) => item.id === existingPayment.bookingId);
    if (existingBooking) {
      return { code: existingBooking.code, booking: shapeBooking(existingBooking, state), alreadyProcessed: true };
    }
  }
  validateDraft(draft, state);
  const result = buildQuote(state, draft);
  if (!result.available) throw new Error(result.unavailableReason || 'Those dates are not available.');
  if (vehicleAvailable(state, state.vehicles.find((vehicle) => vehicle.id === draft.vehicleId), draft.startDate, draft.endDate) === false) {
    throw new Error('Those dates were just booked. Please choose different dates.');
  }

  const user = currentUser(state);
  const { quote: priced } = result;
  const plan = draft.paymentPlan === 'deposit' ? 'deposit' : 'full';
  const autoConfirm = state.settings.booking_auto_confirm !== 'false';
  const bookingStatus = autoConfirm ? 'confirmed' : 'pending';
  const amountPaid = plan === 'deposit' ? priced.depositDue : priced.total;
  const promo = result.promo;
  const code = `RV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const booking = {
    id: uid('bkg'),
    code,
    userId: user?.id ?? null,
    guestName: user ? '' : draft.driver.name,
    guestEmail: user ? '' : draft.driver.email,
    guestPhone: user ? '' : draft.driver.phone,
    vehicleId: draft.vehicleId,
    pickupLocation: draft.pickupLocation,
    dropoffLocation: draft.dropoffLocation,
    startDate: draft.startDate,
    endDate: draft.endDate,
    pickupTime: draft.pickupTime,
    dropoffTime: draft.dropoffTime,
    days: priced.days,
    extras: priced.extras.map((extra) => extra.key),
    insurance: priced.insurance.key,
    baseTotal: priced.baseTotal,
    extrasTotal: priced.extrasTotal,
    insuranceTotal: priced.insuranceTotal,
    oneWayFee: priced.oneWayFee,
    fees: priced.fees,
    taxRate: priced.taxRate,
    taxInclusive: priced.taxInclusive,
    taxable: priced.taxable,
    untaxedTotal: priced.untaxedTotal,
    discount: priced.discount,
    total: priced.total,
    depositDue: priced.depositDue,
    holdAmount: Number(state.settings.hold_amount ?? 0),
    // Snapshot the allowance the customer was quoted. Repricing a vehicle
    // later must not silently change the terms of an existing booking.
    kmCap: Number(result.vehicle?.kmCap ?? 0),
    kmExtraRate: Number(result.vehicle?.kmExtraRate ?? 0),
    amountPaid,
    promoCode: priced.promoApplied?.code ?? '',
    paymentPlan: plan,
    paymentStatus: plan === 'deposit' ? 'deposit_paid' : 'paid',
    status: bookingStatus,
    driver: { ...draft.driver },
    notes: draft.notes ?? '',
    createdAt: nowISO(),
    razorpayOrderId: `order_demo_${Date.now()}`,
  };
  state.bookings.push(booking);
  state.payments.push({
    id: uid('pay'),
    bookingId: booking.id,
    kind: plan === 'deposit' ? 'deposit' : 'payment',
    amount: amountPaid,
    currency: 'INR',
    status: 'succeeded',
    brand: payment.brand ?? 'Visa',
    last4: payment.last4 ?? '4242',
    reference: payment.reference ?? uid('pay_demo'),
    orderId: booking.razorpayOrderId,
    createdAt: booking.createdAt,
  });
  if (promo) promo.usedCount += 1;
  if (user) {
    user.cardBrand = payment.brand ?? 'Visa';
    user.cardLast4 = payment.last4 ?? '4242';
  }
  recordAudit(state, {
    action: 'insert',
    entityType: 'bookings',
    entityId: booking.code,
    summary: autoConfirm ? `Booking ${booking.code} confirmed` : `Booking ${booking.code} received for approval`,
    metadata: { changed: { status: { from: null, to: bookingStatus } } },
  });
  if (user) {
    notify(state, {
      audience: 'user', userId: user.id, kind: autoConfirm ? 'booking_confirmed' : 'booking_pending',
      title: autoConfirm ? 'Booking confirmed' : 'Booking received',
      body: autoConfirm
        ? `Your ${booking.code} voucher is ready.`
        : `Payment received. We will confirm ${booking.code} shortly.`,
      bookingCode: booking.code,
      link: `/confirmation/${booking.code}`,
    });
  }
  notify(state, {
    audience: 'staff', kind: 'booking_new',
    title: `New booking ${booking.code}`,
    body: `${booking.days} day${booking.days === 1 ? '' : 's'} · ₹${priced.total} ${autoConfirm ? 'confirmed' : 'awaiting approval'}`,
    bookingCode: booking.code,
    link: '/admin/bookings',
  });
  const content = getSiteContent(state.settings);
  const km = kmDisclosure({ kmCap: booking.kmCap, kmExtraRate: booking.kmExtraRate });
  const kmText = `Kilometres: ${km.label}.`;
  const lateText = lateFeeTermsText(content.late_fee_terms, content.policy);
  queueEmail(state, {
    kind: autoConfirm ? 'booking_confirmed' : 'booking_pending',
    email: bookingEmailFor(booking, state),
    subject: autoConfirm
      ? `Your Rove booking ${booking.code} is confirmed`
      : `We have received your Rove booking ${booking.code}`,
    body: [
      autoConfirm
        ? `Hi, your ${priced.days}-day rental is confirmed.`
        : `Hi, we have received your ${priced.days}-day rental payment. Our team will confirm it shortly.`,
      `Booking ${booking.code} · ${priced.days} days · ₹${priced.total.toLocaleString('en-IN')} (${plan} payment, tax included).`,
      `Pick-up: ${booking.pickupLocation} on ${booking.startDate}. For any changes, sign in at the Rove site.`,
      // Terms the customer is held to at drop-off belong on the confirmation,
      // not only on the checkout page they have already left.
      kmText,
      lateText,
    ].join('\n'),
    meta: {
      code: booking.code,
      name: user?.name || booking.guestName || booking.driver?.name || 'there',
      dates: `${booking.startDate} – ${booking.endDate}`,
      // `{amount}` in the confirmation template means the deposit taken at
      // pick-up, not the rental total the customer has already paid.
      amount: `₹${priced.depositDue.toLocaleString('en-IN')}`,
      hub: booking.pickupLocation,
      time: booking.pickupTime || '10:00',
      status: bookingStatus,
      // Available to admin-edited templates as {km} / {late}.
      km: kmText,
      late: lateText,
      startDate: booking.startDate,
      endDate: booking.endDate,
      total: priced.total,
    },
  });
  persist();
  emitAuth();
  // Mark the matching checkout intent as converted so the recovery widget
  // stops chasing a customer who already booked.
  if (state.checkoutAttempts) {
    const attempt = state.checkoutAttempts
      .filter((item) => item && !item.convertedAt && item.vehicleId === booking.vehicleId
        && item.startDate === booking.startDate && item.endDate === booking.endDate
        && Number(item.amountDue ?? 0) === Number(priced.amountDue ?? 0))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (attempt) {
      attempt.convertedAt = nowISO();
      attempt.bookingCode = code;
      persist();
    }
  }
  return { code, booking: shapeBooking(booking, state) };
}

async function cancelBooking({ bookingId, code, email, reason }) {
  const state = load();
  const { booking, staff, owner } = accessBooking(state, { bookingId, code, email });
  if (booking.status === 'cancelled') throw new Error('This booking is already cancelled.');
  if (!staff && !owner && !email) throw new Error('Please verify your email to cancel.');
  if (!staff && !['pending', 'confirmed'].includes(booking.status)) {
    throw new Error('This rental can no longer be cancelled online. Contact support.');
  }
  if (!staff && booking.startDate < todayISO()) {
    throw new Error('This rental has already started. Contact support for help.');
  }
  const pickupAt = new Date(`${booking.startDate}T${booking.pickupTime || '10:00'}:00+05:30`);
  if (!staff && pickupAt.getTime() <= Date.now()) {
    throw new Error('This rental has already started. Contact support for help.');
  }

  const paid = Number(booking.amountPaid) || 0;
  const outcome = cancellationRefund(booking, paid, state.settings);
  const refundAmount = staff ? paid : outcome.refundAmount;
  const remaining = Math.max(0, paid - refundAmount);
  const paidStatus = ['paid', 'deposit_paid', 'partially_refunded', 'refunded'].includes(booking.paymentStatus)
    ? booking.paymentStatus
    : 'paid';

  booking.status = 'cancelled';
  booking.cancelledAt = nowISO();
  booking.cancellationReason = String(reason || (staff ? 'Cancelled by Rove staff' : 'Customer cancellation')).trim().slice(0, 240);
  booking.cancelledBy = staff ? 'staff' : 'customer';
  booking.amountPaid = remaining;
  // Only call it a refund when money actually moved back. A non-refundable
  // cancellation keeps its paid status, and an unpaid booking stays unpaid.
  booking.paymentStatus = refundAmount <= 0
    ? (paid > 0 ? paidStatus : 'unpaid')
    : remaining === 0 ? 'refunded' : 'partially_refunded';
  if (refundAmount > 0) refundBooking(state, booking, refundAmount);
  recordAudit(state, {
    action: 'update',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Booking ${booking.code} cancelled`,
    metadata: { changed: { status: { from: 'confirmed', to: 'cancelled' }, refundAmount: { from: null, to: refundAmount } } },
  });
  if (booking.userId) {
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'booking_cancelled',
      title: 'Booking cancelled',
      body: refundAmount > 0
        ? `A refund of ₹${refundAmount.toLocaleString('en-IN')} is on its way.`
        : paid > 0 ? 'No refund is due under the cancellation policy.' : 'No payment was captured.',
      bookingCode: booking.code,
      link: `/confirmation/${booking.code}`,
    });
  }
  notify(state, {
    audience: 'staff', kind: 'booking_cancelled',
    title: `Booking ${booking.code} cancelled`,
    body: `${staff ? 'Cancelled by Rove' : 'Cancelled by customer'}${refundAmount > 0 ? ` · ₹${refundAmount} refunded` : ''}`,
    bookingCode: booking.code,
    link: '/admin/bookings',
  });
  queueEmail(state, {
    kind: 'booking_cancelled',
    email: bookingEmailFor(booking, state),
    subject: `Your Rove booking ${booking.code} was cancelled`,
    body: [
      `Booking ${booking.code} is now cancelled.`,
      refundAmount > 0
        ? `A refund of ₹${refundAmount.toLocaleString('en-IN')} is being returned to the original payment method.`
        : 'No refund is due under the cancellation policy.',
    ].join('\n'),
    meta: { code: booking.code, refundAmount },
  });
  dispatchAvailabilityAlerts(state, {
    vehicleId: booking.vehicleId,
    reason: `Booking ${booking.code} was cancelled`,
  });
  persist();

  return {
    refundAmount,
    booking: shapeBooking(booking, state),
    message: refundAmount > 0
      ? `Booking cancelled. ₹${refundAmount.toLocaleString('en-IN')} (${staff ? 100 : outcome.percent}%) will be refunded to your original payment method.`
      : paid > 0
        ? 'Booking cancelled. No refund is due under the cancellation policy.'
        : 'Booking cancelled. No payment was captured.',
  };
}

async function myNotifications() {
  const state = load();
  const user = requireUser(state);
  return (state.notifications ?? [])
    .filter((item) => item.audience === 'user' && item.userId === user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 40);
}

async function unreadNotificationCount() {
  const state = load();
  const user = currentUser(state);
  if (!user) return 0;
  return (state.notifications ?? []).filter((item) => item.audience === 'user' && item.userId === user.id && !item.readAt).length;
}

async function markNotificationRead(id) {
  const state = load();
  const user = requireUser(state);
  const item = (state.notifications ?? []).find((notification) => notification.id === id && notification.audience === 'user' && notification.userId === user.id);
  if (item) item.readAt = nowISO();
  persist();
  return true;
}

async function markAllNotificationsRead() {
  const state = load();
  const user = requireUser(state);
  (state.notifications ?? [])
    .filter((item) => item.audience === 'user' && item.userId === user.id && !item.readAt)
    .forEach((item) => { item.readAt = nowISO(); });
  persist();
  return true;
}

async function staffNotifications(limit = 8) {
  const state = load();
  requireStaff(state);
  return (state.notifications ?? [])
    .filter((item) => item.audience === 'staff')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

async function adminNotificationLog(limit = 20) {
  const state = load();
  requireStaff(state);
  const capped = Math.min(Math.max(1, Math.round(Number(limit) || 20)), 500);
  return [...(state.notificationLog ?? [])]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, capped)
    .map((item) => ({ ...item, meta: item.meta ?? {} }));
}

/**
 * Queue a fresh copy of an email. The original log row is delivery history and
 * is never rewritten. Opted-out customers are refused with an explanation
 * rather than silently queued — both adapters enforce the same rule (the SQL
 * side does it inside resend_notification so a raw API call cannot skip it).
 */
async function adminResendEmail({ id } = {}) {
  const state = load();
  requireStaff(state);
  if (!id) throw new Error('Choose an email to resend.');
  const source = (state.notificationLog ?? []).find((item) => item.id === id);
  if (!source) throw new Error('Email not found.');
  if (source.channel !== 'email' || !source.recipient) throw new Error('Only email messages can be resent.');
  const recipient = state.users.find(
    (item) => String(item.email).toLowerCase() === String(source.recipient).toLowerCase(),
  );
  if (recipient && !shouldNotify(source.kind, recipient.notifPrefs)) {
    throw new Error('This customer has opted out of these emails.');
  }
  const copy = {
    ...source,
    id: uid('eml'),
    status: 'queued',
    createdAt: nowISO(),
    meta: { ...(source.meta ?? {}), resentFrom: source.id },
  };
  state.notificationLog.push(copy);
  recordAudit(state, {
    action: 'resend',
    entityType: 'email',
    entityId: copy.id,
    summary: `Resent “${copy.subject}” to ${copy.recipient}`,
    metadata: { kind: copy.kind, sourceId: source.id },
  });
  persist();
  return copy;
}

async function adminReviews() {
  const state = load();
  requireStaff(state);
  return (state.reviews ?? [])
    .map((review) => {
      const booking = state.bookings.find((item) => item.id === review.bookingId);
      const owner = booking?.userId
        ? state.users.find((item) => item.id === booking.userId)
        : null;
      const vehicle = state.vehicles.find((item) => item.id === review.vehicleId);
      return {
        id: review.id,
        author: review.author,
        email: owner?.email ?? booking?.guestEmail ?? '',
        rating: review.rating,
        comment: review.comment,
        reply: review.reply ?? null,
        repliedAt: review.repliedAt ?? null,
        repliedBy: review.repliedBy ?? null,
        createdAt: review.createdAt,
        vehicleName: vehicle?.name ?? 'Vehicle removed',
        vehicleId: review.vehicleId ?? null,
        bookingCode: booking?.code ?? null,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function adminDeleteReview(id) {
  const state = load();
  const actor = requireStaff(state);
  const review = state.reviews.find((item) => item.id === id);
  if (!review) throw new Error('Review not found.');
  state.reviews = state.reviews.filter((item) => item.id !== id);
  const vehicle = state.vehicles.find((item) => item.id === review.vehicleId);
  recordAudit(state, {
    action: 'delete',
    entityType: 'reviews',
    entityId: vehicle?.id ?? review.vehicleId,
    summary: `Review by ${review.author || 'a customer'} on ${vehicle?.name ?? 'a vehicle'} removed (rating ${review.rating})`,
    metadata: { changed: {} },
  });
  persist();
  return { ok: true };
}

/**
 * Staff reply to a review. One reply per review, editable and removable.
 * Replies are public, so they are length-capped and recorded in the audit log.
 */
async function adminReplyToReview({ id, reply = '' } = {}) {
  const state = load();
  const actor = requireStaff(state);
  if (state.settings.review_replies_enabled === 'false') {
    throw new Error('Review replies are switched off in Settings.');
  }
  const review = state.reviews.find((item) => item.id === id);
  if (!review) throw new Error('Review not found.');
  const text = String(reply ?? '').trim();
  if (text.length > 1200) throw new Error('Keep the reply under 1,200 characters.');
  const previous = review.reply ?? null;
  const vehicle = state.vehicles.find((item) => item.id === review.vehicleId);
  const label = `${review.author || 'a customer'}'s review of ${vehicle?.name ?? 'a vehicle'}`;
  if (text) {
    review.reply = text;
    review.repliedAt = nowISO();
    review.repliedBy = actor.name;
  } else {
    delete review.reply;
    delete review.repliedAt;
    delete review.repliedBy;
  }
  recordAudit(state, {
    action: text ? 'update' : 'delete',
    entityType: 'reviews',
    entityId: vehicle?.id ?? review.vehicleId,
    summary: text
      ? `${actor.name} replied to ${label}`
      : `${actor.name} removed the reply to ${label}`,
    metadata: { changed: { reply: { from: previous ? previous.slice(0, 60) : null, to: text ? text.slice(0, 60) : null } } },
  });
  persist();
  return {
    ok: true,
    id: review.id,
    reply: review.reply ?? null,
    repliedAt: review.repliedAt ?? null,
    repliedBy: review.repliedBy ?? null,
  };
}

async function reviewBooking({ bookingId, rating, comment }) {
  const state = load();
  if (state.settings.reviews_enabled === 'false') {
    throw new Error('Reviews are temporarily closed. Thanks for travelling with Rove.');
  }
  const user = requireUser(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (booking.userId !== user.id) throw new Error('You can only review your own trips.');
  if (booking.status !== 'completed') throw new Error('You can review a trip once it is complete.');
  if (state.reviews.some((review) => review.bookingId === booking.id)) {
    throw new Error('You have already reviewed this trip.');
  }
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error('Choose a rating from 1 to 5.');
  if (!comment || comment.trim().length < 3) throw new Error('Please add a few words about your trip.');

  state.reviews.push({
    id: uid('rev'),
    vehicleId: booking.vehicleId,
    userId: user.id,
    bookingId: booking.id,
    author: user.name,
    rating: stars,
    comment: comment.trim().slice(0, 600),
    createdAt: nowISO(),
  });
  const vehicle = state.vehicles.find((item) => item.id === booking.vehicleId);
  const vehicleReviews = state.reviews.filter((review) => review.vehicleId === booking.vehicleId);
  if (vehicle && vehicleReviews.length) {
    vehicle.rating = Math.round((vehicleReviews.reduce((sum, review) => sum + review.rating, 0) / vehicleReviews.length) * 10) / 10;
  }
  recordAudit(state, {
    action: 'insert',
    entityType: 'reviews',
    entityId: booking.code,
    summary: `${stars}-star review for ${vehicle?.name ?? 'a vehicle'}`,
    metadata: { changed: { rating: { from: null, to: stars } } },
  });
  persist();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function adminBookings() {
  const state = load();
  requireStaff(state);
  return [...state.bookings]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((booking) => shapeBooking(booking, state));
}

/**
 * Staff-only type-ahead used by the ⌘K palette. Returns a small, uniform shape
 * so the demo and Supabase adapters behave identically. Looks at booking codes,
 * guest + account details, vehicle names and number plates.
 */
async function adminSearch({ query = '', limit = 5 } = {}) {
  const state = load();
  requireStaff(state);
  const term = String(query || '').trim().toLowerCase();
  const cap = Math.max(1, Math.min(10, Number(limit) || 5));
  if (term.length < 2) return { bookings: [], vehicles: [], customers: [] };

  const vehicleMap = new Map(state.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const userMap = new Map(state.users.map((user) => [user.id, user]));
  const has = (...values) => values.some((value) => String(value || '').toLowerCase().includes(term));

  const bookings = [...state.bookings]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .filter((booking) => {
      const vehicle = vehicleMap.get(booking.vehicleId);
      const user = booking.userId ? userMap.get(booking.userId) : null;
      return has(
        booking.code, user?.name, user?.email, user?.phone,
        booking.guestName, booking.guestEmail, booking.guestPhone,
        vehicle?.name, vehicle?.registrationNumber,
      );
    })
    .slice(0, cap)
    .map((booking) => {
      const vehicle = vehicleMap.get(booking.vehicleId);
      const user = booking.userId ? userMap.get(booking.userId) : null;
      return {
        id: booking.id,
        code: booking.code,
        status: booking.status,
        startDate: booking.startDate,
        customerName: user?.name || booking.guestName || 'Guest',
        vehicleName: vehicle?.name || '',
      };
    });

  const vehicles = state.vehicles
    .filter((vehicle) => has(vehicle.name, vehicle.brand, vehicle.registrationNumber, vehicle.location))
    .slice(0, cap)
    .map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name,
      registrationNumber: vehicle.registrationNumber || '',
      location: vehicle.location || '',
      status: vehicle.status,
    }));

  const customers = customerDirectory(state)
    .filter((person) => has(person.name, person.email, person.phone))
    .slice(0, cap)
    .map((person) => ({ id: person.id, name: person.name, email: person.email || '' }));

  return { bookings, vehicles, customers };
}

/**
 * Notify every waiting customer whose window is free right now.
 * Called automatically when a booking is cancelled/moved or a block is
 * released, and manually from Admin → Calendar. Idempotent: notified alerts
 * are removed from the candidate set immediately.
 */
function dispatchAvailabilityAlerts(state, {
  vehicleId = null, alertIds = null, reason = 'Vehicle released', limit = 50,
} = {}) {
  const board = availabilityBoard({
    users: state.users,
    bookings: state.bookings,
    vehicles: state.vehicles,
    blocks: state.vehicleBlocks ?? [],
    today: todayISO(),
  });
  let rows = board.rows.filter((row) => row.ready);
  if (vehicleId) rows = rows.filter((row) => row.vehicleId === vehicleId);
  if (Array.isArray(alertIds) && alertIds.length) {
    rows = rows.filter((row) => alertIds.includes(row.alertId));
  }
  rows = rows.slice(0, Math.max(0, limit));
  if (!rows.length) return { dispatched: 0, alertIds: [] };

  const at = nowISO();
  const tpl = templateFor(state.settings, 'availability_alert');
  rows.forEach((row) => {
    const user = state.users.find((item) => item.id === row.userId);
    const alert = user?.alerts?.find((item) => item.id === row.alertId);
    if (!user || !alert) return;
    Object.assign(alert, markAlertNotified(alert, { at, reason, vehicleName: row.vehicleName }));
    const dates = `${row.startDate} → ${row.endDate}`;
    notify(state, {
      audience: 'user',
      userId: user.id,
      kind: 'availability_alert',
      title: `${row.vehicleName} is free for your dates`,
      body: `Your watchlist window (${dates}) just opened up. Book it before someone else does.`,
      link: `/vehicles/${row.vehicleId}?from=${row.startDate}&to=${row.endDate}&alert=1`,
    });
    queueEmail(state, {
      kind: 'availability_alert',
      email: user.email,
      subject: tpl.subject,
      body: tpl.body,
      meta: { name: user.name || 'there', vehicle: row.vehicleName, dates },
    });
  });
  recordAudit(state, {
    action: 'update',
    entityType: 'availability_alerts',
    entityId: `${rows.length} alert${rows.length === 1 ? '' : 's'}`,
    summary: `Notified ${rows.length} waitlist customer${rows.length === 1 ? '' : 's'} · ${reason}`,
    metadata: { changed: { notifiedAt: { from: null, to: at } } },
  });
  return { dispatched: rows.length, alertIds: rows.map((row) => row.alertId) };
}

async function adminStats() {
  const state = load();
  requireStaff(state);
  const bookings = state.bookings.map((booking) => shapeBooking(booking, state));
  return computeAdminStats(
    bookings,
    state.vehicles,
    state.users,
    state.vehicleBlocks ?? [],
    state.serviceLogs ?? [],
    state.checkoutAttempts ?? [],
    state.reviews ?? [],
    state.settings ?? {},
  );
}

async function adminUpdateBooking({
  bookingId, status, startDate, endDate, pickupLocation, dropoffLocation,
  pickupTime, dropoffTime, refund = false, notes, reason,
}) {
  const state = load();
  const staff = requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  const previousStatus = booking.status;
  const previousTotal = Number(booking.total) || 0;
  const frozenDeposit = Number(booking.depositDue) || 0;
  const previousWindow = {
    start: booking.startDate,
    end: booking.endDate,
    pickup: booking.pickupLocation,
    dropoff: booking.dropoffLocation,
  };

  if (status && status !== booking.status) {
    if (!ALLOWED_TRANSITIONS[booking.status]?.includes(status)) {
      throw new Error(`A ${booking.status} booking cannot be marked ${status}.`);
    }
    booking.status = status;
    if (['cancelled', 'rejected'].includes(status)) {
      booking.cancelledAt = nowISO();
      booking.cancellationReason = String(reason || 'Cancelled by Rove staff').trim().slice(0, 240);
      booking.cancelledBy = 'staff';
    }
  }

  const nextStart = startDate || booking.startDate;
  const nextEnd = endDate || booking.endDate;
  const nextPickup = pickupLocation ?? booking.pickupLocation;
  const nextDropoff = dropoffLocation ?? booking.dropoffLocation;
  const tripChanged = Boolean(startDate || endDate)
    || nextPickup !== booking.pickupLocation
    || nextDropoff !== booking.dropoffLocation;

  if (pickupLocation !== undefined && !String(pickupLocation).trim()) {
    throw new Error('Choose a pick-up hub.');
  }
  if (dropoffLocation !== undefined && !String(dropoffLocation).trim()) {
    throw new Error('Choose a drop-off hub.');
  }
  if (pickupTime !== undefined && !isRentalTime(pickupTime)) {
    throw new Error('Choose a valid pick-up time.');
  }
  if (dropoffTime !== undefined && !isRentalTime(dropoffTime)) {
    throw new Error('Choose a valid drop-off time.');
  }
  // A hub edit must respect the one-way switch: when disabled, pick-up and
  // drop-off have to stay the same hub even for staff edits.
  if (String(state.settings?.one_way_enabled ?? 'true') === 'false'
    && nextPickup !== nextDropoff) {
    throw new Error('One-way rentals are switched off — pick up and drop off at the same hub.');
  }

  if (tripChanged) {
    if (!isValidDate(nextStart) || !isValidDate(nextEnd) || nextStart >= nextEnd) {
      throw new Error('Choose a valid date range.');
    }
    const { quote, vehicle } = tripChangeQuote(state, booking, {
      startDate: nextStart,
      endDate: nextEnd,
      pickupLocation: nextPickup,
      dropoffLocation: nextDropoff,
    });
    if (!vehicleAvailable(state, vehicle, nextStart, nextEnd, booking.id)) {
      throw new Error('Those dates overlap another booking for this vehicle.');
    }
    applyQuoteToBooking(booking, quote, {
      startDate: nextStart,
      endDate: nextEnd,
      pickupLocation: nextPickup,
      dropoffLocation: nextDropoff,
    });
    // A trip already out has collected its deposit at pick-up, so re-pricing
    // must not change the deposit figure the customer already paid.
    if (booking.status === 'active') booking.depositDue = frozenDeposit;
  }

  // Every date/hub edit is part of the customer-visible trip activity trail
  // (voucher, manage page, analytics) — not just self-serve extensions.
  if (tripChanged
    && (nextStart !== previousWindow.start
      || nextEnd !== previousWindow.end
      || nextPickup !== previousWindow.pickup
      || nextDropoff !== previousWindow.dropoff)) {
    const delta = (Number(booking.total) || 0) - previousTotal;
    booking.tripChanges = [...(booking.tripChanges ?? []), {
      type: 'change',
      at: nowISO(),
      by: staff.name,
      summary: `${previousWindow.start} → ${booking.startDate}`
        + (previousWindow.pickup !== booking.pickupLocation || previousWindow.dropoff !== booking.dropoffLocation
          ? ` · ${previousWindow.pickup} → ${booking.pickupLocation}`
          : ''),
      from: previousWindow.end,
      to: booking.endDate,
      delta,
    }];
  }

  if (pickupLocation !== undefined) booking.pickupLocation = nextPickup;
  if (dropoffLocation !== undefined) booking.dropoffLocation = nextDropoff;
  if (pickupTime !== undefined) booking.pickupTime = pickupTime;
  if (dropoffTime !== undefined) booking.dropoffTime = dropoffTime;
  if (notes !== undefined) booking.notes = String(notes).slice(0, 600);

  if (status === 'completed' && previousStatus !== 'completed') {
    booking.completedAt = nowISO();
    const vehicle = state.vehicles.find((item) => item.id === booking.vehicleId);
    if (vehicle) vehicle.trips += 1;
  }

  // Keep the fleet board honest: a car that just left the hub reads "on rent",
  // and one that comes back (or whose trip is cancelled) is free again. Manual
  // maintenance is never overwritten.
  if (status && status !== previousStatus) {
    const vehicle = state.vehicles.find((item) => item.id === booking.vehicleId);
    if (vehicle) {
      if (status === 'active' && vehicle.status === 'available') vehicle.status = 'rented';
      if (previousStatus === 'active' && ['completed', 'cancelled', 'rejected'].includes(status) && vehicle.status === 'rented') {
        vehicle.status = 'available';
      }
    }
  }

  if (refund && status === 'cancelled') {
    const amount = booking.amountPaid;
    if (amount > 0) {
      refundBooking(state, booking, amount);
      booking.amountPaid = 0;
      booking.paymentStatus = 'refunded';
    }
  }

  recordAudit(state, {
    action: 'update',
    entityType: 'bookings',
    entityId: booking.code,
    summary: status && status !== previousStatus
      ? `Booking ${booking.code} marked ${status}`
      : `Booking ${booking.code} updated`,
    metadata: {
      changed: {
        ...(status && status !== previousStatus ? { status: { from: previousStatus, to: status } } : {}),
        ...(startDate || endDate ? { dates: { from: null, to: `${booking.startDate} → ${booking.endDate}` } } : {}),
        ...(pickupLocation !== undefined || dropoffLocation !== undefined
          ? { hubs: { from: null, to: `${booking.pickupLocation} → ${booking.dropoffLocation}` } }
          : {}),
        ...(reason && status && status !== previousStatus ? { reason: { from: null, to: String(reason).slice(0, 240) } } : {}),
      },
    },
  });
  if (status && status !== previousStatus && ['active', 'completed', 'cancelled'].includes(status) && booking.userId) {
    const tripMessages = {
      active: { kind: 'booking_active', title: 'Trip started', body: 'Have a safe drive — roadside support is included.' },
      completed: { kind: 'booking_completed', title: 'Trip completed', body: "Nice driving! We'd love a review of your trip." },
      cancelled: { kind: 'booking_cancelled', title: 'Booking cancelled', body: 'This booking was cancelled by Rove.' },
    };
    const message = tripMessages[status];
    notify(state, {
      audience: 'user', userId: booking.userId, kind: message.kind, title: message.title, body: message.body,
      bookingCode: booking.code, link: `/confirmation/${booking.code}`,
    });
    queueEmail(state, {
      kind: message.kind,
      email: bookingEmailFor(booking, state),
      subject: status === 'active' ? `Your ${booking.code} trip is on` : status === 'completed' ? `Your ${booking.code} trip is complete` : `Your ${booking.code} booking was cancelled`,
      body: message.body,
      meta: { code: booking.code, status },
    });
  }
  if (status && status !== previousStatus && ['cancelled', 'rejected'].includes(status)) {
    dispatchAvailabilityAlerts(state, {
      vehicleId: booking.vehicleId,
      reason: `Booking ${booking.code} was cancelled`,
    });
  } else if (tripChanged) {
    dispatchAvailabilityAlerts(state, {
      vehicleId: booking.vehicleId,
      reason: `Booking ${booking.code} dates changed`,
    });
  }
  persist();
  return shapeBooking(booking, state);
}

/**
 * Server-authoritative quote for a proposed trip change, reusing the same
 * pricing core as checkout so previews and approvals always agree.
 */
const tripChangeQuote = (state, booking, next) => {
  const vehicle = state.vehicles.find((item) => item.id === booking.vehicleId);
  const promo = booking.promoCode
    ? state.promos.find((item) => item.code === booking.promoCode)
    : null;
  const quote = calculateQuote({
    vehicle,
    startDate: next.startDate,
    endDate: next.endDate,
    extras: booking.extras,
    extrasCatalog: state.extras.filter((extra) => extra.active),
    insuranceTiers: state.insuranceTiers,
    insurance: booking.insurance,
    promo: promo && promo.active ? promo : null,
    settings: state.settings,
    pickupLocation: next.pickupLocation,
    dropoffLocation: next.dropoffLocation,
    paymentPlan: booking.paymentPlan,
    skipValidation: true,
  });
  return { quote, vehicle };
};

/** Persist a freshly quoted trip change onto the booking row. */
const applyQuoteToBooking = (booking, quote, next) => {
  booking.startDate = next.startDate;
  booking.endDate = next.endDate;
  booking.pickupLocation = next.pickupLocation;
  booking.dropoffLocation = next.dropoffLocation;
  booking.days = quote.days;
  booking.baseTotal = quote.baseTotal;
  booking.extrasTotal = quote.extrasTotal;
  booking.insuranceTotal = quote.insuranceTotal;
  booking.oneWayFee = quote.oneWayFee;
  booking.fees = quote.fees;
  booking.taxRate = quote.taxRate;
  booking.taxInclusive = quote.taxInclusive;
  booking.taxable = quote.taxable;
  booking.untaxedTotal = quote.untaxedTotal;
  booking.discount = quote.discount;
  booking.total = quote.total;
  booking.depositDue = quote.depositDue;
};

async function submitChangeRequest({ bookingId, startDate, endDate, pickupLocation, dropoffLocation, pickupTime, dropoffTime }) {
  const state = load();
  const user = requireUser(state);
  if (state.settings.change_request_enabled === 'false') {
    throw new Error('Trip changes are currently unavailable — please contact support.');
  }
  const booking = state.bookings.find((item) => item.id === bookingId && item.userId === user.id);
  if (!booking) throw new Error('Booking not found.');
  if (!['pending', 'confirmed'].includes(booking.status)) throw new Error('Only upcoming bookings can be changed.');
  if (booking.changeRequest?.status === 'pending') throw new Error('You already have a change request pending.');
  const next = {
    startDate, endDate, pickupLocation: String(pickupLocation ?? '').trim(),
    dropoffLocation: String(dropoffLocation ?? '').trim(), pickupTime, dropoffTime,
  };
  if (!isValidDate(next.startDate) || !isValidDate(next.endDate) || next.startDate >= next.endDate) {
    throw new Error('Choose a valid date range.');
  }
  if (next.startDate < todayISO()) throw new Error('Pick-up cannot be in the past.');
  if (!next.pickupLocation || !next.dropoffLocation) throw new Error('Choose pick-up and drop-off hubs.');
  if (!isRentalTime(next.pickupTime) || !isRentalTime(next.dropoffTime)) throw new Error('Choose valid pick-up and drop-off times.');
  const { quote, vehicle } = tripChangeQuote(state, booking, next);
  if (!vehicleAvailable(state, vehicle, next.startDate, next.endDate, booking.id)) {
    throw new Error('Those dates are not available for this vehicle. Try another window.');
  }
  booking.changeRequest = {
    status: 'pending',
    startDate: next.startDate,
    endDate: next.endDate,
    pickupLocation: next.pickupLocation,
    dropoffLocation: next.dropoffLocation,
    pickupTime: next.pickupTime,
    dropoffTime: next.dropoffTime,
    days: quote.days,
    total: quote.total,
    fees: quote.fees,
    taxRate: quote.taxRate,
    taxInclusive: quote.taxInclusive,
    requestedAt: nowISO(),
  };
  persist();
  notify(state, {
    audience: 'user', userId: user.id, kind: 'trip_change_requested', title: 'Change request received',
    body: `Your change request for ${booking.code} is with our team. We will confirm by email.`,
    bookingCode: booking.code, link: '/account?tab=trips',
  });
  notify(state, {
    audience: 'staff', kind: 'trip_change_requested', title: `Change request for ${booking.code}`,
    body: `${user.name} asked to move ${booking.code}. Approve or decline from Bookings.`,
    bookingCode: booking.code, link: '/admin/bookings?change=pending',
  });
  queueEmail(state, {
    kind: 'trip-change-requested', email: user.email,
    subject: `Change request received for ${booking.code}`,
    meta: { code: booking.code },
  });
  return { ok: true, changeRequest: booking.changeRequest };
}

/**
 * Self-serve trip extension for a trip that has already left the hub.
 *
 * Unlike the change-request flow (which re-quotes new pick-up/drop-off hubs
 * and needs staff sign-off before an upcoming booking moves), an extension
 * only moves the drop-off later on a vehicle the customer already holds. The
 * same pricing core re-quotes it, availability is checked against other
 * bookings, and the new fare takes effect immediately — extra days are simply
 * collected at drop-off, exactly like the desk would arrange over the phone.
 *
 * Staff may extend on a customer's behalf (the returns desk "extend now"
 * flow): the guard accepts the owner or any staff member, and both paths log
 * the same `extension` trip-change entry.
 */
async function extendTrip({ bookingId, endDate, dropoffTime }) {
  const state = load();
  const user = requireUser(state);
  if (!extensionsEnabled(state.settings)) {
    throw new Error('Trip extensions are currently unavailable — please contact support.');
  }
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  const isOwner = booking.userId === user.id;
  if (!isOwner && !isStaff(user)) throw new Error('Booking not found.');
  if (booking.status !== 'active') throw new Error('Only a trip that is still out can be extended.');
  if (booking.changeRequest?.status === 'pending') {
    throw new Error('You already have a change request pending. Withdraw it before extending.');
  }
  const policy = sitePolicy(state.settings);
  const problem = extendProblem(booking, { endDate, dropoffTime }, { policy });
  if (problem) throw new Error(problem);
  const next = {
    startDate: booking.startDate,
    endDate,
    pickupLocation: booking.pickupLocation,
    dropoffLocation: booking.dropoffLocation,
    pickupTime: booking.pickupTime || '10:00',
    dropoffTime,
  };
  const { quote, vehicle } = tripChangeQuote(state, booking, next);
  if (!vehicleAvailable(state, vehicle, next.startDate, next.endDate, booking.id)) {
    throw new Error('That return window is not available for this vehicle — another booking may be scheduled. Try a different time.');
  }
  const previousTotal = Number(booking.total) || 0;
  const previousEnd = booking.endDate;
  const previousTime = booking.dropoffTime || '10:00';
  // The security deposit is captured once at pick-up — re-pricing the extra
  // days must not inflate the "deposit paid" figure shown on the voucher.
  const frozenDeposit = Number(booking.depositDue) || 0;
  applyQuoteToBooking(booking, quote, next);
  booking.dropoffTime = dropoffTime;
  booking.depositDue = frozenDeposit;
  const delta = (Number(booking.total) || 0) - previousTotal;
  booking.tripChanges = [...(booking.tripChanges ?? []), {
    type: 'extension',
    at: nowISO(),
    by: user.name,
    summary: `Return ${previousEnd} ${previousTime} → ${booking.endDate} ${booking.dropoffTime}`,
    from: previousEnd,
    to: booking.endDate,
    delta,
  }];
  recordAudit(state, {
    action: 'update', entityType: 'bookings', entityId: booking.code,
    summary: `${isOwner ? 'Customer' : `${user.name} (staff)`} extended return for ${booking.code} to ${booking.endDate} ${booking.dropoffTime} (delta ${delta >= 0 ? '+' : ''}${delta})`,
    metadata: { change: 'extension', delta: { from: previousTotal, to: booking.total } },
  });
  if (booking.userId) {
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'trip_extension', title: 'Return extended',
      body: `Your ${booking.code} return is now ${booking.endDate} at ${booking.dropoffTime}.`,
      bookingCode: booking.code, link: `/confirmation/${booking.code}`,
    });
  }
  if (isOwner) {
    notify(state, {
      audience: 'staff', kind: 'trip_extension', title: `Return extended for ${booking.code}`,
      body: `${user.name} extended ${booking.code} to ${booking.endDate} at ${booking.dropoffTime}.${delta > 0 ? ` ${delta} due at drop-off.` : ''}`,
      bookingCode: booking.code, link: '/admin/bookings',
    });
  }
  queueEmail(state, {
    kind: 'trip-extended', email: bookingEmailFor(booking, state),
    subject: `Your ${booking.code} return is extended`,
    body: `Hi ${user.name || 'there'},\n\nYour ${booking.code} return is now ${booking.endDate} at ${booking.dropoffTime}.${delta > 0 ? ` The extra ${delta} is collected at drop-off.` : ' The price is unchanged.'}\n\n— Rove`,
    meta: { code: booking.code, dates: `${booking.endDate} at ${booking.dropoffTime}`, delta },
  });
  dispatchAvailabilityAlerts(state, {
    vehicleId: booking.vehicleId,
    reason: `Booking ${booking.code} return extended`,
  });
  persist();
  return shapeBooking(booking, state);
}

/**
 * Staff send a "return was due" reminder to a customer whose active trip is
 * overdue. One reminder per calendar day (tracked on the booking) so a desk
 * rehearsing the overdue list cannot spam a customer; the email links to
 * Manage Booking where the customer can extend in a tap.
 */
async function sendReturnReminder({ bookingId }) {
  const state = load();
  const staff = requireStaff(state);
  if (String(state.settings?.operational_reminders ?? 'true') === 'false') {
    throw new Error('Reminders are switched off — enable them in Admin → Settings.');
  }
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (booking.status !== 'active') throw new Error('Only a trip still out can be reminded.');
  const today = todayISO();
  const days = lateDays(booking, today);
  if (days <= 0) throw new Error('No reminder needed — this trip is not overdue yet.');
  if (booking.lastReturnReminderDay === today) {
    throw new Error('This customer was already reminded today.');
  }
  booking.lastReturnReminderDay = today;
  const owner = booking.userId ? state.users.find((item) => item.id === booking.userId) : null;
  const name = owner?.name || booking.guestName || 'there';
  if (booking.userId) {
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'return_due_reminder', title: 'Return was due',
      body: `Your ${booking.code} return was due ${booking.endDate}. If you need more time, extend it from Manage Booking.`,
      bookingCode: booking.code, link: `/manage?code=${booking.code}`,
    });
  }
  queueEmail(state, {
    kind: 'return-due-reminder',
    email: bookingEmailFor(booking, state),
    subject: `Your ${booking.code} return was due`,
    body: `Hi ${name},\n\nYour ${booking.code} return was due on ${booking.endDate}. If you are on your way back, great — if you need more time, extend the return in Manage Booking so no late fee accrues.\n\n— Rove`,
    meta: { code: booking.code, dates: booking.endDate },
  });
  recordAudit(state, {
    action: 'update', entityType: 'bookings', entityId: booking.code,
    summary: `${staff.name} reminded the customer that ${booking.code} is ${days} day${days === 1 ? '' : 's'} late`,
    metadata: { change: 'returnReminder', days, remindedAt: nowISO() },
  });
  persist();
  return { ok: true, days, remindedAt: nowISO() };
}

/**
 * Staff send a "pick-up is coming" nudge to a confirmed customer whose pick-up
 * is today or tomorrow. The reminder carries what to bring (licence, ID,
 * deposit) and links to Manage Booking. One per calendar day so the desk
 * cannot spam someone who is genuinely coming in a few hours.
 */
async function sendPickupReminder({ bookingId }) {
  const state = load();
  const staff = requireStaff(state);
  if (String(state.settings?.operational_reminders ?? 'true') === 'false') {
    throw new Error('Reminders are switched off — enable them in Admin → Settings.');
  }
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (booking.status !== 'confirmed') throw new Error('Only a confirmed pick-up can be reminded.');
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  if (booking.startDate !== today && booking.startDate !== tomorrow) {
    throw new Error('Pick-up reminders are for pick-ups today or tomorrow.');
  }
  if (booking.lastPickupReminderDay === today) {
    throw new Error('This customer was already reminded today.');
  }
  booking.lastPickupReminderDay = today;
  const owner = booking.userId ? state.users.find((item) => item.id === booking.userId) : null;
  const name = owner?.name || booking.guestName || 'there';
  const deposit = `₹${Number(booking.holdAmount || 0).toLocaleString('en-IN')}`;
  if (booking.userId) {
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'pickup_reminder', title: 'Pick-up tomorrow',
      body: `${booking.code} · collect your vehicle ${booking.startDate} at ${booking.pickupTime || '10:00'} from ${booking.pickupLocation}. Bring your licence and government ID; the ${deposit} deposit is collected at pick-up.`,
      bookingCode: booking.code, link: `/manage?code=${booking.code}`,
    });
  }
  queueEmail(state, {
    kind: 'pickup_reminder',
    email: bookingEmailFor(booking, state),
    subject: `Your pick-up is on ${booking.startDate}`,
    body: `Hi ${name},\n\nYou are scheduled to collect your ${booking.code} rental on ${booking.startDate} at ${booking.pickupTime || '10:00'} from ${booking.pickupLocation}.\n\nBring a valid driving licence, a government photo ID and the payment details on file. The refundable security deposit of ${deposit} is collected at pick-up.\n\nSee your full voucher and invoice in your account.\n\n— ${state.settings.site_name ?? 'Rove'}`,
    meta: { code: booking.code, name, dates: `${booking.startDate} – ${booking.endDate}`, time: booking.pickupTime || '10:00', hub: booking.pickupLocation, amount: deposit },
  });
  recordAudit(state, {
    action: 'update', entityType: 'bookings', entityId: booking.code,
    summary: `${staff.name} sent the pick-up reminder for ${booking.code}`,
    metadata: { change: 'pickupReminder', remindedAt: nowISO() },
  });
  persist();
  return { ok: true, remindedAt: nowISO() };
}

async function cancelChangeRequest({ bookingId }) {
  const state = load();
  const user = requireUser(state);
  const booking = state.bookings.find((item) => item.id === bookingId && item.userId === user.id);
  if (!booking || booking.changeRequest?.status !== 'pending') throw new Error('No pending change request to withdraw.');
  delete booking.changeRequest;
  persist();
  notify(state, {
    audience: 'user', userId: user.id, kind: 'trip_change_withdrawn', title: 'Change request withdrawn',
    body: `Your change request for ${booking.code} was withdrawn.`,
    bookingCode: booking.code, link: '/account?tab=trips',
  });
  return { ok: true };
}

async function resolveChangeRequest({ bookingId, decision, reason }) {
  const state = load();
  requireStaff(state);
  const staff = requireUser(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking || booking.changeRequest?.status !== 'pending') throw new Error('No pending change request for this booking.');
  const request = booking.changeRequest;
  const reasonText = String(reason ?? '').trim().slice(0, 240);

  if (decision === 'approve') {
    const next = {
      startDate: request.startDate,
      endDate: request.endDate,
      pickupLocation: request.pickupLocation,
      dropoffLocation: request.dropoffLocation,
      pickupTime: request.pickupTime,
      dropoffTime: request.dropoffTime,
    };
    const { quote, vehicle } = tripChangeQuote(state, booking, next);
    if (!vehicleAvailable(state, vehicle, next.startDate, next.endDate, booking.id)) {
      throw new Error('Those dates just became unavailable — decline the request and tell the customer.');
    }
    const previousTotal = Number(booking.total) || 0;
    applyQuoteToBooking(booking, quote, next);
    booking.pickupTime = next.pickupTime;
    booking.dropoffTime = next.dropoffTime;
    const totalDelta = (Number(booking.total) || 0) - previousTotal;
    booking.tripChanges = [...(booking.tripChanges ?? []), {
      type: 'change', at: nowISO(), by: staff.name,
      summary: `${request.startDate} → ${request.endDate} · ${request.pickupLocation} → ${request.dropoffLocation}`,
      delta: totalDelta,
    }];
    booking.changeRequest = { ...request, status: 'approved', resolvedAt: nowISO(), resolvedBy: staff.id, reason: reasonText };
    recordAudit(state, {
      action: 'update', entityType: 'bookings', entityId: booking.code,
      summary: `Approved change request for ${booking.code} (delta ${totalDelta >= 0 ? '+' : ''}${totalDelta})`,
      metadata: { change: 'approve', reason: reasonText, delta: { from: previousTotal, to: booking.total } },
    });
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'trip_change_approved', title: 'Trip change approved',
      body: `Your ${booking.code} change was approved — new dates ${request.startDate} to ${request.endDate}.`,
      bookingCode: booking.code, link: `/confirmation/${booking.code}`,
    });
    queueEmail(state, {
      kind: 'trip-change-approved', email: bookingEmailFor(booking, state),
      subject: `Your ${booking.code} change is confirmed`,
      body: `New dates ${request.startDate} to ${request.endDate}. ${totalDelta > 0 ? `The new price is ₹${totalDelta} higher, payable at pick-up.` : totalDelta < 0 ? `The new price is ₹${-totalDelta} lower — that amount is now a credit on your booking and will be refunded to your original payment method.` : 'The price is unchanged.'}`,
      meta: { code: booking.code, delta: totalDelta },
    });
  } else if (decision === 'decline') {
    booking.changeRequest = { ...request, status: 'declined', resolvedAt: nowISO(), resolvedBy: staff.id, reason: reasonText };
    recordAudit(state, {
      action: 'update', entityType: 'bookings', entityId: booking.code,
      summary: `Declined change request for ${booking.code}`,
      metadata: { change: 'decline', reason: reasonText },
    });
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'trip_change_declined', title: 'Change request declined',
      body: reasonText ? `Your ${booking.code} change was declined: ${reasonText}` : `Your ${booking.code} change was declined — the original booking is unchanged.`,
      bookingCode: booking.code, link: '/account?tab=trips',
    });
    queueEmail(state, {
      kind: 'trip-change-declined', email: bookingEmailFor(booking, state),
      subject: `Your ${booking.code} change was declined`,
      body: reasonText || 'Your original booking is unchanged.',
      meta: { code: booking.code, reason: reasonText },
    });
  } else {
    throw new Error('Invalid decision.');
  }

  if (decision === 'approve') {
    dispatchAvailabilityAlerts(state, {
      vehicleId: booking.vehicleId,
      reason: `Booking ${booking.code} dates changed`,
    });
  }
  persist();
  return { ok: true, decision, changeRequest: booking.changeRequest, total: booking.total };
}

async function adminBulkUpdateBookings({ ids = [], status, reason = '' }) {
  const state = load();
  requireStaff(state);
  const targets = (Array.isArray(ids) ? ids : [])
    .map((id) => state.bookings.find((item) => item.id === id))
    .filter(Boolean);
  const reasonText = String(reason).trim().slice(0, 240);
  let updated = 0;
  const skipped = [];

  targets.forEach((booking) => {
    if (!ALLOWED_TRANSITIONS[booking.status]?.includes(status)) {
      skipped.push({ code: booking.code, reason: `cannot change ${booking.status} to ${status}` });
      return;
    }
    const previousStatus = booking.status;
    booking.status = status;
    if (['cancelled', 'rejected'].includes(status)) {
      booking.cancelledAt = nowISO();
      booking.cancellationReason = reasonText || 'Rejected by Rove staff';
      booking.cancelledBy = 'staff';
    }
    recordAudit(state, {
      action: 'bulk',
      entityType: 'bookings',
      entityId: booking.code,
      summary: `Bulk marked ${status} (${targets.length} selected)`,
      metadata: { changed: { status: { from: previousStatus, to: status } }, reason: reasonText },
    });
    if (status === 'rejected' && booking.userId) {
      notify(state, {
        audience: 'user', userId: booking.userId, kind: 'booking_rejected', title: 'Booking declined',
        body: reasonText
          ? `We could not confirm ${booking.code}: ${reasonText}`
          : `We could not confirm ${booking.code}.`,
        bookingCode: booking.code, link: '/account?tab=trips',
      });
    }
    updated += 1;
  });

  if (['cancelled', 'rejected'].includes(status)) {
    const released = new Set(targets.filter((booking) => booking.status === status).map((booking) => booking.vehicleId));
    released.forEach((vehicleId) => dispatchAvailabilityAlerts(state, {
      vehicleId,
      reason: `Bulk ${status} by staff`,
    }));
  }
  persist();
  return { updated, skipped, total: targets.length };
}

async function adminDeskBookings() {
  const state = load();
  requireStaff(state);
  const today = todayISO();
  const nextWeek = addDaysISO(today, 7);
  // Pick-ups are bookings that have not started yet. A confirmed booking whose
  // day has passed is an *overdue pick-up* (a no-show candidate) — it must stay
  // on the board so staff can still hand it over or close it out. Confirmed
  // commitments are never date-capped (a booking stuck for a month is a bigger
  // problem, not a lesser one); only stale unpaid requests are bounded.
  const overdueSince = addDaysISO(today, -14);
  return state.bookings
    .filter((booking) => (
      booking.startDate <= nextWeek
      && (
        booking.status === 'confirmed'
        || (booking.status === 'pending' && booking.startDate >= overdueSince)
      )
    ))
    .sort((a, b) => {
      const byDate = String(a.startDate).localeCompare(String(b.startDate));
      if (byDate !== 0) return byDate;
      return String(a.pickupTime || '10:00').localeCompare(String(b.pickupTime || '10:00'));
    })
    .map((booking) => shapeBooking(booking, state));
}

/**
 * Start a trip from the desk.
 *
 * The condition report is validated before anything changes and the status
 * flip is delegated to `adminUpdateBooking`, so notifications, audit history
 * and transition rules stay in exactly one place.
 */
async function adminStartTrip({ bookingId, inspection } = {}) {
  const state = load();
  const user = requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (booking.status !== 'confirmed') {
    throw new Error('Only a confirmed booking can be started.');
  }
  const problems = inspectionProblems(inspection ?? {});
  if (problems.length) throw new Error(problems[0]);
  const clean = normalizeInspection(inspection);
  booking.pickupInspection = { ...clean, recordedAt: nowISO(), recordedBy: user.id };
  booking.pickupOdometer = clean.odometer;
  recordAudit(state, {
    action: 'update',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Pick-up condition recorded for ${booking.code} at ${clean.odometer.toLocaleString('en-IN')} km`,
    metadata: { changed: { pickupInspection: { from: null, to: booking.pickupInspection } } },
  });
  return adminUpdateBooking({ bookingId, status: 'active' });
}

async function adminSaveDeskChecks({ bookingId, checked = [] }) {
  const state = load();
  requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  const clean = Array.isArray(checked)
    ? checked.filter((key) => DESK_CHECK_KEYS.includes(key))
    : [];
  booking.deskChecks = deskCheckPayload(clean);
  recordAudit(state, {
    action: 'update',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Handover checklist updated for ${booking.code}`,
    metadata: { changed: { deskChecks: { from: null, to: booking.deskChecks } } },
  });
  persist();
  return shapeBooking(booking, state);
}

const DEPOSIT_METHODS = Object.freeze(['cash', 'upi', 'card', 'transfer', 'other']);

/**
 * Record the security deposit taken at pick-up.
 *
 * Before this action the desk only ticked a checklist box, so finance could
 * not trace the money ("the desk says collected — where is the ₹5,000?").
 * Recording amount, method and reference gives the deposit float an audit
 * trail: who, how much, how and when. A booking can only be collected once;
 * the amount is validated against the same ceiling as the other money inputs.
 */
async function adminCollectDeposit({ bookingId, amount, method, reference = '' } = {}) {
  const state = load();
  const staff = requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (booking.depositCollected) throw new Error('The deposit for this booking has already been collected.');
  const collected = Math.round(Number(amount));
  if (!Number.isFinite(collected) || collected <= 0) {
    throw new Error('Enter a valid deposit amount.');
  }
  const due = Number(booking.holdAmount) || 0;
  if (due <= 0) {
    throw new Error('No security deposit is due for this booking.');
  }
  if (collected > due) {
    throw new Error('The deposit cannot exceed the amount due for this booking.');
  }
  const cleanMethod = DEPOSIT_METHODS.includes(method) ? method : 'other';
  const cleanReference = String(reference ?? '').trim().slice(0, 120);
  booking.depositCollected = {
    amount: collected,
    method: cleanMethod,
    reference: cleanReference || null,
    at: nowISO(),
    byName: staff.name,
  };
  recordAudit(state, {
    action: 'update',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Deposit of ₹${collected.toLocaleString('en-IN')} collected for ${booking.code} via ${cleanMethod}${cleanReference ? ` (${cleanReference})` : ''}`,
    metadata: { changed: { depositCollected: { from: null, to: booking.depositCollected } } },
  });
  persist();
  return shapeBooking(booking, state);
}

/**
 * Close an overdue pick-up as a no-show.
 *
 * Deliberately a thin, guarded wrapper around the staff cancellation path so
 * refunds, availability alerts, notifications and audit history behave exactly
 * like any other staff cancellation — there is no second money code path to
 * keep in sync.
 */
async function adminMarkNoShow({ bookingId, refund = false }) {
  const state = load();
  requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (booking.status !== 'confirmed') {
    throw new Error('Only a confirmed booking can be marked as a no-show.');
  }
  if (String(booking.startDate) >= todayISO()) {
    throw new Error('This pick-up is not overdue yet.');
  }
  return adminUpdateBooking({
    bookingId: booking.id,
    status: 'cancelled',
    refund: Boolean(refund),
    reason: 'No-show — the customer did not collect the vehicle.',
  });
}

async function adminReturnBookings() {
  const state = load();
  requireStaff(state);
  return state.bookings
    .filter((booking) => (
      booking.status === 'active'
      || (booking.status === 'completed' && !booking.depositSettlement)
    ))
    .sort((a, b) => String(a.endDate).localeCompare(String(b.endDate)))
    .map((booking) => shapeBooking(booking, state));
}

async function adminSaveReturnChecks({ bookingId, checked = [] }) {
  const state = load();
  requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (booking.depositSettlement) throw new Error('This return has already been settled.');
  const clean = (Array.isArray(checked) ? checked : []).filter((key) => RETURN_CHECK_KEYS.includes(key));
  booking.returnChecks = returnCheckPayload(clean);
  recordAudit(state, {
    action: 'update',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Return checklist updated for ${booking.code}`,
    metadata: { changed: { returnChecks: { from: null, to: booking.returnChecks } } },
  });
  persist();
  return shapeBooking(booking, state);
}

async function adminSettleReturn({ bookingId, checked = [], waiveKm = false, ...inspection }) {
  const state = load();
  requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (!['active', 'completed'].includes(booking.status)) {
    throw new Error('Only an active or completed trip can be settled.');
  }
  const clean = (Array.isArray(checked) ? checked : []).filter((key) => RETURN_CHECK_KEYS.includes(key));
  if (RETURN_CHECK_KEYS.some((key) => !clean.includes(key))) {
    throw new Error('Complete the return checklist before settling.');
  }
  // Validate the drop-off read against the pick-up record before any money moves.
  // (The settlement guard runs first inside settlementRecord, so settling twice
  // reports the right error even when the form is empty.)
  const record = settlementRecord({
    booking: shapeBooking(booking, state),
    inspection,
    checked: clean,
    waiveKm: Boolean(waiveKm),
    refundMethod: inspection?.refundMethod,
  });
  const condition = returnCondition(inspection, {
    pickupOdometer: booking.pickupOdometer ?? booking.pickupInspection?.odometer ?? null,
  });
  record.inspection.recordedAt = nowISO();
  record.inspection.odometer = condition.odometer;
  record.inspection.cleanliness = condition.cleanliness;
  record.settlement.chargedAt = nowISO();
  const previousStatus = booking.status;

  booking.returnChecks = returnCheckPayload(clean);
  booking.inspection = record.inspection;
  booking.returnOdometer = condition.odometer;
  booking.depositSettlement = record.settlement;
  if (booking.status === 'active') {
    booking.status = 'completed';
    booking.completedAt = nowISO();
  }
  const vehicle = state.vehicles.find((item) => item.id === booking.vehicleId);
  if (vehicle && vehicle.status === 'rented') vehicle.status = 'available';

  const user = booking.userId ? state.users.find((item) => item.id === booking.userId) : null;
  const charges = `₹${record.settlement.charges.toLocaleString('en-IN')}`;
  const refund = `₹${record.settlement.refundDue.toLocaleString('en-IN')}`;
  const tpl = templateFor(state.settings, 'deposit_settled');
  queueEmail(state, {
    kind: 'deposit_settled',
    email: bookingEmailFor(booking, state),
    subject: tpl.subject,
    body: tpl.body,
    meta: { code: booking.code, name: user?.name ?? booking.guestName ?? 'there', charges, refund },
  });
  if (user) {
    notify(state, {
      audience: 'user',
      userId: user.id,
      kind: 'deposit_settled',
      title: record.settlement.charges > 0 ? 'Deposit settled with deductions' : 'Deposit released',
      body: record.settlement.charges > 0
        ? `${charges} was deducted from your deposit; ${refund} is on its way back.`
        : `Your ${refund} deposit is on its way back to the original payment method.`,
      bookingCode: booking.code,
      link: `/confirmation/${booking.code}`,
    });
  }
  recordAudit(state, {
    action: 'update',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Return settled for ${booking.code} · ${record.settlement.label}`,
    metadata: {
      changed: {
        depositSettlement: { from: null, to: record.settlement },
        inspection: { from: null, to: record.inspection },
        status: { from: previousStatus, to: booking.status },
      },
    },
  });
  persist();
  return { ok: true, booking: shapeBooking(booking, state), settlement: record.settlement };
}

const guestId = (email) => `guest:${String(email ?? '').trim().toLowerCase()}`;

/** Registered customers + guests, before segmentation. */
function customerDirectory(state) {
  const registered = state.users
    .filter((user) => user.role === 'customer')
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      createdAt: user.createdAt,
      account: true,
      prefs: user.notifPrefs,
    }));
  const guests = new Map();
  state.bookings.forEach((booking) => {
    if (booking.userId || !booking.guestEmail) return;
    const id = guestId(booking.guestEmail);
    if (!guests.has(id)) {
      guests.set(id, {
        id,
        name: booking.guestName || 'Guest',
        email: booking.guestEmail,
        phone: booking.guestPhone || '',
        createdAt: booking.createdAt,
        account: false,
      });
    }
  });
  return [...registered, ...guests.values()];
}

function customerBookings(state) {
  return state.bookings.map((booking) => ({
    userId: booking.userId || guestId(booking.guestEmail),
    guestEmail: booking.guestEmail,
    status: booking.status,
    total: booking.total,
    startDate: booking.startDate,
    createdAt: booking.createdAt,
    vehicleType: state.vehicles.find((vehicle) => vehicle.id === booking.vehicleId)?.type ?? '',
    vehicleName: state.vehicles.find((vehicle) => vehicle.id === booking.vehicleId)?.name ?? booking.vehicleName ?? '',
    hub: booking.pickupLocation ?? '',
  }));
}

async function adminCustomers() {
  const state = load();
  requireStaff(state);
  const rows = segmentCustomers(customerDirectory(state), customerBookings(state));
  return {
    customers: rows.sort((a, b) => b.lifetimeValue - a.lifetimeValue),
    summary: crmSummary(rows),
  };
}

async function adminEmailCustomers({ customerIds = [], template = 'customer_message', subject, body }) {
  const state = load();
  requireStaff(state);
  const ids = [...new Set((Array.isArray(customerIds) ? customerIds : []).filter(Boolean))];
  if (!ids.length) throw new Error('Select at least one customer.');
  if (!EMAIL_TEMPLATE_KINDS.includes(template)) throw new Error('Choose a valid message template.');
  const directory = customerDirectory(state);
  const selected = directory.filter((customer) => ids.includes(customer.id));
  if (!selected.length) throw new Error('Those customers could not be found.');
  const tpl = templateFor(state.settings, template);
  const finalSubject = String(subject ?? '').trim() || tpl.subject;
  const finalBody = String(body ?? '').trim() || tpl.body;
  if (!finalSubject) throw new Error('Add a subject line.');
  if (finalSubject.length > 140) throw new Error('Keep the subject under 140 characters.');
  if (finalBody.length > 2000) throw new Error('Keep the body under 2,000 characters.');
  let sent = 0;
  const skipped = [];
  selected.forEach((customer) => {
    if (!customer.email) { skipped.push({ id: customer.id, reason: 'No email address' }); return; }
    // Opt-outs apply to campaigns too: report skipped customers honestly so
    // the desk knows who was reached and who did not receive the mail.
    const preferences = normalizeNotificationPrefs(customer.prefs ?? {});
    if (!shouldNotify(template, preferences)) {
      skipped.push({ id: customer.id, reason: 'Notification preferences' });
      return;
    }
    const meta = { name: customer.name, site: 'Rove' };
    const renderedSubject = renderTemplate(finalSubject, meta);
    const renderedBody = renderTemplate(finalBody, meta);
    queueEmail(state, {
      kind: template,
      email: customer.email,
      subject: renderedSubject,
      body: renderedBody,
      meta,
      raw: true,
    });
    if (customer.account) {
      notify(state, {
        audience: 'user',
        userId: customer.id,
        kind: template,
        title: renderedSubject,
        body: renderedBody,
        link: '/account',
      });
    }
    sent += 1;
  });
  recordAudit(state, {
    action: 'create',
    entityType: 'settings',
    entityId: template,
    summary: `Emailed ${sent} customer${sent === 1 ? '' : 's'} with “${template}”`,
    metadata: { template, sent, skipped: skipped.length },
  });
  persist();
  return { sent, skipped, total: selected.length };
}

async function adminBulkUpdateVehicles({ ids = [], status }) {
  const state = load();
  requireStaff(state);
  if (!BULK_FLEET_STATUSES.includes(status)) throw new Error('Choose a valid fleet status.');
  let updated = 0;
  const skipped = [];
  (Array.isArray(ids) ? ids : []).forEach((id) => {
    const vehicle = state.vehicles.find((item) => item.id === id);
    if (!vehicle) { skipped.push({ id, reason: 'not found' }); return; }
    if (vehicle.status === status) { skipped.push({ id: vehicle.id, reason: 'already ' + status }); return; }
    const previous = vehicle.status;
    vehicle.status = status;
    recordAudit(state, {
      action: 'bulk',
      entityType: 'vehicles',
      entityId: vehicle.name,
      summary: `Bulk marked ${status} (${ids.length} selected)`,
      metadata: { changed: { status: { from: previous, to: status } } },
    });
    updated += 1;
  });
  if (status === 'available') {
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      dispatchAvailabilityAlerts(state, { vehicleId: id, reason: 'Vehicle returned to service' });
    });
  }
  persist();
  return { updated, skipped, total: (Array.isArray(ids) ? ids : []).length };
}

async function adminEmailTemplates() {
  const state = load();
  requireStaff(state);
  const form = templatesForm(state.settings);
  return EMAIL_TEMPLATE_KINDS.map((kind) => ({
    kind,
    label: emailTemplateLabel(kind),
    subject: form[kind].subject,
    body: form[kind].body,
    custom: Boolean(String(state.settings[emailTemplateKey('subject', kind)] ?? '').trim()),
    fallbackSubject: EMAIL_TEMPLATE_DEFAULTS[kind].subject,
    fallbackBody: EMAIL_TEMPLATE_DEFAULTS[kind].body,
  }));
}

async function adminSaveEmailTemplate({ kind, subject, body }) {
  const state = load();
  requireStaff(state);
  if (!EMAIL_TEMPLATE_KINDS.includes(kind)) throw new Error('Unknown email template.');
  const nextSubject = String(subject ?? '').trim();
  const nextBody = String(body ?? '').trim();
  if (!nextSubject) throw new Error('Add a subject line.');
  if (!nextBody) throw new Error('Add a body for this email.');
  if (nextSubject.length > 140) throw new Error('Keep the subject under 140 characters.');
  if (nextBody.length > 2000) throw new Error('Keep the body under 2,000 characters.');
  const wasCustom = Boolean(String(state.settings[emailTemplateKey('subject', kind)] ?? '').trim());
  state.settings[emailTemplateKey('subject', kind)] = nextSubject;
  state.settings[emailTemplateKey('body', kind)] = nextBody;
  recordAudit(state, {
    action: 'update', entityType: 'settings', entityId: kind,
    summary: `Email template ${kind} updated`,
    metadata: { changed: { subject: { from: wasCustom ? 'custom' : 'default', to: nextSubject } } },
  });
  persist();
  return { ok: true, kind, subject: nextSubject, body: nextBody };
}

async function listAvailabilityAlerts() {
  const state = load();
  const user = requireUser(state);
  const today = todayISO();
  return (user.alerts ?? [])
    .filter((alert) => alert.active !== false && alert.endDate > today)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((alert) => {
      const vehicle = state.vehicles.find((item) => item.id === alert.vehicleId) ?? null;
      return {
        id: alert.id,
        vehicleId: alert.vehicleId,
        startDate: alert.startDate,
        endDate: alert.endDate,
        active: alert.active !== false,
        notified: Boolean(alert.notifiedAt),
        notifiedAt: alert.notifiedAt ?? null,
        matchReason: alert.matchReason ?? null,
        freeNow: Boolean(vehicle) && vehicleFreeInWindow({
          vehicle,
          startDate: alert.startDate,
          endDate: alert.endDate,
          bookings: state.bookings,
          blocks: state.vehicleBlocks ?? [],
        }),
        vehicle: vehicle ? { id: vehicle.id, name: vehicle.name, imageUrl: vehicle.imageUrl, pricePerDay: vehicle.pricePerDay, location: vehicle.location } : null,
      };
    });
}

async function createAvailabilityAlert({ vehicleId, startDate, endDate }) {
  const state = load();
  const user = requireUser(state);
  const vehicle = state.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle || vehicle.status === 'maintenance') throw new Error('That vehicle is no longer bookable.');
  if (!isValidDate(startDate) || !isValidDate(endDate) || daysBetween(startDate, endDate) < 1) {
    throw new Error('Choose a valid date window.');
  }
  if (startDate < todayISO()) throw new Error('Pick a future window.');
  const today = todayISO();
  const live = (user.alerts ?? []).filter((alert) => alert.active !== false && alert.endDate > today);
  const existing = live.some((alert) => (
    alert.vehicleId === vehicleId && alert.startDate === startDate && alert.endDate === endDate
  ));
  if (existing) throw new Error('You already have that watchlist alert.');
  if (live.length >= 10) {
    throw new Error('You can keep up to 10 watchlist alerts.');
  }
  const alert = {
    id: uid('alr'),
    vehicleId,
    startDate,
    endDate,
    active: true,
    notifiedAt: null,
    createdAt: nowISO(),
  };
  user.alerts = [...live, alert];
  persist();
  return { ok: true, alert };
}

async function deleteAvailabilityAlert({ alertId }) {
  const state = load();
  const user = requireUser(state);
  const alerts = (user.alerts ?? []).filter((alert) => !(alert.id === alertId && alert.active !== false));
  if (alerts.length === (user.alerts ?? []).length) throw new Error('Alert not found.');
  user.alerts = alerts.filter((alert) => alert.id !== alertId);
  persist();
  return { ok: true };
}

async function adminAvailabilityAlerts() {
  const state = load();
  requireStaff(state);
  return availabilityBoard({
    users: state.users,
    bookings: state.bookings,
    vehicles: state.vehicles,
    blocks: state.vehicleBlocks ?? [],
    today: todayISO(),
  });
}

async function adminDispatchAvailabilityAlerts({ alertIds = null, vehicleId = null } = {}) {
  const state = load();
  requireStaff(state);
  const result = dispatchAvailabilityAlerts(state, {
    alertIds,
    vehicleId,
    reason: 'Released by staff',
  });
  persist();
  return result;
}

/**
 * Record an in-person payment against a booking balance (desk cash/UPI/card
 * collected at pick-up, or the extra due at drop-off). The customer-facing
 * invoice stays honest because the amount reaches the payment ledger and
 * `amountPaid` in the same way an online capture would.
 */
const PAYMENT_METHODS = Object.freeze([
  { key: 'cash', label: 'Cash', brand: 'Cash' },
  { key: 'upi', label: 'UPI', brand: 'UPI' },
  { key: 'card', label: 'Card at desk', brand: 'Card' },
  { key: 'bank', label: 'Bank transfer', brand: 'Bank transfer' },
]);

async function adminRecordPayment({ bookingId, amount, method = 'cash', reference = '' } = {}) {
  const state = load();
  requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (['cancelled', 'rejected'].includes(booking.status)) throw new Error('This booking is closed.');
  const paid = Number(booking.amountPaid) || 0;
  const total = Number(booking.total) || 0;
  const balance = Math.max(0, total - paid);
  const value = Number(amount);
  if (!Number.isInteger(value) || value <= 0) throw new Error('Enter a whole-rupee amount greater than zero.');
  if (value > balance) throw new Error(`The balance is ₹${balance.toLocaleString('en-IN')} — you cannot record more than that.`);
  const chosen = PAYMENT_METHODS.find((item) => item.key === method) ?? PAYMENT_METHODS[0];
  const referenceText = String(reference ?? '').trim().slice(0, 60);

  state.payments.push({
    id: uid('pay'),
    bookingId: booking.id,
    kind: 'balance',
    amount: value,
    currency: 'INR',
    status: 'succeeded',
    brand: chosen.brand,
    last4: '',
    reference: referenceText || `cash_${uid('pay')}`,
    orderId: booking.razorpayOrderId,
    createdAt: nowISO(),
  });
  const nextPaid = paid + value;
  booking.amountPaid = Math.min(total, nextPaid);
  if (nextPaid >= total) booking.paymentStatus = 'paid';

  recordAudit(state, {
    action: 'update',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Recorded ₹${value.toLocaleString('en-IN')} ${chosen.label.toLowerCase()} payment on ${booking.code}`,
    metadata: { changed: { amountPaid: { from: paid, to: booking.amountPaid } }, payment: { from: null, to: `${chosen.label}: ${value}` } },
  });
  if (booking.userId) {
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'booking_payment_received',
      title: 'Payment received',
      body: `₹${value.toLocaleString('en-IN')} received at the desk — ${chosen.label.toLowerCase()}.`,
      bookingCode: booking.code, link: `/confirmation/${booking.code}`,
    });
  }
  notify(state, {
    audience: 'staff', kind: 'booking_payment_received',
    title: `Payment recorded on ${booking.code}`,
    body: `${chosen.label} · ₹${value.toLocaleString('en-IN')}`,
    bookingCode: booking.code, link: '/admin/bookings',
  });
  persist();
  return { ok: true, booking: shapeBooking(booking, state) };
}

async function adminRefund({ bookingId }) {
  const state = load();
  requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  const amount = Number(booking.amountPaid) || 0;
  if (amount <= 0) throw new Error('This booking has no captured payment to refund.');
  const previousStatus = booking.status;
  refundBooking(state, booking, amount);
  booking.amountPaid = 0;
  booking.paymentStatus = 'refunded';
  booking.status = 'cancelled';
  booking.cancelledAt = nowISO();
  recordAudit(state, {
    action: 'refund',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Booking ${booking.code} refunded in full`,
    metadata: { changed: { amountPaid: { from: amount, to: 0 }, status: { from: previousStatus, to: 'cancelled' } } },
  });
  if (booking.userId) {
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'booking_refunded',
      title: 'Refund issued',
      body: `₹${amount.toLocaleString('en-IN')} is returning to your original payment method.`,
      bookingCode: booking.code, link: `/confirmation/${booking.code}`,
    });
  }
  notify(state, {
    audience: 'staff', kind: 'booking_refunded',
    title: `Refund issued on ${booking.code}`,
    body: `₹${amount.toLocaleString('en-IN')} refunded in full`,
    bookingCode: booking.code, link: '/admin/bookings',
  });
  queueEmail(state, {
    kind: 'booking_refunded',
    email: bookingEmailFor(booking, state),
    subject: `Refund issued for ${booking.code}`,
    body: `A full refund of ₹${amount.toLocaleString('en-IN')} is being returned to the original payment method for booking ${booking.code}.`,
    meta: { code: booking.code, refundAmount: amount },
  });
  dispatchAvailabilityAlerts(state, {
    vehicleId: booking.vehicleId,
    reason: `Booking ${booking.code} was cancelled`,
  });
  persist();
  return { refundAmount: amount, booking: shapeBooking(booking, state), message: 'Payment refunded in full.' };
}

/**
 * Refund only the overpayment created by a downward reprice. Unlike
 * `adminRefund`, this never cancels the trip — the customer keeps the booking
 * and gets the difference back.
 */
async function adminRefundCredit({ bookingId } = {}) {
  const state = load();
  requireStaff(state);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) throw new Error('Booking not found.');
  if (['cancelled', 'rejected'].includes(booking.status)) throw new Error('This booking is closed.');
  const paid = Number(booking.amountPaid) || 0;
  const total = Number(booking.total) || 0;
  const credit = Math.max(0, paid - total);
  if (credit <= 0) throw new Error('This booking has no customer credit to refund.');

  refundBooking(state, booking, credit);
  booking.amountPaid = total;
  booking.paymentStatus = total > 0 ? 'paid' : 'unpaid';
  recordAudit(state, {
    action: 'refund',
    entityType: 'bookings',
    entityId: booking.code,
    summary: `Refunded ₹${credit.toLocaleString('en-IN')} customer credit on ${booking.code}`,
    metadata: { changed: { amountPaid: { from: paid, to: total } }, credit: { from: credit, to: 0 } },
  });
  if (booking.userId) {
    notify(state, {
      audience: 'user', userId: booking.userId, kind: 'booking_refunded',
      title: 'Credit refunded',
      body: `₹${credit.toLocaleString('en-IN')} is returning to your original payment method.`,
      bookingCode: booking.code, link: `/confirmation/${booking.code}`,
    });
  }
  notify(state, {
    audience: 'staff', kind: 'booking_refunded',
    title: `Credit refunded on ${booking.code}`,
    body: `₹${credit.toLocaleString('en-IN')} returned`,
    bookingCode: booking.code, link: '/admin/bookings',
  });
  queueEmail(state, {
    kind: 'booking_refunded',
    email: bookingEmailFor(booking, state),
    subject: `Credit refunded for ${booking.code}`,
    body: `₹${credit.toLocaleString('en-IN')} of credit from your booking change is being returned to the original payment method for ${booking.code}.`,
    meta: { code: booking.code, refundAmount: credit },
  });
  persist();
  return { refundAmount: credit, booking: shapeBooking(booking, state), message: 'Customer credit refunded.' };
}

async function adminVehicleBlocks({ from = null, to = null } = {}) {
  const state = load();
  requireStaff(state);
  let blocks = [...(state.vehicleBlocks ?? [])];
  if (from && to && isValidDate(from) && isValidDate(to)) {
    blocks = blocks.filter((block) => block.startDate < to && block.endDate > from);
  }
  return blocks
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || String(a.vehicleId).localeCompare(String(b.vehicleId)))
    .map((block) => shapeVehicleBlock(block, state));
}

async function adminSaveVehicleBlock(payload = {}) {
  const state = load();
  const actor = requireStaff(state);
  const vehicle = state.vehicles.find((item) => item.id === payload.vehicleId);
  if (!vehicle) throw new Error('Choose a vehicle to block.');
  const startDate = String(payload.startDate ?? '');
  const endDate = String(payload.endDate ?? '');
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    throw new Error('Choose valid block start and end dates.');
  }
  if (startDate >= endDate) throw new Error('The block must end after it starts.');
  const kind = BLOCK_KINDS.includes(payload.kind) ? payload.kind : 'maintenance';
  const reason = String(payload.reason ?? '').trim().slice(0, 120)
    || (kind === 'maintenance' ? 'Scheduled maintenance' : kind === 'private' ? 'Internal use' : kind === 'buffer' ? 'Turnaround buffer' : 'Unavailable');
  const notes = String(payload.notes ?? '').trim().slice(0, 600);

  const bookingConflict = state.bookings.find((booking) => (
    booking.vehicleId === vehicle.id
    && ['pending', 'confirmed', 'active'].includes(booking.status)
    && booking.startDate < endDate
    && booking.endDate > startDate
  ));
  if (bookingConflict) {
    throw new Error(`Those dates overlap active booking ${bookingConflict.code}. Move or cancel the booking first.`);
  }
  const blockConflict = blockForRange(state, vehicle.id, startDate, endDate, payload.id ?? null);
  if (blockConflict) {
    throw new Error('This vehicle already has a block that overlaps those dates.');
  }

  let block = null;
  if (payload.id) {
    block = (state.vehicleBlocks ?? []).find((item) => item.id === payload.id);
    if (!block) throw new Error('Availability block not found.');
    Object.assign(block, {
      vehicleId: vehicle.id,
      startDate,
      endDate,
      kind,
      reason,
      notes,
      updatedAt: nowISO(),
    });
  } else {
    block = {
      id: uid('blk'),
      vehicleId: vehicle.id,
      startDate,
      endDate,
      kind,
      reason,
      notes,
      createdBy: actor.id,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    state.vehicleBlocks ??= [];
    state.vehicleBlocks.push(block);
  }

  const label = {
    maintenance: 'Maintenance', private: 'Internal use', buffer: 'Turnaround buffer', other: 'Unavailable',
  }[kind];
  recordAudit(state, {
    action: payload.id ? 'update' : 'insert',
    entityType: 'vehicle_blocks',
    entityId: block.id,
    summary: `${label} block · ${vehicle.name} · ${startDate} → ${endDate}`,
    metadata: {
      changed: {
        startDate: { from: null, to: startDate },
        endDate: { from: null, to: endDate },
        kind: { from: null, to: kind },
      },
    },
  });
  persist();
  return shapeVehicleBlock(block, state);
}

async function adminDeleteVehicleBlock(id) {
  const state = load();
  requireStaff(state);
  const block = (state.vehicleBlocks ?? []).find((item) => item.id === id);
  if (!block) throw new Error('Availability block not found.');
  state.vehicleBlocks = state.vehicleBlocks.filter((item) => item.id !== id);
  recordAudit(state, {
    action: 'delete',
    entityType: 'vehicle_blocks',
    entityId: block.id,
    summary: `Availability block removed · ${block.startDate} → ${block.endDate}`,
    metadata: { changed: {} },
  });
  dispatchAvailabilityAlerts(state, {
    vehicleId: block.vehicleId,
    reason: 'Availability block removed',
  });
  persist();
  return { ok: true };
}

async function adminServiceLogs({ vehicleId = null } = {}) {
  const state = load();
  requireStaff(state);
  return (state.serviceLogs ?? [])
    .filter((log) => !vehicleId || log.vehicleId === vehicleId)
    .sort((a, b) => String(b.serviceDate).localeCompare(String(a.serviceDate))
      || String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((log) => shapeServiceLog(log, state));
}

async function adminSaveServiceLog(payload = {}) {
  const state = load();
  const actor = requireStaff(state);
  const vehicle = state.vehicles.find((item) => item.id === payload.vehicleId);
  if (!vehicle) throw new Error('Choose a vehicle to service.');
  const result = serviceEntry(payload, vehicle);
  if (!result.ok) throw new Error(result.problem);

  const log = {
    id: uid('svc'),
    vehicleId: vehicle.id,
    ...result.value,
    createdBy: actor.id,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  state.serviceLogs ??= [];
  state.serviceLogs.unshift(log);

  Object.assign(vehicle, applyServiceEntry(vehicle, result.value));
  if (payload.returnToService && vehicle.status === 'maintenance') {
    vehicle.status = 'available';
    dispatchAvailabilityAlerts(state, { vehicleId: vehicle.id, reason: 'Vehicle returned after service' });
  }

  recordAudit(state, {
    action: 'insert',
    entityType: 'vehicle_service_logs',
    entityId: log.id,
    summary: `${result.value.kind === 'repair' ? 'Repair' : 'Service'} logged · ${vehicle.name} · ₹${result.value.cost.toLocaleString('en-IN')}`,
    metadata: {
      changed: {
        odometer: { from: null, to: result.value.odometer },
        lastServiceDate: { from: null, to: result.value.resetsService ? result.value.serviceDate : null },
        status: { from: null, to: vehicle.status },
      },
    },
  });
  persist();
  return shapeServiceLog(log, state);
}

async function adminDeleteServiceLog(id) {
  const state = load();
  requireAdmin(state);
  const log = (state.serviceLogs ?? []).find((item) => item.id === id);
  if (!log) throw new Error('Service entry not found.');
  const vehicle = state.vehicles.find((item) => item.id === log.vehicleId);
  state.serviceLogs = state.serviceLogs.filter((item) => item.id !== id);

  if (vehicle && log.resetsService) {
    const remaining = state.serviceLogs
      .filter((item) => item.vehicleId === vehicle.id && item.resetsService)
      .sort((a, b) => String(b.serviceDate).localeCompare(String(a.serviceDate)));
    vehicle.lastServiceDate = remaining[0]?.serviceDate ?? null;
    vehicle.lastServiceOdometer = remaining[0]?.odometer ?? null;
  }

  recordAudit(state, {
    action: 'delete',
    entityType: 'vehicle_service_logs',
    entityId: log.id,
    summary: `Service entry removed · ${vehicle?.name ?? log.vehicleId} · ${log.serviceDate}`,
    metadata: { changed: {} },
  });
  persist();
  return { ok: true };
}

async function adminSetOdometer({ vehicleId, odometer, note = '' } = {}) {
  const state = load();
  const actor = requireStaff(state);
  const vehicle = state.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) throw new Error('Vehicle not found.');
  const problem = odometerProblem(odometer, vehicle);
  if (problem) throw new Error(problem);
  const previous = vehicle.odometer;
  vehicle.odometer = Math.round(Number(odometer));
  recordAudit(state, {
    action: 'update',
    entityType: 'vehicles',
    entityId: vehicle.id,
    summary: `Odometer updated · ${vehicle.name} · ${vehicle.odometer.toLocaleString('en-IN')} km`,
    metadata: { changed: { odometer: { from: previous ?? null, to: vehicle.odometer } }, note: String(note ?? '').trim().slice(0, 240), actor: actor.name },
  });
  persist();
  return decorateVehicle(vehicle, state);
}

async function adminAuditLogs({ limit = 300 } = {}) {
  const state = load();
  requireAdmin(state);
  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  return [...(state.auditLogs ?? [])]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, safeLimit)
    .map((entry) => clone(entry));
}

async function adminVehicles() {
  const state = load();
  requireStaff(state);
  return state.vehicles
    .map((vehicle) => ({
      ...decorateVehicle(vehicle, state),
      // Staff see the real review count even when reviews are hidden on the
      // storefront; decorateVehicle zeroes it for the public shape.
      reviewCount: state.reviews.filter((review) => review.vehicleId === vehicle.id).length,
    }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || a.name.localeCompare(b.name));
}

async function adminSaveVehicle(payload) {
  const state = load();
  requireStaff(state);
  const required = ['name', 'brand', 'type', 'pricePerDay', 'location'];
  for (const field of required) {
    if (!payload[field]) throw new Error('Please complete all required vehicle fields.');
  }
  const images = Array.isArray(payload.images) && payload.images.length
    ? payload.images.filter(Boolean)
    : [payload.imageUrl].filter(Boolean);
  if (images.length > 8) throw new Error('Use no more than 8 images per vehicle.');
  const badImage = images.find((image) => urlProblem(image));
  if (badImage) throw new Error('Vehicle images must be valid http(s) URLs or uploaded files.');
  const imageUrl = images[0];
  if (!imageUrl) throw new Error('At least one vehicle image is required.');

  const kind = payload.kind === 'bike' ? 'bike' : 'car';
  if (kind === 'bike' && !payload.gears) {
    throw new Error('Please choose the gearbox for this bike.');
  }

  const odometer = payload.odometer === '' || payload.odometer === null || payload.odometer === undefined
    ? null
    : Number(payload.odometer);
  if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) {
    throw new Error('Enter a valid odometer reading.');
  }
  const lastServiceDate = payload.lastServiceDate ? String(payload.lastServiceDate).slice(0, 10) : null;
  if (lastServiceDate && !isValidDate(lastServiceDate)) {
    throw new Error('Choose a valid last-service date.');
  }
  if (lastServiceDate && lastServiceDate > todayISO()) {
    throw new Error('Last-service date cannot be in the future.');
  }
  const lastServiceOdometer = payload.lastServiceOdometer === '' || payload.lastServiceOdometer === null || payload.lastServiceOdometer === undefined
    ? null
    : Number(payload.lastServiceOdometer);
  if (lastServiceOdometer !== null && (!Number.isFinite(lastServiceOdometer) || lastServiceOdometer < 0)) {
    throw new Error('Enter a valid last-service odometer.');
  }
  if (odometer !== null && lastServiceOdometer !== null && lastServiceOdometer > odometer) {
    throw new Error('The last-service odometer cannot be higher than the current odometer.');
  }
  const serviceIntervalKm = payload.serviceIntervalKm === undefined || payload.serviceIntervalKm === ''
    ? (kind === 'bike' ? 4000 : 10000)
    : Number(payload.serviceIntervalKm);
  const serviceIntervalDays = payload.serviceIntervalDays === undefined || payload.serviceIntervalDays === ''
    ? (kind === 'bike' ? 120 : 180)
    : Number(payload.serviceIntervalDays);
  if (!Number.isFinite(serviceIntervalKm) || serviceIntervalKm <= 0) {
    throw new Error('Service interval distance must be greater than zero.');
  }
  if (!Number.isFinite(serviceIntervalDays) || serviceIntervalDays <= 0) {
    throw new Error('Service interval days must be greater than zero.');
  }
  const pricePerDay = Number(payload.pricePerDay);
  if (!Number.isFinite(pricePerDay) || pricePerDay < 500 || pricePerDay > 200000) {
    throw new Error('Daily price must be between ₹500 and ₹2,00,000.');
  }
  if (!Number.isInteger(pricePerDay)) {
    throw new Error('Daily price must be a whole rupee amount.');
  }
  const minAge = payload.minAge === '' || payload.minAge === null || payload.minAge === undefined
    ? (kind === 'bike' ? 18 : 21)
    : Number(payload.minAge);
  if (!Number.isInteger(minAge) || minAge < 16 || minAge > 90) {
    throw new Error('Minimum age must be a whole number between 16 and 90.');
  }
  const docProblems = fleetDocProblems(payload);
  const firstDocProblem = Object.values(docProblems)[0];
  if (firstDocProblem) throw new Error(firstDocProblem);
  const kmProblems = kmVehicleProblems(payload);
  const firstKmProblem = Object.values(kmProblems)[0];
  if (firstKmProblem) throw new Error(firstKmProblem);
  const km = kmTerms(payload);

  const clean = {
    name: String(payload.name).trim(),
    brand: String(payload.brand).trim(),
    kind,
    type: payload.type,
    year: Number(payload.year) || new Date().getFullYear(),
    seats: Number(payload.seats) || (kind === 'bike' ? 2 : 5),
    luggage: Number(payload.luggage) || (kind === 'bike' ? 1 : 2),
    transmission: payload.transmission || 'Automatic',
    fuel: payload.fuel || 'Petrol',
    awd: Boolean(payload.awd),
    efficiency: payload.efficiency || payload.mileage || '',
    engineCc: kind === 'bike' && payload.engineCc ? Number(payload.engineCc) : (payload.engineCc ? Number(payload.engineCc) : null),
    mileage: payload.mileage || payload.efficiency || '',
    gears: kind === 'bike'
      ? (payload.gears || 'Manual')
      : (payload.gears || payload.transmission || 'Automatic'),
    helmetCount: kind === 'bike' ? Number(payload.helmetCount ?? 2) : 0,
    licenseClass: payload.licenseClass || (kind === 'bike' ? 'MCWG' : 'LMV'),
    minAge,
    registrationNumber: String(payload.registrationNumber ?? '').trim().slice(0, 24),
    insuranceExpiry: payload.insuranceExpiry ? String(payload.insuranceExpiry).slice(0, 10) : null,
    pucExpiry: payload.pucExpiry ? String(payload.pucExpiry).slice(0, 10) : null,
    pricePerDay,
    kmCap: km.kmCap,
    kmExtraRate: km.kmExtraRate,
    location: payload.location,
    imageUrl,
    images,
    description: payload.description || '',
    features: Array.isArray(payload.features)
      ? payload.features
      : String(payload.features || '').split(',').map((feature) => feature.trim()).filter(Boolean),
    status: payload.status || 'available',
    featured: Boolean(payload.featured),
    displayOrder: Math.max(0, Math.round(Number(payload.displayOrder) || 0)),
    badge: String(payload.badge ?? '').trim().slice(0, 24),
    odometer,
    serviceIntervalKm: Math.round(serviceIntervalKm),
    serviceIntervalDays: Math.round(serviceIntervalDays),
    lastServiceDate,
    lastServiceOdometer,
  };

  if (payload.id) {
    const vehicle = state.vehicles.find((item) => item.id === payload.id);
    if (!vehicle) throw new Error('Vehicle not found.');
    const previousOdometer = vehicle.odometer;
    if (odometer !== null && previousOdometer !== null && odometer < previousOdometer) {
      throw new Error(`Odometer cannot be lower than the current reading (${Number(previousOdometer).toLocaleString('en-IN')} km).`);
    }
    const previousStatus = vehicle.status;
    Object.assign(vehicle, clean);
    recordAudit(state, {
      action: 'update',
      entityType: 'vehicles',
      entityId: vehicle.id,
      summary: `${vehicle.name} updated`,
      metadata: {
        changed: {
          pricePerDay: { from: null, to: vehicle.pricePerDay },
          status: { from: previousStatus, to: vehicle.status },
          odometer: { from: previousOdometer ?? null, to: vehicle.odometer ?? null },
        },
      },
    });
    if (previousStatus !== 'available' && vehicle.status === 'available') {
      dispatchAvailabilityAlerts(state, { vehicleId: vehicle.id, reason: 'Vehicle returned to service' });
    }
    persist();
    return decorateVehicle(vehicle, state);
  }

  const vehicle = {
    id: uid('veh'),
    ...clean,
    rating: 4.8,
    trips: 0,
    createdAt: nowISO(),
  };
  state.vehicles.push(vehicle);
  recordAudit(state, {
    action: 'insert',
    entityType: 'vehicles',
    entityId: vehicle.id,
    summary: `${vehicle.name} added to the fleet`,
    metadata: { changed: { status: { from: null, to: vehicle.status } } },
  });
  persist();
  return decorateVehicle(vehicle, state);
}

async function adminDeleteVehicle(id) {
  const state = load();
  requireStaff(state);
  if (state.bookings.some((booking) => booking.vehicleId === id)) {
    throw new Error('This vehicle has booking history. Set it to maintenance instead of deleting.');
  }
  const vehicle = state.vehicles.find((item) => item.id === id);
  state.vehicles = state.vehicles.filter((item) => item.id !== id);
  state.favorites = state.favorites.filter((favorite) => favorite.vehicleId !== id);
  if (vehicle) {
    recordAudit(state, {
      action: 'delete',
      entityType: 'vehicles',
      entityId: vehicle.id,
      summary: `${vehicle.name} removed from the fleet`,
      metadata: { changed: {} },
    });
  }
  persist();
}

async function adminExtras() {
  const state = load();
  requireStaff(state);
  return clone(state.extras);
}

async function adminInsuranceTiers() {
  const state = load();
  requireStaff(state);
  const order = { basic: 0, standard: 1, full: 2 };
  return clone(state.insuranceTiers).sort((a, b) => (order[a.key] ?? 9) - (order[b.key] ?? 9));
}

async function adminSaveInsuranceTier(payload) {
  const state = load();
  requireStaff(state);
  const tier = state.insuranceTiers.find((item) => item.key === payload.key);
  if (!tier) throw new Error('Insurance tier not found.');
  const label = String(payload.label ?? '').trim();
  if (label.length < 2) throw new Error('Add a label for this tier.');
  if (label.length > 40) throw new Error('Keep the tier label under 40 characters.');
  const price = Number(payload.pricePerDay);
  if (!Number.isFinite(price) || price < 0 || price > 100000) {
    throw new Error('Daily protection price must be between ₹0 and ₹1,00,000.');
  }
  const deductible = Number(payload.deductible);
  if (!Number.isFinite(deductible) || deductible < 0 || deductible > 10000000) {
    throw new Error('Deductible must be between ₹0 and ₹1,00,00,000.');
  }
  const blurb = String(payload.blurb ?? '').trim();
  if (blurb.length > 200) throw new Error('Keep the tier description under 200 characters.');
  if (payload.active === false && !state.insuranceTiers.some((item) => item.key !== tier.key && item.active)) {
    throw new Error('Keep at least one protection tier active.');
  }
  Object.assign(tier, {
    label,
    pricePerDay: Math.round(price),
    deductible: Math.round(deductible),
    blurb,
    active: payload.active !== false,
  });
  recordAudit(state, {
    action: 'update',
    entityType: 'insurance_tiers',
    entityId: tier.key,
    summary: `${tier.label} protection tier updated`,
    metadata: { changed: { pricePerDay: { from: null, to: tier.pricePerDay }, active: { from: null, to: tier.active } } },
  });
  persist();
  return clone(tier);
}

async function adminSaveExtra(payload) {
  const state = load();
  requireStaff(state);
  if (!payload.label) throw new Error('Extra label is required.');
  const price = Number(payload.pricePerDay);
  if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid daily price.');
  let savedExtra = null;
  if (payload.id) {
    const extra = state.extras.find((item) => item.id === payload.id);
    if (!extra) throw new Error('Extra not found.');
    Object.assign(extra, {
      label: payload.label,
      description: payload.description || '',
      pricePerDay: Math.round(price),
      active: payload.active !== false,
    });
    savedExtra = extra;
  } else {
    const key = String(payload.key || payload.label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (state.extras.some((item) => item.key === key)) throw new Error('An extra with that key already exists.');
    savedExtra = {
      id: uid('ext'),
      key,
      label: payload.label,
      description: payload.description || '',
      pricePerDay: Math.round(price),
      active: payload.active !== false,
    };
    state.extras.push(savedExtra);
  }
  recordAudit(state, {
    action: payload.id ? 'update' : 'insert',
    entityType: 'extras',
    entityId: savedExtra.id,
    summary: `${savedExtra.label} extra ${payload.id ? 'updated' : 'added'}`,
    metadata: { changed: { pricePerDay: { from: null, to: savedExtra.pricePerDay }, active: { from: null, to: savedExtra.active } } },
  });
  persist();
  return adminExtras();
}

async function adminDeleteExtra(id) {
  const state = load();
  requireStaff(state);
  const extra = state.extras.find((item) => item.id === id);
  state.extras = state.extras.filter((item) => item.id !== id);
  if (extra) {
    recordAudit(state, {
      action: 'delete',
      entityType: 'extras',
      entityId: extra.id,
      summary: `${extra.label} extra removed`,
      metadata: { changed: {} },
    });
  }
  persist();
}

async function adminPromos() {
  const state = load();
  requireStaff(state);
  return clone(state.promos).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function adminSavePromo(payload) {
  const state = load();
  requireStaff(state);
  const code = String(payload.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new Error('Code must be 3–20 letters or numbers.');
  const value = Number(payload.value);
  if (!Number.isInteger(value) || value <= 0) throw new Error('Enter a whole discount value.');
  if (payload.type === 'percent' && value > 90) throw new Error('Percentage discounts cannot exceed 90%.');
  let savedPromo = null;
  if (payload.id) {
    const promo = state.promos.find((item) => item.id === payload.id);
    if (!promo) throw new Error('Promo not found.');
    Object.assign(promo, {
      code,
      description: payload.description || '',
      type: payload.type || promo.type,
      value: Math.round(value),
      minDays: Number(payload.minDays) || 1,
      active: payload.active !== false,
      expiresAt: payload.expiresAt || null,
      usageLimit: Number(payload.usageLimit) || 0,
      firstBookingOnly: Boolean(payload.firstBookingOnly),
    });
    savedPromo = promo;
  } else {
    if (state.promos.some((promo) => promo.code === code)) throw new Error('That promo code already exists.');
    savedPromo = {
      id: uid('promo'),
      code,
      description: payload.description || '',
      type: payload.type || 'percent',
      value: Math.round(value),
      minDays: Number(payload.minDays) || 1,
      active: payload.active !== false,
      expiresAt: payload.expiresAt || null,
      usageLimit: Number(payload.usageLimit) || 0,
      firstBookingOnly: Boolean(payload.firstBookingOnly),
      usedCount: 0,
      createdAt: nowISO(),
    };
    state.promos.push(savedPromo);
  }
  recordAudit(state, {
    action: payload.id ? 'update' : 'insert',
    entityType: 'promos',
    entityId: savedPromo.code,
    summary: `Promo ${savedPromo.code} ${payload.id ? 'updated' : 'created'}`,
    metadata: { changed: { value: { from: null, to: savedPromo.value }, active: { from: null, to: savedPromo.active } } },
  });
  persist();
  return adminPromos();
}

async function adminDeletePromo(id) {
  const state = load();
  requireStaff(state);
  const promo = state.promos.find((item) => item.id === id);
  state.promos = state.promos.filter((item) => item.id !== id);
  if (promo) {
    recordAudit(state, {
      action: 'delete',
      entityType: 'promos',
      entityId: promo.code,
      summary: `Promo ${promo.code} deleted`,
      metadata: { changed: {} },
    });
  }
  persist();
}

async function adminLocations() {
  const state = load();
  requireStaff(state);
  return clone(state.locations).sort((a, b) => a.name.localeCompare(b.name));
}

async function adminSaveLocation(payload) {
  const state = load();
  requireStaff(state);
  const name = String(payload.name ?? '').trim();
  if (name.length < 3) throw new Error('Location name is required.');
  if (name.length > 80) throw new Error('Location name must be 80 characters or fewer.');
  if (state.locations.some((item) => item.id !== payload.id && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('A hub with this name already exists.');
  }
  const phoneError = phoneProblem(payload.phone);
  if (phoneError) throw new Error(phoneError);
  const coordError = coordinatesProblem(payload.lat, payload.lng);
  if (coordError) throw new Error(coordError);
  const { lat, lng } = normalizeCoordinates(payload.lat, payload.lng);
  const clean = {
    name,
    address: String(payload.address ?? '').trim(),
    city: String(payload.city ?? '').trim(),
    region: String(payload.region ?? '').trim(),
    lat,
    lng,
    phone: String(payload.phone ?? '').trim(),
    hours: String(payload.hours ?? '').trim() || 'Mon–Sun, 8:00–20:00',
    active: payload.active !== false,
  };
  let savedLocation = null;
  if (payload.id) {
    const location = state.locations.find((item) => item.id === payload.id);
    if (!location) throw new Error('Location not found.');
    if (location.name !== name && (
      state.vehicles.some((vehicle) => vehicle.location === location.name)
      || state.bookings.some((booking) => booking.pickupLocation === location.name || booking.dropoffLocation === location.name)
    )) {
      throw new Error('This hub is already used by vehicles or bookings. Create a new hub instead of renaming it.');
    }
    Object.assign(location, clean);
    savedLocation = location;
  } else {
    savedLocation = { id: uid('loc'), ...clean };
    state.locations.push(savedLocation);
  }
  recordAudit(state, {
    action: payload.id ? 'update' : 'insert',
    entityType: 'locations',
    entityId: savedLocation.id,
    summary: `${savedLocation.name} hub ${payload.id ? 'updated' : 'created'}`,
    metadata: { changed: { active: { from: null, to: savedLocation.active } } },
  });
  persist();
  return adminLocations();
}

async function adminDeleteLocation(id) {
  const state = load();
  requireStaff(state);
  const location = state.locations.find((item) => item.id === id);
  if (location && (
    state.vehicles.some((vehicle) => vehicle.location === location.name)
    || state.bookings.some((booking) => booking.pickupLocation === location.name || booking.dropoffLocation === location.name)
  )) {
    throw new Error('This hub has vehicles or bookings attached. Mark it inactive instead.');
  }
  state.locations = state.locations.filter((item) => item.id !== id);
  if (location) {
    recordAudit(state, {
      action: 'delete',
      entityType: 'locations',
      entityId: location.id,
      summary: `${location.name} hub deleted`,
      metadata: { changed: {} },
    });
  }
  persist();
}

async function adminUsers() {
  const state = load();
  requireAdmin(state);
  return state.users.map((user) => ({
    ...publicUser(user),
    bookings: state.bookings.filter((booking) => booking.userId === user.id).length,
    spend: state.bookings
      .filter((booking) => booking.userId === user.id && booking.status === 'completed')
      .reduce((sum, booking) => sum + booking.total, 0),
  }));
}

async function adminUpdateUser(id, patch) {
  const state = load();
  const admin = requireAdmin(state);
  if (id === admin.id) throw new Error('You cannot change your own role or status.');
  const user = state.users.find((item) => item.id === id);
  if (!user) throw new Error('User not found.');
  if (patch.role && !['customer', 'manager', 'admin'].includes(patch.role)) throw new Error('Invalid role.');
  if (patch.status && !['active', 'suspended'].includes(patch.status)) throw new Error('Invalid status.');
  if (user.role === 'admin' && (patch.role && patch.role !== 'admin' || patch.status === 'suspended')) {
    const admins = state.users.filter((item) => item.role === 'admin' && item.status === 'active').length;
    if (admins <= 1) throw new Error('There must always be at least one active super admin.');
  }
  const previous = { role: user.role, status: user.status };
  if (patch.role) user.role = patch.role;
  if (patch.status) user.status = patch.status;
  recordAudit(state, {
    action: 'update',
    entityType: 'profiles',
    entityId: user.id,
    summary: `${user.name} account updated`,
    metadata: {
      changed: {
        ...(previous.role !== user.role ? { role: { from: previous.role, to: user.role } } : {}),
        ...(previous.status !== user.status ? { status: { from: previous.status, to: user.status } } : {}),
      },
    },
  });
  persist();
  emitAuth();
  return publicUser(user);
}

async function adminVerifyLicence(id, verified) {
  const state = load();
  requireStaff(state);
  const user = state.users.find((item) => item.id === id);
  if (!user) throw new Error('User not found.');
  const previous = user.licenceVerified;
  user.licenceVerified = Boolean(verified);
  recordAudit(state, {
    action: 'update',
    entityType: 'profiles',
    entityId: user.id,
    summary: `${user.name} licence ${user.licenceVerified ? 'verified' : 'unverified'}`,
    metadata: { changed: { licenceVerified: { from: previous, to: user.licenceVerified } } },
  });
  persist();
  emitAuth();
  return { id, licenceVerified: user.licenceVerified };
}

async function adminLicenceUrl(path) {
  const state = load();
  requireStaff(state);
  if (!path) throw new Error('No licence scan is on file.');
  return path;
}

async function adminSettings() {
  const state = load();
  requireStaff(state);
  return { ...state.settings };
}

async function adminSaveSettings(patch) {
  const state = load();
  requireAdmin(state);
  const ruleError = Object.values(rateRulePatchErrors(patch))[0];
  if (ruleError) throw new Error(ruleError);
  const changed = Object.entries(patch)
    .filter(([key, value]) => String(state.settings[key] ?? '') !== String(value ?? ''))
    .map(([key, value]) => ({ key, from: state.settings[key] ?? null, to: value }));
  state.settings = { ...state.settings, ...patch };
  changed.forEach(({ key, from, to }) => {
    recordAudit(state, {
      action: 'update',
      entityType: 'settings',
      entityId: key,
      summary: `Setting ${key} updated`,
      metadata: { changed: { value: { from, to: String(to ?? '') } } },
    });
  });
  persist();
  return { ...state.settings };
}

function readImageFile(file, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Choose an image to upload.'));
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Use a JPG, PNG or WebP image.'));
    if (file.size > maxBytes) {
      return reject(new Error(`Images must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`));
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
    return undefined;
  });
}

async function uploadVehicleImage(file) {
  return readImageFile(file, 1 * 1024 * 1024);
}

/**
 * Licence verification (KYC). Stores the scan against the signed-in user and
 * marks the licence as verified. Demo verification is instant — there is no
 * external KYC provider in local mode. Production uploads land in the private
 * 'licences' bucket for staff review.
 */
async function uploadLicence(file) {
  const state = load();
  const user = requireUser(state);
  const url = await readImageFile(file, 1 * 1024 * 1024);
  user.licenceVerified = true;
  user.licenceUrl = url;
  persist();
  emitAuth();
  return { url, verified: true };
}

const CONTACT_STATUSES = ['new', 'read', 'resolved'];
const CONTACT_SUBJECTS = ['General', 'Booking & payment', 'Trip changes', 'Deposits & refunds', 'Group & corporate', 'Feedback'];

/** Contact form submitted on /contact. Stored for the staff inbox. */
async function submitContact(payload) {
  const name = String(payload?.name ?? '').trim();
  const email = String(payload?.email ?? '').trim().toLowerCase();
  const phone = String(payload?.phone ?? '').trim();
  const message = String(payload?.message ?? '').trim();
  const bookingCode = String(payload?.bookingCode ?? '').trim().toUpperCase().slice(0, 16);
  const subject = CONTACT_SUBJECTS.includes(payload?.subject) ? payload.subject : 'General';
  if (name.length < 2) throw new Error('Please share your name so we know who to reply to.');
  if (!isEmail(email)) throw new Error('Please enter a valid email address.');
  const phoneError = phoneProblem(phone);
  if (phoneError) throw new Error(phoneError);
  if (message.length < 10) throw new Error('Please add a little more detail so we can help.');
  if (bookingCode && !/^[A-Z0-9-]{4,16}$/.test(bookingCode)) throw new Error('That booking code does not look right.');
  const state = load();
  state.contactMessages = state.contactMessages ?? [];
  state.contactMessages.push({
    id: uid('msg'),
    name: name.slice(0, 80),
    email: email.slice(0, 160),
    phone: phone.slice(0, 32),
    message: message.slice(0, 1200),
    bookingCode,
    subject,
    status: 'new',
    staffNotes: '',
    createdAt: nowISO(),
    updatedAt: nowISO(),
  });
  persist();
  return { ok: true, bookingCode };
}

async function adminContactMessages() {
  const state = load();
  requireStaff(state);
  return [...(state.contactMessages ?? [])].sort((a, b) => (
    String(b.createdAt).localeCompare(String(a.createdAt))
  ));
}

async function adminUpdateContactMessage({ id, status, staffNotes, subject } = {}) {
  const state = load();
  requireStaff(state);
  const message = (state.contactMessages ?? []).find((item) => item.id === id);
  if (!message) throw new Error('Message not found.');
  if (status !== undefined) {
    if (!CONTACT_STATUSES.includes(status)) throw new Error('Choose a valid message status.');
    message.status = status;
  }
  if (subject !== undefined) {
    if (!CONTACT_SUBJECTS.includes(subject)) throw new Error('Choose a valid subject.');
    message.subject = subject;
  }
  if (staffNotes !== undefined) message.staffNotes = String(staffNotes).trim().slice(0, 1200);
  message.updatedAt = nowISO();
  recordAudit(state, {
    action: 'update',
    entityType: 'contact_messages',
    entityId: message.id,
    summary: `Inbox message from ${message.name} updated`,
    metadata: { changed: { status: { from: null, to: message.status } } },
  });
  persist();
  return { ...message };
}

async function adminDeleteContactMessage(id) {
  const state = load();
  requireStaff(state);
  const before = (state.contactMessages ?? []).length;
  const message = (state.contactMessages ?? []).find((item) => item.id === id);
  state.contactMessages = (state.contactMessages ?? []).filter((item) => item.id !== id);
  if (state.contactMessages.length === before) throw new Error('Message not found.');
  recordAudit(state, {
    action: 'delete',
    entityType: 'contact_messages',
    entityId: id,
    summary: `Inbox message from ${message?.name ?? 'unknown sender'} deleted`,
    metadata: { changed: {} },
  });
  persist();
  return { ok: true };
}

export const demoApi = {
  mode: 'demo',
  getSession,
  onAuthStateChange,
  signIn,
  signUp,
  signOut,
  updateProfile,
  getNotificationPreferences,
  updateNotificationPreferences,
  submitChangeRequest,
  extendTrip,
  cancelChangeRequest,
  resolveChangeRequest,
  adminBulkUpdateBookings,
  adminDeskBookings,
  adminSaveDeskChecks,
  adminCollectDeposit,
  adminStartTrip,
  adminMarkNoShow,
  adminReturnBookings,
  adminSaveReturnChecks,
  adminSettleReturn,
  sendReturnReminder,
  sendPickupReminder,
  adminBulkUpdateVehicles,
  adminCustomers,
  adminEmailCustomers,
  adminEmailTemplates,
  adminSaveEmailTemplate,
  listAvailabilityAlerts,
  createAvailabilityAlert,
  deleteAvailabilityAlert,
  adminAvailabilityAlerts,
  adminDispatchAvailabilityAlerts,
  sendPasswordReset,
  updatePassword,
  resetDemoData,
  getMeta,
  listVehicles,
  getVehicle,
  vehicleDayRates,
  quote,
  toggleFavorite,
  getFavorites,
  getMyBookings,
  myNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  staffNotifications,
  adminNotificationLog,
  adminResendEmail,
  adminReviews,
  adminDeleteReview,
  adminReplyToReview,
  getBooking,
  lookupBooking,
  beginPayment,
  confirmPayment,
  cancelBooking,
  reviewBooking,
  adminBookings,
  adminSearch,
  adminStats,
  adminUpdateBooking,
  adminRefund,
  adminRecordPayment,
  adminRefundCredit,
  adminVehicleBlocks,
  adminSaveVehicleBlock,
  adminDeleteVehicleBlock,
  adminAuditLogs,
  adminServiceLogs,
  adminSaveServiceLog,
  adminDeleteServiceLog,
  adminSetOdometer,
  adminVehicles,
  adminSaveVehicle,
  adminDeleteVehicle,
  adminInsuranceTiers,
  adminSaveInsuranceTier,
  adminExtras,
  adminSaveExtra,
  adminDeleteExtra,
  adminPromos,
  adminSavePromo,
  adminDeletePromo,
  adminLocations,
  adminSaveLocation,
  adminDeleteLocation,
  adminUsers,
  adminUpdateUser,
  adminVerifyLicence,
  adminLicenceUrl,
  adminSettings,
  adminSaveSettings,
  uploadVehicleImage,
  uploadLicence,
  submitContact,
  adminContactMessages,
  adminUpdateContactMessage,
  adminDeleteContactMessage,
};
