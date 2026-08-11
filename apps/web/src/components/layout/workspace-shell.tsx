'use client';

import { useRealtimeSync } from '@/hooks/use-realtime-sync';
import { EvacuationAlertDialog } from '@/components/shared/evacuation-alert-dialog';
import { TopNav } from './top-nav';

// Renamed from ORION's CommandCenterShell (docs/MIGRATION_FROM_ORION.md) and
// generalized to host BOTH the public risk-intelligence surface and the
// authenticated analyst/agency workspace — the two route groups differ only
// in whether their layout.tsx wraps this in <AuthGuard>, not in shell markup.
// Primary navigation lives in a top bar (`TopNav`) rather than a permanent
// sidebar — a page can still add its own compact, contextual sidebar where
// that genuinely helps (e.g. a filter rail), but it's no longer how users
// get around the app.
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  useRealtimeSync();

  return (
    <div className="flex min-h-svh flex-col">
      <TopNav />
      <main className="flex-1 bg-background">{children}</main>
      <EvacuationAlertDialog />
    </div>
  );
}
