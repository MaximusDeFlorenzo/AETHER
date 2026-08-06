import { Injectable, Logger } from '@nestjs/common';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import { SentinelSceneRef } from './sentinel.types';

/**
 * Structural stub, not a real adapter — registered like `BmkgAdapter`/
 * `NasaFirmsAdapter`/`WeatherAdapter` so the registry/scheduler pattern
 * stays uniform (one entry per source, no special-casing for "the one
 * that's unimplemented"), but `fetch()` always returns `[]`.
 *
 * Sentinel Hub requires OAuth2 client-credentials auth plus a tile-download
 * and processing pipeline (Sentinel imagery is large binary rasters, not a
 * simple JSON/CSV feed like BMKG or FIRMS) — disproportionate complexity for
 * a source nothing downstream consumes yet (the Computer Vision Engine's
 * `computer_vision/flood.py` etc. take a decoded image directly; wiring
 * Sentinel tiles into that pipeline is its own follow-up, not implied by
 * having this adapter registered). `SENTINEL_API_KEY` is scaffolded in
 * `env.validation.ts` but intentionally unread here.
 */
@Injectable()
export class SentinelAdapter
  implements HazardDataSourceAdapter<SentinelSceneRef>
{
  readonly sourceId = 'sentinel';

  private readonly logger = new Logger(SentinelAdapter.name);
  private hasWarned = false;

  async fetch(): Promise<SentinelSceneRef[]> {
    if (!this.hasWarned) {
      this.logger.warn(
        'Sentinel adapter is a structural stub — not implemented. Needs ' +
          'Sentinel Hub OAuth2 + imagery-tile processing pipeline.',
      );
      this.hasWarned = true;
    }
    return [];
  }

  normalize(): NormalizedHazardEvent {
    throw new Error('SentinelAdapter.normalize is unreachable — fetch() never returns rows');
  }
}
