import { useEffect, useRef, useState } from 'react';
import { Clock, Sparkles } from 'lucide-react';
import { useMeta } from '../../context/MetaContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { todayISO, addDaysISO } from '../../lib/pricing.js';
import { inr } from '../../lib/format.js';
import { getSiteContent } from '../../lib/site.js';
import { advanceEnd, defaultExtension, extendProblem } from '../../lib/extend.js';
import { lateDays } from '../../lib/returns.js';

/**
 * Staff quick-extension at the returns desk (or from the Bookings drawer).
 *
 * A customer at the drop-off point asking for "another hour — or another two
 * days" is the most common call a rental desk takes. This form applies the
 * same server-authoritative extension the customer sees in their account
 * (availability, reprice, history, notifications), but it is invoked by a
 * staff member on the customer's behalf. The quoted total updates live and
 * any extra days are simply due at drop-off.
 */
export default function ExtendReturnForm({ booking, onApplied, onClose }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const content = getSiteContent(meta.settings);
  const policy = content.policy;

  const [values, setValues] = useState(() => defaultExtension(booking));
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const quoteRef = useRef(0);

  useEffect(() => {
    if (!booking) return undefined;
    setValues(defaultExtension(booking));
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id]);

  const refreshPreview = () => {
    if (!booking) {
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
    if (!booking) return undefined;
    refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id, values.endDate, values.dropoffTime]);

  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  const problem = booking ? extendProblem(booking, values, { policy }) : 'Booking not found.';
  const unchanged = Boolean(booking)
    && values.endDate === booking.endDate
    && (values.dropoffTime || '10:00') === (booking.dropoffTime || '10:00');

  const total = Number(booking?.total) || 0;
  const previewTotal = Number(preview?.quote?.total) || 0;
  const delta = preview?.available ? previewTotal - total : 0;
  const overdueDays = booking ? lateDays(booking, todayISO()) : 0;

  const apply = async () => {
    if (!booking || unchanged || problem || !preview?.available || applying) return;
    setApplying(true);
    try {
      await api.extendTrip({
        bookingId: booking.id,
        endDate: values.endDate,
        dropoffTime: values.dropoffTime,
      });
      push(content.extend_applied
        .replace('{date}', values.endDate)
        .replace('{time}', values.dropoffTime), 'success');
      onApplied?.();
      onClose?.();
    } catch (error) {
      push(error.message, 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="mt-2 rounded-2xl border border-lime-deep/30 bg-lime/10 p-3">
      <p className="flex items-center gap-1.5 text-[0.58rem] font-extrabold uppercase tracking-wider text-ink">
        <Clock className="h-3 w-3" /> {content.extend_extension_chip}
      </p>
      {overdueDays > 0 && (
        <p className="mt-1 text-[0.62rem] font-semibold text-coral">
          {content.extend_overdue_staff
            .replace('{date}', booking?.endDate || '')
            .replace('{days}', String(overdueDays))
            .replace('{s}', overdueDays === 1 ? '' : 's')}
        </p>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
          {content.extend_return_label}
          <input
            type="date"
            min={todayISO()}
            // Same ceiling as the self-serve modal: the max-days contract from
            // the trip start, not the booking-ahead window (that only limits
            // when a *new* trip can start, never how long this one can run).
            max={addDaysISO(booking?.startDate || todayISO(), policy.maxDays)}
            value={values.endDate}
            onChange={(event) => set('endDate', event.target.value)}
            className="field mt-1 text-[0.72rem]"
          />
        </label>
        <label className="text-[0.6rem] font-extrabold uppercase tracking-wider text-muted">
          {content.extend_return_time_label}
          <input
            type="time"
            step="1800"
            value={values.dropoffTime}
            onChange={(event) => set('dropoffTime', event.target.value)}
            className="field mt-1 text-[0.72rem]"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
            onClick={() => setValues((current) => advanceEnd(current, preset.hours))}
            className="rounded-full border border-line bg-white px-2 py-0.5 text-[0.6rem] font-extrabold text-ink transition hover:border-moss/50 hover:text-moss"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-2 rounded-xl border border-line bg-white px-2.5 py-2 text-[0.66rem]" aria-live="polite">
        {unchanged ? (
          <p className="text-muted">{content.extend_pick_later}</p>
        ) : problem ? (
          <p className="font-semibold text-rose-700">{problem}</p>
        ) : loading ? (
          <p className="text-muted">{content.extend_pick_later}</p>
        ) : !preview?.available ? (
          <p className="font-semibold text-rose-700">{preview?.unavailableReason || content.extend_unavailable}</p>
        ) : (
          <div className="space-y-0.5">
            <p className="flex justify-between"><span className="text-muted">{content.amend_current_total}</span><span className="font-bold">{inr(total)}</span></p>
            <p className="flex justify-between"><span className="text-muted">{content.amend_new_total}</span><span className="font-extrabold text-ink">{inr(previewTotal)}</span></p>
            {delta > 0 && <p className="pt-0.5 text-[0.6rem] text-forest">{content.extend_price_more.replace('{amount}', inr(delta))}</p>}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={apply}
        disabled={applying || loading || unchanged || Boolean(problem) || !preview?.available}
        className="btn btn-lime btn-sm mt-2 w-full"
      >
        <Sparkles className="h-3.5 w-3.5" /> {applying ? content.extend_applying : content.extend_apply}
      </button>
    </div>
  );
}
