// Sentinel imagery tiles have no simple per-event raw row shape the way
// BMKG/FIRMS do — this placeholder exists only so SentinelAdapter can
// satisfy `HazardDataSourceAdapter<TRaw>`'s generic parameter.
export type SentinelSceneRef = never;
