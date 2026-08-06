from app.ml.decision_intelligence.priority_scorer import calculate_priority
from app.schemas.common import DistrictInput
from app.schemas.predict import PredictRiskResponse


def district(distance_from_event_km: float = 10.0) -> DistrictInput:
    return DistrictInput(
        id="d1",
        name="Kabupaten Bantul",
        total_population=1_000_000,
        population_density=2000.0,
        distance_from_event_km=distance_from_event_km,
    )


def prediction(
    risk_score: float,
    estimated_affected_population: int,
    confidence_score: float = 0.8,
    hazard_type: str = "earthquake",
) -> PredictRiskResponse:
    return PredictRiskResponse(
        hazard_type=hazard_type,
        risk_score=risk_score,
        exposure_level="moderate",
        estimated_affected_population=estimated_affected_population,
        confidence_score=confidence_score,
        model_version="test",
    )


def test_low_severity_and_low_population_yields_low_priority():
    level, score, _ = calculate_priority(
        "earthquake", prediction(risk_score=10, estimated_affected_population=1000), district()
    )
    assert level == "low"
    assert score < 40


def test_high_severity_and_high_population_yields_critical_priority():
    level, score, _ = calculate_priority(
        "earthquake",
        prediction(risk_score=100, estimated_affected_population=200_000),
        district(distance_from_event_km=2.0),
    )
    assert level == "critical"
    assert score >= 80


def test_proximity_bonus_applies_within_earthquakes_5km_not_beyond():
    near = calculate_priority(
        "earthquake", prediction(risk_score=50, estimated_affected_population=50_000), district(4.9)
    )
    far = calculate_priority(
        "earthquake", prediction(risk_score=50, estimated_affected_population=50_000), district(5.1)
    )
    assert near[1] > far[1]  # priority_score


def test_landslide_uses_a_tighter_proximity_threshold_than_earthquake():
    # 3km is "near" for earthquake (threshold 5km) but not for landslide (threshold 2km).
    earthquake_score = calculate_priority(
        "earthquake", prediction(risk_score=50, estimated_affected_population=50_000), district(3.0)
    )[1]
    landslide_score = calculate_priority(
        "landslide", prediction(risk_score=50, estimated_affected_population=50_000, hazard_type="landslide"), district(3.0)
    )[1]
    assert earthquake_score > landslide_score


def test_priority_score_stays_within_0_100_at_the_theoretical_maximum():
    level, score, _ = calculate_priority(
        "earthquake",
        prediction(risk_score=100, estimated_affected_population=10_000_000),
        district(0.0),
    )
    assert 0 <= score <= 100
    assert level == "critical"


def test_confidence_score_is_passed_through_from_the_prediction():
    _, _, confidence = calculate_priority(
        "earthquake",
        prediction(risk_score=50, estimated_affected_population=50_000, confidence_score=0.913),
        district(),
    )
    assert confidence == 0.913
