# AETHER — System Architecture

Baseline: `docs/SRS.md`. Monorepo, three apps, one logical system — same
three-tier separation ORION proved, restructured to remove ORION's polyrepo
hand-synced-types debt.

---

## 1. High-Level Architecture

```mermaid
flowchart LR
    subgraph Ext["External Data Sources"]
        BMKG["BMKG (seismic)"]
        RAIN["Weather/Rainfall API"]
        FIRMS["NASA FIRMS"]
        SENT["Sentinel imagery (stub — not implemented)"]
        OSM["OpenStreetMap"]
        BNPB["BNPB historical"]
        BPS["BPS population/admin"]
    end

    subgraph WEB["apps/web (Next.js 15)"]
        PUB["Public Risk Map + Sustainability Dashboard"]
        WORK["Analyst/Agency Workspace"]
    end

    subgraph API["apps/api (NestJS)"]
        ING["Ingestion Adapter Registry"]
        GEO["Hazard Event Store (PostGIS)"]
        ORCH["Risk Engine Orchestration"]
        WS["WebSocket Gateways"]
        PG[("PostgreSQL + PostGIS")]
        RD[("Redis: cache + pub/sub")]
    end

    subgraph AI["apps/ai-engine (FastAPI)"]
        PRED["Hazard Prediction Engine"]
        SPAT["Spatial Intelligence Engine"]
        DEC["Decision Intelligence Engine"]
        RES["Resource Optimization Engine"]
        CV["Computer Vision Engine"]
    end

    BMKG -->|poll| ING
    RAIN -->|poll| ING
    FIRMS -->|poll| ING
    SENT -.stub, not implemented.-> ING
    OSM -->|reference data| ING
    BNPB -.seed/CRUD.-> PG
    BPS -.seed/CRUD.-> PG
    ING --> GEO

    WEB <-->|REST| API
    WEB <-->|WebSocket| WS
    API --> PG
    API --> RD
    API --> STOR[("Storage: S3/MinIO")]
    WS --> RD
    ORCH --> PG
    API --> ORCH
    ORCH -->|internal REST + service token| AI
    PRED --> ORCH
    SPAT --> ORCH
    DEC --> ORCH
    RES --> ORCH
    CV --> ORCH
```

**Invariants (carried over from ORION, do not weaken):**
- `apps/web` never calls `apps/ai-engine` directly — only `apps/api` does.
- `apps/ai-engine` never touches Postgres/Redis directly — stateless, pure
  function of the payload it's given.
- `apps/api` is the only service with external network egress.
- Auth boundary: end-user JWT validated only in `apps/api`. The
  `api → ai-engine` hop is secured by a separate static internal service token,
  not the user's JWT.

---

## 2. Sequence Diagrams

### 2.1 Hazard pipeline: event ingestion → decision recommendation

```mermaid
sequenceDiagram
    participant Src as External Source (e.g. BMKG)
    participant Ing as Ingestion Adapter
    participant HE as Hazard Events Module
    participant Spat as Spatial Intelligence Engine
    participant Pred as Hazard Prediction Engine
    participant Dec as Decision Intelligence Engine
    participant DB as PostgreSQL
    participant WS as WebSocket Gateway
    participant UI as apps/web

    Src->>Ing: poll / receive event
    Ing->>HE: validate + dedupe + normalize
    HE->>DB: INSERT hazard_events (+ *_details)
    HE->>Spat: resolve affected regions (ST_DWithin)
    Spat-->>HE: nearby district_ids[]
    HE->>DB: INSERT hazard_affected_regions
    Spat->>DB: check hazard_relationships (cascading?)
    HE->>WS: emit hazard_event.created
    WS-->>UI: push (map marker appears)

    par per affected district
        HE->>Pred: dispatch(hazard_event, district_id)
        Pred-->>HE: risk_score, exposure_level, confidence
        HE->>Dec: risk score + context
        Dec-->>HE: priority_level, reasons[], summary
        HE->>DB: INSERT risk_assessments, decision_recommendations
        HE->>WS: emit decision_recommendation.created
        WS-->>UI: push (decision panel updates)
    end

    Note over HE,Dec: If apps/ai-engine is unreachable, the hazard event stays<br/>visible; risk_assessment is marked status=failed and retried<br/>with backoff — ingestion is never blocked by engine downtime.
```

### 2.2 Standing/baseline risk scoring (the prediction/prevention differentiator)

```mermaid
sequenceDiagram
    participant Sched as Scheduler
    participant Pred as Hazard Prediction Engine
    participant Dec as Decision Intelligence Engine
    participant DB as PostgreSQL

    Sched->>Pred: periodic baseline risk scan (no active event)
    Pred-->>Sched: risk_score per district per hazard_type
    Sched->>Dec: contextualize (historical + vulnerability indicators)
    Dec-->>Sched: priority_level, reasons[]
    Sched->>DB: INSERT risk_assessments (hazard_event_id = NULL)
```

