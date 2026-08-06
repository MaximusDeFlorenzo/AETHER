// Expected shape of a `GET {WEATHER_API_BASE_URL}/stations/current` response
// — a flood-early-warning-style feed reporting rainfall AND river/floodplain
// water level per monitoring station (plain rainfall-only weather APIs don't
// carry the water-level reading apps/ai-engine's FloodDetails needs to
// score risk; see weather.adapter.ts's module docstring for the reasoning).
// WEATHER_API_BASE_URL is deployment-configurable specifically so this can
// point at whichever real provider is wired up without an adapter rewrite.
export interface WeatherStationReading {
  stationId: string;
  latitude: number;
  longitude: number;
  riverBasin: string | null;
  rainfallMm: number;
  waterLevelM: number;
  observedAt: string;
}

export interface WeatherStationsResponse {
  stations: WeatherStationReading[];
}
