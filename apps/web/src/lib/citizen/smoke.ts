import type { District, HazardEvent, WildfireDetails } from '@/types/domain';
import type { HotspotCluster, ModelSmokeForecast, PolygonalGeometry, SmokeLevel } from '@/types/fire';
import { distanceKm } from './geo';
import type { PublicWeather } from './types';

export type PointWind = Omit<PublicWeather, 'districtId'> & { latitude: number; longitude: number };

/** A wildfire "event" on the citizen portal: one FIRMS hotspot cluster
 * from GET /public/hotspots, shaped like a hazard event so cards, map
 * markers and smoke clustering treat it like any other event. */
export interface WildfireClusterEvent extends HazardEvent {
  cluster: HotspotCluster;
}

export function isClusterEvent(event: HazardEvent): event is WildfireClusterEvent {
  return 'cluster' in event;
}

export interface FireCluster {
  id: string;
  lat: number;
  lng: number;
  hotspotCount: number;
  label: string;
  events: HazardEvent[];
  /** Satellites that saw it, e.g. "VIIRS NOAA-20". */
  sensors: string[];
  /** Summed peak-overpass CO2 rate of its hotspot clusters, null when no
   * detection reported FRP. */
  co2TonnesPerHour: number | null;
}

/** Leaflet multi-polygon: polygons → rings (first outer) → [lat, lng]. */
export type MapPolygons = Array<Array<Array<[number, number]>>>;

export interface SmokePlume {
  /** 'model': karhutla particle model footprint; 'simple': wind drift. */
  kind: 'simple' | 'model';
  fire: FireCluster;
  /** Wind at the fire (simple plumes only). */
  wind: PointWind | null;
  hours: number;
  /** Where the smoke's leading edge is after each hour, starting at the fire
   * (model: straight along the transport bearing to the p90 distance). */
  centerline: Array<{ lat: number; lng: number; km: number }>;
  /** Whole plume, then its denser inner part and densest core (model:
   * possible / likely / core footprints). */
  outline: MapPolygons;
  denser: MapPolygons;
  densest: MapPolygons;
  model: {
    forecasts: ModelSmokeForecast[];
    issuedAt: string;
    validAt: string;
    transportBearingDeg: number | null;
    p90DistanceKm: number | null;
  } | null;
}

export interface SmokeReach {
  /** Hours after now until the smoke is expected to reach this point. */
  hours: number;
  thick: boolean;
}

// Fires closer than this are drawn as one plume — FIRMS reports many
// adjacent hotspots for a single burning area.
const CLUSTER_RADIUS_KM = 30;
export const MAX_CLUSTERS = 30;
/** Longest horizon the karhutla particle model forecasts; beyond it every
 * fire drifts with the hourly forecast wind only. */
export const MODEL_SMOKE_MAX_HOURS = 12;
// Below this the wind is too weak to carry smoke far; it pools around the
// fire instead, so the plume still gets a visible minimum footprint.
const MIN_DRIFT_KMH = 3;
const BASE_HALF_WIDTH_KM = 4;
// Smoke widens as it travels (~14° total spread) — a readable
// approximation, not a dispersion model.
const SPREAD_PER_KM = 0.12;

const KM_PER_DEG_LAT = 110.57;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function kmPerDegLng(lat: number) {
  return 111.32 * Math.cos(toRad(lat));
}

export function destinationPoint(lat: number, lng: number, bearing: number, km: number) {
  const b = toRad(bearing);
  return {
    lat: lat + (km * Math.cos(b)) / KM_PER_DEG_LAT,
    lng: lng + (km * Math.sin(b)) / kmPerDegLng(lat),
  };
}

function hotspots(event: HazardEvent) {
  return Math.max(1, (event.details as WildfireDetails | null)?.hotspotCount ?? 1);
}

