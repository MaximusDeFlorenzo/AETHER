"""Explainable AI: turns the numeric prediction + priority into the
structured, human-readable `reasons[]` the dashboard renders directly — same
XAI discipline as AI-ORION's `app/ml/explainability.py` ("never a single
opaque score"), generalized to be hazard-agnostic and extended with a
cascading-hazard reason ORION never had.

Generalizations vs. ORION:
- `population_density`, `event_proximity`, `historical_severity`,
  `affected_population`, `baseline` reasons all carry over, just renamed off
  earthquake-specific terms (`epicenter_proximity` -> `event_proximity`) and
  driven by `hazard_type`-aware thresholds from `priority_scorer.py`.
- The earthquake-only `magnitude` reason becomes hazard-conditional: an
  earthquake still gets a `magnitude` reason, but a landslide gets an
  analogous `triggering_conditions` reason off rainfall/soil-saturation
  instead (there's no magnitude to reason about).
- **New**: `factor="cascading_hazard"` — when the caller passes
  `related_events` (recent nearby events of a different hazard type, e.g. "an
  earthquake occurred nearby 6 hours ago"), each one becomes its own reason.
  This is the direct XAI expression of `docs/SRS.md` FR-5.2 "reasons include
  cascading-hazard factors when `hazard_relationships` rows exist"."""

from app.ml.decision_intelligence.priority_scorer import (
    AFFECTED_POPULATION_THRESHOLD,
    DEFAULT_NEAR_EVENT_KM,
    NEAR_EVENT_KM_BY_HAZARD,
)
from app.schemas.common import DistrictInput, HistoricalDisasterInput, Reason, RelatedHazardEventContext
from app.schemas.predict import HazardEventInput, PredictRiskResponse
from app.schemas.priority import CalculatePriorityResponse

HIGH_DENSITY_THRESHOLD = 1500.0
HIGH_MAGNITUDE_THRESHOLD = 6.5
HIGH_TRIGGERING_RAINFALL_MM = 100.0
HIGH_WATER_LEVEL_M = 3.0
HIGH_FRP_CONFIDENCE = 0.75
SEVERE_HISTORICAL_DEATHS_THRESHOLD = 500
CASCADING_HAZARD_WEIGHT = 0.2


def _hazard_severity_indicator_reason(hazard_event: HazardEventInput) -> Reason | None:
    """The hazard-conditional analogue of ORION's earthquake-only `magnitude`
    reason: each hazard type has a different "this specific event is severe"
    indicator."""
    if hazard_event.hazard_type == "earthquake" and hazard_event.earthquake is not None:
        magnitude = hazard_event.earthquake.magnitude
        if magnitude >= HIGH_MAGNITUDE_THRESHOLD:
            return Reason(
                factor="magnitude",
                detail=f"Magnitude {magnitude} exceeds the {HIGH_MAGNITUDE_THRESHOLD} threshold",
                weight=0.25,
            )
    elif hazard_event.hazard_type == "landslide" and hazard_event.landslide is not None:
        rainfall = hazard_event.landslide.triggering_rainfall_mm
        saturation = hazard_event.landslide.soil_saturation
        if rainfall >= HIGH_TRIGGERING_RAINFALL_MM:
            return Reason(
                factor="triggering_conditions",
                detail=(
                    f"Triggering rainfall of {rainfall:.0f}mm exceeds the "
                    f"{HIGH_TRIGGERING_RAINFALL_MM:.0f}mm threshold with soil saturation at "
                    f"{saturation:.0%}"
                ),
                weight=0.25,
            )
    elif hazard_event.hazard_type == "flood" and hazard_event.flood is not None:
        water_level = hazard_event.flood.water_level_m
        rainfall = hazard_event.flood.rainfall_mm
        if water_level >= HIGH_WATER_LEVEL_M:
            return Reason(
                factor="water_level",
                detail=(
                    f"Water level of {water_level:.1f}m exceeds the {HIGH_WATER_LEVEL_M:.1f}m "
                    f"threshold, with {rainfall:.0f}mm of contributing rainfall"
                ),
                weight=0.25,
            )
    elif hazard_event.hazard_type == "wildfire" and hazard_event.wildfire is not None:
        frp_confidence = hazard_event.wildfire.frp_confidence
        hotspot_count = hazard_event.wildfire.hotspot_count
        if frp_confidence >= HIGH_FRP_CONFIDENCE:
            return Reason(
                factor="frp_confidence",
                detail=(
                    f"FIRMS fire-radiative-power confidence of {frp_confidence:.0%} exceeds the "
                    f"{HIGH_FRP_CONFIDENCE:.0%} threshold across {hotspot_count} detected hotspots"
                ),
                weight=0.25,
            )
    return None


