/**
 * Time-of-day heatmap (pick-up slot × weekday). Cells are colour-graded by
 * relative demand, each carries a tooltip, and the whole grid has a text
 * summary for assistive tech.
 */
import { Fragment } from 'react';

export default function Heatmap({
  rows = [],
  weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  slots = [],
  slotLabels = {},
  ariaLabel = 'Demand heatmap',
  emptyTitle = 'No pattern yet',
  emptyDescription = 'The heatmap fills in once vehicles start getting picked up.',
}) {
  if (!rows.length || !slots.length) {
    return (
      <div className="rounded-2xl border border-dashed border-moss/25 bg-white/60 px-4 py-8 text-center">
        <p className="text-sm font-extrabold">{emptyTitle}</p>
        <p className="mt-1 text-[0.68rem] leading-4 text-muted">{emptyDescription}</p>
      </div>
    );
  }
  const max = Math.max(...rows.map((row) => row.count), 1);
  const cell = (weekday, slot) => rows.find((row) => row.weekday === weekday && row.slot === slot);
  const summary = [...rows]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((row) => `${slotLabels[row.slot] || row.slot} ${row.weekday}: ${row.count}`)
    .join(', ');
  const strands = rows.filter((row) => row.count > 0).length;

  return (
    <div role="img" aria-label={`${ariaLabel}: ${strands} day-slot combinations, busiest ${summary}.`} className="overflow-x-auto">
      <div className="grid min-w-[34rem] gap-0.5" style={{ gridTemplateColumns: `56px repeat(${weekdays.length}, 1fr)` }}>
        <span className="flex items-center justify-center text-center bg-white text-[0.6rem] font-bold text-muted rounded-md h-7 w-14">Slot</span>
        {weekdays.map((day) => (
          <span key={day} className="flex items-center justify-center h-7 rounded-md bg-paper text-[0.58rem] font-extrabold uppercase tracking-wider text-muted">{day}</span>
        ))}
        {slots.map((slot) => (
          <Fragment key={`row-${slot}`}>
            <span key={`label-${slot}`} className="flex items-center justify-center text-center w-14 whitespace-normal text-[0.56rem] font-bold text-muted">{slotLabels[slot] || slot}</span>
            {weekdays.map((day) => {
              const entry = cell(day, slot);
              const value = entry?.count || 0;
              const alpha = value ? 0.18 + ((value / max) * 0.8) : 0.06;
              return (
                <span
                  key={`${slot}-${day}`}
                  className="flex h-7 items-center justify-center rounded-md"
                  style={{ backgroundColor: `rgba(46, 125, 50, ${alpha})` }}
                  title={`${slotLabels[slot] || slot} ${day}: ${value}`}
                >
                  {value > 0 && <span className="text-[0.55rem] font-bold text-ink">{value}</span>}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}