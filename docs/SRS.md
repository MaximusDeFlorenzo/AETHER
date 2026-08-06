# Software Requirements Specification (SRS)
## AETHER — Adaptive Environmental Threat & Hazard Evaluation for Resilience

**Version:** 1.0
**Source:** Reuses ORION's proven infrastructure patterns; picks up exactly
where ORION's own SRS (`../Orion/docs/SRS.md` §9 "Deferred/Out-of-Scope") left
off, as a separate, independently-scoped product.

---

## 1. Purpose and Scoping Decision

ORION was deliberately narrowed to an earthquake-only, response-focused command
center. Its SRS explicitly deferred: Flood/Landslide, Computer Vision damage
detection, Spatial routing/isolation, Resource Optimization, Sentinel imagery,
and a generic multi-hazard data model. AETHER builds that deferred vision, with
a different mission: **prediction and prevention** (standing risk intelligence
for regions, continuously scored) rather than **reactive response coordination**
(score only after an event fires).

| Dimension | ORION | AETHER |
|---|---|---|
| Hazards | Earthquake only | Earthquake, Flood, Landslide, Forest Fire |
| Posture | Reactive (event → recommendation) | Predictive (standing risk + event-triggered) |
| Data sources | BMKG, BNPB, BPS | + OSM, Weather/Rainfall APIs, NASA FIRMS, Sentinel (stub — not implemented), IoT/drone (future) |
| AI engines | Impact prediction + priority + XAI | 5 engines: Hazard Prediction, Computer Vision, Spatial Intelligence, Decision Intelligence, Resource Optimization |
| Hazard relationships | N/A (single hazard) | Explicit `hazard_relationships` modeling (cascading events) |

**Build phasing** (locked in during architecture review):
- **Phase 1**: Earthquake + Landslide — the cascading pair, reuses the most
  from ORION's earthquake pipeline.
- **Phase 2**: Flood + Forest Fire — new CV/satellite/rainfall ingestion.
  **Shipped**, with two scope narrowings: the Computer Vision Engine is a
  classical color/texture heuristic rather than a trained model (no labeled
  disaster-imagery dataset exists yet — same v0-baseline posture as every
  Phase 1 hazard predictor), and the Sentinel imagery adapter is a
  structural stub (Sentinel Hub's OAuth2 + tile pipeline is disproportionate
  for a source nothing downstream consumes yet).

Everything below is written against the full 4-hazard vision; Phase 1/Phase 2
tags mark what shipped when.

---

## 2. System Overview

AETHER is a **Risk Intelligence platform** (public-facing risk map +
sustainability accountability dashboard, plus a restricted analyst/agency
workspace) — not a command center. Its core loop is standing risk assessment
per region, continuously updated, with event-triggered assessments layered on
top when a hazard actually occurs.

### 2.1 Operational Flow — event-triggered path

1. An external source (BMKG for earthquake; seeded/manual for landslide;
   Weather/Rainfall API for flood; NASA FIRMS for wildfire) reports a hazard
   occurrence.
2. `apps/api`'s ingestion adapter validates, dedupes, and stores it as a
   `hazard_events` row + hazard-specific `*_details` row.
3. Spatial Intelligence Engine resolves affected districts (`ST_DWithin`) and
   checks for cascading relationships with recent nearby events of a different
   hazard type.
4. Hazard Prediction Engine computes a risk score per affected district.
5. Decision Intelligence Engine computes priority + structured XAI reasons
   (including cascading-hazard factors, if any).
6. If risk crosses a threshold, Resource Optimization Engine drafts an
   evacuation/shelter/logistics plan.
7. Results persist (`risk_assessments`, `decision_recommendations`,
   `resource_optimization_plans`) and push to the dashboard via WebSocket.

### 2.2 Operational Flow — standing/baseline path (new vs. ORION)

A scheduler periodically triggers the Hazard Prediction Engine per
district/hazard-type combination even with no active event, producing a
`risk_assessments` row with `hazard_event_id = NULL`. This is what lets AETHER
answer "how at-risk is this region right now" before anything happens — the
product's prediction/prevention differentiator.

### 2.3 Repository / Service Boundaries

- **`apps/web`** — Risk Intelligence Portal. Talks only to `apps/api`.
- **`apps/api`** — system of record. Owns PostgreSQL/PostGIS, Redis, auth, all
  external integrations, WebSocket gateway. Calls `apps/ai-engine` for
  inference only.
- **`apps/ai-engine`** — stateless inference, 5 internal engines behind one
  service. No DB access, no end-user auth (internal service token only).

---

## 3. Actors and Roles

| Role | Description | Key permissions |
|---|---|---|
| **Admin** | System administrator | Full access |
| **Agency Operator** | Manages historical records, resource/shelter plans | CRUD historical_disasters, resource plans, shelters |
| **Analyst** | Reviews risk assessments, decisions, sustainability metrics | Read-only |
| **Field Reporter** | Submits ground-truth reports/CV imagery | Create CV detection reports |

JWT access+refresh with rotation-on-use, `RolesGuard`+`@Roles()` per-endpoint —
identical mechanism to ORION.

---

## 4. Functional Requirements (all four hazard types: Earthquake, Landslide, Flood, Wildfire)

### FR-1 Auth & Authorization — identical to ORION FR-1.1–1.5.

### FR-2 Hazard Ingestion
- FR-2.1 Pluggable `HazardDataSourceAdapter` registry; each adapter owns its own
  poll/fetch schedule and `data_source_syncs` status row.
