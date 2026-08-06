import { useEffect, useMemo, useState } from 'react';

/**
 * Generic client-side pagination for a table that already has all its rows
 * in memory. Resets to page 1 whenever the underlying data set changes size
 * (new filter/sort producing fewer pages than the current one).
 */
export function usePagination<T>(data: T[], pageSize = 10) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(data.length / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [pageCount, page]);

  const pageData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [data, page, pageSize]);

  return {
    pageData,
    page,
    pageCount,
    setPage,
    canPrev: page > 1,
    canNext: page < pageCount,
    total: data.length,
  };
}
