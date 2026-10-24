import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { isValidCoordinate } from '../lib/geo';
import type { CandidatePlace } from '../lib/exposure';
import { withRetry } from './retry';

/**
 * Named settlements (OSM `place` nodes) around a fire, from the public
 * Overpass API — AETHER has no settlement, road or facility geometry of its
 * own (villages carry codes/names only). Towns/cities are fetched over the
 * wide smoke domain, villages/hamlets only near the fire, to keep responses
 * small. Point locations only: a village node is its OSM centre, not its
 * boundary, and OSM coverage of rural Indonesia is incomplete.
 *
 * Usage policy: Overpass requires an identifying User-Agent and fair use;
 * requests are spaced >= 1 s apart and cached for 24 h per area. Disable
 * with KARHUTLA_SETTLEMENTS_ENABLED=false.
 */

const DEFAULT_BASE_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT =
  'AETHER-karhutla/0.1 (disaster early-warning decision support)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 1100;
const MAX_ELEMENTS = 3000;

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

function bbox(b: Bounds): string {
  const r = (v: number) => v.toFixed(2);
  return `${r(b.south)},${r(b.west)},${r(b.north)},${r(b.east)}`;
}

/** Pure, exported for tests. Drops unnamed or invalid nodes. */
export function parseOverpassPlaces(
  elements: OverpassElement[],
): CandidatePlace[] {
  const places: CandidatePlace[] = [];
  for (const el of elements) {
    const name = el.tags?.name?.trim();
    if (el.type !== 'node' || !name || !isValidCoordinate(el.lat, el.lon))
      continue;
    places.push({
      id: `osm-node-${el.id}`,
      name,
      kind: 'settlement',
      placeType: el.tags?.place ?? null,
      provinceName: null,
      latitude: el.lat!,
      longitude: el.lon!,
      source: 'openstreetmap',
    });
  }
  return places;
}

@Injectable()
export class SettlementsProvider {
  private readonly logger = new Logger(SettlementsProvider.name);
  private readonly cache = new Map<
    string,
    { at: number; value: CandidatePlace[] }
  >();
  private lastRequestAt = 0;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return (
      String(this.config.get('KARHUTLA_SETTLEMENTS_ENABLED') ?? 'true') !==
      'false'
    );
  }

  /** Returns null (not []) when the lookup failed, so callers can tell
   * "no settlements here" from "settlements unknown". */
  async around(wide: Bounds, near: Bounds): Promise<CandidatePlace[] | null> {
    if (!this.enabled) return null;
    const key = `${bbox(wide)}|${bbox(near)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const query =
      `[out:json][timeout:25];(` +
      `node["place"~"^(city|town)$"](${bbox(wide)});` +
      `node["place"~"^(village|hamlet|suburb)$"](${bbox(near)});` +
      `);out body qt ${MAX_ELEMENTS};`;
    const url =
      this.config.get<string>('OVERPASS_BASE_URL') ?? DEFAULT_BASE_URL;
    try {
      const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
      const { data } = await withRetry(
        () =>
          firstValueFrom(
            this.http.post<{ elements?: OverpassElement[] }>(
              url,
              new URLSearchParams({ data: query }).toString(),
              {
                headers: {
                  'User-Agent': USER_AGENT,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 30_000,
              },
            ),
          ),
        { attempts: 2, baseDelayMs: 2000 },
      );
      const places = parseOverpassPlaces(data.elements ?? []);
      this.cache.set(key, { at: Date.now(), value: places });
      return places;
    } catch (error) {
      this.logger.warn(
        `Overpass settlement lookup failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
