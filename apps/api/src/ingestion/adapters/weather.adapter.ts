import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HazardType } from '../../common/enums/domain.enum';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import {
  WeatherStationReading,
  WeatherStationsResponse,
} from './weather.types';

/**
 * Third concrete `HazardDataSourceAdapter`, alongside `BmkgAdapter`/
 * `NasaFirmsAdapter` — polls a configurable weather/rainfall API for flood
 * hazard events. No ORION equivalent (ORION was earthquake-only).
 *
 * Deliberately requires a *water-level-reporting* feed, not a generic
 * rainfall-only weather API: `apps/ai-engine`'s `FloodDetails` schema
 * requires both `rainfallMm` and `waterLevelM` to score risk
 * (flood.py weighs water level more heavily than rainfall — it reflects
 * actual state, rainfall is only a precursor), so a source that can't supply
 * a water-level reading can't produce a scorable flood event. `WEATHER_API_BASE_URL`
 * is left deployment-configurable (see weather.types.ts) so this points at
 * whichever real flood-early-warning provider is available without a
 * rewrite — commonly a national hydrology/BMKG-adjacent flood-monitoring
 * API, not a general-purpose weather service.
 */
@Injectable()
export class WeatherAdapter implements HazardDataSourceAdapter<WeatherStationReading> {
  readonly sourceId = 'weather_api';

  private readonly logger = new Logger(WeatherAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async fetch(): Promise<WeatherStationReading[]> {
    const baseUrl = this.config.get<string>('WEATHER_API_BASE_URL');
    const apiKey = this.config.get<string>('WEATHER_API_KEY');
    if (!baseUrl || !apiKey) {
      this.logger.debug(
        'WEATHER_API_BASE_URL/WEATHER_API_KEY not configured — skipping poll',
      );
      return [];
    }

    try {
      const { data } = await firstValueFrom(
        this.http.get<WeatherStationsResponse>(`${baseUrl}/stations/current`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10_000,
        }),
      );
      return data.stations;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch weather/rainfall station feed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  normalize(reading: WeatherStationReading): NormalizedHazardEvent {
    return {
      hazardType: HazardType.FLOOD,
      externalId: `${reading.stationId}-${reading.observedAt}`,
      latitude: reading.latitude,
      longitude: reading.longitude,
      locationLabel: reading.riverBasin,
      region: null,
      eventTime: new Date(reading.observedAt),
      source: 'weather_api',
      rawPayload: reading as unknown as Record<string, unknown>,
      details: {
        rainfallMm: reading.rainfallMm,
        waterLevelM: reading.waterLevelM,
        riverBasin: reading.riverBasin,
      },
    };
  }
}