/** Greedy clustering, largest fires first, so each burning area gets one plume. */
export function clusterFires(events: HazardEvent[]): FireCluster[] {
  const sorted = events.filter((e) => e.hazardType === 'wildfire').sort((a, b) => hotspots(b) - hotspots(a));
  const clusters: FireCluster[] = [];
  for (const event of sorted) {
    const home = clusters.find((c) => distanceKm(c.lat, c.lng, event.latitude, event.longitude) <= CLUSTER_RADIUS_KM);
    if (home) {
      const total = home.hotspotCount + hotspots(event);
      home.lat = (home.lat * home.hotspotCount + event.latitude * hotspots(event)) / total;
      home.lng = (home.lng * home.hotspotCount + event.longitude * hotspots(event)) / total;
      home.hotspotCount = total;
      home.events.push(event);
    } else {
      clusters.push({
        id: event.id,
        lat: event.latitude,
        lng: event.longitude,
        hotspotCount: hotspots(event),
        label: event.locationLabel ?? event.region ?? 'Lokasi titik api',
        events: [event],
        sensors: [],
        co2TonnesPerHour: null,
      });
    }
  }
  return clusters.slice(0, MAX_CLUSTERS).map((cluster) => ({
    ...cluster,
    co2TonnesPerHour: cluster.events.reduce<number | null>(
      (sum, event) =>
        isClusterEvent(event) && event.cluster.co2TonnesPerHour !== null
          ? (sum ?? 0) + event.cluster.co2TonnesPerHour
          : sum,
      null,
    ),
    sensors: Array.from(
      new Set(cluster.events.flatMap((event) => (isClusterEvent(event) ? event.cluster.sensors : []))),
    ).sort(),
  }));
}

/** Wind for hour `h` from now: the hourly forecast when present, else the current reading. */
function windForHour(wind: PointWind, h: number) {
  const entry = wind.hourly[h];
  return entry ? { from: entry.windFromDeg, speed: entry.windSpeedKmh } : { from: wind.windFromDeg, speed: wind.windSpeedKmh };
}

function halfWidthAt(km: number) {
  return BASE_HALF_WIDTH_KM + km * SPREAD_PER_KM;
}

/**
 * Walks the smoke forward hour by hour using that hour's forecast wind, so
 * the plume bends when the wind turns — which is exactly what makes smoke
 * reach cities that aren't straight downwind right now.
 */
export function buildPlume(fire: FireCluster, wind: PointWind, hours: number): SmokePlume {
  const centerline = [{ lat: fire.lat, lng: fire.lng, km: 0 }];
  for (let h = 0; h < hours; h += 1) {
    const { from, speed } = windForHour(wind, h);
    const last = centerline[centerline.length - 1];
    const step = Math.max(MIN_DRIFT_KMH, speed);
    const next = destinationPoint(last.lat, last.lng, (from + 180) % 360, step);
    centerline.push({ ...next, km: last.km + step });
  }

  const outlineFor = (upTo: number): Array<[number, number]> => {
    const line = centerline.slice(0, Math.max(2, upTo + 1));
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    line.forEach((point, index) => {
      const a = line[Math.max(0, index - 1)];
      const b = line[Math.min(line.length - 1, index + 1)];
      const heading =
        (Math.atan2((b.lng - a.lng) * kmPerDegLng(point.lat), (b.lat - a.lat) * KM_PER_DEG_LAT) * 180) / Math.PI;
      const w = halfWidthAt(point.km);
      const l = destinationPoint(point.lat, point.lng, heading - 90, w);
      const r = destinationPoint(point.lat, point.lng, heading + 90, w);
      left.push([l.lat, l.lng]);
      right.push([r.lat, r.lng]);
    });
    // Rounded tail behind the fire and rounded head at the leading edge.
    const tail = line[0];
    const head = line[line.length - 1];
    const headHeading =
      (Math.atan2(
        (head.lng - line[line.length - 2].lng) * kmPerDegLng(head.lat),
        (head.lat - line[line.length - 2].lat) * KM_PER_DEG_LAT,
      ) *
        180) /
      Math.PI;
    const cap = (center: typeof head, from: number, width: number) =>
      [-60, -30, 0, 30, 60].map((offset) => {
        const p = destinationPoint(center.lat, center.lng, from + offset, width);
        return [p.lat, p.lng] as [number, number];
      });
    return [
      ...left,
      ...cap(head, headHeading, halfWidthAt(head.km)),
      ...right.reverse(),
      ...cap(tail, headHeading + 180, BASE_HALF_WIDTH_KM),
    ];
  };

  const n = centerline.length - 1;
  return {
    kind: 'simple',
    fire,
    wind,
    hours,
    centerline,
    outline: [[outlineFor(n)]],
    denser: [[outlineFor(Math.ceil((n * 2) / 3))]],
    densest: [[outlineFor(Math.ceil(n / 3))]],
    model: null,
  };
}

function toMapPolygons(geometry: PolygonalGeometry): MapPolygons {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])));
}

/**
 * The karhutla particle model's footprint for one fire: every matched
 * forecast's core/likely/possible areas at the displayed horizon (several
 * modelled clusters can fall inside one 30 km fire area). Forecasts must
 * have a horizon; the first (best ranked) sets the transport direction.
 */
