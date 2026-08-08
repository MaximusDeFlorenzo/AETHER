// Mirrors apps/api's controller/entity JSON shapes per docs/API_SPEC.md.
// Nested relations come back as full embedded objects wherever the backend's
// `relations` option loads them; write DTOs use flat `*Id` fields instead.
//
// Shared cross-app enums (`HazardType`, `ExposureLevel`, `PriorityLevel`,
// `DecisionReason`) live in packages/contracts and are re-exported here so
// every other domain type in this file can reference them without ever
// redefining them locally — the whole point of the contracts package per
// docs/ARCHITECTURE.md §4.
export type {
  DecisionReason,
  ExposureLevel,
  HazardType,
  PriorityLevel,
} from '@aether/contracts';

import type { DecisionReason, ExposureLevel, HazardType, PriorityLevel } from '@aether/contracts';

export type RoleName = 'admin' | 'agency_operator' | 'analyst' | 'field_reporter';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: RoleName;
  isActive?: boolean;
}

export type RiskAssessmentStatus = 'pending' | 'completed' | 'failed';
export type NotificationType =
  | 'hazard_event_created'
  | 'decision_recommendation_created'
  | 'hazard_relationship_detected'
  | 'system';

// --- Hazard events -----------------------------------------------------

export interface EarthquakeDetails {
  magnitude: number;
  depthKm: number;
  potentialTsunami: boolean;
}

export interface LandslideDetails {
  slopeAngleDeg: number | null;
  soilSaturationPct: number | null;
  triggerRainfallMm: number | null;
}

export interface FloodDetails {
  rainfallMm: number | null;
  waterLevelM: number | null;
  riverBasin: string | null;
}

export interface WildfireDetails {
  frpConfidence: number | null;
  hotspotCount: number | null;
  brightnessKelvin: number | null;
}

export type HazardEventDetails =
  | EarthquakeDetails
  | LandslideDetails
  | FloodDetails
  | WildfireDetails;

export interface HazardEvent {
  id: string;
  hazardType: HazardType;
  latitude: number;
  longitude: number;
  locationLabel: string | null;
  region: string | null;
  eventTime: string;
  source: string;
  affectedRegionCount?: number;
  details: HazardEventDetails;
}

export interface HazardEventDetail extends HazardEvent {
  rawPayload: Record<string, unknown>;
  externalId: string | null;
}

export interface ProvinceRef {
  id: string;
  bpsCode: string;
  name: string;
}

export interface DistrictRef {
  id: string;
  bpsCode: string;
  name: string;
  areaKm2: number | null;
  province?: ProvinceRef;
}

export interface AffectedRegion {
  id: string;
  distanceKm: number;
  district: DistrictRef;
  createdAt: string;
}

export interface HazardRelationship {
  id: string;
  relatedHazardEvent: HazardEvent;
  relationshipType: string;
  detail: string;
  createdAt: string;
}

// --- Risk assessments (replaces ORION's Predictions) --------------------

export interface RiskAssessment {
  id: string;
  hazardEvent: HazardEvent | null; // null => standing/baseline assessment (FR: prediction/prevention)
  district: DistrictRef;
  hazardType: HazardType;
  riskScore: number | null;
  exposureLevel: ExposureLevel | null;
  estimatedAffectedPopulation: number | null;
  confidenceScore: number | null;
  modelVersion: string | null;
  status: RiskAssessmentStatus;
  isBaseline: boolean;
  errorMessage?: string | null;
  inputSnapshot?: Record<string, unknown>;
  createdAt: string;
}

// --- Decision intelligence (replaces ORION's Recommendations) -----------

export interface DecisionRecommendation {
  id: string;
  riskAssessment: RiskAssessment;
  priorityLevel: PriorityLevel;
  priorityScore: number;
  confidenceScore: number;
  summaryText: string;
  actionRecommendation: string;
  reasons: DecisionReason[];
  hasCascadingHazard?: boolean;
  createdAt: string;
}

// --- Spatial intelligence ------------------------------------------------

export type SpatialOverlayLayer = 'risk' | 'vulnerability' | 'exposure';

