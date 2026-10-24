# Rainfall Intelligence (Hujan)

Status: **Milestones 1 (data pipeline), 2 (Stage-1 rain-movement nowcast
baselines + backtest), 3 (rule-based flood-risk baseline), 4 (rule-based
landslide-risk baseline), 5 (gated Stage-2 spatial nowcast model —
trained and evaluated daily, not yet promoted), 6 (district outlook with
rule-based recommendations) and 7 (historical backtest against BNPB DIBI
reports, §10) complete — experimental, uncalibrated.** Stored
data: numerical weather prediction (NWP) model output (Open-Meteo) and
satellite rainfall estimates (JAXA GSMaP_NOW). Neither is a rain-gauge
measurement.

Goal (end state): probabilistic early-warning intelligence for rain movement,
rain-driven flood risk and rain-triggered landslide risk, with probability,
confidence, horizon, data freshness and the contributing factors behind each
output. AETHER does not replace BMKG / BNPB / BPBD.

## 1. Milestone 0 — audit summary (2026-10-06)

### Data available in the repository

| Feature | Available | Source | Resolution | Notes |
|---|---|---|---|---|
| Rainfall | Model only | Open-Meteo `precipitation` | hourly, provider grid | Not gauge/radar. Now persisted (§3). |
| Wind 10 m / 850 hPa / 700 hPa | Model only | Open-Meteo | hourly | Surface and steering-level winds often differ by >90° (observed: Jakarta 10 m from ~20°, 700 hPa from ~170°). |
| Temperature, RH, surface pressure | Model only | Open-Meteo | hourly | |
| Soil moisture 9–27 cm | Model only | Open-Meteo | hourly | Previously only a proxy (`rain24h / 150`) in the landslide trigger. |
| Elevation | Yes | Open-Meteo elevation (Copernicus GLO-90) | ~90 m | Used by karhutla `TerrainProvider`; not yet by rainfall. |
| Slope | Proxy only | InaRISK landslide *risk* index mapped to 10–50° | 100 m | Not a slope. Real slope can be derived from the DEM. |
| Flood susceptibility | Yes | InaRISK `INDEKS_BAHAYA_BANJIR` | 100 m | Point lookup. |
| River water level | Partial | PetaBencana gauges | per gauge | Jakarta + West/Central/East Java only. |
| Land cover, geology, soil type | **No** | — | — | REQUIRED DATA for landslide susceptibility. |
| Historical flood events | **No** (0 rows) | — | — | REQUIRED DATA for training/evaluation. |
| Historical landslide events | **No** (1 seed row) | — | — | REQUIRED DATA. |
| Satellite rainfall | **Yes (since 2026-10-06)** | JAXA GSMaP_NOW + GSMaP_Gauge_NOW | 0.1°, hourly, ~0 h latency | Rolling 24 h ingested hourly (§3.1). |
| Radar, rain gauges (AWS) | **No** | — | — | REQUIRED DATA (BMKG access restricted). |

Spatial support: `districts` = 514 kabupaten/kota **reference points**
(GeoNames), no boundaries; kecamatan/desa have codes and names but no geometry.
Decision (2026-10-06): use the district points; no grid.

### Findings fixed as part of Milestone 0

1. `OpenMeteoClient.getLast24hRainfallMm` summed the previous *calendar day*
   (Asia/Jakarta), not the trailing 24 h, and called model data "observed".
   Now a trailing 24 h UTC window, `null` if any hour is missing.
2. `PublicWeatherService` returned offset-less Asia/Jakarta times, which
   browsers in WITA/WIT read as their own local time. Now explicit UTC ISO.

### Findings open (not changed)

- ~~Baseline risk scan scores flood from constants~~ **Fixed in Milestone 3**
  for flood (live rainfall + InaRISK index, see §5); landslide still uses
  history/defaults (Milestone 4).
- `flood.py` / `landslide.py` confidence ignores data freshness.
- Landslide scoring counts exposure twice (InaRISK *risk* index + density).
- ~~Open-Meteo quota~~ **Fixed 2026-10-06:** `LandslideRainfallTriggerAdapter`
  made 514 single-location Open-Meteo calls every 15 min (≈ 49k/day vs a
  shared free tier of 10k/day; HTTP 429 observed). It now reads trailing-24 h
  rainfall from `weather_hourly_samples` — GSMaP_Gauge_NOW first, Open-Meteo
  as fallback, each only if fresh and complete — and records the source used
  (`rainfallSource`, `rainfallDataKind`) in the event's raw payload. Zero
  provider calls per poll. `OpenMeteoClient` is now unused.

### External sources researched

| Source | What | Access |
|---|---|---|
| JAXA GSMaP_NOW / GSMaP_NRT | Satellite rainfall, 0.1°, hourly; NOW updated every 30 min over the Himawari area, NRT ~4 h latency + archive | Free registration, commercial use allowed, attribution "GSMaP data by Japan Aerospace Exploration Agency (JAXA)". **Registered 2026-10-06 (category: Education); GSMaP_NOW integrated.** |
| BMKG weather radar (CMAX, QPE) | Radar rainfall | Public access restricted since early 2026; needs a formal request to BMKG. |
| BMKG AWS Center | Station observations every 10 min | Login + captcha, no public API. |
| BMKG `prakiraan-cuaca` | 3-hourly forecast per desa (adm4) | Keyless; needs an adm4 code mapping. |
| BNPB DIBI | Historical disaster events | Portal reachable; no automated export found. |

## 2. Problem framing and strategy

Three separate tasks, never one model:

| Task | Feasible now | Blocked on |
|---|---|---|
| Rain movement | Hourly *model precipitation outlook* (+1…+6 h), baseline = persistence and steering-wind (700/850 hPa) advection | Observed rainfall fields (GSMaP) to validate; 15–30 min horizons need radar |
| Flood risk | Transparent rule baseline: accumulations 1/3/6/24 h, antecedent 72/168 h, InaRISK flood index, PetaBencana water level | Historical flood labels for calibration |
| Landslide risk | Trigger (intensity–duration, antecedent) × susceptibility (DEM slope, InaRISK where available); exposure kept separate | Labels, land cover, geology |

Horizons: 0–2 h nowcasting needs observed fields; 2–24 h is NWP forecast
passed through, never presented as AETHER's own forecasting skill. Models
progress baseline → spatial-temporal → deep learning only when data supports
it; evaluation uses time-based splits.

## 3. Milestone 1 — rainfall data pipeline (implemented)

