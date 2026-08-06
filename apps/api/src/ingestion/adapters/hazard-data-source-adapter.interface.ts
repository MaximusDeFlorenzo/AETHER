import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';

/**
 * Generalizes ORION's `bmkg.client.ts`/`bmkg.mapper.ts` poll -> validate ->
 * dedupe -> map shape into a pluggable interface any external hazard data
 * source implements. `IngestionRegistryService` holds one instance per
 * `sourceId`; `IngestionScheduler` calls `fetch()` + `normalize()` on a
 * schedule and per manual trigger (`POST /hazard-events/:source/sync`).
 */
export interface HazardDataSourceAdapter<TRaw = unknown> {
  readonly sourceId: string;

  /** Poll (or otherwise retrieve) raw events from the external source.
   * Returns an empty array — never throws — on a network/parse failure, so
   * a flaky external feed never crashes the scheduler; the adapter itself
   * is responsible for warning-logging the failure. */
  fetch(): Promise<TRaw[]>;

  /** Pure mapping from the source's raw shape to the hazard-agnostic
   * envelope + hazard-specific `details` bag `HazardEventsService.ingestEvent()`
   * expects. Validation of the mapped result happens downstream, not here. */
  normalize(raw: TRaw): NormalizedHazardEvent;
}
