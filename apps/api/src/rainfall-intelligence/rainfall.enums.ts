// Kept beside the feature (like karhutla-prediction/karhutla.enums.ts)
// rather than in common/enums/domain.enum.ts — nothing outside this module
// uses them.

/**
 * What a stored weather value actually is. Recorded per row so a model
 * value is never presented as a measurement. Only `nwp_model` (Open-Meteo)
 * is ingested today; the other two exist so GSMaP (satellite rainfall
 * estimate) and BMKG AWS (station observation) can be added to the same
 * table without a schema change once access is available.
 */
export enum WeatherDataKind {
  NWP_MODEL = 'nwp_model',
  SATELLITE_ESTIMATE = 'satellite_estimate',
  STATION_OBSERVATION = 'station_observation',
}

export type Freshness = 'fresh' | 'aging' | 'stale';