This is the pipeline ORION never had — it never scored risk without an active
BMKG event. It's what makes AETHER a prediction/prevention platform rather than
a reactive one.

### 2.3 Auth flow (unchanged from ORION)

Login + refresh-rotation flow, JWT access (15m, in-memory)/refresh (7d, httpOnly
cookie) — identical pattern to ORION's `docs/ARCHITECTURE.md` §2.2.

---

## 3. Repository Layout

```
AETHER/
├─ apps/
│  ├─ web/            Next.js 15 App Router — see FOLDER_STRUCTURE in plan §2
│  ├─ api/             NestJS — modules in §3 below
│  └─ ai-engine/        FastAPI — router-per-engine, see §3 below
├─ packages/
│  ├─ contracts/        Shared TS types generated from apps/api's OpenAPI spec
│  └─ config/           Shared eslint/tsconfig/tailwind presets
├─ docs/
├─ infra/docker-compose.yml
└─ .github/workflows/
```

### 3.1 `apps/api` module list

`auth`, `users`, `roles`, `audit`, `redis`, `storage` (S3/MinIO-compatible,
new infra ORION never needed), `config`, `database` (reused near-verbatim) ·
`geo` (was `population`) · `hazard-events` (+ `earthquake/`, `landslide/`,
`flood/`, `wildfire/` sub-modules, all wired end-to-end) · `field-reports`
(citizen/field-reporter CV submission — new, no ORION equivalent) ·
`ingestion` (adapter registry: `bmkg`, `nasa_firms`, `weather_api` real;
`sentinel` a registered structural stub) · `risk-engine-orchestration` (was
`ai`, now includes `CvEngineClient` alongside `RiskEngineClient`) ·
`risk-assessments` (was `predictions`) · `decision-intelligence` (was
`recommendations`) · `spatial-intelligence` · `resource-optimization` ·
`sustainability` · `notifications` · `websocket` · `dashboard` ·
`village-population-import` (bulk CSV import of kecamatan/kelurahan
population, background-job based — see §3.4) · `queue` (global BullMQ Redis
connection, `@Global`-registered) · `rainfall-intelligence` (hourly
weather history per kabupaten/kota point + rainfall/wind features, rain
nowcasts, a gated Stage-2 spatial nowcast model, rule-based flood- and
landslide-risk baselines and a district outlook with rule-based
recommendations in English and Bahasa Indonesia, shown on the web workspace
page `/rainfall`, plus a historical backtest of the flood/landslide rules
against BNPB DIBI reports over an archived GSMaP_Gauge hourly series — see
`docs/RAINFALL_INTELLIGENCE.md`).

### 3.2 `apps/ai-engine` router list

`hazard_prediction/` (per-hazard heuristic modules — earthquake, landslide,
flood, wildfire) · `spatial_intelligence/` · `decision_intelligence/` ·
`resource_optimization/` · `computer_vision/` (classical color/texture
heuristics — fire, smoke, flood, infra_damage — same v0-heuristic posture as
`hazard_prediction/`, not a trained model).

### 3.3 Local orchestration

`infra/docker-compose.yml` (single file, unlike ORION's parent-directory
compose file, since all apps live in one repo): `postgres` (postgis image),
`redis`, `ai-engine`, `api`, `web`.

### 3.4 Background jobs (BullMQ)

`apps/api`'s only current background-job consumer is
`village-population-import` (bulk CSV upload of kecamatan/kelurahan
population — a 100k-row file parses/matches/writes as two chained BullMQ job
types, not inline in the HTTP request). Introduced specifically because that
feature needed to survive files far larger than an HTTP request timeout
allows; no other module uses this infrastructure yet, but `queue/queue.module.ts`
registers the BullMQ↔Redis connection globally so a future feature can reuse
it by just calling `BullModule.registerQueue()` in its own module.

Two processes can run this work: `apps/api/src/main.ts` (the HTTP API,
`AppModule`) runs job processors in-process by default — the simplest
local-dev setup, one `pnpm run start:dev` — or `apps/api/src/worker.ts`
can run them as an independent process (`pnpm run worker`), with the
API's own copy disabled via `ENABLE_JOB_PROCESSORS=false` so an API
restart/crash never interrupts an in-flight import and vice versa.
`worker.ts` boots its own minimal `WorkerModule`
(`apps/api/src/worker.module.ts`) rather than the full `AppModule` —
verified live (100k-row e2e test) that booting `AppModule` in the worker
process also re-runs every unrelated scheduled service (BMKG/weather/
landslide-trigger polling, risk-engine orchestration, etc.) a second time,
which contended for the same DB connection pool as the import job and
stalled it. Full detail — queue names, status machine,
chunked/checkpointed/resumable processing, configuration —
in `apps/api/README-worker.md` and `docs/DATABASE_SCHEMA.md` §6c.

