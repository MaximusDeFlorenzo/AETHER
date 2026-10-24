import { RoleName } from '../../common/enums/roles.enum';
import { GroundReportStatus as S } from '../ground-report.enums';

/**
 * Review state machine for a community ground report. Pure: the service
 * applies a permitted move with a compare-and-swap UPDATE, so two reviewers
 * acting on the same report cannot both win.
 *
 * Triage (taking a report into review, asking for evidence, marking it
 * corroborated) is open to analysts; deciding a report (verified, rejected,
 * unverifiable) and reopening a decided one need an agency operator or
 * admin. Field reporters never move a report — adding evidence to their own
 * report is a separate endpoint (see GroundReportsService.addEvidence).
 */

const TRIAGE_ROLES: readonly RoleName[] = [
  RoleName.ANALYST,
  RoleName.AGENCY_OPERATOR,
  RoleName.ADMIN,
];
const DECISION_ROLES: readonly RoleName[] = [
  RoleName.AGENCY_OPERATOR,
  RoleName.ADMIN,
];

const DECIDED: readonly S[] = [S.VERIFIED, S.REJECTED, S.UNVERIFIABLE];

interface TransitionRule {
  from: readonly S[];
  roles: readonly RoleName[];
  reasonRequired: boolean;
}

const RULES: Record<S, TransitionRule | null> = {
  [S.SUBMITTED]: null,
  // From NEEDS_MORE_EVIDENCE / CORROBORATED this is "back to review";
  // from a decided state it is a reopen — see ruleFor().
  [S.UNDER_REVIEW]: {
    from: [S.SUBMITTED, S.NEEDS_MORE_EVIDENCE, S.CORROBORATED],
    roles: TRIAGE_ROLES,
    reasonRequired: false,
  },
  [S.NEEDS_MORE_EVIDENCE]: {
    from: [S.UNDER_REVIEW],
    roles: TRIAGE_ROLES,
    reasonRequired: true,
  },
  [S.CORROBORATED]: {
    from: [S.UNDER_REVIEW],
    roles: TRIAGE_ROLES,
    reasonRequired: true,
  },
  [S.VERIFIED]: {
    from: [S.UNDER_REVIEW, S.CORROBORATED],
    roles: DECISION_ROLES,
    reasonRequired: false,
  },
  [S.REJECTED]: {
    from: [S.UNDER_REVIEW, S.CORROBORATED],
    roles: DECISION_ROLES,
    reasonRequired: true,
  },
  [S.UNVERIFIABLE]: {
    from: [S.UNDER_REVIEW, S.CORROBORATED],
    roles: DECISION_ROLES,
    reasonRequired: true,
  },
};

const REOPEN_RULE: TransitionRule = {
  from: DECIDED,
  roles: DECISION_ROLES,
  reasonRequired: true,
};

function ruleFor(from: S, to: S): TransitionRule | null {
  if (to === S.UNDER_REVIEW && DECIDED.includes(from)) return REOPEN_RULE;
  const rule = RULES[to];
  return rule && rule.from.includes(from) ? rule : null;
}

export type TransitionCheck =
  | { ok: true; reopen: boolean }
  | { ok: false; code: 'invalid_transition' | 'forbidden' | 'reason_required' };

export function checkTransition(input: {
  from: S;
  to: S;
  role: RoleName;
  reason?: string | null;
}): TransitionCheck {
  const rule = ruleFor(input.from, input.to);
  if (!rule) return { ok: false, code: 'invalid_transition' };
  if (!rule.roles.includes(input.role)) return { ok: false, code: 'forbidden' };
  if (rule.reasonRequired && !input.reason?.trim()) {
    return { ok: false, code: 'reason_required' };
  }
  return { ok: true, reopen: rule === REOPEN_RULE };
}

/** States in which the reporter may still attach evidence. */
export const EVIDENCE_OPEN_STATES: readonly S[] = [
  S.SUBMITTED,
  S.NEEDS_MORE_EVIDENCE,
];

export function isReviewer(role: RoleName): boolean {
  return TRIAGE_ROLES.includes(role);
}
