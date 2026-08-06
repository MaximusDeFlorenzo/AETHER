from app.ml.hazard_prediction.wildfire import predict_risk
from app.schemas.common import DistrictInput, HistoricalDisasterInput
from app.schemas.predict import WildfireDetails

BASE_WILDFIRE = WildfireDetails(frp_confidence=0.6, hotspot_count=5, brightness_kelvin=340.0)


def district(**overrides) -> DistrictInput:
    defaults = dict(
        id="d1",
        name="Kabupaten Musi Banyuasin",
        total_population=200_000,
        population_density=800.0,
        distance_from_event_km=2.0,
    )
    return DistrictInput(**{**defaults, **overrides})


def test_higher_frp_confidence_increases_risk_score():
    low = predict_risk(BASE_WILDFIRE.model_copy(update={"frp_confidence": 0.1}), district(), [])
    high = predict_risk(BASE_WILDFIRE.model_copy(update={"frp_confidence": 0.95}), district(), [])
    assert high.risk_score > low.risk_score


def test_more_hotspots_increases_risk_score():
    few = predict_risk(BASE_WILDFIRE.model_copy(update={"hotspot_count": 1}), district(), [])
    many = predict_risk(BASE_WILDFIRE.model_copy(update={"hotspot_count": 18}), district(), [])
    assert many.risk_score > few.risk_score


def test_higher_population_density_increases_risk_score():
    sparse = predict_risk(BASE_WILDFIRE, district(population_density=20), [])
    dense = predict_risk(BASE_WILDFIRE, district(population_density=4500), [])
    assert dense.risk_score > sparse.risk_score


def test_risk_score_is_clamped_to_0_100():
    extreme = predict_risk(
        BASE_WILDFIRE.model_copy(update={"frp_confidence": 1.0, "hotspot_count": 100}),
        district(population_density=10_000),
        [],
    )
    assert 0 <= extreme.risk_score <= 100


def test_benign_conditions_yield_low_exposure_and_minimal_affected_population():
    result = predict_risk(
        WildfireDetails(frp_confidence=0.05, hotspot_count=1),
        district(population_density=10, total_population=500, distance_from_event_km=24.0),
        [],
    )
    assert result.exposure_level == "low"
    assert result.estimated_affected_population < 50


def test_brightness_kelvin_is_optional():
    result = predict_risk(WildfireDetails(frp_confidence=0.5, hotspot_count=3), district(), [])
    assert 0 <= result.risk_score <= 100


def test_confidence_reflects_an_established_live_feed_like_earthquake():
    # NASA FIRMS is a well-established public feed, comparable in maturity to
    # BMKG — so wildfire's confidence should approach earthquake.py's 0.97 cap.
    with_history = predict_risk(
        BASE_WILDFIRE,
        district(),
        [HistoricalDisasterInput(event_date="2020-01-01", hazard_type="wildfire", casualties_dead=10)] * 5,
    )
    assert with_history.confidence_score > 0.85


def test_hazard_type_is_always_wildfire():
    result = predict_risk(BASE_WILDFIRE, district(), [])
    assert result.hazard_type == "wildfire"
