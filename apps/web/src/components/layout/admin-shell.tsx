'use client';

import { ArrowLeft } from 'lucide-react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AdminTopbar } from './admin-topbar';
import { ShellSidebar, type ShellBrand } from './app-sidebar';
import { ADMIN_NAV_ITEMS } from './nav-items';

const BRAND: ShellBrand = { href: '/admin/settings', title: 'Admin AETHER', subtitle: 'User management' };
const BACK_LINK = { href: '/risk-map', label: 'Back to dashboard', icon: ArrowLeft };

export function AdminShell({ children, defaultOpen = true }: { children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <ShellSidebar brand={BRAND} sections={[{ label: 'Admin', items: ADMIN_NAV_ITEMS }]} footerLinks={[BACK_LINK]} />
      <SidebarInset className="min-w-0">
        <AdminTopbar brand={BRAND} />
        <div className="flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
