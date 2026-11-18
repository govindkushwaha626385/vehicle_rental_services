import { corsHeaders, errorMessage, json } from '../_shared/cors.ts';
import { razorpayKeyId, admin, razorpayRequest, setting, userFromRequest } from '../_shared/razorpay.ts';
import { quoteDraft, sanitizeDraft, validateDraft } from '../_shared/booking.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const body = await req.json();
    const draft = sanitizeDraft(body);

    const [user, guestCheckout, bikesEnabled] = await Promise.all([
      userFromRequest(req),
      setting('guest_checkout_enabled', 'true'),
      setting('bikes_enabled', 'true'),
    ]);

    if (!user && guestCheckout === 'false') {
      return json({ error: 'Please sign in to continue — guest checkout is currently unavailable.' }, 401);
    }

    if (user) {
      const { data: profile } = await admin
        .from('profiles')
        .select('status')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.status === 'suspended') {
        return json({ error: 'This account is suspended. Contact support to continue.' }, 403);
      }
    }

    const invalid = await validateDraft(draft);
    if (invalid) return json({ error: invalid }, 400);

    const { data: vehicle, error: vehicleError } = await admin
      .from('vehicles')
      .select('kind, status')
      .eq('id', draft.vehicleId)
      .maybeSingle();
    if (vehicleError) throw new Error(vehicleError.message);
    if (!vehicle) return json({ error: 'Vehicle not found.' }, 404);
    if (vehicle.status === 'maintenance') {
      return json({ error: 'This vehicle is currently in service.' }, 409);
    }
    if (vehicle.kind === 'bike' && bikesEnabled === 'false') {
      return json({ error: 'Two-wheelers are temporarily unavailable.' }, 409);
    }

    const quote = await quoteDraft(draft);

    if (!quote.available) {
      return json({ error: quote.unavailableReason || 'Those dates are not available.' }, 409);
    }
    if (!quote.amountDue || quote.amountDue < 1) {
      return json({ error: 'Unable to calculate a payable amount.' }, 400);
    }

    const receipt = `rove_${Date.now()}`.slice(0, 40);
    const order = await razorpayRequest<{ id: string; amount: number; currency: string }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: Math.round(quote.amountDue * 100),
        currency: 'INR',
        receipt,
        payment_capture: 1,
        notes: {
          vehicle_id: draft.vehicleId,
          user_id: user?.id ?? '',
          payment_plan: draft.paymentPlan,
        },
      }),
    });

    // Persist the server-side intent so the payment.captured webhook can
    // complete this booking without the browser when the customer closes the
    // tab mid-payment (razorpay-webhook recovery path).
    const { data: intent, error: intentError } = await admin
      .from('checkout_intents')
      .insert({
        order_id: order.id,
        draft: draft,
        quote: quote,
        status: 'pending',
      })
      .select('id')
      .maybeSingle();
    if (intentError) {
      console.error('checkout_intents write failed', intentError.message);
      return json({ error: 'Checkout could not be prepared. Please try again.' }, 503);
    }

    return json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId,
      paymentPlan: draft.paymentPlan,
      quote,
    });
  } catch (error) {
    console.error('razorpay-order', error);
    return json({ error: errorMessage(error) }, 400);
  }
});
