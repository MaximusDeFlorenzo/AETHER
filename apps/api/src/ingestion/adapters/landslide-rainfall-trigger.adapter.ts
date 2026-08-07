import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HazardType } from '../../common/enums/domain.enum';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import type {
  WeatherStationReading,
  WeatherStationsResponse,
} from './weather.types';

// 24h rainfall (mm) above which tropical-terrain slopes are considered at
// meaningfully elevated landslide risk — a widely-cited rule-of-thumb
// threshold for Indonesia's climate, not a calibrated per-region value (no
// per-region calibration data source exists — same honesty posture as
// every other v0 heuristic in this codebase).
const RAINFALL_TRIGGER_THRESHOLD_MM = 100;
// Rainfall level treated as "fully saturated" ground for the derived
// soilSaturation below — set below the trigger threshold so a just-over-
// threshold reading doesn't read as barely wet.
const SATURATION_REFERENCE_MM = 150;
// No slope-per-location data source exists yet (landslide_details.slope_degrees
// is documented as an instrument reading, not derived) — this fixed default
// represents typical hilly/highland terrain, the kind of location a
// rainfall/water-level station is usually sited near in landslide-prone
// regions. A human reviewer can always correct it via a follow-up manual
// report (`POST /hazard-events/manual`).
const DEFAULT_SLOPE_DEGREES = 25;

/**
 * Fifth concrete `HazardDataSourceAdapter` — a rainfall-triggered landslide
 * candidate source. Landslide has no independent live public feed
 * (docs/SRS.md §6: "no single stable public real-time feed exists yet ...
 * live rainfall/soil-sensor integration remains a future candidate once a
 * source is validated"). Rather than leave this a permanent seed/manual-only
 * gap, it reuses the already-configured `WEATHER_API_BASE_URL` rainfall/
 * water-level feed — the same one `WeatherAdapter` polls for flood — and
 * applies a rainfall-threshold heuristic: a station reading above
 * `RAINFALL_TRIGGER_THRESHOLD_MM` becomes a candidate landslide event.
 * `soilSaturation` is derived from that same rainfall reading (a documented
 * heuristic, not a measurement); `slopeDegrees` falls back to a fixed
 * regional default since no slope-per-location data source exists.
 *
 * Distinct `sourceId`/`source` from `WeatherAdapter` (and a `-landslide-`
 * infix in `externalId`) so the same station reading can independently
 * dedupe into a flood event and a landslide-candidate event without
 * colliding on `hazard_events`' `(external_id, source)` unique constraint.
 */
@Injectable()
export class LandslideRainfallTriggerAdapter
  implements HazardDataSourceAdapter<WeatherStationReading>
{
  readonly sourceId = 'landslide_rainfall_trigger';

  private readonly logger = new Logger(LandslideRainfallTriggerAdapter.name);

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
        this.http.get<WeatherStationsResponse>(
          `${baseUrl}/stations/current`,
          { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10_000 },
        ),
      );
      return data.stations.filter(
        (station) => station.rainfallMm >= RAINFALL_TRIGGER_THRESHOLD_MM,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to fetch weather/rainfall station feed: ${(error as Error).message}`,
      );
      return [];
    }
  }

  normalize(reading: WeatherStationReading): NormalizedHazardEvent {
    const soilSaturation = Math.min(
      1,
      reading.rainfallMm / SATURATION_REFERENCE_MM,
    );
    return {
      hazardType: HazardType.LANDSLIDE,
      externalId: `${reading.stationId}-landslide-${reading.observedAt}`,
      latitude: reading.latitude,
      longitude: reading.longitude,
      locationLabel: reading.riverBasin,
      region: null,
      eventTime: new Date(reading.observedAt),
      source: 'landslide_rainfall_trigger',
      rawPayload: reading as unknown as Record<string, unknown>,
      details: {
        slopeDegrees: DEFAULT_SLOPE_DEGREES,
        soilSaturation: Math.round(soilSaturation * 1000) / 1000,
        triggeringRainfallMm: reading.rainfallMm,
      },
    };
  }
}
