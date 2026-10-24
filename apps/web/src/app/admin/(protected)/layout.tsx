import { AuthGuard } from '@/components/auth/auth-guard';
import { AdminShell } from '@/components/layout/admin-shell';
import { sidebarDefaultOpen } from '@/components/layout/sidebar-state';

// Isolated admin area — user management/system settings only. The public
// and workspace route groups never import AdminShell.
export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AdminShell defaultOpen={await sidebarDefaultOpen()}>{children}</AdminShell>
    </AuthGuard>
  );
}
