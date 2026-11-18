import { chartPoints } from './chartUtils.js';

/**
 * Big-number KPI with an optional inline sparkline and period delta. The
 * sparkline is decorative (aria-hidden) — the number is the accessible content.
 */
export default function KpiCard({ label, value, hint, delta, icon: Icon, tone, spark = [] }) {
  const renderSpark = spark.length > 1;
  let sparkPath = '';
  if (renderSpark) {
    const geometry = chartPoints(spark, 120, 44, 4, 4, 6, 6);
    sparkPath = geometry.points.map((point) => `${Math.round(point.x)} ${Math.round(point.y)}`).join(' ');
  }

  return (
    <div className="stat-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
        {Icon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone || 'bg-lime/20 text-forest'}`}><Icon className="h-4 w-4" /></span>}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <p className="text-2xl font-extrabold tracking-tight">{value}</p>
        {delta !== null && delta !== undefined && (
          <span className={delta > 0 ? 'rounded-full bg-lime/25 px-2 text-[0.58rem] font-extrabold text-ink' : delta < 0 ? 'rounded-full bg-rose-50 px-2 text-[0.58rem] font-extrabold text-rose-700' : 'rounded-full bg-paper px-2 text-[0.58rem] font-extrabold text-muted'}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.62rem] text-muted">{hint}</p>
        {renderSpark && (
          <svg
            viewBox="0 0 120 44"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="h-9 w-24 shrink-0 overflow-visible"
          >
            <polyline points={sparkPath} fill="none" stroke="#5B6B3B" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}