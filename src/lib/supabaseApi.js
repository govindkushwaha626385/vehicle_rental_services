import { supabase } from './supabase.js';
import { CONTACT_SUBJECTS } from './constants.js';
import { computeAdminStats } from './stats.js';
import { coordinatesProblem, isEmail, normalizeCoordinates, phoneProblem, urlProblem } from './validation.js';
import { todayISO, addDaysISO, isValidDate } from './pricing.js';
import { NOTIFICATION_PREF_KEYS, normalizeNotificationPrefs, validNotificationPrefs } from './notifications.js';
import { DESK_CHECK_KEYS, deskCheckPayload } from './desk.js';
import { BULK_FLEET_STATUSES } from './fleetHealth.js';
import {
  EMAIL_TEMPLATE_DEFAULTS, EMAIL_TEMPLATE_KINDS, emailTemplateKey, emailTemplateLabel, renderTemplate, templateFor, templatesForm,
} from './emailTemplates.js';
import { crmSummary, segmentCustomers } from './customers.js';
import { rateRulePatchErrors } from './rateRules.js';
import { RETURN_CHECK_KEYS, returnCheckPayload, settlementRecord } from './returns.js';
import { inspectionProblems, normalizeInspection, returnCondition } from './inspection.js';
import { availabilityBoard, vehicleFreeInWindow } from './availabilityAlerts.js';
import { odometerProblem, serviceEntry } from './maintenance.js';
import { fleetDocProblems } from './fleetDocs.js';
import { kmTerms, kmVehicleProblems } from './km.js';
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
} from './constants.js';

const ensure = (error) => {
  if (error) throw new Error(error.message || 'Something went wrong.');
};

const PAGE_SIZE = 1000;

/**
 * PostgREST caps a response at 1000 rows by default. Admin views must never
 * silently lose the 1001st booking, customer or service log, so page through
 * the query explicitly. The caller supplies a fresh query builder for each page
 * because Supabase builders are single-use.
 */
async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    ensure(error);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

const settingsToObject = (rows = []) =>
  Object.fromEntries(rows.map((row) => [row.key, row.value]));

const mapProfile = (profile, authUser) => ({
  id: profile?.id ?? authUser?.id,
  name: profile?.full_name ?? authUser?.user_metadata?.full_name ?? authUser?.email?.split('@')[0] ?? '',
  email: profile?.email ?? authUser?.email ?? '',
  phone: profile?.phone ?? '',
  role: profile?.role ?? 'customer',
  status: profile?.status ?? 'active',
  licenseNumber: profile?.license_number ?? '',
  cardBrand: profile?.card_brand ?? '',
  cardLast4: profile?.card_last4 ?? '',
  licenceVerified: profile?.licence_verified ?? false,
  licenceUrl: profile?.licence_url ?? '',
  notificationPrefs: normalizeNotificationPrefs(profile?.notification_prefs),
  createdAt: profile?.created_at ?? authUser?.created_at ?? new Date().toISOString(),
});

const mapVehicle = (row) => ({
  id: row.id,
  name: row.name,
  brand: row.brand,
  kind: row.kind ?? 'car',
  type: row.type,
  year: row.year,
  seats: row.seats,
  luggage: row.luggage,
  transmission: row.transmission,
  fuel: row.fuel,
  awd: row.awd,
  efficiency: row.efficiency,
  engineCc: row.engine_cc ?? null,
  mileage: row.mileage ?? row.efficiency ?? '',
  gears: row.gears ?? row.transmission ?? 'Automatic',
  helmetCount: Number(row.helmet_count ?? 0),
  licenseClass: row.license_class ?? 'LMV',
  minAge: Number(row.min_age ?? 21),
  pricePerDay: Number(row.price_per_day),
  kmCap: Number(row.km_cap ?? 0),
  kmExtraRate: Number(row.km_extra_rate ?? 0),
  location: row.location,
  imageUrl: row.image_url,
  images: row.images ?? [],
  description: row.description,
  features: row.features ?? [],
  status: row.status,
  featured: Boolean(row.featured),
  displayOrder: Number(row.display_order ?? 0),
  badge: row.badge ?? '',
  rating: Number(row.rating),
  trips: row.trips,
  odometer: row.odometer ?? null,
  serviceIntervalKm: Number(row.service_interval_km ?? 10000),
  serviceIntervalDays: Number(row.service_interval_days ?? 180),
  lastServiceDate: row.last_service_date ?? null,
  lastServiceOdometer: row.last_service_odometer ?? null,
  registrationNumber: row.registration_number ?? '',
  insuranceExpiry: row.insurance_expiry ?? null,
  pucExpiry: row.puc_expiry ?? null,
  createdAt: row.created_at,
  reviewCount: row.reviews?.[0]?.count ?? row.review_count ?? 0,
  bookingCount: row.bookings?.[0]?.count ?? 0,
  favorite: Boolean(row.favorite),
});

const mapExtra = (row) => ({
  id: row.id,
  key: row.key,
  label: row.label,
  description: row.description,
  pricePerDay: row.price_per_day,
  active: row.active,
});

const mapInsuranceTier = (row) => ({
  key: row.key,
  label: row.label,
  pricePerDay: row.price_per_day,
  deductible: row.deductible,
  blurb: row.blurb,
  active: row.active,
});

const mapPromo = (row) => ({
  id: row.id,
  code: row.code,
  description: row.description,
  type: row.type,
  value: row.value,
  minDays: row.min_days,
  active: row.active,
  expiresAt: row.expires_at,
  usageLimit: row.usage_limit,
  usedCount: row.used_count,
  createdAt: row.created_at,
  firstBookingOnly: Boolean(row.first_booking_only),
});

const mapVehicleBlock = (row) => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  startDate: row.start_date,
  endDate: row.end_date,
  kind: row.kind,
  reason: row.reason,
  notes: row.notes,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  vehicle: row.vehicle
    ? {
      id: row.vehicle.id,
      name: row.vehicle.name,
      brand: row.vehicle.brand,
      location: row.vehicle.location,
      imageUrl: row.vehicle.image_url,
    }
    : null,
});

const mapServiceLog = (row) => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  serviceDate: row.service_date,
  odometer: Number(row.odometer),
  kind: row.kind,
  cost: Number(row.cost ?? 0),
  vendor: row.vendor ?? '',
  reference: row.reference ?? '',
  notes: row.notes ?? '',
  resetsService: Boolean(row.resets_service),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  vehicle: row.vehicle
    ? {
      id: row.vehicle.id,
      name: row.vehicle.name,
      brand: row.vehicle.brand,
      kind: row.vehicle.kind,
      location: row.vehicle.location,
      imageUrl: row.vehicle.image_url,
      odometer: row.vehicle.odometer,
    }
    : null,
});

const mapAuditLog = (row) => ({
  id: row.id,
  actorId: row.actor_id,
  actorName: row.actor_name,
  actorRole: row.actor_role,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  summary: row.summary,
  metadata: row.metadata ?? {},
  createdAt: row.created_at,
});

const optionalNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

const vehiclePayload = (payload) => {
  const km = kmTerms(payload);
  return {
    name: payload.name,
  brand: payload.brand,
  kind: payload.kind === 'bike' ? 'bike' : 'car',
  type: payload.type,
  year: Number(payload.year) || new Date().getFullYear(),
  seats: Number(payload.seats) || (payload.kind === 'bike' ? 2 : 5),
  luggage: Number(payload.luggage) || (payload.kind === 'bike' ? 1 : 2),
  transmission: payload.transmission || 'Automatic',
  fuel: payload.fuel || 'Petrol',
  awd: Boolean(payload.awd),
  efficiency: payload.efficiency || payload.mileage || '',
  engine_cc: payload.engineCc ? Number(payload.engineCc) : null,
  mileage: payload.mileage || payload.efficiency || '',
  gears: payload.kind === 'bike'
    ? (payload.gears || 'Manual')
    : (payload.gears || payload.transmission || 'Automatic'),
  helmet_count: payload.kind === 'bike' ? Number(payload.helmetCount ?? 2) : 0,
  license_class: payload.licenseClass || (payload.kind === 'bike' ? 'MCWG' : 'LMV'),
  min_age: Number(payload.minAge) || (payload.kind === 'bike' ? 18 : 21),
  registration_number: String(payload.registrationNumber ?? '').trim().slice(0, 24),
  insurance_expiry: payload.insuranceExpiry ? String(payload.insuranceExpiry).slice(0, 10) : null,
  puc_expiry: payload.pucExpiry ? String(payload.pucExpiry).slice(0, 10) : null,
  price_per_day: Number(payload.pricePerDay),
  km_cap: km.kmCap,
  km_extra_rate: km.kmExtraRate,
  location: payload.location,
  image_url: (payload.images?.length ? payload.images : [payload.imageUrl]).filter(Boolean)[0],
  images: payload.images?.length ? payload.images : [payload.imageUrl].filter(Boolean),
  description: payload.description || '',
  features: Array.isArray(payload.features)
    ? payload.features
    : String(payload.features || '').split(',').map((item) => item.trim()).filter(Boolean),
  status: payload.status || 'available',
  featured: Boolean(payload.featured),
  display_order: Math.max(0, Math.round(Number(payload.displayOrder) || 0)),
  badge: String(payload.badge ?? '').trim().slice(0, 24),
  odometer: optionalNumber(payload.odometer),
  service_interval_km: Math.max(1, Math.round(Number(payload.serviceIntervalKm) || 10000)),
  service_interval_days: Math.max(1, Math.round(Number(payload.serviceIntervalDays) || 180)),
  last_service_date: payload.lastServiceDate || null,
  last_service_odometer: optionalNumber(payload.lastServiceOdometer),
  };
};

async function currentProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { session: null, profile: null };
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();
  return {
    session,
    profile: mapProfile(profile, session.user),
  };
}

async function functionCall(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message || 'The payment service is unavailable.';
    try {
      const payload = await error.context?.clone?.().json?.();
      if (payload?.error) message = payload.error;
    } catch {
      /* keep the default message */
    }
    const failure = new Error(message);
    failure.status = error.context?.status;
    throw failure;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function getSession() {
  const { session, profile } = await currentProfile();
  if (!session) return { user: null };
  if (profile?.status === 'suspended') {
    await supabase.auth.signOut();
    return { user: null };
  }
  return { user: profile };
}

function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange(() => {
    callback();
  });
  return () => data.subscription.unsubscribe();
}

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (profile?.status === 'suspended') {
    await supabase.auth.signOut();
    throw new Error('This account is suspended. Contact support for help.');
  }
  return mapProfile(profile, data.user);
}

async function signUp({ name, email, password, phone = '' }) {
  if (String(name ?? '').trim().length < 2) throw new Error('Please enter your full name.');
  if (!isEmail(email)) throw new Error('Please enter a valid email address.');
  const phoneError = phoneProblem(phone);
  if (phoneError) throw new Error(phoneError);
  if (String(password ?? '').length < 8) throw new Error('Password must be at least 8 characters.');

  const { data, error } = await supabase.auth.signUp({
    email: String(email).trim(),
    password,
    options: { data: { full_name: String(name).trim(), phone: String(phone).trim() } },
  });
  if (error) throw new Error(error.message);
  if (!data.session) {
    return { needsConfirmation: true, email };
  }
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  return { user: mapProfile(profile, data.user), needsConfirmation: false };
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

async function updateProfile(patch) {
  const { profile } = await currentProfile();
  if (!profile) throw new Error('Please sign in.');

  const name = patch.name === undefined ? profile.name : String(patch.name ?? '').trim();
  const phone = patch.phone === undefined ? profile.phone : String(patch.phone ?? '').trim();
  const licenseNumber = patch.licenseNumber === undefined
    ? profile.licenseNumber
    : String(patch.licenseNumber ?? '').trim();
  if (name.length < 2) throw new Error('Please enter your full name.');
  const phoneError = phoneProblem(phone);
  if (phoneError) throw new Error(phoneError);
  if (licenseNumber && licenseNumber.length < 4) throw new Error('Please enter a valid licence number.');

  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: name.slice(0, 80),
      phone: phone.slice(0, 32),
      license_number: licenseNumber.slice(0, 40),
    })
    .eq('id', profile.id)
    .select('*')
    .single();
  ensure(error);
  return mapProfile(data);
}

