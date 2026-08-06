"""Flood risk heuristic — no ORION equivalent. Written analogously to
`landslide.py`: same documented-weighted-heuristic style, same
`clamp`/`exposure_level_from_score` helpers, same v0-not-a-trained-model
posture, applied to flood-appropriate physical drivers.

Drivers, both standard flood-risk factors:
- `water_level_m` — observed/forecast river or floodplain water level. This is
  the most direct measure of how close a waterway already is to overtopping;
  weighted more heavily than rainfall because it reflects actual state rather
  than a precursor.
- `rainfall_mm` — short-window rainfall intensity, the primary flood trigger
  upstream of water-level rise. Normalized against a threshold in line with
  commonly-cited 24h heavy-rainfall flood-trigger figures (same order of
  magnitude as `landslide.py`'s `triggering_rainfall_mm` threshold, since both
  represent "intense short-window rain" as a hazard trigger).
- `population_density` — same exposure-side role it plays in every other
  hazard module (higher density in the inundation zone -> larger
  affected-population estimate), not a physical trigger of flooding itself.

`river_basin` is descriptive/narrative only (feeds XAI reason text via
`explainability.py`) — there is no per-basin susceptibility data source yet,
so it is not a scoring input.

Per docs/SRS.md §1, flood is a Phase 2 hazard type sourced from a live
Weather/Rainfall API adapter once wired (`apps/api/src/ingestion/adapters/
weather.adapter.ts`) rather than seeded/manual entry, so confidence starts
higher than `landslide.py`'s (seeded-data) baseline but still below
`earthquake.py`'s (long-established BMKG feed) — reflecting that this is a
newly-wired live feed, not an unproven data source.
"""

from app.core.config import get_settings
from app.ml.hazard_prediction.common import clamp, exposure_level_from_score
from app.schemas.common import DistrictInput, HistoricalDisasterInput
from app.schemas.predict import FloodDetails, PredictRiskResponse

MAX_RELEVANT_WATER_LEVEL_M = 5.0
MAX_RELEVANT_RAINFALL_MM = 150.0
MAX_RELEVANT_DENSITY = 5000.0
# Floods are localized to a floodplain/river basin rather than radiating from
# a point like an earthquake's shaking, but lacking watershed polygon data
# (docs/ARCHITECTURE.md §5) this module uses the same point-radius proximity
# model as every other hazard, with a radius sized for a typical floodplain.
MAX_RELEVANT_RADIUS_KM = 15.0

BASELINE_CONFIDENCE = 0.62
MAX_CONFIDENCE = 0.90
CONFIDENCE_PER_HISTORICAL_RECORD = 0.06


def predict_risk(
    flood: FloodDetails,
    district: DistrictInput,
    historical_disasters: list[HistoricalDisasterInput],
) -> PredictRiskResponse:
    water_level_component = clamp(flood.water_level_m / MAX_RELEVANT_WATER_LEVEL_M) * 100
    rainfall_component = clamp(flood.rainfall_mm / MAX_RELEVANT_RAINFALL_MM) * 100
    density_component = clamp(district.population_density / MAX_RELEVANT_DENSITY) * 100

    risk_score = round(
        0.5 * water_level_component + 0.3 * rainfall_component + 0.2 * density_component,
        2,
    )

    proximity_factor = clamp(
        1 - district.distance_from_event_km / MAX_RELEVANT_RADIUS_KM, 0.1, 1.0
    )
    affected_fraction = clamp((risk_score / 100) * proximity_factor)
    estimated_affected_population = round(district.total_population * affected_fraction)

    flood_history = [h for h in historical_disasters if h.hazard_type in (None, "flood")]
    confidence_score = clamp(
        BASELINE_CONFIDENCE + min(len(flood_history), 3) * CONFIDENCE_PER_HISTORICAL_RECORD,
        0.0,
        MAX_CONFIDENCE,
    )

    return PredictRiskResponse(
        hazard_type="flood",
        risk_score=risk_score,
        exposure_level=exposure_level_from_score(risk_score),
        estimated_affected_population=estimated_affected_population,
        confidence_score=round(confidence_score, 3),
        model_version=get_settings().model_version,
    )
