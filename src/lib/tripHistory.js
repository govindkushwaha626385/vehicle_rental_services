import { localDay } from './format.js';

/**
 * Customer-facing trip-activity trail.
 *
 * Every edit that moves a booking — a self-serve extension, a staff
 * date/hub change, an approved change request — is appended to the booking's
 * `tripChanges` array with a small delta. This formatter turns those raw rows
 * into the labelled cards shown on the voucher and the manage-booking page,
 * so a customer who extended (or whose trip was changed) sees the exact
 * before/after instead of being surprised at the desk.
 *
 * `content` supplies the admin-editable `amend_history_*` copy.
 */

const num = (value) => {
  const parsed = Number(value) || 0;
  return parsed;
};

/**
 * Map raw tripChanges rows to display rows:
 *   { id, type, by, day, delta, title, detail }
 * `title`/`detail` are already taken from the existing content keys when
 * possible; the summary text falls back to the stored `summary` field so
 * legacy/internally-written rows still render.
 */
export function tripHistoryEntries(booking = {}, content = {}) {
  const changes = Array.isArray(booking?.tripChanges) ? booking.tripChanges : [];
  const lines = changes.map((entry, index) => {
    const type = entry?.type === 'extension' ? 'extension' : 'change';
    const delta = num(entry?.delta);
    const summary = String(entry?.summary ?? '').trim();
    const by = String(entry?.by ?? '').trim();
    const day = localDay(entry?.at || '');
    const key = type === 'extension' ? 'amend_history_extension' : 'amend_history_change';
    // The stored summary already reads like a sentence ("Return 1 Nov 10:00 →
    // 3 Nov 18:00"); only wrap it in the label when it is non-empty.
    return {
      id: `${booking?.code ?? 'booking'}-hist-${index}`,
      type,
      by,
      day,
      delta,
      title: summary
        ? (content[key] || '{summary}').replace('{summary}', summary)
        : (type === 'extension' ? content.amend_history_extension_noop : content.amend_history_change),
      detail: [
        by ? content.amend_history_by.replace('{by}', by) : '',
        delta > 0
          ? content.amend_history_delta_more.replace('{amount}', intlRupees(delta))
          : delta < 0
            ? content.amend_history_delta_less.replace('{amount}', intlRupees(-delta))
            : '',
      ].filter(Boolean).join(' · '),
    };
  });
  return lines;
}

const intlRupees = (value) => `₹${Math.round(Math.abs(value)).toLocaleString('en-IN')}`;