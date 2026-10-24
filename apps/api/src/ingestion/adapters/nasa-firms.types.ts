// One row of NASA FIRMS' Area API CSV response
// (https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}),
// already split into named fields — see `parseFirmsCsv` in nasa-firms.adapter.ts
// for the raw-CSV-to-this-shape parsing step.

/** FIRMS NRT products polled — the same satellites SiPongi (KLHK) shows:
 * MODIS on Terra/Aqua and VIIRS on Suomi-NPP / NOAA-20 / NOAA-21. */
export const FIRMS_SOURCES = [
  'MODIS_NRT',
  'VIIRS_SNPP_NRT',
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
] as const;
export type FirmsSource = (typeof FIRMS_SOURCES)[number];

interface FirmsCommonRow {
  latitude: string;
  longitude: string;
  scan: string;
  track: string;
  acq_date: string;
  acq_time: string;
  /** MODIS: "Terra"/"Aqua"; VIIRS: "N" (S-NPP), "N20", "N21". */
  satellite: string;
  instrument: string;
  version: string;
  frp: string;
  daynight: string;
}

/** MODIS: 1 km pixels, `confidence` a 0-100 percentage. */
export interface FirmsModisRow extends FirmsCommonRow {
  brightness: string;
  bright_t31: string;
  /** 0-100. */
  confidence: string;
}

/** VIIRS: 375 m I-band pixels, `confidence` categorical l/n/h. */
export interface FirmsViirsRow extends FirmsCommonRow {
  bright_ti4: string;
  bright_ti5: string;
  /** "l" | "n" | "h". */
  confidence: string;
}

/** A parsed row tagged with the FIRMS product it came from — the tag is
 * persisted in `rawPayload`, since the CSV itself doesn't name the product. */
export type FirmsHotspot = (FirmsModisRow | FirmsViirsRow) & {
  firmsSource: FirmsSource;
};
