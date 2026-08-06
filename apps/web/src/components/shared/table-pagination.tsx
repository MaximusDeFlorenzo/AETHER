import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TablePaginationProps {
  page: number;
  pageCount: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPageChange: (page: number) => void;
}

export function TablePagination({
  page,
  pageCount,
  total,
  canPrev,
  canNext,
  onPageChange,
}: TablePaginationProps) {
  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between border-t border-border/60 pt-3">
      <p className="text-xs text-muted-foreground">
        Halaman {page} dari {pageCount} · {total.toLocaleString('id-ID')} baris
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          aria-label="Halaman berikutnya"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
