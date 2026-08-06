import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { STORAGE_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new S3Client({
          endpoint: config.get<string>('STORAGE_ENDPOINT'),
          region: config.get<string>('STORAGE_REGION'),
          forcePathStyle: config.get<boolean>('STORAGE_FORCE_PATH_STYLE'),
          credentials: {
            accessKeyId: config.get<string>('STORAGE_ACCESS_KEY_ID')!,
            secretAccessKey: config.get<string>('STORAGE_SECRET_ACCESS_KEY')!,
          },
        }),
    },
    StorageService,
  ],
  exports: [STORAGE_CLIENT, StorageService],
})
export class StorageModule {}
