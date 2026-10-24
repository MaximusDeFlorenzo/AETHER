import { HazardType } from '../common/enums/domain.enum';

// What the reporter actually saw — deliberately finer than `HazardType`:
// a fire, the smoke from a fire and floodwater are different observations
// (a smoke report says nothing about where the fire is, and neither proves
// population exposure). Ground Intelligence M1 covers floods and
// wildfire/smoke only.
export enum GroundObservationType {
  FLOODWATER = 'floodwater',
  FIRE = 'fire',
  SMOKE = 'smoke',
}

export const HAZARD_TYPE_BY_OBSERVATION: Record<
  GroundObservationType,
  HazardType
> = {
  [GroundObservationType.FLOODWATER]: HazardType.FLOOD,
  [GroundObservationType.FIRE]: HazardType.WILDFIRE,
  [GroundObservationType.SMOKE]: HazardType.WILDFIRE,
};

// Review state of ONE community report (lib/transitions.ts holds the
// allowed moves). VERIFIED means a reviewer confirmed this observation — it
// is not event verification (a later `ground_events` concept), not public
// display approval, and never training eligibility on its own.
// UNVERIFIABLE: plausible but could not be confirmed either way; kept, not
// rejected.
export enum GroundReportStatus {
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  NEEDS_MORE_EVIDENCE = 'needs_more_evidence',
  CORROBORATED = 'corroborated',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  UNVERIFIABLE = 'unverifiable',
}

// The reporter's own impression, not an assessed severity.
export enum GroundReportSeverity {
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  SEVERE = 'severe',
}
