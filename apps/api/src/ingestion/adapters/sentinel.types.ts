// Sentinel Hub's OAuth2 client-credentials token response
// (https://docs.sentinel-hub.com/api/latest/api/overview/authentication/).
export interface SentinelTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// A single Sentinel-2 L2A scene from Sentinel Hub's Catalog (STAC) API
// (https://docs.sentinel-hub.com/api/latest/api/catalog/), reduced to what
// this adapter actually uses — full STAC features carry far more (assets,
// links, full geometry) that nothing downstream needs yet.
export interface SentinelCatalogFeature {
  id: string;
  bbox: [number, number, number, number]; // [west, south, east, north]
  properties: {
    datetime: string;
    'eo:cloud_cover'?: number;
  };
}

export interface SentinelCatalogSearchResponse {
  features: SentinelCatalogFeature[];
}

// Normalized imagery-scene metadata this adapter's `fetch()` returns —
// deliberately not a hazard occurrence (see `producesHazardEvents` on
// `HazardDataSourceAdapter`): a satellite pass over Indonesia isn't itself a
// hazard, so this never flows through `hazard_events`.
export interface SentinelSceneRef {
  sceneId: string;
  sensedAt: Date;
  latitude: number;
  longitude: number;
  cloudCoverPercent: number | null;
}
