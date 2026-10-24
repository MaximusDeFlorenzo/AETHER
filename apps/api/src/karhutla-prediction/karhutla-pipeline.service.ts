import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AxiosError } from 'axios';
import {
  District,
  HazardEvent,
  KarhutlaClusterForecast,
  KarhutlaPredictionRun,
} from '../database/entities';
import { HazardType } from '../common/enums/domain.enum';
import { KarhutlaForecastStatus, KarhutlaRunStatus } from './karhutla.enums';
import {
  CLUSTER_LINK_KM,
  DISTRICT_CANDIDATE_RADIUS_KM,
  FUTURE_TOLERANCE_MS,
  MAX_HOTSPOTS_PER_CLUSTER,
  SMOKE_PARTICLES,
  WIND_GRID_HALF_WIDTH_DEG,
  WIND_GRID_SPACING_DEG,
} from './karhutla.constants';
import {
  clusterHotspots,
  clusterSeed,
  dedupeHotspots,
  normalizeHotspot,
  type HotspotCluster,
} from './lib/hotspots';
import { assessDataQuality } from './lib/data-quality';
import { computeExposure, type CandidatePlace } from './lib/exposure';
import { buildRecommendations } from './lib/recommendations';
import { geometryBounds, haversineKm, snappedGrid } from './lib/geo';
import {
  OPEN_METEO_PROVENANCE,
  OpenMeteoAtmosphereProvider,
  type AtmosphereSeries,
} from './providers/open-meteo-atmosphere.provider';
import {
  TerrainProvider,
  type TerrainRing,
} from './providers/terrain.provider';
import {
  SettlementsProvider,
  type Bounds,
} from './providers/settlements.provider';
import { KarhutlaEngineClient } from './karhutla-engine.client';
import type {
  FireSpreadRequest,
  FireSpreadResponse,
  SmokeTransportRequest,
  SmokeTransportResponse,
} from './karhutla.types';

const FIRMS_SOURCE = 'nasa_firms';
// Settlement lookups are bounded so one huge smoke footprint can't turn
// into a country-sized Overpass query.
const MAX_SETTLEMENT_HALF_WIDTH_DEG = 2.5;

function engineError(reason: unknown): string {
  const error = reason as AxiosError<{ detail?: unknown }>;
  const detail = error?.response?.data?.detail;
  if (detail)
    return typeof detail === 'string'
      ? detail
      : JSON.stringify(detail).slice(0, 500);
  return error?.message ?? String(reason);
}

