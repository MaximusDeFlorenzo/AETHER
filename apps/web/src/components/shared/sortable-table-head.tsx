import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import type { SortDirection } from '@/hooks/use-sortable-data';
import { cn } from '@/lib/utils';

interface SortableTableHeadProps<K extends string> {
  sortKey: K;
  label: string;
  activeKey: K | null;
  direction: SortDirection;
  onSort: (key: K) => void;
  className?: string;
}

export function SortableTableHead<K extends string>({
  sortKey,
  label,
  activeKey,
  direction,
  onSort,
  className,
}: SortableTableHeadProps<K>) {
  const isActive = activeKey === sortKey;
  const Icon = isActive ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 text-left font-medium transition-colors hover:text-foreground',
          isActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
        <Icon className={cn('h-3.5 w-3.5', !isActive && 'opacity-40')} />
      </button>
    </TableHead>
  );
}
