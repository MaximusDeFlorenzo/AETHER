'use client';

import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { isActiveHref, TopbarBrand, type ShellBrand } from './app-sidebar';
import { ADMIN_NAV_ITEMS } from './nav-items';

// Admin-only header (user management area): the brand + sidebar toggle when
// the sidebar is collapsed, the current page, and the theme switch. The account menu lives in the sidebar footer.
export function AdminTopbar({ brand }: { brand: ShellBrand }) {
  const pathname = usePathname();
  const current = ADMIN_NAV_ITEMS.find((item) => isActiveHref(pathname, item.href));

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-2">
        <TopbarBrand brand={brand} />
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="hidden text-muted-foreground sm:inline">Admin</span>
          {current && (
            <>
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/60 sm:block" />
              <span className="truncate font-medium text-foreground">{current.label}</span>
            </>
          )}
        </nav>
      </div>
      <ThemeToggle />
    </header>
  );
}
