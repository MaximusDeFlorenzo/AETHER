'use client';

import Link from 'next/link';
import { Radar, ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { MobileNav } from './mobile-nav';
import { ALL_SHELL_NAV_ITEMS } from './nav-items';
import { NotificationBell } from './notification-bell';

// Shared topbar for both `(public)` and `(workspace)` route groups — no
// login/user menu here (generalizes ORION's public-topbar.tsx). The only
// nod to auth is a small, unobtrusive link into the isolated `/admin` area.
export function Topbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 sm:px-6">
      <MobileNav items={ALL_SHELL_NAV_ITEMS} brandIcon={Radar} brandLabel="AETHER" />
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <NotificationBell />
        <Link
          href="/admin/login"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Admin
        </Link>
      </div>
    </header>
  );
}
