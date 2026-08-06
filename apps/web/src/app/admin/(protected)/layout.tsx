import { AuthGuard } from '@/components/auth/auth-guard';
import { AdminShell } from '@/components/layout/admin-shell';

// Isolated admin area — user management/system settings only. The public
// and workspace route groups never import AdminShell.
export default function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AdminShell>{children}</AdminShell>
    </AuthGuard>
  );
}
