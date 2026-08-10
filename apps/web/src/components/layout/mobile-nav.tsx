'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { NavLink } from './nav-items';

interface MobileNavSection {
  label?: string;
  items: NavLink[];
}

interface MobileNavProps {
  sections: MobileNavSection[];
  brandIcon: LucideIcon;
  brandLabel: string;
  /** Overrides the default icon+label brand row (e.g. the AETHER logo
   * image) — the top nav's wordmark lives only here on mobile, not in the
   * bar itself, so it renders once instead of twice on small screens. */
  brandLogo?: React.ReactNode;
  triggerClassName?: string;
  footer?: React.ReactNode;
}

// The desktop nav (`layout/top-nav.tsx`, `layout/admin-shell.tsx`) is
// `hidden md:flex` with no fallback — below `md` there was previously no way
// to reach navigation at all. This is that fallback: a hamburger trigger
// (rendered by the topbars, `md:hidden`) opening the same nav items — now
// grouped into labeled sections mirroring the desktop dropdowns — in a
// Sheet, so mobile/tablet visitors aren't stranded.
export function MobileNav({
  sections,
  brandIcon: BrandIcon,
  brandLabel,
  brandLogo,
  triggerClassName,
  footer,
}: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn('md:hidden', triggerClassName)}
            aria-label="Open navigation"
          />
        }
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            {brandLogo ?? (
              <>
                <BrandIcon className="h-5 w-5 text-primary" />
                {brandLabel}
              </>
            )}
          </SheetTitle>
        </SheetHeader>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {sections.map((section, i) => (
            <div key={section.label ?? i} className="space-y-1">
              {section.label && (
                <p className="px-3 pb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
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
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground/70 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        {footer}
      </SheetContent>
    </Sheet>
  );
}
