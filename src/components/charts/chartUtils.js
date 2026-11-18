/**
 * Minimal, dependency-free SVG charting for the admin console.
 *
 * Every chart is fully responsive (viewBox + preserveAspectRatio="none"),
 * degrades to a tidy empty state on no data, and exposes an accessible name
 * through role="img" + aria-label so screen readers get a text summary instead
 * of a silent bitmap.
 */

const TONES = ['bg-forest', 'bg-lime-deep', 'bg-aqua', 'bg-sun', 'bg-coral', 'bg-rose-400', 'bg-stone-400'];

const SAFE = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export const chartTone = (index) => TONES[index % TONES.length];

export function chartPoints(values = [], width = 600, height = 200, padLeft = 34, padRight = 16, padTop = 18, padBottom = 34) {
  const clean = values.map(SAFE);
  const max = clean.length ? Math.max(...clean) : 0;
  const scale = max > 0 ? max : 1;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const step = clean.length > 1 ? innerW / (clean.length - 1) : 0;
  return {
    clean,
    max,
    scale,
    points: clean.map((value, index) => ({
      x: padLeft + step * index,
      y: padTop + innerH - (value / scale) * innerH,
      value,
    })),
    innerW,
    innerH,
    padTop,
    padBottom,
    padLeft,
  };
}