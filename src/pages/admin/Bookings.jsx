import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, CalendarRange, Check, Clock, Bell, CreditCard, Download, ExternalLink, HandCoins, RotateCcw, ShieldCheck, Sparkles, User, X,
} from 'lucide-react';
import { CopyButton, Drawer, EmptyState, LoadError, Modal, Pagination, SearchField, SortableHeader, StatusPill, TableScrollHint, Tooltip } from '../../components/ui.jsx';
import ExtendReturnForm from '../../components/admin/ExtendReturnForm.jsx';
import { useSort } from '../../hooks/useSort.js';
import { usePagination } from '../../hooks/usePagination.js';
import { useRequestGuard } from '../../hooks/useRequestGuard.js';
import { api } from '../../lib/api.js';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { ALLOWED_TRANSITIONS, BOOKING_STATUSES } from '../../lib/constants.js';
import { downloadCsv } from '../../lib/csv.js';
import { buildCustomerMoneyMap, customerMoneyKey } from '../../lib/customers.js';
import { getSiteContent } from '../../lib/site.js';
import { bookingPaymentState, cn, inr, localDay, longDate, paymentLabel, paymentStatusLabel, statusMeta, timeLabel } from '../../lib/format.js';
import { inspectionLine, kmDriven } from '../../lib/inspection.js';
import { excessKm, kmDisclosure } from '../../lib/km.js';
import {
  RENTAL_TIMES, addDaysISO, isRentalTime, todayISO,
} from '../../lib/pricing.js';

const STATUS_LABELS = {
  confirmed: 'Confirm booking',
  rejected: 'Reject booking',
  cancelled: 'Cancel booking',
  active: 'Mark on rent',
  completed: 'Mark completed',
};

