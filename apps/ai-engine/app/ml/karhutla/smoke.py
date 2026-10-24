"""Qualitative smoke-transport footprint for one fire cluster.

A seeded Lagrangian particle ensemble — the same family of method as
HYSPLIT's particle mode, drastically simplified because AETHER has no
ARL-format meteorology, emission inventory or plume-rise inputs:

- Release: N particles released at evenly spaced times from the newest
  hotspot observation (looking back at most 12 h) to the last horizon,
  assuming the fire keeps burning at constant strength. Release height is
  uniform within the forecast boundary layer at the source — no plume-rise
  model (smouldering peat smoke typically stays in the boundary layer;
  vigorous flaming plumes that punch above it are not represented).
- Advection: 10-minute steps through a multi-level wind field: inverse-
  distance weighting over the 4 nearest grid points (u/v components,
  never raw angles), linear in time and in height between levels.
- Dispersion: horizontal random walk with constant diffusivity K_h, plus a
  per-particle wind speed/direction perturbation representing NWP forecast
  uncertainty. Hourly re-mixing of particles below the boundary-layer top
  (well-mixed boundary layer); particles above it stay put (residual
  layer).
- Output: per horizon, grid cells ranked by particle count into nested
  highest-density classes holding 50% ("core") and 80% ("likely") of
  airborne particles, plus every cell with >= 2 particles ("possible").
  Shares of *simulated particles* — never concentrations.

Deterministic: identical request + seed produce identical output.
"""

import math
from datetime import timedelta

import numpy as np

from app.ml.karhutla.geometry import LocalFrame, bearing_of
from app.ml.karhutla.units import wind_to_uv
from app.schemas.karhutla import (
    SmokeFootprintClass,
    SmokeHorizon,
    SmokeTransportRequest,
    SmokeTransportResponse,
)

MODEL_VERSION = "karhutla-smoke-lagrangian-v0.1"
METHOD = (
    "Seeded Lagrangian particle ensemble: IDW-interpolated multi-level NWP wind, "
    "well-mixed boundary layer, constant horizontal diffusivity, wind perturbation"
)

TIME_STEP = timedelta(minutes=10)
STEPS_PER_REMIX = 6
HORIZONTAL_DIFFUSIVITY_M2_S = 2500.0
WIND_SPEED_PERTURBATION = 0.15
WIND_DIRECTION_PERTURBATION_DEG = 10.0
MIN_RELEASE_HEIGHT_M = 10.0
MIN_MIXING_HEIGHT_M = 200.0
FALLBACK_MIXING_HEIGHT_M = 1000.0
MAX_RELEASE_LOOKBACK = timedelta(hours=12)
MAX_OBSERVATION_AGE = timedelta(hours=24)
IDW_NEIGHBOURS = 4
CORE_SHARE = 0.5
LIKELY_SHARE = 0.8
MIN_PARTICLES_PER_POSSIBLE_CELL = 2
RAIN_WARNING_MM_PER_H = 1.0

LIMITATIONS = [
    "Qualitative transport footprint: shading is the relative density of simulated "
    "particles, not PM2.5/ISPU concentration, visibility or health exposure.",
    "Emission strength, plume rise and injection height are not modelled; smoke is "
    "released uniformly within the forecast boundary layer.",
    "Assumes the fire keeps burning at constant strength through the forecast window.",
    "Driven by global NWP forecast winds interpolated from a coarse point grid; land/sea "
    "breezes, terrain channelling and convective outflow are not resolved.",
    "Wet deposition (rain-out), dry deposition and smoke chemistry are not modelled.",
    "Not validated against observed smoke (satellite aerosol products, PM2.5 monitors).",
]


