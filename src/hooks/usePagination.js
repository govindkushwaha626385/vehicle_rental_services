import { useEffect, useState } from 'react';

/**
 * usePagination — lightweight client-side paging for admin tables.
 *
 * The admin data layer already caps heavy reads (audit log at 300 rows,
 * notifications at 500), but the rendered pages still walk *every* loaded row.
 * With hundreds of bookings or customers the DOM and the filter pass both grow
 * unbounded. This hook slices the current page for the render and lets the
 * operator page through the rest.
 *
 * Semantics are deliberately boring:
 *  - `resetKey` changes whenever the filtered set can change (search, filters,
 *    sort). The page then snaps back to 1 *synchronously during the render* so
 *    the very next paint shows the top of the new result set — a filter change
 *    can never flash a stale "Page 3 of 2" while re-rendering.
 *  - The page is clamped when the set shrinks (delete, narrower filter) so the
 *    current page can never read past the end.
 *  - Bulk selection is untouched: it reads the whole filtered set, not this
 *    page, so "N selected" stays true even when rows span several pages.
 *
 * @param {Array} items    The already-filtered, already-sorted rows.
 * @param {string} resetKey A string that changes when items' identity changes.
 * @param {number} pageSize  Rows per page (default 25).
 */
export function usePagination({ items = [], resetKey = '', pageSize = 25 }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  const totalPages = Math.max(1, Math.ceil(items.length / size));

  // Derived state during render (the documented escape hatch for "reset when a
  // prop changes"): the resetKey changed, so reset both the key and the page
  // before anything commits. React discards the current render and re-runs it
  // with page = 1, so the operator never sees an out-of-range page.
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setPage(1);
  }

  // Async safety net for rows disappearing between renders (deleting a row on
  // the last page, a narrower filter shortening the list). The render-time
  // `safePage` clamp below keeps every paint consistent while this catches up.
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * size;
  const end = Math.min(start + size, items.length);
  const rows = items.slice(start, end);

  return { page: safePage, setPage, size, setSize, totalPages, rows, start, end, total: items.length };
}
