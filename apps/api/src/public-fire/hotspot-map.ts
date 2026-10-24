import { countryAt, type CountryRef } from '../geo/country-lookup';
import { CLUSTER_LINK_KM } from '../karhutla-prediction/karhutla.constants';
import { haversineKm } from '../karhutla-prediction/lib/geo';
import {
  clusterHotspots,
  dedupeHotspots,
  normalizeHotspot,
  type ConfidenceClass,
  type HotspotSourceRow,
  type NormalizedHotspot,
} from '../karhutla-prediction/lib/hotspots';

/**
 * The citizen fire map's view of FIRMS: every non-low-confidence detection
 * in the window, clustered exactly like the karhutla pipeline does (so a
 * map cluster and a forecast cluster agree), labelled by country and
 * nearest kabupaten/kota. "Detections" not "fires": one fire seen by MODIS
 * and VIIRS on several overpasses is several detections.
 */

export interface DistrictPoint {
  id: string;
  name: string;
  provinceName: string | null;
  latitude: number;
  longitude: number;
}

export interface MapCluster {
  id: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  detections: number;
  totalFrpMw: number | null;
  /** Summed FRP of the single strongest satellite overpass — the fire's
   * intensity at one moment, without double-counting the same flames seen
   * by several sensors/passes over the window. */
  peakOverpassFrpMw: number | null;
  /** CO2 emission rate at that overpass, see estimateCo2TonnesPerHour. */
  co2TonnesPerHour: number | null;
  confidenceClass: ConfidenceClass | null;
  sensors: string[];
  firstObservedAt: string;
  latestObservedAt: string;
  country: CountryRef | null;
  insideIndonesia: boolean;
  nearestDistrict: {
    id: string;
    name: string;
    provinceName: string | null;
    distanceKm: number;
  } | null;
  /** hazard_event ids, for matching karhutla forecasts to this cluster. */
  hotspotEventIds: string[];
}

export interface HotspotMap {
  generatedAt: string;
  window: { from: string; to: string; hours: number };
  attribution: string;
  sensors: Array<{
    label: string;
    detections: number;
    latestObservedAt: string;
  }>;
  totals: {
    detections: number;
    lowConfidenceExcluded: number;
    clusters: number;
    clustersInIndonesia: number;
  };
  /** Strongest first (total FRP, then detection count). */
  clusters: MapCluster[];
}

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  observedAt: string;
  sensor: string;
  confidenceClass: ConfidenceClass | null;
  frpMw: number | null;
}

// FRP → emission rate: biomass combustion rate 0.368 kg per MJ of fire
// radiative energy (Wooster et al. 2005) × 1,620 g CO2 per kg burned
// (tropical forest, Andreae 2019). An instantaneous rate at the overpass,
// not a daily total; smouldering peat radiates little and is undercounted.
const BIOMASS_KG_PER_MJ = 0.368;
const CO2_KG_PER_KG_BIOMASS = 1.62;
// Detections from one sensor closer in time than this are one overpass.
const OVERPASS_GAP_MS = 20 * 60 * 1000;

export function estimateCo2TonnesPerHour(frpMw: number): number {
  // MW = MJ/s → kg biomass/s → kg CO2/s → t/h
  return (frpMw * BIOMASS_KG_PER_MJ * CO2_KG_PER_KG_BIOMASS * 3600) / 1000;
}

/** Strongest single-overpass FRP sum among `hotspots`, or null when none
 * report FRP. */
export function peakOverpassFrp(hotspots: NormalizedHotspot[]): number | null {
  const bySensor = new Map<string, NormalizedHotspot[]>();
  for (const h of hotspots) {
    if (h.frpMw === null) continue;
    const label = sensorLabel(h);
    bySensor.set(label, [...(bySensor.get(label) ?? []), h]);
  }
  let peak: number | null = null;
  for (const detections of bySensor.values()) {
    detections.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    let sum = 0;
    let last = -Infinity;
    for (const h of detections) {
      if (h.observedAt.getTime() - last > OVERPASS_GAP_MS) sum = 0;
      sum += h.frpMw ?? 0;
      last = h.observedAt.getTime();
      peak = Math.max(peak ?? 0, sum);
    }
  }
  return peak;
}

export const FIRMS_ATTRIBUTION =
  'NASA FIRMS (LANCE/EOSDIS) — MODIS Terra/Aqua, VIIRS S-NPP/NOAA-20/NOAA-21';

const SATELLITE_LABEL: Record<string, string> = {
  Terra: 'MODIS Terra',
  Aqua: 'MODIS Aqua',
  T: 'MODIS Terra',
  A: 'MODIS Aqua',
  N: 'VIIRS S-NPP',
  N20: 'VIIRS NOAA-20',
  N21: 'VIIRS NOAA-21',
};

// A district reference point farther than this from a cluster is no
// meaningful "near …" label (a fire in Sarawak isn't "near Sambas").
const NEAREST_DISTRICT_MAX_KM = 150;

