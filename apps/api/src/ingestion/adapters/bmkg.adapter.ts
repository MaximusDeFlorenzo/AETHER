import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { HazardType } from '../../common/enums/domain.enum';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import { BmkgGempa, BmkgGempaterkiniResponse } from './bmkg.types';

const GEMPATERKINI_URL =
  'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json';

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // clock skew tolerance

/**
 * First concrete `HazardDataSourceAdapter` — ports ORION's
 * `earthquakes/bmkg/{bmkg.client,bmkg.mapper}.ts` poll+map shape into the
 * generic adapter contract. Earthquake-only (BMKG's own scope); other
 * sources (`weather.adapter.ts`, `nasa-firms.adapter.ts`,
 * `sentinel.adapter.ts`) implement the same interface.
 */
@Injectable()
export class BmkgAdapter implements HazardDataSourceAdapter<BmkgGempa> {
  readonly sourceId = 'bmkg';

  private readonly logger = new Logger(BmkgAdapter.name);

  constructor(private readonly http: HttpService) {}

  /** Recent events list (typically last ~15). Returns [] (not a throw) on
   * network/parse failure — ingestion continuing to work on the next poll
   * is preferable to a hard crash on a flaky external feed. */
  async fetch(): Promise<BmkgGempa[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<BmkgGempaterkiniResponse>(GEMPATERKINI_URL, {
          timeout: 10_000,
        }),
      );
      return data.Infogempa.gempa;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch BMKG gempaterkini feed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  normalize(gempa: BmkgGempa): NormalizedHazardEvent {
    const [latitude, longitude] = gempa.Coordinates.split(',').map((v) =>
      Number.parseFloat(v.trim()),
    );
    // Preserve a leading minus sign so a malformed negative depth is parsed
    // as negative (and rejected by earthquake-details.shape's depthKm < 0
    // check) rather than silently losing its sign and passing as valid.
    const depthKm = Number.parseFloat(gempa.Kedalaman.replace(/[^\d.-]/g, ''));
    const magnitude = Number.parseFloat(gempa.Magnitude);
    const eventTime = new Date(gempa.DateTime);

    // `Potensi` isn't always a tsunami statement — on BMKG's feed it can
    // instead read something like "Gempa ini dirasakan untuk diteruskan pada
    // masyarakat" (a felt-report notice unrelated to tsunami risk). Only
    // treat it as a tsunami warning if it explicitly says "tsunami" without
    // "tidak" ("not").
    const potensiLower = gempa.Potensi?.toLowerCase() ?? '';
    const potentialTsunami =
      potensiLower.includes('tsunami') && !potensiLower.includes('tidak');

    const region =
      gempa.Wilayah?.split(',').slice(-1)[0]?.trim() ?? gempa.Wilayah;

    return {
      hazardType: HazardType.EARTHQUAKE,
      externalId: gempa.DateTime,
      latitude,
      longitude,
      locationLabel: gempa.Wilayah,
      region,
      eventTime,
      source: 'bmkg_gempaterkini',
      rawPayload: gempa as unknown as Record<string, unknown>,
      details: { magnitude, depthKm, potentialTsunami },
    };
  }

  /** Extra source-specific sanity check beyond the generic earthquake
   * details/coordinate validation `HazardEventsService.ingestEvent()`
   * already performs — rejects payloads BMKG occasionally emits with a
   * garbled or future DateTime. */
  isEventTimePlausible(event: NormalizedHazardEvent): boolean {
    return (
      !Number.isNaN(event.eventTime.getTime()) &&
      event.eventTime.getTime() <= Date.now() + FUTURE_TOLERANCE_MS
    );
  }
}
