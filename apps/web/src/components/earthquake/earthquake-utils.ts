import { EARTHQUAKE_MAGNITUDE_COLORS } from '@/lib/chart-colors';
import type { EarthquakeDetails, HazardEvent } from '@/types/domain';

export type MagnitudeClass = keyof typeof EARTHQUAKE_MAGNITUDE_COLORS;

export const MAGNITUDE_CLASSES: MagnitudeClass[] = ['MINOR', 'LIGHT', 'MODERATE', 'STRONG', 'MAJOR'];

export const MAGNITUDE_LABEL: Record<MagnitudeClass, string> = {
  MINOR: 'Minor (< 4)',
  LIGHT: 'Light (4–4.9)',
  MODERATE: 'Moderate (5–5.9)',
  STRONG: 'Strong (6–6.9)',
  MAJOR: 'Major (≥ 7)',
};

export const MAGNITUDE_RANK: Record<MagnitudeClass, number> = { MINOR: 0, LIGHT: 1, MODERATE: 2, STRONG: 3, MAJOR: 4 };

export function magnitudeClass(magnitude: number): MagnitudeClass {
  if (magnitude >= 7) return 'MAJOR';
  if (magnitude >= 6) return 'STRONG';
  if (magnitude >= 5) return 'MODERATE';
  if (magnitude >= 4) return 'LIGHT';
  return 'MINOR';
}

export const magnitudeColor = (magnitude: number) => EARTHQUAKE_MAGNITUDE_COLORS[magnitudeClass(magnitude)];

// BMKG / USGS convention: shallow < 70 km, intermediate 70–300 km, deep > 300 km.
// Shallow quakes do far more surface damage at the same magnitude.
export type DepthClass = 'shallow' | 'intermediate' | 'deep';

export function depthClass(depthKm: number): DepthClass {
  if (depthKm < 70) return 'shallow';
  if (depthKm <= 300) return 'intermediate';
  return 'deep';
}

export const DEPTH_LABEL: Record<DepthClass, string> = {
  shallow: 'Shallow (< 70 km)',
  intermediate: 'Intermediate (70–300 km)',
  deep: 'Deep (> 300 km)',
};

export interface EarthquakeEvent extends HazardEvent {
  details: EarthquakeDetails;
}

/** Narrows a hazard event to an earthquake with usable details. */
export function isEarthquake(e: HazardEvent): e is EarthquakeEvent {
  const d = e.details as Partial<EarthquakeDetails> | null;
  return e.hazardType === 'earthquake' && typeof d?.magnitude === 'number' && typeof d?.depthKm === 'number';
}

export const formatMagnitude = (m: number) => `M ${m.toFixed(1)}`;

export const isSimulated = (e: HazardEvent) => e.source === 'simulation';
