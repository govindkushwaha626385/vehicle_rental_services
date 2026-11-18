import { useEffect, useId, useRef, useState } from 'react';
import { chartPoints } from './chartUtils.js';

const DEFAULT_COLORS = ['#2E7D32', '#6E9A3A', '#0E7490', '#D8A01E', '#C24A2A'];

/**
 * Responsive area/line chart. `data` is [{ label, value }]. The summary is
 * announced to assistive tech; gradients get a unique id per instance.
 */
export default function LineChart({
  data = [],
  ariaLabel = 'Trend',
  description = '',
  height = 190,
  colorIndex = 0,
  format = (value) => value,
  tickCount = 4,
}) {
  const rows = data.filter((row) => row && row.label);
  const containerRef = useRef(null);
  const [width, setWidth] = useState(600);
  const gradientId = `chartfill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const measure = () => setWidth(Math.max(280, Math.round(node.clientWidth || 600)));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!rows.length) {
    return null;
  }
  const padLeft = 40;
  const geometry = chartPoints(rows.map((row) => row.value), width, height, padLeft);
  const color = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
  const pairs = geometry.points.map((point) => `${Math.round(point.x)} ${Math.round(point.y)}`);
  const line = pairs.join(' ');
  const lastX = Math.round(geometry.points[geometry.points.length - 1].x);
  const baseY = height - geometry.padBottom;
  // A single point needs a degenerate line path; joining an empty slice would
  // emit a double `L` and produce an invalid SVG path.
  const linePath = pairs.length > 1
    ? `M ${pairs[0]} L ${pairs.slice(1).join(' L ')}`
    : `M ${pairs[0]} L ${pairs[0]}`;
  const area = `${linePath} L ${lastX} ${baseY} Z`;
  const peak = rows.reduce((best, row) => (Number(row.value) > Number(best.value) ? row : best), rows[0]);
  const summary = `${ariaLabel}: ${rows.length} data points, peak ${peak.label} ${format(peak.value)}. ${description}`;
  const gridY = [0.25, 0.5, 0.75, 1].map((fraction) => geometry.padTop + geometry.innerH * (1 - fraction));

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        className="w-full overflow-visible text-[0.52rem]"
        style={{ height }}
      >
        <title>{ariaLabel}</title>
        <desc>{description}</desc>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {gridY.map((tick) => (
          <line key={tick} x1={geometry.padLeft} y1={tick} x2={width - 16} y2={tick} stroke="#E4E1D8" strokeWidth="1" strokeDasharray="3 4" />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {geometry.points.map((point, index) => (
          <g key={index}>
            <circle cx={point.x} cy={point.y} r="2.75" fill={color} />
            <title>{`${rows[index].label}: ${format(rows[index].value)}`}</title>
          </g>
        ))}
        {([0, Math.floor((rows.length - 1) / 2), rows.length - 1]).filter((index, i, self) => i < 3 && self.indexOf(index) === i).map((index) => (
          <text key={`x-${index}`} x={geometry.points[index].x} y={height - 8} textAnchor="middle" fill="#8A8578">
            {rows[index].label}
          </text>
        ))}
      </svg>
    </div>
  );
}