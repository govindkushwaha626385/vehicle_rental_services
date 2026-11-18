import { useEffect, useRef, useState } from 'react';
import { Modal, Skeleton } from './ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { RENTAL_TIMES as TIMES, addDaysISO, todayISO } from '../lib/pricing.js';
import { inr, longDate, timeLabel } from '../lib/format.js';
import { getSiteContent, maxAdvanceDate } from '../lib/site.js';

/**
 * Self-serve "change my trip" modal. The customer picks new hubs/dates/times,
 * sees a live server-authenticated price delta, then files a change request
 * that only takes effect after staff approve it.
 */
export default function ChangeBookingModal({ booking, open, onClose, onChanged }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = getSiteContent(meta.settings);
  const policy = content.policy;

  const [values, setValues] = useState(() => ({
    startDate: addDaysISO(todayISO(), 7),
    endDate: addDaysISO(addDaysISO(todayISO(), 7), Math.max(policy.minDays, booking?.days || 3)),
    pickupTime: '10:00',
    dropoffTime: '10:00',
    pickupLocation: booking?.pickupLocation || meta.locations[0]?.name || '',
    dropoffLocation: booking?.dropoffLocation || meta.locations[0]?.name || '',
  }));

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const quoteRef = useRef(0);

  // Re-seed every time a booking opens. The old seedKey only ran once, so the
  // second booking a customer opened inherited the first booking's dates.
  useEffect(() => {
    if (!open || !booking) return undefined;
    const request = booking.changeRequest?.status === 'pending' ? booking.changeRequest : null;
    const startDate = request?.startDate || booking.startDate || addDaysISO(todayISO(), 7);
    setValues({
      startDate,
      endDate: request?.endDate || booking.endDate || addDaysISO(startDate, Math.max(policy.minDays, booking.days || 3)),
      pickupTime: request?.pickupTime || booking.pickupTime || '10:00',
      dropoffTime: request?.dropoffTime || booking.dropoffTime || '10:00',
      pickupLocation: request?.pickupLocation || booking.pickupLocation || meta.locations[0]?.name || '',
      dropoffLocation: request?.dropoffLocation || booking.dropoffLocation || meta.locations[0]?.name || '',
    });
    setPreview(null);
    setLoading(false);
    // Only re-seed when the modal opens or the booking identity changes, not
    // on every parent refresh while the customer is editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id]);

  const empty = !values.startDate || !values.endDate || !values.pickupLocation || !values.dropoffLocation;

  const refreshPreview = () => {
    if (empty || !booking) {
      quoteRef.current += 1;
      setPreview(null);
      setLoading(false);
      return;
    }
    const request = quoteRef.current + 1;
    quoteRef.current = request;
    setLoading(true);
    api.quote({
      // Demo bookings carry a top-level `vehicleId`; the Supabase booking
      // serializer only nests it under `vehicle.id`. Read both so the live
      // change preview works in either adapter.
      vehicleId: booking.vehicleId ?? booking.vehicle?.id,
      startDate: values.startDate,
      endDate: values.endDate,
      extras: booking.extraKeys ?? [],
      insurance: booking.insurance?.key ?? 'basic',
      promoCode: booking.promoCode || null,
      pickupLocation: values.pickupLocation,
      dropoffLocation: values.dropoffLocation,
      paymentPlan: booking.paymentPlan === 'deposit' ? 'deposit' : 'full',
      // The current booking must not make its own new dates look unavailable.
      excludeBookingId: booking.id,
    })
      .then((result) => {
        if (request === quoteRef.current) setPreview(result);
      })
      .catch((nextError) => {
        if (request === quoteRef.current) setPreview({ available: false, unavailableReason: nextError.message });
      })
      .finally(() => {
        if (request === quoteRef.current) setLoading(false);
      });
  };

  useEffect(() => {
    if (!open || !booking) return undefined;
    refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, values.startDate, values.endDate, values.pickupLocation, values.dropoffLocation, values.pickupTime, values.dropoffTime]);

  const set = (key, value) => setValues((current) => {
    const next = { ...current, [key]: value };
    if (key === 'startDate' && current.endDate <= value) {
      next.endDate = addDaysISO(value, Math.max(policy.minDays, 1));
    }
    return next;
  });

  const unchanged = Boolean(booking) && !empty
    && values.startDate === booking.startDate
    && values.endDate === booking.endDate
    && values.pickupLocation === booking.pickupLocation
    && values.dropoffLocation === booking.dropoffLocation
    && values.pickupTime === (booking.pickupTime || '10:00')
    && values.dropoffTime === (booking.dropoffTime || '10:00');

  const submit = async () => {
    if (empty || unchanged || !preview?.available || submitting) return;
    const minimumEnd = addDaysISO(values.startDate, policy.minDays);
    if (values.endDate < minimumEnd) {
      push(content.amend_dates_invalid
        .replace('{days}', String(policy.minDays))
        .replace('{s}', policy.minDays === 1 ? '' : 's'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitChangeRequest({
        bookingId: booking.id,
        startDate: values.startDate,
        endDate: values.endDate,
        pickupLocation: values.pickupLocation,
        dropoffLocation: values.dropoffLocation,
        pickupTime: values.pickupTime,
        dropoffTime: values.dropoffTime,
      });
      push(content.amend_sent, 'success');
      onChanged?.();
      onClose();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    try {
      await api.cancelChangeRequest({ bookingId: booking.id });
      push(content.amend_withdrawn, 'success');
      onChanged?.();
      onClose();
    } catch (error) {
      push(error.message, 'error');
    }
  };

  const pendingRequest = booking?.changeRequest?.status === 'pending';
  const total = Number(booking?.total) || 0;
  const requestDelta = pendingRequest ? (Number(booking.changeRequest.total) || 0) - total : 0;
  const previewTotal = Number(preview?.quote?.total) || 0;
  const delta = preview?.available ? previewTotal - total : 0;
  const deltaLabel = delta > 0
    ? content.amend_price_note_more.replace('{amount}', inr(delta))
    : delta < 0
      ? content.amend_price_note_less.replace('{amount}', inr(-delta))
      : content.amend_price_note_same;

  return (
    <Modal open={open && Boolean(booking)} onClose={() => (submitting ? null : onClose())} title={content.amend_title} description={booking?.vehicle?.name} size="md">
      {pendingRequest ? (
        <div className="rounded-2xl border border-sun/30 bg-sun/10 px-4 py-3 text-[0.8rem] text-ink">
          <p className="font-extrabold">{content.amend_pending}</p>
          <p className="mt-1 text-[0.7rem] leading-5 text-muted">{content.amend_pending_note}</p>
          <dl className="mt-3 grid gap-2 border-t border-sun/20 pt-3 text-[0.72rem] sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">{content.amend_pending_dates}</dt>
              <dd className="mt-0.5 font-semibold">{longDate(booking.changeRequest.startDate)} → {longDate(booking.changeRequest.endDate)}</dd>
            </div>
            <div>
              <dt className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">{content.amend_pending_times}</dt>
              <dd className="mt-0.5">{timeLabel(booking.changeRequest.pickupTime)} → {timeLabel(booking.changeRequest.dropoffTime)}</dd>
            </div>
            <div>
              <dt className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">{content.amend_pending_total}</dt>
              <dd className="mt-0.5 font-semibold">{inr(booking.changeRequest.total)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">{content.amend_pending_hubs}</dt>
              <dd className="mt-0.5">{booking.changeRequest.pickupLocation} → {booking.changeRequest.dropoffLocation}</dd>
            </div>
            {requestDelta !== 0 && (
              <div className="sm:col-span-2 text-[0.66rem] font-semibold text-forest">
                {(requestDelta > 0 ? content.amend_pending_delta_more : content.amend_pending_delta_less)
                  .replace('{amount}', inr(Math.abs(requestDelta)))}
              </div>
            )}
            {booking.changeRequest.requestedAt && (
              <div className="sm:col-span-2 text-[0.62rem] text-muted">
                {content.amend_pending_requested.replace('{date}', longDate(booking.changeRequest.requestedAt.slice(0, 10)))}
              </div>
            )}
          </dl>
        </div>
      ) : (
        <p className="text-[0.72rem] leading-5 text-muted">{content.amend_description}</p>
      )}

      {!pendingRequest && (
      <fieldset className="mt-4 min-w-0 space-y-3.5 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="chg-pickup">{content.amend_pickup_label}</label>
            <select id="chg-pickup" value={values.pickupLocation} onChange={(event) => set('pickupLocation', event.target.value)} className="field">
              {meta.locations.map((location) => <option key={location.id} value={location.name}>{location.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="chg-dropoff">{content.amend_dropoff_label}</label>
            <select id="chg-dropoff" value={values.dropoffLocation} onChange={(event) => set('dropoffLocation', event.target.value)} className="field">
              {meta.locations.map((location) => <option key={location.id} value={location.name}>{location.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="chg-from">{content.amend_from_label}</label>
            <input id="chg-from" type="date" min={todayISO()} max={maxAdvanceDate(meta.settings)} value={values.startDate} onChange={(event) => set('startDate', event.target.value)} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="chg-to">{content.amend_to_label}</label>
            <input id="chg-to" type="date" min={addDaysISO(values.startDate, policy.minDays)} max={maxAdvanceDate(meta.settings)} value={values.endDate} onChange={(event) => set('endDate', event.target.value)} className="field" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="chg-pickup-time">{content.amend_pickup_time_label}</label>
            <select id="chg-pickup-time" value={values.pickupTime} onChange={(event) => set('pickupTime', event.target.value)} className="field">
              {TIMES.map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="chg-dropoff-time">{content.amend_dropoff_time_label}</label>
            <select id="chg-dropoff-time" value={values.dropoffTime} onChange={(event) => set('dropoffTime', event.target.value)} className="field">
              {TIMES.map((time) => <option key={time} value={time}>{time}</option>)}
            </select>
          </div>
        </div>

        <div className="rounded-2xl border border-line/70 bg-gradient-to-br from-paper to-white px-3.5 py-3" aria-live="polite">
          {loading ? (
            <div className="space-y-1.5"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
          ) : !preview ? (
            <p className="text-[0.7rem] text-muted">{content.amend_no_changes}</p>
          ) : !preview.available ? (
            <p className="text-[0.72rem] font-semibold text-rose-700">{preview.unavailableReason || content.amend_unavailable}</p>
          ) : unchanged ? (
            <p className="text-[0.7rem] text-muted">{content.amend_no_changes}</p>
          ) : (
            <div className="space-y-1.5 text-[0.72rem]">
              <div className="flex justify-between"><span className="text-muted">{content.amend_new_total}</span><span className="font-extrabold">{inr(previewTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{content.amend_current_total}</span><span className="font-extrabold">{inr(total)}</span></div>
              <p className="pt-1 text-[0.66rem] leading-4 text-forest">{deltaLabel}</p>
            </div>
          )}
        </div>
      </fieldset>
      )}

      {pendingRequest ? (
        <button type="button" onClick={withdraw} className="btn btn-ghost mt-4 w-full text-rose-700">{content.amend_withdraw}</button>
      ) : (
        <button type="button" onClick={submit} disabled={submitting || loading || empty || unchanged || !preview?.available} className="btn btn-lime mt-4 w-full">
          {submitting ? content.amend_submitting : content.amend_submit}
        </button>
      )}
    </Modal>
  );
}