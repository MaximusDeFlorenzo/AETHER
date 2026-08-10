import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HazardType } from '../../common/enums/domain.enum';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import {
  BNPB_LAYER_FLOOD_HAZARD_INDEX,
  BnpbInariskClient,
} from './bnpb-inarisk.client';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import {
  PetaBencanaFloodGaugesResponse,
  PetaBencanaGaugeReading,
} from './petabencana.types';

const DEFAULT_BASE_URL = 'https://data.petabencana.id';
// Provinces PetaBencana currently reports gauge/report data for: Jakarta
// (ID-JK) plus West/Central/East Java (ID-JB/ID-JT/ID-JI) — the country's
// most flood-exposed, most populous metro areas. Not nationwide; see
// `PETABENCANA_ADMIN_CODES` to add/narrow coverage as PetaBencana expands.
const DEFAULT_ADMIN_CODES = ['ID-JK', 'ID-JB', 'ID-JT', 'ID-JI'];

/**
 * Sixth concrete `HazardDataSourceAdapter` — polls PetaBencana.id's public
 * flood-gauge feed, a real, free, no-API-key BPBD-sourced river/reservoir
 * water-level telemetry source (docs.petabencana.id). Filling the flood gap
 * that `WeatherAdapter` (`weather.adapter.ts`) leaves inert by default: that
 * adapter needs a `WEATHER_API_BASE_URL`/`WEATHER_API_KEY` deployment hasn't
 * configured, whereas this one works out of the box.
 *
 * Reports water level only, no rainfall figure — unlike `WeatherAdapter`'s
 * source. `rainfallMm` is emitted as `null`; `flood-details.shape.ts` and
 * `apps/ai-engine`'s `flood.py`/`predict.py` were updated to treat a missing
 * rainfall reading as "no known contribution" (0) rather than a validation
 * failure, since `waterLevelM` is the heavier-weighted, directly-observed
 * signal and still drives the score on its own.
 *
 * Also enriches each gauge reading with `floodHazardIndex` — a real 0-1
 * susceptibility value looked up from BNPB's InaRISK `INDEKS_BAHAYA_BANJIR`
 * layer at the gauge's coordinates (`bnpb-inarisk.client.ts`) — a second,
 * independent real data source layered on top of PetaBencana's live
 * telemetry, not a replacement for it.
 */
@Injectable()
export class PetaBencanaAdapter implements HazardDataSourceAdapter<PetaBencanaGaugeReading> {
  readonly sourceId = 'petabencana';

  private readonly logger = new Logger(PetaBencanaAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly bnpbClient: BnpbInariskClient,
  ) {}

  async fetch(): Promise<PetaBencanaGaugeReading[]> {
    const baseUrl =
      this.config.get<string>('PETABENCANA_BASE_URL') ?? DEFAULT_BASE_URL;
    const readingsPerAdmin = await Promise.all(
      this.resolveAdminCodes().map((admin) =>
        this.fetchForAdmin(baseUrl, admin),
      ),
    );
    return readingsPerAdmin.flat();
  }

  normalize(reading: PetaBencanaGaugeReading): NormalizedHazardEvent {
    return {
      hazardType: HazardType.FLOOD,
      externalId: `${reading.gaugeId}-${reading.observedAt}`,
      latitude: reading.latitude,
      longitude: reading.longitude,
      locationLabel: reading.gaugeName,
      region: reading.adminCode,
      eventTime: new Date(reading.observedAt),
      source: 'petabencana',
      rawPayload: reading as unknown as Record<string, unknown>,
      details: {
        rainfallMm: null,
        waterLevelM: reading.waterLevelCm / 100,
        riverBasin: reading.gaugeName,
        floodHazardIndex: reading.floodHazardIndex,
      },
    };
  }

  private resolveAdminCodes(): string[] {
    const configured = this.config.get<string>('PETABENCANA_ADMIN_CODES');
    if (!configured) {
      return DEFAULT_ADMIN_CODES;
    }
    const codes = configured
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);
    return codes.length > 0 ? codes : DEFAULT_ADMIN_CODES;
  }

  private async fetchForAdmin(
    baseUrl: string,
    admin: string,
  ): Promise<PetaBencanaGaugeReading[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<PetaBencanaFloodGaugesResponse>(
          `${baseUrl}/floodgauges`,
          {
            params: { admin, geoformat: 'geojson' },
            timeout: 10_000,
          },
        ),
      );
      const readingsWithoutIndex = data.result.features
        .filter((feature) => feature.properties.observations.length > 0)
        .map((feature) => {
          const observations = feature.properties.observations;
          const latest = observations[observations.length - 1];
          const [longitude, latitude] = feature.geometry.coordinates;
          return {
            gaugeId: feature.properties.gaugeid,
            gaugeName: feature.properties.gaugenameid,
            latitude,
            longitude,
            waterLevelCm: latest.f2,
            alertLevel: latest.f4?.trim() ?? '',
            observedAt: latest.f1,
            adminCode: admin,
          };
        });

      return Promise.all(
        readingsWithoutIndex.map(async (reading) => ({
          ...reading,
          floodHazardIndex: await this.bnpbClient.getIndexValue(
            BNPB_LAYER_FLOOD_HAZARD_INDEX,
            reading.longitude,
            reading.latitude,
          ),
        })),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to fetch PetaBencana flood gauge feed for admin=${admin}: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
