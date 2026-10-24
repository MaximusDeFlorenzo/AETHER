import { haversineKm } from '../../karhutla-prediction/lib/geo';
import { GroundObservationType } from '../ground-report.enums';

// Generous envelope around Indonesia's land and territorial waters
// (Sabang ~95°E to Merauke ~141°E, Miangas ~5.6°N to Rote ~11°S). A coarse
// sanity bound against swapped/garbage coordinates, not a border test.
export const INDONESIA_BOUNDS = {
  minLatitude: -11.5,
  maxLatitude: 6.5,
  minLongitude: 94.5,
  maxLongitude: 141.5,
};

/** Tolerated device clock skew for "observed in the future". */
export const OBSERVED_AT_MAX_FUTURE_MS = 10 * 60 * 1000;
/** Older observations belong in a historical import, not a live report. */
export const OBSERVED_AT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const DUPLICATE_RADIUS_KM = 0.05;
export const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

export function isWithinIndonesia(
  latitude: number,
  longitude: number,
): boolean {
  const b = INDONESIA_BOUNDS;
  return (
    latitude >= b.minLatitude &&
    latitude <= b.maxLatitude &&
    longitude >= b.minLongitude &&
    longitude <= b.maxLongitude
  );
}

export function observedAtProblem(
  observedAt: Date,
  now: Date,
): 'invalid' | 'in_future' | 'too_old' | null {
  const t = observedAt.getTime();
  if (Number.isNaN(t)) return 'invalid';
  if (t > now.getTime() + OBSERVED_AT_MAX_FUTURE_MS) return 'in_future';
  if (t < now.getTime() - OBSERVED_AT_MAX_AGE_MS) return 'too_old';
  return null;
}

export interface DuplicateCandidate {
  id: string;
  observationType: GroundObservationType;
  latitude: number;
  longitude: number;
  submittedAt: Date;
}

/**
 * The same reporter re-sending the same observation (double tap, retry on
 * a flaky connection): same type, within 50 m, within 30 min of an earlier
 * submission. Returns the earliest match. Such a report is still stored —
 * flagged `duplicate_of`, never silently dropped — so a reviewer can tell
 * a resend from a genuinely new observation.
 */
export function findDuplicateOf(
  report: {
    observationType: GroundObservationType;
    latitude: number;
    longitude: number;
    submittedAt: Date;
  },
  earlier: DuplicateCandidate[],
): string | null {
  const matches = earlier
    .filter(
      (c) =>
        c.observationType === report.observationType &&
        Math.abs(report.submittedAt.getTime() - c.submittedAt.getTime()) <=
          DUPLICATE_WINDOW_MS &&
        haversineKm(
          c.latitude,
          c.longitude,
          report.latitude,
          report.longitude,
        ) <= DUPLICATE_RADIUS_KM,
    )
    .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  return matches[0]?.id ?? null;
}
