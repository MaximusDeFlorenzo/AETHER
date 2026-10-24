export enum HazardType {
  EARTHQUAKE = 'earthquake',
  FLOOD = 'flood',
  LANDSLIDE = 'landslide',
  WILDFIRE = 'wildfire',
}

export enum ExposureLevel {
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  SEVERE = 'severe',
}

export enum RiskAssessmentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum PriorityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum NotificationType {
  NEW_HAZARD_EVENT = 'new_hazard_event',
  HIGH_RISK_ASSESSMENT = 'high_risk_assessment',
  HAZARD_RELATIONSHIP_DETECTED = 'hazard_relationship_detected',
  RESOURCE_PLAN_GENERATED = 'resource_plan_generated',
  SYSTEM = 'system',
}

// Cascading-hazard link semantics (docs/DATABASE_SCHEMA.md §16): 'triggers'
// (e.g. earthquake -> landslide), 'exacerbates' (compounds an existing
// hazard's impact), 'coincides' (correlated but no causal direction implied).
export enum HazardRelationshipType {
  TRIGGERS = 'triggers',
  EXACERBATES = 'exacerbates',
  COINCIDES = 'coincides',
}

// Computer Vision Engine detection categories (docs/DATABASE_SCHEMA.md §22).
export enum CvDetectionType {
  FLOOD = 'flood',
  SMOKE = 'smoke',
  FIRE = 'fire',
  INFRA_DAMAGE = 'infra_damage',
}

// Administrative resolution of a region row. `districts` (kabupaten/kota),
// `subdistricts` (kecamatan) and `villages` (kelurahan/desa) each set this to
// their own fixed level. IMPORTANT — population/area/geometry coverage does
// NOT match code/name coverage: `population_statistics` has rows for
// KABUPATEN_KOTA only (Kemendagri/Dukcapil population registry has no
// kecamatan/kelurahan breakdown available anywhere AETHER has sourced —
// verified 2026-09-22, see docs/DATABASE_SCHEMA.md §5-6b). `subdistricts` and
// `villages` carry real code/name data (Kepmendagri No 300.2.2-2138 Tahun
// 2025) but no population, area or coordinates — every consumer (risk
// engine, resource optimization, dashboards) must keep assuming
// finer-than-kabupaten/kota population is unavailable, not silently derive
// it from a parent district.
export enum AdministrativeLevel {
  KABUPATEN_KOTA = 'kabupaten_kota',
  KECAMATAN = 'kecamatan',
  KELURAHAN_DESA = 'kelurahan_desa',
}

// The numbering scheme a region `code` belongs to. Only KEMENDAGRI exists
// today: every code in `districts`/`subdistricts`/`villages` (including the
// legacy `districts.bps_code` column — misnamed, kept for API/frontend
// backward compatibility, see district.entity.ts) is sourced from
// Kemendagri's administrative code decree (Kepmendagri No 300.2.2-2138 Tahun
// 2025) via github.com/cahyadsn/wilayah, never independently cross-checked
// against BPS's own statistical-area code table. BPS and Kemendagri codes
// have historically diverged after re-numbering/pemekaran events, so no code
// in this codebase may be treated as a BPS code without an explicit,
// verified mapping — add a BPS value here only once such a mapping exists.
export enum RegionCodeSystem {
  KEMENDAGRI = 'kemendagri',
}

export enum HazardEventSource {
  BMKG_AUTOGEMPA = 'bmkg_autogempa',
  BMKG_GEMPATERKINI = 'bmkg_gempaterkini',
  WEATHER_API = 'weather_api',
  NASA_FIRMS = 'nasa_firms',
  LANDSLIDE_RAINFALL_TRIGGER = 'landslide_rainfall_trigger',
  // Never appears as a hazard_events.source value — SentinelAdapter sets
  // producesHazardEvents=false, so its scenes never reach ingestEvent().
  // Listed here for completeness/documentation only.
  SENTINEL = 'sentinel',
  MANUAL = 'manual',
}

