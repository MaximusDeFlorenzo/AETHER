export interface EarthquakeDetailsShape {
  magnitude: number;
  depthKm: number;
  potentialTsunami: boolean;
}

/** Mirrors the `earthquake_details` CHECK constraints (docs/DATABASE_SCHEMA.md
 * §11): 0 < magnitude < 10, depth >= 0. Returns an error string, or null if
 * valid — same "validate, don't throw" shape ORION's BMKG mapper used. */
export function validateEarthquakeDetails(
  details: Partial<EarthquakeDetailsShape>,
): string | null {
  const { magnitude, depthKm } = details;
  if (
    typeof magnitude !== 'number' ||
    !Number.isFinite(magnitude) ||
    magnitude <= 0 ||
    magnitude >= 10
  ) {
    return `Invalid magnitude: ${String(magnitude)}`;
  }
  if (typeof depthKm !== 'number' || !Number.isFinite(depthKm) || depthKm < 0) {
    return `Invalid depth: ${String(depthKm)}`;
  }
  return null;
}