```
scheduler (every RAINFALL_INGESTION_INTERVAL_MS) ─┐
POST /rainfall/ingestion/runs ────────────────────┴► RainfallIngestionService
   514 district points, batches of 50 → Open-Meteo hourly (11 variables, GMT)
   → lib/normalize.ts (units, ranges, duplicates, future hours, UTC)
   → upsert weather_hourly_samples (district, source, valid_time)
   → data_source_syncs 'rainfall_open_meteo'
GET /rainfall/conditions[/:districtId] ◄── RainfallConditionsService
   → lib/features.ts (accumulations, intensity, wind per level, pressure
     tendency, soil moisture) + data quality / freshness
```

Code: `apps/api/src/rainfall-intelligence/`. `apps/ai-engine` is unchanged —
models start in Milestone 2.

### Table `weather_hourly_samples`

One row per district point × source × hour. `valid_time` is the end of the
hour (precipitation covers `(valid_time − 1 h, valid_time]`). `data_kind` ∈
`nwp_model | satellite_estimate | station_observation` so GSMaP and AWS can
share the table. Every measured column is nullable; rejected values are NULL
with a reason in `quality_flags` (`<variable>:missing | out_of_range |
unit_unrecognized`). `retrieved_at` records when the values were fetched.
Unique `(district_id, source, valid_time)` makes ingestion idempotent.
Migration: `1791330000000-AddWeatherHourlySamples`. Volume ≈ 4.5 M rows/year.

### Data-quality rules

| Concern | Handling |
|---|---|
| Timezone | Requests use `timezone=GMT`; offset-less times parsed as UTC. |
| Units | Checked against `hourly_units`; m/s, kn, mph → km/h; inch → mm; °F → °C; kPa/Pa → hPa; unknown → NULL + flag. |
| Impossible values | Precipitation 0–305 mm/h (1-h world record), wind 0–400 km/h, direction 0–360 (360 → 0), RH 0–100 %, pressure 400–1100 hPa (Puncak Jaya ≈ 550), soil 0–1. |
| Duplicates | Within a response: first kept; across runs: upsert. |
| Future hours | Dropped (forecasts are not stored in Milestone 1). |
| Gaps / irregular sampling | Accumulations report `hoursAvailable/hoursExpected`; `totalMm` is NULL unless complete. Missing hours are listed. |
| Staleness | `fresh` ≤ interval + 60 min, `aging` ≤ 2 × interval + 60 min, else `stale` (relative to ingestion cadence). |
| Provider limits | Stops on HTTP 429 (`rateLimited: true`); the next run's lookback reaches back to the most-behind district (≤ 168 h), so gaps self-heal. |

### 3.1 JAXA GSMaP_NOW (satellite rainfall)

Source of truth for the format: JAXA "Data Format Description for GSMaP_NOW"
(FTP `/now/doc/DataFormatDescription_NOW.pdf`, updated 2026-04-16) and
`/now/sample/GSMaP_NOW.hourly.rain.ctl`.

- **Access:** FTP `hokusai.eorc.jaxa.jp`, credentials from the JAXA
  registration email (`GSMAP_FTP_USER` / `GSMAP_FTP_PASSWORD`). Plain FTP:
  the server refuses `AUTH TLS` (504, checked 2026-10-06).
- **Files:** `/now/latest/gsmap_now.YYYYMMDD.HHNN.dat.gz` and
  `gsmap_gauge_now.…` (rolling 24 h). `HHNN` = window **start** (UTC); only
  hour-aligned windows (`NN = 00`) are used, stored with `valid_time` =
  start + 1 h so they line up with Open-Meteo hours.
- **Grid:** 3600 × 1200 little-endian float32, gzip (~1.9 MB per file);
  0.1° cells, first cell centre 59.95°N 0.05°E, lines north→south. Value =
  hourly-averaged rain rate (mm/hr) = hour total (mm). Negative = missing:
  −4 sea ice, −8 low temperature, −99 no observation → NULL +
  `gsmap:missing_sea_ice | gsmap:missing_low_temperature |
  gsmap:no_observation`. A file of the wrong size is rejected.
- **Sampling:** the 0.1° (~11 km) cell containing each district reference
  point — a point value, like Open-Meteo, not an area average.
- **Caveats:** GSMaP_NOW's last half hour of each window is **extrapolated
  with cloud motion vectors**, and NOW uses fewer microwave passes than
  GSMaP_NRT (format document p. 1). GSMaP_Gauge_NOW is the gauge-calibrated
  variant. Both are stored (`source = gsmap_now | gsmap_gauge_now`,
  `data_kind = satellite_estimate`); APIs show them **next to** the model
  values, never merged.
- **Ingestion:** hourly (`GSMAP_INGESTION_INTERVAL_MS`), downloading only
  windows not yet stored for every district — steady state 2 files/hour,
  first run ~48 files. Per-file failures are isolated.
- **Not ingested yet:** archive backfill. For backtesting use GSMaP_NRT /
  GSMaP_Gauge_NRT v8 (`/realtime_ver/v8`) or MVK v8 (`/standard/v8`, since
  1998), which are better quality than NOW.

First comparison (one hour, 2026-10-06 12–13 UTC, 500 district points,
≥ 0.1 mm = rain): Open-Meteo rain at 43 points, GSMaP_NOW at 11, both at 3.
One hour proves nothing statistically; it shows why model rain and observed
rain must be kept apart and compared before any model is trusted.

### Wind

Meteorological "from" degrees. Features: u/v, sin/cos (so 359° ≈ 1°),
toward-direction, 16-point compass, and a 3-h vector mean with `steadiness`
(|mean vector| / mean speed). 10 m, 850 hPa and 700 hPa are kept separate:
**no level is assumed to be the direction rain moves** — that must be
validated against observed rainfall fields (Milestone 2, needs GSMaP).

### API (under `/api/v1`, JWT required)

| Method | Path | Roles | Returns |
|---|---|---|---|
| GET | `/rainfall/conditions` | any signed-in | Per district: status (`ok/stale/no_data`), freshness, latest hour, 1/3/6/24 h totals with completeness, 10 m wind |
| GET | `/rainfall/conditions/:districtId` | any signed-in | Full features, data quality + issues, provenance, last 24 hourly samples. 400 invalid UUID, 404 unknown district |
| POST | `/rainfall/ingestion/runs` | admin, agency_operator | Open-Meteo run summary; 409 if a run is in progress; audited |
| POST | `/rainfall/ingestion/gsmap-runs` | admin, agency_operator | 202, runs in the background; 409 without credentials or while running; audited |
| GET | `/rainfall/ingestion/status` | any signed-in | Per source: configured, running, `data_source_syncs` status, last run summary, rows stored in the last 24 h |

Every detail response carries `provenance.dataKind = "nwp_model"`, the
spatial-support caveat (single reference point, not an area average) and the
Open-Meteo CC BY 4.0 attribution. GSMaP values appear under a separate
`satellite` block (detail: both products with 1/3/6/24 h accumulations,
freshness and flags; list: GSMaP_Gauge_NOW only) with
`dataKind = "satellite_estimate"` and the JAXA attribution.

