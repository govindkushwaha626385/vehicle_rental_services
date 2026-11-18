export const cn = (...values) => values.filter(Boolean).join(' ');

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const inr = (value) => inrFormatter.format(Number(value) || 0);

export const inrShort = (value) => {
  const amount = Number(value) || 0;
  // Trim the trailing `.0` after rounding so 99,999 reads as `₹100k`, not
  // `₹100.0k`. Using the rounded value also avoids a dangling `.0`.
  const compact = (scaled) => scaled.toFixed(1).replace(/\.0$/, '');
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 10000000) return `${sign}₹${compact(abs / 10000000)}Cr`;
  if (abs >= 100000) return `${sign}₹${compact(abs / 100000)}L`;
  if (abs >= 1000) return `${sign}₹${compact(abs / 1000)}k`;
  return `${sign}₹${abs}`;
};

/**
 * Calendar day (YYYY-MM-DD) in the viewer's local day.
 *
 * Date-only strings pass through. UTC timestamps are converted so a booking
 * made at 00:30 IST is shown on the day the admin experienced, not the
 * previous UTC day.
 */
export const localDay = (iso) => {
  const text = String(iso ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const parse = (iso) => new Date(`${localDay(iso)}T12:00:00`);

export const shortDate = (iso) =>
  iso ? parse(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

export const longDate = (iso) =>
  iso ? parse(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

export const dayDate = (iso) =>
  iso ? parse(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';

export const dateRange = (start, end) =>
  start && end ? `${shortDate(start)} – ${longDate(end)}` : '—';

export const timeLabel = (value) => {
  if (!value || !value.includes(':')) return value || '';
  const [hours, minutes] = value.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'R';

export const statusMeta = {
  pending: { label: 'Pending', tone: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  confirmed: { label: 'Confirmed', tone: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  active: { label: 'On rent', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  completed: { label: 'Completed', tone: 'bg-stone-100 text-stone-700 border-stone-200', dot: 'bg-stone-400' },
  cancelled: { label: 'Cancelled', tone: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  rejected: { label: 'Rejected', tone: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  available: { label: 'Available', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  rented: { label: 'On rent', tone: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  maintenance: { label: 'In service', tone: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  paid: { label: 'Paid in full', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  partially_paid: { label: 'Part paid', tone: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  deposit_paid: { label: 'Deposit paid', tone: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  partially_refunded: { label: 'Part-refunded', tone: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  refunded: { label: 'Refunded', tone: 'bg-stone-100 text-stone-700 border-stone-200', dot: 'bg-stone-400' },
  unpaid: { label: 'Unpaid', tone: 'bg-stone-100 text-stone-700 border-stone-200', dot: 'bg-stone-400' },
};

export const roleLabel = { customer: 'Customer', manager: 'Fleet manager', admin: 'Super admin' };

/**
 * Payment state for display. A booking can be repriced upward after it was paid,
 * which leaves a balance while the stored payment status still says "paid".
 * Derive the honest label instead of showing "Paid in full" next to a balance.
 */
export const bookingPaymentState = (booking) => {
  if (!booking) return 'unpaid';
  const status = booking.paymentStatus || 'unpaid';
  // A closed booking has no live balance: the cancellation settled what was
  // owed. Keeping the raw balance would label a fully paid, cancelled trip as
  // "Part paid" next to a ₹0 balance in the table and drawer.
  const closed = ['cancelled', 'rejected'].includes(booking.status);
  const balance = closed ? 0 : (Number(booking.balanceDue) || 0);
  if (status === 'paid' && balance > 0) return 'partially_paid';
  return status;
};

export const paymentLabel = {
  payment: 'Payment',
  deposit: 'Deposit',
  balance: 'Balance',
  hold: 'Security deposit',
  refund: 'Refund',
};

export const paymentStatusLabel = {
  succeeded: 'Captured',
  authorized: 'Due at pick-up',
  refunded: 'Refunded',
  failed: 'Failed',
  created: 'Pending',
};

export const bookingRefundTotal = (booking) =>
  (booking?.payments ?? [])
    .filter((payment) => payment.kind === 'refund')
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

/**
 * Human-readable payment line for a booking. After a refund the API stores the
 * net amount still held in `amountPaid`, so we combine it with refund records
 * to show the gross amount the customer originally paid.
 */
export function bookingPaymentSummary(booking) {
  const netPaid = Number(booking?.amountPaid) || 0;
  const refunded = bookingRefundTotal(booking);
  const grossPaid = netPaid + refunded;
  const total = Number(booking?.total) || 0;
  const closed = ['cancelled', 'rejected'].includes(booking?.status);
  const due = closed ? 0 : Math.max(0, total - netPaid);
  // A downward reprice leaves the customer holding a real credit. The manage
  // and account cards use this summary, so surface it here instead of showing
  // a plain "Paid ₹X" with no hint that money is owed back.
  const credit = closed ? 0 : Math.max(0, netPaid - total);

  if (refunded > 0) {
    if (netPaid > 0) return `Paid ${inr(grossPaid)} · ${inr(refunded)} refunded · ${inr(netPaid)} retained`;
    return `${inr(refunded)} refunded${grossPaid > refunded ? ` of ${inr(grossPaid)} paid` : ''}`;
  }
  if (credit > 0) return `Paid ${inr(netPaid)} · ${inr(credit)} credit due`;
  if (netPaid <= 0) return 'No payment captured';
  if (due > 0) return `Paid ${inr(netPaid)} · ${inr(due)} due`;
  return `Paid ${inr(netPaid)}`;
}

export const monthKey = (iso) => (iso ? iso.slice(0, 7) : '');

export const monthLabel = (key) => {
  if (!key) return '';
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
};

export const avatarTone = (name = '') => {
  const tones = [
    'bg-[#D7F75F] text-ink',
    'bg-[#1E382A] text-cream',
    'bg-[#F6D9B0] text-ink',
    'bg-[#C9D8F2] text-ink',
    'bg-[#E9C9E2] text-ink',
  ];
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return tones[sum % tones.length];
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const safeJSON = (value, fallback) => {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
};
