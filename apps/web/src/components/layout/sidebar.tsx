'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, Radar } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { PUBLIC_NAV_ITEMS, WORKSPACE_NAV_ITEMS } from './nav-items';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Shared by both the `(public)` and `(workspace)` route groups' layouts (both
// render through WorkspaceShell) — the sidebar always shows the full route
// list; workspace items behind AuthGuard just show a lock affordance when
// signed out instead of being hidden, since clicking still correctly redirects
// to /admin/login rather than 404ing.
export function Sidebar() {
  const pathname = usePathname();
  const accessToken = useAuthStore((state) => state.accessToken);

  const renderItem = (item: NavItem, locked: boolean) => {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-sidebar-primary text-sidebar-primary-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1">{item.label}</span>
        {locked && <Lock className="h-3 w-3 opacity-50" />}
      </Link>
    );
  };

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
        <Radar className="h-5 w-5 text-brand-accent" />
        <span className="text-sm font-semibold tracking-wide">AETHER</span>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <div className="space-y-1">{PUBLIC_NAV_ITEMS.map((item) => renderItem(item, false))}</div>
        <div>
          <p className="px-3 pb-1 text-[10.5px] font-semibold tracking-wide text-sidebar-foreground/40 uppercase">
            Workspace
          </p>
          <div className="space-y-1">
            {WORKSPACE_NAV_ITEMS.map((item) => renderItem(item, !accessToken))}
          </div>
        </div>
      </nav>
      <div className="border-t border-sidebar-border px-5 py-3 text-xs text-sidebar-foreground/50">
        Multi-Hazard Risk Intelligence
      </div>
    </aside>
  );
}