### Configuration

| Var | Default | |
|---|---|---|
| `RAINFALL_INGESTION_INTERVAL_MS` | `10800000` | 0 disables scheduled runs. 3 h ≈ 4.5k calls/day if each location counts. |
| existing `OPEN_METEO_BASE_URL` | public API | Free tier is non-commercial; a commercial deployment needs a paid plan. |
| `GSMAP_FTP_HOST` | `hokusai.eorc.jaxa.jp` | |
| `GSMAP_FTP_USER` / `GSMAP_FTP_PASSWORD` | — | From the JAXA email; GSMaP is skipped without them. Local `apps/api` reads `apps/api/.env`. |
| `GSMAP_INGESTION_INTERVAL_MS` | `3600000` | 0 disables scheduled GSMaP runs. |

### Validation status

- Automated tests: wind normalization/circular mean, unit conversion,
  impossible/missing values, duplicate/future/unparseable timestamps, UTC
  parsing, accumulation completeness, gap detection, freshness, ingestion
  (backfill window, partial failure, 429 stop, concurrency), conditions
  (stale, no data, 404), controller authorization and audit.
- Live check (2026-10-06): first run stored 84,500 samples (500/514
  districts × 169 h); the last batch hit the shared Open-Meteo hourly limit.
- **No scientific validation** — there is nothing observed to compare against yet.

## 4. Milestone 2 — rain-movement nowcast baselines (implemented)

```
GSMaP ingestion (hourly) ── also stores the Indonesia field ──► rainfall_grids
        │ new field stored
        ▼
RainfallNowcastService ── two newest fields + 700 hPa model winds ──►
   ai-engine POST /predict-rain-nowcast (app/ml/rainfall/)
   → per district: tracked motion + 3 methods × (+1, +2, +3 h)
   → rainfall_nowcast_runs (model versions, data times, inputs, results)
GET /rainfall/nowcast/latest[/:districtId]
POST /rainfall/nowcast/backtests → GET /rainfall/nowcast/backtests/latest
```

### Rain fields (`rainfall_grids`)

GSMaP_Gauge_NOW cut to 90.05–144.95°E × 9.95°N–14.95°S cell centres
(550 × 250 at 0.1°: Indonesia + ~4° margin so approaching rain and tracking
windows stay inside), gzip float32, NaN = missing. ~58 KB per hour
(≈ 0.5 GB/year). Unique (source, valid_time). Hours whose points were stored
before grids existed are re-fetched once to fill the field.

### Methods (ai-engine `app/ml/rainfall/`)

| Piece | Version | What |
|---|---|---|
| Motion | `rain-motion-blockmatch-v0.1` | TREC-style block matching (Rinehart & Garvey 1978): 31 × 31-cell window, shifts ±6 cells/h, correlation of log1p(rain) over cells valid in both frames. Status `ok`, `no_rain_to_track` (< 20 rainy cells), `unchanged_field`, `insufficient_data`, `no_previous_frame`. Confidence is a qualitative label (`low` only if r ≥ 0.5), never a probability. |
| Nowcasts | `rain-nowcast-baselines-v0.1` | `persistence`, `motion_advection` (tracked motion), `steering_wind_advection` (700 hPa Open-Meteo wind). Semi-Lagrangian look-back; output = neighbourhood fraction of cells ≥ 1 mm/h within 15 km + 10 km per lead hour (Theis et al. 2005). **Uncalibrated** (`calibrated: false`). |

**GSMaP_NOW carry-over (found 2026-10-06):** ~9–13 % of rainy cells are
bit-identical from one hour to the next — light rain (0.11–0.19 mm/h),
spatially clustered (89 % have ≥ 3 identical neighbours), mostly 90–110°E.
Those regions were not updated; tracking them would report false "zero
motion" with r ≈ 1. A window with ≥ 50 % unchanged rainy cells is reported
as `unchanged_field` and not advected.

Horizons: +1/+2/+3 h only. GSMaP is hourly, so +15/+30 min cannot be
supported honestly; beyond +3 h the backtest shows no skill (below).

Data rules: a field older than 2 h is **refused** (run stored as
`insufficient_data` with the reason); without the previous hour, motion is
unavailable and only persistence/steering run; steering winds older than the
Open-Meteo interval + 1 h are not used (district listed in `warnings`).

### First backtest (2026-10-06; 24 stored hours, 22 start hours, 514 districts)

Truth: GSMaP_Gauge_NOW at the district cell, rain = ≥ 1 mm/h (base rate ≈ 1 %
of district-hours — accuracy would be meaningless, hence Brier skill).

| Method | +1 h BSS | +2 h BSS | +3 h BSS | +1 h POD / FAR / CSI |
|---|---|---|---|---|
| persistence | 0.37 | 0.01 | −0.17 | 0.58 / 0.37 / 0.43 |
| motion_advection | **0.41** | **0.06** | −0.14 | 0.64 / 0.42 / 0.44 |
| steering_wind_advection | 0.39 | **0.06** | −0.09 | 0.64 / 0.40 / 0.45 |

Direction of the rain's realized motion (t → t+1 h) vs candidate predictors:

| Predictor | n | Median error | ≤ 45° | ≤ 90° (random = 0.5) |
|---|---|---|---|---|
| Tracked motion of the previous hour | 1325 | 0° | 0.90 | 0.95 |
| Wind 10 m | 1552 | 90° | 0.24 | 0.51 |
| Wind 850 hPa | 1556 | 76° | 0.22 | 0.57 |
| Wind 700 hPa | 1556 | 52° | 0.45 | 0.64 |

Reading, with the caveats the API also returns:

- **Wind direction ≠ rain direction, empirically.** Surface (10 m) wind is no
  better than a random direction; 700 hPa is the best wind level but still
  off by ~50° typically. Do not present wind as rain movement.
- Advection beats persistence by +2 h; at +3 h every method is worse than
  forecasting the climatology. +3 h output should be treated as no-skill.
- Probabilities are over-confident: forecasts of 0.5–0.7 verified 33 % of the
  time, ≥ 0.7 verified 74 % (motion_advection +1 h).
- **One day of data — anecdotal, not a skill estimate.** Hours are
  correlated; truth is the same satellite product (its own extrapolated half
  hour and carry-over flatter persistence/motion); "realized motion" uses the
  same tracker on overlapping frames, which flatters tracked-motion
  persistence. Re-run as history accumulates (GSMaP_NOW keeps only 24 h on
  the FTP, so history exists only from the day ingestion started).

### API (Milestone 2)

