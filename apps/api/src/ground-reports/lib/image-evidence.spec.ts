import {
  InvalidImageError,
  readExifSummary,
  sniffImageType,
  stripImageMetadata,
} from './image-evidence';

/** Little-endian TIFF with DateTimeOriginal, OffsetTimeOriginal and GPS
 * 6°10'30"S 106°49'0"E. */
function buildExifTiff(): Buffer {
  const buf = Buffer.alloc(160);
  buf.write('II', 0, 'latin1');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  const entry = (
    at: number,
    tag: number,
    type: number,
    count: number,
    value: number,
  ) => {
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(count, at + 4);
    buf.writeUInt32LE(value, at + 8);
  };
  // IFD0 @8: Exif + GPS pointers
  buf.writeUInt16LE(2, 8);
  entry(10, 0x8769, 4, 1, 38);
  entry(22, 0x8825, 4, 1, 68);
  // Exif IFD @38: DateTimeOriginal -> @122, OffsetTimeOriginal -> @142
  buf.writeUInt16LE(2, 38);
  entry(40, 0x9003, 2, 20, 122);
  entry(52, 0x9011, 2, 7, 142);
  // GPS IFD @68
  buf.writeUInt16LE(4, 68);
  entry(70, 0x0001, 2, 2, 0);
  buf.write('S\0', 78, 'latin1');
  entry(82, 0x0002, 5, 3, 0); // patched below
  entry(94, 0x0003, 2, 2, 0);
  buf.write('E\0', 102, 'latin1');
  entry(106, 0x0004, 5, 3, 0);
  buf.write('2026:10:13 14:05:00\0', 122, 'latin1');
  buf.write('+07:00\0', 142, 'latin1');
  // rationals don't fit in the remaining space at 150; grow the buffer
  const rationals = Buffer.alloc(48);
  [6, 10, 30, 106, 49, 0].forEach((v, i) => {
    rationals.writeUInt32LE(v, i * 8);
    rationals.writeUInt32LE(1, i * 8 + 4);
  });
  const tiff = Buffer.concat([buf, rationals]);
  tiff.writeUInt32LE(160, 90);
  tiff.writeUInt32LE(184, 114);
  return tiff;
}

function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function buildJpeg(exifTiff: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01', 'latin1')),
    segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exifTiff])),
    segment(
      0xe1,
      Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>', 'latin1'),
    ),
    segment(0xed, Buffer.from('Photoshop 3.0\0caption', 'latin1')),
    segment(0xfe, Buffer.from('a comment', 'latin1')),
    segment(0xdb, Buffer.alloc(65, 1)),
    segment(0xda, Buffer.alloc(10, 2)),
    // entropy data with a stuffed 0xFF00 and a restart marker
    Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
    Buffer.from([0xff, 0xd9]),
    Buffer.from('TRAILING-MOTION-PHOTO', 'latin1'),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, data, Buffer.alloc(4)]);
}

function riffChunk(fourcc: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([
    head,
    data,
    data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
}

describe('sniffImageType', () => {
  it('detects by magic bytes, not by name or declared type', () => {
    expect(sniffImageType(buildJpeg(buildExifTiff()))).toBe('image/jpeg');
    expect(
      sniffImageType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('image/png');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe(
      'image/webp',
    );
    expect(sniffImageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImageType(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('stripImageMetadata (JPEG)', () => {
  it('removes EXIF, XMP, IPTC, comments and trailing data but keeps image segments', () => {
    const tiff = buildExifTiff();
    const { buffer, exifTiff } = stripImageMetadata(
      buildJpeg(tiff),
      'image/jpeg',
    );
    const text = buffer.toString('latin1');
    expect(text).not.toContain('Exif');
    expect(text).not.toContain('xmpmeta');
    expect(text).not.toContain('Photoshop');
    expect(text).not.toContain('a comment');
    expect(text).not.toContain('TRAILING');
    expect(text).toContain('JFIF');
    expect(
      buffer.includes(Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56])),
    ).toBe(true);
    expect(buffer.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(exifTiff?.equals(tiff)).toBe(true);
  });

  it('rejects a truncated file', () => {
    const jpeg = buildJpeg(buildExifTiff());
    expect(() =>
      stripImageMetadata(jpeg.subarray(0, 40), 'image/jpeg'),
    ).toThrow(InvalidImageError);
  });
});

describe('stripImageMetadata (PNG)', () => {
  it('drops eXIf and text chunks', () => {
    const tiff = buildExifTiff();
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', Buffer.alloc(13)),
      pngChunk('tEXt', Buffer.from('Author\0Reporter Name', 'latin1')),
      pngChunk('eXIf', tiff),
      pngChunk('IDAT', Buffer.alloc(20, 7)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
    const { buffer, exifTiff } = stripImageMetadata(png, 'image/png');
    const text = buffer.toString('latin1');
    expect(text).not.toContain('Reporter Name');
    expect(text).not.toContain('eXIf');
    expect(text).toContain('IDAT');
    expect(exifTiff?.equals(tiff)).toBe(true);
  });

  it('rejects a PNG without IEND', () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', Buffer.alloc(13)),
    ]);
    expect(() => stripImageMetadata(png, 'image/png')).toThrow(
      InvalidImageError,
    );
  });
});

describe('stripImageMetadata (WebP)', () => {
  it('drops EXIF/XMP chunks, clears VP8X flags and fixes the RIFF size', () => {
    const tiff = buildExifTiff();
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x08 | 0x04 | 0x10; // EXIF + XMP + alpha
    const body = Buffer.concat([
      Buffer.from('WEBP', 'latin1'),
      riffChunk('VP8X', vp8x),
      riffChunk('VP8L', Buffer.alloc(9, 3)),
      riffChunk('EXIF', tiff),
      riffChunk('XMP ', Buffer.from('<x:xmpmeta/>', 'latin1')),
    ]);
    const head = Buffer.alloc(8);
    head.write('RIFF', 0, 'latin1');
    head.writeUInt32LE(body.length, 4);
    const { buffer, exifTiff } = stripImageMetadata(
      Buffer.concat([head, body]),
      'image/webp',
    );
    const text = buffer.toString('latin1');
    expect(text).not.toContain('EXIF');
    expect(text).not.toContain('xmpmeta');
    expect(buffer.readUInt32LE(4)).toBe(buffer.length - 8);
    expect(buffer[20]).toBe(0x10);
    expect(exifTiff?.equals(tiff)).toBe(true);
  });
});

describe('readExifSummary', () => {
  it('extracts capture time, offset and signed GPS', () => {
    const summary = readExifSummary(buildExifTiff());
    expect(summary.dateTimeOriginal).toBe('2026:10:13 14:05:00');
    expect(summary.offsetTimeOriginal).toBe('+07:00');
    expect(summary.gps?.latitude).toBeCloseTo(-6.175, 6);
    expect(summary.gps?.longitude).toBeCloseTo(106.816667, 5);
  });

  it('returns an empty summary for missing or garbage EXIF instead of throwing', () => {
    const empty = {
      dateTimeOriginal: null,
      offsetTimeOriginal: null,
      gps: null,
    };
    expect(readExifSummary(null)).toEqual(empty);
    expect(
      readExifSummary(Buffer.from('II*\0\xff\xff\xff\xff', 'latin1')),
    ).toEqual(empty);
  });
});