def _cascading_hazard_reasons(related_events: list[RelatedHazardEventContext]) -> list[Reason]:
    reasons: list[Reason] = []
    for related in related_events:
        relationship_phrase = (
            f"a plausible '{related.relationship_type}' relationship"
            if related.relationship_type
            else "a spatiotemporal correlation"
        )
        direction = "before" if related.hours_apart < 0 else "after"
        reasons.append(
            Reason(
                factor="cascading_hazard",
                detail=(
                    f"A {related.hazard_type} event occurred {abs(related.hours_apart):.1f} "
                    f"hours {direction}, {related.distance_km:.1f} km away — {relationship_phrase}"
                ),
                weight=CASCADING_HAZARD_WEIGHT,
            )
        )
    return reasons


def generate_recommendation(
    hazard_event: HazardEventInput,
    district: DistrictInput,
    prediction: PredictRiskResponse,
    priority: CalculatePriorityResponse,
    historical_disasters: list[HistoricalDisasterInput] | None = None,
    related_events: list[RelatedHazardEventContext] | None = None,
) -> tuple[str, list[Reason]]:
    historical_disasters = historical_disasters or []
    related_events = related_events or []
    reasons: list[Reason] = []

    if district.population_density >= HIGH_DENSITY_THRESHOLD:
        reasons.append(
            Reason(
                factor="population_density",
                detail=f"High population density ({district.population_density:,.0f}/km²)",
                weight=0.3,
            )
        )

    severity_reason = _hazard_severity_indicator_reason(hazard_event)
    if severity_reason is not None:
        reasons.append(severity_reason)

    near_event_km = NEAR_EVENT_KM_BY_HAZARD.get(hazard_event.hazard_type, DEFAULT_NEAR_EVENT_KM)
    if district.distance_from_event_km <= near_event_km:
        reasons.append(
            Reason(
                factor="event_proximity",
                detail=f"Event within {near_event_km:.0f} km of a populated area "
                f"({district.distance_from_event_km:.1f} km away)",
                weight=0.2,
            )
        )

    worst_historical = max((h.casualties_dead for h in historical_disasters), default=0)
    if worst_historical >= SEVERE_HISTORICAL_DEATHS_THRESHOLD:
        reasons.append(
            Reason(
                factor="historical_severity",
                detail="Historical records indicate severe damage in this region "
                f"(up to {worst_historical:,} casualties in past events)",
                weight=0.15,
            )
        )

    if prediction.estimated_affected_population >= AFFECTED_POPULATION_THRESHOLD:
        reasons.append(
            Reason(
                factor="affected_population",
                detail="Estimated affected population exceeds threshold "
                f"({prediction.estimated_affected_population:,})",
                weight=0.1,
            )
        )

    reasons.extend(_cascading_hazard_reasons(related_events))

    if not reasons:
        reasons.append(
            Reason(
                factor="baseline",
                detail="No single factor exceeded a high-priority threshold; "
                "priority is driven by overall computed risk score "
                f"({prediction.risk_score:.1f}/100)",
                weight=None,
            )
        )

    summary_text = (
        f"Response to {district.name} is prioritized at {priority.priority_level.upper()} "
        f"level because: " + "; ".join(r.detail for r in reasons) + "."
    )

    return summary_text, reasons