async function getNotificationPreferences() {
  const { profile } = await currentProfile();
  return normalizeNotificationPrefs(profile?.notificationPrefs);
}

async function updateNotificationPreferences(prefs = {}) {
  const { profile } = await currentProfile();
  if (!profile) throw new Error('Please sign in.');
  if (!validNotificationPrefs(prefs)) throw new Error('Invalid notification preference.');
  const next = NOTIFICATION_PREF_KEYS.reduce((acc, key) => {
    acc[key] = typeof prefs[key] === 'boolean' ? prefs[key] : (profile.notificationPrefs ?? {})[key];
    return acc;
  }, {});
  const { data, error } = await supabase
    .from('profiles')
    .update({ notification_prefs: next })
    .eq('id', profile.id)
    .select('*')
    .single();
  ensure(error);
  return normalizeNotificationPrefs(data?.notification_prefs);
}

/**
 * Staff send a "return was due" reminder. The RPC validates ownership state
 * and dedupes per day; the email is rendered here from the admin-editable
 * template, matching the demo adapter.
 */
async function sendReturnReminder({ bookingId }) {
  const { data, error } = await supabase.rpc('send_return_reminder', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('*, vehicles(id)')
      .eq('id', bookingId)
      .single();
    const profile = booking.user_id
      ? (await supabase.from('profiles').select('full_name, email').eq('id', booking.user_id).maybeSingle()).data
      : null;
    const email = booking.guest_email || profile?.email || '';
    if (!email) return data;
    const settings = await adminSettings();
    const tpl = templateFor(settings, 'return-due-reminder');
    await supabase.from('notification_log').insert({
      kind: 'return-due-reminder',
      channel: 'email',
      recipient: email,
      subject: renderTemplate(tpl.subject, { code: booking.code }),
      body: renderTemplate(tpl.body, {
        code: booking.code,
        name: profile?.full_name || booking.guest_name || 'there',
        dates: booking.end_date,
      }),
      meta: { code: booking.code, dates: booking.end_date },
    });
  } catch {
    // The reminder is recorded in-app; an email hiccup must not fail the desk.
  }
  return data;
}

/**
 * Staff send a "pick-up is coming" nudge. The RPC validates the booking is
 * confirmed for today/tomorrow and dedupes per day; the email renders the
 * admin-editable template like the demo adapter.
 */
