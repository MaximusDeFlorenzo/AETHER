import { HazardType } from '../common/enums/domain.enum';

/**
 * Output of an ingestion adapter's `normalize()` step (see
 * ingestion/adapters/hazard-data-source-adapter.interface.ts). Hazard-agnostic
 * envelope + a loosely-typed `details` bag shaped per hazardType — validated
 * and persisted into the matching `*_details` table by
 * `HazardEventsService.ingestEvent()`.
 */
export interface NormalizedHazardEvent {
  hazardType: HazardType;
  externalId: string;
  latitude: number;
  longitude: number;
  locationLabel: string | null;
  region: string | null;
  eventTime: Date;
  source: string;
  rawPayload: Record<string, unknown>;
  details: Record<string, unknown>;
}
