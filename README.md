# AETHER — Adaptive Environmental Threat & Hazard Evaluation for Resilience

Indonesia's AI-powered multi-hazard risk intelligence platform. Built on
architectural patterns proven in [ORION](../Orion) (an earthquake-only command
center prototype), but a different product: **prediction and prevention**, not
reactive response coordination. See `docs/ARCHITECTURE.md` for the full picture
and `docs/MIGRATION_FROM_ORION.md` for exactly what was reused vs. redesigned.

## Hazards in scope

Earthquake, Flood, Landslide, Forest Fire — modeled with explicit
**cross-hazard relationships** (e.g. an earthquake that triggers a landslide),
not as independent silos.

## Repository layout (monorepo, pnpm + turborepo)

```
apps/
  web/         Next.js 15 — public risk map + Sustainability Dashboard + analyst workspace
  api/         NestJS — system of record: PostgreSQL/PostGIS, Redis, auth, ingestion, orchestration
  ai-engine/   FastAPI — stateless inference: 5 internal risk engines behind one service
packages/
  contracts/   Shared TS types generated from apps/api's OpenAPI spec
  config/      Shared eslint/tsconfig/tailwind presets
docs/          Design record: SRS, ARCHITECTURE, DATABASE_SCHEMA, API_SPEC, MIGRATION_FROM_ORION
infra/         docker-compose.yml
```

`apps/ai-engine` is Python and sits outside the pnpm/turborepo JS graph — it's
built and run independently (own `Dockerfile`, own `requirements.txt`), wired
in only via `infra/docker-compose.yml`.

## Build phasing

- **Phase 1:** Earthquake + Landslide — the cascading hazard pair, reusing the
  most from ORION's proven earthquake pipeline.
- **Phase 2 (current):** Flood + Forest Fire, real Weather/Rainfall and NASA
  FIRMS ingestion, and a classical-heuristic Computer Vision Engine (fire,
  smoke, flood, infra-damage — not a trained model; see
  `docs/ARCHITECTURE.md` §5). Sentinel imagery ingestion remains a structural
  stub — Sentinel Hub's OAuth2 + tile pipeline is deferred until something
  downstream actually consumes satellite tiles.

## Quick start (Docker Compose)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml exec api pnpm run migration:run
docker compose -f infra/docker-compose.yml exec api pnpm run seed
```

- Frontend: http://localhost:3000
- API: http://localhost:4000/api/v1, Swagger at `/docs`
- AI engine: http://localhost:8000 (internal only, never exposed to the frontend)
- MinIO console: http://localhost:9001 (object storage for CV imagery/field
  reports — credentials in `.env`)

## Local dev (without Docker)

```bash
pnpm install
pnpm dev            # runs apps/web + apps/api via turborepo
cd apps/ai-engine && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
```

## Invariant (do not break)

`apps/web` never calls `apps/ai-engine` directly — only `apps/api` does, over
an internal-service-token-authenticated hop, decoupled from end-user JWT auth.
