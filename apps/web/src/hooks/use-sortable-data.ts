import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

interface SortState<K extends string> {
  key: K | null;
  direction: SortDirection;
}

/**
 * Generic client-side sort for a table that already has all its rows
 * in memory (no new API calls/pagination params) — pairs with
 * `SortableTableHead` for the click-to-sort header UI.
 */
export function useSortableData<T, K extends string>(
  data: T[],
  getValue: (item: T, key: K) => string | number | null | undefined,
  initial: SortState<K> = { key: null, direction: 'desc' },
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    if (!sort.key) return data;
    const key = sort.key;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const av = getValue(a, key);
      const bv = getValue(b, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [data, sort, getValue]);

  const toggleSort = (key: K) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return { key: null, direction: 'asc' };
    });
  };

  return { sorted, sortKey: sort.key, sortDirection: sort.direction, toggleSort };
}
