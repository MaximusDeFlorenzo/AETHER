# Migration Strategy from ORION Concepts

ORION (`/Users/digitalexperience/Orion/`) is never modified. This document maps
every ORION concept to its AETHER treatment: **reuse** (copy near-verbatim),
**refactor** (adapt structure, generalize a field/FK), **redesign** (new shape,
same underlying pattern), or **discard/new** (ORION never had this).

| ORION concept | Location in ORION | AETHER action | Result |
|---|---|---|---|
| Auth (JWT rotation, guards, strategies) | `API-ORION/src/auth/` | **Reuse** | `apps/api/src/auth/` |
| Users/Roles | `API-ORION/src/users/`, `src/database/entities/{user,role}.entity.ts` | **Reuse** | Same, role *names* changed (see below) |
| Refresh tokens | `src/database/entities/refresh-token.entity.ts` | **Reuse** verbatim | Same table |
| Audit logs | `API-ORION/src/audit/` | **Reuse** verbatim | Same table/module |
| Redis cache (`CacheService.getOrSet`) | `API-ORION/src/redis/cache.service.ts` | **Reuse** verbatim | Same module |
| Notifications + Redis pub/sub escalation | `API-ORION/src/notifications/` | **Refactor** | Generic `related_hazard_event_id` FK |
| WebSocket gateways (namespace + handshake-JWT) | `API-ORION/src/websocket/` | **Refactor** | Namespace per hazard type + dashboard |
| `env.validation.ts` fail-fast pattern | `API-ORION/src/config/env.validation.ts` | **Reuse pattern** | New env schema, same `class-validator` approach |
| `earthquakes` table + module | `src/database/entities/earthquake.entity.ts`, `API-ORION/src/earthquakes/` | **Redesign** | `hazard_events` + `earthquake_details` + `earthquake/` sub-module |
| `earthquake_affected_districts` | `earthquake-affected-district.entity.ts` | **Redesign** | `hazard_affected_regions` (generic FK) |
| `historical_disasters` (BNPB) | `historical-disaster.entity.ts`, `API-ORION/src/historical/` | **Refactor** | Add `hazard_type` column |
| `provinces`/`districts`/`population_statistics` | `population/`, `district.entity.ts`, etc. | **Reuse** near-verbatim | Renamed module to `geo/` |
| `predictions` | `prediction.entity.ts`, `API-ORION/src/predictions/` | **Redesign** | `risk_assessments` — adds nullable `hazard_event_id` for standing/baseline scoring |
| `recommendations` | `recommendation.entity.ts`, `API-ORION/src/recommendations/` | **Redesign** | `decision_recommendations` — same `reasons[]` XAI shape, cascading-aware |
| `hospitals` + `resource_estimates` | `hospital.entity.ts`, `resource-estimate.entity.ts`, `API-ORION/src/hospitals/` | **Refactor/evolve** | `resource_optimization_plans` + `shelters` |
| `bmkg.client.ts`/`bmkg.mapper.ts` adapter shape | `API-ORION/src/earthquakes/bmkg/` | **Reuse pattern** | `HazardDataSourceAdapter` interface + registry; BMKG becomes the first concrete adapter |
| `hospitals.scheduler.ts`/`hospital-sync.service.ts` sync-tracking pattern | `API-ORION/src/hospitals/` | **Reuse pattern** | `data_source_syncs` table, generalized to every adapter |
| `ai/ai-orchestration.service.ts` + `ai.client.ts` | `API-ORION/src/ai/` | **Redesign** | `risk-engine-orchestration/` — dispatches by `hazardType` to the right AI-engine router(s) |
| `impact_model.py` (heuristic-first, swappable `predict()`) | `AI-ORION/app/ml/impact_model.py` | **Reuse pattern, redesign content** | One heuristic module per hazard in `hazard_prediction/` |
| `priority_scorer.py` + `explainability.py` (reasons-with-weight XAI) | `AI-ORION/app/ml/` | **Reuse pattern, redesign content** | `decision_intelligence/` router, now cascading-aware |
| `resource_estimator.py` | `AI-ORION/app/ml/resource_estimator.py` | **Reuse pattern, redesign content** | `resource_optimization/` router |
| `verify_internal_token` FastAPI dependency | `AI-ORION/app/core/security.py` | **Reuse** verbatim | Same pattern in `apps/ai-engine/app/core/security.py` |
| Frontend: App Router public/protected route-group split + shells | `ORION/src/app/(command-center)/`, `admin/` | **Reuse** near-verbatim | `(public)/` + `(workspace)/` + `admin/` |
| Frontend: React Query one-hook-per-resource + Zustand auth/UI split | `ORION/src/hooks/`, `src/stores/` | **Reuse** near-verbatim | Same convention |
| Frontend: axios silent-refresh interceptor | `ORION/src/lib/api-client.ts` | **Reuse** verbatim | Same module |
| Frontend: Socket.IO namespace-cache + `use-realtime-sync` bridge | `ORION/src/lib/websocket.ts`, `src/hooks/use-realtime-sync.ts` | **Reuse** verbatim pattern | Same bridge, generalized event names |
| Frontend: Leaflet map + dynamic-import-`ssr:false` | `ORION/src/components/map/` | **Reuse pattern, extend** | Add hazard-type filter + GeoJSON polygon layer (new) |
| Frontend: shadcn/ui + OKLCH theming + `chart-colors.ts` | `ORION/src/components/ui/`, `src/app/globals.css`, `src/lib/chart-colors.ts` | **Reuse** near-verbatim | Extend with `hazardTypeToColor`/`riskLevelToColor` |
| Frontend: badges (`PriorityBadge`, `MagnitudeBadge`) | `ORION/src/components/shared/` | **Refactor** | `HazardTypeBadge`, `RiskLevelBadge` (generalized) |
| Frontend: `command-band.tsx` KPI hero | `ORION/src/components/dashboard/command-band.tsx` | **Reuse** verbatim | Already hazard-agnostic (prop-driven) |

## Discard-from-ORION / build new (ORION's own deferred scope)

These did not exist in ORION at all — building them is exactly AETHER's mandate,
not a migration:

- Computer Vision Engine (flood/smoke/fire/infra-damage detection)
- Spatial Intelligence's overlay/exposure/vulnerability-mapping logic and
  GeoJSON polygon map layer
- `hazard_relationships` cascading-hazard detection
- Standing/baseline risk scoring (event-independent)
- Sustainability Dashboard + `sustainability_metrics`
- Multi-source ingestion beyond BMKG — Weather/Rainfall and NASA FIRMS shipped
  as real adapters; Sentinel remains a structural stub (OAuth2 + imagery-tile
  pipeline deferred, nothing downstream consumes tiles yet); OSM is reference
  data only.
- Storage abstraction (`storage/` module, S3/MinIO) — ORION never needed binary
  asset storage; AETHER's CV Engine does.
- Real CI/CD (`.github/workflows/`) — ORION documented this as a goal but never
  implemented it.
- `packages/contracts` shared-types codegen — replaces ORION's hand-maintained
  matching-types-per-repo approach, enabled by the monorepo decision.

## Explicitly discarded

- ORION's single-hazard hardwiring in module boundaries (`earthquakes` as the
  only table) — ORION's own `docs/ARCHITECTURE.md` §5 flagged this as the first
  thing to change if a second hazard were ever added. AETHER changes it.
- ORION's polyrepo-with-hand-synced-types trade-off — no longer needed once
  everything lives in one repo with one CI pipeline.
