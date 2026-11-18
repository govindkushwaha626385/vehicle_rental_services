import { corsHeaders, errorMessage, json } from '../_shared/cors.ts';
import {
  admin,
  markCheckoutIntent,
  refundPayment,
  setting,
} from '../_shared/razorpay.ts';
import { quoteDraft, sanitizeDraft } from '../_shared/booking.ts';
import {
  bodyEventId,
  claimEvent,
  completeEvent,
  failEvent,
  logNotification,
  verifyWebhookSignature,
} from '../_shared/webhook.ts';

type PaymentEntity = {
  id: string;
  order_id: string;
  amount: number;
  currency?: string;
  status: string;
  method?: string;
  card?: { network?: string; last4?: string };
  email?: string;
  contact?: string;
};

/** Refund a captured payment and make sure the browser path cannot confirm it. */
async function refundAndCancelIntent(
  orderId: string,
  paymentId: string,
  amount: number,
  reason: string,
) {
  await refundPayment(paymentId, amount, reason);
  await markCheckoutIntent(orderId, 'cancelled');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const rawBody = await req.text();
  const signature = req.headers.get('X-Razorpay-Signature') ?? '';
  const eventId = req.headers.get('X-Razorpay-Event-Id') || await bodyEventId(rawBody);

  if (!(await verifyWebhookSignature(rawBody, signature))) {
    return json({ error: 'Invalid webhook signature.' }, 400);
  }

  let event: {
    event?: string;
    payload?: { payment?: { entity?: PaymentEntity }; order?: { entity?: Record<string, any> } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid payload.' }, 400);
  }

  const eventType = event.event ?? '';
  const payment = event.payload?.payment?.entity;
  const order = event.payload?.order?.entity;
  const orderId = payment?.order_id || order?.id || '';
  const paymentId = payment?.id ?? '';

  // At-least-once delivery: claim the event id; replays become no-ops.
  if (!(await claimEvent(eventId, eventType, { paymentId, orderId }))) {
    return json({ ok: true, duplicate: true });
  }

  try {
    if (eventType === 'payment.captured' || (eventType === 'order.paid' && payment?.id)) {
      if (!paymentId || !orderId) {
        await logNotification('webhook_incomplete', payment?.email ?? '',
          'Captured payment event without identifiers',
          `Razorpay sent ${eventType} without a payment/order id. Manual review required.`, { eventId });
        await completeEvent(eventId);
        return json({ ok: true, warning: 'Missing payment identifiers.' });
      }
      await reconcileCapturedPayment({ eventId, paymentId, orderId, payment: payment ?? {}, order });
    } else if (eventType === 'payment.failed') {
      await logNotification('payment_failed', payment?.email ?? '', 'Payment failed',
        `Payment ${paymentId} for order ${orderId} failed on the gateway.`, { paymentId, orderId });
      await completeEvent(eventId);
    } else if (eventType === 'refund.failed') {
      await logNotification('refund_failed', '', 'Automatic refund failed',
        `Razorpay reported a failed refund for order ${orderId}. Review manually.`, { paymentId, orderId });
      await completeEvent(eventId);
    } else {
      // payment.authorized, dispute events, etc. — acknowledged, not fatal.
      await completeEvent(eventId);
    }

    return json({ ok: true });
  } catch (error) {
    const message = errorMessage(error);
    await failEvent(eventId, message);
    // Return 200 anyway: a permanent failure should not make Razorpay retry
    // for 24h — the event stays in the ledger with last_error for staff review.
    return json({ ok: true, warning: message });
  }
});

/**
 * A payment was captured but the browser may have closed before
 * `razorpay-verify` ran. Recover the booking from the server-side checkout
 * intent, or confirm one already exists. Every path is idempotent:
 * `payments.reference` and `bookings.razorpay_order_id` are both unique.
 */
