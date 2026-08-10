import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HazardType } from '../../common/enums/domain.enum';
import { District } from '../../database/entities';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import {
  BNPB_LAYER_LANDSLIDE_RISK_INDEX,
  BnpbInariskClient,
} from './bnpb-inarisk.client';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import { OpenMeteoClient } from './open-meteo.client';

// 24h rainfall (mm) above which tropical-terrain slopes are considered at
// meaningfully elevated landslide risk — a widely-cited rule-of-thumb
// threshold for Indonesia's climate, not a calibrated per-region value (no
// per-region calibration data source exists — same honesty posture as
// every other v0 heuristic in this codebase).
const RAINFALL_TRIGGER_THRESHOLD_MM = 100;
// Rainfall level treated as "fully saturated" ground for the derived
// soilSaturation below — set below the trigger threshold so a just-over-
// threshold reading doesn't read as barely wet.
const SATURATION_REFERENCE_MM = 150;
// Fallback when the BNPB lookup below returns no data for a district's
// centroid (a real, expected outcome — the underlying raster has genuine
// coverage gaps) or the request fails: typical hilly/highland terrain, the
// kind of location a landslide-prone district is usually sited near. A
// human reviewer can always correct it via a follow-up manual report
// (`POST /hazard-events/manual`).
const DEFAULT_SLOPE_DEGREES = 25;
// Mirrors `landslide.py`'s `MIN/MAX_RELEVANT_SLOPE_DEGREES` normalization
// range — BNPB's `INDEKS_RISIKO_TANAH_LONGSOR` returns a 0-1 risk index
// (hazard × vulnerability × exposure), not a literal slope angle, so it's
// scaled linearly onto the same range the scoring formula already normalizes
// `slopeDegrees` against, rather than adding a second, separate scoring
// input. This is a proxy, not a measurement: a real per-location risk signal
// standing in for a slope reading no live source provides.
const MIN_EFFECTIVE_SLOPE_DEGREES = 10;
const MAX_EFFECTIVE_SLOPE_DEGREES = 50;

interface DistrictCentroid {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

interface LandslideRainfallCandidate {
  districtId: string;
  districtName: string;
  latitude: number;
  longitude: number;
  rainfallMm: number;
  effectiveSlopeDegrees: number;
  observedAt: string;
}

/**
 * Fifth concrete `HazardDataSourceAdapter` — a rainfall-triggered landslide
 * candidate source. Landslide has no independent live public feed
 * (docs/SRS.md §6: "no single stable public real-time feed exists yet ...
 * live rainfall/soil-sensor integration remains a future candidate once a
 * source is validated").
 *
 * Queries real observed 24h rainfall (`OpenMeteoClient`) at every seeded
 * district's centroid — no API key, no administrative-code crosswalk (see
 * `open-meteo.client.ts` for why BMKG's forecast API, the alternative real
 * source, was passed over). A district whose 24h total crosses
 * `RAINFALL_TRIGGER_THRESHOLD_MM` becomes a candidate landslide event.
 * `soilSaturation` is derived from that same rainfall figure (a documented
 * heuristic, not a measurement); `slopeDegrees` is enriched with a real
 * per-district lookup against BNPB's InaRISK `INDEKS_RISIKO_TANAH_LONGSOR`
 * layer (`bnpb-inarisk.client.ts`), falling back to a fixed default if that
 * lookup has no data for the point.
 *
 * Previously reused `WeatherAdapter`'s `WEATHER_API_BASE_URL`/
 * `WEATHER_API_KEY` (both blank by default, so this adapter never actually
 * ran) — replaced with this independent, no-key path so landslide isn't
 * blocked on flood's still-unconfigured generic weather provider.
 */
@Injectable()
export class LandslideRainfallTriggerAdapter implements HazardDataSourceAdapter<LandslideRainfallCandidate> {
  readonly sourceId = 'landslide_rainfall_trigger';

  private readonly logger = new Logger(LandslideRainfallTriggerAdapter.name);

  constructor(
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    private readonly openMeteoClient: OpenMeteoClient,
    private readonly bnpbClient: BnpbInariskClient,
  ) {}

  async fetch(): Promise<LandslideRainfallCandidate[]> {
    const districts = await this.getDistrictCentroids();
    const candidates = await Promise.all(
      districts.map((district) => this.evaluateDistrict(district)),
    );
    return candidates.filter(
      (candidate): candidate is LandslideRainfallCandidate =>
        candidate !== null,
    );
  }

  normalize(reading: LandslideRainfallCandidate): NormalizedHazardEvent {
    const soilSaturation = Math.min(
      1,
      reading.rainfallMm / SATURATION_REFERENCE_MM,
    );
    // Bucketed to the day, not the poll timestamp: sustained rain would
    // otherwise re-trigger a near-identical "new" event every 15-minute poll.
    const dateKey = reading.observedAt.slice(0, 10);
    return {
      hazardType: HazardType.LANDSLIDE,
      externalId: `${reading.districtId}-landslide-${dateKey}`,
      latitude: reading.latitude,
      longitude: reading.longitude,
      locationLabel: reading.districtName,
      region: null,
      eventTime: new Date(reading.observedAt),
      source: 'landslide_rainfall_trigger',
      rawPayload: reading as unknown as Record<string, unknown>,
      details: {
        slopeDegrees: reading.effectiveSlopeDegrees,
        soilSaturation: Math.round(soilSaturation * 1000) / 1000,
        triggeringRainfallMm: reading.rainfallMm,
      },
    };
  }

  private async getDistrictCentroids(): Promise<DistrictCentroid[]> {
    try {
      return await this.districtRepository
        .createQueryBuilder('d')
        .select('d.id', 'id')
        .addSelect('d.name', 'name')
        .addSelect('ST_Y(ST_Centroid(d.geom))', 'latitude')
        .addSelect('ST_X(ST_Centroid(d.geom))', 'longitude')
        .getRawMany<DistrictCentroid>();
    } catch (error) {
      this.logger.warn(
        `Failed to load district centroids: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private async evaluateDistrict(
    district: DistrictCentroid,
  ): Promise<LandslideRainfallCandidate | null> {
    const rainfallMm = await this.openMeteoClient.getLast24hRainfallMm(
      district.longitude,
      district.latitude,
    );
    if (rainfallMm === null || rainfallMm < RAINFALL_TRIGGER_THRESHOLD_MM) {
      return null;
    }

    const effectiveSlopeDegrees = await this.lookupEffectiveSlopeDegrees(
      district.longitude,
      district.latitude,
    );

    return {
      districtId: district.id,
      districtName: district.name,
      latitude: district.latitude,
      longitude: district.longitude,
      rainfallMm,
      effectiveSlopeDegrees,
      observedAt: new Date().toISOString(),
    };
  }

  private async lookupEffectiveSlopeDegrees(
    longitude: number,
    latitude: number,
  ): Promise<number> {
    const riskIndex = await this.bnpbClient.getIndexValue(
      BNPB_LAYER_LANDSLIDE_RISK_INDEX,
      longitude,
      latitude,
    );
    if (riskIndex === null) {
      return DEFAULT_SLOPE_DEGREES;
    }
    return (
      MIN_EFFECTIVE_SLOPE_DEGREES +
      riskIndex * (MAX_EFFECTIVE_SLOPE_DEGREES - MIN_EFFECTIVE_SLOPE_DEGREES)
    );
  }
}
