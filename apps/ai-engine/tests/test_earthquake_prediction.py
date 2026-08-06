from app.ml.hazard_prediction.earthquake import predict_risk
from app.schemas.common import DistrictInput, HistoricalDisasterInput
from app.schemas.predict import EarthquakeDetails

BASE_EARTHQUAKE = EarthquakeDetails(magnitude=6.8, depth_km=10.0)


def district(**overrides) -> DistrictInput:
    defaults = dict(
        id="d1",
        name="Kabupaten Bantul",
        total_population=1_000_000,
        population_density=2000.0,
        distance_from_event_km=5.0,
    )
    return DistrictInput(**{**defaults, **overrides})


def test_higher_magnitude_increases_risk_score():
    low = predict_risk(BASE_EARTHQUAKE.model_copy(update={"magnitude": 4.5}), district(), [])
    high = predict_risk(BASE_EARTHQUAKE.model_copy(update={"magnitude": 8.0}), district(), [])
    assert high.risk_score > low.risk_score


def test_shallower_depth_increases_risk_score():
    shallow = predict_risk(BASE_EARTHQUAKE.model_copy(update={"depth_km": 5}), district(), [])
    deep = predict_risk(BASE_EARTHQUAKE.model_copy(update={"depth_km": 90}), district(), [])
    assert shallow.risk_score > deep.risk_score


def test_higher_population_density_increases_risk_score():
    sparse = predict_risk(BASE_EARTHQUAKE, district(population_density=50), [])
    dense = predict_risk(BASE_EARTHQUAKE, district(population_density=4800), [])
    assert dense.risk_score > sparse.risk_score


def test_risk_score_is_clamped_to_0_100():
    extreme = predict_risk(
        BASE_EARTHQUAKE.model_copy(update={"magnitude": 9.9, "depth_km": 0}),
        district(population_density=10_000),
        [],
    )
    assert 0 <= extreme.risk_score <= 100


def test_a_negligible_event_yields_minimal_estimated_affected_population():
    result = predict_risk(
        BASE_EARTHQUAKE.model_copy(update={"magnitude": 4.0, "depth_km": 100}),
        district(population_density=10, total_population=1000, distance_from_event_km=290),
        [],
    )
    assert result.exposure_level == "low"
    assert result.estimated_affected_population < 100


def test_more_historical_disasters_raises_confidence_up_to_the_cap():
    no_history = predict_risk(BASE_EARTHQUAKE, district(), [])
    with_history = predict_risk(
        BASE_EARTHQUAKE,
        district(),
        [
            HistoricalDisasterInput(
                event_date="2006-05-27", hazard_type="earthquake", magnitude=6.3,
                casualties_dead=5782, damaged_buildings_count=1000,
            )
        ] * 5,
    )
    assert with_history.confidence_score > no_history.confidence_score
    assert with_history.confidence_score <= 0.97


def test_exposure_level_thresholds_are_monotonic_with_risk_score():
    order = ["low", "moderate", "high", "severe"]
    previous_rank = -1
    for magnitude in [4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 9.0]:
        result = predict_risk(
            BASE_EARTHQUAKE.model_copy(update={"magnitude": magnitude, "depth_km": 5}),
            district(population_density=4000),
            [],
        )
        rank = order.index(result.exposure_level)
        assert rank >= previous_rank
        previous_rank = rank


def test_hazard_type_is_always_earthquake():
    result = predict_risk(BASE_EARTHQUAKE, district(), [])
    assert result.hazard_type == "earthquake"
