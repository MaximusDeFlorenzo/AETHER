'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, ShieldCheck, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useLogout } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { MobileNav } from './mobile-nav';
import { ADMIN_NAV_ITEMS } from './nav-items';

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Admin-only header (user management area) — the public/workspace shell's
// header is `Topbar`, which carries no user/session context at all.
export function AdminTopbar() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const logout = useLogout();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => router.replace('/admin/login'),
    });
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 sm:px-6">
      <div className="flex items-center gap-2">
        <MobileNav
          sections={[{ items: ADMIN_NAV_ITEMS }]}
          brandIcon={ShieldCheck}
          brandLabel="Admin AETHER"
          triggerClassName="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          footer={
            <div className="border-t border-sidebar-border px-5 py-3">
              <Link href="/risk-map" className="text-xs text-sidebar-foreground/50 hover:underline">
                ← Back to public dashboard
              </Link>
            </div>
          }
        />
        <span className="text-sm font-semibold text-sidebar-foreground/70">Admin AETHER</span>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="flex items-center gap-2 px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                data-testid="user-menu-trigger"
              />
            }
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-accent-foreground">
                {user ? initials(user.fullName) : <UserIcon className="h-4 w-4" />}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium sm:inline">{user?.fullName}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {user?.email} · {user?.role.replace('_', ' ')}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/admin/profile')}>
                <UserIcon className="mr-2 h-4 w-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Log out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
