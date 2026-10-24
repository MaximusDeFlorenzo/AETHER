import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pointInGeometry } from '../karhutla-prediction/lib/geo';

/**
 * Which country a coordinate falls in, for the FIRMS bbox (94–142°E,
 * 12°S–7°N) only. Boundaries: Natural Earth 1:50m admin-0 (public domain),
 * clipped to that bbox — `data/region-countries.geojson`. AETHER's own
 * district rows are reference points, not polygons, so they can't answer
 * "is this fire in Indonesia?".
 *
 * 1:50m coastlines are ~1–2 km coarse and drop the smallest islands, so a
 * point just offshore of every polygon is given the nearest country within
 * `COAST_TOLERANCE_DEG` instead of none.
 */

export interface CountryRef {
  /** Natural Earth ADM0_A3, e.g. "IDN", "MYS". */
  iso: string;
  name: string;
}

type Ring = Array<[number, number]>;

interface CountryShape extends CountryRef {
  /** Each polygon: outer ring first, then holes. */
  polygons: Ring[][];
  bbox: [number, number, number, number];
}

// ~11 km at the equator.
const COAST_TOLERANCE_DEG = 0.1;

let shapes: CountryShape[] | null = null;

function loadShapes(): CountryShape[] {
  if (shapes) return shapes;
  const collection = JSON.parse(
    readFileSync(join(__dirname, 'data', 'region-countries.geojson'), 'utf8'),
  ) as {
    features: Array<{
      properties: CountryRef;
      geometry: { coordinates: Ring[][] };
    }>;
  };
  shapes = collection.features.map((feature) => {
    const polygons = feature.geometry.coordinates;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const polygon of polygons) {
      for (const [x, y] of polygon[0]) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return {
      iso: feature.properties.iso,
      name: feature.properties.name,
      polygons,
      bbox: [minX, minY, maxX, maxY],
    };
  });
  return shapes;
}

/** Planar point-to-segment distance in degrees — fine at this tolerance. */
function segmentDistance(
  x: number,
  y: number,
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSq));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function withinBbox(
  x: number,
  y: number,
  [minX, minY, maxX, maxY]: CountryShape['bbox'],
  margin: number,
): boolean {
  return (
    x >= minX - margin &&
    x <= maxX + margin &&
    y >= minY - margin &&
    y <= maxY + margin
  );
}

export function countryAt(
  latitude: number,
  longitude: number,
): CountryRef | null {
  const all = loadShapes();
  for (const shape of all) {
    if (!withinBbox(longitude, latitude, shape.bbox, 0)) continue;
    if (
      pointInGeometry(latitude, longitude, {
        type: 'MultiPolygon',
        coordinates: shape.polygons,
      })
    ) {
      return { iso: shape.iso, name: shape.name };
    }
  }

  let best: { shape: CountryShape; distance: number } | null = null;
  for (const shape of all) {
    if (!withinBbox(longitude, latitude, shape.bbox, COAST_TOLERANCE_DEG)) {
      continue;
    }
    for (const polygon of shape.polygons) {
      const ring = polygon[0];
      for (let i = 1; i < ring.length; i += 1) {
        const distance = segmentDistance(
          longitude,
          latitude,
          ring[i - 1],
          ring[i],
        );
        if (
          distance <= COAST_TOLERANCE_DEG &&
          distance < (best?.distance ?? Infinity)
        ) {
          best = { shape, distance };
        }
      }
    }
  }
  return best ? { iso: best.shape.iso, name: best.shape.name } : null;
}
