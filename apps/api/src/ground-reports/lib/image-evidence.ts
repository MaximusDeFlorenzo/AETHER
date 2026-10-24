/**
 * Evidence-photo handling for community ground reports, dependency-free:
 *
 * - `sniffImageType` decides the type from the file's own bytes — the
 *   multipart Content-Type is client-controlled and never trusted.
 * - `stripImageMetadata` removes EXIF/XMP/IPTC/text metadata before the file
 *   is stored, so a reviewer-facing (and any future public) copy never
 *   carries the reporter's device GPS, serial numbers or captions. It does
 *   not re-encode pixels: an EXIF orientation flag is dropped with the rest,
 *   so some phone photos display rotated.
 * - `readExifSummary` keeps only what verification needs from the stripped
 *   EXIF block — capture time and GPS — for reviewer-only storage.
 *
 * All parsing is bounds-checked; malformed containers raise
 * `InvalidImageError`, while unreadable EXIF just yields an empty summary.
 */

export type EvidenceImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export class InvalidImageError extends Error {}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function sniffImageType(buf: Buffer): EvidenceImageType | null {
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface StrippedImage {
  buffer: Buffer;
  /** Raw TIFF-structured EXIF block, if the file had one. */
  exifTiff: Buffer | null;
}

export function stripImageMetadata(
  buf: Buffer,
  type: EvidenceImageType,
): StrippedImage {
  switch (type) {
    case 'image/jpeg':
      return stripJpeg(buf);
    case 'image/png':
      return stripPng(buf);
    case 'image/webp':
      return stripWebp(buf);
  }
}

const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');

function withoutExifHeader(block: Buffer): Buffer {
  return block.subarray(0, 6).equals(EXIF_HEADER) ? block.subarray(6) : block;
}

// Kept: APP0 (JFIF), APP2 (ICC colour profile), APP14 (Adobe — needed to
// decode CMYK/YCCK correctly). Dropped: APP1 (EXIF/XMP), every other APPn
// (APP13 = Photoshop/IPTC captions and locations) and COM comments.
function keepJpegSegment(marker: number): boolean {
  if (marker >= 0xe0 && marker <= 0xef) {
    return marker === 0xe0 || marker === 0xe2 || marker === 0xee;
  }
  return marker !== 0xfe;
}

function stripJpeg(buf: Buffer): StrippedImage {
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let exifTiff: Buffer | null = null;
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) throw new InvalidImageError('Corrupt JPEG marker');
    let markerPos = pos + 1;
    while (markerPos < buf.length && buf[markerPos] === 0xff) markerPos += 1;
    if (markerPos >= buf.length) throw new InvalidImageError('Truncated JPEG');
    const marker = buf[markerPos];
    if (marker === 0xd9) {
      // EOI. Anything a camera appended after it (motion-photo video,
      // vendor trailers) is dropped with the metadata.
      parts.push(buf.subarray(pos, markerPos + 1));
      return { buffer: Buffer.concat(parts), exifTiff };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buf.subarray(pos, markerPos + 1));
      pos = markerPos + 1;
      continue;
    }
    if (markerPos + 3 > buf.length)
      throw new InvalidImageError('Truncated JPEG');
    const length = buf.readUInt16BE(markerPos + 1);
    const end = markerPos + 1 + length;
    if (length < 2 || end > buf.length) {
      throw new InvalidImageError('Truncated JPEG segment');
    }
    if (marker === 0xda) {
      // Start of scan: copy the header plus its entropy-coded data, which
      // runs until the next real marker (0xFF followed by neither a 0x00
      // stuffing byte nor RSTn). Progressive JPEGs have several scans.
      let scanEnd = end;
      while (scanEnd + 1 < buf.length) {
        const next = buf[scanEnd + 1];
        if (
          buf[scanEnd] === 0xff &&
          next !== 0x00 &&
          next !== 0xff &&
          !(next >= 0xd0 && next <= 0xd7)
        ) {
          break;
        }
        scanEnd += 1;
      }
      if (scanEnd + 1 >= buf.length)
        throw new InvalidImageError('JPEG has no EOI');
      parts.push(buf.subarray(pos, scanEnd));
      pos = scanEnd;
      continue;
    }
    const payload = buf.subarray(markerPos + 3, end);
    if (
      marker === 0xe1 &&
      !exifTiff &&
      payload.subarray(0, 6).equals(EXIF_HEADER)
    ) {
      exifTiff = payload.subarray(6);
    }
    if (keepJpegSegment(marker)) parts.push(buf.subarray(pos, end));
    pos = end;
  }
  throw new InvalidImageError('JPEG has no EOI');
}

const PNG_DROPPED_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function stripPng(buf: Buffer): StrippedImage {
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let exifTiff: Buffer | null = null;
  let pos = 8;
  let sawEnd = false;
  while (pos < buf.length) {
    if (pos + 12 > buf.length) throw new InvalidImageError('Truncated PNG');
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > buf.length) throw new InvalidImageError('Truncated PNG chunk');
    if (type === 'eXIf' && !exifTiff) {
      exifTiff = withoutExifHeader(buf.subarray(pos + 8, pos + 8 + length));
    }
    if (!PNG_DROPPED_CHUNKS.has(type)) parts.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new InvalidImageError('PNG has no IEND chunk');
  return { buffer: Buffer.concat(parts), exifTiff };
}

