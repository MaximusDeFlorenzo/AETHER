import { haversineKm, pointInGeometry, type PolygonalGeometry } from './geo';

/**
 * Intersects forecast areas with known places. Exposure, not risk: a place
 * inside a footprint is *potentially* exposed under the model's assumptions.
 * Vulnerability (who lives there, how prepared they are) is a separate
 * question this module does not answer.
 */

export type PlaceKind = 'district_reference_point' | 'settlement';

export interface CandidatePlace {
  id: string;
  name: string;
  kind: PlaceKind;
  /** OSM `place` value (city/town/village/hamlet) for settlements. */
  placeType: string | null;
  provinceName: string | null;
  latitude: number;
  longitude: number;
  source: 'aether_districts' | 'openstreetmap';
}

export interface ExposedPlace extends CandidatePlace {
  distanceFromFireKm: number;
}

export type SmokeLevel = 'core' | 'likely' | 'possible';

export interface HorizonExposure {
  horizonHours: number;
  spread: ExposedPlace[];
  /** Each place appears once, under the densest class containing it. */
  smoke: Record<SmokeLevel, ExposedPlace[]>;
}

export interface SpreadHorizonLike {
  horizonHours: number;
  status: string;
  envelope?: PolygonalGeometry | null;
}

export interface SmokeHorizonLike {
  horizonHours: number;
  status: string;
  footprint?: Array<{ level: SmokeLevel; geometry: PolygonalGeometry | null }>;
}

const SMOKE_ORDER: SmokeLevel[] = ['core', 'likely', 'possible'];

function withDistance(
  place: CandidatePlace,
  fire: { latitude: number; longitude: number },
): ExposedPlace {
  return {
    ...place,
    distanceFromFireKm: Number(
      haversineKm(
        fire.latitude,
        fire.longitude,
        place.latitude,
        place.longitude,
      ).toFixed(2),
    ),
  };
}

const byDistance = (a: ExposedPlace, b: ExposedPlace) =>
  a.distanceFromFireKm - b.distanceFromFireKm || a.name.localeCompare(b.name);

export function computeExposure(
  fire: { latitude: number; longitude: number },
  places: CandidatePlace[],
  spread: SpreadHorizonLike[],
  smoke: SmokeHorizonLike[],
  horizons: number[],
): HorizonExposure[] {
  return horizons.map((horizonHours) => {
    const s = spread.find(
      (h) => h.horizonHours === horizonHours && h.status === 'ok',
    );
    const k = smoke.find(
      (h) => h.horizonHours === horizonHours && h.status === 'ok',
    );
    const spreadPlaces = s?.envelope
      ? places
          .filter((p) => pointInGeometry(p.latitude, p.longitude, s.envelope))
          .map((p) => withDistance(p, fire))
          .sort(byDistance)
      : [];
    const smokePlaces: Record<SmokeLevel, ExposedPlace[]> = {
      core: [],
      likely: [],
      possible: [],
    };
    if (k?.footprint) {
      const assigned = new Set<string>();
      for (const level of SMOKE_ORDER) {
        const geometry = k.footprint.find((f) => f.level === level)?.geometry;
        for (const place of places) {
          const key = `${place.source}:${place.id}`;
          if (
            assigned.has(key) ||
            !pointInGeometry(place.latitude, place.longitude, geometry)
          )
            continue;
          assigned.add(key);
          smokePlaces[level].push(withDistance(place, fire));
        }
        smokePlaces[level].sort(byDistance);
      }
    }
    return { horizonHours, spread: spreadPlaces, smoke: smokePlaces };
  });
}
