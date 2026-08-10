# AETHER — API Specification

Two contracts, same as ORION: (1) **Public API** — `apps/web` ↔ `apps/api`,
JWT-authenticated. (2) **Internal API** — `apps/api` ↔ `apps/ai-engine`,
service-token-authenticated.

Base URL (dev): `http://localhost:4000/api/v1` (`apps/api`) and
`http://localhost:8000` (`apps/ai-engine`, internal network only).

Auth header (public API): `Authorization: Bearer <accessToken>`
Auth header (internal API): `X-Internal-Token: <shared secret>`

List envelope: `{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 137 } }`
Error envelope: `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`

---

## 1. Auth (unchanged from ORION)

`POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` —
identical shapes to ORION's `docs/API_SPEC.md` §1.

## 2. Users (Admin only) — unchanged from ORION

`GET/POST /users`, `PATCH /users/:id`, `DELETE /users/:id` (deactivate),
`PATCH /users/me/password`.

## 3. Hazard Events

### `GET /hazard-events`
Roles: any authenticated (public read on `(public)` routes is unauthenticated —
see §8 for the guard posture).
Query: `hazardType` (`earthquake|flood|landslide|wildfire`), `minSeverity`,
`from`, `to`, `province`, `page`, `limit`.
Response item:
```json
{
  "id": "uuid",
  "hazardType": "earthquake",
  "latitude": -7.5, "longitude": 110.2,
  "locationLabel": "12 km Barat Daya Bantul",
  "region": "DIY",
  "eventTime": "2026-07-04T03:12:00Z",
  "source": "bmkg_autogempa",
  "details": { "magnitude": 6.8, "depthKm": 10.0, "potentialTsunami": false }
}
```
`details` shape varies by `hazardType` (matches the relevant `*_details` table).

### `POST /hazard-events/:source/sync`
Roles: `admin`, `agency_operator`. Manual ingestion trigger, generalizes ORION's
`POST /earthquakes/sync`.

### `GET /hazard-events/:id/relationships`
Returns linked `hazard_relationships` rows (cascading hazards) for an event.

### `POST /hazard-events/manual`
Roles: `admin`, `agency_operator`, `field_reporter`. Ground-truth reporting
path — same validate/dedupe/persist/resolve-regions/detect-relationships
pipeline as adapter-sourced events, for any `hazardType`.

## 3a. Field Reports (Computer Vision)

New in AETHER — no ORION equivalent. Citizen/field-reporter photo submission
against the Computer Vision Engine; results are `cv_detections` rows.

### `POST /field-reports`
Roles: `field_reporter`, `admin`, `agency_operator`. `multipart/form-data`:
`image` (file, JPEG/PNG/WebP, max 10MB), `hazardTypeHint` (optional
`HazardType` — narrows which of the four CV detectors run), `latitude`,
`longitude`, `notes` (all optional). Response:
```json
{ "detections": [
  { "id": "uuid", "detectionType": "fire",
    "boundingBoxes": [{ "xMin": 0.12, "yMin": 0.30, "xMax": 0.55, "yMax": 0.71 }],
    "confidenceScore": 0.82, "createdAt": "..." }
] }
```
An empty `detections` array is a normal outcome (photo processed, nothing
detected), not an error.

### `GET /field-reports`, `GET /field-reports/:id`
Roles: `admin`, `agency_operator`, `analyst`. Review queue — list/detail of
`cv_detections`, each with a time-limited signed `imageUrl` for the
underlying photo.

### `PATCH /field-reports/:id/link`
Roles: `admin`, `agency_operator`, `analyst`. Body: `{ "hazardEventId": "uuid" }`.
Promotes a detection to corroborating evidence for a concrete hazard event —
the human-review step `cv_detections.hazard_event_id`'s nullability was
designed for.

## 4. Risk Assessments (replaces Predictions)

### `GET /risk-assessments`
Query: `hazardType`, `district`, `minRiskScore`, `baseline` (bool — filter to
`hazard_event_id IS NULL` standing assessments), `page`, `limit`.

### `GET /risk-assessments/:id`
Full assessment incl. `inputSnapshot` for auditability.

## 5. Decision Intelligence (replaces Recommendations)

### `GET /decision-recommendations`
Query: `priorityLevel`, `hazardType`, `page`, `limit`. Response mirrors ORION's
recommendation shape: `priorityLevel`, `priorityScore`, `confidenceScore`,
`summaryText`, `reasons[]`, plus new `actionRecommendation`.

## 6. Spatial Intelligence

### `GET /spatial/overlay`
Query: `layer` (`risk|vulnerability|exposure`), `hazardType`, `bbox`. Returns a
GeoJSON `FeatureCollection` — the endpoint ORION never had (it only ever served
point data, never polygon overlays).

## 7. Resource Optimization

`GET /resource-optimization-plans`, `POST /resource-optimization-plans` (agency
operator+), `GET /shelters`, `POST /shelters` (admin).

## 8. Sustainability

### `GET /sustainability-metrics`
Query: `district`, `periodStart`, `periodEnd`. Returns SDG indicators, climate
resilience score, carbon reduction estimate, protected population, response
efficiency score — public, no auth required (this is a public accountability
dashboard, same posture as ORION's public command-center dashboard).

## 9. Historical, Geo (Provinces/Districts/Population), Audit

Unchanged in shape from ORION's `historical/`, `population/`
(`provinces`/`districts`), `audit-logs` endpoints — only `historical_disasters`
gains a `hazardType` filter param.

---

## Auth guard posture

Same per-endpoint (not global) `JwtAuthGuard`/`RolesGuard` pattern as ORION:
- **No guard**: `/auth/login`, `/auth/refresh`, `/health`, all `GET` routes
  (`/hazard-events`, `/spatial/overlay`, `/sustainability-metrics`,
  `/risk-assessments`, `/decision-recommendations`, `/audit-logs`,
  `/resource-optimization-plans`, `/shelters`, etc.) — every *read* is public
  risk-intelligence surface. Only mutating routes (`POST`/`PATCH`/`DELETE`)
  are guarded.
- **`JwtAuthGuard` + `@Roles('admin','agency_operator')`**: sync triggers,
  resource-plan/shelter writes, historical-disaster CRUD.
- **`JwtAuthGuard` + `@Roles('admin')`**: user management, audit logs.

## Internal API (`apps/api` → `apps/ai-engine`)

`POST /predict-risk` (hazard-agnostic — `hazardEvent.hazardType` selects the
heuristic; earthquake/landslide/flood/wildfire all implemented), `POST
/calculate-priority`, `POST /generate-recommendation`, `POST /detect-relationships`
(Spatial Intelligence Engine cascading check), `POST /optimize-resources`,
`POST /detect-cv`. All gated by `verify_internal_token`, same as AI-ORION.

### `POST /detect-cv`
Body: `{ "imageBase64": "...", "categories": ["fire","smoke"] }` (`categories`
optional — omitted runs all four: `flood|smoke|fire|infra_damage`). Response:
`{ "detections": [{ "detectionType", "boundingBoxes": [{"xMin","yMin","xMax","yMax"}],
"confidenceScore" }], "modelVersion" }`. Classical color/texture heuristics,
not a trained model — see `apps/ai-engine/app/ml/computer_vision/` module
docstrings for each detector's method and known false-positive modes.
`apps/api`'s `field-reports` module is the only current caller.
