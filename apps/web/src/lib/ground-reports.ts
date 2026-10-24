import type { RoleName } from '@/types/domain';
import type {
  GroundObservationType,
  GroundReportSeverity,
  GroundReportStatus,
} from '@/types/ground-reports';

export const OBSERVATION_TYPE_LABELS: Record<GroundObservationType, string> = {
  floodwater: 'Floodwater',
  fire: 'Fire / flames',
  smoke: 'Smoke / haze',
};

export const GROUND_REPORT_STATUS_LABELS: Record<GroundReportStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  needs_more_evidence: 'Needs more evidence',
  corroborated: 'Corroborated',
  verified: 'Verified',
  rejected: 'Rejected',
  unverifiable: 'Unverifiable',
};

export const SEVERITY_LABELS: Record<GroundReportSeverity, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  severe: 'Severe',
};

export const STATUS_BADGE_VARIANT: Record<
  GroundReportStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  submitted: 'outline',
  under_review: 'secondary',
  needs_more_evidence: 'secondary',
  corroborated: 'secondary',
  verified: 'default',
  rejected: 'destructive',
  unverifiable: 'outline',
};

const TRIAGE: RoleName[] = ['analyst', 'agency_operator', 'admin'];
const DECIDE: RoleName[] = ['agency_operator', 'admin'];
const DECIDED: GroundReportStatus[] = ['verified', 'rejected', 'unverifiable'];

export interface ReviewAction {
  to: GroundReportStatus;
  label: string;
  reasonRequired: boolean;
  destructive?: boolean;
}

// Which buttons to show. The API (apps/api/src/ground-reports/lib/
// transitions.ts) is the authority; this only hides moves it would refuse.
export function availableReviewActions(
  status: GroundReportStatus,
  role: RoleName | undefined,
): ReviewAction[] {
  if (!role || !TRIAGE.includes(role)) return [];
  const canDecide = DECIDE.includes(role);
  const actions: ReviewAction[] = [];
  if (DECIDED.includes(status)) {
    if (canDecide) {
      actions.push({ to: 'under_review', label: 'Reopen', reasonRequired: true });
    }
    return actions;
  }
  if (status === 'submitted' || status === 'needs_more_evidence' || status === 'corroborated') {
    actions.push({ to: 'under_review', label: 'Start review', reasonRequired: false });
  }
  if (status === 'under_review') {
    actions.push(
      { to: 'needs_more_evidence', label: 'Request evidence', reasonRequired: true },
      { to: 'corroborated', label: 'Mark corroborated', reasonRequired: true },
    );
  }
  if (canDecide && (status === 'under_review' || status === 'corroborated')) {
    actions.push(
      { to: 'verified', label: 'Verify', reasonRequired: false },
      { to: 'unverifiable', label: 'Unverifiable', reasonRequired: true },
      { to: 'rejected', label: 'Reject', reasonRequired: true, destructive: true },
    );
  }
  return actions;
}
