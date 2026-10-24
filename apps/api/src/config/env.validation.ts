import { Type } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Min,
  validateSync,
} from 'class-validator';

// Mirrors ../../.env.example exactly — every required key here must exist
// there, and vice versa (Phase 2 keys are intentionally optional/blank until
// wired, per that file's comment).
class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT = 4000;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URL: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN = '15m';

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN = '7d';

  @IsUrl({ require_tld: false })
  AI_ENGINE_URL: string;

  @IsString()
  INTERNAL_SERVICE_TOKEN: string;

  @IsOptional()
  @IsString()
  CORS_ORIGIN = 'http://localhost:3000';

  @IsOptional()
  @IsString()
  ADMIN_EMAIL = 'admin@aether.local';

  @IsOptional()
  @IsString()
  ADMIN_PASSWORD = 'ChangeMe123!';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  BMKG_POLL_INTERVAL_MS = 300_000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  NASA_FIRMS_POLL_INTERVAL_MS = 3_600_000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  WEATHER_POLL_INTERVAL_MS = 900_000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  LANDSLIDE_TRIGGER_POLL_INTERVAL_MS = 900_000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  PETABENCANA_POLL_INTERVAL_MS = 900_000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  SENTINEL_POLL_INTERVAL_MS = 3_600_000;

  // Standing/baseline risk-score threshold (0-100) above which a
  // notification is raised and resource optimization is considered — see
  // docs/ARCHITECTURE.md §2.2 and resource-optimization/ module.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  RISK_NOTIFICATION_THRESHOLD = 60;

  // --- Phase 2 ingestion adapters ---
  @IsOptional()
  @IsString()
  WEATHER_API_BASE_URL?: string;

  @IsOptional()
  @IsString()
  WEATHER_API_KEY?: string;

  // PetaBencana.id flood-gauge feed (petabencana.adapter.ts) — unlike the
  // other Phase 2 adapters, no API key is needed; both fields are optional
  // purely to allow overriding the adapter's built-in defaults (public base
  // URL, Jakarta + West/Central/East Java admin codes).
  @IsOptional()
  @IsString()
  PETABENCANA_BASE_URL?: string;

  @IsOptional()
  @IsString()
  PETABENCANA_ADMIN_CODES?: string;

  // BNPB InaRISK hazard-index lookup client (bnpb-inarisk.client.ts) — real,
  // free, no API key. Used to enrich PetaBencana flood events and
  // rainfall-triggered landslide candidates with a per-coordinate hazard
  // index instead of a hardcoded constant.
  @IsOptional()
  @IsString()
  BNPB_INARISK_BASE_URL = 'https://gis.bnpb.go.id/server/rest/services/inarisk';

  // Open-Meteo rainfall lookup (open-meteo.client.ts) — real, free, no API
  // key. Landslide's independent rainfall-trigger source, queried directly
  // by district centroid lat/lon (no administrative-code crosswalk needed).
  @IsOptional()
  @IsString()
  OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1';

  @IsOptional()
  @IsString()
  NASA_FIRMS_BASE_URL = 'https://firms.modaps.eosdis.nasa.gov/api';

  // Comma-separated FIRMS NRT products to poll (nasa-firms.adapter.ts).
  // Unset = all of MODIS_NRT, VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT,
  // VIIRS_NOAA21_NRT.
  @IsOptional()
  @IsString()
  NASA_FIRMS_SOURCES?: string;

  // Days of FIRMS hotspot detections kept (ingestion/hotspot-retention.service.ts,
  // daily 03:00). Detections referenced by a risk assessment, notification,
  // plan, relationship or alert are kept regardless. 0 disables the purge.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  HOTSPOT_RETENTION_DAYS = 90;

  // Web Push for citizen emergency alarms (public-alerts/web-push.service.ts).
  // All three optional: without them alarms still show in open browser tabs
  // (the portal polls), just not as notifications while the site is closed.
  // Generate a pair with `npx web-push generate-vapid-keys`.
  @IsOptional()
  @IsString()
  VAPID_PUBLIC_KEY?: string;

  @IsOptional()
  @IsString()
  VAPID_PRIVATE_KEY?: string;

  // A contact the push services can reach, e.g. mailto:ops@bpbd.example.
  @IsOptional()
  @IsString()
  VAPID_SUBJECT?: string;

  // Reverse geocoding for the citizen portal's automatic location
  // (public-alerts/public-locate.service.ts). Defaults to the public OSM
  // Nominatim (max 1 req/s, enforced in-process); point at a self-hosted
  // Nominatim for production traffic.
  @IsOptional()
  @IsString()
  NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

  @IsOptional()
  @IsString()
  NASA_FIRMS_API_KEY?: string;

  // Sentinel Hub OAuth2 client-credentials (sentinel.adapter.ts) — both
  // optional, since the adapter gracefully no-ops without them (same
  // posture as WEATHER_API_KEY/NASA_FIRMS_API_KEY).
  @IsOptional()
  @IsString()
  SENTINEL_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  SENTINEL_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  SENTINEL_BASE_URL = 'https://services.sentinel-hub.com';

  // --- Storage (S3/MinIO-compatible) — CV imagery + field-report uploads ---
  @IsOptional()
  @IsString()
  STORAGE_ENDPOINT = 'http://minio:9000';

  @IsOptional()
  @IsString()
  STORAGE_REGION = 'us-east-1';

  @IsOptional()
  @IsString()
  STORAGE_BUCKET = 'aether-media';

  @IsOptional()
  @IsString()
  STORAGE_ACCESS_KEY_ID = 'aether';

  @IsOptional()
  @IsString()
  STORAGE_SECRET_ACCESS_KEY = 'aether-dev-secret';

  // MinIO (and most non-AWS S3-compatible stores) require path-style URLs
  // (http://endpoint/bucket/key) rather than AWS's virtual-hosted-style
  // (http://bucket.endpoint/key).
  //
  // NOTE (found while fixing the identical bug in CreateImportBatchDto,
  // village-population-import/dto/create-import-batch.dto.ts): `@Type(()
  // => Boolean)` runs the JS `Boolean()` constructor, and `Boolean('false')
  // === true` — any non-empty string is truthy. Setting this env var to the
  // literal string "false" would silently behave as "true". Left as-is
  // (pre-existing, unrelated to the village-population-import feature this
  // session is scoped to — flagging only, per instruction not to fix
  // unrelated @Type(() => Boolean) bugs unless they block this feature).
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  STORAGE_FORCE_PATH_STYLE = true;

  // --- Karhutla spread + smoke predictions (karhutla-prediction/) ---
  // Scheduled run interval; 0 disables scheduled runs (manual runs still
  // work). Default 3 h — MODIS gives ~4 overpasses/day over Indonesia.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  KARHUTLA_PREDICTION_INTERVAL_MS = 10_800_000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  KARHUTLA_MAX_CLUSTERS = 8;

  // Ground Intelligence: per-reporter submissions allowed per rolling hour.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  GROUND_REPORTS_MAX_PER_HOUR = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  KARHUTLA_HOTSPOT_WINDOW_HOURS = 24;

  // OSM settlement lookup via the public Overpass API. Compared as a
  // string ('false' disables) — see the @Type(() => Boolean) note above.
  @IsOptional()
  @IsString()
  KARHUTLA_SETTLEMENTS_ENABLED = 'true';

  @IsOptional()
  @IsString()
  OVERPASS_BASE_URL = 'https://overpass-api.de/api/interpreter';

  // --- Rainfall Intelligence (rainfall-intelligence/) ---
  // Hourly-weather ingestion interval; 0 disables scheduled runs (manual
  // runs still work). Default 3 h keeps 514 district points under the
  // Open-Meteo free tier (docs/RAINFALL_INTELLIGENCE.md "Provider quota").
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  RAINFALL_INGESTION_INTERVAL_MS = 10_800_000;

  // JAXA GSMaP_NOW satellite rainfall (rainfall-intelligence/). User and
  // password come from the JAXA registration email; without them GSMaP
  // ingestion is skipped. The server is plain FTP (no TLS).
  @IsOptional()
  @IsString()
  GSMAP_FTP_HOST = 'hokusai.eorc.jaxa.jp';

  @IsOptional()
  @IsString()
  GSMAP_FTP_USER?: string;

  @IsOptional()
  @IsString()
  GSMAP_FTP_PASSWORD?: string;

  // 0 disables scheduled GSMaP runs. Default 1 h — a new hour-aligned
  // GSMaP_NOW window appears every hour.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  GSMAP_INGESTION_INTERVAL_MS = 3_600_000;

  // Districts per rolling 24 h whose DEM slope is sampled from Open-Meteo's
  // elevation API (64 coordinates each) for the landslide baseline; 0
  // disables sampling. The DEM is static, so this only spreads the one-off
  // ~33k-coordinate fill over days next to rainfall ingestion's ~4.5k/day
  // (docs/RAINFALL_INTELLIGENCE.md §6).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  TERRAIN_SAMPLING_DISTRICTS_PER_DAY = 60;

  // Milestone 7 backtest (docs/RAINFALL_INTELLIGENCE.md §10): first UTC day
  // of the archived GSMaP_Gauge hourly rainfall, days fetched per scheduled
  // top-up (0 disables it; bulk backfill: npm run rainfall:archive), and
  // the first year of BNPB DIBI reports imported as labels.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  GSMAP_ARCHIVE_FROM = '2024-01-01';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  GSMAP_ARCHIVE_DAYS_PER_RUN = 4;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  DIBI_LABELS_FROM_YEAR = 2023;

  // --- village-population-import background jobs (BullMQ, same REDIS_URL
  // connection as CacheService) ---
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  VILLAGE_POPULATION_IMPORT_CHUNK_SIZE = 2000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  VILLAGE_POPULATION_IMPORT_VALIDATION_CONCURRENCY = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  VILLAGE_POPULATION_IMPORT_CONFIRM_CONCURRENCY = 1;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Environment validation failed: ${errors.toString()}`);
  }
  return validatedConfig;
}
