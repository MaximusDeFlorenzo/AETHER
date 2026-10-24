"""Stage-2 spatial nowcast (`rain-nowcast-spatial-logistic-v0.1`,
docs/RAINFALL_INTELLIGENCE.md §7): a per-horizon logistic regression over
the point's own rain, its neighbours' rain at three scales, the three
Stage-1 baselines (which look upstream along tracked motion and the 700 hPa
wind) and the local hour of day.

It is a gated candidate, not a default: it is trained on a chronological
train/validation/test split of the stored GSMaP history and only served for
a horizon once it beats every Stage-1 baseline on the test period with
enough history (SpatialGateParameters). The fitted probability is
calibrated on the training period by construction (log-loss), which is
what the baselines lack; whether that holds out of sample is what the test
split reports.

Features are defined only here, so training rows and live inference cannot
drift apart. They are rounded to 3 decimals so the caller can merge
identical (mostly dry) rows into weighted ones.
"""

import math
from datetime import datetime

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score

from app.schemas.rainfall_spatial import (
    SPLIT_CODES,
    BaselineComparison,
    ProbScore,
    RainSpatialTrainRequest,
    RainSpatialTrainResponse,
    ReliabilityBin,
    SpatialGateParameters,
    SpatialHorizonModel,
    SpatialModelSpec,
)

MODEL_VERSION = "rain-nowcast-spatial-logistic-v0.1"

FEATURE_NAMES = [
    "p_persistence",
    "p_motion_advection",
    "motion_advection_missing",
    "p_steering_wind_advection",
    "steering_wind_advection_missing",
    "log1p_current_mm_per_hour",
    "rain_fraction_50km",
    "rain_fraction_100km",
    "motion_tracked",
    "sin_local_hour",
    "cos_local_hour",
]
# Stage-1 baselines compared against, with their feature column.
BASELINES = {
    "persistence": "p_persistence",
    "motion_advection": "p_motion_advection",
    "steering_wind_advection": "p_steering_wind_advection",
}
REGULARIZATION_GRID = [0.01, 0.1, 1.0, 10.0]
RELIABILITY_BINS = 10


def local_hour_bin(valid_time: datetime, longitude: float) -> int:
    """Integer local solar hour (UTC + lon/15): the diurnal cycle of tropical
    convection, binned so dry rows from different districts can merge."""
    utc_hours = valid_time.hour + valid_time.minute / 60
    return int(math.floor((utc_hours + longitude / 15) % 24))


def build_features(
    *,
    probabilities: dict[str, float | None],
    current_mm_per_hour: float | None,
    rain_fraction_50km: float | None,
    rain_fraction_100km: float | None,
    motion_tracked: bool,
    valid_time: datetime,
    longitude: float,
) -> list[float] | None:
    """One feature vector for one point and horizon; None if the point's own
    rain or its neighbourhood is unknown (nothing to learn from)."""
    if current_mm_per_hour is None or rain_fraction_50km is None or rain_fraction_100km is None:
        return None
    p_motion = probabilities.get("motion_advection")
    p_steering = probabilities.get("steering_wind_advection")
    p_persistence = probabilities.get("persistence")
    if p_persistence is None:
        return None
    angle = 2 * math.pi * local_hour_bin(valid_time, longitude) / 24
    values = [
        p_persistence,
        p_motion if p_motion is not None else 0.0,
        0.0 if p_motion is not None else 1.0,
        p_steering if p_steering is not None else 0.0,
        0.0 if p_steering is not None else 1.0,
        math.log1p(max(current_mm_per_hour, 0.0)),
        rain_fraction_50km,
        rain_fraction_100km,
        1.0 if motion_tracked else 0.0,
        math.sin(angle),
        math.cos(angle),
    ]
    return [round(v, 3) for v in values]


def predict_probability(coefficients: list[float], intercept: float, features: list[float]) -> float:
    z = intercept + float(np.dot(coefficients, features))
    return 1.0 / (1.0 + math.exp(-z)) if z >= 0 else math.exp(z) / (1.0 + math.exp(z))


def usable_spec(spec: SpatialModelSpec | None) -> tuple[SpatialModelSpec | None, str | None]:
    """A promoted model is only applied if it was trained on these exact features."""
    if spec is None:
        return None, None
    if spec.feature_names != FEATURE_NAMES:
        return None, "spatial model features differ from this engine's; not applied"
    return spec, None


def score(prob: np.ndarray, label: np.ndarray, weight: np.ndarray, climatology: float | None) -> ProbScore:
    total = float(weight.sum())
    positives = float((weight * label).sum())
    if total == 0:
        return ProbScore(rows=0, positives=0, brier=None, brier_skill_score=None, average_precision=None)
    brier = float(np.sum(weight * (prob - label) ** 2) / total)
    bss = None
    if climatology is not None:
        reference = float(np.sum(weight * (climatology - label) ** 2) / total)
        bss = 1 - brier / reference if reference > 0 else None
    ap = float(average_precision_score(label, prob, sample_weight=weight)) if 0 < positives < total else None
    bins = []
    edges = np.linspace(0, 1, RELIABILITY_BINS + 1)
    index = np.clip(np.digitize(prob, edges[1:-1]), 0, RELIABILITY_BINS - 1)
    for b in range(RELIABILITY_BINS):
        mask = index == b
        w = float(weight[mask].sum())
        if w == 0:
            continue
        bins.append(
            ReliabilityBin(
                lower=float(edges[b]),
                upper=float(edges[b + 1]),
                mean_forecast=round(float(np.sum(weight[mask] * prob[mask]) / w), 4),
                observed_frequency=round(float(np.sum(weight[mask] * label[mask]) / w), 4),
                weight=w,
            )
        )
    return ProbScore(
        rows=total,
        positives=positives,
        brier=round(brier, 5),
        brier_skill_score=None if bss is None else round(bss, 4),
        average_precision=None if ap is None else round(ap, 4),
        reliability=bins,
    )


