"""Stage-1 rainfall-triggered landslide baseline (docs/RAINFALL_INTELLIGENCE.md,
Milestone 4): a transparent decision table, not a trained model.

No labelled landslide history exists in AETHER yet, so nothing here is a
probability and no weight is fitted. Every threshold that changes the level
has a stated external basis:

1. Rain trigger — published rainfall intensity–duration (ID) thresholds
   I = alpha * D^-beta, evaluated on trailing windows (default 3, 6, 24,
   72 h; mean intensity = window total / window length):
   - lower curve, Guzzetti et al. 2008 global minimum (I = 2.20 D^-0.44):
     at or above it on any window → MEDIUM;
   - upper curve, Caine 1980 (I = 14.82 D^-0.39): at or above → HIGH.
   Both are global curves for shallow landslides and debris flows, not
   derived for Indonesia. Trailing windows stand in for rainfall events
   (no event segmentation). No published curve justifies EXTREME, so the
   rain trigger never issues it.
2. Terrain — DEM slope (Copernicus GLO-90) sampled around the district
   point, classed at a quantile of the samples by the Permen PU
   No. 22/PRT/M/2007 landslide-zone typology (C 0–20 %, B 20–40 %,
   A > 40 %). Gentle terrain (type C only) lowers the level one step;
   unknown terrain never lowers (a missing layer must not hide a warning).

Exposure (population, assets) is deliberately not part of the level: the
level describes the hazard, and exposure belongs to the decision layer.
All thresholds are request parameters, so they can be replaced by
data-driven ones once labels exist.
"""

import math

from app.ml.rainfall.flood_risk import LEVELS
from app.schemas.rainfall_flood import FloodFactorOut, RiskLevel
from app.schemas.rainfall_landslide import (
    LandslidePointIn,
    LandslidePointOut,
    LandslideRiskParameters,
    LandslideTerrainIn,
    RainLandslideRiskRequest,
    RainLandslideRiskResponse,
    TRIGGER_WINDOWS,
)

MODEL_VERSION = "landslide-rule-baseline-v0.1"

ID_BASIS = (
    "Rainfall intensity-duration thresholds I = a*D^-b (Brunetti et al. 2010, NHESS 10:447, Table 2): "
    "lower = Guzzetti et al. 2008 global minimum, upper = Caine 1980; both global, not derived for Indonesia"
)
NOT_SCORED_WINDOW = "Window not in triggerWindowsHours; reported as context only."

# Inputs a landslide model needs that AETHER does not have at all.
MISSING_INPUTS = [
    "REQUIRED DATA: labelled historical landslide events (BNPB DIBI) — needed for probabilities and calibration",
    "REQUIRED DATA: landslide susceptibility zoning (Badan Geologi/PVMBG Zona Kerentanan Gerakan Tanah)",
    "REQUIRED DATA: BNPB InaRISK INDEKS_BAHAYA_TANAHLONGSOR (server times out on every sample, verified 2026-10-07)",
    "REQUIRED DATA: lithology and soil type",
    "REQUIRED DATA: land cover / slope cutting",
    "REQUIRED DATA: higher-resolution DEM (e.g. BIG DEMNAS 8 m) — 90 m slopes understate local steepness",
]


def _rank(level: RiskLevel) -> int:
    return LEVELS.index(level)


def id_threshold_mm(alpha: float, beta: float, hours: int) -> float:
    """Rainfall total (mm) over `hours` at which mean intensity meets I = alpha * D^-beta."""
    return alpha * hours ** -beta * hours


def _window_total(point: LandslidePointIn, hours: int) -> tuple[float | None, str | None, str | None]:
    """Window total, its source and data kind; None if incomplete or stale."""
    if hours == 72:
        antecedent = point.antecedent
        if antecedent is None:
            return None, None, None
        return antecedent.total_mm_72_hours, antecedent.source, antecedent.data_kind
    rain = point.rainfall
    if rain is None or rain.freshness == "stale":
        return None, None, None
    return rain.accumulations_mm.get(str(hours)), rain.source, rain.data_kind


