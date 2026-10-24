/**
 * DEM slope sampling around a district point (docs/RAINFALL_INTELLIGENCE.md,
 * Milestone 4). Each sample site gets a 4-point stencil one DEM pixel to the
 * N, S, E and W; slope comes from central differences across the stencil.
 * Pure functions — the HTTP side is DistrictTerrainService.
 */

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface TerrainSite extends LatLon {
  /** N, S, E, W — in that order. */
  stencil: [LatLon, LatLon, LatLon, LatLon];
}

export interface TerrainSummary {
  /** One per land site; sea/coast sites are dropped. */
  slopeSamplesDeg: number[];
  slopeMedianDeg: number | null;
  slopeMaxDeg: number | null;
  elevationMeanM: number | null;
  elevationMinM: number | null;
  elevationMaxM: number | null;
  samplesPlanned: number;
  samplesValid: number;
}

/**
 * `gridSize × gridSize` sites spread evenly over ±`halfWidthDeg` around the
 * point, each with a stencil `stencilOffsetDeg` away.
 */
export function terrainSites(
  latitude: number,
  longitude: number,
  gridSize: number,
  halfWidthDeg: number,
  stencilOffsetDeg: number,
): TerrainSite[] {
  const steps = Array.from({ length: gridSize }, (_, i) =>
    gridSize === 1
      ? 0
      : -halfWidthDeg + (2 * halfWidthDeg * i) / (gridSize - 1),
  );
  const sites: TerrainSite[] = [];
  for (const dLat of steps) {
    for (const dLon of steps) {
      const lat = latitude + dLat;
      const lon = longitude + dLon;
      sites.push({
        latitude: lat,
        longitude: lon,
        stencil: [
          { latitude: lat + stencilOffsetDeg, longitude: lon },
          { latitude: lat - stencilOffsetDeg, longitude: lon },
          { latitude: lat, longitude: lon + stencilOffsetDeg },
          { latitude: lat, longitude: lon - stencilOffsetDeg },
        ],
      });
    }
  }
  return sites;
}

/** Metres per degree on the WGS84 ellipsoid (standard series expansion). */
export function metresPerDegree(latitude: number): {
  lat: number;
  lon: number;
} {
  const phi = (latitude * Math.PI) / 180;
  return {
    lat: 111_132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
  };
}

/** Slope (degrees) from N, S, E, W elevations by central differences. */
export function stencilSlopeDeg(
  latitude: number,
  stencilOffsetDeg: number,
  [north, south, east, west]: [number, number, number, number],
): number {
  const m = metresPerDegree(latitude);
  const dzdy = (north - south) / (2 * stencilOffsetDeg * m.lat);
  const dzdx = (east - west) / (2 * stencilOffsetDeg * m.lon);
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * `elevations` holds 4 values per site in stencil order (null = lookup
 * failed). A site touching sea level (≤ 0 m — Copernicus DEM reports the
 * sea as 0) is dropped rather than counted as flat land, so coastal
 * districts are not made to look gentle by open water.
 */
export function summarizeTerrain(
  sites: TerrainSite[],
  elevations: Array<number | null>,
  stencilOffsetDeg: number,
): TerrainSummary {
  const slopes: number[] = [];
  const heights: number[] = [];
  sites.forEach((site, i) => {
    const z = elevations.slice(i * 4, i * 4 + 4);
    if (z.length < 4 || z.some((v) => v === null || v <= 0)) return;
    const values = z as [number, number, number, number];
    slopes.push(
      round1(stencilSlopeDeg(site.latitude, stencilOffsetDeg, values)),
    );
    heights.push(values.reduce((a, b) => a + b, 0) / 4);
  });
  const sorted = [...slopes].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : null;
  return {
    slopeSamplesDeg: slopes,
    slopeMedianDeg: median,
    slopeMaxDeg: sorted.length ? sorted[sorted.length - 1] : null,
    elevationMeanM: heights.length
      ? Math.round(heights.reduce((a, b) => a + b, 0) / heights.length)
      : null,
    elevationMinM: heights.length ? Math.round(Math.min(...heights)) : null,
    elevationMaxM: heights.length ? Math.round(Math.max(...heights)) : null,
    samplesPlanned: sites.length,
    samplesValid: slopes.length,
  };
}

// Mirror the ai-engine landslide baseline defaults
// (app/schemas/rainfall_landslide.py), so every consumer reads a district's
// slope the same way.
export const LANDSLIDE_SLOPE_QUANTILE = 0.9;
export const MIN_TERRAIN_SAMPLES = 8;

/** Linear-interpolated quantile (numpy's default convention). */
export function slopeQuantileDeg(samples: number[], q: number): number | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