| Method | Path | Roles | Returns |
|---|---|---|---|
| GET | `/rainfall/nowcast/latest` | any signed-in | Latest run (any status) with provenance and per-district results |
| GET | `/rainfall/nowcast/latest/:districtId` | any signed-in | Same, one district; 404 if absent |
| POST | `/rainfall/nowcast/runs` | admin, agency_operator | Runs now (≈ 2 s); 409 if running; audited |
| POST | `/rainfall/nowcast/backtests` | admin, agency_operator | Body `{ hours?: 3..72 }`; 202, background; audited |
| GET | `/rainfall/nowcast/backtests/latest` | any signed-in | `{ running, result }` (in memory) |

Scheduled: a nowcast follows every GSMaP ingestion that stored a new field
(hourly). Migration: `1791340000000-AddRainfallGridsAndNowcastRuns`.

### Open items

- Retention: runs ≈ 133 KB each (≈ 1.2 GB/year hourly), grids ≈ 0.5 GB/year.
- Calibrate probabilities (e.g. reliability-based recalibration) once weeks
  of backtest data exist; until then keep `calibrated: false`.
- Persist backtest results (currently in memory) for model comparison over time.
- Stage 2 only if it beats these baselines on a multi-week backtest — the
  gate is implemented in Milestone 5 (§7).

## 5. Milestone 3 — flood-risk baseline (implemented)

```
startup / POST /rainfall/hazard-indices/runs
   → InaRISK INDEKS_BAHAYA_BANJIR at district point + 4 neighbours (±0.05°)
   → district_hazard_indices (re-sampled after 30 days)
GSMaP ingestion stored a new field (or Open-Meteo run, without GSMaP)
   → RainfallFloodRiskService: stored rainfall + index + PetaBencana gauges
   → ai-engine POST /predict-rain-flood-risk (app/ml/rainfall/flood_risk.py)
   → rainfall_risk_runs (hazard = 'flood')
GET /rainfall/flood-risk/latest[/:districtId]
```

No provider calls per run: everything comes from stored data.

### Method (`flood-rule-baseline-v0.1`) — a decision table, not a model

There are no labelled flood events (REQUIRED DATA: BNPB DIBI), so **no
probability is issued** (`probability: null`) and nothing is fitted. Only
inputs with a stated external basis change the level; the rest are reported
as context (`effect: not_scored`) so explanations never claim more than the
rule uses.

| Step | Input | Rule | Basis |
|---|---|---|---|
| 1. Rain trigger | Highest hour of the last 3 h; 24 h total | hourly lebat ≥ 10 / sangat lebat > 20 mm/h; daily lebat ≥ 50 / sangat lebat ≥ 100 / ekstrem > 150 mm. lebat → MEDIUM, sangat lebat → HIGH, ekstrem → EXTREME; the higher wins | BMKG rainfall-intensity categories |
| 2. Susceptibility | InaRISK flood index, mean of valid samples | National terciles of the stored district values; bottom tercile lowers the trigger one level; unknown never lowers | InaRISK publishes a 0–1 stretch with no class breaks, so the breaks are data-driven |
| 3. River gauge | PetaBencana (BPBD) Siaga label ≤ 3 h old, gauge assigned to its nearest district point ≤ 30 km | Siaga III/II/I → floor MEDIUM/HIGH/EXTREME | Official gauge status |
| Context only | 1/3/6 h, 72/168 h antecedent, soil moisture 9–27 cm | — | No validated threshold without labels |

Rainfall comes from **one** series per district so the hourly peak and the
24 h total describe the same data: the first non-stale series with a
complete 24 h window (GSMaP_Gauge_NOW, then Open-Meteo); else the first
non-stale one (hourly peak only); a stale series is refused
(`insufficient_data`). Antecedent totals use the first series with a
complete 72 h window (Open-Meteo until a week of GSMaP is stored).

Confidence is qualitative and never above `low` while uncalibrated: `low`
needs fresh, satellite, complete-24 h rainfall and a known susceptibility,
else `very_low`, with the reasons listed. `timeToRiskHours` is `null`:
without a hydrological model there is no lead-time estimate; the level
describes conditions as of the rainfall's valid time. "Affected area" is the
district reference point (no boundaries, no inundation model).

All thresholds are request parameters (`parameters` in each run), and each
factor's basis is returned once per run (`parameters.factorBases`).

### Data findings (2026-10-07)

- **InaRISK rejected AETHER's requests.** `gis.bnpb.go.id` answers HTTP 403
  to axios' default User-Agent (`axios/<version>`) and serves the identical
  request from any other agent. `BnpbInariskClient` swallowed the error and
  returned `null`, so **every InaRISK enrichment so far was silently empty**
  (PetaBencana `floodHazardIndex`, the landslide slope proxy's fallback to
  25°). Fixed with an identifying User-Agent; `lookupIndexValue` now tells
  an answered NoData pixel apart from a failed request.
- Flood index coverage: 293 / 514 districts have a value in at least one of
  the 5 samples; at 221 all 5 are NoData (answered, not failed). NoData most
  likely means "outside the mapped flood-hazard zone", but this is **not
  documented by BNPB**, so it is treated as unknown (never lowers a level),
  not as zero. Values present are high (terciles 0.59 / 0.72), consistent
  with the layer only covering hazard zones.
- PetaBencana `/floodgauges` currently returns no features for ID-JK/JB/JT/JI
  (dry season or service change); the gauge rule is wired but inactive.
- `INDEKS_RISIKO_TANAH_LONGSOR` still times out (8 s) — see §6.

First live run (2026-10-07 04:09 UTC, 514 districts): 513 LOW, 1 MEDIUM
(24 h = 55 mm, daily *lebat*); every district `very_low` confidence because
GSMaP was 128 min old (`aging`) after API restarts reset the hourly
schedule. Stored size ≈ 64 KB per run (jsonb, ≈ 0.56 GB/year hourly).

### Standing risk scan (`risk-engine-orchestration`)

`buildBaselineHazardEventInput` for flood now prefers live stored data:
`rainfallMm` = trailing-24 h total (GSMaP, then Open-Meteo, only if fresh
and complete), `floodHazardIndex` = the sampled InaRISK mean; then district
history, then `BASELINE_DEFAULTS`. `waterLevelM` still comes from history or
the default (no per-district water level exists). Which source fed each
value is stored in `risk_assessments.input_snapshot.baselineInputSources`.

### API (Milestone 3)

| Method | Path | Roles | Returns |
|---|---|---|---|
| GET | `/rainfall/flood-risk/latest` | any signed-in | Latest flood run with thresholds, factor bases, input summary, missing inputs, per-district results |
| GET | `/rainfall/flood-risk/latest/:districtId` | any signed-in | Same, one district; 400 invalid UUID, 404 absent |
| POST | `/rainfall/flood-risk/runs` | admin, agency_operator | Runs now (≈ 1 s); 409 if running; audited |
| POST | `/rainfall/hazard-indices/runs` | admin, agency_operator | 202; samples districts missing / > 30 days old; audited |

