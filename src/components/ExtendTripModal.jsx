import { useEffect, useRef, useState } from 'react';
import { Modal, Skeleton } from './ui.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { addDaysISO, todayISO } from '../lib/pricing.js';
import { inr, longDate } from '../lib/format.js';
import { getSiteContent, lateChargeFor, lateFeeTermsText } from '../lib/site.js';
import { advanceEnd, defaultExtension, extendProblem } from '../lib/extend.js';
import { lateDays, lateDuration } from '../lib/returns.js';

/**
 * Self-serve "extend my return" for a trip that is already out.
 *
 * Only the drop-off can move (pick-up hub, start date and pick-up time are
 * locked — the vehicle is already on the road). Live availability and price
 * are quoted through the same engine as checkout; the extension takes effect
 * immediately because the vehicle is in the customer's hands, with any extra
 * days due at drop-off. A customer who is already overdue sees exactly how
 * many days of late fee an extension stops.
 */
const seedValues = (booking) => defaultExtension(booking);

export default function ExtendTripModal({ booking, open, onClose, onExtended }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = getSiteContent(meta.settings);
  const policy = content.policy;

  const [values, setValues] = useState(() => seedValues(booking));
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const quoteRef = useRef(0);

  useEffect(() => {
    if (!open || !booking) return undefined;
    setValues(seedValues(booking));
    setPreview(null);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id]);

  const empty = !values.endDate || !values.dropoffTime;

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
      vehicleId: booking.vehicleId ?? booking.vehicle?.id,
      startDate: booking.startDate,
      endDate: values.endDate,
      extras: booking.extraKeys ?? [],
      insurance: booking.insurance?.key ?? 'basic',
      promoCode: booking.promoCode || null,
      pickupLocation: booking.pickupLocation,
      dropoffLocation: booking.dropoffLocation,
      paymentPlan: booking.paymentPlan === 'deposit' ? 'deposit' : 'full',
      excludeBookingId: booking.id,
      skipValidation: true,
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
  }, [open, values.endDate, values.dropoffTime]);

  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  const applyPreset = (hours) => {
    setValues((current) => advanceEnd(current, hours));
  };

  const problem = empty
    ? null
    : extendProblem(booking, values, { policy });
  const unchanged = Boolean(booking)
    && values.endDate === booking.endDate
    && (values.dropoffTime || '10:00') === (booking.dropoffTime || '10:00');

  const total = Number(booking?.total) || 0;
  const previewTotal = Number(preview?.quote?.total) || 0;
  const delta = preview?.available ? previewTotal - total : 0;
  const deltaLabel = delta > 0
    ? content.extend_price_more.replace('{amount}', inr(delta))
    : delta === 0
      ? content.extend_price_same
      : content.amend_price_note_less.replace('{amount}', inr(-delta));

  const overdueDays = booking ? lateDays(booking, todayISO()) : 0;
  const liveLate = booking ? lateChargeFor(booking, policy) : { hours: 0, charge: 0 };

  const submit = async () => {
    if (empty || unchanged || problem || !preview?.available || submitting) return;
    setSubmitting(true);
    try {
      await api.extendTrip({
        bookingId: booking.id,
        endDate: values.endDate,
        dropoffTime: values.dropoffTime,
      });
      push(content.extend_sent
        .replace('{date}', longDate(values.endDate))
        .replace('{time}', values.dropoffTime), 'success');
      onExtended?.();
      onClose();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open && Boolean(booking)} onClose={() => (submitting ? null : onClose())} title={content.extend_title} description={booking?.vehicle?.name} size="md">
      <p className="text-[0.72rem] leading-5 text-muted">{content.extend_description}</p>

      <div className="mt-3 rounded-xl border border-line bg-paper px-3 py-2 text-[0.66rem] leading-5 text-muted">
        {content.extend_pickup_locked
          .replace('{hub}', booking?.pickupLocation || '')
          .replace('{date}', booking ? longDate(booking.startDate) : '')}
        <span className="mt-0.5 block text-[0.6rem] text-muted/80">{content.extend_active_lock}</span>
      </div>

      {overdueDays > 0 && (
        <div className="mt-3 rounded-2xl border border-coral/40 bg-coral/10 px-3.5 py-3">
          <p className="text-[0.72rem] font-extrabold text-ink">
            {content.extend_overdue_title
              .replace('{days}', String(overdueDays))
              .replace('{s}', overdueDays === 1 ? '' : 's')}
          </p>
          <p className="mt-0.5 text-[0.66rem] leading-5 text-ink/80">
            {content.extend_overdue_copy
              .replace('{date}', booking ? longDate(booking.endDate) : '')
              .replace('{terms}', lateFeeTermsText(content.late_fee_terms, policy))
              .replace('{amount}', inr(policy.lateFeePerDay))}
          </p>
          {liveLate.hours > 0 && (
            <p className="mt-1 text-[0.66rem] font-extrabold text-ink">
              {content.late_meter_title
                .replace('{amount}', inr(liveLate.charge))
                .replace('{duration}', lateDuration(liveLate.hours))}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 min-w-0 space-y-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ext-to">{content.extend_return_label}</label>
            <input
              id="ext-to"
              type="date"
              min={todayISO()}
              // The ceiling for an extension is the max-days contract from the
              // trip start — NOT the booking-ahead window, which only constrains
              // when a *new* trip can start. Capping here at maxAdvance would
              // wrongly block a long extension on an active rental.
              max={addDaysISO(booking?.startDate || todayISO(), policy.maxDays)}
              value={values.endDate}
              onChange={(event) => set('endDate', event.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="ext-time">{content.extend_return_time_label}</label>
            <input
              id="ext-time"
              type="time"
              step="1800"
              value={values.dropoffTime}
              onChange={(event) => set('dropoffTime', event.target.value)}
              className="field"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { hours: 1, label: content.extend_quick_1h },
            { hours: 3, label: content.extend_quick_3h },
            { hours: 24, label: content.extend_quick_1d },
            { hours: 48, label: content.extend_quick_2d },
            { hours: 72, label: content.extend_quick_3d },
          ].map((preset) => (
            <button
              key={preset.hours}
              type="button"
              onClick={() => applyPreset(preset.hours)}
              className="rounded-full border border-line bg-white px-2.5 py-1 text-[0.62rem] font-extrabold text-ink transition hover:border-moss/50 hover:text-moss"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-line/70 bg-gradient-to-br from-paper to-white px-3.5 py-3" aria-live="polite">
          {unchanged ? (
            <p className="text-[0.7rem] text-muted">{content.extend_pick_later}</p>
          ) : problem ? (
            <p className="text-[0.72rem] font-semibold text-rose-700">{problem}</p>
          ) : loading ? (
            <div className="space-y-1.5"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
          ) : !preview ? (
            <p className="text-[0.7rem] text-muted">{content.extend_pick_later}</p>
          ) : !preview.available ? (
            <p className="text-[0.72rem] font-semibold text-rose-700">{preview.unavailableReason || content.extend_unavailable}</p>
          ) : (
            <div className="space-y-1.5 text-[0.72rem]">
              <div className="flex justify-between"><span className="text-muted">{content.amend_new_total}</span><span className="font-extrabold">{inr(previewTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted">{content.amend_current_total}</span><span className="font-extrabold">{inr(total)}</span></div>
              <p className="pt-1 text-[0.66rem] leading-4 text-forest">{deltaLabel}</p>
              <p className="pt-1 text-[0.64rem] leading-4 text-muted">{content.extend_paid_early_note}</p>
              <p className="pt-1 text-[0.64rem] leading-4 text-muted">
                {content.extend_whats_included_deposit.replace('{amount}', inr(Number(booking?.holdAmount) || 0))}
              </p>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting || loading || empty || unchanged || Boolean(problem) || !preview?.available}
        className="btn btn-lime mt-4 w-full"
      >
        {submitting ? content.extend_submitting : content.extend_submit}
      </button>
    </Modal>
  );
}
