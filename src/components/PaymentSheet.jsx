import { useEffect, useMemo, useState } from 'react';
import { CreditCard, LockKeyhole, ShieldCheck, Zap } from 'lucide-react';
import { Modal, Spinner } from './ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { getSiteContent } from '../lib/site.js';
import { cn, inr, sleep } from '../lib/format.js';

const emptyForm = { number: '', name: '', expiry: '', cvc: '' };

function luhn(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function detectBrand(number) {
  const digits = number.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^6/.test(digits)) return 'RuPay';
  return 'Card';
}

function formatCard(value) {
  return value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export default function PaymentSheet({ open, onClose, amount, summary, onSuccess }) {
  const { meta } = useMeta();
  const content = getSiteContent(meta.settings);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptyForm);
      setError('');
      setProcessing(false);
    }
  }, [open]);

  const brand = useMemo(() => detectBrand(form.number), [form.number]);
  const last4 = form.number.replace(/\D/g, '').slice(-4);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  };

  const useTestCard = () => {
    const year = String((new Date().getFullYear() + 3) % 100).padStart(2, '0');
    setForm({ number: '4242 4242 4242 4242', name: 'Maya Chen', expiry: `12/${year}`, cvc: '123' });
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!luhn(form.number)) {
      setError(content.checkout_payment_error_card);
      return;
    }
    if (form.number.replace(/\D/g, '').endsWith('0000')) {
      setError(content.checkout_payment_error_declined);
      return;
    }
    if (!form.name.trim() || form.name.trim().length < 2) {
      setError(content.checkout_payment_error_name);
      return;
    }
    const [month, year] = form.expiry.split('/');
    const expiryMonth = Number(month);
    const expiryYear = 2000 + Number(year);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    if (
      !month || !year || !Number.isFinite(expiryMonth) || !Number.isFinite(expiryYear)
      || expiryMonth < 1 || expiryMonth > 12
      || expiryYear < currentYear
      || (expiryYear === currentYear && expiryMonth < currentMonth)
    ) {
      setError(content.checkout_payment_error_expiry);
      return;
    }
    if (!/^\d{3,4}$/.test(form.cvc)) {
      setError(content.checkout_payment_error_cvc);
      return;
    }

    setProcessing(true);
    setError('');
    try {
      await sleep(1300);
      await onSuccess({
        brand,
        last4,
        reference: `pay_demo_${Date.now()}`,
        demo: true,
      });
    } catch (nextError) {
      setError(nextError.message || content.checkout_payment_error_generic);
      setProcessing(false);
    }
  };

  const footer = (
    <div className="space-y-2">
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[0.72rem] font-semibold text-rose-700">{error}</p>}
      <button type="submit" form="payment-form" disabled={processing} className="btn btn-lime btn-lg w-full">
        {processing ? (
          <><Spinner className="h-4 w-4" /> {content.checkout_payment_processing}</>
        ) : (
          <><LockKeyhole className="h-4 w-4" /> {content.checkout_payment_pay} {inr(amount)}</>
        )}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={processing ? undefined : onClose}
      title={content.checkout_payment_sheet_title}
      description={content.checkout_payment_sheet_description}
      size="sm"
      hideClose={processing}
      footer={footer}
    >
      <div className="mb-5 rounded-2xl bg-ink p-4 text-cream">
        <div className="flex items-center justify-between">
          <span className="text-[0.62rem] font-bold uppercase tracking-[0.15em] text-cream/50">{content.checkout_payment_amount_due}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-ink">
            <Zap className="h-2.5 w-2.5" /> {content.checkout_payment_demo_badge}
          </span>
        </div>
        <p className="mt-1 text-3xl font-extrabold tracking-tight">{inr(amount)}</p>
        {summary && <p className="mt-1 text-[0.7rem] leading-5 text-cream/55">{summary}</p>}
      </div>

      <div className="mb-5 rounded-2xl border border-line bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-muted">
            <CreditCard className="h-3.5 w-3.5" /> {brand}
          </span>
          <span className="text-[0.62rem] font-bold text-muted">•••• {last4 || '••••'}</span>
        </div>
        <p className="mt-4 font-mono text-lg tracking-[0.18em] text-ink">
          {form.number || '•••• •••• •••• ••••'}
        </p>
        <div className="mt-3 flex items-center justify-between text-[0.62rem] font-semibold uppercase tracking-wider text-muted">
          <span className="truncate">{form.name || content.checkout_payment_cardholder_placeholder}</span>
          <span>{form.expiry || content.checkout_payment_expiry_placeholder}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={useTestCard}
        className="mb-4 flex w-full items-center justify-between rounded-xl border border-dashed border-lime-deep bg-lime/20 px-3.5 py-2.5 text-left transition hover:bg-lime/35"
      >
        <span className="text-[0.72rem] font-bold">{content.checkout_payment_test_card}</span>
        <span className="text-[0.6rem] font-extrabold uppercase tracking-wider text-forest">{content.checkout_payment_fill}</span>
      </button>

      <form id="payment-form" onSubmit={submit} className="space-y-3.5">
        <div>
          <label className="label" htmlFor="card-number">{content.checkout_payment_card_number}</label>
          <input
            id="card-number"
            inputMode="numeric"
            autoComplete="cc-number"
            value={form.number}
            onChange={(event) => update('number', formatCard(event.target.value))}
            placeholder={content.checkout_payment_card_placeholder}
            className="field font-mono tracking-wider"
            disabled={processing}
          />
        </div>
        <div>
          <label className="label" htmlFor="card-name">{content.checkout_payment_name_on_card}</label>
          <input
            id="card-name"
            autoComplete="cc-name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder={content.checkout_payment_name_placeholder}
            className="field"
            disabled={processing}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="card-expiry">{content.checkout_payment_expiry}</label>
            <input
              id="card-expiry"
              inputMode="numeric"
              autoComplete="cc-exp"
              value={form.expiry}
              onChange={(event) => update('expiry', formatExpiry(event.target.value))}
              placeholder={content.checkout_payment_expiry_placeholder}
              className="field font-mono"
              disabled={processing}
            />
          </div>
          <div>
            <label className="label" htmlFor="card-cvc">{content.checkout_payment_cvc}</label>
            <input
              id="card-cvc"
              inputMode="numeric"
              autoComplete="cc-csc"
              value={form.cvc}
              onChange={(event) => update('cvc', event.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder={content.checkout_payment_cvc_placeholder}
              className="field font-mono"
              disabled={processing}
            />
          </div>
        </div>

      </form>

      <p className="mt-3 flex items-start gap-1.5 text-[0.62rem] leading-4 text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" />
        {content.checkout_payment_simulated_note}
      </p>
    </Modal>
  );
}
