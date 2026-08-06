'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface MobileNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface MobileNavProps {
  items: readonly MobileNavItem[];
  brandIcon: LucideIcon;
  brandLabel: string;
  footer?: React.ReactNode;
}

// The desktop sidebars (`layout/sidebar.tsx`, `layout/admin-shell.tsx`) are
// `hidden md:flex` with no fallback — below `md` there was previously no way
// to reach navigation at all. This is that fallback: a hamburger trigger
// (rendered by the topbars, `md:hidden`) opening the same nav items in a
// Sheet, so mobile/tablet visitors aren't stranded.
export function MobileNav({ items, brandIcon: BrandIcon, brandLabel, footer }: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Buka navigasi" />}
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <BrandIcon className="h-5 w-5 text-primary" />
            {brandLabel}
          </SheetTitle>
        </SheetHeader>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
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
        {footer}
      </SheetContent>
    </Sheet>
  );
}
