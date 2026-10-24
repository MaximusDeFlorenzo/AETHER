import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HazardType } from '../../common/enums/domain.enum';
import {
  District,
  DistrictTerrainProfile,
  WeatherHourlySample,
} from '../../database/entities';
import type { NormalizedHazardEvent } from '../../hazard-events/hazard-event-normalized.interface';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import {
  rainfallSourcePriorities,
  selectTrailing24hRainfall,
  type RainfallRow,
  type RainfallSourcePriority,
} from '../../rainfall-intelligence/lib/trailing-rainfall';
import { WeatherDataKind } from '../../rainfall-intelligence/rainfall.enums';
import {
  LANDSLIDE_SLOPE_QUANTILE,
  MIN_TERRAIN_SAMPLES,
  slopeQuantileDeg,
} from '../../rainfall-intelligence/lib/terrain';

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
// Fallback while a district has no DEM slope profile yet (sampling is
// spread over days — rainfall-intelligence/district-terrain.service.ts):
// typical hilly/highland terrain, the kind of location a landslide-prone
// district is usually sited near. A human reviewer can always correct it
// via a follow-up manual report (`POST /hazard-events/manual`).
const DEFAULT_SLOPE_DEGREES = 25;
// 24 h window + slack for each source's ingestion cadence.
const RAINFALL_LOOKBACK_HOURS = 30;
const HOUR_MS = 60 * 60 * 1000;

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
  /** Which stored series the 24 h total came from, and what it is. */
  rainfallSource: string;
  rainfallDataKind: WeatherDataKind;
  effectiveSlopeDegrees: number;
  /** 'dem_p90': Copernicus GLO-90 slope around the point; 'default': none stored. */
  slopeSource: 'dem_p90' | 'default';
  /** End of the 24 h rainfall window. */
  observedAt: string;
}

