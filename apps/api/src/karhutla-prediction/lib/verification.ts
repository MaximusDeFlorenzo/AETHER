import { haversineKm, pointInGeometry, type PolygonalGeometry } from './geo';

/**
 * Hotspot-based spot check of a past forecast: of the NEW hotspots detected
 * near the cluster after the forecast was issued and before a horizon's
 * valid time, how many fell inside the spread envelope — compared with a
 * persistence baseline (the observed pixel footprint, i.e. "the fire stays
 * where it was").
 *
 * This is not perimeter validation: hotspots are sparse point samples
 * (cloud and overpass gaps), so a low count proves little. It exists to
 * show observed-vs-predicted honestly, never to advertise accuracy.
 */

export const VERIFICATION_RADIUS_KM = 30;

export interface LaterHotspot {
  id: string;
  latitude: number;
  longitude: number;
  observedAt: Date;
}

export interface HorizonVerification {
  horizonHours: number;
  validAt: string;
  evaluable: boolean;
  reason: string | null;
  newHotspots: number;
  insideEnvelope: number;
  insidePersistenceBaseline: number;
  envelopeAreaKm2: number | null;
  baselineAreaKm2: number | null;
}

export function verifyForecast(input: {
  issuedAt: Date;
  now: Date;
  centroid: { latitude: number; longitude: number };
  clusterHotspotIds: string[];
  baseline: PolygonalGeometry | null;
  baselineAreaKm2: number | null;
  horizons: Array<{
    horizonHours: number;
    validAt: string;
    status: string;
    envelope: PolygonalGeometry | null;
    areaKm2: number | null;
  }>;
  laterHotspots: LaterHotspot[];
}): HorizonVerification[] {
  const own = new Set(input.clusterHotspotIds);
  const nearby = input.laterHotspots.filter(
    (h) =>
      !own.has(h.id) &&
      h.observedAt > input.issuedAt &&
      haversineKm(
        input.centroid.latitude,
        input.centroid.longitude,
        h.latitude,
        h.longitude,
      ) <= VERIFICATION_RADIUS_KM,
  );

  return input.horizons.map((horizon) => {
    const validAt = new Date(horizon.validAt);
    const base = {
      horizonHours: horizon.horizonHours,
      validAt: horizon.validAt,
      envelopeAreaKm2: horizon.areaKm2,
      baselineAreaKm2: input.baselineAreaKm2,
    };
    if (validAt > input.now) {
      return {
        ...base,
        evaluable: false,
        reason: 'Valid time not reached yet.',
        newHotspots: 0,
        insideEnvelope: 0,
        insidePersistenceBaseline: 0,
      };
    }
    if (horizon.status !== 'ok' || !horizon.envelope) {
      return {
        ...base,
        evaluable: false,
        reason: 'No envelope was produced for this horizon.',
        newHotspots: 0,
        insideEnvelope: 0,
        insidePersistenceBaseline: 0,
      };
    }
    const inWindow = nearby.filter((h) => h.observedAt <= validAt);
    return {
      ...base,
      evaluable: inWindow.length > 0,
      reason: inWindow.length
        ? null
        : 'No new hotspots observed nearby in the window (cloud, overpass gap, or fire inactive).',
      newHotspots: inWindow.length,
      insideEnvelope: inWindow.filter((h) =>
        pointInGeometry(h.latitude, h.longitude, horizon.envelope),
      ).length,
      insidePersistenceBaseline: inWindow.filter((h) =>
        pointInGeometry(h.latitude, h.longitude, input.baseline),
      ).length,
    };
  });
}
