from app.ml.decision_intelligence.explainability import generate_recommendation
from app.schemas.common import DistrictInput, HistoricalDisasterInput, RelatedHazardEventContext
from app.schemas.predict import EarthquakeDetails, HazardEventInput, LandslideDetails, PredictRiskResponse
from app.schemas.priority import CalculatePriorityResponse

EARTHQUAKE_EVENT = HazardEventInput(
    hazard_type="earthquake",
    latitude=-7.5,
    longitude=110.2,
    event_time="2026-07-04T03:12:00Z",
    earthquake=EarthquakeDetails(magnitude=6.8, depth_km=10.0),
)
LANDSLIDE_EVENT = HazardEventInput(
    hazard_type="landslide",
    latitude=-7.6,
    longitude=110.3,
    event_time="2026-07-04T09:12:00Z",
    landslide=LandslideDetails(slope_degrees=35.0, soil_saturation=0.7, triggering_rainfall_mm=120.0),
)
PREDICTION = PredictRiskResponse(
    hazard_type="earthquake",
    risk_score=70.0,
    exposure_level="high",
    estimated_affected_population=300_000,
    confidence_score=0.9,
    model_version="test",
)
PRIORITY = CalculatePriorityResponse(priority_level="high", priority_score=75.0, confidence_score=0.9)


def district(**overrides) -> DistrictInput:
    defaults = dict(
        id="d1", name="Kabupaten Bantul", total_population=1_000_000,
        population_density=500.0, distance_from_event_km=50.0,
    )
    return DistrictInput(**{**defaults, **overrides})


def test_high_density_district_gets_a_population_density_reason():
    _, reasons = generate_recommendation(EARTHQUAKE_EVENT, district(population_density=2000), PREDICTION, PRIORITY)
    assert "population_density" in [r.factor for r in reasons]


def test_low_density_district_does_not_get_a_population_density_reason():
    _, reasons = generate_recommendation(EARTHQUAKE_EVENT, district(population_density=200), PREDICTION, PRIORITY)
    assert "population_density" not in [r.factor for r in reasons]


def test_high_magnitude_earthquake_gets_a_magnitude_reason():
    high_mag = EARTHQUAKE_EVENT.model_copy(update={"earthquake": EarthquakeDetails(magnitude=7.0, depth_km=10.0)})
    _, reasons = generate_recommendation(high_mag, district(), PREDICTION, PRIORITY)
    assert "magnitude" in [r.factor for r in reasons]


def test_low_magnitude_earthquake_does_not_get_a_magnitude_reason():
    low_mag = EARTHQUAKE_EVENT.model_copy(update={"earthquake": EarthquakeDetails(magnitude=5.0, depth_km=10.0)})
    _, reasons = generate_recommendation(low_mag, district(), PREDICTION, PRIORITY)
    assert "magnitude" not in [r.factor for r in reasons]


def test_landslide_with_high_rainfall_gets_a_triggering_conditions_reason():
    _, reasons = generate_recommendation(LANDSLIDE_EVENT, district(), PREDICTION, PRIORITY)
    assert "triggering_conditions" in [r.factor for r in reasons]


def test_landslide_with_low_rainfall_does_not_get_a_triggering_conditions_reason():
    mild = LANDSLIDE_EVENT.model_copy(
        update={"landslide": LandslideDetails(slope_degrees=15.0, soil_saturation=0.2, triggering_rainfall_mm=10.0)}
    )
    _, reasons = generate_recommendation(mild, district(), PREDICTION, PRIORITY)
    assert "triggering_conditions" not in [r.factor for r in reasons]


def test_event_proximity_reason_only_within_earthquakes_5km_threshold():
    near_reasons = generate_recommendation(EARTHQUAKE_EVENT, district(distance_from_event_km=3.0), PREDICTION, PRIORITY)[1]
    far_reasons = generate_recommendation(EARTHQUAKE_EVENT, district(distance_from_event_km=50.0), PREDICTION, PRIORITY)[1]
    assert "event_proximity" in [r.factor for r in near_reasons]
    assert "event_proximity" not in [r.factor for r in far_reasons]


def test_severe_historical_record_adds_a_historical_severity_reason():
    severe_history = [
        HistoricalDisasterInput(event_date="2006-05-27", hazard_type="earthquake", magnitude=6.3, casualties_dead=5782, damaged_buildings_count=156662)
    ]
    _, reasons = generate_recommendation(
        EARTHQUAKE_EVENT, district(), PREDICTION, PRIORITY, historical_disasters=severe_history
    )
    assert "historical_severity" in [r.factor for r in reasons]


def test_mild_historical_record_does_not_add_a_historical_severity_reason():
    mild_history = [
        HistoricalDisasterInput(event_date="2020-01-01", hazard_type="earthquake", magnitude=4.5, casualties_dead=2, damaged_buildings_count=10)
    ]
    _, reasons = generate_recommendation(
        EARTHQUAKE_EVENT, district(), PREDICTION, PRIORITY, historical_disasters=mild_history
    )
    assert "historical_severity" not in [r.factor for r in reasons]


def test_high_estimated_population_adds_an_affected_population_reason():
    high_pop_prediction = PREDICTION.model_copy(update={"estimated_affected_population": 200_000})
    _, reasons = generate_recommendation(EARTHQUAKE_EVENT, district(), high_pop_prediction, PRIORITY)
    assert "affected_population" in [r.factor for r in reasons]


def test_related_event_produces_a_cascading_hazard_reason():
    related = [
        RelatedHazardEventContext(
            hazard_type="earthquake",
            relationship_type="triggers",
            distance_km=8.0,
            hours_apart=6.0,
            magnitude=6.5,
        )
    ]
    _, reasons = generate_recommendation(
        LANDSLIDE_EVENT, district(population_density=100, distance_from_event_km=100),
        PREDICTION.model_copy(update={"estimated_affected_population": 500}),
        PRIORITY, related_events=related,
    )
    cascading = [r for r in reasons if r.factor == "cascading_hazard"]
    assert len(cascading) == 1
    assert "earthquake" in cascading[0].detail
    assert "6.0 hours" in cascading[0].detail


def test_no_related_events_means_no_cascading_hazard_reason():
    _, reasons = generate_recommendation(EARTHQUAKE_EVENT, district(), PREDICTION, PRIORITY)
    assert "cascading_hazard" not in [r.factor for r in reasons]


def test_falls_back_to_a_baseline_reason_when_no_threshold_is_crossed():
    mild_earthquake = EARTHQUAKE_EVENT.model_copy(update={"earthquake": EarthquakeDetails(magnitude=5.0, depth_km=10.0)})
    mild_prediction = PREDICTION.model_copy(update={"estimated_affected_population": 500, "risk_score": 20.0})
    _, reasons = generate_recommendation(
        mild_earthquake, district(population_density=100, distance_from_event_km=100), mild_prediction, PRIORITY
    )
    assert len(reasons) == 1
    assert reasons[0].factor == "baseline"


def test_summary_text_names_the_district_and_priority_level():
    summary, _ = generate_recommendation(EARTHQUAKE_EVENT, district(), PREDICTION, PRIORITY)
    assert district().name in summary
    assert "HIGH" in summary
