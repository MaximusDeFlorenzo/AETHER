"""Priority scoring — combines the risk prediction with district context into
a single 0-100 priority score and a discrete priority level, same role as
AI-ORION's `app/ml/priority_scorer.py`.

Generalization vs. ORION: `calculate_priority` now takes a `hazard_type` and
looks up its proximity threshold from `NEAR_EVENT_KM_BY_HAZARD` instead of a
single hardwired `NEAR_EPICENTER_KM = 5.0` constant, since "near" means a very
different distance for a highly localized landslide vs. a wide-reaching
earthquake. The overall weighting formula (severity/population/proximity)
is otherwise unchanged from ORION's proven scheme."""

from app.schemas.common import DistrictInput, HazardType, PriorityLevel
from app.schemas.predict import PredictRiskResponse

AFFECTED_POPULATION_THRESHOLD = 100_000

# How close (km) a district must be to the hazard event to earn the proximity
# bonus below. Landslides are far more spatially localized than earthquakes
# (see hazard_prediction/landslide.py), so "near" is a much smaller radius.
NEAR_EVENT_KM_BY_HAZARD: dict[HazardType, float] = {
    "earthquake": 5.0,
    "landslide": 2.0,
    "flood": 3.0,
    "wildfire": 10.0,
}
DEFAULT_NEAR_EVENT_KM = 5.0


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _priority_level_from_score(score: float) -> PriorityLevel:
    if score < 40:
        return "low"
    if score < 60:
        return "medium"
    if score < 80:
        return "high"
    return "critical"


def calculate_priority(
    hazard_type: HazardType, prediction: PredictRiskResponse, district: DistrictInput
) -> tuple[PriorityLevel, float, float]:
    severity_weight = prediction.risk_score * 0.5

    population_ratio = min(
        prediction.estimated_affected_population / AFFECTED_POPULATION_THRESHOLD, 1.5
    )
    population_weight = _clamp(population_ratio * 100) * 0.3

    near_event_km = NEAR_EVENT_KM_BY_HAZARD.get(hazard_type, DEFAULT_NEAR_EVENT_KM)
    proximity_bonus = 20.0 if district.distance_from_event_km <= near_event_km else 0.0
    proximity_weight = proximity_bonus * 0.2

    priority_score = round(
        _clamp(severity_weight + population_weight + proximity_weight), 2
    )
    priority_level = _priority_level_from_score(priority_score)
    confidence_score = round(prediction.confidence_score, 3)

    return priority_level, priority_score, confidence_score