class _Field:
    """Atmosphere grid as dense arrays: positions (P,), times (T,), and
    per point/time/level u, v, height (P,T,L), boundary layer (P,T)."""

    def __init__(self, request: SmokeTransportRequest, frame: LocalFrame):
        time_sets = [{h.time for h in point.hours} for point in request.atmosphere]
        common = sorted(set.intersection(*time_sets))
        if not common:
            raise ValueError("Atmosphere points share no common forecast times")
        self.times = common
        self.times_s = np.array([t.timestamp() for t in common])
        n_levels = max(len(h.levels) for p in request.atmosphere for h in p.hours)
        shape = (len(request.atmosphere), len(common), n_levels)
        self.u = np.zeros(shape)
        self.v = np.zeros(shape)
        self.height = np.zeros(shape)
        self.blh = np.full(shape[:2], np.nan)
        self.precip = np.zeros(shape[:2])
        xy = []
        index_of = {t: i for i, t in enumerate(common)}
        for p, point in enumerate(request.atmosphere):
            xy.append(frame.to_xy(point.latitude, point.longitude))
            for hour in point.hours:
                if hour.time not in index_of:
                    continue
                t = index_of[hour.time]
                levels = sorted(hour.levels, key=lambda lv: lv.height_agl_m)
                # Pad short level lists by repeating the top level so every
                # (p, t) has L monotonic heights.
                levels += [levels[-1]] * (n_levels - len(levels))
                for lv_i, level in enumerate(levels):
                    u, v = wind_to_uv(level.wind_speed_kmh, level.wind_from_deg)
                    self.u[p, t, lv_i] = u
                    self.v[p, t, lv_i] = v
                    self.height[p, t, lv_i] = level.height_agl_m + lv_i * 1e-3
                if hour.boundary_layer_height_m is not None:
                    self.blh[p, t] = hour.boundary_layer_height_m
                self.precip[p, t] = hour.precipitation_mm or 0.0
        self.gx = np.array([c[0] for c in xy])
        self.gy = np.array([c[1] for c in xy])
        self.missing_blh = bool(np.isnan(self.blh).any())
        self.domain_radius_km = float(np.max(np.hypot(self.gx, self.gy))) if len(xy) > 1 else 0.0

    def covers(self, start_s: float, end_s: float) -> bool:
        return self.times_s[0] <= start_s and end_s <= self.times_s[-1]

    def at_time(self, t_s: float):
        if len(self.times_s) == 1:
            i, f = 0, 0.0
            j = 0
        else:
            i = int(np.clip(np.searchsorted(self.times_s, t_s, side="right") - 1, 0, len(self.times_s) - 2))
            j = i + 1
            f = float(np.clip((t_s - self.times_s[i]) / (self.times_s[j] - self.times_s[i]), 0.0, 1.0))
        u = self.u[:, i] * (1 - f) + self.u[:, j] * f
        v = self.v[:, i] * (1 - f) + self.v[:, j] * f
        h = self.height[:, i] * (1 - f) + self.height[:, j] * f
        b0, b1 = self.blh[:, i], self.blh[:, j]
        blh = np.where(np.isnan(b0), b1, np.where(np.isnan(b1), b0, b0 * (1 - f) + b1 * f))
        blh = np.where(np.isnan(blh), FALLBACK_MIXING_HEIGHT_M, blh)
        return u, v, h, blh

    def weights(self, x: np.ndarray, y: np.ndarray):
        d2 = (x[:, None] - self.gx[None, :]) ** 2 + (y[:, None] - self.gy[None, :]) ** 2
        k = min(IDW_NEIGHBOURS, len(self.gx))
        idx = np.argpartition(d2, k - 1, axis=1)[:, :k]
        w = 1.0 / np.maximum(np.take_along_axis(d2, idx, axis=1), 1e-6)
        return idx, w / w.sum(axis=1, keepdims=True)


def _interp_levels(heights: np.ndarray, values: np.ndarray, z: np.ndarray) -> np.ndarray:
    """Per-particle linear interpolation in height; clamps outside the levels."""
    result = values[:, 0].copy()
    above_top = z >= heights[:, -1]
    result[above_top] = values[above_top, -1]
    for lv in range(heights.shape[1] - 1):
        lo, hi = heights[:, lv], heights[:, lv + 1]
        inside = (z >= lo) & (z < hi)
        frac = np.where(inside, (z - lo) / np.maximum(hi - lo, 1e-6), 0.0)
        result = np.where(inside, values[:, lv] + frac * (values[:, lv + 1] - values[:, lv]), result)
    return result