export default function Bookings() {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = useMemo(() => getSiteContent(meta.settings), [meta.settings]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [changeFilter, setChangeFilter] = useState(false);
  const [overdueFilter, setOverdueFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [dates, setDates] = useState({ startDate: '', endDate: '' });
  const [extendOpen, setExtendOpen] = useState(false);
  const [remindingId, setRemindingId] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [trip, setTrip] = useState({
    pickupLocation: '', dropoffLocation: '', pickupTime: '10:00', dropoffTime: '10:00',
  });
  const [notes, setNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [refundOnCancel, setRefundOnCancel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [changeBusy, setChangeBusy] = useState(false);
  const [bulkIds, setBulkIds] = useState(new Set());
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const requestGuard = useRequestGuard();

  const selected = bookings.find((booking) => booking.id === selectedId) || null;

  // Observable dirtiness for the edit drawer: did the operator diverge from
  // the loaded booking? No flag bookkeeping — the snapshot refreshes after
  // every save, so a saved state always reads as clean again.
  const drawerDirty = Boolean(selected) && (
    dates.startDate !== selected.startDate
    || dates.endDate !== selected.endDate
    || trip.pickupLocation !== selected.pickupLocation
    || trip.dropoffLocation !== selected.dropoffLocation
    || trip.pickupTime !== (selected.pickupTime || '10:00')
    || trip.dropoffTime !== (selected.dropoffTime || '10:00')
    || notes !== String(selected.notes || '')
  );

  // Money the customer holds with the business across all their trips — the
  // phone-support answer before anyone has to open five vouchers.
  const customerMoney = useMemo(() => {
    if (!selected || !bookings.length) return null;
    return buildCustomerMoneyMap(bookings).get(customerMoneyKey(selected)) ?? null;
  }, [selected, bookings]);

  const requestClose = () => {
    if (saving) return;
    if (drawerDirty) { setConfirmDiscard(true); return; }
    setSelectedId(null);
  };
  const pendingChanges = bookings.filter((booking) => booking.changeRequest?.status === 'pending').length;
  const overduePickups = bookings.filter((booking) => booking.status === 'confirmed' && booking.startDate < todayISO()).length;

  const load = async (keepId) => {
    const guard = requestGuard.make();
    setLoading(true);
    setLoadError('');
    try {
      const result = await api.adminBookings();
      if (!requestGuard.isCurrent(guard)) return;
      setBookings(result);
      if (keepId) setSelectedId(keepId);
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

  // Deep link from the availability calendar: /admin/bookings?code=RV-1234
  // opens that booking's drawer, then clears the param so closing it stays put.
  useEffect(() => {
    const code = searchParams.get('code');
    if (!code || !bookings.length) return;
    const match = bookings.find((booking) => booking.code.toLowerCase() === code.toLowerCase());
    if (match) {
      setSelectedId(match.id);
    } else {
      push(content.bookings_not_found.replace('{code}', code), 'error');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('code');
    setSearchParams(next, { replace: true });
  }, [searchParams, bookings, setSearchParams, push]);

  // Deep links from the dashboard feed and staff notifications:
  // ?status=pending and ?change=pending pre-filter the table, then clear the
  // params so closing the page does not keep re-applying a stale filter.
  useEffect(() => {
    const status = searchParams.get('status');
    const change = searchParams.get('change');
    if (!status && !change) return;
    const next = new URLSearchParams(searchParams);
    if (status) {
      if (BOOKING_STATUSES.includes(status)) setStatusFilter(status);
      next.delete('status');
    }
    if (change === 'pending') {
      setChangeFilter(true);
      next.delete('change');
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (selected) {
      setDates({ startDate: selected.startDate, endDate: selected.endDate });
      setTrip({
        pickupLocation: selected.pickupLocation || '',
        dropoffLocation: selected.dropoffLocation || '',
        pickupTime: selected.pickupTime || '10:00',
        dropoffTime: selected.dropoffTime || '10:00',
      });
      setNotes(selected.notes || '');
      setCancelReason('');
      setRefundOnCancel(false);
      setConfirmAction(null);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => bookings.filter((booking) => {
    const haystack = `${booking.code} ${booking.customer?.name} ${booking.customer?.email} ${booking.vehicle?.name} ${booking.pickupLocation}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());
    const matchesStatus = !statusFilter || booking.status === statusFilter;
    const matchesChange = !changeFilter || booking.changeRequest?.status === 'pending';
    const matchesOverdue = !overdueFilter || (booking.status === 'confirmed' && booking.startDate < todayISO());
    const matchesWindow = (!dateFrom || booking.startDate >= dateFrom) && (!dateTo || booking.startDate <= dateTo);
    return matchesSearch && matchesStatus && matchesChange && matchesOverdue && matchesWindow;
  }), [bookings, search, statusFilter, changeFilter, overdueFilter, dateFrom, dateTo]);

  // Column sorting (shadcn Data Table style). The accessor maps a column key
  // to a comparable value; nulls/empties sort last in either direction. With
  // no active column the natural API order (newest first) is preserved.
  const { sort: columnSort, toggle: toggleSort, apply: applySort } = useSort();
  const sorted = useMemo(() => applySort(filtered, (key, booking) => {
    if (key === 'customer') return booking.customer?.name || 'Guest';
    if (key === 'vehicle') return booking.vehicle?.name || '';
    if (key === 'dates') return booking.startDate || '';
    if (key === 'total') return Number(booking.total) || 0;
    if (key === 'payment') return Number(booking.amountPaid) || 0;
    return booking[key] ?? '';
  }), [filtered, applySort]);

  // Page the sorted rows. Bulk selection reads the whole filtered set, so
  // ticking rows on different pages still accumulates a real selection.
  const pagination = usePagination({
    items: sorted,
    resetKey: `${search}|${statusFilter}|${changeFilter}|${overdueFilter}|${dateFrom}|${dateTo}|${columnSort.key}|${columnSort.dir}`,
    pageSize: 25,
  });
  const pageRows = pagination.rows;

  // Never let a bulk action touch a row the operator can no longer see. If a
  // filter hides a selected booking, drop it from the selection immediately.
  useEffect(() => {
    setBulkIds((current) => {
      if (!current.size) return current;
      const visible = new Set(filtered.map((booking) => booking.id));
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filtered]);

  const setWindow = (from, to) => {
    setDateFrom(from);
    setDateTo(to);
  };
  const today = todayISO();
  const quicks = [
    { label: "Today's pick-ups", apply: () => setWindow(today, today) },
    { label: 'Next 7 days', apply: () => setWindow(today, addDaysISO(today, 6)) },
    { label: 'This month', apply: () => {
      const first = `${today.slice(0, 7)}-01`;
      const daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
      setWindow(first, addDaysISO(first, daysInMonth - 1));
    } },
    { label: 'Any dates', apply: () => setWindow('', '') },
  ];

  const update = async (payload, successMessage) => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.adminUpdateBooking({ bookingId: selected.id, ...payload });
      push(successMessage, 'success');
      await load(selected.id);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const transition = (status) => {
    if (!selected) return;
    // Guard against stale state: a booking that is already in the target
    // terminal state (cancelled/rejected) should never be submitted again.
    const terminal = ['cancelled', 'rejected', 'completed'];
    if (terminal.includes(selected.status) && terminal.includes(status)) {
      push(content.bookings_already_status.replace('{status}', selected.status), 'error');
      return;
    }
    const payload = { status };
    if (['cancelled', 'rejected'].includes(status) && cancelReason.trim()) {
      payload.reason = cancelReason.trim();
    }
    const refunding = status === 'cancelled' && Number(selected.amountPaid) > 0 && refundOnCancel;
    if (refunding) payload.refund = true;
    const message = refunding ? 'Booking cancelled and payment refunded.' : `Booking marked ${status}.`;
    if (['cancelled', 'rejected', 'completed'].includes(status)) {
      setConfirmAction({ status, payload, message, refunding });
      return;
    }
    update(payload, message);
  };

  const applyTransition = async () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    await update(action.payload, action.message);
  };

  const saveDates = () => {
    if (!dates.startDate || !dates.endDate || dates.endDate <= dates.startDate) {
      push(content.bookings_dates_error, 'error');
      return;
    }
    update({ startDate: dates.startDate, endDate: dates.endDate }, content.bookings_dates_saved);
  };

  const remindBooking = async (booking) => {
    if (remindingId === booking.id) return;
    setRemindingId(booking.id);
    try {
      await api.sendReturnReminder({ bookingId: booking.id });
      push(content.return_reminded, 'success');
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setRemindingId(null);
    }
  };

  const saveTrip = () => {
    if (!trip.pickupLocation || !trip.dropoffLocation) {
      push(content.bookings_hubs_error, 'error');
      return;
    }
    if (!isRentalTime(trip.pickupTime) || !isRentalTime(trip.dropoffTime)) {
      push(content.bookings_times_error, 'error');
      return;
    }
    update({ ...trip }, content.bookings_trip_saved);
  };

  const refund = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await api.adminRefund({ bookingId: selected.id });
      push(result?.message || content.bookings_refund_issued, 'success');
      setRefundOpen(false);
      await load(selected.id);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const recordPayment = async () => {
    if (!selected || !paymentForm) return;
    const value = Number(paymentForm.amount);
    if (!Number.isInteger(value) || value <= 0) {
      push(content.bookings_amount_error, 'error');
      return;
    }
    if (value > Number(selected.balanceDue || 0)) {
      push(content.bookings_amount_over, 'error');
      return;
    }
    setSaving(true);
    try {
      await api.adminRecordPayment({
        bookingId: selected.id,
        amount: value,
        method: paymentForm.method,
        reference: paymentForm.reference,
      });
      push(content.bookings_payment_recorded.replace('{amount}', inr(value)), 'success');
      setPaymentForm(null);
      await load(selected.id);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const refundCredit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await api.adminRefundCredit({ bookingId: selected.id });
      push(result?.message || content.bookings_credit_refunded, 'success');
      await load(selected.id);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const approveChange = async () => {
    if (!selected || changeBusy) return;
    setChangeBusy(true);
    try {
      await api.resolveChangeRequest({ bookingId: selected.id, decision: 'approve' });
      push(content.amend_approved, 'success');
      await load(selected.id);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setChangeBusy(false);
    }
  };

  const declineChange = async () => {
    if (!selected) return;
    setChangeBusy(true);
    try {
      await api.resolveChangeRequest({
        bookingId: selected.id,
        decision: 'decline',
        reason: declineReason.trim(),
      });
      push(content.amend_declined, 'success');
      setDeclineOpen(false);
      setDeclineReason('');
      await load(selected.id);
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setChangeBusy(false);
    }
  };

  const toggleBulk = (id) => {
    const next = new Set(bulkIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setBulkIds(next);
  };
  const selectedRows = bookings.filter((booking) => bulkIds.has(booking.id));
  const selectedPending = selectedRows.filter((booking) => booking.status === 'pending').map((booking) => booking.id);
  const canBulkApprove = selectedPending.length === bulkIds.size && bulkIds.size > 0;
  const canBulkReject = selectedPending.length > 0;

  const bulkApprove = async () => {
    if (!canBulkApprove || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = await api.adminBulkUpdateBookings({ ids: selectedPending, status: 'confirmed' });
      push(content.bookings_approved.replace('{count}', String(result.updated)).replace('{s}', result.updated === 1 ? '' : 's'), 'success');
      if (result.skipped > 0) push(content.bookings_skipped.replace('{count}', String(result.skipped)), 'info');
      setBulkIds(new Set());
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkReject = async () => {
    if (!selectedPending.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = await api.adminBulkUpdateBookings({ ids: selectedPending, status: 'rejected', reason: bulkReason.trim() });
      push(content.bookings_rejected.replace('{count}', String(result.updated)).replace('{s}', result.updated === 1 ? '' : 's'), 'success');
      if (result.skipped > 0) push(content.bookings_skipped.replace('{count}', String(result.skipped)), 'info');
      setBulkRejectOpen(false);
      setBulkReason('');
      setBulkIds(new Set());
      await load();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const exportCsv = () => {
    if (!sorted.length) return;
    downloadCsv(`rove-bookings-${todayISO()}.csv`, [
      ['Code', 'Customer', 'Email', 'Phone', 'Vehicle', 'Pick-up', 'Drop-off', 'From', 'To', 'Days', 'Plan', 'Total', 'Paid', 'Balance', 'Credit due', 'Promo', 'Tax rate (%)', 'Tax amount', 'Km/day', 'Extra km rate', 'Km driven', 'Excess km', 'Excess km fee', 'Km waived', 'Deposit charges', 'Deposit refunded', 'Payment', 'Status', 'Created'],
      ...sorted.map((booking) => {
        const driven = kmDriven(
          { odometer: booking.pickupOdometer ?? booking.pickupInspection?.odometer ?? null },
          { odometer: booking.returnOdometer ?? booking.inspection?.odometer ?? null },
        );
        const settlement = booking.depositSettlement ?? null;
        return [
          booking.code,
          booking.customer?.name || 'Guest',
          booking.customer?.email,
          booking.driver?.phone || booking.customer?.phone,
          booking.vehicle?.name,
          booking.pickupLocation,
          booking.dropoffLocation,
          booking.startDate,
          booking.endDate,
          booking.days,
          booking.paymentPlan,
          booking.total,
          booking.amountPaid,
          ['cancelled', 'rejected'].includes(booking.status) ? 0 : booking.balanceDue,
          booking.creditDue,
          booking.promoCode || '',
          booking.taxRate ? Number(booking.taxRate) : '',
          booking.fees,
          booking.kmCap > 0 ? booking.kmCap : 'Unlimited',
          booking.kmCap > 0 ? booking.kmExtraRate : '',
          driven ?? '',
          settlement?.excessKm ?? '',
          settlement?.excessKmFee ?? '',
          settlement?.kmWaived ? 'Yes' : '',
          settlement?.charges ?? '',
          settlement?.refundDue ?? '',
          bookingPaymentState(booking),
          booking.status,
          localDay(booking.createdAt),
        ];
      }),
    ]);
    push(content.bookings_exported.replace('{count}', String(sorted.length)).replace('{s}', sorted.length === 1 ? '' : 's'), 'success');
  };

  const transitions = selected ? ALLOWED_TRANSITIONS[selected.status] || [] : [];
  const hubs = useMemo(() => {
    const names = meta.locations.map((location) => location.name);
    [selected?.pickupLocation, selected?.dropoffLocation].filter(Boolean).forEach((name) => {
      if (!names.includes(name)) names.unshift(name);
    });
    return names;
  }, [meta.locations, selected]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Bookings</h1>
          <p className="mt-1 text-xs text-muted">Approve, modify, complete or refund any rental.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
              className={`rounded-full border px-2.5 py-1.5 text-[0.62rem] font-bold capitalize transition ${statusFilter === status ? 'border-ink bg-ink text-cream' : 'border-line bg-white text-ink hover:border-ink'}`}
            >
              {status}
            </button>
          ))}
          {pendingChanges > 0 && (
            <button
              type="button"
              onClick={() => setChangeFilter((current) => !current)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[0.62rem] font-bold transition ${changeFilter ? 'border-sun bg-sun text-ink' : 'border-sun/40 bg-sun/10 text-ink hover:border-sun'}`}
              aria-pressed={changeFilter}
            >
              <CalendarRange className="h-3 w-3" /> {content.amend_staff_chip} · {pendingChanges}
            </button>
          )}
          {overduePickups > 0 && (
            <button
              type="button"
              onClick={() => setOverdueFilter((current) => !current)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[0.62rem] font-bold transition ${overdueFilter ? 'border-coral bg-coral text-ink' : 'border-coral/40 bg-coral/10 text-ink hover:border-coral'}`}
              aria-pressed={overdueFilter}
            >
              <CalendarDays className="h-3 w-3" /> {content.bookings_overdue_chip} · {overduePickups}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search code, customer, car"
          label="Search bookings"
          className="min-w-[13rem] flex-1"
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="field w-auto">
          <option value="">All statuses</option>
          {BOOKING_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button type="button" onClick={exportCsv} disabled={!sorted.length} className="btn btn-white btn-sm shrink-0">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
        <span className="hidden text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-muted sm:inline">Pick-up window</span>
        {quicks.map((quick) => (
          <button
            key={quick.label}
            type="button"
            onClick={quick.apply}
            className={`rounded-full border px-2.5 py-1.5 text-[0.62rem] font-bold capitalize transition ${dateFrom || dateTo ? 'border-line bg-white text-ink hover:border-ink' : ''}`}
          >
            {quick.label}
          </button>
        ))}
        <input
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className="field w-auto"
          aria-label="Pick-up on or after"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className="field w-auto"
          aria-label="Pick-up on or before"
        />
        <span className={`badge border ${filtered.length ? 'bg-lime/20 text-ink' : 'bg-stone-100 text-stone-600'}`} title="Bookings shown after search, status and date window">
          {filtered.length} shown
        </span>
        {(dateFrom || dateTo) && (
          <button type="button" onClick={() => setWindow('', '')} className="text-[0.62rem] font-bold text-rose-700 underline underline-offset-4">
            Clear dates
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-16 animate-pulse rounded-2xl bg-stone-200/70" />)}</div>
      ) : loadError && !bookings.length ? (
        <LoadError title="Bookings could not load" message={loadError} hint="Your filters are untouched — retry to reload the live booking list." onRetry={() => load()} />
      ) : filtered.length ? (
        <>
          {bulkIds.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-2.5 text-[0.72rem]">
              <span className="inline-flex min-w-0 items-center gap-1.5 font-extrabold">
                <Check className="h-3.5 w-3.5 shrink-0 text-forest" /> {bulkIds.size} selected
                <span className="max-w-[22rem] truncate font-mono text-[0.64rem] font-semibold text-muted" title={selectedRows.map((booking) => booking.code).join(', ')}>
                  {selectedRows.slice(0, 4).map((booking) => booking.code).join(', ')}{selectedRows.length > 4 ? ` +${selectedRows.length - 4}` : ''}
                </span>
              </span>
              <button type="button" onClick={bulkApprove} disabled={!canBulkApprove || bulkBusy} title={canBulkApprove ? '' : 'Only pending bookings can be approved in bulk.'} className="btn btn-lime btn-sm shrink-0">Approve pending</button>
              <button type="button" onClick={() => { setBulkReason(''); setBulkRejectOpen(true); }} disabled={!canBulkReject || bulkBusy} className="btn btn-ghost btn-sm shrink-0 text-rose-700">Reject pending ({selectedPending.length})</button>
              <button type="button" onClick={() => setBulkIds(new Set())} disabled={bulkBusy} className="ml-auto text-[0.66rem] font-bold text-muted underline underline-offset-4">Clear</button>
            </div>
          )}
          <TableScrollHint className="mt-3" />
          <div className="table-wrap" role="region" aria-label="Bookings table" tabIndex={0}>
            <table className="data-table">
            <thead>
              <tr>
                <th className="w-9">
                  <input
                    type="checkbox"
                    aria-label="Select all bookings on this page"
                    checked={pageRows.length > 0 && pageRows.every((booking) => bulkIds.has(booking.id))}
                    onChange={(event) => {
                      const next = new Set(bulkIds);
                      pageRows.forEach((booking) => {
                        if (event.target.checked) next.add(booking.id);
                        else next.delete(booking.id);
                      });
                      setBulkIds(next);
                    }}
                  />
                </th>
                <SortableHeader label="Code" column="code" sort={columnSort} onSort={toggleSort} />
                <SortableHeader label="Customer" column="customer" sort={columnSort} onSort={toggleSort} />
                <SortableHeader label="Vehicle" column="vehicle" sort={columnSort} onSort={toggleSort} />
                <SortableHeader label="Dates" column="dates" sort={columnSort} onSort={toggleSort} />
                <SortableHeader label="Total" column="total" sort={columnSort} onSort={toggleSort} align="right" />
                <SortableHeader label="Payment" column="payment" sort={columnSort} onSort={toggleSort} />
                <th>Status</th><th /></tr>
            </thead>
            <tbody>
              {pageRows.map((booking) => (
                <tr
                  key={booking.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setSelectedId(booking.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(booking.id);
                    }
                  }}
                  aria-label={`Open booking ${booking.code}`}
                >
                  <td className="w-9">
                    <input
                      type="checkbox"
                      className="cursor-pointer"
                      checked={bulkIds.has(booking.id)}
                      onChange={(event) => {
                        event.stopPropagation();
                        toggleBulk(booking.id);
                      }}
                      aria-label={`Select ${booking.code}`}
                    />
                  </td>
                  <td className="flex items-center gap-1.5 font-mono text-[0.68rem] font-bold whitespace-nowrap">
                    {booking.code}
                    <CopyButton text={booking.code} className="shrink-0" />
                  </td>
                  <td>
                    <p className="font-semibold">{booking.customer?.name || 'Guest'}</p>
                    <p className="text-[0.62rem] text-muted">{booking.customer?.email}</p>
                  </td>
                  <td className="max-w-[11rem] truncate">
                    <Tooltip content={booking.vehicle?.name || 'Vehicle removed'} side="bottom">
                      <span className="block truncate">{booking.vehicle?.name || 'Vehicle removed'}</span>
                    </Tooltip>
                  </td>
                  <td className="whitespace-nowrap text-[0.68rem] text-muted">
                    <Tooltip content={`Pick-up ${timeLabel(booking.pickupTime || '10:00')} · Drop-off ${timeLabel(booking.dropoffTime || '10:00')}`} side="bottom">
                      <span className="whitespace-nowrap">{longDate(booking.startDate)} → {longDate(booking.endDate)}</span>
                    </Tooltip>
                  </td>
                  <td className="text-right font-bold">{inr(booking.total)}</td>
                  <td><StatusPill status={bookingPaymentState(booking)} /></td>
                  <td><StatusPill status={booking.status} /></td>
                  <td className="text-right">
                    {booking.status === 'active' && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExtendOpen(true);
                          setSelectedId(booking.id);
                        }}
                        className="ml-auto rounded-lg p-1.5 text-muted transition hover:bg-stone-100 hover:text-moss"
                        aria-label={`Extend return on ${booking.code}`}
                        title={content.extend_extension_chip}
                      >
                        <Clock className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {booking.status === 'active' && booking.endDate < todayISO() && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          remindBooking(booking);
                        }}
                        disabled={remindingId === booking.id}
                        className="ml-auto rounded-lg p-1.5 text-muted transition hover:bg-stone-100 hover:text-ink"
                        aria-label={content.return_remind_aria}
                        title={content.return_remind}
                      >
                        <Bell className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedId(booking.id);
                      }}
                      className="ml-auto rounded-lg p-1.5 text-muted transition hover:bg-stone-100 hover:text-ink"
                      aria-label={`Open booking ${booking.code}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPage={pagination.setPage}
            size={pagination.size}
            onSizeChange={pagination.setSize}
            label={`Showing ${pagination.start + 1}–${pagination.end} of ${pagination.total}`}
            className="mt-3"
          />
        </>
      ) : (
        <EmptyState icon={CalendarDays} title="No bookings match" description="Try a different search or status filter." />
      )}

      <Drawer
        open={Boolean(selected)}
        onClose={requestClose}
        title={selected ? `Booking ${selected.code}` : 'Booking'}
        description={selected ? `${selected.customer?.name || 'Guest'} · ${longDate(selected.startDate)} → ${longDate(selected.endDate)}` : ''}
        width="max-w-2xl"
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={selected.status} />
              <StatusPill status={bookingPaymentState(selected)} />
              <span className="font-mono font-extrabold text-muted">{selected.code}</span>
              <CopyButton text={selected.code} />
              <span className="text-[0.62rem] text-muted">Created {longDate(selected.createdAt)}</span>
              <Link to={`/confirmation/${selected.code}`} className="inline-flex items-center gap-1 text-[0.66rem] font-bold text-forest transition hover:text-ink">
                <ExternalLink className="h-3.5 w-3.5" /> View customer voucher
              </Link>
            </div>

            {selected.changeRequest?.status === 'pending' && (
              <section className="rounded-2xl border border-sun/40 bg-sun/10 p-4">
                <p className="flex items-center gap-2 text-sm font-extrabold text-ink">
                  <CalendarRange className="h-4 w-4" /> {content.amend_pending} · {selected.code}
                </p>
                <div className="mt-2 grid gap-2 text-[0.7rem] sm:grid-cols-2">
                  <p className="text-muted">{content.amend_staff_request_dates}: <span className="font-semibold text-ink">{longDate(selected.changeRequest.startDate)} → {longDate(selected.changeRequest.endDate)}</span></p>
                  <p className="text-muted">{timeLabel(selected.changeRequest.pickupTime)} → {timeLabel(selected.changeRequest.dropoffTime)}</p>
                  <p className="text-muted">{content.amend_staff_request_hubs}: <span className="font-semibold text-ink">{selected.changeRequest.pickupLocation} → {selected.changeRequest.dropoffLocation}</span></p>
                  <p className="text-muted">{content.amend_staff_proposed_total}: <span className="font-semibold text-ink">{inr(selected.changeRequest.total)}</span></p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={approveChange} disabled={changeBusy} className="btn btn-lime btn-sm">
                    <Check className="h-3.5 w-3.5" /> {content.amend_staff_approve}
                  </button>
                  <button type="button" onClick={() => { setDeclineReason(''); setDeclineOpen(true); }} disabled={changeBusy} className="btn btn-ghost btn-sm">
                    <X className="h-3.5 w-3.5" /> {content.amend_staff_decline}
                  </button>
                </div>
              </section>
            )}

            {selected.tripChanges?.length > 0 && (
              <section className="rounded-2xl border border-line bg-paper p-4">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">{content.amend_staff_history}</p>
                <ul className="mt-2 space-y-2 text-[0.7rem]">
                  {selected.tripChanges.map((change, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Check className="h-3.5 w-3.5 shrink-0 text-forest" />
                      <span className="min-w-0 flex-1">{change.summary}</span>
                      {Number(change.delta) > 0 && <span className="shrink-0 font-bold text-forest">+{inr(change.delta)}</span>}
                      <span className="shrink-0 text-muted">{change.by} · {longDate(change.at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Booking status activity timeline — shows every milestone we know
                about so staff can see the full journey at a glance instead of
                just the current status. */}
            <section className="rounded-2xl border border-line bg-paper p-4">
              <p className="flex items-center gap-1.5 text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">
                <CalendarDays className="h-3.5 w-3.5 text-forest" /> Activity
              </p>
              <div className="relative mt-3 pl-4 before:absolute before:left-[0.35rem] before:top-1.5 before:h-[calc(100%-0.75rem)] before:w-0.5 before:rounded-full before:bg-line/70">
                {(() => {
                  // Build a timeline from the booking's available dates. Every
                  // row is a distinct milestone: created, each status transition,
                  // and final terminal states (cancelled, completed).
                  const milestones = [];
                  if (selected.createdAt) milestones.push({ label: 'Created', date: selected.createdAt, tone: 'bg-aqua border-aqua-400' });

                  // If the change request is pending, add it as a milestone.
                  if (selected.changeRequest?.status === 'pending' && selected.changeRequest.requestedAt) {
                    milestones.push({ label: 'Change requested', date: selected.changeRequest.requestedAt, tone: 'bg-sun/50 border-sun-400' });
                  }

                  // Trip changes (extensions, date changes) each get a milestone.
                  (selected.tripChanges ?? []).forEach((change) => {
                    milestones.push({ label: change.type === 'extension' ? 'Trip extended' : 'Dates changed', date: change.at, tone: 'bg-aqua/30 border-aqua-400' });
                  });

                  // If the booking was cancelled, add that.
                  if (selected.cancelledAt) {
                    milestones.push({ label: 'Cancelled', date: selected.cancelledAt, tone: 'bg-coral/15 border-coral-400', note: selected.cancellationReason ? `Reason: ${selected.cancellationReason}` : '' });
                  }

                  // If the booking is completed, add that.
                  if (selected.completedAt) {
                    milestones.push({ label: 'Completed', date: selected.completedAt, tone: 'bg-forest/20 border-forest-400' });
                  }

                  // Always show the current status as the latest milestone if
                  // it isn't already covered by a terminal state.
                  const terminal = ['cancelled', 'rejected', 'completed', 'refunded'];
                  if (!terminal.includes(selected.status) && (selected.updatedAt || selected.createdAt)) {
                    const meta = statusMeta[selected.status] ?? {};
                    milestones.push({ label: selected.status, date: selected.updatedAt || selected.createdAt, tone: meta?.tone || 'bg-ink border-ink', note: selected.cancellationReason ? `Reason: ${selected.cancellationReason}` : '' });
                  }

                  // Sort by date ascending.
                  milestones.sort((a, b) => String(a.date).localeCompare(String(b.date)));

                  return milestones.length
                    ? milestones.map((entry, index) => {
                        const isLast = index === milestones.length - 1;
                        return (
                          <div key={index} className={`relative pb-4 ${isLast ? 'last:pb-0' : ''}`}>
                            <span className={cn('absolute -left-[0.9rem] top-1 h-3 w-3 rounded-full border-2', entry.tone)} />
                            <p className="text-[0.72rem] font-extrabold capitalize">{entry.label}</p>
                            <p className="mt-0.5 text-[0.6rem] text-muted">{longDate(entry.date)}</p>
                            {entry.note && <p className="mt-0.5 text-[0.6rem] text-ink/70">{entry.note}</p>}
                          </div>
                        );
                      })
                    : <p className="text-[0.62rem] text-muted">No activity recorded</p>;
                })()}
              </div>
              {selected.createdAt && (
                <div className="flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1 text-[0.55rem] text-muted">
                  <CalendarDays className="h-3 w-3" /> Booking ID: <span className="font-mono font-bold text-ink">{selected.id || selected.code}</span>
                  · Created {longDate(selected.createdAt)}
                  {selected.updatedAt && selected.updatedAt !== selected.createdAt && (
                    <> · Updated {longDate(selected.updatedAt)}</>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-line p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Rental</p>
                {selected.vehicle?.type && <span className="chip text-[0.56rem]">{selected.vehicle.brand ? `${selected.vehicle.brand} · ` : ''}{selected.vehicle.type}</span>}
              </div>
              <p className="mt-1 text-sm font-extrabold">{selected.vehicle?.name || 'Vehicle removed'}</p>
              <div className="mt-2 grid gap-2 text-[0.7rem] sm:grid-cols-2">
                <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted" /> {longDate(selected.startDate)} · {timeLabel(selected.pickupTime)}</p>
                <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-muted" /> {longDate(selected.endDate)} · {timeLabel(selected.dropoffTime)}</p>
                <p className="text-muted">Pick-up: <span className="font-semibold text-ink">{selected.pickupLocation}</span></p>
                <p className="text-muted">Drop-off: <span className="font-semibold text-ink">{selected.dropoffLocation}</span></p>
              </div>
              <div className="mt-3 grid gap-2 rounded-xl bg-paper p-3 text-[0.68rem] sm:grid-cols-2">
                <p className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-muted" /> {selected.driver?.name || selected.customer?.name}</p>
                <p className="text-muted">Licence {selected.driver?.license || '—'}</p>
                {selected.driver?.dob && <p className="text-muted">DOB {selected.driver.dob}</p>}
                <p className="text-muted">{selected.driver?.email || selected.customer?.email}</p>
                <p className="text-muted">{selected.driver?.phone || selected.customer?.phone}</p>
              </div>
              {selected.promoCode && (
                <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-white/70 px-3 py-1.5 text-[0.64rem]">
                  <Sparkles className="h-3.5 w-3.5 text-forest" />
                  <span className="text-muted">Promo: <span className="font-mono font-bold text-forest">{selected.promoCode}</span></span>
                </div>
              )}
              {selected.extras?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">{selected.extras.map((extra) => <span key={extra.key} className="chip">{extra.label}</span>)}</div>
              )}
            </section>

            {customerMoney && (customerMoney.outstanding > 0 || customerMoney.creditDue > 0 || customerMoney.depositsHeld > 0 || customerMoney.awaiting > 0) && (
              <section className="rounded-2xl border border-line bg-paper/60 p-4">
                <p className="flex items-center gap-1.5 text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">
                  <ShieldCheck className="h-3.5 w-3.5 text-forest" /> {content.bookings_customer_money}
                </p>
                <p className="mt-1 text-[0.6rem] text-muted">{content.bookings_money_note}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {customerMoney.outstanding > 0 && (
                    <div className="rounded-xl border border-coral/30 bg-coral/10 p-2.5">
                      <p className="text-[0.54rem] font-extrabold uppercase tracking-wider text-muted">{content.bookings_money_outstanding}</p>
                      <p className="mt-0.5 text-sm font-extrabold text-coral">{inr(customerMoney.outstanding)}</p>
                    </div>
                  )}
                  {customerMoney.creditDue > 0 && (
                    <div className="rounded-xl border border-line bg-white p-2.5">
                      <p className="text-[0.54rem] font-extrabold uppercase tracking-wider text-muted">{content.bookings_money_credit}</p>
                      <p className="mt-0.5 text-sm font-extrabold text-forest">{inr(customerMoney.creditDue)}</p>
                    </div>
                  )}
                  {customerMoney.depositsHeld > 0 && (
                    <div className="rounded-xl border border-line bg-white p-2.5">
                      <p className="text-[0.54rem] font-extrabold uppercase tracking-wider text-muted">{content.bookings_money_deposits}</p>
                      <p className="mt-0.5 text-sm font-extrabold">{inr(customerMoney.depositsHeld)}</p>
                      {customerMoney.awaiting > 0 && (
                        <p className="mt-0.5 text-[0.56rem] font-semibold text-amber-800">
                          {content.bookings_money_awaiting.replace('{count}', String(customerMoney.awaiting)).replace('{amount}', inr(customerMoney.awaitingAmount))}
                        </p>
                      )}
                    </div>
                  )}
                  {customerMoney.awaiting > 0 && (
                    <Link to="/admin/desk?tab=returns" className="btn btn-ghost btn-sm items-start">
                      <ArrowRight className="h-3.5 w-3.5" /> {content.bookings_money_settle}
                    </Link>
                  )}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-line p-4">
              <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Pick-up &amp; drop-off</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="admin-pickup-hub">Pick-up hub</label>
                  <select
                    id="admin-pickup-hub"
                    value={trip.pickupLocation}
                    onChange={(event) => setTrip((current) => ({ ...current, pickupLocation: event.target.value }))}
                    className="field"
                  >
                    <option value="">Choose a hub</option>
                    {hubs.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="admin-pickup-time">Pick-up time</label>
                  <select
                    id="admin-pickup-time"
                    value={trip.pickupTime}
                    onChange={(event) => setTrip((current) => ({ ...current, pickupTime: event.target.value }))}
                    className="field"
                  >
                    {RENTAL_TIMES.map((time) => <option key={time} value={time}>{timeLabel(time)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="admin-dropoff-hub">Drop-off hub</label>
                  <select
                    id="admin-dropoff-hub"
                    value={trip.dropoffLocation}
                    onChange={(event) => setTrip((current) => ({ ...current, dropoffLocation: event.target.value }))}
                    className="field"
                  >
                    <option value="">Choose a hub</option>
                    {hubs.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="admin-dropoff-time">Drop-off time</label>
                  <select
                    id="admin-dropoff-time"
                    value={trip.dropoffTime}
                    onChange={(event) => setTrip((current) => ({ ...current, dropoffTime: event.target.value }))}
                    className="field"
                  >
                    {RENTAL_TIMES.map((time) => <option key={time} value={time}>{timeLabel(time)}</option>)}
                  </select>
                </div>
              </div>
              <button type="button" onClick={saveTrip} disabled={saving} className="btn btn-dark btn-sm mt-2 w-full">Save hubs &amp; times</button>
              <p className="mt-2 text-[0.6rem] leading-4 text-muted">Changing hubs re-prices the one-way fee; changing dates re-checks availability and recalculates tax.</p>
            </section>

            <section className="rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Price breakdown</p>
                <span className="text-[0.6rem] font-bold text-muted">{selected.paymentPlan === 'deposit' ? 'Deposit plan' : 'Full payment plan'}</span>
              </div>
              <div className="mt-2 divide-y divide-line text-[0.7rem]">
                <div className="flex items-center justify-between px-3 py-1.5"><span className="text-muted">Rental base · {selected.days} day{selected.days === 1 ? '' : 's'}</span><span className="font-semibold">{inr(selected.baseTotal)}</span></div>
                {selected.extrasTotal > 0 && <div className="flex items-center justify-between px-3 py-1.5"><span className="text-muted">Add-ons</span><span className="font-semibold">{inr(selected.extrasTotal)}</span></div>}
                {selected.insuranceTotal > 0 && <div className="flex items-center justify-between px-3 py-1.5"><span className="text-muted">{selected.insurance?.label || 'Protection'}</span><span className="font-semibold">{inr(selected.insuranceTotal)}</span></div>}
                {selected.oneWayFee > 0 && <div className="flex items-center justify-between px-3 py-1.5"><span className="text-muted">One-way fee</span><span className="font-semibold">{inr(selected.oneWayFee)}</span></div>}
                {selected.discount > 0 && <div className="flex items-center justify-between px-3 py-1.5 text-forest"><span className="text-muted">Promo {selected.promoCode ? <span className="font-mono">{selected.promoCode}</span> : null}</span><span className="font-semibold">−{inr(selected.discount)}</span></div>}
                <div className="flex items-center justify-between px-3 py-1.5"><span className="text-muted">Tax{selected.taxRate ? ` (${Number(selected.taxRate) || 0}%)` : ''}{selected.taxInclusive ? ' · included' : ''}</span><span className="font-semibold">{inr(selected.fees)}</span></div>
                <div className="flex items-center justify-between px-3 py-1.5 font-extrabold"><span>Total</span><span>{inr(selected.total)}</span></div>
              </div>
            </section>

            <section className="rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Payment</p>
                <CreditCard className="h-4 w-4 text-muted" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[0.72rem] sm:grid-cols-4">
                <div><p className="text-muted">Total</p><p className="font-extrabold">{inr(selected.total)}</p></div>
                <div><p className="text-muted">Paid</p><p className="font-extrabold">{inr(selected.amountPaid)}</p></div>
                <div><p className="text-muted">Balance</p><p className="font-extrabold">{inr(['cancelled', 'rejected'].includes(selected.status) ? 0 : selected.balanceDue)}</p></div>
                <div><p className="text-muted">Plan</p><p className="font-extrabold capitalize">{selected.paymentPlan}</p></div>
              </div>
              {Number(selected.balanceDue) > 0 && ['confirmed', 'active', 'completed'].includes(selected.status) && (
                <button type="button" onClick={() => setPaymentForm({ amount: selected.balanceDue, method: 'cash', reference: '' })} disabled={saving} className="btn btn-outline btn-sm mt-2 w-full">
                  <HandCoins className="h-3.5 w-3.5" /> Record payment
                </button>
              )}
              {Number(selected.creditDue) > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[0.66rem]">
                  <div>
                    <p className="font-extrabold text-amber-900">Customer credit {inr(selected.creditDue)}</p>
                    <p className="text-amber-800">Paid above the current total after a change. Refund the difference to close it.</p>
                  </div>
                  <button type="button" onClick={refundCredit} disabled={saving} className="btn btn-outline btn-sm">
                    {saving ? 'Refunding…' : `Refund ${inr(selected.creditDue)}`}
                  </button>
                </div>
              )}
              {Number(selected.holdAmount) > 0 && !['cancelled', 'rejected'].includes(selected.status) && (
                <div className="mt-2 space-y-1 rounded-xl bg-paper px-3 py-2 text-[0.66rem]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Refundable security deposit</span>
                    <span className="font-bold text-ink">{inr(selected.holdAmount)}</span>
                  </div>
                  {selected.depositSettlement && (
                    <div className="flex items-center justify-between border-t border-line pt-1">
                      <span className="text-muted">
                        {selected.depositSettlement.label || 'Settled'}
                        {selected.depositSettlement.charges ? ` · ${inr(selected.depositSettlement.charges)} deducted` : ''}
                      </span>
                      <span className="font-extrabold text-forest">{inr(selected.depositSettlement.refundDue)} refunded</span>
                    </div>
                  )}
                </div>
              )}
              {(() => {
                const km = kmDisclosure({
                  kmCap: selected.kmCap ?? selected.vehicle?.kmCap,
                  kmExtraRate: selected.kmExtraRate ?? selected.vehicle?.kmExtraRate,
                });
                if (!km.limited || ['cancelled', 'rejected'].includes(selected.status)) return null;
                return (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2 text-[0.66rem]">
                    <span className="text-muted">Kilometre allowance</span>
                    <span className="text-right font-bold text-ink">
                      {km.kmCap.toLocaleString('en-IN')} km/day · {inr(km.kmExtraRate)}/extra km
                    </span>
                  </div>
                );
              })()}
              {selected.pickupInspection && (
                <div className="mt-2 rounded-xl border border-line bg-paper/70 px-3 py-2 text-[0.64rem]">
                  <p className="font-extrabold text-muted">Condition at pick-up</p>
                  <p className="mt-0.5 font-semibold text-ink">{inspectionLine(selected.pickupInspection)}</p>
                  {(() => {
                    const driven = kmDriven(
                      { odometer: selected.pickupOdometer ?? selected.pickupInspection.odometer },
                      { odometer: selected.returnOdometer },
                    );
                    const km = excessKm({
                      driven,
                      kmCap: selected.kmCap ?? selected.vehicle?.kmCap,
                      kmExtraRate: selected.kmExtraRate ?? selected.vehicle?.kmExtraRate,
                      startDate: selected.startDate,
                      endDate: selected.endDate,
                      days: selected.days,
                    });
                    return (
                      <>
                        {driven !== null && (
                          <p className="mt-0.5 text-muted">
                            Returned at {Number(selected.returnOdometer).toLocaleString('en-IN')} km · {driven.toLocaleString('en-IN')} km driven
                          </p>
                        )}
                        {km.limited && (
                          <p className="mt-0.5 text-muted">
                            Allowance {km.allowance.toLocaleString('en-IN')} km
                            {driven === null
                              ? ' · not measured yet'
                              : km.excess > 0
                                ? ` · ${km.excess.toLocaleString('en-IN')} km over`
                                : ' · within allowance'}
                            {Number(selected.depositSettlement?.excessKmFee) > 0
                              ? ` · ${inr(selected.depositSettlement.excessKmFee)} charged`
                              : selected.depositSettlement?.kmWaived
                                ? ' · fee waived'
                                : ''}
                          </p>
                        )}
                      </>
                    );
                  })()}
                  {selected.pickupInspection.note && (
                    <p className="mt-0.5 text-muted">{selected.pickupInspection.note}</p>
                  )}
                </div>
              )}
              {selected.payments?.length > 0 && (
                <div className="mt-3 divide-y divide-line rounded-xl border border-line">
                  {selected.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[0.66rem]">
                      <span>{paymentLabel[payment.kind] || payment.kind}{payment.kind !== 'hold' && payment.last4 ? ` · •••• ${payment.last4}` : ''}</span>
                      <span className="text-muted">{payment.kind === 'hold' && payment.status === 'authorized' && selected.status === 'completed' ? 'Settled after drop-off' : paymentStatusLabel[payment.status] || payment.status}</span>
                      <span className="font-bold">{inr(payment.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {selected.amountPaid > 0 && (
                <button type="button" onClick={() => setRefundOpen(true)} className="btn btn-outline btn-sm mt-3 w-full"><RotateCcw className="h-3.5 w-3.5" /> Refund {inr(selected.amountPaid)}</button>
              )}
            </section>

            <section className="rounded-2xl border border-line p-4">
              <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Modify dates</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="date" value={dates.startDate} onChange={(event) => setDates((current) => ({ ...current, startDate: event.target.value }))} className="field" aria-label="Start date" />
                <input type="date" value={dates.endDate} onChange={(event) => setDates((current) => ({ ...current, endDate: event.target.value }))} className="field" aria-label="End date" />
              </div>
              <button type="button" onClick={saveDates} disabled={saving} className="btn btn-dark btn-sm mt-2 w-full">Recalculate & save dates</button>
              {selected.status === 'active' && (
                <button
                  type="button"
                  onClick={() => setExtendOpen((current) => !current)}
                  className={cn('btn btn-outline btn-sm mt-1.5 w-full', extendOpen && 'border-moss text-moss')}
                >
                  <Clock className="h-3.5 w-3.5" /> {content.extend_extension_chip}
                </button>
              )}
              {extendOpen && selected.status === 'active' && (
                <ExtendReturnForm
                  booking={selected}
                  onApplied={() => { setExtendOpen(false); load(selected.id); }}
                  onClose={() => setExtendOpen(false)}
                />
              )}
            </section>

            <section>
              <label className="label" htmlFor="admin-notes">{content.bookings_notes_label}</label>
              <textarea id="admin-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="field resize-none" maxLength={600} placeholder={content.bookings_notes_placeholder} />
              <button type="button" onClick={() => update({ notes }, content.bookings_notes_saved)} disabled={saving} className="btn btn-white btn-sm mt-2">{content.bookings_notes_save}</button>
            </section>

            {transitions.length > 0 && (
              <section className="rounded-2xl border border-line bg-paper p-4">
                <p className="text-[0.62rem] font-extrabold uppercase tracking-wider text-muted">Status actions</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {transitions.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => transition(status)}
                      disabled={saving}
                      className={`btn btn-sm ${status === 'cancelled' || status === 'rejected' ? 'btn-outline text-rose-700' : status === 'completed' ? 'btn-white' : 'btn-dark'}`}
                    >
                      {STATUS_LABELS[status] || status}
                    </button>
                  ))}
                </div>
                {(transitions.includes('cancelled') || transitions.includes('rejected')) && (
                  <div className="mt-3">
                    <label className="label" htmlFor="admin-cancel-reason">Cancellation reason</label>
                    <input
                      id="admin-cancel-reason"
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      className="field"
                      maxLength={240}
                      placeholder="Shown on the customer voucher (optional)"
                    />
                  </div>
                )}
                {transitions.includes('cancelled') && selected.amountPaid > 0 && (
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-[0.68rem] font-semibold">
                    <input type="checkbox" checked={refundOnCancel} onChange={(event) => setRefundOnCancel(event.target.checked)} className="h-4 w-4 rounded border-stone-300 accent-ink" />
                    Refund {inr(selected.amountPaid)} when cancelling
                  </label>
                )}
                <p className="mt-2 flex items-start gap-1.5 text-[0.6rem] leading-4 text-muted">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> Status changes are logged. Refunds are sent to the original payment method.
                </p>
              </section>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title={content.drawer_discard_title} description={content.drawer_discard_copy} size="sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { setConfirmDiscard(false); setSelectedId(null); }}
            className="btn btn-dark flex-1"
          >
            <X className="h-4 w-4" /> {content.drawer_discard_confirm}
          </button>
          <button type="button" onClick={() => setConfirmDiscard(false)} className="btn btn-white flex-1">
            {content.drawer_discard_keep}
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmAction)}
        onClose={() => (saving ? null : setConfirmAction(null))}
        title={
          confirmAction?.status === 'cancelled'
            ? 'Cancel this booking?'
            : confirmAction?.status === 'rejected'
              ? 'Reject this booking?'
              : 'Mark this trip completed?'
        }
        description={selected ? `${selected.code} · ${selected.customer?.name || 'Guest'}` : ''}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmAction(null)} disabled={saving} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={applyTransition} disabled={saving} className="btn btn-dark flex-1">
              {saving ? 'Saving…' : confirmAction?.status === 'cancelled' ? 'Cancel booking' : confirmAction?.status === 'rejected' ? 'Reject booking' : 'Mark completed'}
            </button>
          </div>
        )}
      >
        {selected && confirmAction && (
          <div className="space-y-3 text-[0.76rem]">
            <p className="text-muted">
              {confirmAction.status === 'completed'
                ? 'This closes the rental. Use the Returns desk when you need to inspect the vehicle and settle the deposit.'
                : 'The customer is notified and the dates are released immediately.'}
            </p>
            <div className="rounded-2xl border border-line bg-paper/70 p-3">
              <p className="flex justify-between gap-3"><span className="text-muted">Vehicle</span><span className="font-bold">{selected.vehicle?.name || 'Vehicle removed'}</span></p>
              <p className="flex justify-between gap-3"><span className="text-muted">Dates</span><span className="font-bold">{longDate(selected.startDate)} → {longDate(selected.endDate)}</span></p>
              <p className="flex justify-between gap-3"><span className="text-muted">Paid</span><span className="font-bold">{inr(selected.amountPaid)}</span></p>
            </div>
            {confirmAction.refunding && (
              <p className="rounded-xl border border-coral/30 bg-coral/10 px-3 py-2 font-semibold text-ink">
                A refund of {inr(selected.amountPaid)} will be sent to the original payment method.
              </p>
            )}
            {['cancelled', 'rejected'].includes(confirmAction.status) && (
              <p className="text-[0.68rem] leading-5 text-muted">
                {cancelReason.trim() ? `Reason shown to the customer: “${cancelReason.trim()}”` : 'No reason entered. The customer will see the standard cancellation message.'}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(paymentForm)}
        onClose={() => (saving ? null : setPaymentForm(null))}
        title="Record a payment"
        description={selected ? `${selected.code} · ${inr(selected.balanceDue || 0)} balance` : undefined}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setPaymentForm(null)} disabled={saving} className="btn btn-white flex-1">Cancel</button>
            <button type="button" onClick={recordPayment} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Recording…' : 'Record payment'}</button>
          </div>
        )}
      >
        {paymentForm && (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="pay-amount">Amount (₹)</label>
              <input id="pay-amount" type="number" min="1" max={selected?.balanceDue || 999999} step="1" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} className="field" />
              <p className="mt-1 text-[0.62rem] text-muted">Up to the outstanding {inr(selected?.balanceDue || 0)}.</p>
            </div>
            <div>
              <label className="label" htmlFor="pay-method">Method</label>
              <select id="pay-method" value={paymentForm.method} onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value }))} className="field">
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card at desk</option>
                <option value="bank">Bank transfer</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="pay-reference">Reference (optional)</label>
              <input id="pay-reference" value={paymentForm.reference} onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))} maxLength={60} className="field" placeholder="Receipt no., UPI ID…" />
            </div>
            <p className="flex items-center gap-1.5 text-[0.62rem] text-muted"><HandCoins className="h-3.5 w-3.5 shrink-0 text-forest" /> This lands in the payment ledger and marks the invoice paid — ideal for cash or UPI collected at the desk.</p>
          </div>
        )}
      </Modal>

      <Modal
        open={refundOpen}
        onClose={() => (saving ? null : setRefundOpen(false))}
        title="Refund this booking?"
        description="The booking will be cancelled and the full captured amount returned to the original card."
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setRefundOpen(false)} disabled={saving} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={refund} disabled={saving} className="btn btn-dark flex-1">{saving ? 'Refunding…' : `Refund ${inr(selected?.amountPaid)}`}</button>
          </div>
        )}
      >
        <p className="text-sm text-muted">Booking <span className="font-mono font-bold text-ink">{selected?.code}</span> · {selected?.customer?.name}. This cannot be undone.</p>
      </Modal>

      <Modal
        open={declineOpen}
        onClose={() => (changeBusy ? null : setDeclineOpen(false))}
        title={content.amend_staff_decline}
        description={selected?.code}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setDeclineOpen(false)} disabled={changeBusy} className="btn btn-white flex-1">Keep it</button>
            <button type="button" onClick={declineChange} disabled={changeBusy} className="btn btn-dark flex-1">{changeBusy ? '…' : content.amend_staff_decline}</button>
          </div>
        )}
      >
        <label className="label" htmlFor="decline-reason">{content.amend_staff_reason_label}</label>
        <textarea id="decline-reason" rows={3} value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} className="field resize-none" maxLength={240} placeholder={content.amend_staff_reason_placeholder} />
        <p className="mt-2 text-[0.68rem] text-muted">The customer is told the reason when the request is declined.</p>
      </Modal>

      <Modal
        open={bulkRejectOpen}
        onClose={() => (bulkBusy ? null : setBulkRejectOpen(false))}
        title="Reject pending bookings?"
        description={`${selectedPending.length} pending booking${selectedPending.length === 1 ? '' : 's'} · ${selectedPending.map((id) => bookings.find((booking) => booking.id === id)?.code ?? id).join(', ')}`}
        size="sm"
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={() => setBulkRejectOpen(false)} disabled={bulkBusy} className="btn btn-white flex-1">Keep them</button>
            <button type="button" onClick={bulkReject} disabled={bulkBusy || !selectedPending.length} className="btn btn-dark flex-1">{bulkBusy ? 'Rejecting…' : `Reject ${selectedPending.length} pending`}</button>
          </div>
        )}
      >
        <label className="label" htmlFor="bulk-reject-reason">{content.amend_staff_reason_label}</label>
        <textarea id="bulk-reject-reason" rows={3} value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} className="field resize-none" maxLength={240} placeholder={content.amend_staff_reason_placeholder} />
        <p className="mt-2 text-[0.68rem] text-muted">Only pending bookings are rejected; other selected rows are left untouched. Each affected customer is notified with this reason. This cannot be undone.</p>
      </Modal>
    </div>
  );
}

const STATUSES = ['pending', 'confirmed', 'active', 'completed', 'cancelled', 'rejected'];
