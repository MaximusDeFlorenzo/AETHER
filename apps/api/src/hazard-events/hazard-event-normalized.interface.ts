import { HazardType } from '../common/enums/domain.enum';
import type { HazardEventCreatedEvent } from '../common/events/domain-events';
import type { HazardEvent } from '../database/entities';

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

/** A newly persisted event plus the HAZARD_EVENT_CREATED payload it would
 * announce — see `HazardEventsService.ingestEventWithoutAnnouncing`. */
export interface IngestedHazardEvent {
  hazardEvent: HazardEvent;
  announcement: HazardEventCreatedEvent;
}
