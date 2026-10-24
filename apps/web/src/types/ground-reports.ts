import type { HazardType } from './domain';

// Mirrors apps/api/src/ground-reports (AETHER Ground Intelligence M1).

export type GroundObservationType = 'floodwater' | 'fire' | 'smoke';

export type GroundReportStatus =
  | 'submitted'
  | 'under_review'
  | 'needs_more_evidence'
  | 'corroborated'
  | 'verified'
  | 'rejected'
  | 'unverifiable';

export type GroundReportSeverity = 'low' | 'moderate' | 'high' | 'severe';

export interface GroundReportSummary {
  id: string;
  observationType: GroundObservationType;
  hazardType: HazardType;
  status: GroundReportStatus;
  latitude: number;
  longitude: number;
  nearestDistrict: { id: string; name: string } | null;
  observedAt: string;
  submittedAt: string;
  waterDepthCm: number | null;
  reporterSeverity: GroundReportSeverity | null;
  evidenceCount: number;
  updatedAt: string;
  // Reviewer-only fields (absent for field reporters).
  reporter?: { id: string; fullName: string | null };
  duplicateOfId?: string | null;
  trainingEligible?: boolean;
  lastReviewedById?: string | null;
  lastReviewedAt?: string | null;
}

export interface GroundReportEvidence {
  id: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  imageUrl: string;
  // Reviewer-only
  sha256?: string;
  exif?: {
    dateTimeOriginal: string | null;
    offsetTimeOriginal: string | null;
    gps: { latitude: number; longitude: number } | null;
  } | null;
  cvHint?: {
    modelVersion: string;
    detections: Array<{ detectionType: string; confidenceScore: number }>;
  } | null;
  duplicateOfEvidenceId?: string | null;
}

export interface GroundReportStatusChange {
  fromStatus: GroundReportStatus | null;
  toStatus: GroundReportStatus;
  reason: string | null;
  createdAt: string;
  // Reviewer-only
  id?: string;
  actorUserId?: string;
  notes?: string | null;
}

export interface GroundReportDetail extends GroundReportSummary {
  description: string;
  evidence: GroundReportEvidence[];
  statusHistory: GroundReportStatusChange[];
}

export interface GroundReportSubmissionInput {
  observationType: GroundObservationType;
  latitude: number;
  longitude: number;
  observedAt: string;
  description: string;
  waterDepthCm?: number;
  reporterSeverity?: GroundReportSeverity;
  images: File[];
}
