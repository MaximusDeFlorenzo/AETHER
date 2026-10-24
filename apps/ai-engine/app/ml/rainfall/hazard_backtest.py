"""Milestone 7 (docs/RAINFALL_INTELLIGENCE.md §10): historical backtest of the
rule-based flood and landslide baselines.

`replay` recomputes the hourly levels of `flood_risk.assess_point` and
`landslide_risk.assess_point` over an archived hourly rain series, vectorised
(one hour per column instead of one HTTP request per hour), and reduces them
to one level per local day: the highest level issued that day. The two
implementations must agree; tests/test_rainfall_hazard_backtest.py checks
replay against assess_point on random inputs.

`evaluate` scores those day levels against reported events (BNPB DIBI) on a
chronological calibration / test split. Reports are incomplete (an
unreported event counts as "no event") and their dates are uncertain, so
contingency scores are given both same-day and with ±tolerance days, and
every number is a lower bound on what the rules would score against a
complete event record.
"""

import base64
import math
from datetime import datetime, timedelta, timezone

import numpy as np

from app.ml.rainfall.flood_risk import MODEL_VERSION as FLOOD_MODEL_VERSION
from app.ml.rainfall.flood_risk import susceptibility_class
from app.ml.rainfall.landslide_risk import MODEL_VERSION as LANDSLIDE_MODEL_VERSION
from app.ml.rainfall.landslide_risk import id_threshold_mm, terrain_class
from app.schemas.rainfall_backtest import (
    LEVEL_NAMES,
    BacktestHazardIn,
    Contingency,
    HazardBacktestOut,
    ProbabilisticScore,
    RainHazardBacktestRequest,
    RainHazardBacktestResponse,
    RainHazardReplayRequest,
    RainHazardReplayResponse,
    RateRow,
    ReplayPointOut,
    SplitScore,
    ThresholdScore,
)
from app.schemas.rainfall_landslide import LandslideTerrainIn

MODEL_VERSION = "rain-hazard-backtest-v0.1"
MAX_WINDOW_HOURS = 72
NOT_ISSUED = -1


# --- replay -------------------------------------------------------------


def decode_matrix(data_b64: str, rows: int, cols: int, dtype: str) -> np.ndarray:
    raw = base64.b64decode(data_b64, validate=True)
    itemsize = np.dtype(dtype).itemsize
    if len(raw) != rows * cols * itemsize:
        raise ValueError(f"matrix has {len(raw)} bytes, expected {rows * cols * itemsize} ({rows} x {cols})")
    return np.frombuffer(raw, dtype=dtype).reshape(rows, cols)


def encode_matrix(matrix: np.ndarray, dtype: str) -> str:
    return base64.b64encode(np.ascontiguousarray(matrix, dtype=dtype).tobytes()).decode("ascii")


def window_totals(rain: np.ndarray, hours: int) -> np.ndarray:
    """Sum of the `hours` columns ending at each column, NaN unless every one
    is present (lib/features.ts `accumulate`: an incomplete window has no
    total). Rounded to 0.01 mm like the live totals."""
    finite = np.isfinite(rain)
    filled = np.where(finite, rain, 0.0)
    zeros = np.zeros((rain.shape[0], 1))
    csum = np.concatenate([zeros, np.cumsum(filled, axis=1)], axis=1)
    ccount = np.concatenate([zeros, np.cumsum(finite, axis=1)], axis=1)
    out = np.full(rain.shape, np.nan)
    if rain.shape[1] >= hours:
        total = csum[:, hours:] - csum[:, :-hours]
        count = ccount[:, hours:] - ccount[:, :-hours]
        out[:, hours - 1 :] = np.where(count == hours, np.round(total, 2), np.nan)
    return out


def max_last_hours(rain: np.ndarray, hours: int) -> np.ndarray:
    """Highest available value among the last `hours` columns (a lower bound
    when some are missing, as in lib/flood-inputs.ts); NaN if none is."""
    out = np.full(rain.shape, np.nan)
    for lag in range(hours):
        shifted = np.full(rain.shape, np.nan)
        shifted[:, lag:] = rain[:, : rain.shape[1] - lag]
        out = np.fmax(out, shifted)
    return out


