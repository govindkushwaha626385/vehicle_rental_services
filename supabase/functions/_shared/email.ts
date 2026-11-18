/**
 * Transactional email helpers for Edge Functions.
 *
 * The browser bundle's `src/lib/emailTemplates.js` cannot be imported from Deno,
 * so the placeholder renderer lives here too. Keep the two in lockstep: the
 * adapter renders at queue time, while functions that write notification_log
 * rows directly (Razorpay confirmation, webhooks) render here.
 */

const PLACEHOLDER_KEYS = [
  'site', 'code', 'name', 'dates', 'amount', 'hub', 'time', 'reason',
  'status', 'delta', 'refund', 'charges', 'vehicle', 'km', 'late',
] as const;

export function renderTemplate(text: unknown, meta: Record<string, unknown> = {}): string {
  let out = String(text ?? '');
  const values: Record<string, unknown> = { site: 'Rove', ...meta };
  for (const key of PLACEHOLDER_KEYS) {
    const value = values[key] === undefined || values[key] === null ? '' : String(values[key]);
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

/**
 * Admin override per half, then the transactional fallback. Empty override
 * settings mean "not customised", exactly like the browser adapter.
 */
export function renderEmail(
  overrides: { subject?: string; body?: string },
  fallback: { subject: string; body: string },
  meta: Record<string, unknown> = {}
) {
  const subject = String(overrides.subject ?? '').trim() || fallback.subject;
  const body = String(overrides.body ?? '').trim() || fallback.body;
  return {
    subject: renderTemplate(subject, meta),
    body: renderTemplate(body, meta),
  };
}

/** Mirrors `lateFeeTermsText` in src/lib/site.js. */
export function lateTermsLine(hourlyRate: unknown, graceMinutes: unknown, template: string): string {
  const hourly = Math.max(0, Math.round(Number(hourlyRate) || 0));
  const daily = hourly * 24;
  if (!hourly) return 'No late fee applies to this booking.';
  const grace = Math.min(1440, Math.max(0, Math.round(Number(graceMinutes) || 0)));
  return String(template || '')
    .replace(/\{hourly\}/g, `₹${hourly.toLocaleString('en-IN')}`)
    .replace(/\{daily\}/g, `₹${daily.toLocaleString('en-IN')}`)
    .replace(/\{grace\}/g, grace > 0 ? `after a ${grace}-minute grace` : 'with no grace period');
}

/** Mirrors `kmDisclosure(...).label` in src/lib/km.js, with a sentence prefix. */
export function kmTermsLine(kmCap: unknown, kmExtraRate: unknown): string {
  const cap = Math.max(0, Math.round(Number(kmCap) || 0));
  const rate = Math.max(0, Math.round(Number(kmExtraRate) || 0));
  if (!cap || !rate) return 'Kilometres: unlimited.';
  return `Kilometres: ${cap.toLocaleString('en-IN')} km/day included · ₹${rate.toLocaleString('en-IN')}/extra km.`;
}
