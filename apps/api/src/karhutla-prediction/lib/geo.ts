/** Small spherical/planar helpers for the karhutla pipeline. Coordinates
 * are WGS84 degrees; GeoJSON positions are [lon, lat]. */

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number,
): { latitude: number; longitude: number } {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
      Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );
  return {
    latitude: toDeg(phi2),
    longitude: ((toDeg(lambda2) + 540) % 360) - 180,
  };
}

/** Regular lattice points (snapped to multiples of `spacingDeg`) covering
 * `center ± halfWidthDeg`. Snapping lets nearby clusters share grid points
 * (and cache entries) instead of each requesting its own offset grid. */
export function snappedGrid(
  lat: number,
  lon: number,
  halfWidthDeg: number,
  spacingDeg: number,
): Array<{ latitude: number; longitude: number }> {
  const snap = (v: number) => Math.round(v / spacingDeg) * spacingDeg;
  const points: Array<{ latitude: number; longitude: number }> = [];
  const steps = Math.round(halfWidthDeg / spacingDeg);
  const lat0 = snap(lat);
  const lon0 = snap(lon);
  for (let i = -steps; i <= steps; i += 1) {
    for (let j = -steps; j <= steps; j += 1) {
      const latitude = Number((lat0 + i * spacingDeg).toFixed(4));
      const longitude = Number((lon0 + j * spacingDeg).toFixed(4));
      if (isValidCoordinate(latitude, longitude))
        points.push({ latitude, longitude });
    }
  }
  return points;
}

type Ring = number[][];
export type PolygonalGeometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] };

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => pointInRing(lon, lat, hole));
}

export function pointInGeometry(
  lat: number,
  lon: number,
  geometry: PolygonalGeometry | null | undefined,
): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon')
    return pointInPolygon(lon, lat, geometry.coordinates);
  return geometry.coordinates.some((polygon) =>
    pointInPolygon(lon, lat, polygon),
  );
}

export function geometryBounds(
  geometries: Array<PolygonalGeometry | null | undefined>,
): { south: number; west: number; north: number; east: number } | null {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const geometry of geometries) {
    if (!geometry) continue;
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.coordinates;
    for (const polygon of polygons) {
      for (const [lon, lat] of polygon[0] ?? []) {
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        west = Math.min(west, lon);
        east = Math.max(east, lon);
      }
    }
  }
  return Number.isFinite(south) ? { south, west, north, east } : null;
}
