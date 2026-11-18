import { corsHeaders, errorMessage, json } from '../_shared/cors.ts';
import {
  admin,
  markCheckoutIntent,
  razorpayRequest,
  setting,
  userFromRequest,
  verifyRazorpaySignature,
} from '../_shared/razorpay.ts';
import { quoteDraft, sanitizeDraft, validateDraft } from '../_shared/booking.ts';
import { kmTermsLine, lateTermsLine, renderEmail } from '../_shared/email.ts';

type Payment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  method?: string;
  card?: { network?: string; last4?: string };
};

async function safeRefund(paymentId: string, amount: number, reason: string, orderId: string) {
  try {
    await razorpayRequest(`/payments/${paymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ amount, notes: { reason } }),
    });
    await markCheckoutIntent(orderId, 'cancelled');
  } catch (error) {
    console.error('Automatic refund failed', error);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let paymentId = '';
  let capturedPayment: Payment | null = null;
  let confirmedBookingId: string | null = null;
  try {
    const body = await req.json();
    let draft = sanitizeDraft(body.draft ?? body);
    const orderId = String(body.razorpay_order_id ?? body.orderId ?? '');
    paymentId = String(body.razorpay_payment_id ?? body.paymentId ?? '');
    const signature = String(body.razorpay_signature ?? body.signature ?? '');

    const valid = await verifyRazorpaySignature(orderId, paymentId, signature);
    if (!valid) return json({ error: 'Payment signature verification failed.' }, 400);
    const user = await userFromRequest(req);

    // A refund from the webhook path (or an earlier failed confirmation) marks
    // the intent cancelled. Never create a booking for a refunded payment.
    const { data: checkoutIntent } = await admin
      .from('checkout_intents')
      .select('status, draft')
      .eq('order_id', orderId)
      .maybeSingle();
    if (checkoutIntent?.status === 'cancelled') {
      return json({ error: 'This checkout was cancelled and refunded.' }, 409);
    }
    // The order was created from the server-side intent. Prefer that draft over
    // browser input so a customer cannot swap dates, vehicle or driver details
    // between paying and confirming.
    if (checkoutIntent?.draft) draft = sanitizeDraft(checkoutIntent.draft);

    // Idempotent: this payment may already have produced a booking.
    const { data: existing } = await admin
      .from('payments')
      .select('booking_id, bookings(code)')
      .eq('reference', paymentId)
      .maybeSingle();
    if (existing) {
      return json({ code: (existing as any).bookings?.code, alreadyProcessed: true });
    }

    const { data: existingOrderBooking } = await admin
      .from('bookings')
      .select('code')
      .eq('razorpay_order_id', orderId)
      .maybeSingle();
    if (existingOrderBooking) {
      return json({ code: existingOrderBooking.code, alreadyProcessed: true });
    }

    const invalid = await validateDraft(draft);
    if (invalid) return json({ error: invalid }, 400);

    let payment = await razorpayRequest<Payment>(`/payments/${paymentId}`);
    if (payment.order_id !== orderId) {
      return json({ error: 'Payment does not belong to this order.' }, 400);
    }
    // Orders are created with automatic capture, but capture explicitly if the
    // account or payment method left it authorised. Never confirm a rental
    // against money that has not actually been captured.
    if (payment.status === 'authorized') {
      payment = await razorpayRequest<Payment>(`/payments/${paymentId}/capture`, {
        method: 'POST',
        body: JSON.stringify({ amount: payment.amount, currency: payment.currency || 'INR' }),
      });
    }
    if (payment.status !== 'captured') {
      return json({ error: `Payment is ${payment.status}. Please try again.` }, 402);
    }
    capturedPayment = payment;

    const quote = await quoteDraft(draft);
    if (!quote.available) {
      await safeRefund(paymentId, payment.amount, 'Dates no longer available', orderId);
      return json({ error: quote.unavailableReason || 'Those dates are no longer available.' }, 409);
    }
    if (payment.amount !== Math.round(quote.amountDue * 100)) {
      await safeRefund(paymentId, payment.amount, 'Price mismatch', orderId);
      return json({ error: 'The price changed before payment. You have been refunded.' }, 409);
    }

    const holdAmount = Number(await setting('hold_amount', '5000'));
    const installments = draft.paymentPlan === 'deposit' ? 'deposit_paid' : 'paid';
    const autoConfirm = (await setting('booking_auto_confirm', 'true')) !== 'false';
    const bookingStatus = autoConfirm ? 'confirmed' : 'pending';

    const { data: booking, error: bookingError } = await admin
      .from('bookings')
      .insert({
        user_id: user?.id ?? null,
        guest_name: user ? '' : draft.driver.name,
        guest_email: user ? '' : draft.driver.email,
        guest_phone: user ? '' : draft.driver.phone,
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
        amount_paid: quote.amountDue,
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
      console.error('booking insert failed', bookingError);

      // A concurrent retry for the same Razorpay order may have won the race.
      // The unique order index turns that into a duplicate-key error; return the
      // booking that already exists instead of refunding a successful payment.
      if (bookingError.code === '23505') {
        const { data: existingBooking } = await admin
          .from('bookings')
          .select('code')
          .eq('razorpay_order_id', orderId)
          .maybeSingle();
        if (existingBooking?.code) {
          return json({ code: existingBooking.code, alreadyProcessed: true });
        }
      }

      await safeRefund(paymentId, payment.amount, 'Could not confirm booking', orderId);
      if (bookingError.code === '23P01') {
        return json({ error: 'Those dates were just booked. You have been refunded.' }, 409);
      }
      return json({ error: 'We could not confirm the booking. You have been refunded.' }, 500);
    }

    await markCheckoutIntent(orderId, 'confirmed');
    confirmedBookingId = booking.id;

    // In-app notifications: the customer sees their voucher in /account, and
    // staff get a desk event. Email is handled via notification_log + notify.
    if (user?.id) {
      await admin.from('notifications').insert({
        audience: 'user',
        user_id: user.id,
        kind: autoConfirm ? 'booking_confirmed' : 'booking_pending',
        title: autoConfirm ? 'Booking confirmed' : 'Booking received',
        body: autoConfirm
          ? `Your ${booking.code} voucher is ready.`
          : `Payment received. We will confirm ${booking.code} shortly.`,
        booking_code: booking.code,
        link: `/confirmation/${booking.code}`,
      });
    }
    await admin.from('notifications').insert({
      audience: 'staff',
      kind: 'booking_new',
      title: `New booking ${booking.code}`,
      body: `${quote.days} day${quote.days === 1 ? '' : 's'} · ₹${quote.total} ${autoConfirm ? 'confirmed' : 'awaiting approval'}`,
      booking_code: booking.code,
      link: '/admin/bookings',
    });
    const confirmEmail = user?.email ?? String(draft.driver.email ?? '').trim();
    if (confirmEmail) {
      const emailKind = autoConfirm ? 'booking_confirmed' : 'booking_pending';
      // Terms shown at checkout must survive into the confirmation. The booking
      // row already carries the km snapshot written by the DB trigger, so a
      // later vehicle reprice cannot change what this customer was told.
      const [bookedTerms, tplSubject, tplBody, lateHourly, lateGrace, lateTemplate] = await Promise.all([
        admin.from('bookings').select('km_cap, km_extra_rate').eq('id', booking.id).maybeSingle(),
        setting(`email_subject_${emailKind}`, ''),
        setting(`email_body_${emailKind}`, ''),
        setting('late_fee_per_hour', '500'),
        setting('late_grace_minutes', '60'),
        setting('late_fee_terms', 'Late returns are billed at {hourly}/hour, {grace}, capped at {daily}/day.'),
      ]);
      const kmText = kmTermsLine(bookedTerms.data?.km_cap, bookedTerms.data?.km_extra_rate);
      const lateText = lateTermsLine(lateHourly, lateGrace, lateTemplate);
      const meta = {
        code: booking.code,
        name: draft.driver.name || user?.user_metadata?.full_name || 'there',
        dates: `${draft.startDate} – ${draft.endDate}`,
        // `{amount}` in the confirmation template is the deposit taken at pick-up.
        amount: `₹${Number(quote.depositDue ?? 0).toLocaleString('en-IN')}`,
        hub: draft.pickupLocation,
        time: draft.pickupTime || '10:00',
        status: bookingStatus,
        // Available to admin-edited templates as {km} / {late}.
        km: kmText,
        late: lateText,
      };
      const fallbackBody = [
        autoConfirm
          ? `Hi, your ${quote.days}-day rental is confirmed.`
          : `Hi, we have received your ${quote.days}-day rental payment. Our team will confirm it shortly.`,
        `Booking ${booking.code} · ${quote.days} days · ₹${Number(quote.total).toLocaleString('en-IN')} (${draft.paymentPlan === 'deposit' ? 'deposit' : 'full'} payment, tax included).`,
        `Pick-up: ${draft.pickupLocation} on ${draft.startDate}. For any changes, sign in at the Rove site.`,
        kmText,
        lateText,
      ].join('\n');
      const rendered = renderEmail(
        { subject: tplSubject, body: tplBody },
        {
          subject: autoConfirm
            ? `Your Rove booking ${booking.code} is confirmed`
            : `We have received your Rove booking ${booking.code}`,
          body: fallbackBody,
        },
        meta
      );
      await admin.from('notification_log').insert({
        kind: emailKind,
        channel: 'email',
        recipient: confirmEmail,
        subject: rendered.subject,
        body: rendered.body,
        meta: { code: booking.code, startDate: draft.startDate, endDate: draft.endDate, total: quote.total },
      });
    }

    const { error: paymentError } = await admin.from('payments').insert({
      booking_id: booking.id,
      kind: draft.paymentPlan === 'deposit' ? 'deposit' : 'payment',
      amount: quote.amountDue,
      currency: 'INR',
      status: 'succeeded',
      brand: payment.card?.network ?? payment.method ?? 'Razorpay',
      last4: payment.card?.last4 ?? '',
      reference: payment.id,
      order_id: orderId,
    });

    if (paymentError) {
      console.error('payment record insert failed', paymentError);
    }

    if (quote.promoApplied?.code) {
      await admin.rpc('increment_promo_usage', { p_code: quote.promoApplied.code });
    }

    if (user) {
      await admin
        .from('profiles')
        .update({
          card_brand: payment.card?.network ?? payment.method ?? 'Razorpay',
          card_last4: payment.card?.last4 ?? '',
        })
        .eq('id', user.id);
    }

    const { data: fullBooking } = await admin.rpc('get_booking', {
      p_code: booking.code,
      p_email: draft.driver.email,
    });

    return json({ code: booking.code, booking: fullBooking });
  } catch (error) {
    console.error('razorpay-verify', error);
    // Money was captured but an unexpected error prevented a confirmed booking.
    // Refund rather than leaving the customer paid without a rental.
    if (capturedPayment && !confirmedBookingId) {
      await safeRefund(capturedPayment.id, capturedPayment.amount, 'Could not confirm booking', orderId);
    }
    return json({ error: errorMessage(error) }, 400);
  }
});
