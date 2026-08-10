'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LogOut, Radar, ShieldCheck, User as UserIcon } from 'lucide-react';
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
import { useTheme } from '@/components/providers/theme-provider';
import { LiveIndicator } from '@/components/shared/live-indicator';
import { useLogout } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { MobileNav } from './mobile-nav';
import { NotificationBell } from './notification-bell';
import {
  NAV_GROUPS,
  PRIMARY_NAV_LINKS,
  SUSTAINABILITY_NAV_LINK,
  type NavGroup,
  type NavLink,
} from './nav-items';

function isActiveHref(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TopNavLink({ item, active }: { item: NavLink; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex h-full items-center gap-1.5 px-3 text-sm font-medium transition-colors',
        active ? 'text-primary' : 'text-foreground/70 hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {item.label}
      {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
    </Link>
  );
}

function TopNavGroup({ group, pathname }: { group: NavGroup; pathname: string }) {
  const active = group.items.some((item) => isActiveHref(pathname, item.href));
  const GroupIcon = group.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'relative flex h-full items-center gap-1.5 px-3 text-sm font-medium transition-colors',
              active ? 'text-primary' : 'text-foreground/70 hover:text-foreground',
            )}
          />
        }
      >
        <GroupIcon className="h-3.5 w-3.5" />
        {group.label}
        <ChevronDown className="h-3 w-3" />
        {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {group.items.map((item) => {
          const Icon = item.icon;
          const itemActive = isActiveHref(pathname, item.href);
          return (
            <DropdownMenuItem
              key={item.href}
              render={<Link href={item.href} />}
              className={itemActive ? 'bg-accent text-accent-foreground' : undefined}
            >
              <Icon className="h-4 w-4" /> {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function UserMenu() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const logout = useLogout();

  if (!accessToken || !user) {
    return (
      <Link
        href="/admin/login"
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        Admin
      </Link>
    );
  }

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => router.replace('/admin/login'),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="flex items-center gap-2 px-1.5 hover:bg-accent hover:text-accent-foreground"
            data-testid="user-menu-trigger"
          />
        }
      >
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
            {initials(user.fullName)}
          </AvatarFallback>
        </Avatar>
        <span className="hidden text-sm font-medium sm:inline">{user.fullName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {user.email} · {user.role.replace('_', ' ')}
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
  );
}

// Top navigation bar — replaces the old permanent orange sidebar (sidebar.tsx,
// now removed) with a white, ~72px-tall horizontal bar per the AI Risk
// Intelligence Platform brand refresh. Shared by both the `(public)` and
// `(workspace)` route groups' layouts (both render through WorkspaceShell).
// No auth check on the nav items themselves — clicking a workspace route
// while signed out still correctly redirects to /admin/login via AuthGuard.
export function TopNav() {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const logoSrc = resolvedTheme === 'dark' ? '/AETHER.svg' : '/logo.png';

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-4 sm:h-[72px] sm:px-6">
      <div className="flex h-full items-center gap-1">
        <MobileNav
          sections={[
            { items: PRIMARY_NAV_LINKS },
            ...NAV_GROUPS.map((group) => ({ label: group.label, items: group.items })),
            { items: [SUSTAINABILITY_NAV_LINK] },
          ]}
          brandIcon={Radar}
          brandLabel="AETHER"
          brandLogo={
            <Image
              src={logoSrc}
              alt="AETHER"
              width={132}
              height={53}
              unoptimized
              className="h-8 w-auto"
            />
          }
          triggerClassName="mr-1 hover:bg-accent hover:text-accent-foreground"
        />
        {/* Logo lives only in the mobile sheet (via brandLogo above) below
            `md` — showing it in the bar too left the wordmark doubled up
            next to the hamburger trigger on small screens. */}
        <Link href="/risk-map" className="hidden shrink-0 items-center gap-2 md:flex">
          <Image
            src={logoSrc}
            alt="AETHER"
            width={132}
            height={53}
            priority
            unoptimized
            className="h-8 w-auto sm:h-9"
          />
        </Link>

        <nav className="ml-4 hidden h-full items-center md:flex">
          {PRIMARY_NAV_LINKS.map((item) => (
            <TopNavLink key={item.href} item={item} active={isActiveHref(pathname, item.href)} />
          ))}
          {NAV_GROUPS.map((group) => (
            <TopNavGroup key={group.label} group={group} pathname={pathname} />
          ))}
          <TopNavLink
            item={SUSTAINABILITY_NAV_LINK}
            active={isActiveHref(pathname, SUSTAINABILITY_NAV_LINK.href)}
          />
        </nav>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <LiveIndicator className="mr-2 hidden lg:flex" />
        <ThemeToggle />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