def _cells_to_multipolygon(frame: LocalFrame, cells: list[tuple[int, int]], size: float) -> dict | None:
    if not cells:
        return None
    rows: dict[int, list[int]] = {}
    for ix, iy in cells:
        rows.setdefault(iy, []).append(ix)
    polygons = []
    for iy in sorted(rows):
        xs = sorted(rows[iy])
        start = prev = xs[0]
        for ix in xs[1:] + [None]:
            if ix is not None and ix == prev + 1:
                prev = ix
                continue
            x0, x1, y0, y1 = start * size, (prev + 1) * size, iy * size, (iy + 1) * size
            ring = []
            for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]:
                lat, lon = frame.to_latlon(x, y)
                ring.append([round(lon, 5), round(lat, 5)])
            polygons.append([ring])
            if ix is not None:
                start = prev = ix
    return {"type": "MultiPolygon", "coordinates": polygons}


def _footprint(frame: LocalFrame, x: np.ndarray, y: np.ndarray):
    n = len(x)
    dist = np.hypot(x, y)
    p90 = float(np.percentile(dist, 90))
    cell = float(np.clip(p90 / 20.0, 1.5, 10.0))
    ix = np.floor(x / cell).astype(int)
    iy = np.floor(y / cell).astype(int)
    counts: dict[tuple[int, int], int] = {}
    for key in zip(ix.tolist(), iy.tolist()):
        counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))

    def take(share: float) -> list[tuple[int, int]]:
        chosen, total = [], 0
        for key, count in ranked:
            chosen.append(key)
            total += count
            if total >= share * n:
                break
        return chosen

    core = take(CORE_SHARE)
    likely = take(LIKELY_SHARE)
    possible = [key for key, count in ranked if count >= MIN_PARTICLES_PER_POSSIBLE_CELL]
    if len(possible) < len(likely):
        possible = likely
    classes = []
    for level, keys in (("core", core), ("likely", likely), ("possible", possible)):
        classes.append(
            SmokeFootprintClass(
                level=level,
                particle_share=round(sum(counts[k] for k in keys) / n, 3),
                geometry=_cells_to_multipolygon(frame, keys, cell),
                area_km2=round(len(keys) * cell * cell, 2),
            )
        )
    return classes, cell, p90


