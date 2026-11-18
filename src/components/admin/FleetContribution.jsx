import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn, inrShort } from '../../lib/format.js';

/**
 * Per-vehicle economics for the selected analytics window.
 *
 * Revenue is completed-trip value (the same basis as the Revenue KPI) and
 * service spend is validated workshop cost, so "contribution" is honest:
 * revenue minus service spend only. Insurance, fuel and depreciation are not
 * tracked in this product, so the card never calls the figure profit.
 */
export default function FleetContribution({ rows = [], range = 30, content }) {
  const windowRows = rows
    .map((row) => ({ ...row, ...(row.byWindow?.[range] ?? row.byWindow?.[30] ?? row.allTime ?? {}) }))
    .filter((row) => (row.trips ?? 0) > 0 || (row.service ?? 0) > 0)
    .sort((a, b) => b.contribution - a.contribution);

  const totals = windowRows.reduce((acc, row) => ({
    trips: acc.trips + (row.trips || 0),
    revenue: acc.revenue + (row.revenue || 0),
    service: acc.service + (row.service || 0),
    contribution: acc.contribution + (row.contribution || 0),
  }), { trips: 0, revenue: 0, service: 0, contribution: 0 });

  const scale = Math.max(1, ...windowRows.map((row) => Math.max(row.revenue || 0, row.service || 0)));
  const negative = windowRows.filter((row) => row.contribution < 0);
  const idle = rows.length - windowRows.length;
  const tripLabel = (count) => (count === 1
    ? content.analytics_contribution_trips_one
    : content.analytics_contribution_trips_many.replace('{count}', String(count)));

  if (!windowRows.length) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-paper/60 p-6 text-center">
        <p className="text-[0.72rem] font-semibold text-muted">{content.analytics_contribution_none}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-[0.54rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_contribution_revenue}</p>
          <p className="mt-1 text-base font-extrabold tabular-nums text-ink">{inrShort(totals.revenue)}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-[0.54rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_contribution_service}</p>
          <p className="mt-1 text-base font-extrabold tabular-nums text-coral">{inrShort(totals.service)}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-[0.54rem] font-extrabold uppercase tracking-wider text-muted">{content.analytics_contribution_total}</p>
          <p className={cn('mt-1 text-base font-extrabold tabular-nums', totals.contribution < 0 ? 'text-coral' : 'text-forest')}>
            {inrShort(totals.contribution)}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-2" aria-label={content.analytics_contribution_title}>
        {windowRows.map((row) => {
          const margin = row.revenue > 0 ? Math.round((row.contribution / row.revenue) * 100) : null;
          const up = row.contribution >= 0;
          return (
            <li key={row.id} className="rounded-xl border border-line bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="truncate text-[0.74rem] font-extrabold leading-5">{row.name}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[0.58rem] text-muted">
                    <span>{tripLabel(row.trips)}</span>
                    {row.type ? (<><span aria-hidden="true">·</span><span>{row.type}</span></>) : null}
                    {margin !== null ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={cn('font-bold', up ? 'text-forest' : 'text-coral')}>
                          {content.analytics_contribution_margin.replace('{percent}', String(margin))}
                        </span>
                      </>
                    ) : (
                      <><span aria-hidden="true">·</span><span>{content.analytics_contribution_no_revenue}</span></>
                    )}
                  </p>
                </div>
                <p className={cn('flex items-center gap-1 text-[0.82rem] font-extrabold tabular-nums', up ? 'text-forest' : 'text-coral')}>
                  {up ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                  {inrShort(row.contribution)}
                </p>
              </div>

              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[0.54rem] font-bold uppercase tracking-wider text-muted">{content.analytics_contribution_revenue}</span>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper" role="presentation">
                    <div className="h-full rounded-full bg-forest" style={{ width: `${Math.min(100, ((row.revenue || 0) / scale) * 100)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-[0.6rem] font-bold tabular-nums">{inrShort(row.revenue)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-[0.54rem] font-bold uppercase tracking-wider text-muted">{content.analytics_contribution_service}</span>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper" role="presentation">
                    <div className="h-full rounded-full bg-coral" style={{ width: `${Math.min(100, ((row.service || 0) / scale) * 100)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-[0.6rem] font-bold tabular-nums">{inrShort(row.service)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 space-y-1 text-[0.6rem] leading-4">
        {negative.length > 0 && (
          <p className="flex items-start gap-1.5 font-semibold text-coral">
            <TrendingDown className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {negative.length === 1
              ? content.analytics_contribution_negative_one
              : content.analytics_contribution_negative.replace('{count}', String(negative.length))}
          </p>
        )}
        {negative.length === 0 && (
          <p className="flex items-start gap-1.5 font-semibold text-forest">
            <TrendingUp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {content.analytics_contribution_positive}
          </p>
        )}
        {idle > 0 && (
          <p className="text-muted">
            {idle === 1
              ? content.analytics_contribution_idle_one
              : content.analytics_contribution_idle.replace('{count}', String(idle))}
          </p>
        )}
        <p className="text-muted">{content.analytics_contribution_note}</p>
      </div>
    </div>
  );
}
