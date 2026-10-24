# Karhutla Spread & Smoke Prediction (experimental)

Status: **first milestone, experimental, uncalibrated, unvalidated.** Outputs are
decision-support scenarios for trained operators, not predictions of certainty.
AETHER does not replace BPBD, BMKG, KLHK or Manggala Agni.

## 1. What it does

For each of the largest recent FIRMS hotspot clusters (default 8, ranked by total FRP):

| Output | Kind | Method |
|---|---|---|
| Hotspots + pixel footprint | **Observation** | NASA FIRMS MODIS NRT, convex hull of `scan`×`track` pixels |
| Potential spread envelope (+1/+3/+6 h) | Model | Elliptical Huygens growth (see §4.1) |
| Smoke transport footprint (+1/+3/+6 h) | Model, **qualitative** | Lagrangian particle ensemble (see §4.2) |
| Potentially exposed places | Derived | Point-in-polygon: OSM settlements + AETHER district reference points |
| Precautionary recommendations | Rules | Predefined rules with stated basis; never evacuation orders |
| Data quality / provenance | Metadata | Freshness, coverage, sources, model versions |

Observed and model data are kept apart end to end: separate DB columns, separate
`observed` / `predicted` branches in the API, solid vs dashed styling on the map.

## 2. Data sources and access

| Source | Used for | Access | Notes / limitations |
|---|---|---|---|
| NASA FIRMS Area API, `MODIS_NRT` | Hotspots (lat/lon, time, FRP, confidence, scan/track, satellite, version, day/night) | `NASA_FIRMS_API_KEY` (existing adapter) | Thermal anomalies, not fires. ~4 passes/day, cloud/smoke gaps, ~3 h latency. Confidence < 30 excluded. VIIRS (375 m) not yet ingested. |
| Open-Meteo forecast API | Hourly 10 m wind, 925/850/700 hPa wind + geopotential height, T, RH, rain, boundary-layer height | Keyless, CC BY 4.0 | NWP model output ("best_match", e.g. ECMWF IFS/GFS), **not station observations**. Past hours are model analyses. Units validated against `hourly_units`. |
| Open-Meteo elevation API | Terrain ring for slope | Keyless | Copernicus GLO-90 DEM (~90 m). |
| OSM via Overpass API | Settlement points | Keyless, fair use, User-Agent required, ODbL | Points only; rural coverage incomplete. Cached 24 h. |
| AETHER `districts` | District reference points | Internal | 514 GeoNames points, **no boundaries**. |
| BMKG public forecast (`api.bmkg.go.id/publik/prakiraan-cuaca?adm4=`) | — (verified reachable) | Keyless | 3-hourly surface wind/RH/T per desa (adm4) code with `analysis_date`. Not integrated yet: needs coordinate → adm4 mapping (villages have no geometry). Planned as a cross-check source. |
| Not available | Fuel type/load, fuel moisture, peat (gambut) extent, canopy, roads, facilities, village boundaries, PM2.5 network | — | Documented as limitations below. |

## 3. Architecture and data flow

```
FIRMS adapter (existing, hourly) ──► hazard_events (wildfire, rawPayload keeps FRP/scan/track)
                                                │
POST /karhutla/predictions/runs ─┐              │
scheduler (every 3 h) ───────────┴► karhutla_prediction_runs (queued; ≤1 active, unique index)
                                                │ BullMQ "karhutla-prediction"
                                                ▼
                           KarhutlaPipelineService (worker or API process)
   normalize → dedupe → drop low-confidence/future-stamped → cluster (2.5 km single-link)
   → Open-Meteo atmosphere (source point + 5×5 grid, 0.75°) + DEM ring + OSM places
   → ai-engine POST /predict-fire-spread   ┐ parallel, per cluster,
   → ai-engine POST /predict-smoke-transport┘ failures isolated per cluster
   → exposure (point-in-polygon) → rules → karhutla_cluster_forecasts
                                                │
GET /karhutla/predictions/latest ◄──────────────┘──► apps/web /karhutla (Leaflet)
```

- `apps/ai-engine/app/ml/karhutla/` — numerical engines (stateless, numpy).
- `apps/api/src/karhutla-prediction/` — orchestration, persistence, API.
  `KarhutlaPipelineModule` (jobs) is imported by both `AppModule` and `WorkerModule`.
- `apps/web/src/app/(workspace)/karhutla/` — operator page (Intelligence → Karhutla Forecast).

## 4. Methods

### 4.1 Spread envelope (`karhutla-spread-ellipse-v0.1`)

