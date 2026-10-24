// GET /public/air-quality (apps/api src/public-alerts/air-quality.service.ts):
// modelled air quality (CAMS via Open-Meteo, ~40 km grid) at a point — not a
// monitoring station.

/** Indonesian ISPU category (Permen LHK P.14/2020) from PM2.5, applied to
 * the modelled hourly value. */
export type IspuCategory = 'baik' | 'sedang' | 'tidak_sehat' | 'sangat_tidak_sehat' | 'berbahaya';

export interface PointAirQuality {
  latitude: number;
  longitude: number;
  observedAt: string;
  pm25: number | null;
  pm10: number | null;
  /** µg/m³ */
  carbonMonoxide: number | null;
  /** ppm, atmospheric concentration — not an emission. */
  carbonDioxidePpm: number | null;
  usAqi: number | null;
  ispu: IspuCategory | null;
  hourly: Array<{ time: string; pm25: number | null }>;
  source: 'open-meteo-cams';
}

// GET /public/air-quality/station — the nearest OpenAQ station that reported
// PM2.5 in the last 3 h within 25 km (measured), or null.
export interface StationAirQuality {
  locationId: number;
  name: string;
  /** e.g. "AirNow", "AirGradient". */
  provider: string;
  /** Reference-grade monitor (true) vs low-cost sensor (false). */
  isMonitor: boolean;
  distanceKm: number;
  measuredAt: string;
  pm25: number | null;
  pm10: number | null;
  ispu: IspuCategory | null;
  source: 'openaq';
}