/**
 * Fifth concrete `HazardDataSourceAdapter` — a rainfall-triggered landslide
 * candidate source. Landslide has no independent live public feed
 * (docs/SRS.md §6: "no single stable public real-time feed exists yet ...
 * live rainfall/soil-sensor integration remains a future candidate once a
 * source is validated").
 *
 * Reads each district's trailing-24h rainfall from the stored hourly
 * history (`weather_hourly_samples`, filled by rainfall-intelligence/) —
 * JAXA GSMaP_Gauge_NOW satellite estimate first, Open-Meteo model values as
 * fallback, each only if fresh and complete for all 24 hours
 * (`selectTrailing24hRainfall`). The source used is recorded in the event's
 * raw payload. A district whose 24h total crosses
 * `RAINFALL_TRIGGER_THRESHOLD_MM` becomes a candidate landslide event.
 *
 * Previously called Open-Meteo once per district per poll (514 calls every
 * 15 min ≈ 49k/day), far over the shared free tier (10k/day) — verified
 * 2026-10-06 when Open-Meteo answered HTTP 429. Reading stored data costs
 * no provider calls.
 * `soilSaturation` is derived from that same rainfall figure (a documented
 * heuristic, not a measurement); `slopeDegrees` is the p90 Copernicus
 * GLO-90 slope stored for the district (`district_terrain_profiles`),
 * falling back to a fixed default while none is stored. It previously came
 * from BNPB's InaRISK `INDEKS_RISIKO_TANAH_LONGSOR` scaled onto 10–50°: a
 * risk index (it includes exposure) standing in for a slope, and the layer
 * times out on every request (verified 2026-10-07), so every candidate
 * waited 8 s and then got the default anyway.
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
    @InjectRepository(WeatherHourlySample)
    private readonly sampleRepository: Repository<WeatherHourlySample>,
    private readonly config: ConfigService,
    @InjectRepository(DistrictTerrainProfile)
    private readonly terrainRepository: Repository<DistrictTerrainProfile>,
  ) {}

  async fetch(now: Date = new Date()): Promise<LandslideRainfallCandidate[]> {
    const districts = await this.getDistrictCentroids();
    const rainfall = await this.loadRainfall(now);
    const candidates = districts
      .map((district) =>
        this.evaluateDistrict(district, rainfall.get(district.id), now),
      )
      .filter(
        (
          candidate,
        ): candidate is Omit<
          LandslideRainfallCandidate,
          'effectiveSlopeDegrees' | 'slopeSource'
        > => candidate !== null,
      );
    if (!candidates.length) return [];
    const slopes = await this.loadSlopes(candidates.map((c) => c.districtId));
    return candidates.map((candidate) => {
      const slope = slopes.get(candidate.districtId);
      return {
        ...candidate,
        effectiveSlopeDegrees: slope ?? DEFAULT_SLOPE_DEGREES,
        slopeSource: slope === undefined ? 'default' : 'dem_p90',
      };
    });
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

  private sourcePriorities(): RainfallSourcePriority[] {
    return rainfallSourcePriorities((envVar) => this.config.get(envVar));
  }

  /** district id → source → hourly rows over the lookback window. */
  private async loadRainfall(
    now: Date,
  ): Promise<Map<string, Map<string, RainfallRow[]>>> {
    const byDistrict = new Map<string, Map<string, RainfallRow[]>>();
    try {
      const rows = await this.sampleRepository.query<
        Array<{
          district_id: string;
          source: string;
          valid_time: Date;
          precipitation_mm: number | null;
        }>
      >(
        `SELECT district_id, source, valid_time, precipitation_mm
         FROM weather_hourly_samples
         WHERE source = ANY($1) AND valid_time > $2`,
        [
          this.sourcePriorities().map((p) => p.source),
          new Date(now.getTime() - RAINFALL_LOOKBACK_HOURS * HOUR_MS),
        ],
      );
      for (const row of rows) {
        const bySource =
          byDistrict.get(row.district_id) ?? new Map<string, RainfallRow[]>();
        const list = bySource.get(row.source) ?? [];
        list.push({
          validTime: new Date(row.valid_time),
          precipitationMm: row.precipitation_mm,
        });
        bySource.set(row.source, list);
        byDistrict.set(row.district_id, bySource);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to load stored rainfall: ${(error as Error).message}`,
      );
    }
    return byDistrict;
  }

  private evaluateDistrict(
    district: DistrictCentroid,
    rainfallBySource: Map<string, RainfallRow[]> | undefined,
    now: Date,
  ): Omit<
    LandslideRainfallCandidate,
    'effectiveSlopeDegrees' | 'slopeSource'
  > | null {
    const rainfall = rainfallBySource
      ? selectTrailing24hRainfall(
          rainfallBySource,
          this.sourcePriorities(),
          now,
        )
      : null;
    if (!rainfall || rainfall.rainfallMm < RAINFALL_TRIGGER_THRESHOLD_MM) {
      return null;
    }
    const rainfallMm = rainfall.rainfallMm;

    return {
      districtId: district.id,
      districtName: district.name,
      latitude: district.latitude,
      longitude: district.longitude,
      rainfallMm,
      rainfallSource: rainfall.source,
      rainfallDataKind: rainfall.dataKind,
      observedAt: rainfall.asOf.toISOString(),
    };
  }

  /**
   * District id → p90 DEM slope (degrees) of the stored terrain profile —
   * the same statistic the Milestone 4 landslide baseline classes, so a
   * point in a valley still reflects the hills around it. Never throws.
   */
  private async loadSlopes(
    districtIds: string[],
  ): Promise<Map<string, number>> {
    const slopes = new Map<string, number>();
    try {
      const rows = await this.terrainRepository.query<
        Array<{ district_id: string; slope_samples_deg: number[] }>
      >(
        `SELECT district_id, slope_samples_deg FROM district_terrain_profiles
         WHERE district_id = ANY($1)`,
        [districtIds],
      );
      for (const row of rows) {
        if (row.slope_samples_deg.length < MIN_TERRAIN_SAMPLES) continue;
        const slope = slopeQuantileDeg(
          row.slope_samples_deg,
          LANDSLIDE_SLOPE_QUANTILE,
        );
        if (slope !== null) {
          slopes.set(row.district_id, Math.round(slope * 10) / 10);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to load DEM slopes: ${(error as Error).message}`,
      );
    }
    return slopes;
  }
}
