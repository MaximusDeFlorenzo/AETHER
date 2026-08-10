import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1';
const HOURS_PER_DAY = 24;

interface OpenMeteoForecastResponse {
  hourly: {
    time: string[];
    precipitation: number[];
  };
}

/**
 * Real-time rainfall lookup client for Open-Meteo (open-meteo.com) — a free,
 * no-API-key global weather API queried directly by lat/lon, no
 * administrative-code crosswalk required. Chosen over BMKG's public
 * `prakiraan-cuaca` API (`api.bmkg.go.id/publik/prakiraan-cuaca`), which is
 * also real and free but requires a village-level `adm4` code per query —
 * this system's `districts` table only stores BPS codes, a different coding
 * scheme with no existing crosswalk to BMKG's adm1-4 codes, so using it
 * would need a large external mapping dataset this system doesn't have.
 * Open-Meteo's `past_days=1` parameter returns real observed (not forecast)
 * hourly precipitation for the last 24h, which is exactly the "24h rainfall"
 * figure `landslide-rainfall-trigger.adapter.ts`'s threshold logic needs.
 */
@Injectable()
export class OpenMeteoClient {
  private readonly logger = new Logger(OpenMeteoClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Returns the real observed rainfall total (mm) over the last 24h at the
   * given coordinates, or `null` if the request fails. Never throws. */
  async getLast24hRainfallMm(
    longitude: number,
    latitude: number,
  ): Promise<number | null> {
    const baseUrl =
      this.config.get<string>('OPEN_METEO_BASE_URL') ?? DEFAULT_BASE_URL;

    try {
      const { data } = await firstValueFrom(
        this.http.get<OpenMeteoForecastResponse>(`${baseUrl}/forecast`, {
          params: {
            latitude,
            longitude,
            hourly: 'precipitation',
            past_days: 1,
            forecast_days: 1,
            timezone: 'Asia/Jakarta',
          },
          timeout: 8_000,
        }),
      );
      const hourlyPrecipitation = data.hourly?.precipitation ?? [];
      // The response covers past_days + forecast_days combined (48 hourly
      // entries here); the first HOURS_PER_DAY entries are the real observed
      // last-24h window, the rest is today's forecast.
      const last24h = hourlyPrecipitation.slice(0, HOURS_PER_DAY);
      if (last24h.length === 0) {
        return null;
      }
      return last24h.reduce((sum, mm) => sum + mm, 0);
    } catch (error) {
      this.logger.warn(
        `Open-Meteo rainfall lookup failed at (${longitude},${latitude}): ${(error as Error).message}`,
      );
      return null;
    }
  }
}