async function sendPickupReminder({ bookingId }) {
  const { data, error } = await supabase.rpc('send_pickup_reminder', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('*, vehicles(id)')
      .eq('id', bookingId)
      .single();
    const profile = booking.user_id
      ? (await supabase.from('profiles').select('full_name, email').eq('id', booking.user_id).maybeSingle()).data
      : null;
    const email = booking.guest_email || profile?.email || '';
    if (!email) return data;
    const settings = await adminSettings();
    const tpl = templateFor(settings, 'pickup_reminder');
    const siteName = String(settings.site_name || 'Rove');
    const deposit = `₹${Number(booking.hold_amount || settings.hold_amount || 5000).toLocaleString('en-IN')}`;
    await supabase.from('notification_log').insert({
      kind: 'pickup_reminder',
      channel: 'email',
      recipient: email,
      subject: renderTemplate(tpl.subject, { site: siteName, code: booking.code }),
      body: renderTemplate(tpl.body, {
        site: siteName,
        code: booking.code,
        name: profile?.full_name || booking.guest_name || 'there',
        dates: `${booking.start_date} – ${booking.end_date}`,
        time: booking.pickup_time || '10:00',
        hub: booking.pickup_location || '',
        amount: deposit,
      }),
      meta: { code: booking.code, dates: booking.start_date },
    });
  } catch {
    // The reminder is recorded in-app; an email hiccup must not fail the desk.
  }
  return data;
}
  const { data, error } = await supabase.rpc('request_booking_change', {
    p_booking_id: payload.bookingId,
    p_start_date: payload.startDate,
    p_end_date: payload.endDate,
    p_pickup_location: payload.pickupLocation,
    p_dropoff_location: payload.dropoffLocation,
    p_pickup_time: payload.pickupTime,
    p_dropoff_time: payload.dropoffTime,
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Self-serve extension of an active trip's return. The RPC is
 * server-authoritative (owner check, availability, reprice, audit); the email
 * is best-effort here so a template failure can never roll back the trip.
 */
async function extendTrip({ bookingId, endDate, dropoffTime }) {
  const { data, error } = await supabase.rpc('extend_booking_dropoff', {
    p_booking_id: bookingId,
    p_end_date: endDate,
    p_dropoff_time: dropoffTime,
  });
  if (error) throw new Error(error.message);
  try {
    const { data: booking } = await supabase
      .from('bookings')
      .select('*, vehicles(id)')
      .eq('id', bookingId)
      .single();
    if (!booking) return data;
    const profile = booking.user_id
      ? (await supabase.from('profiles').select('full_name, email').eq('id', booking.user_id).maybeSingle()).data
      : null;
    const email = booking.guest_email || profile?.email || '';
    if (!email) return data;
    const settings = await adminSettings();
    const tpl = templateFor(settings, 'trip-extended');
    const delta = Number(data?.delta || 0);
    await supabase.from('notification_log').insert({
      kind: 'trip-extended',
      channel: 'email',
      recipient: email,
      subject: renderTemplate(tpl.subject, { code: booking.code }),
      body: renderTemplate(tpl.body, {
        code: booking.code,
        name: profile?.full_name || booking.guest_name || 'there',
        dates: endDate,
        time: dropoffTime,
        reason: delta > 0 ? ` The extra ₹${delta.toLocaleString('en-IN')} is collected at drop-off.` : ' The price is unchanged.',
      }),
      meta: { code: booking.code, endDate, dropoffTime, delta },
    });
  } catch {
    // The extension is already applied and notified in-app; an email hiccup
    // must not surface as a failed extension.
  }
  return data;
}

async function cancelChangeRequest({ bookingId }) {
  const { data, error } = await supabase.rpc('cancel_booking_change_request', { p_booking_id: bookingId });
  if (error) throw new Error(error.message);
  return data;
}

async function resolveChangeRequest({ bookingId, decision, reason }) {
  const { data, error } = await supabase.rpc('resolve_booking_change_request', {
    p_booking_id: bookingId,
    p_decision: decision,
    p_reason: reason || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function adminBulkUpdateBookings({ ids = [], status, reason }) {
  const requests = (Array.isArray(ids) ? ids : []).map((bookingId) =>
    adminUpdateBooking({ bookingId, status, reason }),
  );
  const results = await Promise.allSettled(requests);
  const updated = results.filter((result) => result.status === 'fulfilled').length;
  return {
    updated,
    skipped: results.length - updated,
    total: results.length,
    errors: results
      .filter((result) => result.status === 'rejected')
      .map((result) => String(result.reason?.message || 'update failed')),
  };
}

async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new Error(error.message);
  return {
    message: 'If that email is registered, a secure reset link is on its way. Check your inbox and spam folder.',
  };
}

async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

async function getMeta() {
  const [locations, extras, tiers, settings] = await Promise.all([
    supabase.from('locations').select('*').eq('active', true).order('name'),
    supabase.from('extras').select('*').eq('active', true).order('created_at'),
    supabase.from('insurance_tiers').select('*').eq('active', true),
    supabase.from('settings').select('key, value'),
  ]);
  ensure(locations.error);
  ensure(extras.error);
  ensure(tiers.error);
  ensure(settings.error);
  return {
    types: VEHICLE_TYPES,
    bikeTypes: BIKE_TYPES,
    kinds: VEHICLE_KINDS,
    kindLabels: KIND_LABELS,
    typesByKind: TYPES_BY_KIND,
    fuelsByKind: FUELS_BY_KIND,
    bikeGears: BIKE_GEARS,
    licenseByKind: LICENSE_BY_KIND,
    locations: locations.data ?? [],
    extras: (extras.data ?? []).map(mapExtra),
    insuranceTiers: (tiers.data ?? []).map(mapInsuranceTier),
    settings: settingsToObject(settings.data),
    currency: 'INR',
  };
}

async function listVehicles(filters = {}) {
  const { data: toggleRows, error: toggleError } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['bikes_enabled', 'reviews_enabled']);
  ensure(toggleError);
  const toggles = settingsToObject(toggleRows);
  const bikesEnabled = toggles.bikes_enabled !== 'false';
  const reviewsEnabled = toggles.reviews_enabled !== 'false';

  let query = supabase
    .from('vehicles')
    .select('*, reviews(count)')
    .neq('status', 'maintenance');

  const types = String(filters.type || '').split(',').filter(Boolean);
  const fuels = String(filters.fuel || '').split(',').filter(Boolean);
  const kinds = String(filters.kind || '').split(',').filter(Boolean);
  const gearList = String(filters.gears || '').split(',').filter(Boolean);
  if (filters.q) {
    const q = String(filters.q).replace(/[%_,()"'\\]/g, ' ').trim();
    query = query.or(`name.ilike.%${q}%,brand.ilike.%${q}%,type.ilike.%${q}%,location.ilike.%${q}%`);
  }
  if (!bikesEnabled) query = query.neq('kind', 'bike');
  if (types.length) query = query.in('type', types);
  if (fuels.length) query = query.in('fuel', fuels);
  if (kinds.length) query = query.in('kind', kinds);
  if (gearList.length) query = query.in('gears', gearList);
  if (filters.engineCc) query = query.gte('engine_cc', Number(filters.engineCc));
  if (filters.helmetCount) query = query.gte('helmet_count', Number(filters.helmetCount));
  if (filters.location) query = query.eq('location', filters.location);
  if (filters.transmission) query = query.eq('transmission', filters.transmission);
  if (filters.seats) query = query.gte('seats', Number(filters.seats));
  if (filters.minPrice) query = query.gte('price_per_day', Number(filters.minPrice));
  if (filters.maxPrice) query = query.lte('price_per_day', Number(filters.maxPrice));
  if (String(filters.awd) === 'true') query = query.eq('awd', true);

  if (filters.from && filters.to && filters.from < filters.to) {
    const { data: blocked, error: availabilityError } = await supabase.rpc('unavailable_vehicle_ids', {
      p_start_date: filters.from,
      p_end_date: filters.to,
    });
    ensure(availabilityError);
    if (blocked?.length) query = query.not('id', 'in', `(${blocked.join(',')})`);
  }

  const sort = {
    'price-asc': ['price_per_day', true],
    'price-desc': ['price_per_day', false],
    rating: ['rating', false],
    newest: ['year', false],
    recommended: ['rating', false],
  }[filters.sort] ?? ['rating', false];
  query = query.order(sort[0], { ascending: sort[1] });

  let priceQuery = supabase.from('vehicles').select('price_per_day').neq('status', 'maintenance');
  if (!bikesEnabled) priceQuery = priceQuery.neq('kind', 'bike');
  if (kinds.length) priceQuery = priceQuery.in('kind', kinds);
  const [{ data, error }, priceRows] = await Promise.all([query, priceQuery]);
  ensure(error);

  let favoriteIds = new Set();
  const { session } = await currentProfile();
  if (session) {
    const { data: favorites } = await supabase
      .from('favorites')
      .select('vehicle_id')
      .eq('user_id', session.user.id);
    favoriteIds = new Set((favorites ?? []).map((row) => row.vehicle_id));
  }

  const vehicles = (data ?? []).map((row) => mapVehicle({
    ...row,
    favorite: favoriteIds.has(row.id),
    reviewCount: reviewsEnabled ? (row.reviews?.[0]?.count ?? 0) : 0,
  }));
  const prices = (priceRows.data ?? []).map((row) => Number(row.price_per_day));
  return {
    vehicles,
    total: vehicles.length,
    priceBounds: {
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 30000,
    },
  };
}

async function getVehicle(id) {
  const [{ data: row, error }, { data: toggleRows, error: toggleError }] = await Promise.all([
    supabase
      .from('vehicles')
      .select('*, reviews(count)')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('settings')
      .select('key, value')
      .in('key', ['bikes_enabled', 'reviews_enabled']),
  ]);
  ensure(error);
  ensure(toggleError);
  if (!row) throw new Error('Vehicle not found.');
  const toggles = settingsToObject(toggleRows);
  if (row.kind === 'bike' && toggles.bikes_enabled === 'false') {
    throw new Error('Two-wheelers are temporarily unavailable. Browse our cars instead.');
  }
  const reviewsEnabled = toggles.reviews_enabled !== 'false';
  const repliesEnabled = toggles.review_replies_enabled !== 'false';

  const { data: reviews, error: reviewError } = reviewsEnabled
    ? await supabase
      .from('reviews')
      .select('id, author, rating, comment, reply, replied_at, created_at')
      .eq('vehicle_id', id)
      .order('created_at', { ascending: false })
    : { data: [], error: null };
  ensure(reviewError);

  let favorite = false;
  const { session } = await currentProfile();
  if (session) {
    const { data } = await supabase
      .from('favorites')
      .select('vehicle_id')
      .eq('user_id', session.user.id)
      .eq('vehicle_id', id)
      .maybeSingle();
    favorite = Boolean(data);
  }

  // Per-day occupancy for the availability strip — a width of one month keeps
  // the recursive call tiny and the response bounded.
  const { data: busyDays, error: busyError } = await supabase.rpc('vehicle_busy_days', {
    p_vehicle_id: id,
    p_from: todayISO(),
    p_to: addDaysISO(todayISO(), 29),
  });
  ensure(busyError);
  const upcoming = (busyDays ?? []).map((row) => ({
    startDate: row.busy_date,
    endDate: row.busy_date,
    reason: String(row.reason ?? 'booked'),
  }));

  return {
    vehicle: { ...mapVehicle(row), favorite, reviewCount: reviews?.length ?? 0 },
    reviews: (reviews ?? []).map((review) => ({
      id: review.id,
      author: review.author,
      rating: review.rating,
      comment: review.comment,
      reply: repliesEnabled ? (review.reply ?? null) : null,
      repliedAt: repliesEnabled ? (review.replied_at ?? null) : null,
      createdAt: review.created_at,
    })),
    upcoming,
  };
}

async function vehicleDayRates(vehicleId, from, to) {
  const { data, error } = await supabase.rpc('vehicle_day_rates', {
    p_vehicle_id: vehicleId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map((row) => ({
    date: row.date,
    rate: Number(row.rate) || 0,
    weekend: Boolean(row.weekend),
    seasonal: Boolean(row.seasonal),
  })) : [];
}

async function quote(payload) {
  const [{ data, error }, { data: vehicleRow }] = await Promise.all([
    supabase.rpc('quote_rental', {
      p_vehicle_id: payload.vehicleId,
      p_start_date: payload.startDate,
      p_end_date: payload.endDate,
      p_extras: payload.extras ?? [],
      p_insurance: payload.insurance ?? 'basic',
      p_promo_code: payload.promoCode || null,
      p_pickup_location: payload.pickupLocation || null,
      p_dropoff_location: payload.dropoffLocation || null,
      p_payment_plan: payload.paymentPlan === 'deposit' ? 'deposit' : 'full',
      p_exclude_booking_id: payload.excludeBookingId || null,
    }),
    supabase
      .from('vehicles')
      .select('kind, engine_cc, mileage, gears, helmet_count, license_class, min_age')
      .eq('id', payload.vehicleId)
      .maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const kind = vehicleRow?.kind ?? 'car';
  return {
    quote: data,
    available: Boolean(data?.available),
    unavailableReason: data?.unavailableReason ?? null,
    kind,
    bikeDetails: kind === 'bike'
      ? {
        engineCc: vehicleRow?.engine_cc ?? null,
        mileage: vehicleRow?.mileage ?? '',
        gears: vehicleRow?.gears ?? 'Manual',
        helmetCount: Number(vehicleRow?.helmet_count ?? 2),
        licenseClass: vehicleRow?.license_class ?? 'MCWG',
        minAge: Number(vehicleRow?.min_age ?? 18),
      }
      : null,
  };
}

async function toggleFavorite(vehicleId) {
  const { session, profile } = await currentProfile();
  if (!session || !profile) throw new Error('Please sign in to save cars.');
  const { data: existing, error } = await supabase
    .from('favorites')
    .select('vehicle_id')
    .eq('user_id', session.user.id)
    .eq('vehicle_id', vehicleId)
    .maybeSingle();
  ensure(error);

  if (existing) {
    const { error: deleteError } = await supabase
      .from('favorites')
      .delete()
      .eq('user_id', session.user.id)
      .eq('vehicle_id', vehicleId);
    ensure(deleteError);
    return { favorite: false };
  }
  const { error: insertError } = await supabase
    .from('favorites')
    .insert({ user_id: session.user.id, vehicle_id: vehicleId });
  ensure(insertError);
  return { favorite: true };
}

async function getFavorites() {
  const { session } = await currentProfile();
  if (!session) throw new Error('Please sign in.');
  const { data, error } = await supabase
    .from('favorites')
    .select('vehicle_id, vehicles(*, reviews(count))')
    .eq('user_id', session.user.id);
  ensure(error);
  return (data ?? [])
    .map((row) => row.vehicles)
    .filter((vehicle) => vehicle && vehicle.status !== 'maintenance')
    .map((row) => mapVehicle({ ...row, favorite: true, reviewCount: row.reviews?.[0]?.count ?? 0 }));
}

// ---------------------------------------------------------------------------
// Bookings & payments
// ---------------------------------------------------------------------------

async function getMyBookings() {
  const { data, error } = await supabase.rpc('my_bookings');
  ensure(error);
  return data ?? [];
}

async function getBooking(code, email = null) {
  const { data, error } = await supabase.rpc('get_booking', {
    p_code: code,
    p_email: email || null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('We could not find a booking with that code and email.');
  return data;
}

async function lookupBooking(code, email) {
  return getBooking(code, email);
}

async function beginPayment(draft) {
  return functionCall('razorpay-order', draft);
}

async function confirmPayment({ draft, payment }) {
  return functionCall('razorpay-verify', { draft, ...payment });
}

async function cancelBooking({ bookingId, code, email, reason }) {
  return functionCall('razorpay-refund', { bookingId, code, email, reason });
}

async function reviewBooking({ bookingId, vehicleId, rating, comment }) {
  const { data: toggle, error: toggleError } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'reviews_enabled')
    .maybeSingle();
  ensure(toggleError);
  if (toggle?.value === 'false') throw new Error('Reviews are temporarily closed. Thanks for travelling with Rove.');
  const { session, profile } = await currentProfile();
  if (!session || !profile) throw new Error('Please sign in to leave a review.');
  const { error } = await supabase.from('reviews').insert({
    vehicle_id: vehicleId,
    booking_id: bookingId,
    user_id: session.user.id,
    author: profile.name,
    rating: Number(rating),
    comment: comment.trim(),
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

async function adminBookings() {
  const { data, error } = await supabase.rpc('admin_bookings');
  ensure(error);
  return data ?? [];
}

/**
 * Staff-only type-ahead used by the ⌘K palette. Mirrors the demo adapter's
 * shape exactly. Every query is capped so a broad search never pulls a whole
 * table, and RLS still applies — a customer calling this only sees their own
 * rows. The `or` values are sanitised like the storefront search so commas and
 * parentheses can never break the filter syntax.
 */
async function adminSearch({ query = '', limit = 5 } = {}) {
  const term = String(query || '').replace(/[%_,()"'\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const cap = Math.max(1, Math.min(10, Number(limit) || 5));
  if (term.length < 2) return { bookings: [], vehicles: [], customers: [] };
  const like = `%${term}%`;

  const [vehicleResult, customerResult] = await Promise.all([
    supabase
      .from('vehicles')
      .select('id, name, registration_number, location, status')
      .or(`name.ilike.${like},brand.ilike.${like},registration_number.ilike.${like},location.ilike.${like}`)
      .limit(cap),
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'customer')
      .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
      .limit(cap),
  ]);
  ensure(vehicleResult.error);
  ensure(customerResult.error);

  const vehicleMatches = vehicleResult.data ?? [];
  const customerMatches = customerResult.data ?? [];
  // Registered bookings store the customer on profiles and the car on vehicles,
  // so a name/plate search must first resolve matching ids and then ask for the
  // bookings that point at them.
  const clauses = [
    `code.ilike.${like}`,
    `guest_name.ilike.${like}`,
    `guest_email.ilike.${like}`,
    `guest_phone.ilike.${like}`,
  ];
  if (vehicleMatches.length) clauses.push(`vehicle_id.in.(${vehicleMatches.map((row) => row.id).join(',')})`);
  if (customerMatches.length) clauses.push(`user_id.in.(${customerMatches.map((row) => row.id).join(',')})`);

  const { data: bookingRows, error: bookingError } = await supabase
    .from('bookings')
    .select('id, code, status, start_date, guest_name, guest_email, user_id, vehicle_id')
    .or(clauses.join(','))
    .order('created_at', { ascending: false })
    .limit(cap);
  ensure(bookingError);

  const rows = bookingRows ?? [];
  const bookingVehicleIds = [...new Set(rows.map((row) => row.vehicle_id).filter(Boolean))];
  const bookingUserIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const [bookingVehicles, bookingCustomers] = await Promise.all([
    bookingVehicleIds.length
      ? supabase.from('vehicles').select('id, name').in('id', bookingVehicleIds)
      : Promise.resolve({ data: [], error: null }),
    bookingUserIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', bookingUserIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  ensure(bookingVehicles.error);
  ensure(bookingCustomers.error);
  const vehicleName = new Map((bookingVehicles.data ?? []).map((row) => [row.id, row.name]));
  const customerName = new Map((bookingCustomers.data ?? []).map((row) => [row.id, row.full_name]));

  // Guests are not profiles — they are derived from booking contact details, the
  // same way Admin → Customers builds them. Surfacing them keeps the palette
  // identical to the demo adapter.
  const registeredCustomers = customerMatches.map((row) => ({
    id: row.id,
    name: row.full_name || row.email || 'Customer',
    email: row.email || '',
  }));
  const knownEmails = new Set(registeredCustomers.map((row) => row.email.toLowerCase()));
  const guestCustomers = [];
  rows.forEach((row) => {
    if (row.user_id || !row.guest_name) return;
    const email = String(row.guest_email || '').trim().toLowerCase();
    if (!email || knownEmails.has(email)) return;
    knownEmails.add(email);
    guestCustomers.push({ id: `guest:${email}`, name: row.guest_name, email });
  });

  return {
    bookings: rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      startDate: row.start_date,
      customerName: customerName.get(row.user_id) || row.guest_name || 'Guest',
      vehicleName: vehicleName.get(row.vehicle_id) || '',
    })),
    vehicles: vehicleMatches.map((row) => ({
      id: row.id,
      name: row.name,
      registrationNumber: row.registration_number || '',
      location: row.location || '',
      status: row.status,
    })),
    customers: [...registeredCustomers, ...guestCustomers].slice(0, cap),
  };
}

async function adminStats() {
  const [bookings, vehicles, users, alerts, blocks, serviceLogs, reviews, settingsResult] = await Promise.all([
    adminBookings(),
    fetchAll(() => supabase.from('vehicles').select('*, reviews(count)').order('id')),
    fetchAll(() => supabase.from('profiles').select('id, role, status').order('id')),
    fetchAll(() => supabase
      .from('availability_alerts')
      .select('id, user_id, vehicle_id, start_date, end_date, active, notified_at, created_at, match_reason')
      .eq('active', true)
      .gt('end_date', todayISO())
      .order('id')),
    adminVehicleBlocks(),
    adminServiceLogs().catch(() => []),
    adminReviews().catch(() => []),
    supabase.from('settings').select('key, value'),
  ]);
  const settings = Object.fromEntries(
    (settingsResult?.data ?? []).map((row) => [row.key, row.value]),
  );
  const alertsByUser = new Map();
  alerts.forEach((alert) => {
    const list = alertsByUser.get(alert.user_id) ?? [];
    list.push({
      id: alert.id,
      vehicleId: alert.vehicle_id,
      startDate: alert.start_date,
      endDate: alert.end_date,
      active: Boolean(alert.active),
      notifiedAt: alert.notified_at,
      matchReason: alert.match_reason,
      createdAt: alert.created_at,
    });
    alertsByUser.set(alert.user_id, list);
  });
  const usersWithAlerts = users.map((user) => ({
    ...user,
    alerts: alertsByUser.get(user.id) ?? [],
  }));
  return computeAdminStats(
    bookings,
    vehicles.map(mapVehicle),
    usersWithAlerts,
    blocks,
    serviceLogs,
    [],
    reviews,
    settings,
  );
}

async function adminUpdateBooking({
  bookingId, status, startDate, endDate, pickupLocation, dropoffLocation,
  pickupTime, dropoffTime, refund = false, notes, reason,
}) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle();
  ensure(error);
  if (!booking) throw new Error('Booking not found.');

  if (status && status !== booking.status && !ALLOWED_TRANSITIONS[booking.status]?.includes(status)) {
    throw new Error(`A ${booking.status} booking cannot be marked ${status}.`);
  }

  const patch = {};
  if (status) {
    patch.status = status;
    if (['cancelled', 'rejected'].includes(status)) {
      patch.cancelled_at = new Date().toISOString();
      patch.cancellation_reason = String(reason || 'Cancelled by Rove staff').trim().slice(0, 240);
      patch.cancelled_by = 'staff';
    }
  }
  if (notes !== undefined) patch.notes = String(notes).slice(0, 600);

  const nextStart = startDate || booking.start_date;
  const nextEnd = endDate || booking.end_date;
  const nextPickup = pickupLocation ?? booking.pickup_location;
  const nextDropoff = dropoffLocation ?? booking.dropoff_location;
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (pickupLocation !== undefined && !String(pickupLocation).trim()) throw new Error('Choose a pick-up hub.');
  if (dropoffLocation !== undefined && !String(dropoffLocation).trim()) throw new Error('Choose a drop-off hub.');
  if (pickupTime !== undefined && !timeRe.test(String(pickupTime))) throw new Error('Choose a valid pick-up time.');
  if (dropoffTime !== undefined && !timeRe.test(String(dropoffTime))) throw new Error('Choose a valid drop-off time.');
  if (pickupLocation !== undefined) patch.pickup_location = String(pickupLocation).trim();
  if (dropoffLocation !== undefined) patch.dropoff_location = String(dropoffLocation).trim();
  if (pickupTime !== undefined) patch.pickup_time = pickupTime;
  if (dropoffTime !== undefined) patch.dropoff_time = dropoffTime;

  const reprice = Boolean(startDate || endDate)
    || nextPickup !== booking.pickup_location
    || nextDropoff !== booking.dropoff_location;

  if (reprice) {
    if (nextStart >= nextEnd) throw new Error('Choose a valid date range.');
    const { data: priced, error: quoteError } = await supabase.rpc('quote_rental', {
      p_vehicle_id: booking.vehicle_id,
      p_start_date: nextStart,
      p_end_date: nextEnd,
      p_extras: booking.extras ?? [],
      p_insurance: booking.insurance,
      p_promo_code: booking.promo_code || null,
      p_pickup_location: nextPickup,
      p_dropoff_location: nextDropoff,
      p_payment_plan: booking.payment_plan,
      p_exclude_booking_id: booking.id,
    });
    if (quoteError) throw new Error(quoteError.message);
    if (!priced.available) throw new Error(priced.unavailableReason || 'Those dates are unavailable.');
    Object.assign(patch, {
      start_date: nextStart,
      end_date: nextEnd,
      days: priced.days,
      base_total: priced.baseTotal,
      extras_total: priced.extrasTotal,
      insurance_total: priced.insuranceTotal,
      one_way_fee: priced.oneWayFee,
      fees: priced.fees,
      tax_rate: priced.taxRate,
      tax_inclusive: Boolean(priced.taxInclusive),
      taxable_amount: priced.taxable,
      untaxed_total: priced.untaxedTotal ?? 0,
      discount: priced.discount,
      total: priced.total,
      // A trip already out collected its deposit at pick-up — extending later
      // days must not inflate the "deposit paid" figure the customer saw.
      ...(booking.status === 'active' ? {} : { deposit_due: priced.depositDue }),
    });
    // Every date/hub edit joins the customer-visible trip-activity trail
    // (voucher, manage page, analytics) — matching self-serve extensions.
    const delta = Number(priced.total) - (Number(booking.total) || 0);
    const previousWindow = {
      start: booking.start_date,
      end: booking.end_date,
      pickup: booking.pickup_location,
      dropoff: booking.dropoff_location,
    };
    let actor = 'Rove staff';
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user?.id) {
        const profile = (await supabase.from('profiles').select('full_name').eq('id', auth.user.id).maybeSingle()).data;
        if (profile?.full_name) actor = profile.full_name;
      }
    } catch { /* actor name is cosmetic — the trail still records the edit */ }
    patch.trip_changes = [
      ...(Array.isArray(booking.trip_changes) ? booking.trip_changes : []),
      ...(nextStart !== booking.start_date
        || nextEnd !== booking.end_date
        || nextPickup !== booking.pickup_location
        || nextDropoff !== booking.dropoff_location
        ? [{
            type: 'change',
            at: new Date().toISOString(),
            by: actor,
            summary: `${previousWindow.start} → ${nextStart}`
              + (previousWindow.pickup !== nextPickup || previousWindow.dropoff !== nextDropoff
                ? ` · ${previousWindow.pickup} → ${nextPickup}`
                : ''),
            from: previousWindow.end,
            to: nextEnd,
            delta,
          }]
        : []),
    ];
  }

  // Refund before writing the cancellation. The Edge Function owns the money
  // movement and sets the refunded payment state; if it fails we leave the
  // booking untouched so staff can retry without a half-finished cancellation.
  let refundResult = null;
  if (refund && patch.status === 'cancelled' && Number(booking.amount_paid) > 0) {
    refundResult = await functionCall('razorpay-refund', { bookingId, reason: reason || 'Admin cancellation' });
  }

  const { data, error: updateError } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', bookingId)
    .select('*')
    .single();
  if (updateError) throw new Error(updateError.message);

  // Keep the fleet board honest. `.eq('status', …)` makes the change a no-op
  // when the car is deliberately in maintenance instead of renting.
  if (status && status !== booking.status && data.vehicle_id) {
    if (status === 'active') {
      await supabase.from('vehicles').update({ status: 'rented' }).eq('id', data.vehicle_id).eq('status', 'available');
    } else if (booking.status === 'active' && ['completed', 'cancelled', 'rejected'].includes(status)) {
      await supabase.from('vehicles').update({ status: 'available' }).eq('id', data.vehicle_id).eq('status', 'rented');
    }
  }

  // In-app notification so trip-status changes appear in the owner's inbox.
  if (status && ['active', 'completed', 'cancelled'].includes(status) && data.user_id) {
    const messages = {
      active: { kind: 'booking_active', title: 'Trip started', body: 'Have a safe drive — roadside support is included.' },
      completed: { kind: 'booking_completed', title: 'Trip completed', body: "Nice driving! We'd love a review of your trip." },
      cancelled: { kind: 'booking_cancelled', title: 'Booking cancelled', body: 'This booking was cancelled by Rove.' },
    };
    const message = messages[status];
    await supabase.from('notifications').insert({
      audience: 'user',
      user_id: data.user_id,
      kind: message.kind,
      title: message.title,
      body: message.body,
      booking_code: data.code,
      link: `/confirmation/${data.code}`,
    });
    // Queue the transactional email for the notify dispatcher.
    const recipient = data.guest_email || (await emailForUser(data.user_id));
    if (recipient) {
      await supabase.from('notification_log').insert({
        kind: message.kind,
        channel: 'email',
        recipient,
        subject: `${data.code}: ${message.title.toLowerCase()}`,
        body: message.body,
        meta: { code: data.code, status },
      });
    }
  }

  // A cancellation or a date change can free a vehicle customers are watching.
  if ((status && ['cancelled', 'rejected'].includes(status)) || reprice) {
    await adminDispatchAvailabilityAlerts({ vehicleId: data.vehicle_id }).catch(() => {});
  }

  return { ok: true, booking: data, refund: refundResult };
}

async function adminDeskBookings() {
  const bookings = await adminBookings();
  const today = todayISO();
  const nextWeek = addDaysISO(today, 7);
  // Pick-ups are bookings that have not started yet. An overdue confirmed
  // booking is a no-show candidate the desk must still see, so confirmed
  // commitments are never date-capped — only stale pending requests are
  // bounded. Mirrors the demo adapter exactly.
  const overdueSince = addDaysISO(today, -14);
  const incoming = (Array.isArray(bookings) ? bookings : []).filter((booking) => (
    booking.startDate <= nextWeek
    && (
      booking.status === 'confirmed'
      || (booking.status === 'pending' && booking.startDate >= overdueSince)
    )
  ));
  return incoming.sort((a, b) => {
    const byDate = String(a.startDate).localeCompare(String(b.startDate));
    if (byDate !== 0) return byDate;
    return String(a.pickupTime || '10:00').localeCompare(String(b.pickupTime || '10:00'));
  });
}

/**
 * Close an overdue pick-up as a no-show. Mirrors the demo adapter: a thin,
 * guarded wrapper around the staff cancellation path so refunds, alerts,
 * notifications and audit history are identical to any other cancellation.
 */
async function adminMarkNoShow({ bookingId, refund = false }) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, start_date')
    .eq('id', bookingId)
    .maybeSingle();
  ensure(error);
  if (!booking) throw new Error('Booking not found.');
  if (booking.status !== 'confirmed') {
    throw new Error('Only a confirmed booking can be marked as a no-show.');
  }
  if (String(booking.start_date) >= todayISO()) {
    throw new Error('This pick-up is not overdue yet.');
  }
  return adminUpdateBooking({
    bookingId: booking.id,
    status: 'cancelled',
    refund: Boolean(refund),
    reason: 'No-show — the customer did not collect the vehicle.',
  });
}

/**
 * Start a trip from the desk after recording the hand-over condition.
 *
 * Mirrors the demo adapter: validate, save the inspection, then delegate the
 * status change so transition rules and notifications stay in one place.
 */
async function adminStartTrip({ bookingId, inspection } = {}) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status')
    .eq('id', bookingId)
    .maybeSingle();
  ensure(error);
  if (!booking) throw new Error('Booking not found.');
  if (booking.status !== 'confirmed') {
    throw new Error('Only a confirmed booking can be started.');
  }
  const problems = inspectionProblems(inspection ?? {});
  if (problems.length) throw new Error(problems[0]);
  const clean = normalizeInspection(inspection);
  const { data: auth } = await supabase.auth.getUser();
  const { error: saveError } = await supabase
    .from('bookings')
    .update({
      pickup_inspection: {
        ...clean,
        recordedAt: new Date().toISOString(),
        recordedBy: auth?.user?.id ?? 'staff',
      },
      pickup_odometer: clean.odometer,
    })
    .eq('id', bookingId);
  ensure(saveError);
  return adminUpdateBooking({ bookingId, status: 'active' });
}

async function adminSaveDeskChecks({ bookingId, checked = [] }) {
  const clean = (Array.isArray(checked) ? checked : []).filter((key) => DESK_CHECK_KEYS.includes(key));
  const { data, error } = await supabase
    .from('bookings')
    .update({ desk_checks: deskCheckPayload(clean) })
    .eq('id', bookingId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const DEPOSIT_METHODS = Object.freeze(['cash', 'upi', 'card', 'transfer', 'other']);

/**
 * Record the security deposit taken at pick-up (mirrors the demo adapter).
 * The desk UI offers this only when a deposit is due and not yet collected;
 * the amount is capped at the due figure, and the column guard below keeps
 * a double collection from ever overwriting the first record.
 */
async function adminCollectDeposit({ bookingId, amount, method, reference = '' } = {}) {
  const collected = Math.round(Number(amount));
  if (!Number.isFinite(collected) || collected <= 0) {
    throw new Error('Enter a valid deposit amount.');
  }
  const cleanMethod = DEPOSIT_METHODS.includes(method) ? method : 'other';
  const cleanReference = String(reference ?? '').trim().slice(0, 120);
  // Friendly "already collected" instead of a bare no-match error: read first,
  // then let the column guard below win a race.
  const { data: existing, error: readError } = await supabase
    .from('bookings')
    .select('deposit_collected')
    .eq('id', bookingId)
    .single();
  if (readError) throw new Error(readError.message);
  if (existing?.deposit_collected) throw new Error('The deposit for this booking has already been collected.');
  const { data, error } = await supabase
    .from('bookings')
    .update({
      deposit_collected: {
        amount: collected,
        method: cleanMethod,
        reference: cleanReference || null,
        at: new Date().toISOString(),
        byName: 'Desk',
      },
    })
    .eq('id', bookingId)
    .is('deposit_collected', null) // one collection per pick-up; never overwrite
    .select('*')
    .single();
  if (error) {
    // postgREST reports a guarded update that matched nothing this way.
    throw new Error(/multiple \(or no\) rows/i.test(error.message)
      ? 'The deposit for this booking has already been collected.'
      : error.message);
  }
  return data;
}

async function adminCustomers() {
  const [profiles, bookingRows] = await Promise.all([
    fetchAll(() => supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, created_at')
      .eq('role', 'customer')
      .order('id')),
    fetchAll(() => supabase
      .from('bookings')
      .select('id, user_id, guest_email, guest_name, guest_phone, status, total, start_date, created_at, pickup_location, vehicles(type, name)')
      .order('id')),
  ]);

  const customers = profiles.map((profile) => ({
    id: profile.id,
    name: profile.full_name || profile.email,
    email: profile.email,
    phone: profile.phone || '',
    createdAt: profile.created_at,
    account: true,
  }));
  const guests = new Map();
  bookingRows.forEach((row) => {
    if (row.user_id || !row.guest_email) return;
    const id = `guest:${String(row.guest_email).trim().toLowerCase()}`;
    if (!guests.has(id)) {
      guests.set(id, {
        id,
        name: row.guest_name || 'Guest',
        email: row.guest_email,
        phone: row.guest_phone || '',
        createdAt: row.created_at,
        account: false,
      });
    }
  });
  const bookings = bookingRows.map((row) => ({
    userId: row.user_id || (row.guest_email ? `guest:${String(row.guest_email).trim().toLowerCase()}` : ''),
    status: row.status,
    total: row.total,
    startDate: row.start_date,
    createdAt: row.created_at,
    vehicleType: row.vehicles?.type ?? '',
    vehicleName: row.vehicles?.name ?? '',
    hub: row.pickup_location ?? '',
  }));
  const rows = segmentCustomers([...customers, ...guests.values()], bookings);
  return {
    customers: rows.sort((a, b) => b.lifetimeValue - a.lifetimeValue),
    summary: crmSummary(rows),
  };
}

async function adminEmailCustomers({ customerIds = [], template = 'customer_message', subject, body }) {
  const ids = [...new Set((Array.isArray(customerIds) ? customerIds : []).filter(Boolean))];
  if (!ids.length) throw new Error('Select at least one customer.');
  if (!EMAIL_TEMPLATE_KINDS.includes(template)) throw new Error('Choose a valid message template.');
  const { customers } = await adminCustomers();
  const selected = customers.filter((customer) => ids.includes(customer.id));
  if (!selected.length) throw new Error('Those customers could not be found.');
  const settings = await adminSettings();
  const tpl = templateFor(settings, template);
  const finalSubject = String(subject ?? '').trim() || tpl.subject;
  const finalBody = String(body ?? '').trim() || tpl.body;
  if (!finalSubject) throw new Error('Add a subject line.');
  if (finalSubject.length > 140) throw new Error('Keep the subject under 140 characters.');
  if (finalBody.length > 2000) throw new Error('Keep the body under 2,000 characters.');

  const results = await Promise.allSettled(selected.map(async (customer) => {
    if (!customer.email) throw new Error('No email address');
    const meta = { name: customer.name, site: 'Rove' };
    const renderedSubject = renderTemplate(finalSubject, meta);
    const renderedBody = renderTemplate(finalBody, meta);
    const { error } = await supabase.from('notification_log').insert({
      kind: template,
      channel: 'email',
      recipient: customer.email,
      subject: renderedSubject,
      body: renderedBody,
      meta,
    });
    if (error) throw new Error(error.message);
    if (customer.account) {
      const { error: notifyError } = await supabase.from('notifications').insert({
        audience: 'user',
        user_id: customer.id,
        kind: template,
        title: renderedSubject,
        body: renderedBody,
        link: '/account',
      });
      if (notifyError) throw new Error(notifyError.message);
    }
  }));
  const sent = results.filter((result) => result.status === 'fulfilled').length;
  const skipped = results
    .map((result, index) => (result.status === 'rejected'
      ? { id: selected[index].id, reason: result.reason?.message ?? 'Could not send' }
      : null))
    .filter(Boolean);
  return { sent, skipped, total: selected.length };
}

async function adminBulkUpdateVehicles({ ids = [], status }) {
  if (!BULK_FLEET_STATUSES.includes(status)) throw new Error('Choose a valid fleet status.');
  const requests = (Array.isArray(ids) ? ids : []).map(async (id) => {
    const { error } = await supabase
      .from('vehicles')
      .update({ status })
      .eq('id', id);
    if (error) throw new Error(error.message);
  });
  const results = await Promise.allSettled(requests);
  const updated = results.filter((result) => result.status === 'fulfilled').length;
  if (status === 'available') {
    await Promise.all((Array.isArray(ids) ? ids : []).map((id) => (
      adminDispatchAvailabilityAlerts({ vehicleId: id }).catch(() => {})
    )));
  }
  return { updated, skipped: results.length - updated, total: results.length };
}

async function adminEmailTemplates() {
  const settings = await adminSettings();
  const form = templatesForm(settings);
  return EMAIL_TEMPLATE_KINDS.map((kind) => {
    const stored = String(settings[emailTemplateKey('subject', kind)] ?? '').trim();
    const fallback = EMAIL_TEMPLATE_DEFAULTS[kind];
    return {
      kind,
      label: emailTemplateLabel(kind),
      subject: form[kind].subject,
      body: form[kind].body,
      custom: Boolean(stored),
      fallbackSubject: fallback.subject,
      fallbackBody: fallback.body,
    };
  });
}

async function adminSaveEmailTemplate({ kind, subject, body }) {
  if (!EMAIL_TEMPLATE_KINDS.includes(kind)) throw new Error('Unknown email template.');
  const nextSubject = String(subject ?? '').trim();
  const nextBody = String(body ?? '').trim();
  if (!nextSubject) throw new Error('Add a subject line.');
  if (!nextBody) throw new Error('Add a body for this email.');
  if (nextSubject.length > 140) throw new Error('Keep the subject under 140 characters.');
  if (nextBody.length > 2000) throw new Error('Keep the body under 2,000 characters.');
  await adminSaveSettings({
    [emailTemplateKey('subject', kind)]: nextSubject,
    [emailTemplateKey('body', kind)]: nextBody,
  });
  return { ok: true, kind, subject: nextSubject, body: nextBody };
}

async function listAvailabilityAlerts() {
  const { session } = await currentProfile();
  if (!session) return [];
  const { data, error } = await supabase
    .from('availability_alerts')
    .select('id, vehicle_id, start_date, end_date, active, notified_at, match_reason, created_at, vehicles(id, name, image_url, price_per_day, location, status)')
    .eq('user_id', session.user.id)
    .eq('active', true)
    .order('created_at', { ascending: true });
  ensure(error);
  const rows = (data ?? []).filter((row) => row.end_date > todayISO());
  const vehicleIds = [...new Set(rows.map((row) => row.vehicle_id))];
  if (!vehicleIds.length) return [];
  const minStart = rows.reduce((min, row) => (row.start_date < min ? row.start_date : min), rows[0].start_date);
  const maxEnd = rows.reduce((max, row) => (row.end_date > max ? row.end_date : max), rows[0].end_date);
  const [bookings, blocks] = await Promise.all([
    supabase.from('bookings')
      .select('id, vehicle_id, start_date, end_date, status')
      .in('vehicle_id', vehicleIds)
      .in('status', ['pending', 'confirmed', 'active'])
      .lt('start_date', maxEnd)
      .gt('end_date', minStart),
    supabase.from('vehicle_blocks')
      .select('vehicle_id, start_date, end_date')
      .in('vehicle_id', vehicleIds)
      .lt('start_date', maxEnd)
      .gt('end_date', minStart),
  ]);
  ensure(bookings.error);
  ensure(blocks.error);
  const bookingList = (bookings.data ?? []).map((row) => ({
    id: row.id, vehicleId: row.vehicle_id, startDate: row.start_date, endDate: row.end_date, status: row.status,
  }));
  const blockList = (blocks.data ?? []).map((row) => ({
    vehicleId: row.vehicle_id, startDate: row.start_date, endDate: row.end_date,
  }));
  return rows.map((row) => {
    const vehicle = row.vehicles ? mapVehicle(row.vehicles) : null;
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      startDate: row.start_date,
      endDate: row.end_date,
      active: Boolean(row.active),
      notified: Boolean(row.notified_at),
      notifiedAt: row.notified_at,
      matchReason: row.match_reason,
      freeNow: Boolean(vehicle) && vehicleFreeInWindow({
        vehicle, startDate: row.start_date, endDate: row.end_date, bookings: bookingList, blocks: blockList,
      }),
      vehicle: vehicle ? {
        id: vehicle.id,
        name: vehicle.name,
        imageUrl: vehicle.imageUrl,
        pricePerDay: vehicle.pricePerDay,
        location: vehicle.location,
      } : null,
    };
  });
}

async function createAvailabilityAlert({ vehicleId, startDate, endDate }) {
  const { session } = await currentProfile();
  if (!session) throw new Error('Please sign in to continue.');
  if (!vehicleId || !/^\d{4}-\d{2}-\d{2}$/.test(String(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate)) || String(endDate) <= String(startDate)) {
    throw new Error('Choose a valid date window.');
  }
  const { data, error } = await supabase
    .from('availability_alerts')
    .insert({ user_id: session.user.id, vehicle_id: vehicleId, start_date: startDate, end_date: endDate })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { ok: true, alert: data };
}

async function deleteAvailabilityAlert({ alertId }) {
  const { session } = await currentProfile();
  if (!session) throw new Error('Please sign in to continue.');
  const { error } = await supabase
    .from('availability_alerts')
    .delete()
    .eq('id', alertId)
    .eq('user_id', session.user.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function adminAvailabilityAlerts() {
  const [alertRows, vehicleRows, profileRows] = await Promise.all([
    fetchAll(() => supabase
      .from('availability_alerts')
      .select('id, user_id, vehicle_id, start_date, end_date, active, notified_at, match_reason, created_at')
      .eq('active', true)
      .order('id')),
    fetchAll(() => supabase.from('vehicles').select('*, reviews(count)').order('id')),
    fetchAll(() => supabase.from('profiles').select('id, full_name, email').order('id')),
  ]);
  if (!alertRows.length) {
    return availabilityBoard({ users: [], bookings: [], vehicles: [], blocks: [], today: todayISO() });
  }
  const vehicleIds = [...new Set(alertRows.map((row) => row.vehicle_id))];
  const minStart = alertRows.reduce((min, row) => (row.start_date < min ? row.start_date : min), alertRows[0].start_date);
  const maxEnd = alertRows.reduce((max, row) => (row.end_date > max ? row.end_date : max), alertRows[0].end_date);
  const [bookingRows, blockRows] = await Promise.all([
    fetchAll(() => supabase.from('bookings')
      .select('id, vehicle_id, start_date, end_date, status')
      .in('vehicle_id', vehicleIds)
      .in('status', ['pending', 'confirmed', 'active'])
      .lt('start_date', maxEnd)
      .gt('end_date', minStart)
      .order('id')),
    fetchAll(() => supabase.from('vehicle_blocks')
      .select('vehicle_id, start_date, end_date')
      .in('vehicle_id', vehicleIds)
      .lt('start_date', maxEnd)
      .gt('end_date', minStart)
      .order('id')),
  ]);
  const profileById = new Map(profileRows.map((row) => [row.id, row]));
  const alertsByUser = new Map();
  alertRows.forEach((row) => {
    const list = alertsByUser.get(row.user_id) ?? [];
    list.push({
      id: row.id,
      vehicleId: row.vehicle_id,
      startDate: row.start_date,
      endDate: row.end_date,
      active: Boolean(row.active),
      notifiedAt: row.notified_at,
      matchReason: row.match_reason,
      createdAt: row.created_at,
    });
    alertsByUser.set(row.user_id, list);
  });
  const users = [...alertsByUser.entries()].map(([userId, userAlerts]) => {
    const profile = profileById.get(userId);
    return {
      id: userId,
      name: profile?.full_name ?? 'Customer',
      email: profile?.email ?? '',
      alerts: userAlerts,
    };
  });
  return availabilityBoard({
    users,
    bookings: bookingRows.map((row) => ({
      id: row.id, vehicleId: row.vehicle_id, startDate: row.start_date, endDate: row.end_date, status: row.status,
    })),
    vehicles: vehicleRows.map(mapVehicle),
    blocks: blockRows.map((row) => ({
      vehicleId: row.vehicle_id, startDate: row.start_date, endDate: row.end_date,
    })),
    today: todayISO(),
  });
}

async function adminDispatchAvailabilityAlerts({ alertIds = null, vehicleId = null, limit = 50 } = {}) {
  const board = await adminAvailabilityAlerts();
  let rows = board.rows.filter((row) => row.ready);
  if (vehicleId) rows = rows.filter((row) => row.vehicleId === vehicleId);
  if (Array.isArray(alertIds) && alertIds.length) {
    rows = rows.filter((row) => alertIds.includes(row.alertId));
  }
  rows = rows.slice(0, Math.max(0, limit));
  if (!rows.length) return { dispatched: 0, alertIds: [] };
  const at = new Date().toISOString();
  const ids = rows.map((row) => row.alertId);
  // Claim only rows that are still un-notified. A concurrent dispatcher (or a
  // double click) then sees zero claimed rows and cannot send a duplicate.
  const { data: updated, error } = await supabase
    .from('availability_alerts')
    .update({ notified_at: at, matched_at: at, match_reason: 'Released by staff' })
    .in('id', ids)
    .is('notified_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  const claimed = new Set((updated ?? []).map((row) => row.id));
  const claimedRows = rows.filter((row) => claimed.has(row.alertId));
  if (!claimedRows.length) return { dispatched: 0, alertIds: [] };

  const settings = await adminSettings();
  const tpl = templateFor(settings, 'availability_alert');
  for (const row of claimedRows) {
    await supabase.from('notifications').insert({
      audience: 'user',
      user_id: row.userId,
      kind: 'availability_alert',
      title: `${row.vehicleName} is free for your dates`,
      body: `Your watchlist window (${row.startDate} → ${row.endDate}) just opened up. Book it before someone else does.`,
      link: `/vehicles/${row.vehicleId}?from=${row.startDate}&to=${row.endDate}&alert=1`,
    });
    if (row.customerEmail) {
      await supabase.from('notification_log').insert({
        kind: 'availability_alert',
        channel: 'email',
        recipient: row.customerEmail,
        subject: renderTemplate(tpl.subject, { name: row.customerName, vehicle: row.vehicleName, dates: `${row.startDate} → ${row.endDate}` }),
        body: renderTemplate(tpl.body, { name: row.customerName, vehicle: row.vehicleName, dates: `${row.startDate} → ${row.endDate}` }),
        meta: { alertId: row.alertId, vehicleId: row.vehicleId },
      });
    }
  }
  return { dispatched: claimedRows.length, alertIds: claimedRows.map((row) => row.alertId) };
}

async function adminReturnBookings() {
  const bookings = await adminBookings();
  return (Array.isArray(bookings) ? bookings : [])
    .filter((booking) => (
      booking.status === 'active'
      || (booking.status === 'completed' && !booking.depositSettlement)
    ))
    .sort((a, b) => String(a.endDate ?? '').localeCompare(String(b.endDate ?? '')));
}

async function adminSaveReturnChecks({ bookingId, checked = [] }) {
  const clean = (Array.isArray(checked) ? checked : []).filter((key) => RETURN_CHECK_KEYS.includes(key));
  const { data, error } = await supabase
    .from('bookings')
    .update({ return_checks: returnCheckPayload(clean) })
    .eq('id', bookingId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function adminSettleReturn({ bookingId, checked = [], waiveKm = false, ...inspection }) {
  const clean = (Array.isArray(checked) ? checked : []).filter((key) => RETURN_CHECK_KEYS.includes(key));
  if (RETURN_CHECK_KEYS.some((key) => !clean.includes(key))) {
    throw new Error('Complete the return checklist before settling.');
  }
  // The vehicle supplies the allowance when the booking predates the snapshot
  // (or the snapshot columns are still zero for an old row).
  const { data: row, error } = await supabase
    .from('bookings')
    .select('*, vehicles(km_cap, km_extra_rate)')
    .eq('id', bookingId)
    .single();
  if (error) throw new Error(error.message);
  if (!['active', 'completed'].includes(row.status)) {
    throw new Error('Only an active or completed trip can be settled.');
  }
  if (row.deposit_settlement) throw new Error('This return has already been settled.');

  const condition = returnCondition(inspection, {
    pickupOdometer: row.pickup_odometer ?? row.pickup_inspection?.odometer ?? null,
  });

  const record = settlementRecord({
    booking: {
      id: row.id,
      code: row.code,
      status: row.status,
      holdAmount: row.hold_amount ?? 0,
      startDate: row.start_date,
      endDate: row.end_date,
      dropoffTime: row.dropoff_time,
      completedAt: row.completed_at,
      pickupOdometer: row.pickup_odometer ?? row.pickup_inspection?.odometer ?? null,
      kmCap: row.km_cap ?? row.vehicles?.km_cap ?? 0,
      kmExtraRate: Number(row.km_extra_rate) || Number(row.vehicles?.km_extra_rate) || 0,
      vehicleId: row.vehicle_id,
      depositSettlement: row.deposit_settlement,
    },
    inspection,
    checked: clean,
    waiveKm: Boolean(waiveKm),
    refundMethod: inspection?.refundMethod,
  });
  record.inspection.recordedAt = new Date().toISOString();
  record.inspection.odometer = condition.odometer;
  record.inspection.cleanliness = condition.cleanliness;
  record.settlement.chargedAt = new Date().toISOString();

  const { data, error: updateError } = await supabase
    .from('bookings')
    .update({
      return_checks: returnCheckPayload(clean),
      inspection: record.inspection,
      return_odometer: condition.odometer,
      deposit_settlement: record.settlement,
      status: 'completed',
    })
    .eq('id', bookingId)
    .select('*')
    .single();
  if (updateError) throw new Error(updateError.message);

  // The trip is closed, so the car is free again (unless someone parked it in
  // maintenance while it was out). Best-effort: the settlement must not fail
  // because a cosmetic fleet flag could not be written.
  if (row.vehicle_id) {
    await supabase.from('vehicles').update({ status: 'available' }).eq('id', row.vehicle_id).eq('status', 'rented');
  }

  const recipient = row.guest_email || (row.user_id ? await emailForUser(row.user_id) : '');
  const profile = row.user_id
    ? (await supabase.from('profiles').select('full_name').eq('id', row.user_id).maybeSingle()).data
    : null;
  const name = row.guest_name || profile?.full_name || 'there';
  const charges = `₹${record.settlement.charges.toLocaleString('en-IN')}`;
  const refund = `₹${record.settlement.refundDue.toLocaleString('en-IN')}`;
  const settings = await adminSettings();
  const tpl = templateFor(settings, 'deposit_settled');
  if (recipient) {
    await supabase.from('notification_log').insert({
      kind: 'deposit_settled',
      channel: 'email',
      recipient,
      subject: renderTemplate(tpl.subject, { code: row.code, name, charges, refund }),
      body: renderTemplate(tpl.body, { code: row.code, name, charges, refund }),
      meta: { code: row.code, charges, refund },
    });
  }
  if (row.user_id) {
    await supabase.from('notifications').insert({
      audience: 'user',
      user_id: row.user_id,
      kind: 'deposit_settled',
      title: record.settlement.charges > 0 ? 'Deposit settled with deductions' : 'Deposit released',
      body: record.settlement.charges > 0
        ? `${charges} was deducted from your deposit; ${refund} is on its way back.`
        : `Your ${refund} deposit is on its way back to the original payment method.`,
      booking_code: row.code,
      link: `/confirmation/${row.code}`,
    });
  }
  return { ok: true, booking: data, settlement: record.settlement };
}

async function adminRefund({ bookingId }) {
  return functionCall('razorpay-refund', { bookingId, reason: 'Admin refund' });
}

const PAYMENT_METHOD_BRAND = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer' };

async function adminRecordPayment({ bookingId, amount, method = 'cash', reference = '' } = {}) {
  const { data: booking, error: readError } = await supabase
    .from('bookings').select('*').eq('id', bookingId).maybeSingle();
  ensure(readError);
  if (!booking) throw new Error('Booking not found.');
  if (['cancelled', 'rejected'].includes(booking.status)) throw new Error('This booking is closed.');
  const paid = Number(booking.amount_paid) || 0;
  const total = Number(booking.total) || 0;
  const balance = Math.max(0, total - paid);
  const value = Number(amount);
  if (!Number.isInteger(value) || value <= 0) throw new Error('Enter a whole-rupee amount greater than zero.');
  if (value > balance) throw new Error(`The balance is ₹${balance.toLocaleString('en-IN')} — you cannot record more than that.`);
  const brand = PAYMENT_METHOD_BRAND[method] ?? 'Cash';
  const referenceText = String(reference ?? '').trim().slice(0, 60);
  const at = new Date().toISOString();
  const nextPaid = Math.min(total, paid + value);

  const { error: insertError } = await supabase.from('payments').insert({
    booking_id: booking.id,
    kind: 'balance',
    amount: value,
    currency: 'INR',
    status: 'succeeded',
    brand,
    reference: referenceText || `desk_${Date.now()}`,
    created_at: at,
  });
  if (insertError) throw new Error(insertError.message);

  const patch = { amount_paid: nextPaid };
  if (nextPaid >= total) patch.payment_status = 'paid';
  const { data, error: updateError } = await supabase
    .from('bookings').update(patch).eq('id', booking.id).select('*').single();
  if (updateError) throw new Error(updateError.message);
  return { ok: true, booking: data };
}

async function adminRefundCredit({ bookingId }) {
  return functionCall('razorpay-refund', { bookingId, creditOnly: true, reason: 'Booking change credit' });
}

async function adminVehicleBlocks({ from = null, to = null } = {}) {
  const rows = await fetchAll(() => {
    let query = supabase
      .from('vehicle_blocks')
      .select('*, vehicle:vehicles(id,name,brand,location,image_url)')
      .order('start_date')
      .order('id');
    if (from && to) {
      query = query.lt('start_date', to).gt('end_date', from);
    }
    return query;
  });
  return rows.map(mapVehicleBlock);
}

async function adminSaveVehicleBlock(payload = {}) {
  const vehicleId = String(payload.vehicleId ?? '');
  const startDate = String(payload.startDate ?? '');
  const endDate = String(payload.endDate ?? '');
  if (!vehicleId) throw new Error('Choose a vehicle to block.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Choose valid block start and end dates.');
  }
  if (startDate >= endDate) throw new Error('The block must end after it starts.');
  const kind = ['maintenance', 'private', 'buffer', 'other'].includes(payload.kind)
    ? payload.kind
    : 'maintenance';

  const { data: bookingConflict, error: bookingError } = await supabase
    .from('bookings')
    .select('code')
    .eq('vehicle_id', vehicleId)
    .in('status', ['pending', 'confirmed', 'active'])
    .lt('start_date', endDate)
    .gt('end_date', startDate)
    .limit(1)
    .maybeSingle();
  ensure(bookingError);
  if (bookingConflict) {
    throw new Error(`Those dates overlap active booking ${bookingConflict.code}. Move or cancel the booking first.`);
  }

  let blockConflictQuery = supabase
    .from('vehicle_blocks')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .lt('start_date', endDate)
    .gt('end_date', startDate);
  if (payload.id) blockConflictQuery = blockConflictQuery.neq('id', payload.id);
  const { data: blockConflict, error: blockError } = await blockConflictQuery.limit(1).maybeSingle();
  ensure(blockError);
  if (blockConflict) throw new Error('This vehicle already has a block that overlaps those dates.');

  const row = {
    vehicle_id: vehicleId,
    start_date: startDate,
    end_date: endDate,
    kind,
    reason: String(payload.reason ?? '').trim().slice(0, 120),
    notes: String(payload.notes ?? '').trim().slice(0, 600),
  };

  if (payload.id) {
    const { data, error } = await supabase
      .from('vehicle_blocks')
      .update(row)
      .eq('id', payload.id)
      .select('*, vehicle:vehicles(id,name,brand,location,image_url)')
      .single();
    ensure(error);
    return mapVehicleBlock(data);
  }

  const { session } = await currentProfile();
  if (!session) throw new Error('Please sign in to continue.');
  const { data, error } = await supabase
    .from('vehicle_blocks')
    .insert({ ...row, created_by: session.user.id })
    .select('*, vehicle:vehicles(id,name,brand,location,image_url)')
    .single();
  ensure(error);
  return mapVehicleBlock(data);
}

async function adminDeleteVehicleBlock(id) {
  const { data, error } = await supabase
    .from('vehicle_blocks')
    .delete()
    .eq('id', id)
    .select('id, vehicle_id')
    .maybeSingle();
  ensure(error);
  if (!data) throw new Error('Availability block not found, or you do not have permission to delete it.');
  await adminDispatchAvailabilityAlerts({ vehicleId: data.vehicle_id }).catch(() => {});
  return { ok: true };
}

async function adminServiceLogs({ vehicleId = null } = {}) {
  const rows = await fetchAll(() => {
    let query = supabase
      .from('vehicle_service_logs')
      .select('*, vehicle:vehicles(id,name,brand,kind,location,image_url,odometer)')
      .order('service_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id');
    if (vehicleId) query = query.eq('vehicle_id', vehicleId);
    return query;
  });
  return rows.map(mapServiceLog);
}

async function adminSaveServiceLog(payload = {}) {
  const { data: vehicleRow, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', payload.vehicleId)
    .maybeSingle();
  ensure(vehicleError);
  if (!vehicleRow) throw new Error('Choose a vehicle to service.');
  const vehicle = mapVehicle(vehicleRow);
  const result = serviceEntry(payload, vehicle);
  if (!result.ok) throw new Error(result.problem);

  const { session } = await currentProfile();
  if (!session) throw new Error('Please sign in to continue.');
  const { data, error } = await supabase
    .from('vehicle_service_logs')
    .insert({
      vehicle_id: vehicle.id,
      service_date: result.value.serviceDate,
      odometer: result.value.odometer,
      kind: result.value.kind,
      cost: result.value.cost,
      vendor: result.value.vendor,
      reference: result.value.reference,
      notes: result.value.notes,
      resets_service: result.value.resetsService,
      created_by: session.user.id,
    })
    .select('*, vehicle:vehicles(id,name,brand,kind,location,image_url,odometer)')
    .single();
  ensure(error);

  if (payload.returnToService && vehicle.status === 'maintenance') {
    await adminBulkUpdateVehicles({ ids: [vehicle.id], status: 'available' });
  }
  return mapServiceLog(data);
}

async function adminDeleteServiceLog(id) {
  const { data, error } = await supabase
    .from('vehicle_service_logs')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  ensure(error);
  if (!data) throw new Error('Service entry not found, or you do not have permission to remove it.');
  return { ok: true };
}

async function adminSetOdometer({ vehicleId, odometer } = {}) {
  const { data: row, error: readError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .maybeSingle();
  ensure(readError);
  if (!row) throw new Error('Vehicle not found.');
  const vehicle = mapVehicle(row);
  const problem = odometerProblem(odometer, vehicle);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase
    .from('vehicles')
    .update({ odometer: Math.round(Number(odometer)) })
    .eq('id', vehicleId)
    .select('*')
    .single();
  ensure(error);
  return mapVehicle(data);
}

async function adminAuditLogs({ limit = 300 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  ensure(error);
  return (data ?? []).map(mapAuditLog);
}

async function adminVehicles() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*, reviews(count), bookings(count)')
    .order('created_at', { ascending: false });
  ensure(error);
  return (data ?? []).map(mapVehicle);
}

async function adminSaveVehicle(payload) {
  if (payload.kind === 'bike' && !payload.gears) {
    throw new Error('Please choose the gearbox for this bike.');
  }
  const images = Array.isArray(payload.images) && payload.images.length
    ? payload.images.filter(Boolean)
    : [payload.imageUrl].filter(Boolean);
  if (images.length > 8) throw new Error('Use no more than 8 images per vehicle.');
  if (images.some((image) => urlProblem(image))) {
    throw new Error('Vehicle images must be valid http(s) URLs or uploaded files.');
  }
  if (payload.lastServiceDate) {
    if (!isValidDate(payload.lastServiceDate)) throw new Error('Choose a valid last-service date.');
    if (payload.lastServiceDate > todayISO()) throw new Error('Last-service date cannot be in the future.');
  }
  const payloadOdometer = optionalNumber(payload.odometer);
  const payloadServiceOdometer = optionalNumber(payload.lastServiceOdometer);
  if (payloadOdometer !== null && payloadServiceOdometer !== null && payloadServiceOdometer > payloadOdometer) {
    throw new Error('The last-service odometer cannot be higher than the current odometer.');
  }
  if (payload.serviceIntervalKm !== undefined && payload.serviceIntervalKm !== '' && Number(payload.serviceIntervalKm) <= 0) {
    throw new Error('Service interval distance must be greater than zero.');
  }
  if (payload.serviceIntervalDays !== undefined && payload.serviceIntervalDays !== '' && Number(payload.serviceIntervalDays) <= 0) {
    throw new Error('Service interval days must be greater than zero.');
  }
  const pricePerDay = Number(payload.pricePerDay);
  if (!Number.isFinite(pricePerDay) || pricePerDay < 500 || pricePerDay > 200000) {
    throw new Error('Daily price must be between ₹500 and ₹2,00,000.');
  }
  if (!Number.isInteger(pricePerDay)) {
    throw new Error('Daily price must be a whole rupee amount.');
  }
  const minAgeValue = payload.minAge === '' || payload.minAge === null || payload.minAge === undefined
    ? (payload.kind === 'bike' ? 18 : 21)
    : Number(payload.minAge);
  if (!Number.isInteger(minAgeValue) || minAgeValue < 16 || minAgeValue > 90) {
    throw new Error('Minimum age must be a whole number between 16 and 90.');
  }
  const docProblems = fleetDocProblems(payload);
  const firstDocProblem = Object.values(docProblems)[0];
  if (firstDocProblem) throw new Error(firstDocProblem);
  const kmProblems = kmVehicleProblems(payload);
  const firstKmProblem = Object.values(kmProblems)[0];
  if (firstKmProblem) throw new Error(firstKmProblem);
  const row = vehiclePayload(payload);
  row.price_per_day = pricePerDay;
  row.min_age = minAgeValue;
  if (!row.image_url) throw new Error('At least one image is required.');
  if (payload.id) {
    const { data, error } = await supabase
      .from('vehicles')
      .update(row)
      .eq('id', payload.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    if (data.status === 'available') {
      await adminDispatchAvailabilityAlerts({ vehicleId: data.id }).catch(() => {});
    }
    return mapVehicle(data);
  }
  const { data, error } = await supabase
    .from('vehicles')
    .insert(row)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapVehicle(data);
}

async function adminDeleteVehicle(id) {
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new Error('This vehicle has booking history. Set it to maintenance instead of deleting.');
    }
    throw new Error(error.message);
  }
}

async function adminExtras() {
  const { data, error } = await supabase.from('extras').select('*').order('created_at');
  ensure(error);
  return (data ?? []).map(mapExtra);
}

async function adminInsuranceTiers() {
  const { data, error } = await supabase.from('insurance_tiers').select('*');
  ensure(error);
  const order = { basic: 0, standard: 1, full: 2 };
  return (data ?? [])
    .map(mapInsuranceTier)
    .sort((a, b) => (order[a.key] ?? 9) - (order[b.key] ?? 9));
}

async function adminSaveInsuranceTier(payload) {
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
  if (payload.active === false) {
    const { data: active, error: activeError } = await supabase
      .from('insurance_tiers')
      .select('key')
      .eq('active', true)
      .neq('key', payload.key);
    ensure(activeError);
    if (!(active ?? []).length) throw new Error('Keep at least one protection tier active.');
  }

  const { data, error } = await supabase
    .from('insurance_tiers')
    .update({
      label,
      price_per_day: Math.round(price),
      deductible: Math.round(deductible),
      blurb,
      active: payload.active !== false,
    })
    .eq('key', payload.key)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapInsuranceTier(data);
}

async function adminSaveExtra(payload) {
  const price = Number(payload.pricePerDay);
  if (!payload.label) throw new Error('Extra label is required.');
  if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid daily price.');

  if (payload.id) {
    const { error } = await supabase
      .from('extras')
      .update({
        label: payload.label,
        description: payload.description || '',
        price_per_day: Math.round(price),
        active: payload.active !== false,
      })
      .eq('id', payload.id);
    if (error) throw new Error(error.message);
  } else {
    const key = String(payload.key || payload.label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30);
    const { error } = await supabase.from('extras').insert({
      key,
      label: payload.label,
      description: payload.description || '',
      price_per_day: Math.round(price),
      active: payload.active !== false,
    });
    if (error) throw new Error(error.message);
  }
  return adminExtras();
}

async function adminDeleteExtra(id) {
  const { error } = await supabase.from('extras').delete().eq('id', id);
  if (error) throw new Error('This extra is referenced by bookings and cannot be deleted. Mark it inactive instead.');
}

async function adminPromos() {
  const { data, error } = await supabase.from('promos').select('*').order('created_at', { ascending: false });
  ensure(error);
  return (data ?? []).map(mapPromo);
}

async function adminSavePromo(payload) {
  const code = String(payload.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new Error('Code must be 3–20 letters or numbers.');
  const value = Number(payload.value);
  if (!Number.isInteger(value) || value <= 0) throw new Error('Enter a whole discount value.');
  if (payload.type === 'percent' && value > 90) throw new Error('Percentage discounts cannot exceed 90%.');

  const row = {
    code,
    description: payload.description || '',
    type: payload.type || 'percent',
    value: Math.round(value),
    min_days: Number(payload.minDays) || 1,
    active: payload.active !== false,
    expires_at: payload.expiresAt || null,
    usage_limit: Number(payload.usageLimit) || 0,
    first_booking_only: Boolean(payload.firstBookingOnly),
  };

  if (payload.id) {
    const { error } = await supabase.from('promos').update(row).eq('id', payload.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('promos').insert(row);
    if (error) throw new Error(error.message);
  }
  return adminPromos();
}

async function adminDeletePromo(id) {
  const { error } = await supabase.from('promos').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

async function adminLocations() {
  const { data, error } = await supabase.from('locations').select('*').order('name');
  ensure(error);
  return data ?? [];
}

async function adminSaveLocation(payload) {
  const name = String(payload.name ?? '').trim();
  if (name.length < 3) throw new Error('Location name is required.');
  if (name.length > 80) throw new Error('Location name must be 80 characters or fewer.');
  const phoneError = phoneProblem(payload.phone);
  if (phoneError) throw new Error(phoneError);
  const coordError = coordinatesProblem(payload.lat, payload.lng);
  if (coordError) throw new Error(coordError);
  const { lat, lng } = normalizeCoordinates(payload.lat, payload.lng);

  const { data: locations, error: listError } = await supabase.from('locations').select('id, name');
  ensure(listError);
  if ((locations ?? []).some((item) => item.id !== payload.id && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('A hub with this name already exists.');
  }

  const row = {
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
  if (payload.id) {
    const current = (locations ?? []).find((item) => item.id === payload.id);
    if (current && current.name !== name) {
      const [vehicles, pickups, dropoffs] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('location', current.name),
        supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('pickup_location', current.name),
        supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('dropoff_location', current.name),
      ]);
      ensure(vehicles.error);
      ensure(pickups.error);
      ensure(dropoffs.error);
      if ((vehicles.count ?? 0) + (pickups.count ?? 0) + (dropoffs.count ?? 0) > 0) {
        throw new Error('This hub is already used by vehicles or bookings. Create a new hub instead of renaming it.');
      }
    }
    const { error } = await supabase.from('locations').update(row).eq('id', payload.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('locations').insert(row);
    if (error) throw new Error(error.message);
  }
  return adminLocations();
}

async function adminDeleteLocation(id) {
  const { data: location, error: lookupError } = await supabase
    .from('locations')
    .select('name')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!location) return;

  const [vehicles, pickups, dropoffs] = await Promise.all([
    supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('location', location.name),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('pickup_location', location.name),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('dropoff_location', location.name),
  ]);
  ensure(vehicles.error);
  ensure(pickups.error);
  ensure(dropoffs.error);
  if ((vehicles.count ?? 0) + (pickups.count ?? 0) + (dropoffs.count ?? 0) > 0) {
    throw new Error('This hub has vehicles or bookings attached. Mark it inactive instead.');
  }

  const { error } = await supabase.from('locations').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

async function adminUsers() {
  const { data, error } = await supabase.rpc('admin_users');
  ensure(error);
  return data ?? [];
}

async function adminUpdateUser(id, patch) {
  const { data, error } = await supabase.rpc('admin_update_user', {
    p_user_id: id,
    p_role: patch.role ?? null,
    p_status: patch.status ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function adminVerifyLicence(id, verified) {
  const { data, error } = await supabase.rpc('admin_verify_licence', {
    p_user_id: id,
    p_verified: Boolean(verified),
  });
  ensure(error);
  return data;
}

async function adminLicenceUrl(path) {
  if (!path) throw new Error('No licence scan is on file.');
  if (/^(https?:|data:)/.test(path)) return path;
  const { data, error } = await supabase.storage.from('licences').createSignedUrl(path, 600);
  ensure(error);
  return data?.signedUrl ?? path;
}

const mapNotification = (row) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body ?? '',
  bookingCode: row.booking_code ?? '',
  link: row.link ?? '',
  readAt: row.read_at,
  createdAt: row.created_at,
});

async function myNotifications() {
  const session = await getSession();
  if (!session?.user) throw new Error('Sign in to see your notifications.');
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('audience', 'user')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(40);
  ensure(error);
  return (data ?? []).map(mapNotification);
}

async function unreadNotificationCount() {
  const session = await getSession();
  if (!session?.user) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('audience', 'user')
    .eq('user_id', session.user.id)
    .is('read_at', null);
  ensure(error);
  return count ?? 0;
}

async function markNotificationRead(id) {
  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  return true;
}

async function markAllNotificationsRead() {
  const session = await getSession();
  if (!session?.user) return true;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('audience', 'user')
    .eq('user_id', session.user.id)
    .is('read_at', null);
  if (error) throw new Error(error.message);
  return true;
}

async function staffNotifications(limit = 8) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('audience', 'staff')
    .order('created_at', { ascending: false })
    .limit(limit);
  ensure(error);
  return (data ?? []).map(mapNotification);
}

const mapNotificationLog = (row) => ({
  id: row.id,
  kind: row.kind,
  channel: row.channel,
  recipient: row.recipient,
  subject: row.subject,
  body: row.body,
  meta: row.meta ?? {},
  status: row.status,
  createdAt: row.created_at,
});

async function adminNotificationLog(limit = 20) {
  const capped = Math.min(Math.max(1, Math.round(Number(limit) || 20)), 500);
  const { data, error } = await supabase
    .from('notification_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(capped);
  ensure(error);
  return (data ?? []).map(mapNotificationLog);
}

/** Same contract as the demo adapter: one staff RPC owns auth + opt-out checks. */
async function adminResendEmail({ id } = {}) {
  if (!id) throw new Error('Choose an email to resend.');
  const { data, error } = await supabase.rpc('resend_notification', { p_id: id });
  ensure(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('The email could not be resent.');
  return mapNotificationLog(row);
}

async function emailForUser(userId) {
  if (!userId) return '';
  const { data } = await supabase.from('profiles').select('email').eq('id', userId).maybeSingle();
  return data?.email ?? '';
}

async function adminReviews() {
  const data = await fetchAll(() => supabase
    .from('reviews')
    .select('*, vehicle:vehicles(name, brand), booking:bookings(guest_name, guest_email, code, user_id, profiles:profiles(email))')
    .order('created_at', { ascending: false })
    .order('id'));
  return data.map((review) => ({
    id: review.id,
    author: review.author,
    email: (() => {
      const embedded = review.booking?.profiles;
      const ownerEmail = Array.isArray(embedded) ? embedded[0]?.email : embedded?.email;
      return ownerEmail ?? review.booking?.guest_email ?? '';
    })(),
    rating: review.rating,
    comment: review.comment,
    reply: review.reply ?? null,
    repliedAt: review.replied_at ?? null,
    repliedBy: review.replied_by ?? null,
    createdAt: review.created_at,
    vehicleName: review.vehicle?.name ?? 'Vehicle removed',
    vehicleId: review.vehicle_id ?? null,
    bookingCode: review.booking?.code ?? null,
  }));
}

async function adminDeleteReview(id) {
  const { error } = await supabase.from('reviews').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function adminReplyToReview({ id, reply = '' } = {}) {
  const settings = await adminSettings();
  if (settings.review_replies_enabled === 'false') {
    throw new Error('Review replies are switched off in Settings.');
  }
  const text = String(reply ?? '').trim();
  if (text.length > 1200) throw new Error('Keep the reply under 1,200 characters.');
  const { session } = await currentProfile();
  if (!session) throw new Error('Sign in to reply to reviews.');
  const { data, error } = await supabase
    .from('reviews')
    .update({
      reply: text || null,
      replied_at: text ? new Date().toISOString() : null,
      replied_by: text ? session.user.id : null,
    })
    .eq('id', id)
    .select('id, reply, replied_at, replied_by')
    .single();
  ensure(error);
  return {
    ok: true,
    id: data.id,
    reply: data.reply ?? null,
    repliedAt: data.replied_at ?? null,
    repliedBy: data.replied_by ?? null,
  };
}

async function adminSettings() {
  const { data, error } = await supabase.from('settings').select('*');
  ensure(error);
  return settingsToObject(data);
}

async function adminSaveSettings(patch) {
  const ruleError = Object.values(rateRulePatchErrors(patch))[0];
  if (ruleError) throw new Error(ruleError);
  const rows = Object.entries(patch).map(([key, value]) => ({ key, value: String(value) }));
  const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return settingsToObject(rows);
}

async function uploadVehicleImage(file) {
  if (!file) throw new Error('Choose an image to upload.');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use a JPG, PNG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Images must be under 5 MB.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from('vehicle-images')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('vehicle-images').getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Licence upload (KYC). Stores the scan in the private 'licences' bucket
 * (owner-scoped, see migration 202610200004) and records profiles.licence_url
 * for staff review. Only staff can set the verified flag (migration 005).
 * The demo adapter verifies instantly because there is no live reviewer.
 */
async function uploadLicence(file) {
  const { session } = await currentProfile();
  if (!session) throw new Error('Please sign in to verify your licence.');
  if (!file) throw new Error('Choose an image to upload.');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use a JPG, PNG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Images must be under 5 MB.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${session.user.id}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from('licences')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ licence_url: path })
    .eq('id', session.user.id);
  if (updateError) throw new Error(updateError.message);
  // The bucket is private: hand back a short-lived signed URL for the
  // confirmation screen instead of a public URL that would never load.
  const { data } = await supabase.storage.from('licences').createSignedUrl(path, 600);
  return { url: data?.signedUrl ?? path, verified: false };
}

const mapContactMessage = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone ?? '',
  message: row.message,
  bookingCode: row.booking_code ?? '',
  subject: row.subject ?? 'General',
  status: row.status ?? 'new',
  staffNotes: row.staff_notes ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at ?? row.created_at,
});

/** Contact form submitted on /contact. Lands in contact_messages for staff. */
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
  const { error } = await supabase.from('contact_messages').insert({
    name: name.slice(0, 80),
    email: email.slice(0, 160),
    phone: phone.slice(0, 32),
    message: message.slice(0, 1200),
    booking_code: bookingCode || null,
    subject: subject.slice(0, 40),
  });
  if (error) throw new Error(error.message);
  return { ok: true, bookingCode };
}

async function adminContactMessages() {
  const { data, error } = await supabase
    .from('contact_messages')
    .select('*')
    .order('created_at', { ascending: false });
  ensure(error);
  return (data ?? []).map(mapContactMessage);
}

async function adminUpdateContactMessage({ id, status, staffNotes, subject } = {}) {
  if (!id) throw new Error('Message not found.');
  const patch = {};
  if (status !== undefined) {
    if (!['new', 'read', 'resolved'].includes(status)) throw new Error('Choose a valid message status.');
    patch.status = status;
  }
  if (subject !== undefined) {
    if (!CONTACT_SUBJECTS.includes(subject)) throw new Error('Choose a valid subject.');
    patch.subject = subject;
  }
  if (staffNotes !== undefined) patch.staff_notes = String(staffNotes).trim().slice(0, 1200);
  if (!Object.keys(patch).length) return null;
  const { data, error } = await supabase
    .from('contact_messages')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  ensure(error);
  if (!data) throw new Error('Message not found, or you do not have permission to edit it.');
  return mapContactMessage(data);
}

async function adminDeleteContactMessage(id) {
  const { data, error } = await supabase
    .from('contact_messages')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  ensure(error);
  if (!data) throw new Error('Message not found, or you do not have permission to delete it.');
  return { ok: true };
}

export const supabaseApi = {
  mode: 'supabase',
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
  sendReturnReminder,
  sendPickupReminder,
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
