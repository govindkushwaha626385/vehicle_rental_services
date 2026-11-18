import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Download, FileText, IndianRupee, Landmark, Receipt, RefreshCw, Route, ShieldCheck, Wallet,
} from 'lucide-react';
import { EmptyState, LoadError, Pagination, StatusPill, TableScrollHint } from '../../components/ui.jsx';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { usePagination } from '../../hooks/usePagination.js';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { computeFinance, financialYearStart } from '../../lib/finance.js';
import { REFUND_METHOD_LABELS } from '../../lib/returns.js';
import { getSiteContent } from '../../lib/site.js';
import { cn, inr, localDay, longDate, paymentLabel, paymentStatusLabel } from '../../lib/format.js';
import { todayISO } from '../../lib/pricing.js';
import { downloadCsv } from '../../lib/csv.js';

const PAYMENT_TONE = {
  succeeded: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  authorized: 'bg-sky-50 text-sky-800 border-sky-200',
  refunded: 'bg-stone-100 text-stone-700 border-stone-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
  created: 'bg-amber-50 text-amber-800 border-amber-200',
};

export default function Finance() {
  const { push } = useToast();
  const [bookings, setBookings] = useState([]);
  const [settings, setSettings] = useState({});
  const [from, setFrom] = useState(() => financialYearStart());
  const [to, setTo] = useState(() => todayISO());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const requestGuard = useRequestGuard();

  const load = async () => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const [nextBookings, nextSettings] = await Promise.all([
        api.adminBookings(),
        api.adminSettings(),
      ]);
      if (!requestGuard.isCurrent(guard)) return;
      setBookings(nextBookings);
      setSettings(nextSettings);
    } catch (error) {
      if (!requestGuard.isCurrent(guard)) return;
      setLoadError(error.message);
      push(error.message, 'error');
    } finally {
      if (requestGuard.isCurrent(guard)) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = getSiteContent(settings);
  const rangeStart = from ? longDate(from) : 'the beginning';
  const rangeEnd = to ? longDate(to) : 'today';
  const finance = useMemo(
    () => computeFinance(bookings, settings, { from, to }),
    [bookings, settings, from, to]
  );
  const { summary, invoices, payments, taxRows, reconciliation } = finance;
  const invalidRange = Boolean(from && to && from > to);
  const invoiceBalance = invoices.reduce((sum, invoice) => sum + invoice.balance, 0);
  const agingMax = Math.max(1, ...reconciliation.aging.map((row) => row.amount));
  const refundRouteTotal = reconciliation.refundRoutes.reduce((sum, row) => sum + row.amount, 0);
  const exceptions = reconciliation.failed.count + reconciliation.pending.count + reconciliation.overdueSettlements.count;

  const invoicePages = usePagination({
    items: invoices,
    resetKey: `${from}|${to}`,
    pageSize: 25,
  });
  const paymentPages = usePagination({
    items: payments,
    resetKey: `${from}|${to}`,
    pageSize: 25,
  });

  const resetThisYear = () => {
    setFrom(financialYearStart());
    setTo(todayISO());
  };
  const showAll = () => {
    setFrom('2000-01-01');
    setTo('2099-12-31');
  };

  const exportInvoices = () => {
    downloadCsv(`rove-gst-invoices-${from}-to-${to}.csv`, [
      ['Invoice number', 'Trip start', 'Trip end', 'Booking', 'Customer', 'Status', 'Tax rate (%)', 'Taxable value (INR)', 'GST (INR)', 'Invoice total (INR)', 'Paid (INR)', 'Balance (INR)'],
      ...invoices.map((invoice) => [
        invoice.invoiceNo,
        invoice.startDate,
        invoice.endDate,
        invoice.code,
        invoice.customer,
        invoice.status,
        invoice.taxRate,
        invoice.taxable,
        invoice.gst,
        invoice.total,
        invoice.paid,
        invoice.balance,
      ]),
    ]);
    push(`Exported ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}.`, 'success');
  };

  const exportPayments = () => {
    downloadCsv(`rove-payments-${from}-to-${to}.csv`, [
      ['Payment date', 'Booking', 'Customer', 'Type', 'Status', 'Amount (INR)', 'Reference'],
      ...payments.map((payment) => [
        localDay(payment.createdAt),
        payment.booking,
        payment.customer,
        paymentLabel[payment.kind] || payment.kind,
        paymentStatusLabel[payment.paymentStatus] || payment.paymentStatus,
        payment.amount,
        payment.reference,
      ]),
    ]);
    push(`Exported ${payments.length} payment${payments.length === 1 ? '' : 's'}.`, 'success');
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Money &amp; compliance</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Finance &amp; GST</h1>
          <p className="mt-1 text-xs text-muted">GST invoices, captured payments and open balances for the selected period.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} disabled={loading} className="btn btn-white btn-sm">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
          </button>
          <button type="button" onClick={exportInvoices} disabled={!invoices.length} className="btn btn-dark btn-sm">
            <Download className="h-3.5 w-3.5" /> Export invoices
          </button>
        </div>
      </header>

      <section className="rounded-2xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="finance-from">From</label>
            <input id="finance-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="field w-auto" />
          </div>
          <div>
            <label className="label" htmlFor="finance-to">To</label>
            <input id="finance-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="field w-auto" />
          </div>
          <div className="flex flex-wrap gap-2 pb-0.5">
            <button type="button" onClick={resetThisYear} className="btn btn-ghost btn-sm">This financial year</button>
            <button type="button" onClick={showAll} className="btn btn-ghost btn-sm">All time</button>
          </div>
          <p className="ml-auto max-w-sm text-[0.62rem] leading-5 text-muted">
            Invoices use trip start dates. Payments use the date the money moved, so a deposit collected in March for an April trip appears in both reports in the right place.
          </p>
        </div>
      </section>

      {invalidRange && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.68rem] font-semibold text-amber-900">
          The start date is after the end date, so no trip or payment can fall in this window. Swap the dates to see results.
        </p>
      )}

      {!loading && summary.customerCredit > 0 && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.68rem] font-semibold text-amber-900">
          {inr(summary.customerCredit)} of customer credit is owed after downward repricing. Open the booking and refund the difference from its payment panel.
        </p>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-stone-200/70" />)}
        </div>
      ) : loadError && !bookings.length ? (
        <LoadError
          title="Finance could not load"
          message={loadError}
          hint="The GST register, collections and outstanding balances below would read as zero. Retry before relying on these figures."
          onRetry={() => load()}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="stat-card">
              <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-muted"><Receipt className="h-3 w-3" /> GST invoiced</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight">{inr(summary.gst)}</p>
              <p className="mt-0.5 text-[0.62rem] text-muted">{summary.invoiceCount} invoice{summary.invoiceCount === 1 ? '' : 's'} in this range · {inr(summary.invoiced)} gross</p>
            </div>
            <div className="stat-card">
              <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-muted"><IndianRupee className="h-3 w-3" /> Net collected</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight">{inr(summary.netCollected)}</p>
              <p className="mt-0.5 text-[0.62rem] text-muted">{inr(summary.grossCollected)} captured in range · {inr(summary.refunds)} refunded</p>
            </div>
            <div className="stat-card">
              <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-muted"><Wallet className="h-3 w-3" /> Outstanding</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight">{inr(summary.outstanding)}</p>
              <p className="mt-0.5 text-[0.62rem] text-muted">Current unpaid balances, including completed trips</p>
            </div>
            <div className="stat-card">
              <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-muted"><ShieldCheck className="h-3 w-3" /> Deposits due at pick-up</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight">{inr(summary.depositsDue)}</p>
              <p className="mt-0.5 text-[0.62rem] text-muted">{summary.depositCount} confirmed booking{summary.depositCount === 1 ? '' : 's'} · across all dates · not charged online</p>
            </div>
          </div>

          <section className="rounded-2xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><ShieldCheck className="h-3.5 w-3.5 text-forest" /> Deposit ledger</h2>
              <span className="text-[0.6rem] text-muted">Deposit money moves in person at the desks — it never enters the online payment ledger and is not part of the taxable rental.</span>
            </div>
            <div className="mt-3 grid gap-3 grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Due at pick-up</p>
                <p className="mt-1 text-lg font-extrabold">{inr(summary.depositsDue)}</p>
                <p className="text-[0.58rem] text-muted">{summary.depositCount} confirmed &amp; uncollected</p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Held on rent</p>
                <p className="mt-1 text-lg font-extrabold">{inr(summary.heldOnRent)}</p>
                <p className="text-[0.58rem] text-muted">active trips · collect at return</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Awaiting settlement</p>
                <p className="mt-1 text-lg font-extrabold text-amber-900">{inr(summary.awaitingDepositAmount)}</p>
                <p className="text-[0.58rem] text-amber-900">{summary.awaitingDepositCount} completed &amp; unsettled{summary.awaitingDepositAvgDays > 0 ? ` · avg ${summary.awaitingDepositAvgDays}d` : ''}</p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Released</p>
                <p className="mt-1 text-lg font-extrabold text-forest">{inr(summary.releasedDeposits)}</p>
                <p className="text-[0.58rem] text-muted">refunded at settlement</p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Extra due</p>
                <p className="mt-1 text-lg font-extrabold text-coral">{inr(summary.extraDueDeposits)}</p>
                <p className="text-[0.58rem] text-muted">beyond the deposit</p>
              </div>
            </div>
            {summary.awaitingDepositCount > 0 && (
              <Link to="/admin/desk?tab=returns" className="btn btn-ghost btn-sm mt-2">
                Settle deposits <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-extrabold">
                  <AlertTriangle className="h-3.5 w-3.5 text-forest" /> Reconciliation
                </h2>
                <p className="mt-0.5 text-[0.65rem] text-muted">
                  Payments that did not settle, deposit refunds still owed, and how long customers have waited.
                </p>
              </div>
              <span className={`badge ${exceptions ? 'bg-amber-100 text-amber-900' : 'bg-lime/25 text-ink'}`}>
                {exceptions ? `${exceptions} to review` : 'Nothing stuck'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className={`rounded-xl border p-3 ${reconciliation.failed.count ? 'border-rose-200 bg-rose-50' : 'border-line'}`}>
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Failed payments</p>
                <p className="mt-1 text-lg font-extrabold">{inr(reconciliation.failed.amount)}</p>
                <p className="text-[0.58rem] text-muted">
                  {reconciliation.failed.count} attempt{reconciliation.failed.count === 1 ? '' : 's'} in this range
                </p>
              </div>
              <div className={`rounded-xl border p-3 ${reconciliation.pending.count ? 'border-amber-200 bg-amber-50' : 'border-line'}`}>
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Pending payments</p>
                <p className="mt-1 text-lg font-extrabold">{inr(reconciliation.pending.amount)}</p>
                <p className="text-[0.58rem] text-muted">
                  {reconciliation.pending.count} awaiting the gateway
                </p>
              </div>
              <div className={`rounded-xl border p-3 ${reconciliation.overdueSettlements.count ? 'border-coral/40 bg-coral/5' : 'border-line'}`}>
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Overdue refunds</p>
                <p className="mt-1 text-lg font-extrabold">{inr(reconciliation.overdueSettlements.amount)}</p>
                <p className="text-[0.58rem] text-muted">
                  {reconciliation.overdueSettlements.count} settlement{reconciliation.overdueSettlements.count === 1 ? '' : 's'} past 7 days
                </p>
              </div>
              <div className={`rounded-xl border p-3 ${summary.awaitingDepositMaxDays > 7 ? 'border-amber-200 bg-amber-50' : 'border-line'}`}>
                <p className="text-[0.56rem] font-extrabold uppercase tracking-wider text-muted">Oldest wait</p>
                <p className="mt-1 text-lg font-extrabold">{summary.awaitingDepositMaxDays}d</p>
                <p className="text-[0.58rem] text-muted">target 5–7 working days</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">Refund aging</p>
                  <span className="text-[0.58rem] text-muted">{inr(summary.awaitingDepositAmount)} open</span>
                </div>
                {summary.awaitingDepositCount ? (
                  <div role="list" aria-label="Deposit refund aging" className="mt-2 space-y-2">
                    {reconciliation.aging.map((row) => (
                      <div key={row.label} role="listitem" className="flex items-center gap-2.5">
                        <span className="w-16 shrink-0 text-[0.62rem] font-bold text-muted">{row.label}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 text-[0.62rem]">
                            <span className="font-semibold">{row.count} refund{row.count === 1 ? '' : 's'}</span>
                            <span className="shrink-0 font-extrabold">{inr(row.amount)}</span>
                          </div>
                          <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-stone-100">
                            <div
                              className={`h-full rounded-full ${row.label === '11+ days' ? 'bg-coral' : row.label === '6–10 days' ? 'bg-amber-400' : 'bg-lime-deep'}`}
                              style={{ width: `${row.amount > 0 ? Math.max(2, Math.round((row.amount / agingMax) * 100)) : 0}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-line bg-paper px-3 py-4 text-center text-[0.64rem] text-muted">
                    Every completed trip has been settled — nothing owed to customers.
                  </p>
                )}
              </div>

              <div className="min-w-0 rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                    <Route className="h-3 w-3" /> Refund routes
                  </p>
                  <span className="text-[0.58rem] text-muted">{inr(refundRouteTotal)} returned</span>
                </div>
                {reconciliation.refundRoutes.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {reconciliation.refundRoutes.map((row) => (
                      <li key={row.method} className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-paper px-2.5 py-1.5 text-[0.64rem]">
                        <span className="font-semibold capitalize">{(REFUND_METHOD_LABELS[row.method] || row.method).replace(/^\w/, (char) => char.toUpperCase())}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-muted">{row.count} refund{row.count === 1 ? '' : 's'}</span>
                          <span className="font-extrabold">{inr(row.amount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-line bg-paper px-3 py-4 text-center text-[0.64rem] text-muted">
                    No deposit refunds settled in this period.
                  </p>
                )}
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
            <section className="min-w-0 rounded-2xl border border-line bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-extrabold">GST summary</h2>
                  <p className="mt-0.5 text-[0.65rem] text-muted">Taxable rental value split by the rate stored on each booking.</p>
                </div>
                <span className="badge bg-lime/25 text-ink">{inr(summary.taxable)} taxable</span>
              </div>
              {taxRows.length ? (
                <>
                  <TableScrollHint className="mt-4" />
                  <div className="table-wrap mt-1" role="region" aria-label="GST summary table" tabIndex={0}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Rate</th>
                          <th>Invoices</th>
                          <th>Taxable value</th>
                          <th>GST</th>
                          <th>Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taxRows.map((row) => (
                          <tr key={row.rate}>
                            <td className="font-extrabold">{row.rate}%</td>
                            <td>{row.invoices}</td>
                            <td>{inr(row.taxable)}</td>
                            <td className="font-bold">{inr(row.gst)}</td>
                            <td>{inr(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="mt-4 rounded-xl border border-dashed border-line bg-paper px-3 py-6 text-center text-[0.7rem] text-muted">No invoices start in this period.</p>
              )}
              <p className="mt-3 text-[0.6rem] leading-5 text-muted">
                GST applies to the rental, extras and protection. The refundable security deposit is due at pick-up and is not part of the taxable rental charge.
              </p>
            </section>

            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="flex items-center gap-2 text-sm font-extrabold"><Landmark className="h-4 w-4 text-forest" /> Invoice identity</h2>
              <p className="mt-3 text-[0.78rem] font-extrabold">{content.company_legal_name}</p>
              <p className="mt-0.5 text-[0.65rem] leading-5 text-muted">{content.registered_address || 'Add the registered address in Content.'}</p>
              <p className="mt-1 font-mono text-[0.62rem] text-muted">{content.gstin ? `GSTIN ${content.gstin}` : 'GSTIN not set'}</p>
              <dl className="mt-3 space-y-1.5 rounded-xl border border-line bg-paper p-3 text-[0.66rem]">
                <div className="flex justify-between gap-3"><dt className="text-muted">Invoice prefix</dt><dd className="font-mono font-bold">{settings.invoice_prefix || 'INV/26-27/'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Tax label</dt><dd className="font-bold">{settings.tax_label || 'GST'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Current rate</dt><dd className="font-bold">{settings.tax_rate ?? 18}%</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/admin/settings" className="btn btn-white btn-sm"><FileText className="h-3.5 w-3.5" /> Invoice settings</Link>
                <Link to="/admin/content" className="btn btn-ghost btn-sm">Legal details</Link>
              </div>
            </section>
          </div>

          <section className="min-w-0">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold">GST invoice register</h2>
                <p className="mt-0.5 text-[0.65rem] text-muted">Trips starting between {rangeStart} and {rangeEnd}.</p>
              </div>
              <span className="badge bg-white text-muted">{invoices.length} invoice{invoices.length === 1 ? '' : 's'}</span>
            </div>
            {invoices.length ? (
              <>
                <TableScrollHint />
                <div className="table-wrap" role="region" aria-label="GST invoice register" tabIndex={0}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Trip</th>
                        <th>Customer</th>
                        <th>Taxable</th>
                        <th>GST</th>
                        <th>Total</th>
                        <th>Balance</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoicePages.rows.map((invoice) => (
                        <tr key={invoice.id}>
                          <td>
                            <p className="whitespace-nowrap font-mono text-[0.66rem] font-bold">{invoice.invoiceNo}</p>
                            <Link
                              to={`/admin/bookings?code=${encodeURIComponent(invoice.code)}`}
                              className="font-mono text-[0.58rem] font-bold text-muted underline-offset-2 hover:text-ink hover:underline"
                            >
                              {invoice.code}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap text-[0.68rem]">
                            <p className="font-bold">{longDate(invoice.startDate)}</p>
                            <p className="text-[0.58rem] text-muted">to {longDate(invoice.endDate)}</p>
                          </td>
                          <td>
                            <p className="text-[0.7rem] font-bold">{invoice.customer}</p>
                            <p className="text-[0.58rem] text-muted">{invoice.email || 'Guest booking'}</p>
                          </td>
                          <td>{inr(invoice.taxable)}</td>
                          <td className="font-bold">{inr(invoice.gst)}<span className="ml-1 text-[0.56rem] font-normal text-muted">{invoice.taxRate}%</span></td>
                          <td className="font-extrabold">{inr(invoice.total)}</td>
                          <td className={invoice.balance > 0 ? 'font-bold text-amber-800' : 'text-muted'}>{invoice.balance > 0 ? inr(invoice.balance) : '—'}</td>
                          <td><StatusPill status={invoice.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-paper/70">
                        <td colSpan={3} className="text-right text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
                          Totals · {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
                        </td>
                        <td className="font-extrabold">{inr(summary.taxable)}</td>
                        <td className="font-extrabold">{inr(summary.gst)}</td>
                        <td className="font-extrabold">{inr(summary.invoiced)}</td>
                        <td className={invoiceBalance > 0 ? 'font-extrabold text-amber-800' : 'text-muted'}>
                          {invoiceBalance > 0 ? inr(invoiceBalance) : '—'}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <Pagination
                  page={invoicePages.page}
                  totalPages={invoicePages.totalPages}
                  onPage={invoicePages.setPage}
                  size={invoicePages.size}
                  onSizeChange={invoicePages.setSize}
                  label={`Showing ${invoicePages.start + 1}–${invoicePages.end} of ${invoicePages.total}`}
                  className="mt-3"
                />
              </>
            ) : (
              <EmptyState
                icon={Receipt}
                title="No GST invoices in this period"
                description="Choose a wider date range or clear the filters. Invoices are created from confirmed trips automatically."
              />
            )}
          </section>

          <section className="min-w-0">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold">Payment ledger</h2>
                <p className="mt-0.5 text-[0.65rem] text-muted">Captured payments and refunds by the date money moved. Security deposits stay in the pick-up total, not this ledger.</p>
              </div>
              <button type="button" onClick={exportPayments} disabled={!payments.length} className="btn btn-white btn-sm">
                <Download className="h-3.5 w-3.5" /> Export payments
              </button>
            </div>
            {payments.length ? (
              <>
                <TableScrollHint />
                <div className="table-wrap" role="region" aria-label="Payment ledger" tabIndex={0}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Booking</th>
                        <th>Customer</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Reference</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentPages.rows.map((payment) => (
                        <tr key={payment.id}>
                          <td className="whitespace-nowrap text-[0.68rem] text-muted">{longDate(payment.createdAt)}</td>
                          <td className="font-mono text-[0.66rem] font-bold">
                            <Link
                              to={`/admin/bookings?code=${encodeURIComponent(payment.booking)}`}
                              className="underline-offset-2 hover:text-forest hover:underline"
                            >
                              {payment.booking}
                            </Link>
                          </td>
                          <td className="text-[0.7rem]">{payment.customer}</td>
                          <td className="text-[0.68rem] font-bold">{paymentLabel[payment.kind] || payment.kind}</td>
                          <td>
                            <span className={cn('badge border', PAYMENT_TONE[payment.paymentStatus] ?? 'bg-stone-100 text-stone-700 border-stone-200')}>
                              {paymentStatusLabel[payment.paymentStatus] || payment.paymentStatus}
                            </span>
                          </td>
                          <td className="max-w-[12rem] truncate text-[0.58rem] text-muted">{payment.reference || (payment.kind === 'hold' ? 'Due at pick-up' : '—')}</td>
                          <td className="whitespace-nowrap text-right font-extrabold">{inr(payment.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={paymentPages.page}
                  totalPages={paymentPages.totalPages}
                  onPage={paymentPages.setPage}
                  size={paymentPages.size}
                  onSizeChange={paymentPages.setSize}
                  label={`Showing ${paymentPages.start + 1}–${paymentPages.end} of ${paymentPages.total}`}
                  className="mt-3"
                />
              </>
            ) : (
              <EmptyState
                icon={Wallet}
                title="No payments in this period"
                description="Payment records appear here as soon as a checkout is captured, refunded or marked due at pick-up."
              />
            )}
          </section>

          <p className="rounded-xl border border-line bg-white/70 px-3 py-2 text-[0.62rem] leading-5 text-muted">
            Exports contain customer names and invoice values. Treat downloaded files as financial records and store them accordingly. This register is a reconciliation aid, not a substitute for your accountant&apos;s filing.
          </p>
        </>
      )}
    </div>
  );
}
