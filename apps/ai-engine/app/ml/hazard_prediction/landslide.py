"""Landslide risk heuristic — no ORION equivalent. Written analogously to
`earthquake.py` (itself ported from AI-ORION's `impact_model.py`): the same
documented-weighted-heuristic style, same `clamp`/`exposure_level_from_score`
helpers, same v0-not-a-trained-model posture, applied to landslide-appropriate
physical drivers instead of magnitude/depth.

Drivers, all standard landslide-susceptibility factors:
- `slope_degrees` — steeper slopes are mechanically less stable. Risk rises
  sharply above ~10-15 degrees and plateaus once a slope is already steep
  enough (>50 degrees) that additional steepness doesn't meaningfully change
  the failure likelihood captured here.
- `soil_saturation` (0-1) — saturated soil loses shear strength; this is
  already a 0-1 fraction so it maps directly to a 0-100 component.
- `triggering_rainfall_mm` — short-window rainfall is the most common
  landslide trigger; normalized against a documented threshold roughly in
  line with commonly-cited 24h rainfall-intensity landslide-trigger figures.
- `population_density` — same exposure-side role it plays in `earthquake.py`
  (higher density in the runout zone -> larger affected-population estimate),
  not a physical trigger of the landslide itself.

Per docs/SRS.md §6, Phase 1 landslide events are seeded/manually entered
pending a live rainfall/soil-sensor feed, so confidence is deliberately
started lower and capped lower than the earthquake heuristic's (which is
backed by a live BMKG feed) — this is a data-provenance discount, not a claim
that the scoring formula itself is less reliable.
"""

from app.core.config import get_settings
from app.ml.hazard_prediction.common import (
    clamp,
    estimate_affected_population,
    exposure_level_from_score,
)
from app.schemas.common import DistrictInput, HistoricalDisasterInput
from app.schemas.predict import LandslideDetails, PredictRiskResponse

MIN_RELEVANT_SLOPE_DEGREES = 10.0
MAX_RELEVANT_SLOPE_DEGREES = 50.0
MAX_RELEVANT_RAINFALL_MM = 150.0
MAX_RELEVANT_DENSITY = 5000.0
# Landslides are far more spatially localized than an earthquake's shaking
# radius (docs/DATABASE_SCHEMA.md §15 notes landslide uses a smaller fixed
# affected-region radius default), so proximity decays over a much shorter
# distance than earthquake.py's 300 km.
MAX_RELEVANT_RADIUS_KM = 50.0

BASELINE_CONFIDENCE = 0.55
MAX_CONFIDENCE = 0.85
CONFIDENCE_PER_HISTORICAL_RECORD = 0.05


def predict_risk(
    landslide: LandslideDetails,
    district: DistrictInput,
    historical_disasters: list[HistoricalDisasterInput],
) -> PredictRiskResponse:
    slope_component = (
        clamp(
            (landslide.slope_degrees - MIN_RELEVANT_SLOPE_DEGREES)
            / (MAX_RELEVANT_SLOPE_DEGREES - MIN_RELEVANT_SLOPE_DEGREES)
        )
        * 100
    )
    saturation_component = clamp(landslide.soil_saturation) * 100
    rainfall_component = clamp(landslide.triggering_rainfall_mm / MAX_RELEVANT_RAINFALL_MM) * 100
    density_component = clamp(district.population_density / MAX_RELEVANT_DENSITY) * 100

    risk_score = round(
        0.35 * slope_component
        + 0.30 * saturation_component
        + 0.20 * rainfall_component
        + 0.15 * density_component,
        2,
    )

    proximity_factor = clamp(
        1 - district.distance_from_event_km / MAX_RELEVANT_RADIUS_KM, 0.1, 1.0
    )
    affected_fraction = clamp((risk_score / 100) * proximity_factor)
    estimated_affected_population = estimate_affected_population(
        district.total_population, affected_fraction
    )

    landslide_history = [h for h in historical_disasters if h.hazard_type in (None, "landslide")]
    confidence_score = clamp(
        BASELINE_CONFIDENCE + min(len(landslide_history), 3) * CONFIDENCE_PER_HISTORICAL_RECORD,
        0.0,
        MAX_CONFIDENCE,
    )

    return PredictRiskResponse(
        hazard_type="landslide",
        risk_score=risk_score,
        exposure_level=exposure_level_from_score(risk_score),
        estimated_affected_population=estimated_affected_population,
        confidence_score=round(confidence_score, 3),
        model_version=get_settings().model_version,
    )
