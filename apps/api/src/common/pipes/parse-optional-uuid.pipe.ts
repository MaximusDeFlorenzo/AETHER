import {
  ArgumentMetadata,
  Injectable,
  ParseUUIDPipe,
  PipeTransform,
} from '@nestjs/common';

/**
 * Validates an optional UUID query param — passes `undefined` through
 * untouched (so `@IsOptional()` DTOs stay optional) but still rejects a
 * present-but-malformed value the same way `ParseUUIDPipe` does.
 */
@Injectable()
export class ParseOptionalUuidPipe implements PipeTransform {
  private readonly delegate = new ParseUUIDPipe({ version: '4' });

  async transform(value: unknown, metadata: ArgumentMetadata) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return this.delegate.transform(value as string, metadata);
  }
}
