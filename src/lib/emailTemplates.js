/**
 * Admin-editable transactional email templates.
 *
 * Defaults live here in code (so the product always works out of the box);
 * Admin → Comms can override subject/body per kind. Overrides are stored as
 * settings keys (email_subject_<kind> / email_body_<kind>) so both the demo
 * adapter (which renders at queue time) and the Supabase notify dispatcher
 * (which reads settings server-side) can share the same configuration surface.
 */

export const EMAIL_TEMPLATE_KINDS = Object.freeze([
  'booking_confirmed',
  'booking_pending',
  'booking_cancelled',
  'booking_active',
  'booking_completed',
  'booking_refunded',
  'trip-change-requested',
  'trip-change-approved',
  'trip-change-declined',
  'trip-extended',
  'pickup_reminder',
  'return-due-reminder',
  'winback_offer',
  'customer_message',
  'deposit_settled',
  'availability_alert',
]);

/** Human labels for the editor. Kept beside the kinds so both adapters agree. */
export const EMAIL_TEMPLATE_LABELS = Object.freeze({
  booking_confirmed: 'Booking confirmed',
  booking_pending: 'Booking received',
  booking_cancelled: 'Booking cancelled',
  booking_active: 'Trip started',
  booking_completed: 'Trip completed',
  booking_refunded: 'Refund issued',
  'trip-change-requested': 'Trip change requested',
  'trip-change-approved': 'Trip change approved',
  'trip-change-declined': 'Trip change declined',
  'trip-extended': 'Trip extended',
  pickup_reminder: 'Pick-up reminder',
  'return-due-reminder': 'Return due reminder',
  winback_offer: 'Win-back offer',
  customer_message: 'Customer message',
  deposit_settled: 'Deposit settled',
  availability_alert: 'Availability alert',
});

export const emailTemplateLabel = (kind = '') =>
  EMAIL_TEMPLATE_LABELS[kind] || String(kind).replace(/[_-]+/g, ' ');

export const EMAIL_TEMPLATE_DEFAULTS = Object.freeze({
  booking_confirmed: {
    subject: 'Your {site} booking {code} is confirmed',
    body: 'Hi {name},\n\nYour {site} rental is confirmed. Booking {code} · {dates}.\n\nPick-up: {hub} at {time}. The security deposit of {amount} is due at pick-up.\n\n{km}\n{late}\n\nThe full voucher and invoice are in your account.',
  },
  booking_pending: {
    subject: 'We have received your {site} booking {code}',
    body: 'Hi {name},\n\nThank you — we are reviewing booking {code} · {dates} and will confirm by email shortly.',
  },
  booking_cancelled: {
    subject: 'Your {site} booking {code} was cancelled',
    body: 'Hi {name},\n\nBooking {code} is now cancelled. {reason}',
  },
  booking_active: {
    subject: 'Your {code} trip is on',
    body: 'Hi {name},\n\nYour {code} trip has started. Roadside assistance is included — drive safe.',
  },
  booking_completed: {
    subject: 'Your {code} trip is complete',
    body: 'Hi {name},\n\nThanks for driving with {site}! Booking {code} is complete. We would love a review of your trip.',
  },
  booking_refunded: {
    subject: 'Refund issued for {code}',
    body: 'Hi {name},\n\nA refund of {amount} is being returned to your original payment method for booking {code}.',
  },
  'trip-change-requested': {
    subject: 'Change request received for {code}',
    body: 'Hi {name},\n\nYour change request for {code} is with our team. We will confirm by email.',
  },
  'trip-change-approved': {
    subject: 'Your {code} change is confirmed',
    body: 'Hi {name},\n\nYour {code} change is confirmed — new dates {dates}. {reason}',
  },
  'trip-change-declined': {
    subject: 'Your {code} change was declined',
    body: 'Hi {name},\n\nYour {code} change was declined{reason}. Your original booking is unchanged.',
  },
  'trip-extended': {
    subject: 'Your {code} return is extended',
    body: 'Hi {name},\n\nYour {code} return is now {dates} at {time}.{reason}\n\nSee your updated voucher in your account.',
  },
  pickup_reminder: {
    subject: 'Your {site} pick-up is on {dates}',
    body: 'Hi {name},\n\nYou are scheduled to collect your {code} rental on {dates} at {time} from {hub}.\n\nBring a valid driving licence, a government photo ID and the payment details on file. The refundable security deposit of {amount} is collected at pick-up.\n\nSee your full voucher and invoice in your account.',
  },
  'return-due-reminder': {
    subject: 'Your {code} return was due',
    body: 'Hi {name},\n\nYour {code} return was due on {dates}. If you are on your way back, great — if you need more time, extend the return in Manage Booking so no late fee accrues.',
  },
  winback_offer: {
    subject: 'We saved a ride for you, {name}',
    body: 'Hi {name},\n\nIt has been a while since your last {site} trip. Your next booking comes with priority pick-up and a free upgrade when one is available.\n\nPick your dates and we will have the keys ready.',
  },
  customer_message: {
    subject: 'A note from {site}',
    body: 'Hi {name},\n\nThanks for being part of {site}. Reply to this email and a real person from the team will help.',
  },
  deposit_settled: {
    subject: 'Deposit settled for {code}',
    body: 'Hi {name},\n\nYour {code} deposit has been settled. Charges: {charges}; refund due: {refund}.\n\nRefunds return to the original payment method within 5–7 working days.',
  },
  availability_alert: {
    subject: 'Good news — {vehicle} is free',
    body: 'Hi {name},\n\n{vehicle} is now available for your dates ({dates}). Watches are first come, first served, so book soon to lock it in.\n\n— {site}',
  },
});

