"""Wildfire (forest fire) risk heuristic — no ORION equivalent. Written
analogously to `landslide.py`/`flood.py`: same documented-weighted-heuristic
style, same `clamp`/`exposure_level_from_score` helpers, same
v0-not-a-trained-model posture, applied to wildfire-appropriate physical
drivers sourced from NASA FIRMS hotspot detections.

Drivers, all standard FIRMS-derived wildfire-severity factors:
- `frp_confidence` (0-1) — FIRMS' own per-hotspot detection confidence (fire
  radiative power confidence). Already a 0-1 fraction, maps directly to a
  0-100 component, weighted most heavily since it's FIRMS' own assessment of
  how likely this detection is a real fire (vs. a false positive from e.g.
  a hot road surface).
- `hotspot_count` — number of concurrent FIRMS hotspot detections clustered
  near this event. More concurrent hotspots indicate a larger, more
  established burn rather than a single transient thermal anomaly.
  Normalized against a documented cap of 20 concurrent hotspots (beyond which
  additional detections don't meaningfully change the severity assessment
  captured here — the fire is already unambiguously large).
- `population_density` — same exposure-side role it plays in every other
  hazard module, not a physical driver of the fire itself.

`brightness_kelvin` is optional/descriptive (feeds XAI reason text via
`explainability.py`, roughly correlating with fire intensity) rather than a
scoring input, since not every FIRMS record reports it consistently and it is
strongly correlated with `frp_confidence` already captured above.

Per docs/SRS.md §1, wildfire is a Phase 2 hazard type sourced from a live
NASA FIRMS satellite-hotspot adapter once wired
(`apps/api/src/ingestion/adapters/nasa-firms.adapter.ts`) — a well-established
public feed, comparable in maturity to BMKG's earthquake feed — so confidence
starts and caps close to `earthquake.py`'s live-feed baseline rather than
`landslide.py`'s seeded-data baseline. Proximity uses a wider radius than the
other three hazards to reflect wind-driven fire spread beyond the detected
hotspot pixel.
"""

from app.core.config import get_settings
from app.ml.hazard_prediction.common import clamp, exposure_level_from_score
from app.schemas.common import DistrictInput, HistoricalDisasterInput
from app.schemas.predict import PredictRiskResponse, WildfireDetails

MAX_RELEVANT_HOTSPOT_COUNT = 20.0
MAX_RELEVANT_DENSITY = 5000.0
# Wildfires spread with wind well beyond the detected hotspot pixel, so this
# uses the widest proximity radius of any hazard module here.
MAX_RELEVANT_RADIUS_KM = 25.0

BASELINE_CONFIDENCE = 0.68
MAX_CONFIDENCE = 0.96
CONFIDENCE_PER_HISTORICAL_RECORD = 0.07


def predict_risk(
    wildfire: WildfireDetails,
    district: DistrictInput,
    historical_disasters: list[HistoricalDisasterInput],
) -> PredictRiskResponse:
    frp_component = clamp(wildfire.frp_confidence) * 100
    hotspot_component = clamp(wildfire.hotspot_count / MAX_RELEVANT_HOTSPOT_COUNT) * 100
    density_component = clamp(district.population_density / MAX_RELEVANT_DENSITY) * 100

    risk_score = round(
        0.55 * frp_component + 0.25 * hotspot_component + 0.20 * density_component,
        2,
    )

    proximity_factor = clamp(
        1 - district.distance_from_event_km / MAX_RELEVANT_RADIUS_KM, 0.1, 1.0
    )
    affected_fraction = clamp((risk_score / 100) * proximity_factor)
    estimated_affected_population = round(district.total_population * affected_fraction)

    wildfire_history = [h for h in historical_disasters if h.hazard_type in (None, "wildfire")]
    confidence_score = clamp(
        BASELINE_CONFIDENCE + min(len(wildfire_history), 3) * CONFIDENCE_PER_HISTORICAL_RECORD,
        0.0,
        MAX_CONFIDENCE,
    )

    return PredictRiskResponse(
        hazard_type="wildfire",
        risk_score=risk_score,
        exposure_level=exposure_level_from_score(risk_score),
        estimated_affected_population=estimated_affected_population,
        confidence_score=round(confidence_score, 3),
        model_version=get_settings().model_version,
    )
