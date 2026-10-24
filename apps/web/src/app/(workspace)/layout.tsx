import { AuthGuard } from '@/components/auth/auth-guard';
import { sidebarDefaultOpen } from '@/components/layout/sidebar-state';
import { WorkspaceShell } from '@/components/layout/workspace-shell';

// New in AETHER — ORION's whole command-center was public. These routes
// (risk-assessments/decision-intelligence/resource-planning/analytics) are
// restricted to authenticated analyst/agency users per
// docs/API_SPEC.md's guard posture (`JwtAuthGuard` only, any authenticated
// role) — same shell as `(public)`, just wrapped in AuthGuard.
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <WorkspaceShell defaultOpen={await sidebarDefaultOpen()}>{children}</WorkspaceShell>
    </AuthGuard>
  );
}
