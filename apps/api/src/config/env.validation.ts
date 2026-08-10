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
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  STORAGE_FORCE_PATH_STYLE = true;
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
