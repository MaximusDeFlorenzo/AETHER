import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { dibiQueryBody, type DibiEventRow } from '../lib/dibi';

const DEFAULT_BASE_URL = 'https://dibi.bnpb.go.id';
const USER_AGENT = 'AETHER/0.1 (disaster early-warning decision support)';
const TIMEOUT_MS = 120_000;
// The dashboard chart's own row limit; one year of flood + landslide
// reports is ~2–5k rows (2025: 4,310).
const ROW_LIMIT = 50_000;

interface ChartDataResponse {
  result?: Array<{
    status?: string;
    error?: string | null;
    rowcount?: number;
    data?: DibiEventRow[];
  }>;
}

/**
 * Reads BNPB DIBI flood/landslide event records through the public DIBI
 * dashboard's chart-data API (lib/dibi.ts explains the request shape). One
 * request per year; a year at the row limit is refused rather than
 * silently truncated.
 */
@Injectable()
export class DibiClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async fetchYear(year: number): Promise<DibiEventRow[]> {
    const baseUrl =
      this.config.get<string>('DIBI_BASE_URL') ?? DEFAULT_BASE_URL;
    const response = await firstValueFrom(
      this.http.post<ChartDataResponse>(
        `${baseUrl}/api/v1/chart/data`,
        dibiQueryBody(year, ROW_LIMIT),
        {
          timeout: TIMEOUT_MS,
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    const result = response.data?.result?.[0];
    if (!result || result.error || !Array.isArray(result.data)) {
      throw new Error(
        `DIBI ${year}: unexpected response (${result?.error ?? 'no result'})`,
      );
    }
    if (result.data.length >= ROW_LIMIT) {
      throw new Error(`DIBI ${year}: ${ROW_LIMIT} rows — result truncated`);
    }
    return result.data;
  }
}
