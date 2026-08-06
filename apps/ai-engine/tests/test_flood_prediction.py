from app.ml.hazard_prediction.flood import predict_risk
from app.schemas.common import DistrictInput, HistoricalDisasterInput
from app.schemas.predict import FloodDetails

BASE_FLOOD = FloodDetails(rainfall_mm=60.0, water_level_m=2.0, river_basin="Bengawan Solo")


def district(**overrides) -> DistrictInput:
    defaults = dict(
        id="d1",
        name="Kabupaten Bojonegoro",
        total_population=200_000,
        population_density=800.0,
        distance_from_event_km=2.0,
    )
    return DistrictInput(**{**defaults, **overrides})


def test_higher_water_level_increases_risk_score():
    low = predict_risk(BASE_FLOOD.model_copy(update={"water_level_m": 0.3}), district(), [])
    high = predict_risk(BASE_FLOOD.model_copy(update={"water_level_m": 4.5}), district(), [])
    assert high.risk_score > low.risk_score


def test_more_rainfall_increases_risk_score():
    dry_spell = predict_risk(BASE_FLOOD.model_copy(update={"rainfall_mm": 5.0}), district(), [])
    downpour = predict_risk(BASE_FLOOD.model_copy(update={"rainfall_mm": 140.0}), district(), [])
    assert downpour.risk_score > dry_spell.risk_score


def test_higher_population_density_increases_risk_score():
    sparse = predict_risk(BASE_FLOOD, district(population_density=20), [])
    dense = predict_risk(BASE_FLOOD, district(population_density=4500), [])
    assert dense.risk_score > sparse.risk_score


def test_risk_score_is_clamped_to_0_100():
    extreme = predict_risk(
        BASE_FLOOD.model_copy(update={"water_level_m": 20.0, "rainfall_mm": 500.0}),
        district(population_density=10_000),
        [],
    )
    assert 0 <= extreme.risk_score <= 100


def test_benign_conditions_yield_low_exposure_and_minimal_affected_population():
    result = predict_risk(
        FloodDetails(rainfall_mm=2.0, water_level_m=0.1),
        district(population_density=10, total_population=500, distance_from_event_km=14.0),
        [],
    )
    assert result.exposure_level == "low"
    assert result.estimated_affected_population < 50


def test_confidence_reflects_a_live_but_newly_wired_feed():
    # Higher baseline than landslide.py's seeded-data confidence (0.55), below
    # earthquake.py's established-live-feed confidence at the same history
    # length — flood is a live feed, but a newer one.
    with_history = predict_risk(
        BASE_FLOOD,
        district(),
        [HistoricalDisasterInput(event_date="2020-01-01", hazard_type="flood", casualties_dead=10)] * 5,
    )
    assert 0.75 < with_history.confidence_score <= 0.90


def test_hazard_type_is_always_flood():
    result = predict_risk(BASE_FLOOD, district(), [])
    assert result.hazard_type == "flood"
