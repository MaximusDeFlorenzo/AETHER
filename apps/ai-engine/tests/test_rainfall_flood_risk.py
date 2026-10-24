from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import get_settings
from app.main import app
from app.ml.rainfall.flood_risk import (
    assess_point,
    daily_category,
    hourly_category,
    susceptibility_class,
)
from app.schemas.rainfall_flood import FloodPointIn, FloodRiskParameters

client = TestClient(app)
HEADERS = {"X-Internal-Token": get_settings().internal_service_token}
T = datetime(2026, 10, 7, 2, 0, tzinfo=timezone.utc)
PARAMS = FloodRiskParameters(susceptibility_breaks=[0.3, 0.6])


def point(max_hourly=None, total_24h=None, freshness="fresh", kind="satellite_estimate", index=0.5, gauge=None, **extra):
    return FloodPointIn.model_validate(
        {
            "id": "d1",
            "rainfall": {
                "source": "gsmap_gauge_now",
                "dataKind": kind,
                "validTime": T.isoformat(),
                "freshness": freshness,
                "maxHourlyMmLast3Hours": max_hourly,
                "accumulationsMm": {"1": 1.0, "3": 2.0, "6": 3.0, "24": total_24h},
            },
            "susceptibility": {"source": "bnpb_inarisk", "floodHazardIndex": index},
            **({"gauge": gauge} if gauge else {}),
            **extra,
        }
    )


@pytest.mark.parametrize(
    ("mm", "name", "level"),
    [(None, None, "LOW"), (9.9, "below_lebat", "LOW"), (10, "lebat", "MEDIUM"), (20, "lebat", "MEDIUM"), (20.1, "sangat_lebat", "HIGH")],
)
def test_hourly_bmkg_categories(mm, name, level):
    category = hourly_category(mm, PARAMS)
    assert (category.name, category.level) == (name, level)


@pytest.mark.parametrize(
    ("mm", "name", "level"),
    [(49.9, "below_lebat", "LOW"), (50, "lebat", "MEDIUM"), (100, "sangat_lebat", "HIGH"), (150, "sangat_lebat", "HIGH"), (150.1, "ekstrem", "EXTREME")],
)
def test_daily_bmkg_categories(mm, name, level):
    category = daily_category(mm, PARAMS)
    assert (category.name, category.level) == (name, level)


def test_susceptibility_terciles():
    assert susceptibility_class(0.1, [0.3, 0.6]) == "low"
    assert susceptibility_class(0.3, [0.3, 0.6]) == "medium"
    assert susceptibility_class(0.6, [0.3, 0.6]) == "high"
    assert susceptibility_class(None, [0.3, 0.6]) == "unknown"
    assert susceptibility_class(0.9, None) == "unknown"


def test_higher_of_hourly_and_daily_wins():
    result = assess_point(point(max_hourly=25, total_24h=60), PARAMS)
    assert result.status == "ok"
    assert result.level == "HIGH"
    assert (result.hourly_category, result.daily_category) == ("sangat_lebat", "lebat")
    assert result.probability is None
    assert result.factors[0].effect == "raised"


def test_dry_conditions_are_low_with_low_confidence():
    result = assess_point(point(max_hourly=0.5, total_24h=3), PARAMS)
    assert result.level == "LOW"
    assert result.confidence == "low"
    assert all(f.effect != "raised" for f in result.factors)


def test_low_susceptibility_lowers_one_level_but_unknown_never_does():
    lowered = assess_point(point(max_hourly=0, total_24h=120, index=0.1), PARAMS)
    assert (lowered.rain_trigger_level, lowered.level) == ("HIGH", "MEDIUM")
    assert next(f for f in lowered.factors if f.factor == "flood_hazard_index").effect == "lowered"

    unknown = assess_point(point(max_hourly=0, total_24h=120, index=None), PARAMS)
    assert unknown.level == "HIGH"
    assert unknown.confidence == "very_low"
    assert "flood susceptibility unknown" in unknown.confidence_reasons

    disabled = FloodRiskParameters(susceptibility_breaks=[0.3, 0.6], downgrade_low_susceptibility=False)
    assert assess_point(point(max_hourly=0, total_24h=120, index=0.1), disabled).level == "HIGH"


