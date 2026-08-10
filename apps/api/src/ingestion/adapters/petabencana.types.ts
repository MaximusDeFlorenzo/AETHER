// Shape of `GET {PETABENCANA_BASE_URL}/floodgauges?admin={code}&geoformat=geojson`
// — PetaBencana.id's public flood-gauge feed (BPBD-sourced river/reservoir
// water-level telemetry, https://docs.petabencana.id/master-1/routes/floodgauges).
// No API key: the service is fully public. `geoformat=geojson` is requested
// specifically so `coordinates` arrive as real [longitude, latitude] pairs
// rather than the default TopoJSON's quantized integers + a separate
// scale/translate transform.
export interface PetaBencanaGaugeObservation {
  /** ISO-8601 timestamp of this reading. */
  f1: string;
  /** Water level reading, in centimeters, relative to the station's own
   * local reference datum — some reservoir stations (e.g. Jakarta's Waduk
   * Pluit) read consistently negative because their datum sits below the
   * station's physical zero, not because of a data error. */
  f2: number;
  /** Numeric alert-level code, 1 (most severe) through 4 (normal/no alert). */
  f3: number;
  /** Human-readable alert label, e.g. "SIAGA IV" (Indonesian flood alert
   * status). Preserved in `rawPayload` but not mapped into `FloodDetailsShape`
   * — there's no field for it there today. */
  f4: string;
}

export interface PetaBencanaGaugeFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    gaugeid: string;
    gaugenameid: string;
    observations: PetaBencanaGaugeObservation[];
  };
}

export interface PetaBencanaFloodGaugesResponse {
  statusCode: number;
  result: {
    type: 'FeatureCollection';
    features: PetaBencanaGaugeFeature[];
  };
}

/** Flattened form the adapter works with: one entry per gauge station's
 * latest observation for a given poll. */
export interface PetaBencanaGaugeReading {
  gaugeId: string;
  gaugeName: string;
  latitude: number;
  longitude: number;
  waterLevelCm: number;
  alertLevel: string;
  observedAt: string;
  adminCode: string;
  /** 0-1 hazard-susceptibility value from BNPB's InaRISK
   * `INDEKS_BAHAYA_BANJIR` layer, looked up during `fetch()` — `null` if the
   * lookup found no data for this coordinate or the request failed. */
  floodHazardIndex: number | null;
}
