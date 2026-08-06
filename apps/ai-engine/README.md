# apps/ai-engine

Stateless FastAPI inference service for AETHER's multi-hazard risk platform.
Five internal engines behind one service — Hazard Prediction, Spatial
Intelligence, Decision Intelligence, Resource Optimization, and Computer
Vision — called only by `apps/api` over the internal API
(`docs/API_SPEC.md`), never by `apps/web` directly (`docs/ARCHITECTURE.md`
§1 "Invariants"). No database access; every response is a pure function of
its request payload.

**Scope**: `/predict-risk` has a real heuristic for all four hazard types
(earthquake, landslide, flood, wildfire — `app/ml/hazard_prediction/`).
`/detect-cv` (`app/api/routes/computer_vision.py`) runs four classical
color/texture detectors (`app/ml/computer_vision/`: fire, smoke, flood,
infra_damage) — deliberately a heuristic, not a trained model, since no
labeled disaster-imagery dataset exists yet (same v0-baseline posture as
every hazard predictor here).

## Environment

This app has no `.env.example` of its own — it reads the monorepo root
`../../.env.example` (copied to `../../.env` for local runs), which already
defines everything this service needs:

- `INTERNAL_SERVICE_TOKEN` — shared secret checked by `verify_internal_token`
  on every route except `/health`; must match the value `apps/api` sends as
  `X-Internal-Token`.
- `AI_ENGINE_PORT` — the port this service listens on.

`app/core/config.py`'s `Settings` also reads a local `.env` if one exists
(via `pydantic-settings`), so `MODEL_VERSION`/`INTERNAL_SERVICE_TOKEN`/`PORT`/
`LOG_LEVEL` can be overridden per-environment without touching the shared
root file.

## Local development

```bash
cd apps/ai-engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000
pytest
```
