import { corsHeaders, errorMessage, json } from '../_shared/cors.ts';
import { admin } from '../_shared/razorpay.ts';

/**
 * Rove notify dispatcher.
 *
 * Drains undelivered rows from notification_log and sends them through a
 * provider. Email uses the Resend HTTP API when RESEND_API_KEY is configured;
 * without a key the dispatcher returns 503 and leaves rows queued, so the
 * booking/payment flow never depends on a vendor being available.
 *
 * Invoked by the scheduler with the shared NOTIFY_SECRET header:
 *   curl -X POST -H "x-notify-secret: $NOTIFY_SECRET" \
 *     "$SUPABASE_URL/functions/v1/notify"     # process all pending
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM_EMAIL = Deno.env.get('ROVE_FROM_EMAIL') ?? 'Rove <onboarding@resend.dev>';
const NOTIFY_SECRET = Deno.env.get('NOTIFY_SECRET') ?? '';

function authorised(req: Request) {
  if (!NOTIFY_SECRET) return false;
  const supplied = req.headers.get('x-notify-secret') ?? '';
  if (supplied.length !== NOTIFY_SECRET.length) return false;
  let mismatch = 0;
  for (let index = 0; index < NOTIFY_SECRET.length; index += 1) {
    mismatch |= supplied.charCodeAt(index) ^ NOTIFY_SECRET.charCodeAt(index);
  }
  return mismatch === 0;
}

async function sendEmail({ to, subject, body }): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject,
      text: body,
      html: body
        .split('\n')
        .map((line) => `<p style="margin:0 0 0.6rem">${line.replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]))}</p>`)
        .join(''),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, error: `Resend ${response.status}: ${detail.slice(0, 300)}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!authorised(req)) return json({ error: 'Unauthorised notifier.' }, 401);
  if (!Deno.env.get('RESEND_API_KEY')) {
    return json({ error: 'Email provider is not configured; notifications remain queued.' }, 503);
  }

  try {
    const { data: pending, error: fetchError } = await admin
      .from('notification_log')
      .select('*')
      .in('status', ['queued', 'pending'])
      .limit(25)
      .order('created_at');

    if (fetchError) throw new Error(fetchError.message);

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of pending ?? []) {
      if (row.channel !== 'email' || !row.recipient) {
        await admin.from('notification_log').update({ status: 'skipped' }).eq('id', row.id);
        skipped += 1;
        continue;
      }
      // Respect the recipient's saved notification preferences. The kind is
      // mapped to a preference bucket and suppressed when they opted out —
      // the same mapping as the in-app gate in 202610270009.
      const { data: profile } = await admin
        .from('profiles')
        .select('notification_prefs')
        .ilike('email', row.recipient)
        .maybeSingle();
      const allowed = await admin.rpc('notification_kind_allowed', {
        p_kind: row.kind,
        p_prefs: profile?.notification_prefs ?? {},
      });
      if (allowed?.data === false) {
        await admin.from('notification_log').update({ status: 'skipped' }).eq('id', row.id);
        skipped += 1;
        continue;
      }
      const outcome = await sendEmail({ to: row.recipient, subject: row.subject, body: row.body });
      if (outcome.ok) {
        sent += 1;
        await admin.from('notification_log').update({ status: 'sent' }).eq('id', row.id);
      } else {
        failed += 1;
        await admin
          .from('notification_log')
          .update({ status: 'failed', meta: { ...(row.meta ?? {}), error: outcome.error } })
          .eq('id', row.id);
      }
    }

    return json({ ok: true, processed: (pending ?? []).length, sent, failed, skipped });
  } catch (error) {
    console.error('notify', error);
    return json({ error: errorMessage(error) }, 500);
  }
});