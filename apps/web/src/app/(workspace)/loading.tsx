import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

// Shown inside the workspace shell while a route loads, so a sidebar click
// answers at once — in `next dev` the first visit to a route compiles it,
// which can take many seconds and otherwise looks like a dead link.
export default function WorkspaceLoading() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6" aria-busy="true">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[420px] w-full rounded-xl" />
    </div>
  );
}