def predict_smoke(request: SmokeTransportRequest) -> SmokeTransportResponse:
    source = request.source
    frame = LocalFrame(source.latitude, source.longitude)
    field = _Field(request, frame)
    rng = np.random.default_rng(request.seed)
    warnings: list[str] = []

    issued = request.issued_at
    latest = source.latest_observation_at
    age = issued - latest
    valid_times = {h: issued + timedelta(hours=h) for h in request.horizons_hours}
    end = valid_times[max(request.horizons_hours)]

    if age > MAX_OBSERVATION_AGE:
        return _stale_response(request, valid_times)

    release_start = max(latest, issued - MAX_RELEASE_LOOKBACK)
    if release_start.timestamp() < field.times_s[0]:
        release_start = field.times[0]
        warnings.append("Wind data starts after the hotspot observation; smoke released from the first wind hour.")
    # Align the simulation clock so issuedAt and every valid time land on a step.
    steps_back = math.ceil((issued - release_start) / TIME_STEP)
    sim_start = issued - steps_back * TIME_STEP
    if sim_start.timestamp() < field.times_s[0]:
        sim_start += TIME_STEP

    covered = {h: field.covers(sim_start.timestamp(), t.timestamp()) for h, t in valid_times.items()}
    sim_end = max([t for h, t in valid_times.items() if covered[h]], default=None)

    n = request.particles
    release_s = sim_start.timestamp() + (np.arange(n) + 0.5) / n * (end.timestamp() - sim_start.timestamp())
    angle = rng.uniform(0, 2 * math.pi, n)
    radius = source.source_radius_km * np.sqrt(rng.uniform(0, 1, n))
    x = radius * np.sin(angle)
    y = radius * np.cos(angle)
    z = np.zeros(n)
    active = np.zeros(n, dtype=bool)
    speed_factor = np.clip(rng.normal(1.0, WIND_SPEED_PERTURBATION, n), 0.5, 1.5)
    dir_offset = np.radians(rng.normal(0.0, WIND_DIRECTION_PERTURBATION_DEG, n))
    cos_o, sin_o = np.cos(dir_offset), np.sin(dir_offset)
    dt_s = TIME_STEP.total_seconds()
    sigma_km = math.sqrt(2.0 * HORIZONTAL_DIFFUSIVITY_M2_S * dt_s) / 1000.0
    source_idx, source_w = field.weights(np.zeros(1), np.zeros(1))

    snapshots: dict[int, tuple] = {}
    horizon_at_step = {
        round((t - sim_start) / TIME_STEP): h for h, t in valid_times.items() if covered[h]
    }
    total_steps = round((sim_end - sim_start) / TIME_STEP) if sim_end else 0

    for step in range(total_steps):
        t0_s = sim_start.timestamp() + step * dt_s
        u_g, v_g, h_g, blh_g = field.at_time(t0_s + dt_s / 2)

        newly = (~active) & (release_s < t0_s + dt_s)
        if newly.any():
            source_blh = max(float((source_w * blh_g[source_idx]).sum()), MIN_MIXING_HEIGHT_M)
            z[newly] = rng.uniform(MIN_RELEASE_HEIGHT_M, source_blh, int(newly.sum()))
            active |= newly

        idx_a = np.flatnonzero(active)
        if idx_a.size:
            gi, gw = field.weights(x[idx_a], y[idx_a])
            heights = np.einsum("nk,nkl->nl", gw, h_g[gi])
            u = _interp_levels(heights, np.einsum("nk,nkl->nl", gw, u_g[gi]), z[idx_a])
            v = _interp_levels(heights, np.einsum("nk,nkl->nl", gw, v_g[gi]), z[idx_a])
            sf, co, so = speed_factor[idx_a], cos_o[idx_a], sin_o[idx_a]
            # Rotate (u, v) clockwise by the per-particle offset, then scale.
            u_p = sf * (u * co + v * so)
            v_p = sf * (-u * so + v * co)
            dt_h = dt_s / 3600.0
            x[idx_a] += u_p * dt_h + rng.normal(0.0, sigma_km, idx_a.size)
            y[idx_a] += v_p * dt_h + rng.normal(0.0, sigma_km, idx_a.size)

            if (step + 1) % STEPS_PER_REMIX == 0:
                blh_p = np.maximum(np.einsum("nk,nk->n", gw, blh_g[gi]), MIN_MIXING_HEIGHT_M)
                mixed = z[idx_a] <= blh_p
                z[idx_a[mixed]] = rng.uniform(MIN_RELEASE_HEIGHT_M, blh_p[mixed])

        if (step + 1) in horizon_at_step:
            snap_s = t0_s + dt_s
            *_, blh_snap = field.at_time(snap_s)
            snapshots[horizon_at_step[step + 1]] = (x[active].copy(), y[active].copy(), z[active].copy(), blh_snap)

    horizons = []
    for h in request.horizons_hours:
        valid_at = valid_times[h]
        if not covered[h] or h not in snapshots:
            horizons.append(
                SmokeHorizon(
                    horizon_hours=h,
                    valid_at=valid_at,
                    status="insufficient_data",
                    particles_airborne=0,
                    notes=["Wind forecast does not cover this horizon; no footprint produced."],
                )
            )
            continue
        px, py, pz, blh_snap = snapshots[h]
        if px.size < 20:
            horizons.append(
                SmokeHorizon(
                    horizon_hours=h,
                    valid_at=valid_at,
                    status="insufficient_data",
                    particles_airborne=int(px.size),
                    notes=["Too few particles released by this time for a meaningful footprint."],
                )
            )
            continue
        classes, cell, p90 = _footprint(frame, px, py)
        cx, cy = float(px.mean()), float(py.mean())
        clat, clon = frame.to_latlon(cx, cy)
        gi, gw = field.weights(px, py)
        blh_p = np.einsum("nk,nk->n", gw, blh_snap[gi])
        outside = (
            float(np.mean(np.hypot(px, py) > field.domain_radius_km)) if field.domain_radius_km > 0 else 1.0
        )
        notes = []
        if math.hypot(cx, cy) < 1.0:
            notes.append("Smoke largely stagnant near the source under light or variable wind.")
        if outside > 0.2:
            notes.append(f"{outside:.0%} of particles left the wind grid; their winds are extrapolated.")
        horizons.append(
            SmokeHorizon(
                horizon_hours=h,
                valid_at=valid_at,
                status="ok",
                particles_airborne=int(px.size),
                footprint=classes,
                cell_size_km=round(cell, 2),
                centroid={"type": "Point", "coordinates": [round(clon, 5), round(clat, 5)]},
                transport_bearing_deg=round(bearing_of(cx, cy), 1) if math.hypot(cx, cy) >= 1.0 else None,
                p90_distance_km=round(p90, 2),
                share_above_boundary_layer=round(float(np.mean(pz > blh_p)), 3),
                share_outside_wind_domain=round(outside, 3),
                notes=notes,
            )
        )

    # Input deficiencies degrade confidence; rain only biases the footprint
    # toward overstating smoke (conservative), so it is a warning alone.
    degrading: list[str] = list(warnings)
    if field.missing_blh:
        degrading.append(
            f"Boundary-layer height missing for some grid hours; {FALLBACK_MIXING_HEIGHT_M:.0f} m assumed."
        )
    if age > timedelta(hours=12):
        degrading.append(f"Newest hotspot is {age.total_seconds() / 3600:.1f} h old; the fire may have changed.")
    if len(field.gx) < 4:
        degrading.append("Fewer than 4 wind grid points; spatial wind variation is barely represented.")
    warnings = degrading.copy()
    window = (field.times_s >= sim_start.timestamp()) & (field.times_s <= end.timestamp())
    if window.any() and float(field.precip[:, window].max()) >= RAIN_WARNING_MM_PER_H:
        warnings.append(
            "Rain forecast in the domain during the forecast window; rain-out is not modelled, "
            "so the footprint may overstate smoke."
        )

    degraded = bool(degrading) or any(h.status != "ok" for h in horizons) or any(
        (h.share_outside_wind_domain or 0) > 0.2 for h in horizons
    )
    return SmokeTransportResponse(
        model_version=MODEL_VERSION,
        method=METHOD,
        qualitative=True,
        horizons=horizons,
        confidence="very_low" if degraded else "low",
        warnings=warnings,
        limitations=LIMITATIONS,
        assumptions=_assumptions(request),
    )