Migration: `1791350000000-AddRainfallRiskRunsAndDistrictHazardIndices`
(`rainfall_risk_runs` has a `hazard` column so Milestone 4 reuses it).

### Open items

- Calibration and probabilities need labelled flood events (DIBI) — then
  replace the decision table with a model evaluated on time-based splits
  (precision/recall, PR-AUC, false-alarm rate, reliability).
- GSMaP is an ~11 km area estimate; it under-reads point intensities, so
  the BMKG hourly categories (defined for gauges) are crossed less often
  than at a gauge. Treat LOW as "no trigger detected", not "safe".
- REQUIRED DATA: river network / height above nearest drainage, land cover,
  water levels outside Java.
- Retention for `rainfall_risk_runs`, like nowcast runs.

## 6. Milestone 4 — landslide-risk baseline (implemented)

```
startup, every 6 h, POST /rainfall/terrain/runs
   → Open-Meteo elevation API (Copernicus GLO-90 DEM), 16 sites × N/S/E/W
     stencil around the district point, ≤ TERRAIN_SAMPLING_DISTRICTS_PER_DAY
   → district_terrain_profiles (one slope per land site; re-sampled yearly)
after every flood-risk run (same triggers as §5)
   → RainfallLandslideRiskService: stored rainfall + slope samples
   → ai-engine POST /predict-rain-landslide-risk (app/ml/rainfall/landslide_risk.py)
   → rainfall_risk_runs (hazard = 'landslide')
GET /rainfall/landslide-risk/latest[/:districtId]
```

### Method (`landslide-rule-baseline-v0.1`) — a decision table, not a model

No labelled landslide events exist (REQUIRED DATA: BNPB DIBI), so **no
probability is issued** and nothing is fitted. **Exposure (population,
assets) is not part of the level** — it describes the hazard; exposure
belongs to the decision layer (Milestone 6).

| Step | Input | Rule | Basis |
|---|---|---|---|
| 1. Rain trigger | Trailing 3, 6, 24 h totals (rainfall series) and 72 h (antecedent series) | Mean intensity I = total / D against I = α·D^−β. ≥ lower curve on any window → MEDIUM; ≥ upper curve → HIGH. Never EXTREME (no published basis) | Lower: Guzzetti et al. 2008 global minimum, I = 2.20·D^−0.44 (0.1–1000 h). Upper: Caine 1980, I = 14.82·D^−0.39 (0.167–500 h). Both world thresholds for shallow landslides and debris flows, as tabulated in Brunetti et al. 2010, NHESS 10:447, Table 2 |
| 2. Terrain | p90 of the land-site slopes (DEM 90 m) | Permen PU No. 22/PRT/M/2007 typology: C < 20 %, B 20–40 %, A > 40 %. Type C only (gentle) lowers the trigger one level; < 8 land sites = unknown, never lowers | Official Indonesian landslide-zone slope classes |
| Context only | 1 h, 168 h, soil moisture 9–27 cm | — | No validated threshold without labels |

What the thresholds mean in mm: 3 h ≥ 4.1 / 29.0, 6 h ≥ 6.0 / 44.2,
24 h ≥ 13.0 / 103.0, 72 h ≥ 24.1 / 201.3 (lower / upper). The lower curve is
a *global minimum* — the least rain at which landslides have been reported
anywhere — so it is crossed often in the wet season; it marks "a trigger is
possible", not "a landslide is likely". Indonesian local curves exist
(e.g. Banjarmangu, Banjarnegara: I = 43.2·D^−0.87 — Irawan et al. 2019, IOP
EES 243:012028) but are site-specific and not used nationally. Trailing
windows stand in for rainfall events (no event segmentation).

Why p90: the district point is usually a town in a valley; the 90th
percentile of 16 sites over the ±0.05° footprint (the GSMaP cell) registers
the hills around it. Sites touching sea level (≤ 0 m; the DEM reports the sea
as 0) are dropped rather than counted as flat.

Confidence is never above `low`: `low` needs fresh rainfall, every trigger
window complete **and observation-based** (satellite), and known terrain;
otherwise `very_low` with reasons (e.g. "72 h rainfall is nwp_model").
`timeToRiskHours` is `null` (no slope-stability model).

All thresholds are request parameters; each run stores them with the
factor bases.

### Data findings (2026-10-07)

- **Both InaRISK landslide layers are unusable**: `INDEKS_BAHAYA_TANAHLONGSOR`
  and `INDEKS_RISIKO_TANAH_LONGSOR` time out on every `getSamples` (30 s,
  3 points each) while their metadata answers in ~150 ms. The existing
  `LandslideRainfallTriggerAdapter` used the *risk* layer (which includes
  exposure) scaled onto 10–50° as a slope stand-in: every candidate waited
  8 s and then got the 25° default. It now uses the stored p90 DEM slope
  (`slopeSource: dem_p90 | default` in the raw payload).
- **Open-Meteo counts every coordinate.** An unpaced terrain refresh got
  HTTP 429 on its 10th 64-coordinate request (640 coordinates > 600/min).
  Requests are now paced at one per 8 s (~480 coordinates/min), and the
  daily cap (default 60 districts ≈ 3.8k coordinates) is counted from the
  table, so restarts cannot exceed it. Full coverage takes ~9 days.
- GSMaP history is still shorter than 72 h, so the 72 h window comes from
  Open-Meteo **model** rain at every district.

First live run (2026-10-07, data valid 05:00 UTC, 60 / 514 districts with
terrain): 45 MEDIUM, 469 LOW. 59 districts crossed the lower curve, 53 of
them on the 72 h window (model rain); 14 were lowered by gentle terrain;
none crossed the upper curve. Terrain classes of the 60: 15 A, 20 B, 24 C,
1 unknown (coastal, < 8 land sites). All `very_low` confidence (72 h from
the model). ≈ 0.8 s per run, ≈ 54 KB stored.

### Standing risk scan (`risk-engine-orchestration`)

The landslide baseline input now prefers live stored data like flood:
`slopeDegrees` = p90 DEM slope, `triggeringRainfallMm` = trailing-24 h
total; then district history, then `BASELINE_DEFAULTS`. `soilSaturation`
still comes from history or the default. Sources are recorded in
`input_snapshot.baselineInputSources`. (History slopes are unreliable: they
were all the 25° fallback described above.)

### API (Milestone 4)

| Method | Path | Roles | Returns |
|---|---|---|---|
| GET | `/rainfall/landslide-risk/latest` | any signed-in | Latest landslide run with thresholds, factor bases, input summary, missing inputs, per-district results |
| GET | `/rainfall/landslide-risk/latest/:districtId` | any signed-in | Same, one district; 400 invalid UUID, 404 absent |
| POST | `/rainfall/landslide-risk/runs` | admin, agency_operator | Runs now (≈ 1 s); 409 if running; audited |
| POST | `/rainfall/terrain/runs` | admin, agency_operator | 202; samples due districts within the daily cap; audited |

