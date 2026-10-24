import { gunzipSync, gzipSync } from 'zlib';

/**
 * Storage/transport encoding for rain grids (`rainfall_grids.data`):
 * little-endian float32, row-major from the northernmost row, NaN =
 * missing, gzip-compressed. Mostly-dry fields compress well.
 */
export const RAIN_GRID_ENCODING = 'float32le+gzip';

export function encodeRainGrid(values: Float32Array): Buffer {
  const raw = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => raw.writeFloatLE(value, i * 4));
  return gzipSync(raw);
}

export function decodeRainGrid(data: Buffer, cells: number): Float32Array {
  const raw = gunzipSync(data);
  if (raw.length !== cells * 4) {
    throw new Error(
      `Rain grid has ${raw.length} bytes, expected ${cells * 4} (${cells} cells)`,
    );
  }
  const values = new Float32Array(cells);
  for (let i = 0; i < cells; i++) values[i] = raw.readFloatLE(i * 4);
  return values;
}

/** Raw (uncompressed) float32 LE as base64 — the ai-engine wire format. */
export function rainGridToBase64(values: Float32Array): string {
  const raw = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => raw.writeFloatLE(value, i * 4));
  return raw.toString('base64');
}
