import { WorkspaceShell } from '@/components/layout/workspace-shell';

// Public route group — no auth. Hosts the risk map, hazard event feed, and
// sustainability dashboard for both the general public and government
// agencies; only the isolated `/admin` area and the `(workspace)` analyst
// routes require a login (docs/MIGRATION_FROM_ORION.md's public/protected
// split).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
