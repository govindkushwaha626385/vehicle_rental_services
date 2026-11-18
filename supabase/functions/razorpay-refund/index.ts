import { corsHeaders, errorMessage, json } from '../_shared/cors.ts';
import { admin, razorpayRequest, setting, userFromRequest } from '../_shared/razorpay.ts';

const IST_OFFSET = '+05:30';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Pick-up times are stored as local wall-clock times for Indian hubs. Parse
// them with an explicit offset so the cancellation window is correct on UTC
// servers regardless of where the Edge Function runs.
const pickupDate = (booking: { start_date: string; pickup_time: string }) =>
  new Date(`${booking.start_date}T${booking.pickup_time}:00${IST_OFFSET}`);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = body.bookingId ? String(body.bookingId) : null;
    const code = body.code ? String(body.code).trim().toUpperCase() : null;
    const email = body.email ? String(body.email).trim().toLowerCase() : null;
    const reason = String(body.reason ?? 'Customer cancellation').slice(0, 240);

    if (!bookingId && !code) return json({ error: 'Booking reference is required.' }, 400);

    let query = admin.from('bookings').select('*');
    query = bookingId ? query.eq('id', bookingId) : query.eq('code', code!);
    const { data: booking, error: fetchError } = await query.maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!booking) return json({ error: 'Booking not found.' }, 404);

    const user = await userFromRequest(req);
    let isStaff = false;
    if (user) {
      const { data: profile } = await admin
        .from('profiles')
        .select('role, status')
        .eq('id', user.id)
        .maybeSingle();
      isStaff = Boolean(profile && ['manager', 'admin'].includes(profile.role) && profile.status === 'active');
    }

    const isOwner = Boolean(user && booking.user_id === user.id);
    const guestEmail = String(booking.guest_email ?? '').toLowerCase();
    const isVerifiedGuest = !booking.user_id && Boolean(email) && email === guestEmail;

    if (!isStaff && !isOwner && !isVerifiedGuest) {
      return json({
        error: booking.user_id
          ? 'This booking can only be cancelled from the account that made it.'
          : 'You are not allowed to cancel this booking.',
      }, 403);
    }

    if (booking.status === 'cancelled' && !isStaff) {
      return json({ error: 'This booking is already cancelled.' }, 409);
    }
    if (!isStaff && !['pending', 'confirmed'].includes(booking.status)) {
      return json({ error: 'This rental can no longer be cancelled online. Contact support.' }, 409);
    }
    if (!isStaff && pickupDate(booking) <= new Date()) {
      return json({ error: 'This rental has already started. Contact support for help.' }, 409);
    }

    const paid = Number(booking.amount_paid) || 0;

    // A downward reprice (shortened dates) leaves the customer with a credit.
    // Refund exactly that difference without touching the booking status.
    if (body.creditOnly) {
      if (!isStaff) return json({ error: 'Only staff can refund a booking credit.' }, 403);
      if (!['pending', 'confirmed', 'active'].includes(booking.status)) {
        return json({ error: 'This booking is closed.' }, 409);
      }
      const total = Number(booking.total) || 0;
      const credit = Math.max(0, paid - total);
      if (credit <= 0) return json({ error: 'This booking has no customer credit to refund.' }, 409);

      const { data: captured } = await admin
        .from('payments')
        .select('*')
        .eq('booking_id', booking.id)
        .in('kind', ['payment', 'deposit', 'balance'])
        .eq('status', 'succeeded')
        .order('created_at', { ascending: false });

      const capturedPayment = captured?.[0];
      if (!capturedPayment?.reference) {
        return json({ error: 'We could not locate the captured payment. Please refund it from the Razorpay dashboard.' }, 409);
      }
      // Razorpay can only refund up to the captured amount. Split payments are
      // rare here; refuse rather than issuing a partial, misleading refund.
      if (credit > Number(capturedPayment.amount)) {
        return json({ error: 'The credit is larger than the latest payment. Refund it from the Razorpay dashboard.' }, 409);
      }

      const refund = await razorpayRequest<{ id: string; amount: number }>(
        `/payments/${capturedPayment.reference}/refund`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: Math.round(credit * 100),
            notes: { booking: booking.code, reason, staff: 'true' },
          }),
        }
      );

      await admin.from('payments').insert({
        booking_id: booking.id,
        kind: 'refund',
        amount: credit,
        currency: 'INR',
        status: 'refunded',
        brand: capturedPayment.brand ?? 'Razorpay',
        last4: capturedPayment.last4 ?? '',
        reference: refund.id,
        order_id: booking.razorpay_order_id,
      });

      await admin
        .from('bookings')
        .update({
          amount_paid: total,
          payment_status: total > 0 ? 'paid' : 'unpaid',
        })
        .eq('id', booking.id);

      return json({ ok: true, refundAmount: credit });
    }

    const policy = await Promise.all([
      setting('cancellation_window_hours', '48'),
      setting('cancellation_refund_percent', '50'),
    ]);
    const windowValue = Number(policy[0]);
    const percentValue = Number(policy[1]);
    const windowHours = clamp(Number.isFinite(windowValue) ? Math.round(windowValue) : 48, 0, 720);
    const refundPercent = clamp(Number.isFinite(percentValue) ? Math.round(percentValue) : 50, 0, 100);

    let refundAmount = 0;
    if (paid > 0) {
      if (isStaff) {
        refundAmount = paid;
      } else {
        const total = Math.max(0, Number(booking.total) || 0);
        // Overpayment after a reprice is a customer credit. Return it in full;
        // apply the cancellation policy only to the trip's own value.
        const credit = Math.max(0, paid - total);
        const refundableBase = Math.min(paid, total);
        const hoursUntil = (pickupDate(booking).getTime() - Date.now()) / 3600000;
        refundAmount = hoursUntil >= windowHours
          ? paid
          : Math.round(credit + refundableBase * (refundPercent / 100));
      }
    }

    const { data: captured } = await admin
      .from('payments')
      .select('*')
      .eq('booking_id', booking.id)
      .in('kind', ['payment', 'deposit', 'balance'])
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(1);

    let refundReference: string | null = null;
    const capturedPayment = captured?.[0];

    if (refundAmount > 0 && !capturedPayment?.reference) {
      return json({ error: 'We could not locate the captured payment. Please contact support.' }, 409);
    }
    // Razorpay refunds are issued against one payment. A split payment
    // (deposit + balance) can leave the refund larger than the latest capture;
    // refuse with a clear message instead of a raw gateway error.
    if (refundAmount > 0 && capturedPayment?.reference && refundAmount > Number(capturedPayment.amount)) {
      return json({ error: 'The refund is larger than the latest captured payment. Please refund it from the Razorpay dashboard.' }, 409);
    }

    if (refundAmount > 0 && capturedPayment?.reference) {
      const refund = await razorpayRequest<{ id: string; amount: number }>(
        `/payments/${capturedPayment.reference}/refund`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: Math.round(refundAmount * 100),
            notes: { booking: booking.code, reason, staff: String(isStaff) },
          }),
        }
      );
      refundReference = refund.id;
    }

    if (refundAmount > 0) {
      await admin.from('payments').insert({
        booking_id: booking.id,
        kind: 'refund',
        amount: refundAmount,
        currency: 'INR',
        status: 'refunded',
        brand: capturedPayment?.brand ?? 'Razorpay',
        last4: capturedPayment?.last4 ?? '',
        reference: refundReference,
        order_id: booking.razorpay_order_id,
      });

      if (capturedPayment?.reference && refundAmount >= paid) {
        await admin
          .from('payments')
          .update({ status: 'refunded' })
          .eq('booking_id', booking.id)
          .in('kind', ['payment', 'deposit'])
          .eq('status', 'succeeded');
      }
    }

    const remaining = Math.max(0, paid - refundAmount);
    // Only call it a refund when money actually moved back. A non-refundable
    // cancellation keeps its paid status, and an unpaid booking stays unpaid.
    const paidStatus = ['paid', 'deposit_paid', 'partially_refunded', 'refunded'].includes(String(booking.payment_status))
      ? String(booking.payment_status)
      : 'paid';
    const paymentStatus = refundAmount <= 0
      ? (paid > 0 ? paidStatus : 'unpaid')
      : remaining === 0 ? 'refunded' : 'partially_refunded';

    await admin
      .from('bookings')
      .update({
        status: 'cancelled',
        amount_paid: remaining,
        payment_status: paymentStatus,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
        cancelled_by: isStaff ? 'staff' : 'customer',
      })
      .eq('id', booking.id);

    // Transactional email + desk event, both best-effort after the booking is
    // settled. Emails stay queued until the notify dispatcher sends them.
    let recipient = String(booking.guest_email || '').trim();
    if (!recipient && booking.user_id) {
      const { data: ownerRow } = await admin.from('profiles').select('email').eq('id', booking.user_id).maybeSingle();
      recipient = ownerRow?.email ?? '';
    }
    if (recipient) {
      await admin.from('notification_log').insert({
        kind: 'booking_cancelled',
        channel: 'email',
        recipient,
        subject: `Your Rove booking ${booking.code} was cancelled`,
        body: refundAmount > 0
          ? `A refund of ₹${refundAmount.toLocaleString('en-IN')} is being returned to the original payment method.`
          : 'No refund is due under the cancellation policy.',
        meta: { code: booking.code, refundAmount },
      });
    }
    await admin.from('notifications').insert({
      audience: 'staff',
      kind: 'booking_cancelled',
      title: `Booking ${booking.code} cancelled`,
      body: `${isStaff ? 'Cancelled by Rove' : 'Cancelled by customer'}${refundAmount > 0 ? ` · ₹${refundAmount} refunded` : ''}`,
      booking_code: booking.code,
      link: '/admin/bookings',
    });

    return json({
      ok: true,
      code: booking.code,
      refundAmount,
      paymentStatus,
      message: refundAmount > 0
        ? `Booking cancelled. ₹${refundAmount.toLocaleString('en-IN')} will be refunded to the original payment method.`
        : paid > 0
          ? 'Booking cancelled. No refund is due under the cancellation policy.'
          : 'Booking cancelled. No payment was captured.',
    });
  } catch (error) {
    console.error('razorpay-refund', error);
    return json({ error: errorMessage(error) }, 400);
  }
});
