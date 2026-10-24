import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { HazardType } from '../../common/enums/domain.enum';
import type { HazardEventCreatedEvent } from '../../common/events/domain-events';
import { HazardEvent } from '../../database/entities';
import type {
  IngestedHazardEvent,
  NormalizedHazardEvent,
} from '../../hazard-events/hazard-event-normalized.interface';
import { CLUSTER_LINK_KM } from '../../karhutla-prediction/karhutla.constants';
import {
  clusterHotspots,
  normalizeHotspot,
  type HotspotCluster,
  type NormalizedHotspot,
} from '../../karhutla-prediction/lib/hotspots';
import type { HazardDataSourceAdapter } from './hazard-data-source-adapter.interface';
import {
  FIRMS_SOURCES,
  type FirmsHotspot,
  type FirmsSource,
} from './nasa-firms.types';

// west,south,east,north — covers Indonesia with margin, per FIRMS Area API's
// bbox format (https://firms.modaps.eosdis.nasa.gov/api/area/).
const INDONESIA_BBOX = '94,-12,142,7';
const DAY_RANGE = 1;
// VIIRS reports confidence as l/n/h rather than MODIS' 0-100 percentage;
// mapped onto apps/ai-engine's 0-1 `frpConfidence` at the centre of the
// matching MODIS band (low < 30, nominal 30-79, high >= 80).
const VIIRS_CONFIDENCE: Record<string, number> = { l: 0.3, n: 0.6, h: 0.9 };
// A new-fire cluster with a non-low detection this close in time before it
// (or any time after) is a fire already announced on an earlier poll.
const KNOWN_FIRE_LOOKBACK_HOURS = 24;
const KNOWN_FIRE_CANDIDATE_LIMIT = 200;
// Degrees of bbox margin covering CLUSTER_LINK_KM anywhere in the bbox
// (2.5 km ≈ 0.023° even at 12° latitude). The `&&` prefilter lets the
// geometry GiST index answer the query — `geom::geography` alone can't use
// it and seq-scans every hazard event (~750 ms vs ~4 ms per cluster).
const KNOWN_FIRE_BBOX_MARGIN_DEG = 0.03;

/**
 * Second concrete `HazardDataSourceAdapter`, alongside `BmkgAdapter` — polls
 * NASA FIRMS' public Area API for active fire/thermal-anomaly hotspots over
 * Indonesia, from MODIS (Terra/Aqua) and VIIRS (S-NPP, NOAA-20, NOAA-21) —
 * the same satellites SiPongi (KLHK) shows. `NASA_FIRMS_SOURCES` narrows
 * which products are polled. No ORION equivalent (ORION never ingested
 * satellite data).
 *
 * Each CSV row (one hotspot detection) is persisted as its own wildfire
 * hazard event with `hotspotCount: 1` — the karhutla pipeline clusters them
 * itself. Dedup via the usual `(externalId, source)` unique constraint
 * prevents the same detection being ingested twice across polls.
 *
 * VIIRS alone yields ~10k detections a day over this bbox, so detections
 * are not announced individually: `selectAnnouncements` clusters a poll's
 * new detections and emits HAZARD_EVENT_CREATED once per *new* fire
 * cluster (risk pipeline, notifications, live broadcast). A cluster near a
 * detection from the previous 24 h is an already-known fire and stays
 * silent.
 */
@Injectable()
export class NasaFirmsAdapter implements HazardDataSourceAdapter<FirmsHotspot> {
  readonly sourceId = 'nasa_firms';

  private readonly logger = new Logger(NasaFirmsAdapter.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(HazardEvent)
    private readonly hazardEventRepository: Repository<HazardEvent>,
  ) {}