Config: `TERRAIN_SAMPLING_DISTRICTS_PER_DAY` (default 60, 0 disables).
Migration: `1791360000000-AddDistrictTerrainProfiles`.

### Open items

- Calibration and probabilities need labelled landslide events (DIBI);
  Indonesian thresholds should replace the global ones once labels allow.
- REQUIRED DATA: PVMBG/Badan Geologi susceptibility zoning (Zona Kerentanan
  Gerakan Tanah), lithology/soil, land cover, a higher-resolution DEM
  (BIG DEMNAS 8 m — 90 m slopes understate local steepness).
- `soilSaturation` in the hazard-event path is still derived from 24 h rain
  (`LandslideRainfallTriggerAdapter`), not measured.

## 7. Milestone 5 — gated Stage-2 spatial nowcast (implemented, not promoted)

```
daily (not on startup) / POST /rainfall/nowcast/spatial-model/runs
   → RainfallSpatialModelService: replay every stored hour t of the last
     28 days through /predict-rain-nowcast (fields ≤ t, winds valid ≤ t)
   → per district × horizon: Stage-2 features + label (field at t + h ≥ 1 mm/h)
   → chronological split 60/20/20, embargo, identical rows merged (weights)
   → ai-engine POST /train-rain-nowcast-spatial: fit, test vs baselines, gate
   → rainfall_model_runs (coefficients, scores, verdict per horizon)
live nowcast → newest completed run's PROMOTED horizons only → method
   `spatial_logistic` alongside the three baselines
```

**Data check first.** On 2026-10-07 only 39 hourly GSMaP fields are stored
(1.6 days, one weather regime). The milestone is conditional on the data
supporting it, so the model is built as a **gated candidate**: trained and
evaluated every day, served for a horizon only once the gate passes.

### Model (`rain-nowcast-spatial-logistic-v0.1`)

One L2 logistic regression per horizon (+1/+2/+3 h), regularisation chosen
on the validation period by log-loss, refitted on train + validation.
Features (defined only in `spatial_model.py`, so training and inference
cannot drift):

| Feature | Why |
|---|---|
| `p_persistence`, `p_motion_advection`, `p_steering_wind_advection` (+ missing flags) | The Stage-1 neighbourhood fractions: here and upstream along tracked motion / 700 hPa wind |
| `log1p_current_mm_per_hour` | Rain at the point now |
| `rain_fraction_50km`, `rain_fraction_100km` | Neighbouring observations at larger scales (Part 5: neighbours over a single point) |
| `motion_tracked` | Whether the motion estimate was usable |
| `sin/cos_local_hour` | Diurnal cycle of tropical convection; integer local solar hour (UTC + lon/15) |

No leakage: features come from the engine run as it would have run at t;
labels at t + h; start hours whose labels reach into the next split are
embargoed (max horizon = 3 h). Dry, identical rows are merged with weights
(exact for the fit) to keep the payload small.

### Promotion gate (per horizon, all must hold on the test period)

- history ≥ 14 days;
- ≥ 100 rain events in the test period;
- Brier skill over climatology > 0;
- Brier skill ≥ each baseline's + 0.01, **on that baseline's own rows**.

The newest completed run decides: a later run that fails withdraws an
earlier promotion. Live nowcasts record which training run (if any) was
applied in `inputSummary.spatialModel`.

### First training run (2026-10-07, 37 start hours, 6 embargoed)

| Horizon | Test events | Model BSS | Persistence | Motion advection | Steering wind | Gate |
|---|---|---|---|---|---|---|
| +1 h | 18 | 0.105 | 0.015 | **0.216** | 0.053 | fail |
| +2 h | 17 | −0.004 | −0.080 | −0.236 | −0.137 | fail |
| +3 h | 15 | 0.005 | −0.038 | −0.039 | −0.104 | fail |

