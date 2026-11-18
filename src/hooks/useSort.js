import { useMemo, useState } from 'react';

/**
 * useSort — shared admin-table sorting (shadcn Data Table style).
 *
 * Pair with <SortableHeader> from components/ui.jsx:
 *
 *   const { sort, toggle, apply } = useSort();
 *   const rows = apply(filtered, (key, row) => {
 *     if (key === 'total') return Number(row.total) || 0;
 *     return row[key];
 *   });
 *
 * Rules that keep results predictable across tables:
 * - No active key → returns the array unchanged (natural/API order).
 * - `undefined`/`null`/empty values sort last in either direction.
 * - Numbers compare numerically; everything else compares as text.
 * - The comparator is stable, so equal rows keep their existing order.
 *
 * @param {{ key?: string, dir?: 'asc'|'desc' }} [initial]
 */
export function useSort(initial = {}) {
  const [sort, setSort] = useState({ key: initial.key ?? null, dir: initial.dir ?? 'asc' });

  const toggle = (nextKey) => {
    setSort((current) => (
      current.key === nextKey
        ? { key: nextKey, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: nextKey, dir: 'asc' }
    ));
  };

  const apply = useMemo(() => (rows, accessor) => {
    if (!sort.key) return rows;
    const list = Array.isArray(rows) ? rows : [];
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = accessor(sort.key, a);
      const bv = accessor(sort.key, b);
      const aEmpty = av === undefined || av === null || av === '';
      const bEmpty = bv === undefined || bv === null || bv === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const an = Number(av);
      const bn = Number(bv);
      const numeric = typeof av === 'number' || (Number.isFinite(an) && String(av).trim() !== '' && !isNaN(Number(String(av))));
      if (numeric && Number.isFinite(bn)) return (an - bn) * factor;
      return String(av).localeCompare(String(bv), 'en') * factor;
    });
  }, [sort]);

  return { sort, toggle, apply };
}
