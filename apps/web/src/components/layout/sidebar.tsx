'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, PanelLeftClose, PanelLeftOpen, Radar } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
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
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  const renderItem = (item: NavItem, locked: boolean) => {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
        )}
      >
        {isActive && (
          <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-sidebar-primary" />
        )}
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1">{item.label}</span>
            {locked && <Lock className="h-3 w-3 opacity-50" />}
          </>
        )}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex',
        collapsed ? 'w-[68px]' : 'w-64',
      )}
    >
      <div
        className={cn(
          'flex h-16 items-center gap-2 border-b border-sidebar-border px-5',
          collapsed && 'justify-center px-0',
        )}
      >
        <Radar className="h-5 w-5 shrink-0 text-sidebar-foreground" />
        {!collapsed && <span className="text-sm font-semibold tracking-wide">AETHER</span>}
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <div className="space-y-1">{PUBLIC_NAV_ITEMS.map((item) => renderItem(item, false))}</div>
        <div>
          {!collapsed && (
            <p className="px-3 pb-1 text-[10.5px] font-semibold tracking-wide text-sidebar-foreground/40 uppercase">
              Workspace
            </p>
          )}
          <div className="space-y-1">
            {WORKSPACE_NAV_ITEMS.map((item) => renderItem(item, !accessToken))}
          </div>
        </div>
      </nav>
      <div className="border-t border-sidebar-border px-3 py-3">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            collapsed && 'justify-center',
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
