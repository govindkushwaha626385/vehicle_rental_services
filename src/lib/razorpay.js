export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error('Razorpay checkout took too long to load. Check your connection and try again.'));
    }, 12000);
    const ok = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const existing = document.querySelector('script[data-razorpay]');
    if (existing) {
      // A previous load failed after the script element was inserted. Reloading
      // the page is the reliable fix; reject instead of waiting forever.
      if (existing.dataset.loaded === 'true') {
        fail(new Error('Could not load Razorpay checkout. Please refresh and try again.'));
        return;
      }
      existing.addEventListener('load', ok, { once: true });
      existing.addEventListener('error', () => fail(new Error('Could not load Razorpay checkout.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpay = 'true';
    script.onload = () => {
      script.dataset.loaded = 'true';
      ok();
    };
    script.onerror = () => fail(new Error('Could not load Razorpay checkout. Check your connection.'));
    document.body.appendChild(script);
  });
}

export function openRazorpay({
  keyId,
  orderId,
  amount,
  currency = 'INR',
  name,
  email,
  phone,
  description,
  onSuccess,
  onDismiss,
}) {
  if (!window.Razorpay) throw new Error('Razorpay checkout is not available.');
  const checkout = new window.Razorpay({
    key: keyId,
    order_id: orderId,
    amount,
    currency,
    name: 'Rove Rentals',
    description,
    image: `${window.location.origin}/favicon.svg`,
    prefill: {
      name: name || '',
      email: email || '',
      contact: phone || '',
    },
    notes: { product: 'Rove self-drive rental' },
    theme: { color: '#0B0F0C', backdrop_color: 'rgba(11,15,12,0.55)' },
    handler: (response) => onSuccess(response),
    modal: {
      ondismiss: () => onDismiss?.(),
      escape: true,
      confirm_close: true,
    },
  });
  checkout.on('payment.failed', (response) => {
    onDismiss?.(response?.error?.description || 'Payment failed. Please try again.');
  });
  checkout.open();
  return checkout;
}