const PLACEHOLDER_KEYS = ['site', 'code', 'name', 'dates', 'amount', 'hub', 'time', 'reason', 'status', 'delta', 'refund', 'charges', 'vehicle', 'km', 'late'];

/** Every token the renderer understands, for editor hints and validation. */
export const TEMPLATE_PLACEHOLDERS = Object.freeze([...PLACEHOLDER_KEYS]);

/**
 * Placeholder-looking tokens that `renderTemplate` will not replace.
 *
 * A typo like `{nmae}` is otherwise emailed to the customer verbatim, which is
 * exactly the kind of silent mistake an admin editor should catch up front.
 */
export function unknownPlaceholders(text = '') {
  const found = new Set();
  const pattern = /\{([A-Za-z0-9_]+)\}/g;
  const source = String(text ?? '');
  let match = pattern.exec(source);
  while (match) {
    if (!PLACEHOLDER_KEYS.includes(match[1])) found.add(match[1]);
    match = pattern.exec(source);
  }
  return [...found];
}

export function renderTemplate(text = '', meta = {}) {
  let out = String(text ?? '');
  const values = { site: 'Rove', ...meta };
  PLACEHOLDER_KEYS.forEach((key) => {
    const value = values[key] === undefined || values[key] === null ? '' : String(values[key]);
    out = out.replaceAll(`{${key}}`, value);
  });
  return out;
}

export const emailTemplateKey = (prefix, kind) => `email_${prefix}_${kind}`;

export function templateOverrides(settings = {}) {
  const source = settings ?? {};
  return Object.fromEntries(EMAIL_TEMPLATE_KINDS.map((kind) => {
    const subject = String(source[emailTemplateKey('subject', kind)] ?? '').trim();
    const body = String(source[emailTemplateKey('body', kind)] ?? '').trim();
    return [kind, { subject, body, custom: Boolean(subject) }];
  }));
}

/**
 * Subject/body for a kind: admin override when present, default otherwise.
 *
 * `subjectCustom` / `bodyCustom` report each half independently. They matter at
 * send time: an admin who edits only the body must not lose the subject (or the
 * other way round), and a caller-supplied transactional body should only be used
 * when the admin has not overridden that half.
 */
export function templateFor(settings = {}, kind = '') {
  const overrides = templateOverrides(settings)[kind];
  const fallback = EMAIL_TEMPLATE_DEFAULTS[kind] || { subject: '', body: '' };
  if (!overrides) return { ...fallback, subjectCustom: false, bodyCustom: false, custom: false };
  return {
    subject: overrides.custom ? overrides.subject : fallback.subject,
    body: overrides.body ? overrides.body : fallback.body,
    subjectCustom: overrides.custom,
    bodyCustom: Boolean(overrides.body),
    // Kept for older call sites that only know about a "customised" template.
    custom: overrides.custom,
  };
}

/**
 * Pick the text that actually gets sent.
 *
 * Each half is independent: an admin override wins, otherwise a caller-supplied
 * transactional line is used, otherwise the shipped default. Keeping this pure
 * (and out of the adapter) is what makes "body-only override" testable.
 */
export function templateContent(template = {}, { subject = '', body = '' } = {}) {
  const hasSubject = String(subject ?? '').trim() !== '';
  const hasBody = String(body ?? '').trim() !== '';
  return {
    subject: template.subjectCustom
      ? template.subject
      : (hasSubject ? subject : template.subject),
    body: template.bodyCustom
      ? template.body
      : (hasBody ? body : template.body),
  };
}

/** Flat settings patch for saving the Comms form (all declared kinds). */
export function templatesPayload(form = {}) {
  const patch = {};
  EMAIL_TEMPLATE_KINDS.forEach((kind) => {
    const row = form[kind] || {};
    patch[emailTemplateKey('subject', kind)] = String(row.subject ?? '').trim();
    patch[emailTemplateKey('body', kind)] = String(row.body ?? '').trim();
  });
  return patch;
}

/** Form-shaped template map for the editor. */
export function templatesForm(settings = {}) {
  const overrides = templateOverrides(settings);
  return Object.fromEntries(EMAIL_TEMPLATE_KINDS.map((kind) => {
    const tpl = templateFor(settings, kind);
    return [kind, { subject: overrides[kind].custom ? overrides[kind].subject : tpl.subject, body: tpl.body }];
  }));
}