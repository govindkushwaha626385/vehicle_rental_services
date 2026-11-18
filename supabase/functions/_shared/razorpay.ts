import { createClient } from 'npm:@supabase/supabase-js@2';

export const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

if (!razorpayKeyId || !razorpayKeySecret) {
  console.warn('Razorpay secrets are not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
}

const authHeader = () => `Basic ${btoa(`${razorpayKeyId}:${razorpayKeySecret}`)}`;

export async function razorpayRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = (payload as { error?: { description?: string } })?.error?.description;
    throw new Error(description || `Razorpay request failed (${response.status})`);
  }
  return payload as T;
}

/** Full refund of a captured payment. Amounts are in paise. */
export async function refundPayment(
  paymentId: string,
  amount: number,
  reason: string
) {
  return razorpayRequest(`/payments/${paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify({
      amount,
      notes: { reason: reason.slice(0, 200) },
    }),
  });
}

/** Mark the server-side checkout intent so the browser and webhook paths do not disagree. */
export async function markCheckoutIntent(orderId: string, status: 'confirmed' | 'cancelled') {
  if (!orderId) return;
  const { error } = await admin
    .from('checkout_intents')
    .update({ status })
    .eq('order_id', orderId);
  if (error) console.error('checkout intent update failed', error.message);
}

export async function userFromRequest(req: Request) {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user ?? null;
}

export async function setting(key: string, fallback: string) {
  const { data } = await admin.from('settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? fallback;
}

/** Constant-time comparison of the Razorpay checkout signature. */
export async function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): Promise<boolean> {
  if (!orderId || !paymentId || !signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(razorpayKeySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${orderId}|${paymentId}`));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}