async function reconcileCapturedPayment({
  eventId,
  paymentId,
  orderId,
  payment,
  order,
}: {
  eventId: string;
  paymentId: string;
  orderId: string;
  payment: PaymentEntity;
  order?: Record<string, any>;
}) {
  // 1. Payment row already recorded → the booking exists; nothing to do.
  const { data: existingPayment } = await admin
    .from('payments')
    .select('booking_id, bookings(code)')
    .eq('reference', paymentId)
    .maybeSingle();
  if (existingPayment) {
    await completeEvent(eventId);
    return { recovered: false, code: (existingPayment as any).bookings?.code };
  }

  // 2. Booking exists (verify raced ahead, payment row missing) → record payment.
  const { data: existingBooking } = await admin
    .from('bookings')
    .select('id, code')
    .eq('razorpay_order_id', orderId)
    .maybeSingle();
  if (existingBooking) {
    await recordPayment(existingBooking.id, paymentId, orderId, payment, order);
    await completeEvent(eventId);
    return { recovered: true, code: existingBooking.code };
  }

  // 3. Neither exists → replay from the stored checkout intent, exactly like
  //    razorpay-verify would have. No intent → we cannot safely create a
  //    booking; alert staff instead.
  const { data: intent } = await admin
    .from('checkout_intents')
    .select('draft, status')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!intent) {
    await logNotification('payment_unrecoverable', payment.email ?? '',
      'Captured payment without intent',
      `Payment ${paymentId} (₹${(payment.amount ?? 0) / 100}) captured for order ${orderId} but no intent or booking exists. Reconcile manually.`,
      { paymentId, orderId });
    await completeEvent(eventId);
    return { recovered: false, code: null };
  }
  if ((intent as any).status === 'cancelled') {
    await completeEvent(eventId);
    return { recovered: false, refunded: true, reason: 'intent_already_cancelled' };
  }

  const draft = sanitizeDraft((intent as any).draft ?? {});
  if (!Number(payment.amount)) {
    throw new Error('Captured payment has no amount; manual review required.');
  }

  // Fresh server-authoritative quote: the browser total is never trusted here.
  let quote: Record<string, any>;
  try {
    quote = await quoteDraft(draft);
  } catch (error) {
    const reason = errorMessage(error);
    await refundAndCancelIntent(orderId, paymentId, payment.amount, 'Booking rules changed before confirmation');
    await logNotification('payment_refunded', draft.driver.email,
      'Booking could not be confirmed — refund issued',
      `Payment ${paymentId} was refunded because the booking could no longer be quoted: ${reason}.`,
      { paymentId, orderId, reason });
    await completeEvent(eventId);
    return { recovered: false, refunded: true, reason };
  }
  if (!quote.available) {
    await refundAndCancelIntent(orderId, paymentId, payment.amount, 'Vehicle unavailable at confirmation');
    await logNotification('payment_refunded', draft.driver.email,
      'Booking could not be confirmed — refund issued',
      `Payment ${paymentId} was refunded because ${quote.unavailableReason || 'the selected dates became unavailable'}.`,
      { paymentId, orderId, reason: quote.unavailableReason ?? 'unavailable' });
    await completeEvent(eventId);
    return { recovered: false, refunded: true, reason: quote.unavailableReason };
  }
  if (payment.amount !== Math.round(Number(quote.amountDue) * 100)) {
    await refundAndCancelIntent(orderId, paymentId, payment.amount, 'Quoted price changed before confirmation');
    await logNotification('payment_refunded', draft.driver.email,
      'Booking could not be confirmed — refund issued',
      `Payment ${paymentId} was refunded because the captured amount did not match the current quote.`,
      { paymentId, orderId, captured: payment.amount, quoted: Math.round(Number(quote.amountDue) * 100) });
    await completeEvent(eventId);
    return { recovered: false, refunded: true, reason: 'price_mismatch' };
  }

  const holdAmount = Number(await setting('hold_amount', '5000'));
  const installments = draft.paymentPlan === 'deposit' ? 'deposit_paid' : 'paid';
  const autoConfirm = (await setting('booking_auto_confirm', 'true')) !== 'false';
  const bookingStatus = autoConfirm ? 'confirmed' : 'pending';
  const brand = payment.card?.network ?? payment.method ?? 'Razorpay';
  const last4 = payment.card?.last4 ?? '';
  const orderUserId = String(order?.notes?.user_id ?? '');
  const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderUserId)
    ? orderUserId
    : null;

  const { data: booking, error: bookingError } = await admin
    .from('bookings')
    .insert({
      user_id: userId,
      guest_name: draft.driver.name,
      guest_email: draft.driver.email,
      guest_phone: draft.driver.phone,
      vehicle_id: draft.vehicleId,
      pickup_location: draft.pickupLocation,
      dropoff_location: draft.dropoffLocation,
      start_date: draft.startDate,
      end_date: draft.endDate,
      pickup_time: draft.pickupTime,
      dropoff_time: draft.dropoffTime,
      days: quote.days,
      extras: (quote.extras ?? []).map((extra: { key: string }) => extra.key),
      insurance: quote.insurance?.key ?? 'basic',
      base_total: quote.baseTotal,
      extras_total: quote.extrasTotal,
      insurance_total: quote.insuranceTotal,
      one_way_fee: quote.oneWayFee,
      fees: quote.fees,
      tax_rate: quote.taxRate,
      tax_inclusive: Boolean(quote.taxInclusive),
      taxable_amount: quote.taxable,
      untaxed_total: quote.untaxedTotal ?? 0,
      discount: quote.discount,
      total: quote.total,
      deposit_due: quote.depositDue,
      hold_amount: holdAmount,
      amount_paid: Math.round(Number(payment.amount) / 100),
      promo_code: quote.promoApplied?.code ?? '',
      payment_plan: draft.paymentPlan,
      payment_status: installments,
      status: bookingStatus,
      driver_name: draft.driver.name,
      driver_email: draft.driver.email,
      driver_phone: draft.driver.phone,
      driver_license: draft.driver.license,
      driver_dob: draft.driver.dob,
      notes: draft.notes,
      razorpay_order_id: orderId,
    })
    .select('id, code')
    .single();

  if (bookingError) {
    // 23505 = unique (razorpay_order_id) raced with verify — re-fetch and record.
    if (bookingError.code === '23505') {
      const { data: raced } = await admin
        .from('bookings')
        .select('id, code')
        .eq('razorpay_order_id', orderId)
        .maybeSingle();
      if (raced) {
        await recordPayment(raced.id, paymentId, orderId, payment, order);
        await completeEvent(eventId);
        return { recovered: true, code: raced.code };
      }
    }

    // 23P01 = the GiST exclusion constraint: another booking won the dates
    // while this payment was in flight. Refund instead of keeping the money.
    if (bookingError.code === '23P01') {
      await refundAndCancelIntent(orderId, paymentId, payment.amount, 'Dates taken at confirmation');
      await logNotification('payment_refunded', draft.driver.email,
        'Booking could not be confirmed — refund issued',
        `Payment ${paymentId} was refunded because the selected dates were taken before confirmation.`,
        { paymentId, orderId, reason: 'double_booking' });
      await completeEvent(eventId);
      return { recovered: false, refunded: true, reason: 'double_booking' };
    }

    // Any other insert failure must not leave captured money unaccounted for.
    await refundAndCancelIntent(orderId, paymentId, payment.amount, 'Could not create booking');
    await logNotification('payment_refunded', draft.driver.email,
      'Booking could not be confirmed — refund issued',
      `Payment ${paymentId} was refunded because the booking could not be created (${bookingError.message}).`,
      { paymentId, orderId, reason: 'booking_insert_failed' });
    await completeEvent(eventId);
    return { recovered: false, refunded: true, reason: 'booking_insert_failed' };
  }

  await recordPayment(booking.id, paymentId, orderId, payment, order);

  // Mirror the verify path: customer inbox row (when the user is known) and a
  // staff desk event. Best-effort — the booking is already committed.
  await admin.from('notifications').insert({
    audience: 'staff',
    kind: 'booking_new',
    title: `New booking ${booking.code}`,
    body: `${quote.days} day${quote.days === 1 ? '' : 's'} · ₹${quote.total} recovered by webhook${autoConfirm ? '' : ' · awaiting approval'}`,
    booking_code: booking.code,
    link: '/admin/bookings',
  });

  if (quote.promoApplied?.code) {
    await admin.rpc('increment_promo_usage', { p_code: quote.promoApplied.code });
  }
  await admin.from('checkout_intents').update({ status: 'confirmed' }).eq('order_id', orderId);

  if (userId) {
    await admin
      .from('profiles')
      .update({ card_brand: brand, card_last4: last4 })
      .eq('id', userId);
  }

  await completeEvent(eventId);
  await logNotification('payment_recovered', draft.driver.email,
    autoConfirm ? 'Booking confirmed' : 'Booking received',
    autoConfirm
      ? `Booking ${booking.code} was confirmed by webhook after session recovery.`
      : `Booking ${booking.code} was received and is awaiting staff confirmation.`,
    { bookingId: booking.id, paymentId });

  return { recovered: true, code: booking.code };
}

async function recordPayment(
  bookingId: string,
  paymentId: string,
  orderId: string,
  payment: PaymentEntity,
  order?: Record<string, any>
) {
  const isDeposit = String(order?.notes?.payment_plan ?? 'full') === 'deposit';
  const amount = Math.round(Number(payment.amount ?? 0) / 100);
  const brand = payment.card?.network ?? payment.method ?? 'Razorpay';
  const last4 = payment.card?.last4 ?? '';

  const { error } = await admin.from('payments').insert({
    booking_id: bookingId,
    kind: isDeposit ? 'deposit' : 'payment',
    amount,
    currency: payment.currency ?? 'INR',
    status: 'succeeded',
    brand,
    last4,
    reference: paymentId,
    order_id: orderId,
  });

  // A concurrent verify may have written the same rows first. The unique
  // reference makes that a no-op; any other failure must surface so Razorpay
  // retries the webhook instead of leaving a confirmed booking unaccounted for.
  if (error && error.code !== '23505') {
    throw new Error(`Payment record insert failed: ${error.message}`);
  }
}