from app.ml.spatial_intelligence.relationship_detector import detect_relationship
from app.schemas.relationships import CandidateRelatedEvent, HazardEventRef

STRONG_EARTHQUAKE = HazardEventRef(hazard_type="earthquake", magnitude=6.5, event_time="2026-07-04T03:00:00Z")
WEAK_EARTHQUAKE = HazardEventRef(hazard_type="earthquake", magnitude=4.0, event_time="2026-07-04T03:00:00Z")


def test_strong_nearby_soon_after_earthquake_triggers_a_landslide():
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=10.0, hours_apart=6.0)
    relationship_type, confidence, rationale = detect_relationship(STRONG_EARTHQUAKE, candidate)
    assert relationship_type == "triggers"
    assert confidence > 0.5
    assert "landslide" in rationale


def test_weak_earthquake_does_not_trigger_even_if_close_and_soon():
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=10.0, hours_apart=6.0)
    relationship_type, confidence, _ = detect_relationship(WEAK_EARTHQUAKE, candidate)
    assert relationship_type != "triggers"


def test_far_away_strong_earthquake_does_not_trigger_but_may_exacerbate():
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=80.0, hours_apart=6.0)
    relationship_type, confidence, _ = detect_relationship(STRONG_EARTHQUAKE, candidate)
    assert relationship_type == "exacerbates"
    assert confidence > 0.0


def test_long_delayed_strong_earthquake_does_not_trigger_but_may_exacerbate():
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=10.0, hours_apart=120.0)
    relationship_type, _, _ = detect_relationship(STRONG_EARTHQUAKE, candidate)
    assert relationship_type == "exacerbates"


def test_events_far_outside_every_window_have_no_relationship():
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=500.0, hours_apart=1000.0)
    relationship_type, confidence, _ = detect_relationship(STRONG_EARTHQUAKE, candidate)
    assert relationship_type is None
    assert confidence == 0.0


def test_broad_but_plausible_window_coincides_when_beyond_exacerbate_range():
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=120.0, hours_apart=20.0)
    relationship_type, confidence, _ = detect_relationship(STRONG_EARTHQUAKE, candidate)
    assert relationship_type == "coincides"
    assert confidence > 0.0


def test_candidate_before_source_cannot_trigger():
    # A landslide happening *before* the earthquake cannot have been triggered by it.
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=5.0, hours_apart=-2.0)
    relationship_type, _, _ = detect_relationship(STRONG_EARTHQUAKE, candidate)
    assert relationship_type != "triggers"


def test_confidence_decays_with_distance_within_the_same_bucket():
    close = detect_relationship(
        STRONG_EARTHQUAKE, CandidateRelatedEvent(hazard_type="landslide", distance_km=5.0, hours_apart=1.0)
    )
    far = detect_relationship(
        STRONG_EARTHQUAKE, CandidateRelatedEvent(hazard_type="landslide", distance_km=45.0, hours_apart=1.0)
    )
    assert close[0] == far[0] == "triggers"
    assert close[1] > far[1]


def test_landslide_cannot_trigger_an_earthquake():
    # PLAUSIBLE_TRIGGER_PAIRS only allows earthquake -> landslide, not the reverse.
    source = HazardEventRef(hazard_type="landslide", event_time="2026-07-04T03:00:00Z")
    candidate = CandidateRelatedEvent(hazard_type="earthquake", magnitude=6.0, distance_km=5.0, hours_apart=1.0)
    relationship_type, _, _ = detect_relationship(source, candidate)
    assert relationship_type != "triggers"


def test_nearby_soon_after_landslide_triggers_a_flood():
    # Landslide debris damming a waterway — no magnitude field applies to a
    # landslide source, so trigger capability is asserted by pair membership.
    source = HazardEventRef(hazard_type="landslide", event_time="2026-07-04T03:00:00Z")
    candidate = CandidateRelatedEvent(hazard_type="flood", distance_km=8.0, hours_apart=4.0)
    relationship_type, confidence, rationale = detect_relationship(source, candidate)
    assert relationship_type == "triggers"
    assert confidence > 0.5
    assert "flood" in rationale


def test_nearby_soon_after_wildfire_triggers_a_flood():
    # Post-fire burn-scar flash flooding.
    source = HazardEventRef(hazard_type="wildfire", event_time="2026-07-04T03:00:00Z")
    candidate = CandidateRelatedEvent(hazard_type="flood", distance_km=5.0, hours_apart=10.0)
    relationship_type, confidence, _ = detect_relationship(source, candidate)
    assert relationship_type == "triggers"
    assert confidence > 0.0


def test_nearby_soon_after_wildfire_triggers_a_landslide():
    # Post-fire slope destabilization.
    source = HazardEventRef(hazard_type="wildfire", event_time="2026-07-04T03:00:00Z")
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=5.0, hours_apart=10.0)
    relationship_type, confidence, _ = detect_relationship(source, candidate)
    assert relationship_type == "triggers"
    assert confidence > 0.0


def test_flood_cannot_trigger_a_landslide():
    # flood -> landslide is not in PLAUSIBLE_TRIGGER_PAIRS (only the reverse,
    # landslide -> flood, is a documented cascading pathway).
    source = HazardEventRef(hazard_type="flood", event_time="2026-07-04T03:00:00Z")
    candidate = CandidateRelatedEvent(hazard_type="landslide", distance_km=5.0, hours_apart=1.0)
    relationship_type, _, _ = detect_relationship(source, candidate)
    assert relationship_type != "triggers"