def flood_levels(rain: np.ndarray, s_class: list[str], params) -> tuple[np.ndarray, np.ndarray]:
    """Hourly (level, rain-only trigger) codes of flood_risk.assess_point for
    points without a river gauge (none is archived)."""
    max_hourly = max_last_hours(rain, 3)
    total_24 = window_totals(rain, 24)
    hourly = np.select(
        [max_hourly > params.hourly_sangat_lebat_mm, max_hourly >= params.hourly_lebat_mm], [2, 1], 0
    )
    daily = np.select(
        [total_24 > params.daily_ekstrem_mm, total_24 >= params.daily_sangat_lebat_mm, total_24 >= params.daily_lebat_mm],
        [3, 2, 1],
        0,
    )
    trigger = np.maximum(hourly, daily)
    issued = np.isfinite(max_hourly) | np.isfinite(total_24)
    lower = np.array([c == "low" for c in s_class])[:, None] & params.downgrade_low_susceptibility
    level = np.where(lower & (trigger > 0), trigger - 1, trigger)
    return np.where(issued, level, NOT_ISSUED), np.where(issued, trigger, NOT_ISSUED)


def landslide_levels(rain: np.ndarray, t_class: list[str], params) -> tuple[np.ndarray, np.ndarray]:
    """Hourly (level, rain-only trigger) codes of landslide_risk.assess_point,
    every window taken from the one archived series."""
    trigger = np.zeros(rain.shape, dtype=np.int64)
    evaluated = np.zeros(rain.shape, dtype=bool)
    for hours in params.trigger_windows_hours:
        total = window_totals(rain, hours)
        lower = id_threshold_mm(params.lower_id_alpha, params.lower_id_beta, hours)
        upper = id_threshold_mm(params.upper_id_alpha, params.upper_id_beta, hours)
        window_level = np.select([total >= upper, total >= lower], [2, 1], 0)
        trigger = np.maximum(trigger, np.where(np.isfinite(total), window_level, 0))
        evaluated |= np.isfinite(total)
    gentle = np.array([c == "low" for c in t_class])[:, None] & params.downgrade_gentle_terrain
    level = np.where(gentle & (trigger > 0), trigger - 1, trigger)
    return np.where(evaluated, level, NOT_ISSUED), np.where(evaluated, trigger, NOT_ISSUED)


def daily_max(hourly: np.ndarray, starts: np.ndarray, days: int, min_issued: int) -> np.ndarray:
    """Per point, the highest code over each block of 24 columns beginning at
    starts[p]; NOT_ISSUED when fewer than `min_issued` hours were issued."""
    index = starts[:, None] + np.arange(days * 24)[None, :]
    block = np.take_along_axis(hourly, index, axis=1).reshape(hourly.shape[0], days, 24)
    issued = (block != NOT_ISSUED).sum(axis=2)
    return np.where(issued >= min_issued, block.max(axis=2), NOT_ISSUED)