FARSITE was evaluated and rejected for this milestone: it needs fuel-model,
canopy and fuel-moisture rasters (LANDFIRE-style) that do not exist for Indonesia
in AETHER, and it is a desktop Windows application. Instead:

- Head ROS = `0.10 × U10 × f_moisture × f_slope` (km/h)
  - 10% wind-speed rule: Cruz & Alexander (2019), *Ann. For. Sci.* 76:44 — dry fuels,
    forests/shrublands; used as an **upper-bound scenario**.
  - `f_moisture`: Rothermel (1972) moisture damping at the Simard (1968) EMC
    from T/RH, relative to 6% dry reference, moisture of extinction 25% (assumed).
    Rain ≥ 1 mm/h halts spread for that hour.
  - `f_slope`: McArthur, `exp(0.0693 × slope)`, slope along downwind, ±20° clamp.
- Shape: Alexander (1985) length-to-breadth ratio; ellipse wavelet with ignition at
  the rear focus; exact convex Huygens growth (Minkowski sum) hour by hour.
- Integrated from the **latest hotspot time** to each valid time.
- Refuses (`insufficient_data`) if no weather within ±90 min of a step or the
  newest hotspot is > 24 h old. Rejects hotspots stamped after `issuedAt` (422).

### 4.2 Smoke transport (`karhutla-smoke-lagrangian-v0.1`)

HYSPLIT was evaluated: it needs ARL-format meteorology (e.g. GDAS/GFS 0.25° from
NOAA ARL), a registered binary, and emission/plume-rise inputs. Feasible later as a
dedicated worker, not for this milestone. Instead:

- 800 particles, seeded from the cluster's hotspot ids (deterministic), released
  evenly from the latest detection (≤ 12 h lookback) to the last horizon,
  uniformly within the boundary layer (no plume rise).
- 10-min steps; IDW over 4 nearest grid points on u/v, linear in time and height.
- `K_h = 2500 m²/s` random walk; per-particle wind perturbation (σ 15% speed, 10° direction)
  for forecast uncertainty; hourly well-mixed remixing below the boundary-layer top.
- Output: nested highest-density classes — core (50% of particles), likely (80%),
  possible (cells with ≥ 2 particles). **Relative particle density, never PM2.5.**

### 4.3 Confidence

`low` / `very_low` is a qualitative input-quality label (missing BLH or humidity,
stale hotspot, missing terrain, horizons without data, particles leaving the wind
grid, one engine failed). It is **not a probability** and is never shown as one.

## 5. API (all under `/api/v1`, JWT required)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/karhutla/predictions/latest` | any signed-in | `{ run, activeRun }` |
| GET | `/karhutla/predictions/runs?limit=20` | any | run summaries |
| GET | `/karhutla/predictions/runs/:id` | any | run + forecasts |
| GET | `/karhutla/predictions/runs/:id/verification` | any | observed-vs-predicted spot check |
| POST | `/karhutla/predictions/runs` | admin, agency_operator | 202; body `{ horizonsHours?: int[1..12] (≤6, unique), maxClusters?: 1..20 }`; returns existing active run with `deduplicated: true`; audited |

Example (trimmed, from a real local run on 2026-10-04):

```json
{
  "run": {
    "id": "f98736a3-…", "status": "completed", "issuedAt": "2026-10-04T02:23:00.000Z",
    "horizonsHours": [1, 3, 6],
    "modelVersions": { "spread": "karhutla-spread-ellipse-v0.1", "smoke": "karhutla-smoke-lagrangian-v0.1" },
    "inputSummary": { "hotspotsInWindow": 1556, "excludedLowConfidence": 105, "hotspotsUsed": 1451,
                      "clustersFound": 649, "clustersForecast": 5, "sources": ["…"] },
    "disclaimer": "Experimental decision-support output. …",
    "forecasts": [{
      "rank": 1, "status": "ok", "confidence": "low",
      "location": { "label": "Near Kabupaten Ogan Komering Ilir, Sumatera Selatan" },
      "observed": { "kind": "observation", "hotspotCount": 42, "totalFrpMw": 2667.83,
                    "latestObservedAt": "2026-10-03T21:12:00.000Z", "hotspots": ["…"], "pixelFootprint": {"type": "Polygon"} },
      "predicted": { "kind": "model_output",
        "spread": { "horizons": [{ "horizonHours": 6, "status": "ok", "areaKm2": 427.8, "headBearingDeg": 297.1,
                    "maxHeadDistanceKm": 10.7, "factors": { "estimatedFineFuelMoisturePct": 11.8, "moistureFactor": 0.839 } }] },
        "smoke": { "qualitative": true, "horizons": [{ "horizonHours": 6, "transportBearingDeg": 300.6, "p90DistanceKm": 172.1,
                   "footprint": [{ "level": "core", "particleShare": 0.502, "geometry": {"type": "MultiPolygon"} }] }] } },
      "dataQuality": { "hotspotFreshness": "fresh", "hotspotAgeHours": 5.2, "issues": [] },
      "exposure": [{ "horizonHours": 6, "spread": [{ "name": "Kayu Labu", "kind": "settlement" }], "smoke": { "core": ["…"] } }],
      "recommendations": [{ "code": "VERIFY_ON_GROUND", "priority": "priority", "basis": "Always issued: …" }]
    }]
  },
  "activeRun": null
}
```

