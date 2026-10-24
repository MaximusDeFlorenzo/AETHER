import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1';
const HOURS_PER_DAY = 24;
const HOUR_MS = 60 * 60 * 1000;
// One more past hour than the window needs, so the oldest hour of the
// trailing 24h is still in the response when "now" is just past the hour.
const PAST_HOURS = HOURS_PER_DAY + 1;

interface OpenMeteoForecastResponse {
  hourly?: {
    time: string[];
    precipitation: Array<number | null>;
  };
}

/**
 * Sums Open-Meteo hourly precipitation over the trailing `HOURS_PER_DAY`
 * hours ending at `now`. Pure, exported for tests.
 *
 * Open-Meteo's hourly `precipitation` at time T is the total over the
 * preceding hour (T-1h → T), so the window is every entry with
 * `now - 24h < T <= now` — exactly 24 completed hours. `times` must be UTC
 * (requested with `timezone=GMT`; Open-Meteo returns them without an
 * offset). Returns `null` rather than an undercount if any hour of the
 * window is missing or not a valid non-negative number.
 */
export function sumTrailing24hPrecipitationMm(
  times: string[],
  precipitation: Array<number | null>,
  now: Date,
): number | null {
  const end = now.getTime();
  const start = end - HOURS_PER_DAY * HOUR_MS;
  let total = 0;
  let hours = 0;
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    const at = new Date(`${time}${time.endsWith('Z') ? '' : 'Z'}`).getTime();
    if (Number.isNaN(at) || at <= start || at > end) continue;
    const mm = precipitation[i];
    if (typeof mm !== 'number' || !Number.isFinite(mm) || mm < 0) return null;
    total += mm;
    hours += 1;
  }
  if (hours !== HOURS_PER_DAY) return null;
  return Math.round(total * 100) / 100;
}

/**
 * Rainfall lookup client for Open-Meteo (open-meteo.com) — a free,
 * no-API-key global weather API queried directly by lat/lon, no
 * administrative-code crosswalk required. Chosen over BMKG's public
 * `prakiraan-cuaca` API (`api.bmkg.go.id/publik/prakiraan-cuaca`), which is
 * also real and free but requires a village-level `adm4` code per query —
 * this system's `districts` table only stores BPS codes, a different coding
 * scheme with no existing crosswalk to BMKG's adm1-4 codes, so using it
 * would need a large external mapping dataset this system doesn't have.
 *
 * Provenance: these are numerical-weather-prediction model values
 * (Open-Meteo "best_match"; past hours are model analyses / short-range
 * forecasts), NOT rain-gauge observations — same caveat as
 * `OpenMeteoAtmosphereProvider`. No observed rainfall source exists in
 * AETHER yet.
 */
@Injectable()
export class OpenMeteoClient {
  private readonly logger = new Logger(OpenMeteoClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Returns the model rainfall total (mm) over the trailing 24h ending now
   * at the given coordinates, or `null` if the request fails or the window
   * is incomplete. Never throws. */
  async getLast24hRainfallMm(
    longitude: number,
    latitude: number,
    now: Date = new Date(),
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
            past_hours: PAST_HOURS,
            forecast_hours: 1,
            timezone: 'GMT',
          },
          timeout: 8_000,
        }),
      );
      const total = sumTrailing24hPrecipitationMm(
        data.hourly?.time ?? [],
        data.hourly?.precipitation ?? [],
        now,
      );
      if (total === null) {
        this.logger.debug(
          `Open-Meteo returned an incomplete 24h rainfall window at (${longitude},${latitude})`,
        );
      }
      return total;
    } catch (error) {
      this.logger.warn(
        `Open-Meteo rainfall lookup failed at (${longitude},${latitude}): ${(error as Error).message}`,
      );
      return null;
    }
  }
}
