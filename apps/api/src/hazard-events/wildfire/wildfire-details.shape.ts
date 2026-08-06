export interface WildfireDetailsShape {
  frpConfidence: number;
  hotspotCount: number;
  brightnessKelvin?: number | null;
}

/** `frpConfidence`/`hotspotCount` are nullable at the DB layer
 * (docs/DATABASE_SCHEMA.md §14, flexibility for future adapters), but are
 * required here: they're exactly what apps/ai-engine's `WildfireDetails`
 * schema requires to score risk (`app/schemas/predict.py`), so an event that
 * can't populate them can't be scored and shouldn't be ingested.
 * `brightnessKelvin` is descriptive-only and stays optional. */
export function validateWildfireDetails(
  details: Partial<WildfireDetailsShape>,
): string | null {
  const { frpConfidence, hotspotCount } = details;
  if (
    typeof frpConfidence !== 'number' ||
    !Number.isFinite(frpConfidence) ||
    frpConfidence < 0 ||
    frpConfidence > 1
  ) {
    return `Invalid frpConfidence: ${String(frpConfidence)}`;
  }
  if (
    typeof hotspotCount !== 'number' ||
    !Number.isInteger(hotspotCount) ||
    hotspotCount < 0
  ) {
    return `Invalid hotspotCount: ${String(hotspotCount)}`;
  }
  return null;
}
