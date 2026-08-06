import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HazardType } from '../../common/enums/domain.enum';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import { FirmsHotspot } from './nasa-firms.types';

// west,south,east,north — covers Indonesia with margin, per FIRMS Area API's
// bbox format (https://firms.modaps.eosdis.nasa.gov/api/area/).
const INDONESIA_BBOX = '94,-12,142,7';
// MODIS_NRT reports confidence as a 0-100 percentage (unlike VIIRS sources,
// which use categorical low/nominal/high) — simplest to map directly to
// apps/ai-engine's 0-1 `frpConfidence`.
const FIRMS_SOURCE = 'MODIS_NRT';
const DAY_RANGE = 1;

/**
 * Second concrete `HazardDataSourceAdapter`, alongside `BmkgAdapter` — polls
 * NASA FIRMS' public Area API for active fire/thermal-anomaly hotspots over
 * Indonesia. No ORION equivalent (ORION never ingested satellite data).
 *
 * v0 simplification: each CSV row (one hotspot detection) becomes its own
 * wildfire hazard event with `hotspotCount: 1`, rather than spatially
 * clustering same-pass detections into fewer, larger fire events. Dedup via
 * the usual `(externalId, source)` unique constraint still prevents the same
 * detection being ingested twice across polls.
 */
@Injectable()
export class NasaFirmsAdapter implements HazardDataSourceAdapter<FirmsHotspot> {
  readonly sourceId = 'nasa_firms';

  private readonly logger = new Logger(NasaFirmsAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async fetch(): Promise<FirmsHotspot[]> {
    const apiKey = this.config.get<string>('NASA_FIRMS_API_KEY');
    if (!apiKey) {
      this.logger.debug('NASA_FIRMS_API_KEY not configured — skipping poll');
      return [];
    }
    const baseUrl = this.config.get<string>('NASA_FIRMS_BASE_URL');
    const url = `${baseUrl}/area/csv/${apiKey}/${FIRMS_SOURCE}/${INDONESIA_BBOX}/${DAY_RANGE}`;

    try {
      const { data } = await firstValueFrom(
        this.http.get<string>(url, { timeout: 15_000, responseType: 'text' }),
      );
      return parseFirmsCsv(data);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch NASA FIRMS hotspot feed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  normalize(hotspot: FirmsHotspot): NormalizedHazardEvent {
    const latitude = Number.parseFloat(hotspot.latitude);
    const longitude = Number.parseFloat(hotspot.longitude);
    const brightnessKelvin = Number.parseFloat(hotspot.brightness);
    // MODIS_NRT confidence is already 0-100; other FIRMS sources report it
    // categorically (l/n/h) — this adapter only requests MODIS_NRT, so a
    // non-numeric value here means FIRMS changed its response shape.
    const frpConfidence = Number.parseFloat(hotspot.confidence) / 100;
    const eventTime = parseFirmsTimestamp(hotspot.acq_date, hotspot.acq_time);
    const externalId = `${hotspot.latitude},${hotspot.longitude},${hotspot.acq_date},${hotspot.acq_time},${hotspot.satellite}`;

    return {
      hazardType: HazardType.WILDFIRE,
      externalId,
      latitude,
      longitude,
      locationLabel: null,
      region: null,
      eventTime,
      source: 'nasa_firms',
      rawPayload: hotspot as unknown as Record<string, unknown>,
      details: {
        frpConfidence,
        hotspotCount: 1,
        brightnessKelvin: Number.isFinite(brightnessKelvin) ? brightnessKelvin : null,
      },
    };
  }
}

/** FIRMS timestamps are UTC, `acq_time` a zero-padded 4-digit HHMM with no
 * separator (e.g. "0413" = 04:13). */
function parseFirmsTimestamp(acqDate: string, acqTime: string): Date {
  const paddedTime = acqTime.padStart(4, '0');
  const hours = paddedTime.slice(0, 2);
  const minutes = paddedTime.slice(2, 4);
  return new Date(`${acqDate}T${hours}:${minutes}:00Z`);
}

/** FIRMS' CSV has no quoted/escaped fields in practice (all columns are
 * numeric or simple tokens), so a plain split is sufficient — no need for a
 * full CSV-parsing dependency for this one adapter. */
function parseFirmsCsv(csv: string): FirmsHotspot[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) {
    return [];
  }
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row = {} as Record<string, string>;
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? '';
    });
    return row as unknown as FirmsHotspot;
  });
}
