'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AdminTopbar } from './admin-topbar';
import { ADMIN_NAV_ITEMS } from './nav-items';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-svh overflow-hidden">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <ShieldCheck className="h-5 w-5 text-brand-accent" />
          <span className="text-sm font-semibold tracking-wide">Admin AETHER</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {ADMIN_NAV_ITEMS.map((item) => {
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
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border px-5 py-3">
          <Link href="/risk-map" className="text-xs text-sidebar-foreground/50 hover:underline">
            ← Back to public dashboard
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