const WEBP_VP8X_EXIF_FLAG = 0x08;
const WEBP_VP8X_XMP_FLAG = 0x04;

function stripWebp(buf: Buffer): StrippedImage {
  const chunks: Buffer[] = [];
  let exifTiff: Buffer | null = null;
  let pos = 12;
  while (pos < buf.length) {
    if (pos + 8 > buf.length) throw new InvalidImageError('Truncated WebP');
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const dataEnd = pos + 8 + size;
    const end = dataEnd + (size % 2);
    if (dataEnd > buf.length)
      throw new InvalidImageError('Truncated WebP chunk');
    const chunk = Buffer.from(buf.subarray(pos, Math.min(end, buf.length)));
    if (fourcc === 'EXIF') {
      if (!exifTiff)
        exifTiff = withoutExifHeader(buf.subarray(pos + 8, dataEnd));
    } else if (fourcc !== 'XMP ') {
      if (fourcc === 'VP8X' && size >= 1) {
        chunk[8] &= ~(WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG);
      }
      chunks.push(chunk);
    }
    pos = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return { buffer: Buffer.concat([header, body]), exifTiff };
}

export interface ExifSummary {
  /** Raw "YYYY:MM:DD HH:MM:SS" camera clock — no zone unless `offset` is set. */
  dateTimeOriginal: string | null;
  /** "+07:00"-style offset when the camera recorded one. */
  offsetTimeOriginal: string | null;
  gps: { latitude: number; longitude: number } | null;
}

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LON_REF = 0x0003;
const TAG_GPS_LON = 0x0004;

const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
};

interface IfdEntry {
  type: number;
  count: number;
  valueOffset: number;
}

export function readExifSummary(tiff: Buffer | null): ExifSummary {
  const empty: ExifSummary = {
    dateTimeOriginal: null,
    offsetTimeOriginal: null,
    gps: null,
  };
  if (!tiff || tiff.length < 8) return empty;
  try {
    return parseTiff(tiff);
  } catch {
    return empty;
  }
}

function parseTiff(tiff: Buffer): ExifSummary {
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') throw new Error('Not TIFF');
  const le = order === 'II';
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) throw new Error('Bad TIFF magic');

  const readIfd = (offset: number): Map<number, IfdEntry> => {
    const entries = new Map<number, IfdEntry>();
    const count = u16(offset);
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12;
      const type = u16(at + 2);
      const n = u32(at + 4);
      const bytes = (TYPE_SIZES[type] ?? 0) * n;
      entries.set(u16(at), {
        type,
        count: n,
        valueOffset: bytes <= 4 ? at + 8 : u32(at + 8),
      });
    }
    return entries;
  };

  const ascii = (entry: IfdEntry | undefined): string | null => {
    if (!entry || entry.type !== 2) return null;
    const end = entry.valueOffset + entry.count;
    if (end > tiff.length) return null;
    const text = tiff
      .toString('latin1', entry.valueOffset, end)
      .replace(/\0+$/, '')
      .trim();
    return text || null;
  };

  const degrees = (entry: IfdEntry | undefined): number | null => {
    if (!entry || entry.type !== 5 || entry.count < 3) return null;
    if (entry.valueOffset + 24 > tiff.length) return null;
    const parts = [0, 1, 2].map((i) => {
      const den = u32(entry.valueOffset + i * 8 + 4);
      return den === 0 ? NaN : u32(entry.valueOffset + i * 8) / den;
    });
    const value = parts[0] + parts[1] / 60 + parts[2] / 3600;
    return Number.isFinite(value) ? value : null;
  };

  const ifd0 = readIfd(u32(4));
  const exifPointer = ifd0.get(TAG_EXIF_IFD);
  const gpsPointer = ifd0.get(TAG_GPS_IFD);

  let dateTimeOriginal: string | null = null;
  let offsetTimeOriginal: string | null = null;
  if (exifPointer) {
    const exif = readIfd(u32(exifPointer.valueOffset));
    dateTimeOriginal = ascii(exif.get(TAG_DATETIME_ORIGINAL));
    offsetTimeOriginal = ascii(exif.get(TAG_OFFSET_TIME_ORIGINAL));
  }

  let gps: ExifSummary['gps'] = null;
  if (gpsPointer) {
    const gpsIfd = readIfd(u32(gpsPointer.valueOffset));
    const lat = degrees(gpsIfd.get(TAG_GPS_LAT));
    const lon = degrees(gpsIfd.get(TAG_GPS_LON));
    const latRef = ascii(gpsIfd.get(TAG_GPS_LAT_REF));
    const lonRef = ascii(gpsIfd.get(TAG_GPS_LON_REF));
    if (lat !== null && lon !== null && lat <= 90 && lon <= 180) {
      gps = {
        latitude: latRef === 'S' ? -lat : lat,
        longitude: lonRef === 'W' ? -lon : lon,
      };
    }
  }

  return { dateTimeOriginal, offsetTimeOriginal, gps };
}