---

## 4. Cross-app contract strategy

Unlike ORION (no shared package, hand-maintained matching TS types across 3
repos), AETHER generates `packages/contracts` from `apps/api`'s OpenAPI spec
(`openapi-typescript`) as a monorepo build step, consumed by `apps/web`. This
removes the drift risk ORION explicitly accepted as a trade-off for deploy
independence — a trade-off no longer needed once everything lives in one repo
with one CI pipeline gating merges. `apps/ai-engine`'s Pydantic schemas remain
its own source of truth for the `api ↔ ai-engine` contract, same as ORION.

---

## 5. Phase 2 — status

Flood + Forest Fire hazard types are fully wired: real `/predict-risk`
heuristics (`apps/ai-engine/app/ml/hazard_prediction/flood.py`/`wildfire.py`),
persistence through `hazard-events`, cross-hazard relationship rules
(landslide→flood, wildfire→flood, wildfire→landslide), and their own
`spatial-intelligence` proximity radii. The Computer Vision Engine
(`computer_vision/fire.py`/`smoke.py`/`flood.py`/`infra_damage.py`) is a
classical color/texture heuristic — deliberately not a trained model, same
v0-baseline posture as every hazard predictor here, since no labeled
disaster-imagery training set exists yet. The `storage/` module (S3/MinIO,
via `infra/docker-compose.yml`'s `minio`/`minio-init` services) backs both CV
image input and the new `field-reports` citizen-submission flow.

Two deliberate scope narrowings, both revisitable without an architecture
change:
- **NASA FIRMS and Weather/Rainfall adapters are real** (REST+API-key,
  `ingestion/adapters/nasa-firms.adapter.ts` / `weather.adapter.ts`).
  **Sentinel is a structural stub** (`sentinel.adapter.ts` — registered like
  a real adapter, `fetch()` always returns `[]`) — Sentinel Hub's OAuth2 +
  imagery-tile pipeline is disproportionate complexity for a source nothing
  downstream consumes yet.
- Baseline/standing risk scoring (§2.2) synthesizes a "typical conditions"
  input per district and hazard type (`RiskEngineOrchestrationService.
  buildBaselineHazardEventInput()`): the average of the district's own past
  `*_details` rows, else conservative `BASELINE_DEFAULTS`. Flood and
  landslide additionally prefer live stored data — trailing-24 h rainfall
  (GSMaP, then Open-Meteo), the sampled InaRISK flood index and the p90 DEM
  slope — and record which of live / history / default each value came from
  in `input_snapshot.baselineInputSources`. Earthquake and wildfire
  baselines still rest on history/defaults.
- **Region hierarchy reaches kelurahan/desa; population/area/geometry stop at
  kabupaten/kota.** `districts` (kabupaten/kota, 514) → `subdistricts`
  (kecamatan, 7,285) → `villages` (kelurahan/desa, 83,762) is a real,
  FK-chained hierarchy — codes/names for all four levels (provinces too) come
  from Kemendagri's administrative-code decree (Kepmendagri No 300.2.2-2138
  Tahun 2025, via github.com/cahyadsn/wilayah, verified 2026-09-22:
  zero duplicate codes, zero unmapped parents at any level). **Population,
  area and coordinates exist ONLY on `districts`** — no verified source
  (Kemendagri's own population registry included) provides them at
  kecamatan/kelurahan resolution; a targeted search found one official portal
  that does (`prodeskel.binapemdes.kemendagri.go.id`) but it has no documented
  bulk API, so nothing was imported from it (docs/DATABASE_SCHEMA.md §6b).
  `administrative_level` on every region row (docs/DATABASE_SCHEMA.md §5-6b)
  makes this a stored fact, not an assumption.

  Concretely: every risk-engine input, resource optimization estimate, and
  Sustainability Dashboard aggregate stays scoped to kabupaten/kota — nothing
  was extended to kecamatan/kelurahan, because population-driven formulas
  calibrated for a kabupaten/kota cannot be assumed valid at a finer scale
  without re-deriving them, and there is no population data to re-derive them
  against yet. `RiskAssessment.estimatedAffectedPopulation` is a per-event
  heuristic estimate off the kabupaten/kota total (not a finer measurement —
  `hazard_prediction/common.py::estimate_affected_population`), and no code
  duplicates or splits a kabupaten/kota total across sub-regions.
  `apps/web`'s Regions page (`/regions`) supports browsing/searching the full
  hierarchy down to kelurahan/desa, but its detail panel says explicitly, per
  selection, that population is unavailable and assessment is unsupported
  below kabupaten/kota — never silently substitutes the parent's population.
  If a finer-resolution population source is integrated later, the parent
  kabupaten/kota population may only ever be shown as context next to a
  kecamatan/kelurahan assessment, never substituted as if it were that
  assessment's own population.