def _assumptions(request: SmokeTransportRequest) -> dict[str, float | str]:
    return {
        "particles": float(request.particles),
        "seed": float(request.seed),
        "timeStepMinutes": TIME_STEP.total_seconds() / 60.0,
        "horizontalDiffusivityM2PerS": HORIZONTAL_DIFFUSIVITY_M2_S,
        "windSpeedPerturbation": WIND_SPEED_PERTURBATION,
        "windDirectionPerturbationDeg": WIND_DIRECTION_PERTURBATION_DEG,
        "fallbackMixingHeightM": FALLBACK_MIXING_HEIGHT_M,
        "releaseHeight": "uniform within boundary layer",
        "emission": "constant, unquantified",
    }


def _stale_response(request: SmokeTransportRequest, valid_times: dict) -> SmokeTransportResponse:
    return SmokeTransportResponse(
        model_version=MODEL_VERSION,
        method=METHOD,
        qualitative=True,
        horizons=[
            SmokeHorizon(
                horizon_hours=h,
                valid_at=valid_times[h],
                status="insufficient_data",
                particles_airborne=0,
                notes=["Newest hotspot older than 24 h; no footprint produced."],
            )
            for h in request.horizons_hours
        ],
        confidence="very_low",
        warnings=["Newest hotspot older than 24 h."],
        limitations=LIMITATIONS,
        assumptions=_assumptions(request),
    )