- FR-2.2 Earthquake adapter reuses ORION's BMKG poll/validate/dedupe pattern.
- FR-2.3 Landslide events are seeded/manually entered pending a live
  sensor/rainfall-trigger feed (documented assumption, same posture ORION took
  for BNPB/BPS).
- FR-2.4 New hazard events trigger the risk pipeline (FR-4) asynchronously and
  broadcast over the relevant WebSocket namespace.
- FR-2.5 Flood events ingest from a live Weather/Rainfall API adapter;
  wildfire events ingest from a live NASA FIRMS hotspot adapter. Both are
  real, network-connected adapters (not seeded), same posture as BMKG.
- FR-2.6 Citizen/field-reporter photo submissions (`POST /field-reports`)
  run through the Computer Vision Engine and persist as `cv_detections`,
  independent of the adapter-poll ingestion path — a human reviewer may
  later promote a detection to a concrete hazard event.

### FR-3 Spatial Intelligence
- FR-3.1 Resolve affected districts via `ST_DWithin` given an epicenter/point
  and hazard-appropriate radius.
- FR-3.2 Detect cascading relationships: a new event within a correlation
  window/radius of a recent event of a different hazard type is written to
  `hazard_relationships` with a `relationship_type` and `confidence_score`.
- FR-3.3 Serve GeoJSON overlays (`GET /spatial/overlay`) for risk/vulnerability/
  exposure zones — capability ORION never built.

### FR-4 Risk Assessment
- FR-4.1 Event-triggered: assemble hazard + district + historical context,
  call Hazard Prediction Engine, persist `risk_assessments`.
- FR-4.2 Standing/baseline: scheduler periodically scores every district per
  hazard type with no active event, `hazard_event_id = NULL`.
- FR-4.3 If `apps/ai-engine` is unreachable, the hazard event stays visible;
  assessment is marked `failed` and retried with backoff (same NFR as ORION).

### FR-5 Decision Intelligence
- FR-5.1 Every `risk_assessments` row yields exactly one
  `decision_recommendations` row: priority level/score, confidence, structured
  `reasons[]` (never a free-text blob — same discipline as ORION's XAI).
- FR-5.2 Reasons include cascading-hazard factors when `hazard_relationships`
  rows exist for the triggering event.

### FR-6 Resource Optimization
- FR-6.1 When priority crosses a configurable threshold, draft a
  `resource_optimization_plans` row (evacuation/shelter/logistics).
- FR-6.2 Shelter capacity/occupancy tracked in `shelters`.

### FR-7 Sustainability Dashboard
- FR-7.1 Public, unauthenticated `GET /sustainability-metrics` per
  district/period: SDG indicators, climate resilience score, carbon reduction
  estimate, protected population, response efficiency.

### FR-8 Notification Module — same mechanism as ORION (EventEmitter2 →
Redis pub/sub → WebSocket, in-app persisted notifications), generalized event
types.

### FR-9 Dashboard & Visualization
- FR-9.1 Multi-hazard map with a type filter (new — ORION's map never needed
  one), point markers colored/sized by severity, polygon overlay layer toggle.
- FR-9.2 Decision Intelligence panel (generalizes ORION's AI Recommendation
  panel).
- FR-9.3 Sustainability Dashboard page — new.

### FR-10 Audit Logging — identical mechanism to ORION.

---

## 5. Non-Functional Requirements

Same discipline as ORION: JWT+RBAC everywhere, DTO/Pydantic validation on
every endpoint, no secrets in source control, structured logging, auditability
(`input_snapshot` on every risk assessment), i18n-ready (English ships first).
**New NFR**: CI/CD is real from day one (ORION documented but never
implemented it) — GitHub Actions lint/test/build per app, gating merges.

---

## 6. External Data Source Assumptions

| Source | Access method | Notes |
|---|---|---|
| **BMKG** | Public JSON feeds (reused from ORION) | Same graceful-degradation requirement. |
| **Landslide triggers** | Seeded/manual entry | No single stable public real-time feed exists yet; live rainfall/soil-sensor integration remains a future candidate once a source is validated. |
| **Weather/Rainfall API (flood)** | Configurable REST+API-key (`WEATHER_API_BASE_URL`/`WEATHER_API_KEY`) | Requires a water-level-reporting feed, not a generic rainfall-only weather API — `FloodDetails` needs both to score risk. |
| **NASA FIRMS (wildfire)** | Public Area API, `MAP_KEY` auth | v0 treats each hotspot detection as its own wildfire event rather than spatially clustering same-pass detections. |
| **BNPB/BPS** | Seed + authenticated CRUD (reused from ORION) | Same assumption ORION documented. |
| **Sentinel imagery** | Not implemented (stub) | Requires Sentinel Hub OAuth2 + tile-processing pipeline; deferred until the CV Engine has a concrete satellite-imagery consumer. |
| **OSM** | Reference data | Spatial reference/routing, unchanged. |

---

## 7. Deferred / Out-of-Scope

Sentinel imagery ingestion, standing/baseline risk scoring without a
concrete event (§4 FR-4.2's scheduler runs but currently skips every
attempt — no "typical conditions per hazard type per district" data source
exists to synthesize a valid AI-engine input from), IoT sensor integration,
drone imagery, What-if simulation — explicitly not silently dropped (same
discipline ORION used for its own deferred scope).

---

## 8. Glossary

Same base glossary as ORION (BMKG/BNPB/BPS/XAI), plus:
- **Hazard Relationship** — a modeled cascading/coincident link between two
  `hazard_events` of different types (e.g. earthquake → triggered landslide).
- **Standing/Baseline Risk Assessment** — a `risk_assessments` row with no
  triggering event, produced by periodic scoring; the core prediction/
  prevention mechanism distinguishing AETHER from ORION.