def test_gauge_alert_sets_a_floor():
    gauge = {
        "source": "petabencana",
        "name": "Katulampa",
        "alertLevel": 2,
        "observedAt": T.isoformat(),
        "distanceKm": 12.4,
    }
    result = assess_point(point(max_hourly=1, total_24h=5, gauge=gauge), PARAMS)
    assert result.level == "HIGH"
    assert result.gauge_floor == "HIGH"
    assert result.factors[0].factor == "river_gauge_alert"
    assert "Katulampa, 12 km" in result.factors[0].detail
    # Siaga IV (normal) never raises.
    normal = assess_point(point(max_hourly=1, total_24h=5, gauge={**gauge, "alertLevel": 4}), PARAMS)
    assert normal.level == "LOW"


def test_stale_rain_is_refused():
    result = assess_point(point(max_hourly=30, total_24h=200, freshness="stale"), PARAMS)
    assert result.status == "insufficient_data"
    assert result.level is None
    assert "fresh" in result.reason


def test_incomplete_24h_still_uses_hourly_but_lowers_confidence():
    result = assess_point(point(max_hourly=12, total_24h=None), PARAMS)
    assert result.level == "MEDIUM"
    assert result.confidence == "very_low"
    assert next(f for f in result.factors if f.factor == "rain_24h").effect == "not_available"


def test_model_rain_and_aging_data_lower_confidence():
    result = assess_point(point(max_hourly=1, total_24h=5, kind="nwp_model", freshness="aging"), PARAMS)
    assert result.confidence == "very_low"
    assert any("nwp_model" in r for r in result.confidence_reasons)
    assert any("aging" in r for r in result.confidence_reasons)


def test_unscored_inputs_are_reported_as_context():
    result = assess_point(
        point(
            max_hourly=1,
            total_24h=5,
            antecedent={"source": "open-meteo", "validTime": T.isoformat(), "totalMm72Hours": 80, "totalMm168Hours": None},
            soilMoisture={"source": "open-meteo", "validTime": T.isoformat(), "volumetricFraction": 0.41},
        ),
        PARAMS,
    )
    effects = {f.factor: f.effect for f in result.factors}
    assert effects["rain_72h"] == "not_scored"
    assert effects["rain_168h"] == "not_available"
    assert effects["soil_moisture_9_27cm"] == "not_scored"
    assert effects["rain_3h"] == "not_scored"


def test_parameters_validate_ordering():
    with pytest.raises(ValidationError):
        FloodRiskParameters(daily_lebat_mm=120)
    with pytest.raises(ValidationError):
        FloodRiskParameters(susceptibility_breaks=[0.7, 0.2])


def test_endpoint_round_trip():
    body = {
        "issuedAt": T.isoformat(),
        "points": [
            point(max_hourly=25, total_24h=60).model_dump(by_alias=True, mode="json"),
            {"id": "empty"},
        ],
        "parameters": {"susceptibilityBreaks": [0.3, 0.6]},
    }
    response = client.post("/predict-rain-flood-risk", json=body, headers=HEADERS)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["modelVersion"] == "flood-rule-baseline-v0.1"
    assert data["calibrated"] is False
    assert any("DIBI" in m for m in data["missingInputs"])
    assert "BMKG" in data["factorBases"]["rain_24h"]
    assert "[0.3, 0.6]" in data["factorBases"]["flood_hazard_index"]
    factor_names = {f["factor"] for p in data["points"] for f in p["factors"]}
    assert factor_names <= set(data["factorBases"])
    assert [p["level"] for p in data["points"]] == ["HIGH", None]
    assert data["points"][1]["status"] == "insufficient_data"


def test_endpoint_requires_internal_token():
    body = {"issuedAt": T.isoformat(), "points": [{"id": "x"}]}
    assert client.post("/predict-rain-flood-risk", json=body).status_code == 422
    assert client.post("/predict-rain-flood-risk", json=body, headers={"X-Internal-Token": "x"}).status_code == 401


def test_endpoint_rejects_unknown_window():
    body = {
        "issuedAt": T.isoformat(),
        "points": [
            {
                "id": "d1",
                "rainfall": {
                    "source": "s",
                    "dataKind": "nwp_model",
                    "validTime": T.isoformat(),
                    "freshness": "fresh",
                    "accumulationsMm": {"12": 5},
                },
            }
        ],
    }
    assert client.post("/predict-rain-flood-risk", json=body, headers=HEADERS).status_code == 422