export function sensorLabel(h: NormalizedHotspot): string {
  if (h.satellite && SATELLITE_LABEL[h.satellite]) {
    return SATELLITE_LABEL[h.satellite];
  }
  return [h.instrument, h.satellite].filter(Boolean).join(' ') || 'FIRMS';
}

/** Usable (valid, de-duplicated, non-low-confidence) detections. */
export function eligibleHotspots(rows: HotspotSourceRow[]): {
  eligible: NormalizedHotspot[];
  lowConfidenceExcluded: number;
} {
  const normalized = rows
    .map(normalizeHotspot)
    .filter((h): h is NormalizedHotspot => h !== null);
  const { unique } = dedupeHotspots(normalized);
  const eligible = unique.filter((h) => h.confidenceClass !== 'low');
  return { eligible, lowConfidenceExcluded: unique.length - eligible.length };
}

function nearestDistrict(
  latitude: number,
  longitude: number,
  districts: DistrictPoint[],
): MapCluster['nearestDistrict'] {
  let best: { district: DistrictPoint; km: number } | null = null;
  for (const district of districts) {
    const km = haversineKm(
      latitude,
      longitude,
      district.latitude,
      district.longitude,
    );
    if (km < (best?.km ?? Infinity)) best = { district, km };
  }
  if (!best || best.km > NEAREST_DISTRICT_MAX_KM) return null;
  return {
    id: best.district.id,
    name: best.district.name,
    provinceName: best.district.provinceName,
    distanceKm: Math.round(best.km),
  };
}

const CONFIDENCE_RANK: Record<ConfidenceClass, number> = {
  low: 0,
  nominal: 1,
  high: 2,
};

export function buildHotspotMap(
  rows: HotspotSourceRow[],
  districts: DistrictPoint[],
  window: { from: Date; to: Date; hours: number },
): HotspotMap {
  const { eligible, lowConfidenceExcluded } = eligibleHotspots(rows);

  const sensors = new Map<string, { detections: number; latest: number }>();
  for (const h of eligible) {
    const label = sensorLabel(h);
    const entry = sensors.get(label) ?? { detections: 0, latest: 0 };
    entry.detections += 1;
    entry.latest = Math.max(entry.latest, h.observedAt.getTime());
    sensors.set(label, entry);
  }

  const clusters = clusterHotspots(eligible, CLUSTER_LINK_KM).map(
    (cluster): MapCluster => {
      const country = countryAt(cluster.latitude, cluster.longitude);
      const insideIndonesia = country?.iso === 'IDN';
      const confidenceClass = cluster.hotspots.reduce<ConfidenceClass | null>(
        (best, h) =>
          h.confidenceClass &&
          (!best || CONFIDENCE_RANK[h.confidenceClass] > CONFIDENCE_RANK[best])
            ? h.confidenceClass
            : best,
        null,
      );
      const peakFrp = peakOverpassFrp(cluster.hotspots);
      return {
        id: cluster.key,
        latitude: Number(cluster.latitude.toFixed(5)),
        longitude: Number(cluster.longitude.toFixed(5)),
        radiusKm: Number(cluster.radiusKm.toFixed(2)),
        detections: cluster.hotspots.length,
        totalFrpMw: cluster.totalFrpMw,
        peakOverpassFrpMw: peakFrp === null ? null : Number(peakFrp.toFixed(1)),
        co2TonnesPerHour:
          peakFrp === null
            ? null
            : Math.round(estimateCo2TonnesPerHour(peakFrp)),
        confidenceClass,
        sensors: Array.from(new Set(cluster.hotspots.map(sensorLabel))).sort(),
        firstObservedAt: cluster.firstObservedAt.toISOString(),
        latestObservedAt: cluster.latestObservedAt.toISOString(),
        country,
        insideIndonesia,
        // Offshore (no country) detections may still be Indonesian waters.
        nearestDistrict:
          insideIndonesia || !country
            ? nearestDistrict(cluster.latitude, cluster.longitude, districts)
            : null,
        hotspotEventIds: cluster.hotspots.map((h) => h.eventId),
      };
    },
  );

  return {
    generatedAt: window.to.toISOString(),
    window: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      hours: window.hours,
    },
    attribution: FIRMS_ATTRIBUTION,
    sensors: [...sensors.entries()]
      .map(([label, s]) => ({
        label,
        detections: s.detections,
        latestObservedAt: new Date(s.latest).toISOString(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    totals: {
      detections: eligible.length,
      lowConfidenceExcluded,
      clusters: clusters.length,
      clustersInIndonesia: clusters.filter((c) => c.insideIndonesia).length,
    },
    clusters,
  };
}

export function toMapPoint(h: NormalizedHotspot): MapPoint {
  return {
    id: h.eventId,
    latitude: h.latitude,
    longitude: h.longitude,
    observedAt: h.observedAt.toISOString(),
    sensor: sensorLabel(h),
    confidenceClass: h.confidenceClass,
    frpMw: h.frpMw,
  };
}