export function buildModelPlume(
  fire: FireCluster,
  forecasts: ModelSmokeForecast[],
  issuedAt: string,
  now: Date,
): SmokePlume {
  const ranked = [...forecasts].sort((a, b) => a.rank - b.rank);
  const lead = ranked[0].horizon!;
  const level = (name: SmokeLevel) =>
    ranked.flatMap((f) => (f.horizon?.footprint ?? []).filter((p) => p.level === name).flatMap((p) => toMapPolygons(p.geometry)));

  const centerline = [{ lat: fire.lat, lng: fire.lng, km: 0 }];
  if (lead.transportBearingDeg !== null && lead.p90DistanceKm) {
    for (let i = 1; i <= 4; i += 1) {
      const km = (lead.p90DistanceKm * i) / 4;
      centerline.push({ ...destinationPoint(fire.lat, fire.lng, lead.transportBearingDeg, km), km });
    }
  } else {
    centerline.push({ lat: fire.lat, lng: fire.lng, km: 0 });
  }

  return {
    kind: 'model',
    fire,
    wind: null,
    hours: Math.max(0, Math.round((new Date(lead.validAt).getTime() - now.getTime()) / 3_600_000)),
    centerline,
    outline: level('possible'),
    denser: level('likely'),
    densest: level('core'),
    model: {
      forecasts: ranked,
      issuedAt,
      validAt: lead.validAt,
      transportBearingDeg: lead.transportBearingDeg,
      p90DistanceKm: lead.p90DistanceKm,
    },
  };
}

function inRing(lat: number, lng: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygons(lat: number, lng: number, polygons: MapPolygons): boolean {
  return polygons.some(
    ([outer, ...holes]) => !!outer && inRing(lat, lng, outer) && !holes.some((hole) => inRing(lat, lng, hole)),
  );
}

/**
 * Whether (and after how many hours) the plume covers a point: nearest
 * approach to the centerline, compared with the plume's width there.
 */
export function plumeReach(plume: SmokePlume, lat: number, lng: number): SmokeReach | null {
  if (plume.kind === 'model') {
    // One displayed horizon: inside it means "by then", thick in core/likely.
    if (inPolygons(lat, lng, plume.densest) || inPolygons(lat, lng, plume.denser)) {
      return { hours: plume.hours, thick: true };
    }
    return inPolygons(lat, lng, plume.outline) ? { hours: plume.hours, thick: false } : null;
  }
  let best: SmokeReach | null = null;
  const line = plume.centerline;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const k = kmPerDegLng(a.lat);
    const ax = 0;
    const ay = 0;
    const bx = (b.lng - a.lng) * k;
    const by = (b.lat - a.lat) * KM_PER_DEG_LAT;
    const px = (lng - a.lng) * k;
    const py = (lat - a.lat) * KM_PER_DEG_LAT;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2));
    const dx = px - t * bx;
    const dy = py - t * by;
    const offset = Math.sqrt(dx * dx + dy * dy);
    const along = a.km + t * (b.km - a.km);
    if (offset <= halfWidthAt(along)) {
      const reach = { hours: i + t, thick: along <= line[line.length - 1].km / 3 };
      if (!best || reach.hours < best.hours) best = reach;
    }
  }
  return best;
}

/**
 * Whether the smoke reaches the citizen within `withinHours`. Model plumes
 * use the server's check of the citizen's own location across every run
 * horizon (the page only holds one horizon's geometry).
 */
export function reachForUser(plume: SmokePlume, lat: number, lng: number, withinHours: number): SmokeReach | null {
  if (plume.kind === 'simple') return plumeReach(plume, lat, lng);
  let best: SmokeReach | null = null;
  for (const forecast of plume.model?.forecasts ?? []) {
    const reach = forecast.reach;
    if (!reach || reach.hoursFromNow > withinHours) continue;
    if (!best || reach.hoursFromNow < best.hours) {
      best = { hours: reach.hoursFromNow, thick: reach.level !== 'possible' };
    }
  }
  return best;
}

export interface AffectedArea {
  district: District;
  hours: number;
  thick: boolean;
}

/** Districts (by reference point) the plume passes over, soonest first. */
export function affectedDistricts(plume: SmokePlume, districts: District[]): AffectedArea[] {
  const result: AffectedArea[] = [];
  for (const district of districts) {
    const point = district.geom?.coordinates;
    if (!point) continue;
    const reach = plumeReach(plume, point[1], point[0]);
    if (reach) result.push({ district, ...reach });
  }
  return result.sort((a, b) => a.hours - b.hours);
}

export function formatHours(hours: number): string {
  if (hours < 1) return 'kurang dari 1 jam';
  return `± ${Math.round(hours)} jam`;
}
