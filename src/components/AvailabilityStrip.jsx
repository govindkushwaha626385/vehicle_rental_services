import { CalendarDays, Sparkles } from 'lucide-react';
import { cn, shortDate } from '../lib/format.js';
import { stripSummary } from '../lib/availabilityStrip.js';

/**
 * Next-N-day availability strip for a vehicle. Each day is a small cell;
 * tapping a free cell hands the chosen start day to the caller via onPick.
 * The summary line doubles as the accessible label for the whole strip.
 */
export default function AvailabilityStrip({ cells = [], content = {}, onPick = null }) {
  if (!cells.length) return null;
  const summary = stripSummary(cells);

  return (
    <div className="rounded-2xl border border-line bg-white/90 p-3.5 shadow-card backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[0.66rem] font-extrabold uppercase tracking-wider text-muted">
          <CalendarDays className="h-3.5 w-3.5 text-forest" /> {content.vehicle_avail_title}
        </p>
        <span className={cn('rounded-full px-2 py-0.5 text-[0.55rem] font-extrabold', summary.openCount === cells.length ? 'bg-ok/10 text-ok' : 'bg-paper text-muted')}>
          {content.vehicle_avail_days.replace('{open}', String(summary.openCount)).replace('{total}', String(cells.length))}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={`${cells.length} days ahead — ${summary.openCount} free`}>
        {cells.map((cell) => {
          const free = !cell.busy;
          const classes = free
            ? 'bg-ok/20 border-ok/40 text-ok hover:bg-ok/35'
            : 'bg-stone-100 border-line text-muted/50';
          const label = `${shortDate(cell.date)} — ${free ? content.vehicle_avail_free : content.vehicle_avail_booked}`;
          return (
            <button
              key={cell.date}
              type="button"
              onClick={free ? () => onPick?.(cell) : undefined}
              disabled={!free}
              title={label}
              aria-label={label}
              className={cn('flex h-6 w-6 items-center justify-center rounded-md border text-[0.5rem] font-extrabold transition', classes)}
            >
              {Number(cell.date.slice(8))}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[0.58rem]">
        <span className="inline-flex items-center gap-1 text-muted">
          <span className="inline-block h-2.5 w-2.5 rounded border border-ok/40 bg-ok/20" /> {content.vehicle_avail_free}
          <span className="mx-1 inline-block h-2.5 w-2.5 rounded bg-stone-100" /> {content.vehicle_avail_booked}
        </span>
        {summary.firstOpenDate && (
          <button
            type="button"
            onClick={() => onPick?.(cells.find((cell) => !cell.busy))}
            className="inline-flex items-center gap-1 font-extrabold text-forest underline decoration-lime decoration-2 underline-offset-4 hover:text-ink"
          >
            <Sparkles className="h-3 w-3" /> {content.vehicle_avail_pick_starts.replace('{date}', shortDate(summary.firstOpenDate))}
          </button>
        )}
      </div>
    </div>
  );
}