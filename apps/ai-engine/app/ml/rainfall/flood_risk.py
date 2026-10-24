"""Stage-1 rainfall-driven flood-risk baseline (docs/RAINFALL_INTELLIGENCE.md,
Milestone 3): a transparent decision table, not a trained model.

No labelled flood history exists in AETHER yet (0 flood events in
`historical_disasters`), so nothing here is a probability and no weight is
fitted. Every threshold that changes the level has a stated external basis,
and every input without one is reported as context (`not_scored`), never
silently weighted:

1. Rain trigger — BMKG rainfall-intensity categories:
   hourly  lebat 10–20 mm/h, sangat lebat > 20 mm/h;
   daily   lebat 50–100 mm, sangat lebat 100–150 mm, ekstrem > 150 mm.
   lebat → MEDIUM, sangat lebat → HIGH, ekstrem → EXTREME; the higher of
   the hourly (max hour in the last 3 h) and the 24 h category wins.
2. Susceptibility — BNPB InaRISK `INDEKS_BAHAYA_BANJIR` sampled around the
   district point, classed by national terciles across all districts (the
   layer publishes a stretched 0–1 legend, no class breaks). Bottom-tercile
   districts are lowered one level; unknown susceptibility never lowers
   (a missing layer must not hide a warning).
3. Official river-gauge status (PetaBencana / BPBD "Siaga"): Siaga III →
   at least MEDIUM, Siaga II → HIGH, Siaga I → EXTREME.

All thresholds are request parameters, so they can be replaced by
data-driven ones once labels exist.
"""

from dataclasses import dataclass

from app.schemas.rainfall_flood import (
    FloodFactorOut,
    FloodPointIn,
    FloodPointOut,
    FloodRiskParameters,
    RainFloodRiskRequest,
    RainFloodRiskResponse,
    RiskLevel,
)

MODEL_VERSION = "flood-rule-baseline-v0.1"

LEVELS: list[RiskLevel] = ["LOW", "MEDIUM", "HIGH", "EXTREME"]
GAUGE_FLOOR: dict[int, RiskLevel] = {1: "EXTREME", 2: "HIGH", 3: "MEDIUM"}
GAUGE_LABEL = {1: "Siaga I", 2: "Siaga II", 3: "Siaga III", 4: "Siaga IV"}

BMKG_BASIS = "BMKG rainfall-intensity categories"
NOT_SCORED_WINDOW = "No official category for this window; reported as context only."
NOT_SCORED_ANTECEDENT = (
    "Antecedent wetness matters, but no validated threshold exists without labelled "
    "flood events (REQUIRED DATA); reported as context only."
)

# Inputs a flood model needs that AETHER does not have at all.
MISSING_INPUTS = [
    "REQUIRED DATA: labelled historical flood events (BNPB DIBI) — needed for probabilities and calibration",
    "REQUIRED DATA: river proximity / drainage network / height above nearest drainage",
    "REQUIRED DATA: land cover and impervious surface",
    "REQUIRED DATA: river water level outside PetaBencana coverage (Jakarta, West/Central/East Java)",
]


@dataclass(frozen=True)
class RainCategory:
    name: str | None
    level: RiskLevel


def _rank(level: RiskLevel) -> int:
    return LEVELS.index(level)


def hourly_category(mm: float | None, params: FloodRiskParameters) -> RainCategory:
    if mm is None:
        return RainCategory(None, "LOW")
    if mm > params.hourly_sangat_lebat_mm:
        return RainCategory("sangat_lebat", "HIGH")
    if mm >= params.hourly_lebat_mm:
        return RainCategory("lebat", "MEDIUM")
    return RainCategory("below_lebat", "LOW")


def daily_category(mm: float | None, params: FloodRiskParameters) -> RainCategory:
    if mm is None:
        return RainCategory(None, "LOW")
    if mm > params.daily_ekstrem_mm:
        return RainCategory("ekstrem", "EXTREME")
    if mm >= params.daily_sangat_lebat_mm:
        return RainCategory("sangat_lebat", "HIGH")
    if mm >= params.daily_lebat_mm:
        return RainCategory("lebat", "MEDIUM")
    return RainCategory("below_lebat", "LOW")


