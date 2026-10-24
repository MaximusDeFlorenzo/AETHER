"""Earthquake risk heuristic — ported near-verbatim from AI-ORION's
`app/ml/impact_model.py`.

v0 baseline is a documented, weighted heuristic rather than a trained
XGBoost/LightGBM model: there is no labeled historical training set available
yet (BNPB records are seeded but sparse). The heuristic is the shipped
baseline; a future `train.py` will fit a real model against accumulated
`risk_assessments` + real outcome data and swap in behind this same
`predict_risk()` interface without changing callers — exactly ORION's stated
plan for `impact_model.py`, now applied per-hazard instead of hazard-wide.
"""

from app.core.config import get_settings
from app.ml.hazard_prediction.common import (
    clamp,
    estimate_affected_population,
    exposure_level_from_score,
)
from app.schemas.common import DistrictInput, HistoricalDisasterInput
from app.schemas.predict import EarthquakeDetails, PredictRiskResponse

MAX_RELEVANT_RADIUS_KM = 300.0
MAX_RELEVANT_DEPTH_KM = 100.0
MAX_RELEVANT_DENSITY = 5000.0


def predict_risk(
    earthquake: EarthquakeDetails,
    district: DistrictInput,
    historical_disasters: list[HistoricalDisasterInput],
) -> PredictRiskResponse:
    magnitude_component = clamp((earthquake.magnitude - 4.0) / 5.0) * 100
    depth_component = clamp(1 - earthquake.depth_km / MAX_RELEVANT_DEPTH_KM) * 100
    density_component = clamp(district.population_density / MAX_RELEVANT_DENSITY) * 100

    risk_score = round(
        0.5 * magnitude_component + 0.2 * depth_component + 0.3 * density_component, 2
    )

    proximity_factor = clamp(
        1 - district.distance_from_event_km / MAX_RELEVANT_RADIUS_KM, 0.1, 1.0
    )
    affected_fraction = clamp((risk_score / 100) * proximity_factor)
    estimated_affected_population = estimate_affected_population(
        district.total_population, affected_fraction
    )

    earthquake_history = [h for h in historical_disasters if h.hazard_type in (None, "earthquake")]
    confidence_score = clamp(0.70 + min(len(earthquake_history), 3) * 0.07, 0.0, 0.97)

    return PredictRiskResponse(
        hazard_type="earthquake",
        risk_score=risk_score,
        exposure_level=exposure_level_from_score(risk_score),
        estimated_affected_population=estimated_affected_population,
        confidence_score=round(confidence_score, 3),
        model_version=get_settings().model_version,
    )