export interface SpatialOverlayFeatureProperties {
  districtId: string;
  districtName: string;
  hazardType: HazardType;
  layer: SpatialOverlayLayer;
  value: number;
  exposureLevel: ExposureLevel;
}

export interface SpatialOverlayFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
    properties: SpatialOverlayFeatureProperties;
  }>;
}

// --- Resource optimization ------------------------------------------------

// Mirrors apps/api's ResourceOptimizationPlan entity (leftJoinAndSelect'd
// with district + hazardEvent only — riskAssessment is never selected by
// findAllPlans/findOnePlan). `planDetails` is the raw, loosely-typed
// apps/ai-engine `/optimize-resources` response (see risk-engine.types.ts'
// OptimizeResourcesResponse) for auto-generated plans, but is arbitrary
// caller-supplied JSON for manually-created ones (CreateResourceOptimizationPlanDto
// only requires `IsObject()`) — every field below must be read defensively.
export interface ResourceOptimizationPlanDetails {
  hospital?: { hospitalsNeeded?: number };
  ambulance?: { required?: number; available?: number; additionalNeeded?: number };
  vehicles?: { rescueVehicles?: number; logisticsTrucks?: number; excavators?: number; heavyEquipment?: number };
  volunteers?: { total?: number; medical?: number; logistics?: number; sar?: number };
  evacuationShelters?: number;
  logisticsAidTons?: number;
}

export interface ResourceOptimizationPlan {
  id: string;
  district: DistrictRef;
  hazardEvent: HazardEvent | null;
  planType: string;
  planDetails: ResourceOptimizationPlanDetails;
  estimatedPersonnelNeeded: number | null;
  status: 'draft' | 'approved' | 'executed';
  createdAt: string;
}

export interface ResourceOptimizationPlanInput {
  districtId: string;
  hazardType: HazardType;
  hazardEventId?: string;
}

export interface Shelter {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  district: DistrictRef;
  capacity: number;
  currentOccupancy: number | null;
}

// --- Sustainability --------------------------------------------------------

export interface SdgIndicator {
  goal: string;
  label: string;
  score: number;
  target: number;
}

export interface SustainabilityMetrics {
  district: DistrictRef | null;
  periodStart: string;
  periodEnd: string;
  climateResilienceScore: number;
  carbonReductionEstimateTons: number;
  protectedPopulation: number;
  responseEfficiencyScore: number;
  sdgIndicators: SdgIndicator[];
}

// --- Computer Vision / field reports ---------------------------------------

export type CvDetectionType = 'flood' | 'smoke' | 'fire' | 'infra_damage';

export interface CvBoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface CvDetection {
  id: string;
  detectionType: CvDetectionType;
  hazardEvent: HazardEvent | null;
  sourceImageRef: string;
  imageUrl: string;
  boundingBoxes: CvBoundingBox[];
  confidenceScore: number;
  createdAt: string;
}

export interface FieldReportSubmissionInput {
  image: File;
  hazardTypeHint?: HazardType;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

export interface FieldReportSubmissionResult {
  detections: CvDetection[];
}

// --- Vulnerability indicators -----------------------------------------------

export interface VulnerabilityIndicator {
  id: string;
  district: DistrictRef;
  indicatorType: string;
  value: number;
  unit: string | null;
  year: number;
  source: string | null;
}

// --- Historical / population ------------------------------------------------

export interface HistoricalDisaster {
  id: string;
  hazardType: HazardType;
  province: ProvinceRef;
  district: DistrictRef | null;
  eventDate: string;
  severity: number | null;
  casualtiesDead: number;
  casualtiesInjured: number;
  casualtiesMissing: number;
  displacedPopulation: number;
  damagedBuildingsCount: number;
  damageDescription: string | null;
  source: string;
}

export type Province = ProvinceRef;
export type District = DistrictRef;

export interface PopulationStatistic {
  id: string;
  district: DistrictRef;
  year: number;
  totalPopulation: number;
  populationDensity: number;
  source: string;
}

// --- Notifications / dashboard --------------------------------------------

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface DashboardSummary {
  activeHazardEventCount: number;
  highestPriorityRecommendation: DecisionRecommendation | null;
  recentHazardEvents: HazardEvent[];
  unreadNotificationCount: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}
