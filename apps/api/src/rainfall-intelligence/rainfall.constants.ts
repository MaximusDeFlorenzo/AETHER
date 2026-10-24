/** `weather_hourly_samples.source` for Open-Meteo rows. */
export const OPEN_METEO_SOURCE = 'open-meteo';

/** `data_source_syncs.source_id` for the hourly rainfall ingestion. */
export const RAINFALL_SYNC_SOURCE_ID = 'rainfall_open_meteo';

// Every 3 h. With 514 district points in batches of 50 at 1.1 calls per
// location (11 variables), one run is ≈ 565 Open-Meteo calls if each
// location counts — ≈ 4.5k/day, under the free tier's 10k/day. Each run
// fetches back to the last stored hour, so a longer interval loses no
// hours, only freshness.
export const DEFAULT_RAINFALL_INGESTION_INTERVAL_MS = 10_800_000;

export const OPEN_METEO_ATTRIBUTION =
  'Weather data by Open-Meteo.com (CC BY 4.0)';

/** `data_source_syncs.source_id` for GSMaP_NOW ingestion. */
export const GSMAP_SYNC_SOURCE_ID = 'rainfall_gsmap_now';

// GSMaP_NOW publishes a new hourly window every 30 min with ~0 h latency;
// hourly runs pick up each hour-aligned window once.
export const DEFAULT_GSMAP_INGESTION_INTERVAL_MS = 3_600_000;

export const GSMAP_ATTRIBUTION =
  'GSMaP data by Japan Aerospace Exploration Agency (JAXA)';
