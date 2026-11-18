import { admin } from './razorpay.ts';

/**
 * Constant-time verification of a Razorpay webhook signature.
 * Webhooks are signed with a SEPARATE secret (RAZORPAY_WEBHOOK_SECRET) over the
 * RAW request body, and delivered with the X-Razorpay-Signature header.
 */
export const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string
): Promise<boolean> {
  if (!rawBody || !signature || !webhookSecret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Idempotency guard. Razorpay uses at-least-once delivery with up to 24h of
 * retries, so the same event_id may arrive many times. We record a claim row
 * first (unique on event_id): the first call wins; replays are no-ops.
 * Returns true when this event is NEW and should be processed.
 */
/** Stable fallback id for the rare delivery without X-Razorpay-Event-Id. */
export async function bodyEventId(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
  return `body:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function claimEvent(
  eventId: string,
  eventType: string,
  entity: Record<string, unknown>
): Promise<boolean> {
  if (!eventId) return false;
  const { data, error } = await admin
    .from('webhook_events')
    .insert({ event_id: eventId, event_type: eventType, entity })
    .select('id')
    .maybeSingle();

  if (error) {
    // unique violation (23505) means a duplicate delivery — already handled.
    if (error.code === '23505') return false;
    // Any other failure must bubble up so Razorpay retries instead of us
    // silently acknowledging an event we never recorded.
    throw new Error(error.message);
  }
  return Boolean(data?.id);
}

export async function completeEvent(eventId: string) {
  await admin
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', eventId);
}

export async function failEvent(eventId: string, message: string) {
  await admin
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString(), last_error: message.slice(0, 500) })
    .eq('event_id', eventId);
}

/** Staff-visible notification log entry + email enqueue point. */
export async function logNotification(
  kind: string,
  recipient: string,
  subject: string,
  body: string,
  meta: Record<string, unknown> = {}
) {
  try {
    const channel = recipient.includes('@') ? 'email' : 'log';
    const status = channel === 'email' ? 'queued' : 'skipped';
    await admin.from('notification_log').insert({
      kind,
      channel,
      recipient,
      subject,
      body,
      meta,
      status,
    });
  } catch (error) {
    console.error('notification log failed', error.message);
  }
}