/**
 * Wind direction handling. Direction is circular: 359° and 1° are 2° apart,
 * not 358°, so it is never averaged or fed to a model as a raw angle — use
 * u/v components or the sin/cos encoding instead.
 *
 * Convention throughout: meteorological "from" direction, degrees clockwise
 * from north (a 90° wind blows FROM the east, TOWARD the west). `u` is the
 * eastward and `v` the northward component of the air's motion.
 */

const DEG = Math.PI / 180;
// Below this vector length (km/h) a direction is numerically meaningless.
const CALM_KMH = 1e-6;

const COMPASS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;
export type CompassPoint = (typeof COMPASS_16)[number];

/** Maps any finite angle into [0, 360); null for non-finite input. */
export function normalizeDirectionDeg(deg: number): number | null {
  if (!Number.isFinite(deg)) return null;
  const normalized = ((deg % 360) + 360) % 360;
  // Guard against -0 and floating-point 360.
  return normalized === 360 || Object.is(normalized, -0) ? 0 : normalized;
}

export function towardDeg(fromDeg: number): number {
  return normalizeDirectionDeg(fromDeg + 180) as number;
}

export function windToUv(
  speedKmh: number,
  fromDeg: number,
): { u: number; v: number } {
  return {
    u: -speedKmh * Math.sin(fromDeg * DEG),
    v: -speedKmh * Math.cos(fromDeg * DEG),
  };
}

/** Inverse of `windToUv`. `fromDeg` is null for a calm (zero) vector. */
export function uvToWind(
  u: number,
  v: number,
): { speedKmh: number; fromDeg: number | null } {
  const speedKmh = Math.hypot(u, v);
  if (speedKmh < CALM_KMH) return { speedKmh: 0, fromDeg: null };
  return {
    speedKmh,
    fromDeg: normalizeDirectionDeg(Math.atan2(-u, -v) / DEG),
  };
}

/** Circular feature encoding: continuous across the 0°/360° seam. */
export function encodeDirection(deg: number): { sin: number; cos: number } {
  return { sin: Math.sin(deg * DEG), cos: Math.cos(deg * DEG) };
}

export function compassPoint(deg: number): CompassPoint {
  const normalized = normalizeDirectionDeg(deg) ?? 0;
  return COMPASS_16[Math.round(normalized / 22.5) % 16];
}

/**
 * Vector-mean wind over several readings. `steadiness` = |mean vector| /
 * mean speed, in [0, 1]: 1 when every reading points the same way, near 0
 * when directions cancel out — a direct measure of how meaningful the mean
 * direction is. Null when there are no readings.
 */
export function vectorMeanWind(
  readings: Array<{ speedKmh: number; fromDeg: number }>,
): { speedKmh: number; fromDeg: number | null; steadiness: number } | null {
  if (readings.length === 0) return null;
  let u = 0;
  let v = 0;
  let speedSum = 0;
  for (const reading of readings) {
    const uv = windToUv(reading.speedKmh, reading.fromDeg);
    u += uv.u;
    v += uv.v;
    speedSum += reading.speedKmh;
  }
  const mean = uvToWind(u / readings.length, v / readings.length);
  const meanSpeed = speedSum / readings.length;
  return {
    speedKmh: mean.speedKmh,
    fromDeg: mean.fromDeg,
    steadiness: meanSpeed < CALM_KMH ? 0 : mean.speedKmh / meanSpeed,
  };
}