const pointKey = (p: { latitude: number; longitude: number }) =>
  `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;

/**
 * Executes one karhutla prediction run (called from the BullMQ processor,
 * never from an HTTP request). Steps: load recent FIRMS hotspots ->
 * normalize/dedupe/filter -> cluster -> fetch atmosphere, terrain and
 * settlements -> call the spread and smoke engines per cluster ->
 * exposure + recommendations -> persist. A failure in one cluster is
 * recorded on that cluster and never aborts the others.
 */
@Injectable()
export class KarhutlaPipelineService {
  private readonly logger = new Logger(KarhutlaPipelineService.name);

  constructor(
    @InjectRepository(KarhutlaPredictionRun)
    private readonly runRepository: Repository<KarhutlaPredictionRun>,
    @InjectRepository(KarhutlaClusterForecast)
    private readonly forecastRepository: Repository<KarhutlaClusterForecast>,
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
    @InjectRepository(District)
    private readonly districtRepository: Repository<District>,
    private readonly atmosphere: OpenMeteoAtmosphereProvider,
    private readonly terrain: TerrainProvider,
    private readonly settlements: SettlementsProvider,
    private readonly engine: KarhutlaEngineClient,
  ) {}

  async markFailed(runId: string, message: string): Promise<void> {
    await this.runRepository.update(
      {
        id: runId,
        status: In([KarhutlaRunStatus.QUEUED, KarhutlaRunStatus.RUNNING]),
      },
      {
        status: KarhutlaRunStatus.FAILED,
        error: message.slice(0, 2000),
        completedAt: new Date(),
      },
    );
  }

  async execute(runId: string): Promise<void> {
    const run = await this.runRepository.findOne({ where: { id: runId } });
    if (!run) {
      this.logger.warn(`Karhutla run ${runId} not found; skipping job`);
      return;
    }
    // Redelivered job for a run that already finished: nothing to do.
    if (
      run.status !== KarhutlaRunStatus.QUEUED &&
      run.status !== KarhutlaRunStatus.RUNNING
    )
      return;

    // A RUNNING run here is a retry after a crash: start clean.
    await this.forecastRepository.delete({ run: { id: runId } });
    const issuedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await this.runRepository.update(runId, {
      status: KarhutlaRunStatus.RUNNING,
      issuedAt,
      startedAt: new Date(),
      error: null,
    });

    const windowStart = new Date(
      issuedAt.getTime() - run.hotspotWindowHours * 3_600_000,
    );
    const rows = await this.hazardEventRepository.find({
      where: {
        hazardType: HazardType.WILDFIRE,
        source: FIRMS_SOURCE,
        eventTime: MoreThanOrEqual(windowStart),
      },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        eventTime: true,
        externalId: true,
        rawPayload: true,
      },
    });

    const futureCutoff = issuedAt.getTime() + FUTURE_TOLERANCE_MS;
    const futureRows = rows.filter(
      (r) => new Date(r.eventTime).getTime() > futureCutoff,
    );
    const normalized = rows
      .filter((r) => new Date(r.eventTime).getTime() <= futureCutoff)
      .map(normalizeHotspot);
    const valid = normalized.filter(
      (h): h is NonNullable<typeof h> => h !== null,
    );
    const { unique, duplicates } = dedupeHotspots(valid);
    const eligible = unique.filter((h) => h.confidenceClass !== 'low');
    const clusters = clusterHotspots(eligible, CLUSTER_LINK_KM);
    const selected = clusters.slice(0, run.maxClusters);

    const warnings: string[] = [];
    if (futureRows.length) {
      warnings.push(
        `${futureRows.length} hotspot(s) timestamped after the run's issue time were excluded as conflicting.`,
      );
    }
    const inputSummary = {
      hotspotWindow: {
        from: windowStart.toISOString(),
        to: issuedAt.toISOString(),
      },
      hotspotsInWindow: rows.length,
      excludedFutureTimestamps: futureRows.length,
      excludedInvalid: normalized.length - valid.length,
      duplicatesRemoved: duplicates,
      excludedLowConfidence: unique.length - eligible.length,
      hotspotsUsed: eligible.length,
      clustersFound: clusters.length,
      clustersForecast: selected.length,
      clusterLinkKm: CLUSTER_LINK_KM,
      sources: [
        {
          id: 'nasa_firms',
          name: 'NASA FIRMS (MODIS + VIIRS NRT)',
          kind: 'satellite_observation',
          latestObservationAt: eligible.length
            ? new Date(
                Math.max(...eligible.map((h) => h.observedAt.getTime())),
              ).toISOString()
            : null,
          attribution: 'NASA FIRMS, LANCE/EOSDIS',
        },
        {
          id: 'open-meteo',
          name: 'Open-Meteo forecast API',
          ...OPEN_METEO_PROVENANCE,
        },
        {
          id: 'open-meteo-elevation',
          name: 'Open-Meteo elevation (Copernicus GLO-90)',
          kind: 'static_dem',
        },
        {
          id: 'openstreetmap',
          name: 'OpenStreetMap place nodes (Overpass API)',
          kind: 'reference',
          enabled: this.settlements.enabled,
          attribution: '© OpenStreetMap contributors (ODbL)',
        },
      ],
    };

    if (!selected.length) {
      await this.runRepository.update(runId, {
        status: KarhutlaRunStatus.COMPLETED,
        inputSummary: inputSummary as QueryDeepPartialEntity<
          Record<string, unknown>
        >,
        warnings,
        completedAt: new Date(),
      });
      this.logger.log(`Karhutla run ${runId}: no eligible hotspot clusters`);
      return;
    }

    const sourcePoints = selected.map((c) => ({
      latitude: Number(c.latitude.toFixed(3)),
      longitude: Number(c.longitude.toFixed(3)),
    }));
    const grids = selected.map((c) =>
      snappedGrid(
        c.latitude,
        c.longitude,
        WIND_GRID_HALF_WIDTH_DEG,
        WIND_GRID_SPACING_DEG,
      ),
    );
    const allPoints = [...sourcePoints, ...grids.flat()];
    const atmosphereList = await this.atmosphere.fetch(allPoints);
    const atmosphereByKey = new Map<string, AtmosphereSeries>();
    allPoints.forEach((p, i) => {
      const series = atmosphereList[i];
      if (series) atmosphereByKey.set(pointKey(p), series);
    });
    const terrainRings = await this.terrain.rings(sourcePoints);
    const districts = await this.loadDistrictCandidates();

    let spreadModelVersion: string | null = null;
    let smokeModelVersion: string | null = null;
    let allOk = true;
    for (const [index, cluster] of selected.entries()) {
      const forecast = await this.forecastCluster({
        run,
        issuedAt,
        rank: index + 1,
        cluster,
        source: atmosphereByKey.get(pointKey(sourcePoints[index])) ?? null,
        grid: grids[index]
          .map((p) => atmosphereByKey.get(pointKey(p)))
          .filter((s): s is AtmosphereSeries => Boolean(s)),
        gridRequested: grids[index].length,
        terrain: terrainRings[index],
        districts,
      });
      spreadModelVersion ??= forecast.spreadModelVersion;
      smokeModelVersion ??= forecast.smokeModelVersion;
      if (forecast.entity.status !== KarhutlaForecastStatus.OK) allOk = false;
      await this.forecastRepository.save(forecast.entity);
    }

    await this.runRepository.update(runId, {
      status: allOk ? KarhutlaRunStatus.COMPLETED : KarhutlaRunStatus.PARTIAL,
      spreadModelVersion,
      smokeModelVersion,
      inputSummary: inputSummary as QueryDeepPartialEntity<
        Record<string, unknown>
      >,
      warnings,
      completedAt: new Date(),
    });
    this.logger.log(
      `Karhutla run ${runId} finished: ${selected.length} cluster(s), ${allOk ? 'all ok' : 'partial'}`,
    );
  }

  private async loadDistrictCandidates(): Promise<CandidatePlace[]> {
    const districts = await this.districtRepository.find({
      relations: { province: true },
    });
    return districts.flatMap((d) => {
      const coords = d.geom as {
        type?: string;
        coordinates?: [number, number];
      } | null;
      if (coords?.type !== 'Point' || !coords.coordinates) return [];
      const [longitude, latitude] = coords.coordinates;
      return [
        {
          id: d.id,
          name: d.name,
          kind: 'district_reference_point' as const,
          placeType: null,
          provinceName: d.province?.name ?? null,
          latitude,
          longitude,
          source: 'aether_districts' as const,
        },
      ];
    });
  }

  private buildSpreadRequest(
    issuedAt: Date,
    horizons: number[],
    cluster: HotspotCluster,
    source: AtmosphereSeries,
    terrain: TerrainRing | null,
  ): FireSpreadRequest {
    const hotspots = [...cluster.hotspots]
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
      .slice(0, MAX_HOTSPOTS_PER_CLUSTER);
    return {
      issuedAt: issuedAt.toISOString(),
      horizonsHours: horizons,
      hotspots: hotspots.map((h) => ({
        latitude: h.latitude,
        longitude: h.longitude,
        observedAt: h.observedAt.toISOString(),
        scanKm: h.scanKm,
        trackKm: h.trackKm,
        frpMw: h.frpMw,
        confidence: h.confidence,
      })),
      weather: source.hours.map((h) => ({
        time: h.time,
        windSpeedKmh: h.windSpeed10mKmh,
        windFromDeg: h.windFrom10mDeg,
        temperatureC: h.temperatureC,
        relativeHumidityPct: h.relativeHumidityPct,
        precipitationMm: h.precipitationMm,
      })),
      terrain: terrain
        ? {
            centerElevationM: terrain.centerElevationM,
            ringRadiusKm: terrain.ringRadiusKm,
            ring: terrain.ring,
          }
        : null,
    };
  }

  private buildSmokeRequest(
    issuedAt: Date,
    horizons: number[],
    cluster: HotspotCluster,
    points: AtmosphereSeries[],
  ): SmokeTransportRequest {
    return {
      issuedAt: issuedAt.toISOString(),
      horizonsHours: horizons,
      source: {
        latitude: cluster.latitude,
        longitude: cluster.longitude,
        latestObservationAt: cluster.latestObservedAt.toISOString(),
        hotspotCount: cluster.hotspots.length,
        totalFrpMw: cluster.totalFrpMw,
        sourceRadiusKm: Math.min(50, Math.max(1, cluster.radiusKm)),
      },
      atmosphere: points.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        hours: p.hours.map((h) => ({
          time: h.time,
          boundaryLayerHeightM: h.boundaryLayerHeightM,
          precipitationMm: h.precipitationMm,
          levels: h.levels,
        })),
      })),
      particles: SMOKE_PARTICLES,
      seed: clusterSeed(cluster),
    };
  }

  private async forecastCluster(args: {
    run: KarhutlaPredictionRun;
    issuedAt: Date;
    rank: number;
    cluster: HotspotCluster;
    source: AtmosphereSeries | null;
    grid: AtmosphereSeries[];
    gridRequested: number;
    terrain: TerrainRing | null;
    districts: CandidatePlace[];
  }): Promise<{
    entity: KarhutlaClusterForecast;
    spreadModelVersion: string | null;
    smokeModelVersion: string | null;
  }> {
    const { run, issuedAt, cluster, source, grid, terrain } = args;
    const horizons = [...run.horizonsHours].sort((a, b) => a - b);
    const maxHorizon = horizons[horizons.length - 1];
    const errors: string[] = [];

    const atmospherePoints = source ? [source, ...grid] : grid;
    const [spreadResult, smokeResult] = await Promise.allSettled([
      source
        ? this.engine.predictFireSpread(
            this.buildSpreadRequest(
              issuedAt,
              horizons,
              cluster,
              source,
              terrain,
            ),
          )
        : Promise.reject(new Error('No surface weather at the fire location')),
      atmospherePoints.length
        ? this.engine.predictSmokeTransport(
            this.buildSmokeRequest(
              issuedAt,
              horizons,
              cluster,
              atmospherePoints,
            ),
          )
        : Promise.reject(new Error('No atmosphere data around the fire')),
    ]);
    const spread: FireSpreadResponse | null =
      spreadResult.status === 'fulfilled' ? spreadResult.value : null;
    const smoke: SmokeTransportResponse | null =
      smokeResult.status === 'fulfilled' ? smokeResult.value : null;
    if (spreadResult.status === 'rejected')
      errors.push(`Spread engine: ${engineError(spreadResult.reason)}`);
    if (smokeResult.status === 'rejected')
      errors.push(`Smoke engine: ${engineError(smokeResult.reason)}`);

    const dataQuality = assessDataQuality({
      issuedAt,
      latestHotspotAt: cluster.latestObservedAt,
      weatherRetrievedAt: source ? new Date(source.retrievedAt) : null,
      surfaceWeatherTimes: (source?.hours ?? []).map((h) => new Date(h.time)),
      atmosphereGridPoints: grid.length,
      atmosphereGridPointsRequested: args.gridRequested,
      terrainAvailable: Boolean(terrain),
      maxHorizonHours: maxHorizon,
    });

    // Candidate places: districts near the fire, plus OSM settlements.
    const nearbyDistricts = args.districts.filter(
      (d) =>
        haversineKm(
          cluster.latitude,
          cluster.longitude,
          d.latitude,
          d.longitude,
        ) <= DISTRICT_CANDIDATE_RADIUS_KM,
    );
    const envelopes = (spread?.horizons ?? []).map((h) => h.envelope);
    const smokeGeoms = (smoke?.horizons ?? []).flatMap((h) =>
      h.footprint.map((f) => f.geometry),
    );
    let settlementsUnavailable = false;
    let settlementPlaces: CandidatePlace[] = [];
    if (spread || smoke) {
      const places = await this.settlements.around(
        this.clampBounds(
          geometryBounds([...envelopes, ...smokeGeoms]),
          cluster,
          0.5,
        ),
        this.clampBounds(geometryBounds(envelopes), cluster, 0.1, 0.05),
      );
      if (places === null) settlementsUnavailable = true;
      else settlementPlaces = places;
    }

    const exposure = computeExposure(
      cluster,
      [...nearbyDistricts, ...settlementPlaces],
      spread?.horizons ?? [],
      smoke?.horizons ?? [],
      horizons,
    );
    // Worst of the two engines' qualitative labels; one engine missing
    // degrades the whole cluster forecast.
    const engines = [spread, smoke].filter((e) => e !== null);
    const confidence = !engines.length
      ? null
      : engines.length < 2 || engines.some((e) => e.confidence === 'very_low')
        ? 'very_low'
        : 'low';
    const spreadOk = spread?.horizons.some((h) => h.status === 'ok') ?? false;
    const smokeOk = smoke?.horizons.some((h) => h.status === 'ok') ?? false;
    const recommendations = buildRecommendations({
      hotspotFreshness: dataQuality.hotspotFreshness,
      hotspotAgeHours: dataQuality.hotspotAgeHours,
      confidence,
      spreadAvailable: spreadOk,
      smokeAvailable: smokeOk,
      exposure,
      settlementsUnavailable,
    });

    const everyHorizonOk =
      spread?.horizons.every((h) => h.status === 'ok') &&
      smoke?.horizons.every((h) => h.status === 'ok');
    const status = everyHorizonOk
      ? KarhutlaForecastStatus.OK
      : spreadOk || smokeOk
        ? KarhutlaForecastStatus.PARTIAL
        : spread || smoke
          ? KarhutlaForecastStatus.INSUFFICIENT_DATA
          : KarhutlaForecastStatus.FAILED;

    const nearest = [...args.districts].sort(
      (a, b) =>
        haversineKm(
          cluster.latitude,
          cluster.longitude,
          a.latitude,
          a.longitude,
        ) -
        haversineKm(
          cluster.latitude,
          cluster.longitude,
          b.latitude,
          b.longitude,
        ),
    )[0];
    const surfaceWindow = (source?.hours ?? []).filter((h) => {
      const t = new Date(h.time).getTime();
      return (
        t >= cluster.latestObservedAt.getTime() - 3_600_000 &&
        t <= issuedAt.getTime() + (maxHorizon + 1) * 3_600_000
      );
    });

    const entity = this.forecastRepository.create({
      run: { id: run.id } as KarhutlaPredictionRun,
      rank: args.rank,
      status,
      latitude: Number(cluster.latitude.toFixed(6)),
      longitude: Number(cluster.longitude.toFixed(6)),
      centroid: {
        type: 'Point',
        coordinates: [cluster.longitude, cluster.latitude],
      },
      locationLabel: nearest
        ? `Near ${nearest.name}${nearest.provinceName ? `, ${nearest.provinceName}` : ''}`
        : null,
      nearestDistrict: nearest ? ({ id: nearest.id } as District) : null,
      hotspotCount: cluster.hotspots.length,
      totalFrpMw: cluster.totalFrpMw,
      maxConfidence: cluster.maxConfidence,
      firstObservedAt: cluster.firstObservedAt,
      latestObservedAt: cluster.latestObservedAt,
      hotspotEventIds: cluster.hotspots.map((h) => h.eventId),
      sensors: cluster.sensors,
      observedFootprint: spread?.observedFootprint ?? null,
      // The pixel footprint is stored once, as an observation column.
      spread: spread
        ? Object.fromEntries(
            Object.entries(spread).filter(
              ([key]) => key !== 'observedFootprint',
            ),
          )
        : null,
      smoke: smoke as unknown as Record<string, unknown> | null,
      weather: source
        ? {
            provenance: OPEN_METEO_PROVENANCE,
            retrievedAt: source.retrievedAt,
            modelElevationM: source.elevationM,
            surfaceHours: surfaceWindow.map((h) => ({
              time: h.time,
              windSpeedKmh: Number(h.windSpeed10mKmh.toFixed(1)),
              windFromDeg: h.windFrom10mDeg,
              temperatureC: h.temperatureC,
              relativeHumidityPct: h.relativeHumidityPct,
              precipitationMm: h.precipitationMm,
              boundaryLayerHeightM: h.boundaryLayerHeightM,
            })),
            terrain: terrain
              ? {
                  source: terrain.source,
                  centerElevationM: terrain.centerElevationM,
                }
              : null,
          }
        : null,
      dataQuality: dataQuality as unknown as Record<string, unknown>,
      exposure: exposure as unknown as Record<string, unknown>[],
      recommendations: recommendations as unknown as Record<string, unknown>[],
      confidence,
      error: errors.length ? errors.join(' | ') : null,
    });

    return {
      entity,
      spreadModelVersion: spread?.modelVersion ?? null,
      smokeModelVersion: smoke?.modelVersion ?? null,
    };
  }

  /** Bounds for a settlement query: the given bounds padded by `padDeg`,
   * or the cluster ± `fallbackDeg` when there are none, never wider than
   * MAX_SETTLEMENT_HALF_WIDTH_DEG around the cluster. */
  private clampBounds(
    bounds: Bounds | null,
    cluster: HotspotCluster,
    fallbackDeg: number,
    padDeg = 0,
  ): Bounds {
    const b = bounds ?? {
      south: cluster.latitude - fallbackDeg,
      north: cluster.latitude + fallbackDeg,
      west: cluster.longitude - fallbackDeg,
      east: cluster.longitude + fallbackDeg,
    };
    const lim = MAX_SETTLEMENT_HALF_WIDTH_DEG;
    return {
      south: Math.max(b.south - padDeg, cluster.latitude - lim),
      north: Math.min(b.north + padDeg, cluster.latitude + lim),
      west: Math.max(b.west - padDeg, cluster.longitude - lim),
      east: Math.min(b.east + padDeg, cluster.longitude + lim),
    };
  }
}