(Each baseline is compared with the model on that baseline's rows; motion
advection's rows: 3772 / 3309 / 2795.) Reading: at +1 h tracked motion is
still clearly better; at +2/+3 h every baseline forecasts worse than
climatology while the calibrated model stays near zero (it has learned that
it does not know). **18 test events in 8 hours is far too few to conclude
anything** — the gate rejects on history and event count regardless.
Coefficients at this size are not interpretable (the 50 km and 100 km
fractions are collinear).

### API (Milestone 5)

| Method | Path | Roles | Returns |
|---|---|---|---|
| GET | `/rainfall/nowcast/spatial-model/latest` | any signed-in | Latest training run: data window and split, coefficients, test scores, reliability, baseline comparisons, gate reasons |
| POST | `/rainfall/nowcast/spatial-model/runs` | admin, agency_operator | 202; background (~1–2 s per stored hour); 409 if running; audited |

Nowcast output additions: `neighbourhood.rainFractionByRadiusKm` per
district, `spatial_logistic` forecasts (only for promoted horizons),
`modelVersions.spatial`. Features are not stored with nowcast runs.
Migration: `1791370000000-AddRainfallModelRuns`.

### Open items

- Re-evaluate once ≥ 14 days are stored (≈ 2026-10-20); the daily run does
  it automatically. GSMaP_NOW keeps only 24 h on the FTP, so history exists
  only while ingestion runs — gaps shorten it.
- Truth is the same satellite product the features come from (see the
  backtest caveats in §4); gauge truth is REQUIRED DATA.
- If promoted, report reliability in the UI before presenting the
  probability as calibrated.

## 8. Milestone 6 — decision support: district outlook (implemented)

```
latest completed nowcast + flood-risk + landslide-risk runs
   + population_statistics (latest year, Dukcapil)
   → RainfallOutlookService (computed on read; nothing new stored)
   → per district: rain now / next hour, flood level, landslide level,
     severity = max(flood, landslide), exposure, recommendations
GET /rainfall/outlook[?minSeverity=…&compact=true]   GET /rainfall/outlook/:districtId
```

Prediction → risk → affected area → severity → recommended action, per the
spec, with the karhutla discipline (`lib/rainfall-recommendations.ts`,
`rainfall-rules-v0.1`): predefined rules only, every recommendation carries
its `basis` (which level, raised by which factor, which source), no LLM text,
and never an evacuation order ("Do not order evacuations on the basis of
this model alone").

| Code | When | Audience |
|---|---|---|
| `CHECK_OFFICIAL_WARNINGS` | always | responders |
| `OUTLOOK_UNAVAILABLE` | no flood or landslide level issued | responders |
| `REFRESH_OBSERVATION` | rain field not `fresh` (hourly GSMaP) | responders |
| `DEGRADED_INPUTS` | an issued level has `very_low` confidence (lists the specific reasons) | responders |
| `FLOOD_GAUGE_ALERT` | an official gauge Siaga status raised the flood level | responders |
| `FLOOD_MONITOR` / `FLOOD_PREPARE` | flood MEDIUM / HIGH+ | responders |
| `FLOOD_PUBLIC_ACTIONS` | flood HIGH+ | public |
| `LANDSLIDE_MONITOR` / `LANDSLIDE_PREPARE` | landslide MEDIUM / HIGH | responders |
| `LANDSLIDE_WARNING_SIGNS` | landslide MEDIUM+ | public |
| `MORE_RAIN_INDICATED` | a trigger is met and the +1 h nowcast probability ≥ 0.5 | responders |
| `NO_TRIGGER_DETECTED` | both LOW — explicitly "not an all-clear" | responders |

Public texts paraphrase BNPB, *Buku Saku Tanggap Tangkas Tangguh Menghadapi
Bencana* (2012): flood actions ("Ketika Terjadi Banjir": stay away from
drains, switch off electricity, move valuables up, move early to a safe
place / posko banjir, contact the village head, lurah or camat) and the main
landslide warning signs (new vertical cracks, sudden groundwater, murky well
water, small rockfalls).

Next-hour rain uses the promoted `spatial_logistic` +1 h if any, else
`motion_advection` (best +1 h baseline in §4), else `persistence`; the 0.5
threshold means "rain indicated" — the first backtest verified 33–74 % of
such forecasts. Exposure (population) orders districts (severity, then
population) and is reported, but never changes a level. The affected area is
the district point and its ~11 km rain cell (no inundation/runout model).

Each response names the run ids, model versions and rules version it was
built from, so any recommendation is reproducible from stored data.

Live check (2026-10-07): 514 districts, 45 at severity MEDIUM (landslide,
mostly the 72 h window on model rain; 1 of them also flood MEDIUM), all
rain fields `aging` (GSMaP 2 h old); ~1.3 MB for all districts,
~140 KB with `minSeverity=MEDIUM`; 400 on an invalid `minSeverity` or UUID,
404 unknown district, 401 without login.

Every recommendation also carries `textId`, the same advice in Bahasa
Indonesia (the public texts follow the Buku Saku wording more closely); the
`basis` stays English. `compact=true` drops recommendation texts and
confidence reasons but keeps `recommendationCodes` (~444 KB vs ~1.4 MB for
514 districts); the detail endpoint always returns everything.

### Web (apps/web `/rainfall`, "Rainfall Outlook" under Intelligence)

Workspace page (signed-in staff, like Karhutla Forecast): district points on
a map coloured by severity (LOW is grey, not green — not an all-clear), KPIs
(districts at Medium+, flood / landslide Medium+, fresh rain fields), a
district list filtered by minimum level or by name, and a detail panel with
rain now / +1 h / movement, population, both hazard levels with their
confidence reasons, and the recommendations with an EN / ID toggle. Source
runs, the disclaimer and the affected-area note are shown verbatim from the
API. Not on the citizen portal yet.

### Open items

- The citizen portal (`(warga)`) does not show the outlook; the dashboard's
  existing `decision_recommendations` are tied to `risk_assessments` (event
  scoring) and are not mixed with these.
- Village-level targeting needs boundaries / inundation extents (REQUIRED DATA).

## 9. Next milestones

2. ~~Rain movement baseline~~ done (§4).
3. ~~Flood-risk baseline~~ done (§5).
4. ~~Landslide baseline~~ done (§6).
5. ~~Spatial prediction~~ gated model done (§7); promotion pending data.
6. ~~Rule-grounded recommendations~~ done (§8).
7. ~~Backtesting with time-based splits~~ done (§10); full-period results
   2026-10-10.

## 10. Milestone 7 — historical backtest of the flood and landslide rules (implemented)

```
BNPB DIBI reports ──► disaster_event_labels (flood / landslide, per district, local date)
JAXA GSMaP_Gauge standard v8 hourly ──► rainfall_point_archive (514 points × UTC day × 24 h)
        │
        ▼  per month of local days (ai-engine /replay-rain-hazard-rules)
hourly levels of the SAME rules as live (vectorised) → highest level per local day
        │
        ▼  ai-engine /evaluate-rain-hazard-backtest
calibration (first 60 % of days) / test (last 40 %), 1-day embargo
        ▼
rainfall_model_runs (task rain_hazard_backtest)
```

### Labels: BNPB DIBI (found 2026-10-08)

- Source: the public DIBI dashboard (dibi.bnpb.go.id, Apache Superset). Its
  per-event table ("Tabel dampak kejadian bencana", chart 51 on dashboard 2)
  is read through the dashboard's chart-data API with the same
  dashboard/chart context the page itself sends (without it: HTTP 403).
  One request per year (`providers/dibi.client.ts`, `lib/dibi.ts`).
  data.bnpb.go.id (ODC Attribution) only offers yearly district counts.
- Per event: id, timestamp, Kemendagri district code (`33.27`, matches
  `districts.bps_code` for 505/505 districts with events), event type,
  casualties, houses flooded/damaged. Updated within days.
- Mapping: flood = Banjir, Banjir Bandang, Banjir Genangan, Banjir dan
  Tanah Longsor; landslide = Tanah Longsor, Gerakan Tanah, Banjir dan
  Tanah Longsor (one label each). **Banjir Rob (tidal) excluded.**
- Timestamps are wall-clock local time without a zone (reports peak at
  14–18 h, the local afternoon rain maximum); ~10 % are date only (00:00).
- Stored in `disaster_event_labels`, NOT `historical_disasters` (that table
  feeds the dashboard and the risk-engine's historical input, which these
  rows must not silently change). Each imported year is mirrored (upsert +
  removal of records DIBI dropped).
- First import (2026-10-08, 2023–2026): 8,938 reports → 9,002 labels
  (63 Banjir Rob skipped, 0 unknown districts). Flood 1,225 / 1,547 / 3,093
  / 670 and landslide 699 / 224 / 1,212 / 332 for 2023 / 2024 / 2025 / 2026.

### Rainfall: GSMaP_Gauge standard archive

- JAXA FTP `/standard/v8/hourly_G/YYYY/MM/DD/`, same grid as GSMaP_NOW;
  file time = start of the hour (format description §3.1); gauge-adjusted
  with the NOAA CPC daily gauge analysis; 3-day latency.
- Only the cell under each district point is kept, one row per UTC day
  (`hourly_mm[24]`). A day is written only when all its files were read;
  recent, partly published days are retried later.
- Bulk: `npm run rainfall:archive [-- --from … --to … --max-days … --connections 1-6]`,
  run outside the API (resumable). Measured: ~2 min/day over one FTP
  connection, ~70 s/day with 3 (the default; 6 gained little). From
  2024-01-01 that is ~1,000 days ≈ 20 h. The API adds new days daily
  (`GSMAP_ARCHIVE_DAYS_PER_RUN`, default 4).
- **Not the live input:** live levels use GSMaP_Gauge_NOW (near real
  time, coarser gauge adjustment); live skill may be lower than backtested.

### Replay and evaluation

- The vectorised replay (`app/ml/rainfall/hazard_backtest.py`) is tested to
  give the same hourly level and rain-only trigger as `assess_point` of
  both rules on random series with gaps.
- Local day = civil date in the district's time zone (WIB/WITA/WIT by
  province, Keppres 41/1987); the hour ending 01:00 local is a day's first.
  A day's level = highest hourly level, issued only if ≥ 20 of 24 hours had
  a level. Static inputs are today's (InaRISK index + national terciles,
  DEM slope where sampled); no historical gauge status, so the live flood
  rule's gauge floor never applies.