def replay(request: RainHazardReplayRequest) -> RainHazardReplayResponse:
    n = len(request.points)
    rain = decode_matrix(request.data_b64, n, request.hours, "<f4").astype(np.float64)
    if request.series_start.tzinfo is None:
        raise ValueError("seriesStart must carry a UTC offset")
    start = request.series_start.astimezone(timezone.utc)
    if start.minute or start.second or start.microsecond:
        raise ValueError("seriesStart must be on the hour")

    # The hour ending at local 01:00 is the first of a local day; the hour
    # ending at local 24:00 its last.
    midnight = datetime(request.first_day.year, request.first_day.month, request.first_day.day, tzinfo=timezone.utc)
    starts = np.array(
        [
            int((midnight - timedelta(hours=p.utc_offset_hours) + timedelta(hours=1) - start).total_seconds() // 3600)
            for p in request.points
        ]
    )
    if starts.min() < MAX_WINDOW_HOURS - 1:
        raise ValueError(f"series must start at least {MAX_WINDOW_HOURS - 1} h before the first local day")
    if starts.max() + request.days * 24 > request.hours:
        raise ValueError("series ends before the last requested local day")

    s_class = [
        susceptibility_class(p.flood_hazard_index, request.flood_parameters.susceptibility_breaks)
        for p in request.points
    ]
    t_class = [
        terrain_class(
            LandslideTerrainIn(source="replay", dem="replay", slope_samples_deg=p.slope_samples_deg)
            if p.slope_samples_deg
            else None,
            request.landslide_parameters,
        )[0]
        for p in request.points
    ]
    flood, flood_trigger = flood_levels(rain, s_class, request.flood_parameters)
    slide, slide_trigger = landslide_levels(rain, t_class, request.landslide_parameters)
    m = request.min_hours_issued_per_day
    reduce = lambda x: daily_max(x, starts, request.days, m)  # noqa: E731
    out = [reduce(x) for x in (flood, flood_trigger, slide, slide_trigger)]
    return RainHazardReplayResponse(
        model_versions={"flood": FLOOD_MODEL_VERSION, "landslide": LANDSLIDE_MODEL_VERSION},
        first_day=request.first_day,
        days=request.days,
        points=[
            ReplayPointOut(
                id=p.id,
                flood_level=out[0][i].tolist(),
                flood_trigger=out[1][i].tolist(),
                landslide_level=out[2][i].tolist(),
                landslide_trigger=out[3][i].tolist(),
            )
            for i, p in enumerate(request.points)
        ],
    )


# --- evaluation ---------------------------------------------------------


def _ratio(a: float, b: float) -> float | None:
    return round(a / b, 4) if b else None


def near(matrix: np.ndarray, days: int) -> np.ndarray:
    """True where `matrix` is true within ±days along the day axis."""
    out = matrix.copy()
    for k in range(1, days + 1):
        out[:, k:] |= matrix[:, :-k]
        out[:, :-k] |= matrix[:, k:]
    return out


def contingency(warn: np.ndarray, event: np.ndarray, mask: np.ndarray, tolerance: int) -> Contingency:
    """Scores over the `mask` cells; tolerant matching looks at neighbouring
    days inside the same mask only."""
    w, e = warn & mask, event & mask
    hits = int((w & e).sum())
    misses = int((~w & e).sum())
    false_alarms = int((w & ~e).sum())
    cells = int(mask.sum())
    correct = cells - hits - misses - false_alarms
    events, warnings = hits + misses, hits + false_alarms
    base = events / cells if cells else 0
    precision = hits / warnings if warnings else None
    detected = int((e & near(w, tolerance)).sum())
    verified = int((w & near(e, tolerance)).sum())
    return Contingency(
        hits=hits,
        misses=misses,
        false_alarms=false_alarms,
        correct_negatives=correct,
        pod=_ratio(hits, events),
        far=_ratio(false_alarms, warnings),
        csi=_ratio(hits, hits + misses + false_alarms),
        frequency_bias=_ratio(warnings, events),
        lift=round(precision / base, 3) if precision is not None and base else None,
        pod_tolerant=_ratio(detected, events),
        far_tolerant=_ratio(warnings - verified, warnings),
    )


def wilson(events: int, cells: int, z: float = 1.96) -> list[float] | None:
    if cells == 0:
        return None
    p = events / cells
    denom = 1 + z * z / cells
    centre = (p + z * z / (2 * cells)) / denom
    half = z * math.sqrt(p * (1 - p) / cells + z * z / (4 * cells * cells)) / denom
    return [round(max(0.0, centre - half), 5), round(min(1.0, centre + half), 5)]


def rate_table(levels: np.ndarray, event: np.ndarray, mask: np.ndarray) -> list[RateRow]:
    rows = []
    for code, name in enumerate(LEVEL_NAMES):
        cells_mask = mask & (levels == code)
        cells, events = int(cells_mask.sum()), int((event & cells_mask).sum())
        rows.append(
            RateRow(
                level=name,
                cells=cells,
                events=events,
                rate=round(events / cells, 5) if cells else None,
                ci95=wilson(events, cells),
            )
        )
    return rows


def _brier(prob: np.ndarray, event: np.ndarray, mask: np.ndarray) -> float | None:
    if not mask.any():
        return None
    return float(np.mean((prob[mask] - event[mask]) ** 2))


def _bss(brier: float | None, reference: float | None) -> float | None:
    if brier is None or not reference:
        return None
    return round(1 - brier / reference, 4)


def evaluate_hazard(
    hazard: BacktestHazardIn, request: RainHazardBacktestRequest
) -> HazardBacktestOut:
    p, d = request.points, request.days
    levels = decode_matrix(hazard.levels_b64, p, d, "i1").astype(np.int64)
    triggers = decode_matrix(hazard.triggers_b64, p, d, "i1").astype(np.int64)
    event = decode_matrix(hazard.events_b64, p, d, "i1") > 0
    evaluable = levels != NOT_ISSUED

    day = np.arange(d)[None, :]
    cal_end = request.test_start_day - request.embargo_days
    splits = {
        "calibration": evaluable & (day < cal_end),
        "test": evaluable & (day >= request.test_start_day),
    }
    bounds = {"calibration": (0, cal_end - 1), "test": (request.test_start_day, d - 1)}
    # Persistence: warn today wherever an event was reported yesterday.
    yesterday = np.zeros_like(event)
    yesterday[:, 1:] = event[:, :-1]

    out_splits = []
    for name, mask in splits.items():
        cells, events = int(mask.sum()), int((event & mask).sum())
        thresholds = [
            ThresholdScore(
                threshold=LEVEL_NAMES[code],
                rule=contingency(levels >= code, event, mask, request.tolerance_days),
                rain_only=contingency(triggers >= code, event, mask, request.tolerance_days),
            )
            for code in (1, 2, 3)
        ]
        first, last = bounds[name]
        out_splits.append(
            SplitScore(
                split=name,
                first_day=request.first_day + timedelta(days=first),
                last_day=request.first_day + timedelta(days=last),
                evaluable_cells=cells,
                events=events,
                base_rate=round(events / cells, 5) if cells else None,
                thresholds=thresholds,
                persistence=contingency(yesterday, event, mask, request.tolerance_days),
                rates_by_level=rate_table(levels, event, mask),
            )
        )

    # Probabilities: calibration-period event rates, applied to the test period.
    cal, test = splits["calibration"], splits["test"]
    national = event[cal].mean() if cal.any() else 0.0
    rate_by_level = np.full(len(LEVEL_NAMES), np.nan)
    missing = []
    for code, name in enumerate(LEVEL_NAMES):
        cells_mask = cal & (levels == code)
        if cells_mask.sum() >= request.min_cells_for_rate:
            rate_by_level[code] = event[cells_mask].mean()
        else:
            missing.append(name)
    # A level too rare in calibration falls back to the national rate.
    lookup = np.where(np.isnan(rate_by_level), national, rate_by_level)
    prob_rule = lookup[np.clip(levels, 0, 3)]
    cal_cells = cal.sum(axis=1)
    district = np.where(cal_cells > 0, (event & cal).sum(axis=1) / np.maximum(cal_cells, 1), national)
    prob_district = np.broadcast_to(district[:, None], levels.shape)
    prob_national = np.full(levels.shape, national)
    after_event = (event[:, 1:] & cal[:, 1:] & cal[:, :-1] & event[:, :-1]).sum()
    event_days = (cal[:, 1:] & cal[:, :-1] & event[:, :-1]).sum()
    after_quiet = (event[:, 1:] & cal[:, 1:] & cal[:, :-1] & ~event[:, :-1]).sum()
    quiet_days = (cal[:, 1:] & cal[:, :-1] & ~event[:, :-1]).sum()
    prob_persistence = np.where(
        yesterday,
        after_event / event_days if event_days else national,
        after_quiet / quiet_days if quiet_days else national,
    )
    eventf = event.astype(np.float64)
    brier = _brier(prob_rule, eventf, test)
    b_district = _brier(prob_district, eventf, test)
    b_national = _brier(prob_national, eventf, test)
    b_persistence = _brier(prob_persistence, eventf, test)
    probabilistic = ProbabilisticScore(
        brier=None if brier is None else round(brier, 6),
        brier_climatology_district=None if b_district is None else round(b_district, 6),
        brier_climatology_national=None if b_national is None else round(b_national, 6),
        brier_persistence=None if b_persistence is None else round(b_persistence, 6),
        bss_vs_district_climatology=_bss(brier, b_district),
        bss_vs_national_climatology=_bss(brier, b_national),
        bss_vs_persistence=_bss(brier, b_persistence),
        levels_without_rate=missing,
    )
    notes = [
        "Events are reports (BNPB DIBI): an unreported event counts as no event, so FAR is an upper bound and POD/CSI lower bounds.",
        f"Tolerant scores match warnings and reports up to {request.tolerance_days} day(s) apart (report dates and times are uncertain).",
        "Probabilities = calibration-period event rate of each level; district climatology = each district's calibration-period event rate.",
    ]
    return HazardBacktestOut(hazard=hazard.hazard, splits=out_splits, probabilistic_test=probabilistic, notes=notes)


def evaluate(request: RainHazardBacktestRequest) -> RainHazardBacktestResponse:
    if len({h.hazard for h in request.hazards}) != len(request.hazards):
        raise ValueError("each hazard may appear once")
    return RainHazardBacktestResponse(
        model_version=MODEL_VERSION,
        issued_at=request.issued_at,
        first_day=request.first_day,
        days=request.days,
        tolerance_days=request.tolerance_days,
        hazards=[evaluate_hazard(h, request) for h in request.hazards],
    )
