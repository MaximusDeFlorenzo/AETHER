import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

const DEFAULT_BASE_URL = 'https://gis.bnpb.go.id/server/rest/services/inarisk';
// gis.bnpb.go.id answers HTTP 403 to axios' default User-Agent
// ("axios/<version>") while serving the identical request from any other
// agent (verified 2026-10-07) — without this header every lookup silently
// degraded to `null`. Same identifying-agent pattern as the karhutla
// SettlementsProvider.
const USER_AGENT = 'AETHER/0.1 (disaster early-warning decision support)';

// The layer this client is used with — see `petabencana.adapter.ts` and
// rainfall-intelligence's DistrictHazardIndexService (flood). Both landslide
// layers, `INDEKS_BAHAYA_TANAHLONGSOR` (hazard) and
// `INDEKS_RISIKO_TANAH_LONGSOR` (risk), time out on every getSamples request
// regardless of coordinates (re-verified 2026-10-07 with a 30 s timeout,
// while their metadata answers in ~150 ms), so landslide terrain comes from
// the DEM instead (rainfall-intelligence/district-terrain.service.ts).
export const BNPB_LAYER_FLOOD_HAZARD_INDEX = 'INDEKS_BAHAYA_BANJIR';

// World Mercator (EPSG:3395) — the native spatial reference of BNPB's
// InaRISK ImageServer layers. Verified empirically that their `getSamples`/
// `identify` endpoints do NOT honor the documented `sr` reprojection
// parameter: passing `sr=4326` with raw longitude/latitude values returns
// `location.spatialReference.wkid: 3395` unchanged in the response (i.e. the
// input was never reprojected), and every query lands as "NoData" because
// the raw lon/lat numbers (e.g. x=106.8) are nowhere near the layer's real
// extent (x runs ~10.5M-15.7M in EPSG:3395 meters). Geometry must be
// pre-projected into 3395 meters client-side instead.
const WGS84_SEMI_MAJOR_AXIS_M = 6378137.0;
const WGS84_ECCENTRICITY = 0.0818191908426;

function toEpsg3395(
  longitude: number,
  latitude: number,
): { x: number; y: number } {
  const lonRad = (longitude * Math.PI) / 180;
  const latRad = (latitude * Math.PI) / 180;
  const x = WGS84_SEMI_MAJOR_AXIS_M * lonRad;
  const y =
    WGS84_SEMI_MAJOR_AXIS_M *
    Math.log(
      Math.tan(Math.PI / 4 + latRad / 2) *
        ((1 - WGS84_ECCENTRICITY * Math.sin(latRad)) /
          (1 + WGS84_ECCENTRICITY * Math.sin(latRad))) **
          (WGS84_ECCENTRICITY / 2),
    );
  return { x, y };
}

interface GetSamplesResponse {
  samples: Array<{ value: string }>;
}

/**
 * Shared point-lookup client for BNPB's InaRISK ArcGIS ImageServer hazard-
 * index layers (gis.bnpb.go.id) — real, free, no-API-key national hazard
 * rasters (100m resolution). Not a `HazardDataSourceAdapter` itself: it
 * doesn't produce hazard events, it enriches one with a 0-1 index value for
 * a given coordinate, on demand, from `fetch()` in the adapters that use it.
 */
@Injectable()
export class BnpbInariskClient {
  private readonly logger = new Logger(BnpbInariskClient.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Returns a 0-1 index value, or `null` if the point has no data (a real,
   * expected outcome — the underlying rasters have genuine coverage gaps)
   * or the request fails for any other reason. Never throws — a failed
   * enrichment lookup degrades to "no index available", not a broken poll. */
  async getIndexValue(
    layerName: string,
    longitude: number,
    latitude: number,
  ): Promise<number | null> {
    return (await this.lookupIndexValue(layerName, longitude, latitude)).value;
  }

  /** Like `getIndexValue`, but tells an answered NoData pixel
   * (`failed: false, value: null`) apart from a request that failed
   * (`failed: true`) — callers that cache results must retry only the
   * latter. Never throws. */
  async lookupIndexValue(
    layerName: string,
    longitude: number,
    latitude: number,
  ): Promise<{ value: number | null; failed: boolean }> {
    const baseUrl =
      this.config.get<string>('BNPB_INARISK_BASE_URL') ?? DEFAULT_BASE_URL;
    const { x, y } = toEpsg3395(longitude, latitude);

    try {
      const { data } = await firstValueFrom(
        this.http.get<GetSamplesResponse>(
          `${baseUrl}/${layerName}/ImageServer/getSamples`,
          {
            params: {
              geometry: JSON.stringify({ x, y }),
              geometryType: 'esriGeometryPoint',
              f: 'json',
            },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 8_000,
          },
        ),
      );
      if (!Array.isArray(data?.samples)) {
        return { value: null, failed: true };
      }
      const raw = data.samples[0]?.value;
      if (raw === undefined || raw === '') {
        return { value: null, failed: false };
      }
      const parsed = Number.parseFloat(raw);
      return { value: Number.isFinite(parsed) ? parsed : null, failed: false };
    } catch (error) {
      this.logger.debug(
        `BNPB InaRISK lookup failed for layer=${layerName} at (${longitude},${latitude}): ${(error as Error).message}`,
      );
      return { value: null, failed: true };
    }
  }
}
