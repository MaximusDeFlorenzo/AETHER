import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

// Real-time connectivity cue — `useRealtimeSync` (mounted once at shell
// level) keeps three WebSocket namespaces open for the lifetime of the app,
// so "Live" here reflects an actually-active subscription, not a static
// label. `updatedAt` is optional and meant to be fed a query's real
// `dataUpdatedAt` (React Query tracks this per-query) rather than any
// fabricated timestamp.
export function LiveIndicator({ updatedAt, className }: { updatedAt?: number | null; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 text-xs font-medium text-muted-foreground', className)}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
      </span>
      <span className="font-semibold tracking-wide text-success uppercase">Live</span>
      {updatedAt ? (
        <span className="hidden text-muted-foreground sm:inline">
          · Updated {formatDistanceToNow(updatedAt, { addSuffix: true })}
        </span>
      ) : null}
    </div>
  );
}
