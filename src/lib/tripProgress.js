/**
 * Trip progress for the voucher page: derivation-only, no labels (those live in
 * admin content). Returns the current milestone index and whether the trip is
 * closed. Given pending → confirmed → active → completed, plus a terminal
 * closed (cancelled/rejected) state that supersedes the milestone line.
 */

export const TRIP_MILESTONES = Object.freeze(['requested', 'confirmed', 'pickup', 'returned']);

export function tripProgress({ status = '', depositSettlement = null } = {}) {
  if (status === 'cancelled' || status === 'rejected') {
    return { closed: true, closedStatus: status, currentIndex: -1, milestones: TRIP_MILESTONES };
  }
  const index = status === 'pending'
    ? 0
    : status === 'confirmed'
      ? 1
      : status === 'active'
        ? 2
        : status === 'completed'
          ? 3
          : -1;
  if (index < 0) return { closed: false, currentIndex: -1, milestones: TRIP_MILESTONES };
  return { closed: false, currentIndex: index, milestones: TRIP_MILESTONES };
}

/** 0–100 completion for the progress bar; closed trips render at full width. */
export function tripProgressPercent(progress = {}) {
  if (progress.closed) return 100;
  if (progress.currentIndex < 0) return 0;
  return Math.round(((progress.currentIndex + 1) / progress.milestones.length) * 100);
}