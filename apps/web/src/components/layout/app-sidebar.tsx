'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeft } from 'lucide-react';
import { BrandMark as LogoMark } from '@/components/shared/brand-logo';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { usePendingHelp } from '@/hooks/use-public-alerts';
import { cn } from '@/lib/utils';
import { NavUser } from './nav-user';
import type { NavLink, NavSection } from './nav-items';

export function isActiveHref(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const HELP_REQUESTS_HREF = '/help-requests';

/** Red count of citizens still waiting for help (also a red dot on the
 * collapsed icon rail). Only fetched for signed-in staff. */
function HelpRequestBadge() {
  const { total } = usePendingHelp();
  if (total === 0) return null;
  return (
    <>
      <SidebarMenuBadge className="rounded-full bg-alarm text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white">
        {total > 99 ? '99+' : total}
      </SidebarMenuBadge>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 right-1 hidden h-2 w-2 rounded-full bg-alarm group-data-[collapsible=icon]:block"
      />
    </>
  );
}

function NavMenuLink({ item, active }: { item: NavLink; active: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const Icon = item.icon;
  const badge = item.href === HELP_REQUESTS_HREF ? <HelpRequestBadge /> : null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        render={
          <Link
            href={item.href}
            aria-current={active ? 'page' : undefined}
            onClick={() => isMobile && setOpenMobile(false)}
          />
        }
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
      {badge}
    </SidebarMenuItem>
  );
}

export interface ShellBrand {
  href: string;
  title: string;
  subtitle: string;
}

function BrandMark({ brand, className }: { brand: ShellBrand; className?: string }) {
  return (
    <Link href={brand.href} aria-label={brand.title} className={cn('flex min-w-0 items-center gap-2', className)}>
      <LogoMark priority className="h-6 shrink-0" />
      <span className="grid min-w-0 text-left text-sm leading-tight">
        <span className="truncate font-semibold tracking-wide">{brand.title}</span>
        <span className="truncate text-xs opacity-60">{brand.subtitle}</span>
      </span>
    </Link>
  );
}

// Leading slot of the top bars. While the sidebar is open on desktop the
// brand sits in the sidebar header; once it is collapsed (or on mobile,
// where the sidebar is a sheet) it moves up here. The toggle only comes
// along on mobile — collapsed, it heads the sidebar's icon rail instead.
export function TopbarBrand({ brand }: { brand: ShellBrand }) {
  const { state, isMobile } = useSidebar();
  if (!isMobile && state === 'expanded') return null;
  return (
    <div className="flex shrink-0 items-center gap-2">
      {isMobile && <SidebarTrigger className="-ml-1" />}
      <BrandMark brand={brand} className="[&>span:last-child]:hidden sm:[&>span:last-child]:grid" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
    </div>
  );
}

interface ShellSidebarProps {
  brand: ShellBrand;
  sections: NavSection[];
  /** Links pinned above the account menu (e.g. the citizen portal). */
  footerLinks?: NavLink[];
}

// shadcn Sidebar (collapsible to icons, ⌘/Ctrl+B or the rail toggles it;
// a sheet below `md`) shared by the workspace and admin shells — only the
// brand row and the nav sections differ.
export function ShellSidebar({ brand, sections, footerLinks = [] }: ShellSidebarProps) {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="h-14 flex-row items-center justify-between border-b border-sidebar-border px-3 group-data-[collapsible=icon]:hidden">
        <BrandMark brand={brand} />
        <SidebarTrigger className="shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
      </SidebarHeader>
      <SidebarHeader className="hidden h-14 items-center justify-center border-b border-sidebar-border group-data-[collapsible=icon]:flex">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Buka sidebar" onClick={toggleSidebar}>
              <PanelLeft />
              <span>Buka sidebar</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section, i) => (
          <SidebarGroup key={section.label ?? i}>
            {section.label && <SidebarGroupLabel>{section.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {section.items.map((item) => (
                <NavMenuLink key={item.href} item={item} active={isActiveHref(pathname, item.href)} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {footerLinks.length > 0 && (
          <SidebarMenu>
            {footerLinks.map((item) => (
              <NavMenuLink key={item.href} item={item} active={false} />
            ))}
          </SidebarMenu>
        )}
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
