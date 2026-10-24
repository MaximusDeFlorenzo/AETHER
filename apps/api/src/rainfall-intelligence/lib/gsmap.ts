/**
 * JAXA GSMaP_NOW / GSMaP_Gauge_NOW hourly binary grid — pure decoding and
 * point sampling. Format per JAXA "Data Format Description for GSMaP_NOW"
 * (FTP /now/doc/DataFormatDescription_NOW.pdf, updated 2026-04-16) §2.4-2.5
 * and /now/sample/GSMaP_NOW.hourly.rain.ctl:
 *
 * - 3600 × 1200 little-endian float32, gzip-compressed (17,280,000 bytes raw).
 * - 0.1° cells; first cell centre (0.05°E, 59.95°N), rows run west→east
 *   from 0°E, lines north→south to 60°S.
 * - Value = hourly-averaged rain rate (mm/hr) over the file's hour, so it is
 *   also the hour's accumulation in mm. Negative values are missing codes.
 * - File name `gsmap_now.YYYYMMDD.HHNN.dat.gz` = START time (UTC) of a
 *   one-hour window. GSMaP_NOW's last half hour is extrapolated by cloud
 *   motion vectors (format document p. 1), so the newest data is part
 *   forecast by construction.
 */

export const GSMAP_NX = 3600;
export const GSMAP_NY = 1200;
export const GSMAP_GRID_BYTES = GSMAP_NX * GSMAP_NY * 4;
const CELLS_PER_DEGREE = 10;
const NORTH_EDGE_DEG = 60;
// Same physical bound as lib/normalize.ts (≈ world-record 1-h rainfall).
const MAX_HOURLY_PRECIPITATION_MM = 305;
// Guards against a point landing exactly on a cell edge drifting to the
// neighbour through floating-point error (106.8 / 0.1 = 1067.9999…).
const EDGE_EPSILON = 1e-9;
const HOUR_MS = 60 * 60 * 1000;

export type GsmapProduct = 'gsmap_now' | 'gsmap_gauge_now';

export const GSMAP_PRODUCTS: GsmapProduct[] = ['gsmap_now', 'gsmap_gauge_now'];

const MISSING_CODES: Record<number, string> = {
  [-4]: 'gsmap:missing_sea_ice',
  [-8]: 'gsmap:missing_low_temperature',
  [-99]: 'gsmap:no_observation',
};

export interface GsmapFile {
  product: GsmapProduct;
  /** Start of the one-hour window (UTC). */
  start: Date;
  /** End of the window = `weather_hourly_samples.valid_time`. */
  validTime: Date;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function gsmapFileName(product: GsmapProduct, start: Date): string {
  return `${product}.${start.getUTCFullYear()}${pad(start.getUTCMonth() + 1)}${pad(
    start.getUTCDate(),
  )}.${pad(start.getUTCHours())}${pad(start.getUTCMinutes())}.dat.gz`;
}

/**
 * Parses the short (GrADS-style) names in /now/latest. Only windows that
 * start on the hour are returned: the :30 files overlap their neighbours,
 * and hour-aligned windows match every other source's `valid_time`.
 */
export function parseGsmapFileName(name: string): GsmapFile | null {
  const match =
    /^(gsmap_now|gsmap_gauge_now)\.(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})\.dat\.gz$/.exec(
      name,
    );
  if (!match) return null;
  const [, product, y, mo, d, h, mi] = match;
  if (mi !== '00') return null;
  const start = new Date(Date.UTC(+y, +mo - 1, +d, +h, 0));
  // Date.UTC rolls invalid parts over (month 13 → next January), so check
  // every component survived unchanged.
  if (
    start.getUTCFullYear() !== +y ||
    start.getUTCMonth() !== +mo - 1 ||
    start.getUTCDate() !== +d ||
    start.getUTCHours() !== +h
  ) {
    return null;
  }
  return {
    product: product as GsmapProduct,
    start,
    validTime: new Date(start.getTime() + HOUR_MS),
    name,
  };
}

