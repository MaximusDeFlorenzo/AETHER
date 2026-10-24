'use client';

import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { LiveIndicator } from '@/components/shared/live-indicator';
import { NotificationBell } from './notification-bell';
import { isActiveHref, TopbarBrand, type ShellBrand } from './app-sidebar';
import { SHELL_NAV_SECTIONS } from './nav-items';

function currentLocation(pathname: string) {
  for (const section of SHELL_NAV_SECTIONS) {
    const item = section.items.find((it) => isActiveHref(pathname, it.href));
    if (item) return { section: section.label, label: item.label };
  }
  return null;
}

// Slim bar above the page content. Primary navigation and the account menu
// live in the sidebar (a sheet on mobile, toggled by the trigger here); this
// bar keeps the page location and live status. Shared by both the `(public)`
// and `(workspace)` route groups (both render through WorkspaceShell). No
// auth check on nav items — a signed-out click on a workspace route still
// redirects to /admin/login via AuthGuard.
export function TopNav({ brand }: { brand: ShellBrand }) {
  const pathname = usePathname();
  const location = currentLocation(pathname);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-sm sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <TopbarBrand brand={brand} />
        {location && (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
            {location.section && (
              <>
                <span className="hidden text-muted-foreground sm:inline">{location.section}</span>
                <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/60 sm:block" />
              </>
            )}
            <span className="truncate font-medium text-foreground">{location.label}</span>
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <LiveIndicator className="mr-2 hidden md:flex" />
        <ThemeToggle />
        <NotificationBell />
      </div>
    </header>
  );
}
