import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'basic-ftp';
import { PassThrough } from 'stream';
import { promisify } from 'util';
import { gunzip } from 'zlib';

const gunzipAsync = promisify(gunzip);

const DEFAULT_HOST = 'hokusai.eorc.jaxa.jp';
// Latest 24 h of GSMaP_NOW / GSMaP_Gauge_NOW (README.first.txt).
export const GSMAP_LATEST_DIR = '/now/latest';
const TIMEOUT_MS = 60_000;

export interface GsmapFtpSession {
  /** File names (not paths) in /now/latest. */
  listLatest(): Promise<string[]>;
  /** Downloads and gunzips one file from /now/latest. */
  downloadLatest(name: string): Promise<Buffer>;
  /** File names in any directory; null if the directory does not exist. */
  listFiles(dir: string): Promise<string[] | null>;
  /** Downloads and gunzips any `.gz` file by absolute path. */
  downloadGz(path: string): Promise<Buffer>;
}

// FTP reply to a LIST of a path that does not exist.
const FTP_FILE_UNAVAILABLE = 550;

/**
 * JAXA GSMaP FTP access (credentials from the JAXA registration email, in
 * GSMAP_FTP_USER / GSMAP_FTP_PASSWORD). The server offers plain FTP only —
 * verified 2026-10-06 that it answers AUTH TLS with 504 — so credentials
 * travel unencrypted; they grant read access to public research data only.
 *
 * One connection per session: FTP control connections are stateful and the
 * server is slow to accept new ones, so a run lists and downloads over a
 * single login.
 */
@Injectable()
export class GsmapFtpProvider {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('GSMAP_FTP_USER') &&
      this.config.get<string>('GSMAP_FTP_PASSWORD'),
    );
  }

  async withSession<T>(
    work: (session: GsmapFtpSession) => Promise<T>,
  ): Promise<T> {
    const client = new Client(TIMEOUT_MS);
    try {
      await client.access({
        host: this.config.get<string>('GSMAP_FTP_HOST') ?? DEFAULT_HOST,
        user: this.config.get<string>('GSMAP_FTP_USER'),
        password: this.config.get<string>('GSMAP_FTP_PASSWORD'),
        secure: false,
      });
      const listFiles = async (dir: string) => {
        try {
          return (await client.list(dir))
            .filter((entry) => entry.isFile)
            .map((entry) => entry.name);
        } catch (error) {
          if ((error as { code?: number }).code === FTP_FILE_UNAVAILABLE) {
            return null;
          }
          throw error;
        }
      };
      const downloadGz = async (path: string) => {
        const chunks: Buffer[] = [];
        const sink = new PassThrough();
        sink.on('data', (chunk: Buffer) => chunks.push(chunk));
        await client.downloadTo(sink, path);
        return gunzipAsync(Buffer.concat(chunks));
      };
      return await work({
        listLatest: async () => (await listFiles(GSMAP_LATEST_DIR)) ?? [],
        downloadLatest: (name) => downloadGz(`${GSMAP_LATEST_DIR}/${name}`),
        listFiles,
        downloadGz,
      });
    } finally {
      client.close();
    }
  }
}
