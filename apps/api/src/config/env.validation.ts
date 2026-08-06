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

  @IsOptional()
  @IsString()
  NASA_FIRMS_BASE_URL = 'https://firms.modaps.eosdis.nasa.gov/api';

  @IsOptional()
  @IsString()
  NASA_FIRMS_API_KEY?: string;

  // Sentinel adapter is a structural stub (docs/ARCHITECTURE.md §5) — no
  // adapter reads this key yet, kept so the config shape is ready the moment
  // Sentinel Hub OAuth2 is wired.
  @IsOptional()
  @IsString()
  SENTINEL_API_KEY?: string;

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