def _log_loss(prob: np.ndarray, label: np.ndarray, weight: np.ndarray) -> float:
    p = np.clip(prob, 1e-6, 1 - 1e-6)
    return float(-np.sum(weight * (label * np.log(p) + (1 - label) * np.log(1 - p))) / weight.sum())


def _fit(x: np.ndarray, y: np.ndarray, w: np.ndarray, c: float) -> LogisticRegression:
    model = LogisticRegression(C=c, max_iter=2000)
    model.fit(x, y, sample_weight=w)
    return model


def train_horizon(
    horizon: int, data: np.ndarray, gate: SpatialGateParameters, history_days: float
) -> SpatialHorizonModel:
    """`data` columns: split, label, weight, *features (this horizon only)."""
    split, label, weight, x = data[:, 0], data[:, 1], data[:, 2], data[:, 3:]
    masks = {name: split == code for code, name in SPLIT_CODES.items()}
    out = SpatialHorizonModel(
        horizon_hours=horizon,
        status="insufficient_data",
        rows_by_split={name: float(weight[m].sum()) for name, m in masks.items()},
        positives_by_split={name: float((weight * label)[m].sum()) for name, m in masks.items()},
    )
    train, valid, test = masks["train"], masks["validation"], masks["test"]
    fit_mask = train | valid
    for name, m in (("train", train), ("validation", valid), ("test", test)):
        pos = float((weight * label)[m].sum())
        if pos == 0 or pos == float(weight[m].sum()):
            out.reason = f"{name} split has a single class (no rain events or no dry rows)"
            out.gate_reasons = [out.reason]
            return out

    best_c, best_loss = REGULARIZATION_GRID[0], math.inf
    for c in REGULARIZATION_GRID:
        model = _fit(x[train], label[train], weight[train], c)
        loss = _log_loss(model.predict_proba(x[valid])[:, 1], label[valid], weight[valid])
        if loss < best_loss:
            best_c, best_loss = c, loss
    # Final fit on everything before the test period.
    model = _fit(x[fit_mask], label[fit_mask], weight[fit_mask], best_c)
    climatology = float(np.sum(weight[fit_mask] * label[fit_mask]) / weight[fit_mask].sum())

    xt, yt, wt = x[test], label[test], weight[test]
    pt = model.predict_proba(xt)[:, 1]
    out.status = "fitted"
    out.regularization_c = best_c
    out.coefficients = [round(float(v), 6) for v in model.coef_[0]]
    out.intercept = round(float(model.intercept_[0]), 6)
    out.climatology = round(climatology, 6)
    out.test = score(pt, yt, wt, climatology)

    for baseline, column in BASELINES.items():
        col = FEATURE_NAMES.index(column)
        missing_col = FEATURE_NAMES.index(f"{baseline}_missing") if f"{baseline}_missing" in FEATURE_NAMES else None
        available = np.ones(len(yt), dtype=bool) if missing_col is None else xt[:, missing_col] == 0
        out.comparisons.append(
            BaselineComparison(
                baseline=baseline,
                baseline_score=score(xt[available, col], yt[available], wt[available], climatology),
                model_score=score(pt[available], yt[available], wt[available], climatology),
            )
        )

    reasons = []
    if history_days < gate.min_history_days:
        reasons.append(f"history {history_days:.1f} days < {gate.min_history_days:g} required")
    if out.test.positives < gate.min_test_positives:
        reasons.append(f"test period has {out.test.positives:g} rain events < {gate.min_test_positives} required")
    if out.test.brier_skill_score is None or out.test.brier_skill_score <= 0:
        reasons.append("no skill over climatology on the test period")
    for comparison in out.comparisons:
        model_bss = comparison.model_score.brier_skill_score
        base_bss = comparison.baseline_score.brier_skill_score
        if model_bss is None or base_bss is None:
            reasons.append(f"{comparison.baseline}: not comparable on the test period")
        elif model_bss < base_bss + gate.min_bss_gain:
            reasons.append(
                f"{comparison.baseline}: BSS {model_bss:.3f} vs baseline {base_bss:.3f} "
                f"(needs +{gate.min_bss_gain:g})"
            )
    out.gate_reasons = reasons
    out.promoted = not reasons
    return out


def train(request: RainSpatialTrainRequest) -> RainSpatialTrainResponse:
    if request.feature_names != FEATURE_NAMES:
        raise ValueError("featureNames do not match this engine's spatial features")
    history = request.history
    history_days = (history.last_start - history.first_start).total_seconds() / 86400
    rows = np.asarray(request.rows, dtype=np.float64).reshape(-1, 4 + len(FEATURE_NAMES))
    horizons = []
    for horizon in request.horizons_hours:
        data = rows[rows[:, 0] == horizon][:, 1:]
        horizons.append(train_horizon(horizon, data, request.gate, history_days))
    return RainSpatialTrainResponse(
        model_version=MODEL_VERSION,
        issued_at=request.issued_at,
        feature_names=FEATURE_NAMES,
        history_days=round(history_days, 2),
        gate=request.gate,
        horizons=horizons,
    )
