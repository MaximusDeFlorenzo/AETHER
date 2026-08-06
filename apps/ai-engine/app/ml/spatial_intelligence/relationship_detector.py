"""Hazard relationship detector — the core "model relationships between
hazards instead of treating them independently" capability. No ORION
equivalent (docs/MIGRATION_FROM_ORION.md lists `hazard_relationships`
detection under "Discard-from-ORION / build new").

v0 baseline, same documented-heuristic posture as every other `app/ml/`
module in this service: simple, transparent distance/time-window rules
rather than a trained classifier, since there's no labeled
"was this actually a cascading pair" dataset to fit against yet.

Rule of thumb (backs docs/SRS.md FR-3.2): a new event within a correlation
window/radius of a recent event of a different hazard type gets classified
into one of three buckets, narrowest-and-most-confident first:

- **triggers** — a plausible causal link: the candidate happened *after* the
  source, close by, soon after, and the source was physically capable of
  triggering it (e.g. earthquake magnitude >= `TRIGGER_MAGNITUDE_MIN`, per
  USGS-documented ballpark magnitudes at which shaking can initiate slope
  failure). Highest confidence.
- **exacerbates** — a broader spatiotemporal window where the source
  plausibly worsened conditions without being a direct trigger (e.g. too far
  or too long ago to be "the" trigger, but still a contributing factor).
  Moderate confidence.
- **coincides** — same-window co-occurrence with no directional/causal
  claim — the two events are correlated in space/time but the rule set
  doesn't assert one caused the other. Lowest confidence.
- Outside every window: no relationship (`None`, confidence `0.0`).

Confidence within a bucket decays linearly with both distance and time —
closer and sooner is always more confident than farther and later, even
within the same bucket.
"""

from app.schemas.common import HazardType
from app.schemas.relationships import CandidateRelatedEvent, HazardEventRef, RelationshipType

# "triggers" window — a source event that could plausibly have *caused* the
# candidate. Earthquake -> landslide is Phase 1's one concrete trigger pair.
TRIGGER_DISTANCE_KM_MAX = 50.0
TRIGGER_HOURS_MAX = 72.0
TRIGGER_MAGNITUDE_MIN = 5.0

# "exacerbates" window — broader than "triggers"; the source plausibly
# worsened conditions (e.g. an earlier, smaller earthquake loosening soil)
# without being confidently "the" cause.
EXACERBATE_DISTANCE_KM_MAX = 100.0
EXACERBATE_HOURS_MAX = 168.0  # 7 days

# "coincides" window — broad spatiotemporal co-occurrence, no causal claim.
COINCIDE_DISTANCE_KM_MAX = 150.0
COINCIDE_HOURS_MAX = 24.0

# Pairs of (source_hazard_type, candidate_hazard_type) for which a causal
# "triggers" relationship is physically plausible at all. Order matters:
# earthquake can trigger a landslide, but a landslide "triggering" an
# earthquake is not a real phenomenon this heuristic should ever assert.
#
# Phase 2 additions, each a well-documented cascading-hazard pathway:
# - landslide -> flood: debris damming a waterway, then failing (outburst
#   flood) or simply backing up water behind the blockage.
# - wildfire -> flood: burn scars lose vegetation/infiltration capacity, so
#   the next rainfall runs off far faster than on unburned ground (post-fire
#   flash flooding, a well-documented phenomenon independent of rainfall
#   intensity alone).
# - wildfire -> landslide: the same loss of root-structure/infiltration
#   destabilizes slopes, making a post-fire burn scar susceptible to
#   landslides/debris flows at rainfall intensities that wouldn't have
#   triggered one pre-fire.
PLAUSIBLE_TRIGGER_PAIRS: set[tuple[HazardType, HazardType]] = {
    ("earthquake", "landslide"),
    ("landslide", "flood"),
    ("wildfire", "flood"),
    ("wildfire", "landslide"),
}

TRIGGERS_BASE_CONFIDENCE = 0.9
EXACERBATES_BASE_CONFIDENCE = 0.6
COINCIDES_BASE_CONFIDENCE = 0.35


