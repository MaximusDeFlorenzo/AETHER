import { haversineKm, isValidCoordinate } from './geo';

/**
 * FIRMS hotspot normalization, de-duplication and clustering for the
 * karhutla pipeline. Hotspots are thermal-anomaly detections, not confirmed
 * fires: low-confidence detections are excluded from forecasting and every
 * exclusion is counted so the run can report it.
 */

export type ConfidenceClass = 'low' | 'nominal' | 'high';

export interface HotspotSourceRow {
  id: string;
  latitude: number;
  longitude: number;
  eventTime: Date;
  externalId: string | null;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedHotspot {
  eventId: string;
  latitude: number;
  longitude: number;
  observedAt: Date;
  scanKm: number | null;
  trackKm: number | null;
  frpMw: number | null;
  /** 0-1, MODIS numeric confidence only; VIIRS reports classes, not numbers. */
  confidence: number | null;
  confidenceClass: ConfidenceClass | null;
  satellite: string | null;
  instrument: string | null;
  productVersion: string | null;
  dayNight: 'D' | 'N' | null;
}

export interface HotspotCluster {
  key: string;
  hotspots: NormalizedHotspot[];
  latitude: number;
  longitude: number;
  totalFrpMw: number | null;
  maxConfidence: number | null;
  firstObservedAt: Date;
  latestObservedAt: Date;
  sensors: string[];
  /** Max distance (km) from the centroid to a hotspot, for smoke release. */
  radiusKm: number;
}

function parseNumber(value: unknown, min: number, max: number): number | null {
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** FIRMS MODIS guidance: confidence < 30 low, 30-79 nominal, >= 80 high.
 * VIIRS uses the letters l/n/h directly. */
export function confidenceClassOf(raw: unknown): {
  confidence: number | null;
  confidenceClass: ConfidenceClass | null;
} {
  const letter = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (letter === 'l' || letter === 'low')
    return { confidence: null, confidenceClass: 'low' };
  if (letter === 'n' || letter === 'nominal')
    return { confidence: null, confidenceClass: 'nominal' };
  if (letter === 'h' || letter === 'high')
    return { confidence: null, confidenceClass: 'high' };
  const pct = parseNumber(raw, 0, 100);
  if (pct === null) return { confidence: null, confidenceClass: null };
  return {
    confidence: pct / 100,
    confidenceClass: pct < 30 ? 'low' : pct < 80 ? 'nominal' : 'high',
  };
}

export function normalizeHotspot(
  row: HotspotSourceRow,
): NormalizedHotspot | null {
  if (!isValidCoordinate(row.latitude, row.longitude)) return null;
  const observedAt = new Date(row.eventTime);
  if (Number.isNaN(observedAt.getTime())) return null;
  const raw = row.rawPayload ?? {};
  const dayNight = text(raw.daynight)?.toUpperCase();
  return {
    eventId: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    observedAt,
    scanKm: parseNumber(raw.scan, 0.01, 10),
    trackKm: parseNumber(raw.track, 0.01, 10),
    frpMw: parseNumber(raw.frp, 0, 100_000),
    ...confidenceClassOf(raw.confidence),
    satellite: text(raw.satellite),
    instrument: text(raw.instrument),
    productVersion: text(raw.version),
    dayNight: dayNight === 'D' || dayNight === 'N' ? dayNight : null,
  };
}

/** Same pixel centre, same overpass second, same satellite = the same
 * detection, however its externalId happened to be formatted. Keeps the
 * first occurrence. */
export function dedupeHotspots(hotspots: NormalizedHotspot[]): {
  unique: NormalizedHotspot[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const unique: NormalizedHotspot[] = [];
  for (const h of hotspots) {
    const key = `${h.latitude.toFixed(4)},${h.longitude.toFixed(4)},${h.observedAt.toISOString()},${h.satellite ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(h);
  }
  return { unique, duplicates: hotspots.length - unique.length };
}

/**
 * Single-linkage clustering: hotspots within `linkKm` of any member join
 * the cluster. Grid-bucketed so it stays ~O(n) for thousands of hotspots.
 * Output is deterministic: ordered by total FRP, then count, then position.
 */
export function clusterHotspots(
  hotspots: NormalizedHotspot[],
  linkKm: number,
): HotspotCluster[] {
  const parent = hotspots.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // ~111 km per degree latitude; longitude cells shrink with cos(lat) but
  // near the equator a square-degree bucket is conservative enough.
  const cellDeg = linkKm / 111;
  const buckets = new Map<string, number[]>();
  const cellOf = (h: NormalizedHotspot) =>
    [
      Math.floor(h.latitude / cellDeg),
      Math.floor(h.longitude / cellDeg),
    ] as const;
  hotspots.forEach((h, i) => {
    const [r, c] = cellOf(h);
    const key = `${r}:${c}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  });
  hotspots.forEach((h, i) => {
    const [r, c] = cellOf(h);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        for (const j of buckets.get(`${r + dr}:${c + dc}`) ?? []) {
          if (
            j > i &&
            haversineKm(
              h.latitude,
              h.longitude,
              hotspots[j].latitude,
              hotspots[j].longitude,
            ) <= linkKm
          ) {
            union(i, j);
          }
        }
      }
    }
  });

  const groups = new Map<number, NormalizedHotspot[]>();
  hotspots.forEach((h, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(h);
    else groups.set(root, [h]);
  });

  const clusters = Array.from(groups.values()).map(
    (members): HotspotCluster => {
      const latitude =
        members.reduce((s, h) => s + h.latitude, 0) / members.length;
      const longitude =
        members.reduce((s, h) => s + h.longitude, 0) / members.length;
      const frps = members
        .map((h) => h.frpMw)
        .filter((v): v is number => v !== null);
      const confidences = members
        .map((h) => h.confidence)
        .filter((v): v is number => v !== null);
      const times = members.map((h) => h.observedAt.getTime());
      const sensors = Array.from(
        new Set(
          members
            .map((h) => [h.instrument, h.satellite].filter(Boolean).join(' '))
            .filter(Boolean),
        ),
      ).sort();
      const ids = members.map((h) => h.eventId).sort();
      return {
        key: ids[0],
        hotspots: members,
        latitude,
        longitude,
        totalFrpMw: frps.length
          ? Number(frps.reduce((s, v) => s + v, 0).toFixed(2))
          : null,
        maxConfidence: confidences.length ? Math.max(...confidences) : null,
        firstObservedAt: new Date(Math.min(...times)),
        latestObservedAt: new Date(Math.max(...times)),
        sensors,
        radiusKm: Math.max(
          ...members.map((h) =>
            haversineKm(latitude, longitude, h.latitude, h.longitude),
          ),
        ),
      };
    },
  );

  return clusters.sort(
    (a, b) =>
      (b.totalFrpMw ?? 0) - (a.totalFrpMw ?? 0) ||
      b.hotspots.length - a.hotspots.length ||
      a.latitude - b.latitude ||
      a.longitude - b.longitude,
  );
}

/** Stable 31-bit seed from a cluster's member ids, so a re-run over the
 * same hotspots reproduces the same smoke particle ensemble. */
export function clusterSeed(cluster: HotspotCluster): number {
  let hash = 2166136261;
  for (const id of cluster.hotspots
    .map((h) => h.eventId)
    .sort()
    .join('|')) {
    hash ^= id.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash & 0x7fffffff;
}