def susceptibility_class(index: float | None, breaks: list[float] | None) -> str:
    if index is None or breaks is None:
        return "unknown"
    low_upper, high_lower = breaks
    if index < low_upper:
        return "low"
    if index >= high_lower:
        return "high"
    return "medium"


def _effect(level: RiskLevel) -> str:
    return "raised" if level != "LOW" else "none"


def assess_point(point: FloodPointIn, params: FloodRiskParameters) -> FloodPointOut:
    rain = point.rainfall
    factors: list[FloodFactorOut] = []
    confidence_reasons: list[str] = []

    usable_rain = rain is not None and rain.freshness != "stale"
    max_hourly = rain.max_hourly_mm_last_3_hours if usable_rain and rain else None
    total_24h = rain.accumulations_mm.get("24") if usable_rain and rain else None
    hourly = hourly_category(max_hourly, params)
    daily = daily_category(total_24h, params)

    gauge = point.gauge
    gauge_floor = GAUGE_FLOOR.get(gauge.alert_level) if gauge else None

    if max_hourly is None and total_24h is None and gauge_floor is None:
        reason = (
            "No rainfall series is fresh enough"
            if rain is not None and rain.freshness == "stale"
            else "No complete rainfall window"
        )
        return FloodPointOut(
            id=point.id,
            status="insufficient_data",
            level=None,
            confidence="very_low",
            confidence_reasons=[reason],
            reason=f"{reason}; flood level not issued.",
            factors=[],
            susceptibility_class=susceptibility_class(
                point.susceptibility.flood_hazard_index if point.susceptibility else None,
                params.susceptibility_breaks,
            ),
        )

    if rain is not None and usable_rain:
        factors.append(
            FloodFactorOut(
                factor="max_hourly_rain_3h",
                value=max_hourly,
                unit="mm/h",
                assessment=hourly.name,
                effect=_effect(hourly.level) if max_hourly is not None else "not_available",
                source=rain.source,
            )
        )
        factors.append(
            FloodFactorOut(
                factor="rain_24h",
                value=total_24h,
                unit="mm",
                assessment=daily.name,
                effect=_effect(daily.level) if total_24h is not None else "not_available",
                source=rain.source,
            )
        )
        for window in ("1", "3", "6"):
            value = rain.accumulations_mm.get(window)
            factors.append(
                FloodFactorOut(
                    factor=f"rain_{window}h",
                    value=value,
                    unit="mm",
                    effect="not_scored" if value is not None else "not_available",
                    source=rain.source,
                )
            )

    if point.antecedent is not None:
        for name, value in (("rain_72h", point.antecedent.total_mm_72_hours), ("rain_168h", point.antecedent.total_mm_168_hours)):
            factors.append(
                FloodFactorOut(
                    factor=name,
                    value=value,
                    unit="mm",
                    effect="not_scored" if value is not None else "not_available",
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

    trigger = hourly.level if _rank(hourly.level) >= _rank(daily.level) else daily.level
    level = trigger

    index = point.susceptibility.flood_hazard_index if point.susceptibility else None
    s_class = susceptibility_class(index, params.susceptibility_breaks)
    lowered = s_class == "low" and params.downgrade_low_susceptibility and _rank(trigger) > 0
    if lowered:
        level = LEVELS[_rank(trigger) - 1]
    factors.append(
        FloodFactorOut(
            factor="flood_hazard_index",
            value=index,
            unit="0-1",
            assessment=s_class,
            effect="lowered" if lowered else ("none" if index is not None else "not_available"),
            source=point.susceptibility.source if point.susceptibility else None,
        )
    )

    if gauge is not None:
        raised_by_gauge = gauge_floor is not None and _rank(gauge_floor) > _rank(level)
        if raised_by_gauge:
            level = gauge_floor
        factors.append(
            FloodFactorOut(
                factor="river_gauge_alert",
                value=float(gauge.alert_level),
                unit="siaga",
                assessment=GAUGE_LABEL.get(gauge.alert_level),
                effect="raised" if raised_by_gauge else "none",
                detail=f"{gauge.name}, {gauge.distance_km:.0f} km, observed {gauge.observed_at.isoformat()}",
                source=gauge.source,
            )
        )

    # Confidence: qualitative, never above "low" while uncalibrated.
    if rain is None or not usable_rain:
        confidence_reasons.append("level rests on a river gauge only; no usable rainfall series")
    else:
        if rain.freshness != "fresh":
            confidence_reasons.append(f"rainfall data is {rain.freshness}")
        if rain.data_kind != "satellite_estimate":
            confidence_reasons.append(f"rainfall is {rain.data_kind}, not an observation-based estimate")
        if total_24h is None:
            confidence_reasons.append("24 h rainfall window incomplete")
    if s_class == "unknown":
        confidence_reasons.append("flood susceptibility unknown")
    confidence = "low" if not confidence_reasons else "very_low"
    confidence_reasons.append("thresholds not calibrated against local flood history")

    order = {"raised": 0, "lowered": 1, "none": 2, "not_scored": 3, "not_available": 4}
    factors.sort(key=lambda f: order[f.effect])

    return FloodPointOut(
        id=point.id,
        status="ok",
        level=level,
        rain_trigger_level=trigger,
        hourly_category=hourly.name,
        daily_category=daily.name,
        susceptibility_class=s_class,
        gauge_floor=gauge_floor,
        confidence=confidence,
        confidence_reasons=confidence_reasons,
        factors=factors,
    )


def factor_bases(params: FloodRiskParameters) -> dict[str, str]:
    """Why each factor can (or cannot) change the level — stated once per
    response rather than repeated in every district's factor list."""
    breaks = params.susceptibility_breaks
    return {
        "max_hourly_rain_3h": (
            f"{BMKG_BASIS}: lebat >= {params.hourly_lebat_mm:g}, sangat lebat > "
            f"{params.hourly_sangat_lebat_mm:g} mm/h (highest hour of the last 3 h)"
        ),
        "rain_24h": (
            f"{BMKG_BASIS}: lebat >= {params.daily_lebat_mm:g}, sangat lebat >= "
            f"{params.daily_sangat_lebat_mm:g}, ekstrem > {params.daily_ekstrem_mm:g} mm/day"
        ),
        "rain_1h": NOT_SCORED_WINDOW,
        "rain_3h": NOT_SCORED_WINDOW,
        "rain_6h": NOT_SCORED_WINDOW,
        "rain_72h": NOT_SCORED_ANTECEDENT,
        "rain_168h": NOT_SCORED_ANTECEDENT,
        "soil_moisture_9_27cm": "Model soil moisture; no validated flood threshold. Context only.",
        "flood_hazard_index": (
            f"BNPB InaRISK INDEKS_BAHAYA_BANJIR (mean of valid samples around the district point), "
            f"classed by national terciles {breaks}; the bottom tercile lowers the rain trigger one level"
            + ("" if params.downgrade_low_susceptibility else " (disabled)")
            if breaks
            else "BNPB InaRISK INDEKS_BAHAYA_BANJIR; no national class breaks available, never lowers"
        ),
        "river_gauge_alert": "Official gauge status (BPBD via PetaBencana): Siaga III/II/I set a MEDIUM/HIGH/EXTREME floor",
    }


def run_flood_risk(request: RainFloodRiskRequest) -> RainFloodRiskResponse:
    params = request.parameters
    return RainFloodRiskResponse(
        model_version=MODEL_VERSION,
        issued_at=request.issued_at,
        parameters=params,
        factor_bases=factor_bases(params),
        missing_inputs=MISSING_INPUTS,
        points=[assess_point(point, params) for point in request.points],
    )
