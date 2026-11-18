import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn, inr } from '../lib/format.js';
import { lateChargeFor, lateFeeTermsText } from '../lib/site.js';
import { lateDuration } from '../lib/returns.js';

/**
 * Live late-return meter for an in-progress trip.
 *
 * It runs the same hourly, grace-aware, daily-capped engine as the returns
 * desk, so the figure the customer sees is exactly what staff settle with.
 * The value ticks once a minute; anything that is not a late active trip
 * renders nothing at all (so pages can mount it unconditionally).
 */
export default function LateMeter({
  booking,
  content = {},
  policy = {},
  canExtend = false,
  tone = 'light',
  variant = 'card',
  className = '',
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const late = useMemo(() => lateChargeFor(booking, policy, now), [booking, policy, now]);
  if (!booking || booking.status !== 'active' || late.hours <= 0) return null;

  const copyKey = canExtend ? 'late_meter_copy' : 'late_meter_copy_no_extend';
  const copy = String(content[copyKey] ?? '')
    .replace('{terms}', lateFeeTermsText(content.late_fee_terms, policy));
  const title = String(content.late_meter_title ?? '')
    .replace('{amount}', inr(late.charge))
    .replace('{duration}', lateDuration(late.hours));
  const dark = tone === 'dark';

  return (
    <div
      className={cn(
        'border px-3.5 py-3',
        dark
          ? 'border-rose-400/40 bg-rose-500/10 text-rose-100'
          : 'border-coral/40 bg-coral/10 text-ink',
        variant === 'strip' ? 'border-x-0 border-b-0' : 'rounded-2xl',
        className,
      )}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.72rem] font-extrabold">
        <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0', dark ? 'text-rose-300' : 'text-coral')} />
        <span>{title}</span>
      </p>
      <p className={cn('mt-1 text-[0.66rem] leading-5', dark ? 'text-rose-100/90' : 'text-ink/80')}>{copy}</p>
    </div>
  );
}
