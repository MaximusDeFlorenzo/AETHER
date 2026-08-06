export interface LandslideDetailsShape {
  slopeDegrees?: number | null;
  soilSaturation?: number | null;
  triggeringRainfallMm?: number | null;
}

/** All landslide detail fields are nullable in the schema (unlike earthquake's
 * required magnitude/depth) — a landslide can be reported (e.g. by a field
 * reporter) without any of these instrument readings, so validation here only
 * rejects out-of-range values when present rather than requiring them. */
export function validateLandslideDetails(
  details: Partial<LandslideDetailsShape>,
): string | null {
  const { slopeDegrees, soilSaturation, triggeringRainfallMm } = details;
  if (
    slopeDegrees !== undefined &&
    slopeDegrees !== null &&
    (!Number.isFinite(slopeDegrees) || slopeDegrees < 0 || slopeDegrees > 90)
  ) {
    return `Invalid slopeDegrees: ${String(slopeDegrees)}`;
  }
  if (
    soilSaturation !== undefined &&
    soilSaturation !== null &&
    (!Number.isFinite(soilSaturation) ||
      soilSaturation < 0 ||
      soilSaturation > 1)
  ) {
    return `Invalid soilSaturation: ${String(soilSaturation)}`;
  }
  if (
    triggeringRainfallMm !== undefined &&
    triggeringRainfallMm !== null &&
    (!Number.isFinite(triggeringRainfallMm) || triggeringRainfallMm < 0)
  ) {
    return `Invalid triggeringRainfallMm: ${String(triggeringRainfallMm)}`;
  }
  return null;
}
