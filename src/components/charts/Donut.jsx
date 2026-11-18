const FILL = ['#2E7D32', '#6E9A3A', '#0E7490', '#D8A01E', '#C24A2A', '#B5446B', '#8A7F72'];

/**
 * Accessible SVG donut. Each segment carries a <title>, the whole chart gets a
 * text summary, and the legend is a real list.
 */
export default function Donut({
  segments = [],
  format = (value) => value,
  centerLabel = '',
  emptyTitle = 'No data yet',
  emptyDescription = 'Nothing to visualise until bookings arrive.',
  ariaLabel = 'Share of bookings',
}) {
  const rows = segments.filter((segment) => segment && Number(segment.value) > 0);
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-moss/25 bg-white/60 px-4 py-8 text-center">
        <p className="text-sm font-extrabold">{emptyTitle}</p>
        <p className="mt-1 text-[0.68rem] leading-4 text-muted">{emptyDescription}</p>
      </div>
    );
  }

  const total = rows.reduce((sum, segment) => sum + (Number(segment.value) || 0), 0);
  const size = 220;
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const summary = rows
    .map((segment) => `${segment.label} ${format(segment.value)} (${Math.round((segment.value / total) * 100)}%)`)
    .join(', ');

  let offset = 0;
  const arcs = rows.map((segment) => {
    const fraction = (Number(segment.value) || 0) / total;
    const dash = fraction * circumference;
    const arc = { ...segment, dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${ariaLabel}: ${summary}`}
        className="h-40 w-40 shrink-0"
      >
        <title>{ariaLabel}</title>
        <desc>{summary}</desc>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {arcs.map((arc, index) => (
            <circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={FILL[index % FILL.length]}
              strokeWidth="22"
              strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
              strokeDashoffset={-arc.offset}
            >
              <title>{`${arc.label}: ${format(arc.value)} (${Math.round((arc.value / total) * 100)}%)`}</title>
            </circle>
          ))}
        </g>
        <text x="50%" y="48%" textAnchor="middle" className="text-lg font-extrabold" fill="#1A1D17">{format(total)}</text>
        <text x="50%" y="60%" textAnchor="middle" className="text-[0.62rem]" fill="#8A8578">{centerLabel}</text>
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {rows.map((row, index) => (
          <li key={row.label} className="flex items-center gap-2 text-[0.66rem] font-semibold">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: FILL[index % FILL.length] }} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="shrink-0 font-extrabold text-ink">{format(row.value)}</span>
            <span className="shrink-0 text-muted">{Math.round((row.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}