from app.ml.hazard_prediction.landslide import predict_risk
from app.schemas.common import DistrictInput, HistoricalDisasterInput
from app.schemas.predict import LandslideDetails

BASE_LANDSLIDE = LandslideDetails(slope_degrees=30.0, soil_saturation=0.6, triggering_rainfall_mm=80.0)


def district(**overrides) -> DistrictInput:
    defaults = dict(
        id="d1",
        name="Kabupaten Cilacap",
        total_population=200_000,
        population_density=800.0,
        distance_from_event_km=2.0,
    )
    return DistrictInput(**{**defaults, **overrides})


def test_steeper_slope_increases_risk_score():
    gentle = predict_risk(BASE_LANDSLIDE.model_copy(update={"slope_degrees": 12.0}), district(), [])
    steep = predict_risk(BASE_LANDSLIDE.model_copy(update={"slope_degrees": 48.0}), district(), [])
    assert steep.risk_score > gentle.risk_score


def test_higher_soil_saturation_increases_risk_score():
    dry = predict_risk(BASE_LANDSLIDE.model_copy(update={"soil_saturation": 0.1}), district(), [])
    saturated = predict_risk(BASE_LANDSLIDE.model_copy(update={"soil_saturation": 0.95}), district(), [])
    assert saturated.risk_score > dry.risk_score


def test_more_triggering_rainfall_increases_risk_score():
    dry_spell = predict_risk(BASE_LANDSLIDE.model_copy(update={"triggering_rainfall_mm": 5.0}), district(), [])
    downpour = predict_risk(BASE_LANDSLIDE.model_copy(update={"triggering_rainfall_mm": 140.0}), district(), [])
    assert downpour.risk_score > dry_spell.risk_score


def test_higher_population_density_increases_risk_score():
    sparse = predict_risk(BASE_LANDSLIDE, district(population_density=20), [])
    dense = predict_risk(BASE_LANDSLIDE, district(population_density=4500), [])
    assert dense.risk_score > sparse.risk_score


def test_risk_score_is_clamped_to_0_100():
    extreme = predict_risk(
        BASE_LANDSLIDE.model_copy(update={"slope_degrees": 90.0, "soil_saturation": 1.0, "triggering_rainfall_mm": 500.0}),
        district(population_density=10_000),
        [],
    )
    assert 0 <= extreme.risk_score <= 100


def test_benign_conditions_yield_low_exposure_and_minimal_affected_population():
    result = predict_risk(
        LandslideDetails(slope_degrees=5.0, soil_saturation=0.05, triggering_rainfall_mm=2.0),
        district(population_density=10, total_population=500, distance_from_event_km=45.0),
        [],
    )
    assert result.exposure_level == "low"
    assert result.estimated_affected_population < 50


def test_confidence_is_capped_lower_than_earthquakes_because_data_is_seeded_not_live():
    # docs/SRS.md §6: Phase 1 landslide events are seeded/manual entries, so
    # confidence should never reach earthquake.py's 0.97 cap.
    with_history = predict_risk(
        BASE_LANDSLIDE,
        district(),
        [
            HistoricalDisasterInput(event_date="2020-01-01", hazard_type="landslide", casualties_dead=10)
        ] * 5,
    )
    assert with_history.confidence_score <= 0.85


def test_hazard_type_is_always_landslide():
    result = predict_risk(BASE_LANDSLIDE, district(), [])
    assert result.hazard_type == "landslide"
