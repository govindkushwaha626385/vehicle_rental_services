import { monthLabel } from './format.js';

/**
 * Review analytics.
 *
 * Kept pure and date-injectable so the admin dashboard and the contract tests
 * agree on every number: average, star mix, 30-day pulse, monthly trend and
 * per-vehicle ranking. Ratings outside 1–5 are ignored rather than silently
 * dragging the average down.
 */
const round1 = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : 0);

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const averageOf = (rows) => (
  rows.length ? round1(rows.reduce((sum, row) => sum + row.rating, 0) / rows.length) : 0
);

export function reviewSummary(reviews = [], { vehicles = [], months = 6, today = new Date() } = {}) {
  const rows = (Array.isArray(reviews) ? reviews : [])
    .map((review) => ({ ...review, rating: Number(review.rating) }))
    .filter((review) => Number.isFinite(review.rating) && review.rating >= 1 && review.rating <= 5);

  const count = rows.length;
  const average = averageOf(rows);

  const distribution = [5, 4, 3, 2, 1].map((stars) => {
    const inStar = rows.filter((review) => Math.round(review.rating) === stars).length;
    return {
      stars,
      count: inStar,
      share: count ? Math.round((inStar / count) * 100) : 0,
    };
  });

  const now = typeof today === 'string' ? new Date(`${today}T00:00:00`) : new Date(today);
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;

  const cutoff = new Date(safeNow);
  cutoff.setDate(cutoff.getDate() - 30);
  const recentRows = rows.filter((review) => {
    const date = toDate(review.createdAt);
    return date && date >= cutoff;
  });

  const keys = [];
  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(safeNow.getFullYear(), safeNow.getMonth() - index, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  const trend = keys.map((key) => {
    const inMonth = rows.filter((review) => String(review.createdAt ?? '').slice(0, 7) === key);
    return {
      key,
      label: monthLabel(key),
      count: inMonth.length,
      average: averageOf(inMonth),
    };
  });

  const vehicleNames = new Map((Array.isArray(vehicles) ? vehicles : []).map((vehicle) => [vehicle.id, vehicle.name]));
  const vehicleBuckets = new Map();
  rows.forEach((review) => {
    const bucket = vehicleBuckets.get(review.vehicleId) ?? {
      vehicleId: review.vehicleId,
      name: vehicleNames.get(review.vehicleId) || 'Removed vehicle',
      count: 0,
      total: 0,
    };
    bucket.count += 1;
    bucket.total += review.rating;
    vehicleBuckets.set(review.vehicleId, bucket);
  });
  const byVehicle = [...vehicleBuckets.values()]
    .map((bucket) => ({
      vehicleId: bucket.vehicleId,
      name: bucket.name,
      count: bucket.count,
      average: round1(bucket.total / bucket.count),
    }))
    .sort((a, b) => (b.average - a.average) || (b.count - a.count) || a.name.localeCompare(b.name));

  // Low ratings are the ones a real desk would call about. Newest first so the
  // follow-up list reads like an inbox, not a leaderboard.
  const lowRated = rows
    .filter((review) => review.rating <= 3)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, 6)
    .map((review) => ({
      id: review.id,
      author: review.author || 'Guest',
      vehicle: vehicleNames.get(review.vehicleId) || 'Removed vehicle',
      rating: review.rating,
      comment: review.comment || '',
      createdAt: review.createdAt,
    }));

  const fiveStar = rows.filter((review) => Math.round(review.rating) === 5).length;
  const low = rows.filter((review) => review.rating <= 2).length;
  const replied = rows.filter((review) => review.reply).length;

  return {
    count,
    average,
    distribution,
    recent: {
      count: recentRows.length,
      average: averageOf(recentRows),
    },
    trend,
    byVehicle,
    lowRated,
    fiveStarCount: fiveStar,
    lowCount: low,
    replied,
    replyRate: count ? Math.round((replied / count) * 100) : 0,
    fiveStarShare: count ? Math.round((fiveStar / count) * 100) : 0,
    lowShare: count ? Math.round((low / count) * 100) : 0,
  };
}