  async fetch(): Promise<FirmsHotspot[]> {
    const apiKey = this.config.get<string>('NASA_FIRMS_API_KEY');
    if (!apiKey) {
      this.logger.debug('NASA_FIRMS_API_KEY not configured — skipping poll');
      return [];
    }
    const baseUrl = this.config.get<string>('NASA_FIRMS_BASE_URL');
    // One product failing (FIRMS occasionally lags a satellite) must not
    // drop the others' detections.
    const perSource = await Promise.all(
      this.configuredSources().map(async (source) => {
        const url = `${baseUrl}/area/csv/${apiKey}/${source}/${INDONESIA_BBOX}/${DAY_RANGE}`;
        try {
          const { data } = await firstValueFrom(
            this.http.get<string>(url, {
              timeout: 15_000,
              responseType: 'text',
            }),
          );
          return parseFirmsCsv(data, source);
        } catch (error) {
          this.logger.warn(
            `Failed to fetch NASA FIRMS ${source} hotspot feed: ${(error as Error).message}`,
          );
          return [];
        }
      }),
    );
    return perSource.flat();
  }

  normalize(hotspot: FirmsHotspot): NormalizedHazardEvent {
    const latitude = Number.parseFloat(hotspot.latitude);
    const longitude = Number.parseFloat(hotspot.longitude);
    const brightnessKelvin = Number.parseFloat(
      'bright_ti4' in hotspot ? hotspot.bright_ti4 : hotspot.brightness,
    );
    const eventTime = parseFirmsTimestamp(hotspot.acq_date, hotspot.acq_time);
    // `satellite` (Terra/Aqua/N/N20/N21) already distinguishes products, so
    // this keeps the pre-VIIRS format and existing MODIS rows still dedupe.
    const externalId = `${hotspot.latitude},${hotspot.longitude},${hotspot.acq_date},${hotspot.acq_time},${hotspot.satellite}`;

    return {
      hazardType: HazardType.WILDFIRE,
      externalId,
      latitude,
      longitude,
      locationLabel: null,
      region: null,
      eventTime,
      source: 'nasa_firms',
      rawPayload: hotspot as unknown as Record<string, unknown>,
      details: {
        frpConfidence: frpConfidenceOf(hotspot),
        hotspotCount: 1,
        brightnessKelvin: Number.isFinite(brightnessKelvin)
          ? brightnessKelvin
          : null,
      },
    };
  }

  async selectAnnouncements(
    ingested: IngestedHazardEvent[],
  ): Promise<HazardEventCreatedEvent[]> {
    const announcements: HazardEventCreatedEvent[] = [];
    for (const { cluster, members } of newFireClusters(ingested)) {
      if (await this.isKnownFire(cluster)) continue;
      announcements.push(announcementFor(cluster, members));
    }
    return announcements;
  }

  private configuredSources(): FirmsSource[] {
    const raw = this.config.get<string>('NASA_FIRMS_SOURCES');
    if (!raw?.trim()) return [...FIRMS_SOURCES];
    const requested = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const unknown = requested.filter(
      (s) => !(FIRMS_SOURCES as readonly string[]).includes(s),
    );
    if (unknown.length) {
      this.logger.warn(
        `Ignoring unknown NASA_FIRMS_SOURCES entr(ies): ${unknown.join(', ')}`,
      );
    }
    return FIRMS_SOURCES.filter((s) => requested.includes(s));
  }

  /** Whether a non-low-confidence FIRMS detection outside this cluster lies
   * within link distance of it, observed from 24 h before the cluster on. */
  private async isKnownFire(cluster: HotspotCluster): Promise<boolean> {
    const since = new Date(
      cluster.firstObservedAt.getTime() - KNOWN_FIRE_LOOKBACK_HOURS * 3_600_000,
    );
    const points = cluster.hotspots
      .map((h) => `${h.longitude} ${h.latitude}`)
      .join(',');
    const candidates = await this.hazardEventRepository
      .createQueryBuilder('e')
      .select([
        'e.id',
        'e.latitude',
        'e.longitude',
        'e.eventTime',
        'e.externalId',
        'e.rawPayload',
      ])
      .where('e.source = :source', { source: this.sourceId })
      .andWhere('e.hazardType = :hazardType', {
        hazardType: HazardType.WILDFIRE,
      })
      .andWhere('e.eventTime >= :since', { since })
      .andWhere('e.id NOT IN (:...memberIds)', {
        memberIds: cluster.hotspots.map((h) => h.eventId),
      })
      .andWhere(
        `e.geom && ST_Expand(ST_GeomFromText(:wkt, 4326), :marginDeg)` +
          ` AND ST_DWithin(e.geom::geography, ST_GeomFromText(:wkt, 4326)::geography, :radiusMeters)`,
        {
          wkt: `MULTIPOINT(${points})`,
          marginDeg: KNOWN_FIRE_BBOX_MARGIN_DEG,
          radiusMeters: CLUSTER_LINK_KM * 1000,
        },
      )
      .limit(KNOWN_FIRE_CANDIDATE_LIMIT)
      .getMany();
    return candidates.some(
      (row) => normalizeHotspot(row)?.confidenceClass !== 'low',
    );
  }
}