// village-population-import module (kecamatan/kelurahan population CSV
// upload, docs/DATABASE_SCHEMA.md §6c-6e).
// UPLOADED: file stored, batch row created, validation job enqueued (or
// about to be) — the HTTP response for the upload returns here, never
// waiting on parsing.
// VALIDATING: a worker is actively streaming/parsing/matching rows.
// READY: validation finished; a preview exists and confirm() is allowed.
// QUEUED: confirm() atomically claimed this batch (READY -> QUEUED, DB CAS —
// see VillagePopulationImportService.confirmBatch) and enqueued the import
// job; a second concurrent confirm() call sees a non-READY status and is
// rejected before it can enqueue anything.
// IMPORTING: the import worker is actively writing chunks.
// COMPLETED: every row that could be imported was, with zero rows left in
// an error/conflict/needs-review state — set ONLY after all DB writes are
// durably committed, never when the job is merely dequeued.
// COMPLETED_WITH_ERRORS: import finished (all chunks committed) but some
// rows were skipped (conflict/invalid/region_not_found/etc.) — a normal,
// honest partial-success outcome, not a failure.
// FAILED: validation or import could not complete at all (e.g. the file
// isn't valid CSV structurally, or retries were exhausted) — see
// `errorMessage`.
export enum PopulationImportBatchStatus {
  UPLOADED = 'uploaded',
  VALIDATING = 'validating',
  READY = 'ready',
  QUEUED = 'queued',
  IMPORTING = 'importing',
  COMPLETED = 'completed',
  COMPLETED_WITH_ERRORS = 'completed_with_errors',
  FAILED = 'failed',
}

export enum PopulationImportRowStatus {
  // Preview-time statuses
  VALID = 'valid',
  DUPLICATE_IN_FILE = 'duplicate_in_file',
  UNCHANGED = 'unchanged',
  CONFLICT = 'conflict',
  INVALID = 'invalid',
  REGION_NOT_FOUND = 'region_not_found',
  HIERARCHY_MISMATCH = 'hierarchy_mismatch',
  // Kode PUM absent — matched (0, 1, or many candidates) via the full
  // provinsi/kabupaten/kecamatan/desa hierarchy instead. Never auto-imported
  // even with exactly one candidate — "jangan melakukan fuzzy matching
  // otomatis tanpa verifikasi" — the candidate list is surfaced for a human
  // to confirm.
  NEEDS_REVIEW = 'needs_review',
  // Confirm-time terminal statuses (a VALID/UNCHANGED/CONFLICT/etc. row is
  // re-evaluated at confirm time — see VillagePopulationImportService
  // .confirmBatch — and lands on exactly one of these two)
  IMPORTED = 'imported',
  SKIPPED = 'skipped',
}

// A human (admin/analyst) reviewing a HIERARCHY_MISMATCH / REGION_NOT_FOUND
// / NEEDS_REVIEW row — see VillagePopulationImportService.resolveRow.
// ACCEPTED flips the row to VALID (so it flows through the exact same
// import path as any other valid row); REJECTED leaves its status
// unchanged (still excluded from import) but records that a human looked
// at it, so it isn't re-surfaced as "never reviewed". Never set
// automatically — this enum only ever has a non-null value because a
// specific user made a specific choice, which `resolvedBy`/`resolvedAt`
// on the row record.
export enum PopulationImportRowResolutionAction {
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

// "26.000" is genuinely ambiguous (26000 with '.' as thousands separator vs
// 26 with '.' as a decimal point truncated to 3dp) — no default is assumed;
// the uploader must pick one explicitly (see docs/DATABASE_SCHEMA.md §6c).
export enum PopulationNumberFormat {
  DOT_THOUSANDS_SEPARATOR = 'dot_thousands_separator',
  DOT_DECIMAL_POINT = 'dot_decimal_point',
}

// Whether a VillagePopulation row's statistical period is a user-confirmed
// year or explicitly unknown — never inferred from the CSV's per-row
// "Tanggal" (report date) or from the upload date. See
// VillagePopulation.dedupeKey for why this can't just be a nullable year.
export enum PopulationPeriodStatus {
  CONFIRMED = 'confirmed',
  UNKNOWN = 'unknown',
}
