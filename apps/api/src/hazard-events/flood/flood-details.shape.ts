export interface FloodDetailsShape {
  rainfallMm?: number | null;
  waterLevelM: number;
  riverBasin?: string | null;
  /** 0-1 hazard-susceptibility value from BNPB's InaRISK `INDEKS_BAHAYA_BANJIR`
   * layer, looked up per event coordinate at ingestion time
   * (`bnpb-inarisk.client.ts`). Optional: only PetaBencana-sourced events
   * populate it; a lookup failure/coverage gap also leaves it null. */
  floodHazardIndex?: number | null;
}

/** `waterLevelM` is required: it's the primary, most-directly-observed
 * signal apps/ai-engine's `FloodDetails` scoring weighs most heavily
 * (`app/schemas/predict.py`, `flood.py`), so an event without it can't be
 * scored and shouldn't be ingested. `rainfallMm` is nullable — real-world
 * water-level-only sources exist (e.g. PetaBencana.id's flood gauge feed,
 * which reports gauge readings but no rainfall figure); ai-engine treats a
 * missing rainfall reading as "no known contribution" rather than rejecting
 * the event. `riverBasin` is descriptive-only (feeds XAI narrative text) and
 * stays optional too.
 *
 * `waterLevelM` may be negative: PetaBencana's real gauge feed reports some
 * reservoir stations (e.g. Jakarta's Waduk Pluit) relative to a below-datum
 * reference, so a legitimate low-risk reading can be a negative number —
 * `flood.py`'s `clamp()` floors it to a 0 contribution rather than rejecting
 * it, so this only range-checks for a finite number, not non-negativity. */
export function validateFloodDetails(
  details: Partial<FloodDetailsShape>,
): string | null {
  const { rainfallMm, waterLevelM, floodHazardIndex } = details;
  if (
    rainfallMm !== undefined &&
    rainfallMm !== null &&
    (!Number.isFinite(rainfallMm) || rainfallMm < 0)
  ) {
    return `Invalid rainfallMm: ${String(rainfallMm)}`;
  }
  if (typeof waterLevelM !== 'number' || !Number.isFinite(waterLevelM)) {
    return `Invalid waterLevelM: ${String(waterLevelM)}`;
  }
  if (
    floodHazardIndex !== undefined &&
    floodHazardIndex !== null &&
    (!Number.isFinite(floodHazardIndex) ||
      floodHazardIndex < 0 ||
      floodHazardIndex > 1)
  ) {
    return `Invalid floodHazardIndex: ${String(floodHazardIndex)}`;
  }
  return null;
}
