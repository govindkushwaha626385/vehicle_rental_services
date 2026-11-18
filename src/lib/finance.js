import { todayISO } from './pricing.js';
import { REFUND_METHODS, settlementWaitDays } from './returns.js';

const amount = (value) => Math.max(0, Math.round(Number(value) || 0));
/**
 * Calendar day for a date or timestamp in the viewer's local day.
 *
 * Invoice dates are date-only strings, but payments carry UTC timestamps.
 * Slicing the UTC string would drop a 00:30 IST payment from the day the admin
 * selected (and put it on the previous day's report). Date-only strings pass
 * through unchanged.
 */
const day = (value) => {
  const text = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function financialYearStart(today = todayISO()) {
  const year = Number(String(today).slice(0, 4));
  const month = Number(String(today).slice(5, 7));
  return `${month >= 4 ? year : year - 1}-04-01`;
}

export function invoiceNumber(settings = {}, code = '', date = todayISO()) {
  // The seeded prefix is editable, but a missing one must still follow the
  // financial year of the trip, not the year the report happens to run in.
  const fallback = (() => {
    const short = Number(financialYearStart(date).slice(2, 4));
    return `INV/${String(short).padStart(2, '0')}-${String(short + 1).padStart(2, '0')}/`;
  })();
  const prefix = String(settings?.invoice_prefix ?? '').trim() || fallback;
  return `${prefix}${String(code ?? '').trim()}`;
}

/**
 * Build the GST invoice register and payment ledger for a date range.
 *
 * Invoice rows are selected by trip start date (the date the supply happens).
 * Payment rows are selected by payment date (the date cash moved). Keeping the
 * two windows explicit avoids a common accounting mistake: a deposit collected
 * in March for an April trip belongs in different reports for each question.
 */
export function computeFinance(bookings = [], settings = {}, { from, to, today = todayISO() } = {}) {
  const start = from || '0000-01-01';
  const end = to || '9999-12-31';
  const inRange = (value) => {
    const date = day(value);
    return Boolean(date) && date >= start && date <= end;
  };

  // A pending request has not been accepted, so it is not an invoice or a
  // receivable yet. Only committed trips enter the GST register.
  const invoices = bookings
    .filter((booking) => ['confirmed', 'active', 'completed'].includes(booking.status) && inRange(booking.startDate))
    .map((booking) => {
      const total = amount(booking.total);
      const gst = amount(booking.fees);
      const paid = amount(booking.amountPaid);
      const taxRate = Number(booking.taxRate ?? settings?.tax_rate ?? 0) || 0;
      // Prefer the snapshotted taxable value: `total - tax` would count
      // untaxed components as taxable once the admin excludes any.
      const untaxed = amount(booking.untaxedTotal);
      const taxable = booking.taxable !== undefined && booking.taxable !== null
        ? amount(booking.taxable)
        : Math.max(0, total - gst - untaxed);
      // A downward reprice (shortened dates, declined extra) can leave the
      // customer having paid more than the new total. That difference is a
      // real liability, not a rounding artefact, so it is surfaced explicitly.
      const creditDue = Math.max(0, paid - total);
      return {
        id: booking.id,
        code: booking.code,
        invoiceNo: invoiceNumber(settings, booking.code, booking.startDate),
        startDate: day(booking.startDate),
        endDate: day(booking.endDate),
        createdAt: booking.createdAt,
        customer: booking.customer?.name || 'Guest',
        email: booking.customer?.email || '',
        status: booking.status,
        taxRate,
        taxable,
        untaxedTotal: untaxed,
        gst,
        total,
        paid,
        balance: Math.max(0, total - paid),
        creditDue,
      };
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.code.localeCompare(a.code));

  const payments = bookings
    .flatMap((booking) => (booking.payments ?? [])
      .filter((payment) => payment.kind !== 'hold')
      .map((payment) => ({
        id: payment.id,
        booking: booking.code,
        customer: booking.customer?.name || 'Guest',
        status: booking.status,
        kind: payment.kind,
        paymentStatus: payment.status,
        amount: amount(payment.amount),
        createdAt: payment.createdAt,
        reference: payment.reference || '',
      })))
    .filter((payment) => inRange(payment.createdAt))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const grossCollected = payments
    .filter((payment) => ['payment', 'deposit', 'balance'].includes(payment.kind)
      && ['succeeded', 'refunded'].includes(payment.paymentStatus))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const refunds = payments
    .filter((payment) => payment.kind === 'refund'
      && ['refunded', 'succeeded'].includes(payment.paymentStatus))
    .reduce((sum, payment) => sum + payment.amount, 0);

  // Outstanding money can survive completion (a balance or extra charge not yet
  // collected), so only committed, non-closed bookings are included.
  const liveBookings = bookings.filter((booking) => ['confirmed', 'active', 'completed'].includes(booking.status));
  // The security deposit is collected in person at pick-up. It is not a card
  // authorisation and never appears in the payment ledger; the amount is
  // snapshotted on each booking so later setting changes stay honest. Only
  // confirmed bookings still have a deposit *due* — an active trip's deposit is
  // already held (see the analytics deposit float), and a confirmed booking
  // whose desk already recorded the collection is not owed again.
  const deposits = bookings
    .filter((booking) => booking.status === 'confirmed' && !booking.depositCollected)
    .map((booking) => amount(booking.holdAmount ?? settings?.hold_amount))
    .filter((value) => value > 0);

  // The rest of the deposit book — held on rent, awaiting settlement, released
  // and extra-due — mirrors the returns desk exactly, so Finance, Analytics and
  // the desk can never disagree about the same pile of money.
  const heldOnRent = bookings
    .filter((booking) => booking.status === 'active')
    .reduce((sum, booking) => sum + amount(booking.holdAmount), 0);
  const awaitingSettlement = bookings
    .filter((booking) => booking.status === 'completed' && !booking.depositSettlement);
  const settledBookings = bookings.filter((booking) => booking.depositSettlement);

  // Reconciliation is the money that has not cleanly landed: failed or pending
  // online payments, invoices still carrying a balance, and the age of deposit
  // refunds we owe customers. Every figure is derived from the same payments and
  // settlements used by the ledgers above, so the two can never disagree.
  const reconciliation = (() => {
    const failed = payments.filter((payment) => payment.paymentStatus === 'failed');
    const pending = payments.filter((payment) => ['created', 'authorized'].includes(payment.paymentStatus));
    const openInvoices = invoices.filter((invoice) => invoice.balance > 0);
    const overdue = awaitingSettlement.filter((booking) => settlementWaitDays(booking, today) > 7);
    const agingBuckets = [
      { label: '0–2 days', min: 0, max: 2 },
      { label: '3–5 days', min: 3, max: 5 },
      { label: '6–10 days', min: 6, max: 10 },
      { label: '11+ days', min: 11, max: Infinity },
    ];
    const aging = agingBuckets.map((bucket) => {
      const rows = awaitingSettlement.filter((booking) => {
        const wait = settlementWaitDays(booking, today);
        return wait >= bucket.min && wait <= bucket.max;
      });
      return {
        label: bucket.label,
        count: rows.length,
        amount: rows.reduce((sum, booking) => sum + amount(booking.holdAmount), 0),
      };
    });
    const routeMap = new Map();
    settledBookings.forEach((booking) => {
      const refundDue = amount(booking.depositSettlement.refundDue);
      if (!refundDue) return;
      const method = REFUND_METHODS.includes(booking.depositSettlement.refundMethod)
        ? booking.depositSettlement.refundMethod
        : 'original';
      const row = routeMap.get(method) || { method, count: 0, amount: 0 };
      row.count += 1;
      row.amount += refundDue;
      routeMap.set(method, row);
    });
    return {
      failed: { count: failed.length, amount: failed.reduce((sum, payment) => sum + payment.amount, 0) },
      pending: { count: pending.length, amount: pending.reduce((sum, payment) => sum + payment.amount, 0) },
      openInvoices: { count: openInvoices.length, amount: openInvoices.reduce((sum, invoice) => sum + invoice.balance, 0) },
      overdueSettlements: {
        count: overdue.length,
        amount: overdue.reduce((sum, booking) => sum + amount(booking.holdAmount), 0),
      },
      aging,
      refundRoutes: REFUND_METHODS
        .map((method) => routeMap.get(method))
        .filter(Boolean),
    };
  })();

  const taxMap = new Map();
  invoices.forEach((invoice) => {
    const row = taxMap.get(invoice.taxRate) || {
      rate: invoice.taxRate,
      invoices: 0,
      taxable: 0,
      gst: 0,
      total: 0,
    };
    row.invoices += 1;
    row.taxable += invoice.taxable;
    row.gst += invoice.gst;
    row.total += invoice.total;
    taxMap.set(invoice.taxRate, row);
  });

  return {
    invoices,
    payments,
    taxRows: [...taxMap.values()].sort((a, b) => a.rate - b.rate),
    reconciliation,
    summary: {
      invoiceCount: invoices.length,
      invoiced: invoices.reduce((sum, invoice) => sum + invoice.total, 0),
      taxable: invoices.reduce((sum, invoice) => sum + invoice.taxable, 0),
      gst: invoices.reduce((sum, invoice) => sum + invoice.gst, 0),
      grossCollected,
      refunds,
      netCollected: grossCollected - refunds,
      outstanding: liveBookings.reduce((sum, booking) => sum + Math.max(0, amount(booking.total) - amount(booking.amountPaid)), 0),
      customerCredit: bookings.reduce(
        (sum, booking) => sum + Math.max(0, amount(booking.amountPaid) - amount(booking.total)),
        0,
      ),
      depositsDue: deposits.reduce((sum, value) => sum + value, 0),
      depositCount: deposits.length,
      heldOnRent,
      awaitingDepositCount: awaitingSettlement.length,
      awaitingDepositAmount: awaitingSettlement.reduce((sum, booking) => sum + amount(booking.holdAmount), 0),
      awaitingDepositAvgDays: awaitingSettlement.length
        ? Math.round(awaitingSettlement.reduce((sum, booking) => sum + settlementWaitDays(booking, today), 0) / awaitingSettlement.length)
        : 0,
      awaitingDepositMaxDays: awaitingSettlement.reduce((max, booking) => Math.max(max, settlementWaitDays(booking, today)), 0),
      releasedDeposits: settledBookings.reduce((sum, booking) => sum + amount(booking.depositSettlement.refundDue), 0),
      extraDueDeposits: settledBookings.reduce((sum, booking) => sum + amount(booking.depositSettlement.extraDue), 0),
    },
  };
}
