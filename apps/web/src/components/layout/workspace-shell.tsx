'use client';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useRealtimeSync } from '@/hooks/use-realtime-sync';
import { useOngoingHazardAlerts } from '@/hooks/use-ongoing-hazard-alerts';
import { EvacuationAlertDialog } from '@/components/shared/evacuation-alert-dialog';
import { ShellSidebar, type ShellBrand } from './app-sidebar';
import { CITIZEN_PORTAL_LINK, SHELL_NAV_SECTIONS } from './nav-items';
import { TopNav } from './top-nav';

const BRAND: ShellBrand = { href: '/risk-map', title: 'AETHER', subtitle: 'Risk Intelligence' };

// Renamed from ORION's CommandCenterShell (docs/MIGRATION_FROM_ORION.md) and
// generalized to host BOTH the public risk-intelligence surface and the
// authenticated analyst/agency workspace — the two route groups differ only
// in whether their layout.tsx wraps this in <AuthGuard>, not in shell markup.
// Primary navigation and the account menu live in the shadcn sidebar
// (collapses to icons); `TopNav` is a slim bar for the sidebar toggle,
// location and live status. The brand moves into that bar while the
// sidebar is collapsed.
export function WorkspaceShell({ children, defaultOpen = true }: { children: React.ReactNode; defaultOpen?: boolean }) {
  useRealtimeSync();
  useOngoingHazardAlerts();

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ShellSidebar brand={BRAND} sections={SHELL_NAV_SECTIONS} footerLinks={[CITIZEN_PORTAL_LINK]} />
      <SidebarInset className="min-w-0 overflow-x-clip">
        <TopNav brand={BRAND} />
        <div className="flex-1 bg-background">{children}</div>
      </SidebarInset>
      <EvacuationAlertDialog />
    </SidebarProvider>
  );
}
