import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { destinationPoint } from '../lib/geo';
import { withRetry } from './retry';

/**
 * Terrain ring for the spread engine's slope factor: the elevation at the
 * cluster centre plus 8 points at `RING_RADIUS_KM`, from Open-Meteo's
 * elevation API (Copernicus GLO-90 DEM, ~90 m; keyless). Elevation is
 * static, so results are cached for a week.
 */

const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1';
export const RING_RADIUS_KM = 1;
const RING_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_POINTS_PER_REQUEST = 99;

export interface TerrainRing {
  centerElevationM: number;
  ringRadiusKm: number;
  ring: Array<{ bearingDeg: number; elevationM: number }>;
  source: string;
}

const isElevation = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= -500 && v <= 9000;

@Injectable()
export class TerrainProvider {
  private readonly logger = new Logger(TerrainProvider.name);
  private readonly cache = new Map<
    string,
    { at: number; value: TerrainRing }
  >();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Same order as `centers`; null where the DEM lookup failed. */
  async rings(
    centers: Array<{ latitude: number; longitude: number }>,
  ): Promise<Array<TerrainRing | null>> {
    const keyOf = (c: { latitude: number; longitude: number }) =>
      `${c.latitude.toFixed(3)},${c.longitude.toFixed(3)}`;
    const now = Date.now();
    const pending = centers.filter((c) => {
      const hit = this.cache.get(keyOf(c));
      return !hit || now - hit.at > CACHE_TTL_MS;
    });

    const samples = pending.flatMap((c) => [
      { latitude: c.latitude, longitude: c.longitude },
      ...RING_BEARINGS.map((b) =>
        destinationPoint(c.latitude, c.longitude, b, RING_RADIUS_KM),
      ),
    ]);
    const elevations: Array<number | null> = new Array(samples.length).fill(
      null,
    );
    const baseUrl =
      this.config.get<string>('OPEN_METEO_BASE_URL') ?? DEFAULT_BASE_URL;
    for (let i = 0; i < samples.length; i += MAX_POINTS_PER_REQUEST) {
      const batch = samples.slice(i, i + MAX_POINTS_PER_REQUEST);
      try {
        const { data } = await withRetry(() =>
          firstValueFrom(
            this.http.get<{ elevation?: unknown[] }>(`${baseUrl}/elevation`, {
              params: {
                latitude: batch.map((p) => p.latitude.toFixed(5)).join(','),
                longitude: batch.map((p) => p.longitude.toFixed(5)).join(','),
              },
              timeout: 10_000,
            }),
          ),
        );
        (data.elevation ?? []).forEach((value, j) => {
          elevations[i + j] = isElevation(value) ? value : null;
        });
      } catch (error) {
        this.logger.warn(
          `Open-Meteo elevation lookup failed: ${(error as Error).message}`,
        );
      }
    }

    const per = RING_BEARINGS.length + 1;
    pending.forEach((center, k) => {
      const values = elevations.slice(k * per, (k + 1) * per);
      if (values.some((v) => v === null)) return;
      this.cache.set(keyOf(center), {
        at: now,
        value: {
          centerElevationM: values[0]!,
          ringRadiusKm: RING_RADIUS_KM,
          ring: RING_BEARINGS.map((bearingDeg, j) => ({
            bearingDeg,
            elevationM: values[j + 1]!,
          })),
          source: 'Open-Meteo elevation API (Copernicus GLO-90 DEM)',
        },
      });
    });

    return centers.map((c) => this.cache.get(keyOf(c))?.value ?? null);
  }
}
