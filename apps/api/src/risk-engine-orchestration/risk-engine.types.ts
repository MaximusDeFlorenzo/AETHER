// Mirrors apps/ai-engine's Pydantic schemas exactly (docs/API_SPEC.md's
// Internal API section) — field-for-field, including which fields are
// nested under `hazardEvent`/`prediction` vs. top-level, since apps/ai-engine
// validates strictly (Pydantic 422s on a missing required field) and ignores
// fields it doesn't recognize rather than rejecting them. Wire format is
// camelCase on both sides.

export interface RiskEngineDistrictInput {
  id: string;
  name: string;
  totalPopulation: number;
  populationDensity: number;
  distanceFromEventKm: number;
}

export interface RiskEngineEarthquakeDetails {
  magnitude: number;
  depthKm: number;
}

export interface RiskEngineLandslideDetails {
  slopeDegrees: number;
  soilSaturation: number;
  triggeringRainfallMm: number;
}

export interface RiskEngineFloodDetails {
  rainfallMm: number | null;
  waterLevelM: number;
  riverBasin?: string | null;
  floodHazardIndex?: number | null;
}

export interface RiskEngineWildfireDetails {
  frpConfidence: number;
  hotspotCount: number;
  brightnessKelvin?: number | null;
}

export interface RiskEngineHazardEventInput {
  hazardType: string;
  latitude: number;
  longitude: number;
  eventTime: string;
  earthquake?: RiskEngineEarthquakeDetails | null;
  landslide?: RiskEngineLandslideDetails | null;
  flood?: RiskEngineFloodDetails | null;
  wildfire?: RiskEngineWildfireDetails | null;
}

export interface RiskEngineHistoricalDisasterInput {
  eventDate: string;
  magnitude: number | null;
  casualtiesDead: number;
  damagedBuildingsCount: number;
}

export type ExposureLevelValue = 'low' | 'moderate' | 'high' | 'severe';
export type PriorityLevelValue = 'low' | 'medium' | 'high' | 'critical';

export interface PredictRiskRequest {
  hazardEvent: RiskEngineHazardEventInput;
  district: RiskEngineDistrictInput;
  historicalDisasters: RiskEngineHistoricalDisasterInput[];
}

export interface PredictRiskResponse {
  hazardType: string;
  riskScore: number;
  exposureLevel: ExposureLevelValue;
  estimatedAffectedPopulation: number;
  confidenceScore: number;
  modelVersion: string;
}

export interface CalculatePriorityRequest {
  hazardType: string;
  prediction: PredictRiskResponse;
  district: RiskEngineDistrictInput;
}

export interface CalculatePriorityResponse {
  priorityLevel: PriorityLevelValue;
  priorityScore: number;
  confidenceScore: number;
}

export interface DecisionReasonResult {
  factor: string;
  detail: string;
  weight?: number | null;
}

export interface GenerateRecommendationRequest {
  hazardEvent: RiskEngineHazardEventInput;
  district: RiskEngineDistrictInput;
  prediction: PredictRiskResponse;
  priority: CalculatePriorityResponse;
  historicalDisasters?: RiskEngineHistoricalDisasterInput[];
}

export interface GenerateRecommendationResponse {
  summaryText: string;
  reasons: DecisionReasonResult[];
  actionRecommendation: string | null;
  confidenceScore: number;
}

export interface RiskEngineHospitalInput {
  code: string;
  name: string;
  totalBeds: number;
  distanceKm: number;
}

export interface OptimizeResourcesRequest {
  estimatedAffectedPopulation: number;
  exposureLevel: ExposureLevelValue;
  nearbyHospitals?: RiskEngineHospitalInput[];
}

export interface HospitalEstimate {
  hospitalsNeeded: number;
  recommendedHospitals: Array<{
    code: string;
    name: string;
    distanceKm: number;
    totalBeds: number;
  }>;
  availableCapacityBeds: number;
  estimatedOverflowBeds: number;
}

export interface AmbulanceEstimate {
  required: number;
  available: number;
  additionalNeeded: number;
}

export interface VehicleEstimate {
  rescueVehicles: number;
  logisticsTrucks: number;
  excavators: number;
  heavyEquipment: number;
}

export interface VolunteerEstimate {
  total: number;
  medical: number;
  logistics: number;
  sar: number;
}

export interface OptimizeResourcesResponse {
  hospital: HospitalEstimate;
  ambulance: AmbulanceEstimate;
  vehicles: VehicleEstimate;
  volunteers: VolunteerEstimate;
  evacuationShelters: number;
  logisticsAidTons: number;
}