/** Cell indices for a coordinate, or null outside 60°S–60°N. */
export function gsmapCell(
  latitude: number,
  longitude: number,
): { column: number; line: number } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const line = Math.floor(
    (NORTH_EDGE_DEG - latitude) * CELLS_PER_DEGREE + EDGE_EPSILON,
  );
  if (line < 0 || line >= GSMAP_NY) return null;
  const lon360 = ((longitude % 360) + 360) % 360;
  const column =
    Math.floor(lon360 * CELLS_PER_DEGREE + EDGE_EPSILON) % GSMAP_NX;
  return { column, line };
}

export interface GsmapPointValue {
  precipitationMm: number | null;
  qualityFlags: string[];
}

/** Reads the cell containing the point from a decompressed grid. */
export function sampleGsmap(
  grid: Buffer,
  latitude: number,
  longitude: number,
): GsmapPointValue {
  if (grid.length !== GSMAP_GRID_BYTES) {
    throw new Error(
      `GSMaP grid has ${grid.length} bytes, expected ${GSMAP_GRID_BYTES}`,
    );
  }
  const cell = gsmapCell(latitude, longitude);
  if (!cell) {
    return { precipitationMm: null, qualityFlags: ['gsmap:outside_domain'] };
  }
  const value = grid.readFloatLE((cell.line * GSMAP_NX + cell.column) * 4);
  if (!Number.isFinite(value)) {
    return { precipitationMm: null, qualityFlags: ['gsmap:invalid'] };
  }
  if (value < 0) {
    return {
      precipitationMm: null,
      qualityFlags: [MISSING_CODES[Math.round(value)] ?? 'gsmap:invalid'],
    };
  }
  if (value > MAX_HOURLY_PRECIPITATION_MM) {
    return {
      precipitationMm: null,
      qualityFlags: ['precipitation:out_of_range'],
    };
  }
  return { precipitationMm: Math.round(value * 100) / 100, qualityFlags: [] };
}

/** Cell-centre geometry of a regular lat/lon rain grid. */
export interface GridDomain {
  westLon: number;
  northLat: number;
  resolutionDeg: number;
  nx: number;
  ny: number;
}

// Indonesia (≈ 95–141°E, 11°S–6°N) plus ~4° of margin on every side, so
// rain approaching from outside the border is in the field and motion
// tracking windows (±2.1° incl. search) never fall off the edge.
export const INDONESIA_RAIN_DOMAIN: GridDomain = {
  westLon: 90.05,
  northLat: 9.95,
  resolutionDeg: 0.1,
  nx: 550,
  ny: 250,
};

/**
 * Cuts `domain` (aligned to the GSMaP 0.1° grid) out of a decompressed
 * global GSMaP grid. Missing codes (negative) become NaN; returns the
 * subset and its missing-cell count.
 */
export function extractGsmapDomain(
  grid: Buffer,
  domain: GridDomain = INDONESIA_RAIN_DOMAIN,
): { values: Float32Array; missingCells: number } {
  if (grid.length !== GSMAP_GRID_BYTES) {
    throw new Error(
      `GSMaP grid has ${grid.length} bytes, expected ${GSMAP_GRID_BYTES}`,
    );
  }
  const topLeft = gsmapCell(domain.northLat, domain.westLon);
  if (!topLeft || domain.resolutionDeg !== 1 / CELLS_PER_DEGREE) {
    throw new Error('Domain is not aligned to the GSMaP 0.1° grid');
  }
  if (topLeft.line + domain.ny > GSMAP_NY) {
    throw new Error('Domain extends beyond the GSMaP 60°S edge');
  }
  const values = new Float32Array(domain.nx * domain.ny);
  let missingCells = 0;
  for (let y = 0; y < domain.ny; y++) {
    const line = topLeft.line + y;
    for (let x = 0; x < domain.nx; x++) {
      const column = (topLeft.column + x) % GSMAP_NX;
      const value = grid.readFloatLE((line * GSMAP_NX + column) * 4);
      if (!Number.isFinite(value) || value < 0) {
        values[y * domain.nx + x] = NaN;
        missingCells += 1;
      } else {
        values[y * domain.nx + x] = value;
      }
    }
  }
  return { values, missingCells };
}
