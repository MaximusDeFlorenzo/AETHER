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
  slopeDegrees: number | null;
  /** 0–1 fraction, not a percentage. */
  soilSaturation: number | null;
  triggeringRainfallMm: number | null;
}

export interface FloodDetails {
  rainfallMm: number | null;
  waterLevelM: number | null;
  riverBasin: string | null;
  floodHazardIndex: number | null;
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
  details: HazardEventDetails | null;
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

// `subdistricts` (kecamatan) and `villages` (kelurahan/desa) have real
// code/name data (see Subdistrict/Village below), but population/area/
// coordinates exist ONLY at 'kabupaten_kota' — no source AETHER has
// integrated provides them any finer. See docs/DATABASE_SCHEMA.md §5-6b.
export type AdministrativeLevel = 'kabupaten_kota' | 'kecamatan' | 'kelurahan_desa';

// Only 'kemendagri' exists today — every region code in the app comes from
// Kemendagri's administrative code decree, never independently verified
// against a BPS code table. See docs/DATABASE_SCHEMA.md §5.
export type RegionCodeSystem = 'kemendagri';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

// Kecamatan. No population/area/coordinates — see AdministrativeLevel above.
export interface SubdistrictRef {
  id: string;
  code: string;
  codeSystem: RegionCodeSystem;
  administrativeLevel: AdministrativeLevel;
  name: string;
  district?: DistrictRef;
}

// Kelurahan/desa. Population comes from `village_populations` (CSV import)
// and the API keeps a centroid reference point for radius lookups (see
// AffectedPopulationEstimate), but no area or boundary.
export interface VillageRef {
  id: string;
  code: string;
  codeSystem: RegionCodeSystem;
  administrativeLevel: AdministrativeLevel;
  name: string;
  subdistrict?: SubdistrictRef;
}

export type Subdistrict = SubdistrictRef;
export type Village = VillageRef;

// A SUM of village-level `village_populations` rows, never the
// kecamatan's own official population — see
// docs/DATABASE_SCHEMA.md §6c-6e and GeoService.getSubdistrictPopulationAggregate.
// `coveredVillages < totalVillages` means partial coverage; UI code must
// show `coveragePercentage` and never present `totalPopulation` as
// complete when `isComplete` is false.
export interface SubdistrictPopulationAggregate {
  subdistrictId: string;
  subdistrictName: string;
  totalVillages: number;
  sourceName: string | null;
  periodStatus: PopulationPeriodStatus | null;
  periodYear: number | null;
  coveredVillages: number;
  villagesWithTotalPopulation: number;
  coveragePercentage: number;
  isComplete: boolean;
  totalPopulation: number | null;
  male: number | null;
  female: number | null;
  households: number | null;
  otherGroupsAvailable: number;
}

// GET /hazard-events/:id/affected-population — a SUM of kelurahan/desa
// population for villages whose reference point lies within the event's
// hazard radius, never a kabupaten/kota figure. `villagesWithPopulation <
// totalVillages` means partial coverage: show `coveragePercentage`, never
// present `totalPopulation` as complete.
export interface AffectedPopulationEstimate {
  hazardEventId: string;
  radiusKm: number;
  totalVillages: number;
  villagesWithPopulation: number;
  coveragePercentage: number;
  totalPopulation: number | null;
  sourceName: string | null;
  periodYear: number | null;
  nearestVillages: Array<{
    villageId: string;
    name: string;
    subdistrictName: string;
    districtName: string;
    distanceKm: number;
    population: number | null;
  }>;
}

export interface DistrictRef {
  id: string;
  bpsCode: string;
  codeSystem: RegionCodeSystem;
  administrativeLevel: AdministrativeLevel;
  name: string;
  areaKm2: number | null;
  // A single reference point (GeoNames ADM2 dump, see reference-data.seed.ts)
  // — NOT a polygon boundary. Never render this as if it were the
  // district's border.
  geom: { type: 'Point'; coordinates: [number, number] } | null;
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
  // Per-event heuristic estimate scoped to this `district` (kabupaten/kota)
  // — distinct from that district's `PopulationStatistic.totalPopulation`.
  // null means the estimate is unavailable (e.g. assessment still pending
  // or failed), never "zero people affected" — render as unknown, not 0.
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
  hazardEventId?: string;
  riskAssessmentId?: string;
  planType: string;
  planDetails: Record<string, unknown>;
  estimatedPersonnelNeeded?: number;
}

/** `posko`: staffed shelter/command post; `assembly_point`: titik kumpul. */
export type ShelterKind = 'posko' | 'assembly_point';

export interface Shelter {
  id: string;
  name: string;
  kind: ShelterKind;
  /** Optional flat coordinates; the API sends `geom` — use shelterLatLng(). */
  latitude?: number;
  longitude?: number;
  geom?: { type: 'Point'; coordinates: [number, number] } | null;
  district: DistrictRef;
  capacity: number;
  currentOccupancy: number | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  updatedAt?: string;
}

export interface ShelterInput {
  districtId: string;
  name: string;
  kind: ShelterKind;
  latitude: number;
  longitude: number;
  capacity: number;
  currentOccupancy: number;
  address: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  isActive: boolean;
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
  regionCode: string;
  administrativeLevel: AdministrativeLevel;
  year: number;
  // Total population of the kabupaten/kota identified by `regionCode`
  // (administrativeLevel is always 'kabupaten_kota' today) — never assume
  // this is the population of a smaller area (an event location, a
  // kecamatan/kelurahan) inside that district; it is only ever context for
  // one, never a per-event figure. Use `RiskAssessment.estimatedAffectedPopulation`
  // for a per-event estimate.
  totalPopulation: number;
  populationDensity: number;
  source: string;
}

// --- Kecamatan/kelurahan population (CSV import) ---------------------------

export type PopulationNumberFormat = 'dot_thousands_separator' | 'dot_decimal_point';
export type PopulationPeriodStatus = 'confirmed' | 'unknown';
export type PopulationImportBatchStatus =
  | 'uploaded'
  | 'validating'
  | 'ready'
  | 'queued'
  | 'importing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';
export type PopulationImportRowStatus =
  | 'valid'
  | 'duplicate_in_file'
  | 'unchanged'
  | 'conflict'
  | 'invalid'
  | 'region_not_found'
  | 'hierarchy_mismatch'
  | 'needs_review'
  | 'imported'
  | 'skipped';

// A village's own imported population — distinct from `PopulationStatistic`
// (kabupaten/kota only). Never assume this exists; a village with no
// imported data has none, which is normal, not an error (see
// useVillagePopulations).
export interface VillagePopulation {
  id: string;
  male: number | null;
  female: number | null;
  totalPopulation: number | null;
  households: number | null;
  densityRaw: string | null;
  densityConverted: number | null;
  numberFormat: PopulationNumberFormat | null;
  reportedDate: string | null;
  periodStatus: PopulationPeriodStatus;
  periodYear: number | null;
  dedupeKey: string;
  sourceName: string;
  sourceReference: string | null;
  createdAt: string;
}

export interface VillagePopulationImportBatch {
  id: string;
  fileName: string;
  fileChecksumSha256: string;
  fileSizeBytes: number;
  hasHeaderRow: boolean;
  numberFormat: PopulationNumberFormat;
  sourceName: string;
  sourceReference: string | null;
  periodStatus: PopulationPeriodStatus;
  periodYear: number | null;
  status: PopulationImportBatchStatus;
  // Checkpoints the workers advance chunk-by-chunk — the only progress
  // signal shown while a job is running (never a fabricated percentage;
  // `totalRows` itself is unknown until the file has been fully read once
  // during validation). `lastValidatedRowNumber` moves during
  // 'validating', `lastImportedRowNumber` moves during 'importing'.
  processedRows: number | null;
  lastValidatedRowNumber: number | null;
  lastImportedRowNumber: number | null;
  totalRows: number | null;
  validRowCount: number | null;
  duplicateInFileCount: number | null;
  unchangedCount: number | null;
  conflictCount: number | null;
  invalidCount: number | null;
  importedCount: number | null;
  skippedCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  validatingStartedAt: string | null;
  readyAt: string | null;
  confirmedAt: string | null;
  importingStartedAt: string | null;
  completedAt: string | null;
}

export type PopulationImportRowResolutionAction = 'accepted' | 'rejected';

export interface VillagePopulationImportRow {
  id: string;
  rowNumber: number;
  rawLine: string;
  rawFields: Record<string, string>;
  kodePum: string | null;
  normalizedCode: string | null;
  matchedVillage: VillageRef | null;
  parsedDateRaw: string | null;
  parsedDate: string | null;
  male: number | null;
  female: number | null;
  totalPopulation: number | null;
  households: number | null;
  densityRaw: string | null;
  densityConverted: number | null;
  status: PopulationImportRowStatus;
  messages: string[];
  dedupeKey: string;
  // Only ever populated for a NEEDS_REVIEW row (hierarchy-fallback match,
  // no Kode PUM supplied) — candidate villages found by name, shown as a
  // convenience when resolving manually; never auto-applied.
  candidateVillageIds: string[] | null;
  // Set only by a human decision via resolveRow — null means nobody has
  // reviewed this row yet (regardless of its status).
  resolutionAction: PopulationImportRowResolutionAction | null;
  resolutionNote: string | null;
  resolvedBy: Pick<User, 'id' | 'email' | 'fullName'> | null;
  resolvedAt: string | null;
  createdAt: string;
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