## 6. Validation status

- **Automated tests**: unit conversion, direction/u-v round trips, coordinate and
  timestamp validation, stale/missing weather, duplicate/low-confidence/future
  hotspots, engine failure/timeout/422 handling, idempotent run requests, abandoned
  runs, API validation + role authorization, point-in-polygon exposure, deterministic
  fixtures, observed/predicted separation, confidence propagation.
- **Scientific validation: none yet.** No accuracy, skill or calibration is claimed.
- The verification endpoint counts new hotspots inside the envelope vs. inside the
  observed footprint (persistence baseline). It is a sparse spot check, not
  perimeter validation, and larger envelopes trivially contain more points.

Recommended validation plan: (1) historical FIRMS sequences 2015/2019/2023 seasons
(Kalimantan Tengah, Sumatera Selatan, Riau) with temporal *and* geographic holdouts;
(2) fire: burned-area references (MODIS MCD64A1, KLHK burned-area maps) with IoU /
perimeter-distance metrics against persistence and wind-only baselines;
(3) smoke: Himawari-8/9 AOD and smoke masks, ISPU/PM2.5 stations, compared with a
wind-only straight-line baseline.

## 7. Configuration

| Var | Default | |
|---|---|---|
| `KARHUTLA_PREDICTION_INTERVAL_MS` | `10800000` | scheduled run interval, `0` disables |
| `KARHUTLA_MAX_CLUSTERS` | `8` | clusters forecast per run |
| `KARHUTLA_HOTSPOT_WINDOW_HOURS` | `24` | hotspot lookback |
| `KARHUTLA_SETTLEMENTS_ENABLED` | `true` | Overpass lookups |
| `OVERPASS_BASE_URL` | public Overpass | point at a self-hosted instance in production |
| existing: `OPEN_METEO_BASE_URL`, `NASA_FIRMS_API_KEY`, `AI_ENGINE_URL`, `INTERNAL_SERVICE_TOKEN`, `REDIS_URL`, `ENABLE_JOB_PROCESSORS` | | |

Migration: `1791120000000-AddKarhutlaPredictions` (`pnpm --filter @aether/api migration:run`).
Provider quota: one run ≈ 1–4 Open-Meteo requests (≤50 points each, cached 30 min),
1 elevation request, ≤8 Overpass requests (cached 24 h).

## 8. Known limitations and next steps

1. Peat (gambut) smouldering fires are not modelled — add a peat mask (KLHK/BRGM
   peat maps) and a separate low-spread/high-emission regime.
2. No fuel map — evaluate ESA WorldCover 10 m / MapBiomas Indonesia for fuel classes,
   then Rothermel with Scott & Burgan models where fuel classes are reliable.
3. Ingest VIIRS 375 m (`VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`)
   for better footprints and timing; current adapter is MODIS-only.
4. BMKG cross-check: resolve fire coordinates to adm4 codes and compare BMKG vs
   Open-Meteo surface wind; flag disagreements.
5. Smoke: FRP-based emission and plume-rise (e.g. Sofiev 2012), HYSPLIT worker,
   wet deposition; validate against Himawari AOD and ISPU.
6. Exposure: roads/facilities (OSM), village boundaries (BIG), population grids
   (e.g. WorldPop) — vulnerability remains a separate layer.
7. The citizen portal's existing client-side smoke drift (`apps/web/src/lib/citizen/smoke.ts`)
   is a heuristic wind-cone, not this model; consider replacing it with server output
   once validated.
8. LLM explanations were deliberately not added; if added, they must only paraphrase
   the structured outputs and recommendations, never compute numbers.
