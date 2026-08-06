// One row of NASA FIRMS' Area API CSV response
// (https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}),
// already split into named fields — see `parseFirmsCsv` in nasa-firms.adapter.ts
// for the raw-CSV-to-this-shape parsing step.
export interface FirmsHotspot {
  latitude: string;
  longitude: string;
  brightness: string;
  scan: string;
  track: string;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: string;
  version: string;
  bright_t31: string;
  frp: string;
  daynight: string;
}