/** Clusters a poll's new, non-low-confidence detections (low-confidence
 * ones are still stored, just never announced — same rule the karhutla
 * pipeline applies before forecasting). */
export function newFireClusters(
  ingested: IngestedHazardEvent[],
): { cluster: HotspotCluster; members: Map<string, IngestedHazardEvent> }[] {
  const byId = new Map(ingested.map((i) => [i.hazardEvent.id, i]));
  const eligible = ingested
    .map((i) => normalizeHotspot(i.hazardEvent))
    .filter(
      (h): h is NormalizedHotspot => h !== null && h.confidenceClass !== 'low',
    );
  return clusterHotspots(eligible, CLUSTER_LINK_KM).map((cluster) => ({
    cluster,
    members: new Map(
      cluster.hotspots.map((h) => [h.eventId, byId.get(h.eventId)!]),
    ),
  }));
}

/** One announcement per cluster: its strongest detection (highest FRP,
 * then newest) stands for the fire, with every member's affected
 * districts. */
export function announcementFor(
  cluster: HotspotCluster,
  members: Map<string, IngestedHazardEvent>,
): HazardEventCreatedEvent {
  const representative = [...cluster.hotspots].sort(
    (a, b) =>
      (b.frpMw ?? -1) - (a.frpMw ?? -1) ||
      b.observedAt.getTime() - a.observedAt.getTime() ||
      a.eventId.localeCompare(b.eventId),
  )[0];
  const affectedDistrictIds = new Set<string>();
  for (const member of members.values()) {
    member.announcement.affectedDistrictIds.forEach((id) =>
      affectedDistrictIds.add(id),
    );
  }
  return {
    hazardEventId: representative.eventId,
    hazardType: HazardType.WILDFIRE,
    affectedDistrictIds: [...affectedDistrictIds].sort(),
  };
}

/** 0-1: MODIS' percentage scaled, VIIRS' l/n/h mapped; null if FIRMS sent
 * something unrecognized (rejected downstream by wildfire validation). */
function frpConfidenceOf(hotspot: FirmsHotspot): number | null {
  const raw = hotspot.confidence.trim().toLowerCase();
  if (hotspot.firmsSource !== 'MODIS_NRT') {
    return VIIRS_CONFIDENCE[raw] ?? null;
  }
  const pct = Number.parseFloat(raw);
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct / 100 : null;
}

/** FIRMS timestamps are UTC, `acq_time` a zero-padded 4-digit HHMM with no
 * separator (e.g. "0413" = 04:13). */
function parseFirmsTimestamp(acqDate: string, acqTime: string): Date {
  const paddedTime = acqTime.padStart(4, '0');
  const hours = paddedTime.slice(0, 2);
  const minutes = paddedTime.slice(2, 4);
  return new Date(`${acqDate}T${hours}:${minutes}:00Z`);
}

/** FIRMS' CSV has no quoted/escaped fields in practice (all columns are
 * numeric or simple tokens), so a plain split is sufficient — no need for a
 * full CSV-parsing dependency for this one adapter. */
export function parseFirmsCsv(
  csv: string,
  source: FirmsSource,
): FirmsHotspot[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) {
    return [];
  }
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: Record<string, string> = { firmsSource: source };
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? '';
    });
    return row as unknown as FirmsHotspot;
  });
}
