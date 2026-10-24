import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppDataSource } from '../../database/data-source';
import { District, RainfallPointArchive } from '../../database/entities';
import { GsmapArchiveService } from '../gsmap-archive.service';
import { parseIsoDay } from '../lib/gsmap-archive';
import { GsmapFtpProvider } from '../providers/gsmap-ftp.provider';

/**
 * Bulk backfill of the GSMaP_Gauge hourly archive at every district point
 * (docs/RAINFALL_INTELLIGENCE.md §10), outside the API process so that
 * `nest start --watch` restarts don't interrupt it. Resumable: complete
 * days are skipped.
 *
 *   npm run rainfall:archive                       # GSMAP_ARCHIVE_FROM → newest
 *   npm run rainfall:archive -- --from 2024-01-01 --to 2024-03-31 --max-days 10
 *   npm run rainfall:archive -- --connections 1
 *
 * ~24 files of ~2 MB per day over JAXA FTP. Measured 2026-10-08: ~2 min per
 * day over one connection, ~70 s per day with the default 3 (6 gained
 * little more, so 3 keeps the load on JAXA's server modest).
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function dayArg(name: string): Date | undefined {
  const value = arg(name);
  if (value === undefined) return undefined;
  const day = parseIsoDay(value);
  if (!day) throw new Error(`--${name} must be YYYY-MM-DD`);
  return day;
}

async function main() {
  const from = dayArg('from');
  const to = dayArg('to');
  const connections = Number(arg('connections') ?? 3);
  if (!(
    Number.isInteger(connections) &&
    connections >= 1 &&
    connections <= 6
  )) {
    throw new Error('--connections must be 1–6');
  }
  const maxDaysArg = arg('max-days');
  const maxDays = maxDaysArg === undefined ? undefined : Number(maxDaysArg);
  if (maxDays !== undefined && !(Number.isInteger(maxDays) && maxDays >= 0)) {
    throw new Error('--max-days must be a non-negative integer');
  }

  // Hours of upserts would flood the terminal with SQL in development.
  AppDataSource.setOptions({ logging: ['error'] });
  await AppDataSource.initialize();
  const config = new ConfigService(process.env);
  const service = new GsmapArchiveService(
    new GsmapFtpProvider(config),
    config,
    AppDataSource.getRepository(District),
    AppDataSource.getRepository(RainfallPointArchive),
  );
  if (!service.isConfigured()) {
    throw new Error('GSMAP_FTP_USER / GSMAP_FTP_PASSWORD are not set');
  }
  const summary = await service.backfill({ from, to, maxDays, connections });
  new Logger('gsmap-archive-backfill').log(JSON.stringify(summary));
  await AppDataSource.destroy();
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(`Archive backfill failed: ${error.message}`);
    process.exit(1);
  });