- Scores per hazard and split: POD, FAR, CSI, frequency bias, lift
  (P(event | warning) / base rate) at ≥ MEDIUM / HIGH / EXTREME, for the
  rule and for its rain-only trigger (ablation of the susceptibility /
  terrain adjustment), same-day and ±1 day (report dates are uncertain);
  persistence (warn after a reported day) as a baseline; event rate per
  level with Wilson 95 % intervals; and, on the test period, the levels
  mapped to calibration-period event rates, Brier-scored against district
  climatology, national climatology and persistence.
- **Reported events only:** an unreported event counts as none, so FAR is
  an upper bound and POD / CSI lower bounds, worst where reporting is thin.

### API (Milestone 7)

| Method | Path | Notes |
|---|---|---|
| GET | `/rainfall/labels/summary` | labels per hazard and year, date-only share |
| POST | `/rainfall/labels/runs` | 202; DIBI import (full if empty, else last two years) |
| GET | `/rainfall/archive/status` | archived days, missing district-hours |
| POST | `/rainfall/archive/runs` | 202; adds up to `GSMAP_ARCHIVE_DAYS_PER_RUN` days |
| GET | `/rainfall/backtest/hazard/latest` | latest backtest run (scores in `results`) |
| POST | `/rainfall/backtest/hazard/runs` | 202; replay + evaluation |

Daily (not on startup): labels refresh → archive top-up → backtest run.
Config: `GSMAP_ARCHIVE_FROM` (2024-01-01), `GSMAP_ARCHIVE_DAYS_PER_RUN` (4),
`DIBI_LABELS_FROM_YEAR` (2023).

### Results

**Full period (run 2026-10-10, `97d1a4d1`).** Archive 2024-01-01 →
2026-10-07 complete (1,011 UTC days, 0 missing district-hours); 1,006 local
days × 514 districts. Calibration 2024-01-06 → 2025-08-29 (309,428
evaluable district-days, 3,352 flood / 1,073 landslide event-days); test
2025-08-31 → 2026-10-07 (207,142; 1,384 / 511). DEM slope known for 180
districts, InaRISK flood index for 293.

| Test period | Warnings | POD | FAR | CSI | Bias | Lift |
|---|---|---|---|---|---|---|
| Flood ≥ MEDIUM | 6,508 | 0.14 | 0.97 | 0.025 | 4.7 | 4.5 |
| Flood ≥ HIGH | 1,272 | 0.03 | 0.96 | 0.018 | 0.9 | 5.5 |
| Flood EXTREME | 346 | 0.01 | 0.96 | 0.008 | 0.25 | 6.1 |
| Landslide ≥ MEDIUM | 68,572 | 0.56 | 0.996 | 0.004 | 134 | 1.7 |
| Landslide ≥ HIGH | 876 | 0.02 | 0.99 | 0.009 | 1.7 | 5.6 |
| Landslide EXTREME | 0 | — | — | — | — | — |

Event rate per level (district-days with a report; Wilson 95 % CI):

| Level | Flood calibration | Flood test | Landslide calibration | Landslide test |
|---|---|---|---|---|
| LOW | 0.98 % | 0.59 % (0.56–0.63) | 0.23 % | 0.16 % (0.14–0.19) |
| MEDIUM | 3.9 % | 2.8 % (2.4–3.3) | 0.51 % | 0.40 % (0.36–0.45) |
| HIGH | 7.0 % | 3.6 % (2.5–5.0) | 1.6 % | 1.4 % (0.8–2.4) |
| EXTREME | 13 % (193 days) | 4.0 % (2.4–6.7) | never issued | never issued |

Base rates (test): flood 0.67 %, landslide 0.25 % of district-days
(calibration 1.08 % / 0.35 %).

- **Flood:** the levels rank risk in both periods (event rate rises
  monotonically LOW → EXTREME; lift 4.5–6 on the test period), but the
  separation is weaker than in calibration and than the 83-day preliminary
  sample suggested (HIGH 15 % there, 3.6 % here). Most reported floods fall
  on LOW days (POD 0.14 at ≥ MEDIUM). As probabilities the levels add
  nothing over each district's own climatology (BSS −0.0003; +0.0016 vs
  national climatology, −0.0016 vs persistence). The InaRISK downgrade
  lowers POD (rain-only 0.17 vs 0.14 at ≥ MEDIUM) for the same lift: no
  measurable benefit.
- **Landslide:** the Guzzetti 2008 minimum curve (MEDIUM) is exceeded on
  33 % (test) to 39 % (calibration) of district-days, frequency bias ~134,
  lift 1.7: as a level it carries almost no information. HIGH (Caine 1980)
  has lift 5.6 but catches 2 % of reported landslides; EXTREME was never
  issued in 1,006 days. As probabilities: BSS −0.014 vs district
  climatology. Confirms the preliminary finding over all seasons: the
  global intensity–duration curves need regional calibration before they
  are used as levels. **No threshold was changed.**
- Persistence (warn the day after a reported day) has the highest lift
  (flood 9.6, landslide 43) at low POD (0.06 / 0.11): reports cluster in
  multi-day episodes. Its tolerant (±1 day) scores are trivially ~1 by
  construction and are not meaningful.
- The test period has a lower report rate than calibration (flood 0.67 %
  vs 1.08 %) — a drier season and/or reporting differences; part of the
  drop in skill may come from the labels, not the rules.

Superseded: preliminary 83-day result (2026-10-08, Jan–Mar 2024 only),
whose flood HIGH rate (15 %) did not hold over the full period.

### Open items

- Live levels still carry `probability: null`. The test-period event rates
  per level are the evidence a later step could publish as calibrated
  frequencies, once the backtest covers enough events.
- DIBI timestamp zone is inferred, not documented by BNPB.

