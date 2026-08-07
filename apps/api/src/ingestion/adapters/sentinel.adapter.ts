import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HazardType } from '../../common/enums/domain.enum';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import type {
  SentinelCatalogSearchResponse,
  SentinelSceneRef,
  SentinelTokenResponse,
} from './sentinel.types';

// Same Indonesia-with-margin bbox as `nasa-firms.adapter.ts` — both sources
// scope to the same operating area.
const INDONESIA_BBOX: [number, number, number, number] = [94, -12, 142, 7];
const CATALOG_COLLECTION = 'sentinel-2-l2a';
const LOOKBACK_DAYS = 5;
const CATALOG_LIMIT = 20;
// Refresh a few seconds early so a token doesn't expire mid-request.
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 30_000;

/**
 * Fourth concrete `HazardDataSourceAdapter` — polls Sentinel Hub's Catalog
 * (STAC) API for recent Sentinel-2 L2A scenes over Indonesia via a real
 * OAuth2 client-credentials flow. Previously a structural stub whose
 * `fetch()` always returned `[]`; see docs/ARCHITECTURE.md §5 for why that
 * was judged acceptable at the time (nothing downstream consumed imagery
 * yet) — this is the "later" that comment referred to.
 *
 * A satellite scene is imagery metadata, not a hazard occurrence, so unlike
 * `BmkgAdapter`/`NasaFirmsAdapter`/`WeatherAdapter` this sets
 * `producesHazardEvents = false`: `IngestionRegistryService` still calls
 * `fetch()` on the normal poll/manual-sync path (so `data_source_syncs`
 * reflects real activity) but never routes scenes through `normalize()` +
 * `ingestEvent()` — doing so would insert a fake `hazard_events` row (and
 * fire the full spatial-resolution/risk-scoring/notification pipeline) for
 * every satellite pass, which is a correctness bug, not a feature.
 * `normalize()` is still fully implemented and never throws on valid input —
 * usable directly (tests, or a future dedicated imagery consumer) even
 * though the registry doesn't call it today.
 */
@Injectable()
export class SentinelAdapter implements HazardDataSourceAdapter<SentinelSceneRef> {
  readonly sourceId = 'sentinel';
  readonly producesHazardEvents = false;

  private readonly logger = new Logger(SentinelAdapter.name);
  private cachedToken: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async fetch(): Promise<SentinelSceneRef[]> {
    const clientId = this.config.get<string>('SENTINEL_CLIENT_ID');
    const clientSecret = this.config.get<string>('SENTINEL_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      this.logger.debug(
        'SENTINEL_CLIENT_ID/SENTINEL_CLIENT_SECRET not configured — skipping poll',
      );
      return [];
    }

    try {
      const token = await this.getAccessToken(clientId, clientSecret);
      const scenes = await this.searchCatalog(token);
      return scenes;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Sentinel Hub catalog: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /** Never throws for a well-formed `SentinelSceneRef` — see this class's
   * docstring for why the registry doesn't actually call this today. */
  normalize(scene: SentinelSceneRef): NormalizedHazardEvent {
    return {
      // Structurally required by the shared envelope; irrelevant in
      // practice since `producesHazardEvents = false` means this is never
      // persisted to `hazard_events`.
      hazardType: HazardType.WILDFIRE,
      externalId: scene.sceneId,
      latitude: scene.latitude,
      longitude: scene.longitude,
      locationLabel: null,
      region: null,
      eventTime: scene.sensedAt,
      source: 'sentinel',
      rawPayload: scene as unknown as Record<string, unknown>,
      details: { cloudCoverPercent: scene.cloudCoverPercent },
    };
  }

  private async getAccessToken(
    clientId: string,
    clientSecret: string,
  ): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs > Date.now()) {
      return this.cachedToken.value;
    }

    const baseUrl = this.config.get<string>('SENTINEL_BASE_URL');
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });

    const { data } = await firstValueFrom(
      this.http.post<SentinelTokenResponse>(
        `${baseUrl}/oauth/token`,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        },
      ),
    );

    this.cachedToken = {
      value: data.access_token,
      expiresAtMs:
        Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_SAFETY_MARGIN_MS,
    };
    return data.access_token;
  }

  private async searchCatalog(token: string): Promise<SentinelSceneRef[]> {
    const baseUrl = this.config.get<string>('SENTINEL_BASE_URL');
    const now = new Date();
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const { data } = await firstValueFrom(
      this.http.post<SentinelCatalogSearchResponse>(
        `${baseUrl}/api/v1/catalog/1.0.0/search`,
        {
          bbox: INDONESIA_BBOX,
          datetime: `${since.toISOString()}/${now.toISOString()}`,
          collections: [CATALOG_COLLECTION],
          limit: CATALOG_LIMIT,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15_000,
        },
      ),
    );

    return data.features.map((feature) => {
      const [west, south, east, north] = feature.bbox;
      return {
        sceneId: feature.id,
        sensedAt: new Date(feature.properties.datetime),
        latitude: (south + north) / 2,
        longitude: (west + east) / 2,
        cloudCoverPercent: feature.properties['eo:cloud_cover'] ?? null,
      };
    });
  }
}
