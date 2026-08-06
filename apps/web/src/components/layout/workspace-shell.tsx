'use client';

import { useRealtimeSync } from '@/hooks/use-realtime-sync';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

// Renamed from ORION's CommandCenterShell (docs/MIGRATION_FROM_ORION.md) and
// generalized to host BOTH the public risk-intelligence surface and the
// authenticated analyst/agency workspace — the two route groups differ only
// in whether their layout.tsx wraps this in <AuthGuard>, not in shell markup.
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  useRealtimeSync();

  return (
    <div className="flex h-svh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
