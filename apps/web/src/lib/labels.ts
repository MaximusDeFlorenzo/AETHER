import type {
  CvDetectionType,
  ExposureLevel,
  HazardType,
  NotificationType,
  PriorityLevel,
  RiskAssessmentStatus,
} from '@/types/domain';

// Centralized enum -> label mapping, reused across badges, tables, and
// detail views so the mapping only lives in one place (same discipline as
// ORION's lib/i18n/labels.ts, generalized to AETHER's multi-hazard vocab).
export const HAZARD_TYPE_LABELS: Record<HazardType, string> = {
  earthquake: 'Earthquake',
  landslide: 'Landslide',
  flood: 'Flood',
  wildfire: 'Wildfire',
};

export const ALL_HAZARD_TYPES: HazardType[] = ['earthquake', 'landslide', 'flood', 'wildfire'];

export const EXPOSURE_LEVEL_LABELS: Record<ExposureLevel, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  severe: 'Severe',
};

export const PRIORITY_LEVEL_LABELS: Record<PriorityLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const RISK_ASSESSMENT_STATUS_LABELS: Record<RiskAssessmentStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  failed: 'Failed',
};

export const CV_DETECTION_TYPE_LABELS: Record<CvDetectionType, string> = {
  flood: 'Flood',
  smoke: 'Smoke',
  fire: 'Fire',
  infra_damage: 'Infrastructure damage',
};

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  hazard_event_created: 'New Hazard Event',
  decision_recommendation_created: 'Decision Recommendation',
  hazard_relationship_detected: 'Cascading Hazard',
  system: 'System',
};
