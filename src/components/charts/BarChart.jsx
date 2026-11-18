import { chartTone } from './chartUtils.js';

/**
 * Horizontal bar list for rankings (hubs, vehicles, categories). Renders as a
 * semantic list with visible values — no silent bitmap.
 */
export default function BarChart({
  rows = [],
  format = (value) => value,
  sub,
  max,
  emptyTitle = 'No data yet',
  emptyDescription = 'Nothing to show until bookings start coming in.',
  ariaLabel = 'Ranking',
}) {
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-moss/25 bg-white/60 px-4 py-8 text-center">
        <p className="text-sm font-extrabold">{emptyTitle}</p>
        <p className="mt-1 text-[0.68rem] leading-4 text-muted">{emptyDescription}</p>
      </div>
    );
  }
  const top = Number(max) > 0 ? Number(max) : Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  return (
    <div role="list" aria-label={ariaLabel} className="space-y-2.5">
      {rows.map((row, index) => {
        const value = Number(row.value) || 0;
        // A zero row must not paint a bar: the value label already says 0.
        const width = value > 0 ? Math.max(2, Math.round((value / top) * 100)) : 0;
        return (
          <div key={row.label} role="listitem" className="group flex items-center gap-2.5">
            <span className="hidden w-28 truncate text-right text-[0.66rem] font-bold text-muted lg:inline">{row.label}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 text-[0.66rem]">
                <span className="truncate font-semibold lg:hidden">{row.label}</span>
                <span className="shrink-0 font-extrabold">{format(value)}</span>
              </div>
              <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-stone-100">
                <div className={`h-full rounded-full ${chartTone(index)}`} style={{ width: `${width}%` }} title={`${row.label}: ${format(value)}${sub ? ` · ${sub(row)}` : ''}`} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}