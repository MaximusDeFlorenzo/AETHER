import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { STORAGE_CLIENT } from './storage.constants';

const SIGNED_URL_TTL_SECONDS = 900;

/**
 * Thin S3/MinIO-compatible object storage abstraction — new infra ORION
 * never needed (docs/MIGRATION_FROM_ORION.md: "ORION never needed binary
 * asset storage; AETHER's CV Engine does"). Consumers store an opaque
 * `key` (the `sourceImageRef` column on `cv_detections`,
 * docs/DATABASE_SCHEMA.md §22) and never touch the underlying client.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_CLIENT) private readonly client: S3Client,
    private readonly config: ConfigService,
  ) {}

  private get bucket(): string {
    return this.config.get<string>('STORAGE_BUCKET')!;
  }

  /** Uploads a buffer under a fresh, collision-proof key namespaced by
   * `prefix` (e.g. `field-reports/`) and returns that key. */
  async uploadObject(
    prefix: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const key = `${prefix.replace(/\/+$/, '')}/${randomUUID()}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return key;
  }

  /** Time-limited, browser-usable URL for a private object — used by review
   * UIs (e.g. the field-reports queue) rather than exposing the bucket
   * publicly. */
  getSignedUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /** Streams an object's bytes back rather than buffering the whole thing
   * into memory first — the download half of village-population-import's
   * streaming CSV pipeline (see
   * village-population-import/processors/validation.processor.ts): a
   * ~100k-row upload must never be fully materialized as one in-memory
   * Buffer just to hand it to the CSV parser. AWS SDK v3's `GetObjectCommand`
   * response `Body` is already a Node.js Readable in a Node runtime. */
  async downloadObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return result.Body as NodeJS.ReadableStream;
  }
}