def slope_quantile_deg(samples: list[float], q: float) -> float:
    """Linear-interpolated quantile (same convention as numpy's default)."""
    ordered = sorted(samples)
    pos = (len(ordered) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def terrain_class(
    terrain: LandslideTerrainIn | None, params: LandslideRiskParameters
) -> tuple[str, float | None]:
    if terrain is None or len(terrain.slope_samples_deg) < params.min_terrain_samples:
        return "unknown", None
    deg = slope_quantile_deg(terrain.slope_samples_deg, params.slope_quantile)
    percent = round(math.tan(math.radians(deg)) * 100, 1)
    if percent > params.slope_steep_min_percent:
        return "high", percent
    if percent >= params.slope_gentle_max_percent:
        return "medium", percent
    return "low", percent


def assess_point(point: LandslidePointIn, params: LandslideRiskParameters) -> LandslidePointOut:
    factors: list[FloodFactorOut] = []
    t_class, slope_percent = terrain_class(point.terrain, params)

    trigger: RiskLevel = "LOW"
    trigger_class = "below_lower"
    critical_window: int | None = None
    best_ratio = -1.0
    evaluated = 0
    # Evaluated windows whose rainfall is not an observation-based estimate.
    non_observed: dict[str, list[int]] = {}
    for hours in TRIGGER_WINDOWS:
        total, source, kind = _window_total(point, hours)
        if hours not in params.trigger_windows_hours:
            if total is not None:
                factors.append(
                    FloodFactorOut(factor=f"rain_{hours}h", value=total, unit="mm", effect="not_scored", source=source)
                )
            continue
        lower = id_threshold_mm(params.lower_id_alpha, params.lower_id_beta, hours)
        upper = id_threshold_mm(params.upper_id_alpha, params.upper_id_beta, hours)
        detail = f"lower {lower:.1f} mm, upper {upper:.1f} mm over {hours} h"
        if total is None:
            factors.append(
                FloodFactorOut(
                    factor=f"rain_{hours}h", value=None, unit="mm", effect="not_available", detail=detail, source=source
                )
            )
            continue
        evaluated += 1
        if kind != "satellite_estimate":
            non_observed.setdefault(kind or "unknown kind", []).append(hours)
        if total >= upper:
            window_class, window_level = "above_upper", "HIGH"
        elif total >= lower:
            window_class, window_level = "above_lower", "MEDIUM"
        else:
            window_class, window_level = "below_lower", "LOW"
        ratio = total / lower
        if ratio > best_ratio:
            best_ratio, critical_window = ratio, hours
        if _rank(window_level) > _rank(trigger):
            trigger, trigger_class = window_level, window_class
        factors.append(
            FloodFactorOut(
                factor=f"rain_{hours}h",
                value=total,
                unit="mm",
                assessment=window_class,
                effect="raised" if window_level != "LOW" else "none",
                detail=detail,
                source=source,
            )
        )

    rain = point.rainfall
    if evaluated == 0:
        reason = (
            "No rainfall series is fresh enough"
            if rain is not None and rain.freshness == "stale"
            else "No complete rainfall window"
        )
        return LandslidePointOut(
            id=point.id,
            status="insufficient_data",
            level=None,
            terrain_class=t_class,
            slope_percent_at_quantile=slope_percent,
            confidence="very_low",
            confidence_reasons=[reason],
            factors=[],
            reason=f"{reason}; landslide level not issued.",
        )

    if point.antecedent is not None and point.antecedent.total_mm_168_hours is not None:
        factors.append(
            FloodFactorOut(
                factor="rain_168h",
                value=point.antecedent.total_mm_168_hours,
                unit="mm",
                effect="not_scored",
                source=point.antecedent.source,
            )
        )
    if point.soil_moisture is not None:
        factors.append(
            FloodFactorOut(
                factor="soil_moisture_9_27cm",
                value=point.soil_moisture.volumetric_fraction,
                unit="m3/m3",
                effect="not_scored",
                source=point.soil_moisture.source,
            )
        )

    level = trigger
    lowered = t_class == "low" and params.downgrade_gentle_terrain and _rank(trigger) > 0
    if lowered:
        level = LEVELS[_rank(trigger) - 1]
    terrain = point.terrain
    factors.append(
        FloodFactorOut(
            factor="slope",
            value=slope_percent,
            unit="%",
            assessment=t_class,
            effect="lowered" if lowered else ("none" if slope_percent is not None else "not_available"),
            detail=(
                f"p{round(params.slope_quantile * 100)} of {len(terrain.slope_samples_deg)} {terrain.dem} samples"
                if terrain is not None
                else None
            ),
            source=terrain.source if terrain is not None else None,
        )
    )

    # Confidence: qualitative, never above "low" while uncalibrated.
    reasons: list[str] = []
    if rain is None or rain.freshness == "stale":
        reasons.append("no usable short-window rainfall series")
    elif rain.freshness != "fresh":
        reasons.append(f"rainfall data is {rain.freshness}")
    for kind, windows in non_observed.items():
        hours_list = ", ".join(f"{h} h" for h in windows)
        reasons.append(f"{hours_list} rainfall is {kind}, not an observation-based estimate")
    if evaluated < len(params.trigger_windows_hours):
        reasons.append("some trigger windows incomplete")
    if t_class == "unknown":
        reasons.append("terrain slope unknown")
    confidence = "low" if not reasons else "very_low"
    reasons.append("global ID thresholds, not calibrated against Indonesian landslide history")
    if t_class != "unknown":
        reasons.append("90 m DEM slope understates local steepness")

    order = {"raised": 0, "lowered": 1, "none": 2, "not_scored": 3, "not_available": 4}
    factors.sort(key=lambda f: order[f.effect])

    return LandslidePointOut(
        id=point.id,
        status="ok",
        level=level,
        rain_trigger_level=trigger,
        trigger_class=trigger_class,
        critical_window_hours=critical_window,
        terrain_class=t_class,
        slope_percent_at_quantile=slope_percent,
        confidence=confidence,
        confidence_reasons=reasons,
        factors=factors,
    )


def factor_bases(params: LandslideRiskParameters) -> dict[str, str]:
    """Why each factor can (or cannot) change the level — stated once per response."""
    bases: dict[str, str] = {}
    for hours in TRIGGER_WINDOWS:
        if hours in params.trigger_windows_hours:
            lower = id_threshold_mm(params.lower_id_alpha, params.lower_id_beta, hours)
            upper = id_threshold_mm(params.upper_id_alpha, params.upper_id_beta, hours)
            bases[f"rain_{hours}h"] = (
                f"{ID_BASIS}. Over {hours} h: >= {lower:.1f} mm (lower, I = {params.lower_id_alpha:g}*D^-"
                f"{params.lower_id_beta:g}) raises to MEDIUM, >= {upper:.1f} mm (upper, I = "
                f"{params.upper_id_alpha:g}*D^-{params.upper_id_beta:g}) to HIGH"
            )
        else:
            bases[f"rain_{hours}h"] = NOT_SCORED_WINDOW
    bases["rain_168h"] = "Longer than the trigger windows; no validated antecedent threshold. Context only."
    bases["soil_moisture_9_27cm"] = "Model soil moisture; no validated landslide threshold. Context only."
    bases["slope"] = (
        f"Copernicus GLO-90 DEM slope, p{round(params.slope_quantile * 100)} of samples around the district point, "
        f"classed by Permen PU No. 22/PRT/M/2007 typology (C < {params.slope_gentle_max_percent:g} %, "
        f"B {params.slope_gentle_max_percent:g}-{params.slope_steep_min_percent:g} %, "
        f"A > {params.slope_steep_min_percent:g} %); type C only lowers the rain trigger one level"
        + ("" if params.downgrade_gentle_terrain else " (disabled)")
        + f"; fewer than {params.min_terrain_samples} samples = unknown, never lowers"
    )
    return bases


def run_landslide_risk(request: RainLandslideRiskRequest) -> RainLandslideRiskResponse:
    params = request.parameters
    return RainLandslideRiskResponse(
        model_version=MODEL_VERSION,
        issued_at=request.issued_at,
        parameters=params,
        factor_bases=factor_bases(params),
        missing_inputs=MISSING_INPUTS,
        points=[assess_point(point, params) for point in request.points],
    )
