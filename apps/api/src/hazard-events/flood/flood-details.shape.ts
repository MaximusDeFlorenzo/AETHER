export interface FloodDetailsShape {
  rainfallMm: number;
  waterLevelM: number;
  riverBasin?: string | null;
}

/** `rainfallMm`/`waterLevelM` are nullable at the DB layer
 * (docs/DATABASE_SCHEMA.md §13, flexibility for future adapters), but are
 * required here: they're exactly what apps/ai-engine's `FloodDetails`
 * schema requires to score risk (`app/schemas/predict.py`), so an event that
 * can't populate them can't be scored and shouldn't be ingested. `riverBasin`
 * is descriptive-only (feeds XAI narrative text) and stays optional. */
export function validateFloodDetails(
  details: Partial<FloodDetailsShape>,
): string | null {
  const { rainfallMm, waterLevelM } = details;
  if (
    typeof rainfallMm !== 'number' ||
    !Number.isFinite(rainfallMm) ||
    rainfallMm < 0
  ) {
    return `Invalid rainfallMm: ${String(rainfallMm)}`;
  }
  if (
    typeof waterLevelM !== 'number' ||
    !Number.isFinite(waterLevelM) ||
    waterLevelM < 0
  ) {
    return `Invalid waterLevelM: ${String(waterLevelM)}`;
  }
  return null;
}