def _decay(distance_km: float, hours_apart: float, distance_max: float, hours_max: float) -> float:
    """Linear decay in [0, 1]: 1.0 at zero distance/time, 0.0 at the window's
    outer edge. Both factors multiply, so a relationship right at the edge of
    either dimension is already low-confidence even if the other dimension is
    close to zero."""
    distance_factor = max(0.0, 1 - (distance_km / distance_max)) if distance_max > 0 else 0.0
    time_factor = max(0.0, 1 - (hours_apart / hours_max)) if hours_max > 0 else 0.0
    return distance_factor * time_factor


def detect_relationship(
    source: HazardEventRef, candidate: CandidateRelatedEvent
) -> tuple[RelationshipType | None, float, str]:
    """Returns `(relationship_type, confidence_score, rationale)` for a single
    source/candidate pair. `relationship_type` is `None` (confidence `0.0`)
    when neither event falls within any correlation window."""
    distance_km = candidate.distance_km
    hours_apart = abs(candidate.hours_apart)
    candidate_after_source = candidate.hours_apart >= 0

    can_trigger = (
        candidate_after_source
        and (source.hazard_type, candidate.hazard_type) in PLAUSIBLE_TRIGGER_PAIRS
    )
    # Magnitude is only meaningful for an earthquake source (docs/schemas/
    # relationships.py: "earthquake magnitude, when applicable") — other
    # trigger-capable hazards (landslide, wildfire) have no magnitude field,
    # so their triggering capability is asserted by pair membership alone.
    if can_trigger and source.hazard_type == "earthquake":
        can_trigger = source.magnitude is not None and source.magnitude >= TRIGGER_MAGNITUDE_MIN

    if (
        can_trigger
        and distance_km <= TRIGGER_DISTANCE_KM_MAX
        and hours_apart <= TRIGGER_HOURS_MAX
    ):
        confidence = round(
            TRIGGERS_BASE_CONFIDENCE
            * _decay(distance_km, hours_apart, TRIGGER_DISTANCE_KM_MAX, TRIGGER_HOURS_MAX),
            3,
        )
        source_label = (
            f"{source.hazard_type.capitalize()} (M{source.magnitude})"
            if source.magnitude is not None
            else source.hazard_type.capitalize()
        )
        rationale = (
            f"{source_label} {hours_apart:.1f}h before "
            f"a {candidate.hazard_type} event, {distance_km:.1f} km away — within the "
            f"{TRIGGER_DISTANCE_KM_MAX:.0f} km / {TRIGGER_HOURS_MAX:.0f}h trigger window."
        )
        return "triggers", max(confidence, 0.0), rationale

    if distance_km <= EXACERBATE_DISTANCE_KM_MAX and hours_apart <= EXACERBATE_HOURS_MAX:
        confidence = round(
            EXACERBATES_BASE_CONFIDENCE
            * _decay(distance_km, hours_apart, EXACERBATE_DISTANCE_KM_MAX, EXACERBATE_HOURS_MAX),
            3,
        )
        rationale = (
            f"{source.hazard_type.capitalize()} and {candidate.hazard_type} events "
            f"{hours_apart:.1f}h apart, {distance_km:.1f} km apart — within the "
            f"{EXACERBATE_DISTANCE_KM_MAX:.0f} km / {EXACERBATE_HOURS_MAX:.0f}h exacerbation window."
        )
        return "exacerbates", max(confidence, 0.0), rationale

    if distance_km <= COINCIDE_DISTANCE_KM_MAX and hours_apart <= COINCIDE_HOURS_MAX:
        confidence = round(
            COINCIDES_BASE_CONFIDENCE
            * _decay(distance_km, hours_apart, COINCIDE_DISTANCE_KM_MAX, COINCIDE_HOURS_MAX),
            3,
        )
        rationale = (
            f"{source.hazard_type.capitalize()} and {candidate.hazard_type} events co-occur "
            f"{hours_apart:.1f}h apart, {distance_km:.1f} km apart — within the broad "
            f"{COINCIDE_DISTANCE_KM_MAX:.0f} km / {COINCIDE_HOURS_MAX:.0f}h coincidence window, "
            "no causal direction asserted."
        )
        return "coincides", max(confidence, 0.0), rationale

    return (
        None,
        0.0,
        f"{distance_km:.1f} km / {hours_apart:.1f}h apart — outside every correlation window.",
    )
