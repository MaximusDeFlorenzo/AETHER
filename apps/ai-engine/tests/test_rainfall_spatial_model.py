from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.ml.rainfall.engine import run_nowcast
from app.ml.rainfall.grid import encode_grid
from app.ml.rainfall.spatial_model import (
    FEATURE_NAMES,
    build_features,
    local_hour_bin,
    predict_probability,
    train,
)
from app.schemas.rainfall import RainNowcastRequest
from app.schemas.rainfall_spatial import RainSpatialTrainRequest

client = TestClient(app)
HEADERS = {"X-Internal-Token": get_settings().internal_service_token}
T0 = datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc)
I = {name: i for i, name in enumerate(FEATURE_NAMES)}


def features(**overrides):
    base = dict(
        probabilities={"persistence": 0.2, "motion_advection": 0.3, "steering_wind_advection": None},
        current_mm_per_hour=1.5,
        rain_fraction_50km=0.25,
        rain_fraction_100km=0.1,
        motion_tracked=True,
        valid_time=T0,
        longitude=106.8,
    )
    base.update(overrides)
    return build_features(**base)


def test_feature_vector_layout_and_missing_baselines():
    x = features()
    assert len(x) == len(FEATURE_NAMES)
    assert x[I["p_persistence"]] == 0.2
    assert x[I["p_motion_advection"]] == 0.3 and x[I["motion_advection_missing"]] == 0
    assert x[I["p_steering_wind_advection"]] == 0 and x[I["steering_wind_advection_missing"]] == 1
    assert x[I["log1p_current_mm_per_hour"]] == pytest.approx(0.916)
    assert x[I["motion_tracked"]] == 1


def test_no_features_without_own_rain_or_neighbourhood():
    assert features(current_mm_per_hour=None) is None
    assert features(rain_fraction_100km=None) is None
    assert features(probabilities={"persistence": None}) is None


def test_local_hour_bin_follows_longitude():
    # 00 UTC at 106.8 E is ~07:07 local solar time; at 135 E it is 09:00.
    assert local_hour_bin(T0, 106.8) == 7
    assert local_hour_bin(T0, 135.0) == 9
    assert local_hour_bin(T0 + timedelta(hours=20), 106.8) == 3  # wraps


def test_sigmoid_is_stable_for_large_inputs():
    assert predict_probability([0.0], 800.0, [1.0]) == pytest.approx(1.0)
    assert predict_probability([0.0], -800.0, [1.0]) == pytest.approx(0.0)
    assert predict_probability([0.0], 0.0, [1.0]) == 0.5


def synthetic_rows(days: float, seed: int = 0, n_per_hour: int = 60):
    """Rain at t+1 h follows the 100 km neighbourhood far better than any
    baseline column does — a model that uses it must beat them."""
    rng = np.random.default_rng(seed)
    hours = int(days * 24)
    rows = []
    for h in range(hours):
        split = 0 if h < 0.6 * hours else 1 if h < 0.8 * hours else 2
        for _ in range(n_per_hour):
            frac100 = float(rng.choice([0.0, 0.0, 0.0, 0.2, 0.5, 0.9]))
            label = float(rng.random() < 0.02 + 0.9 * frac100)
            noise = round(float(rng.random()) * 0.3, 3)
            x = [noise, noise, 0, noise, 0, 0.0, frac100 / 2, frac100, 0, 0.0, 1.0]
            rows.append([1, split, label, 1.0, *x])
    return rows, hours


def request(days: float, **gate):
    rows, hours = synthetic_rows(days)
    return RainSpatialTrainRequest.model_validate(
        {
            "issuedAt": T0.isoformat(),
            "thresholdMmPerHour": 1.0,
            "featureNames": FEATURE_NAMES,
            "horizonsHours": [1],
            "history": {
                "firstStart": T0.isoformat(),
                "lastStart": (T0 + timedelta(hours=hours - 1)).isoformat(),
                "startHours": hours,
                "splitBoundaries": [T0.isoformat(), T0.isoformat()],
            },
            "rows": rows,
            "gate": gate,
        }
    )


def test_model_beating_every_baseline_with_enough_history_is_promoted():
    out = train(request(15, minTestPositives=10)).horizons[0]
    assert out.status == "fitted"
    assert out.promoted, out.gate_reasons
    assert len(out.coefficients) == len(FEATURE_NAMES)
    # The informative feature carries the weight.
    assert out.coefficients[I["rain_fraction_100km"]] == max(out.coefficients)
    for comparison in out.comparisons:
        assert comparison.model_score.brier_skill_score > comparison.baseline_score.brier_skill_score
    assert out.test.reliability and 0 <= out.test.reliability[0].mean_forecast <= 1


def test_short_history_is_never_promoted():
    out = train(request(2, minTestPositives=10)).horizons[0]
    assert out.status == "fitted"
    assert not out.promoted
    assert any("history 2.0 days < 14 required" in r for r in out.gate_reasons)


def test_single_class_split_is_insufficient_data():
    req = request(3)
    for row in req.rows:
        row[2] = 0.0
    out = train(req).horizons[0]
    assert out.status == "insufficient_data"
    assert not out.promoted
    assert "single class" in out.reason


def test_feature_mismatch_is_refused():
    req = request(1)
    req.feature_names = FEATURE_NAMES[:-1]
    with pytest.raises(ValueError):
        train(req)


GRID = {"westLon": 104.05, "northLat": -0.05, "resolutionDeg": 0.1, "nx": 100, "ny": 100}


def nowcast_request(spatial_model=None):
    field = np.zeros((100, 100))
    field[45:55, 45:55] = 5.0
    body = {
        "issuedAt": T0.isoformat(),
        "grid": GRID,
        "current": {"validTime": T0.isoformat(), "dataB64": encode_grid(field)},
        "points": [{"id": "p", "latitude": -5.0, "longitude": 109.0}],
    }
    if spatial_model is not None:
        body["spatialModel"] = spatial_model
    return RainNowcastRequest.model_validate(body)


def test_nowcast_emits_neighbourhood_and_features_but_no_spatial_forecast_by_default():
    out = run_nowcast(nowcast_request())
    point = out.points[0]
    assert out.spatial_feature_names == FEATURE_NAMES
    fractions = point.neighbourhood.rain_fraction_by_radius_km
    assert 0 < fractions["100"] < fractions["50"] <= 1
    assert set(point.spatial_features) == {"1", "2", "3"}
    assert all(f.method != "spatial_logistic" for f in point.forecasts)
    assert "spatial" not in out.model_versions


def spec(names=FEATURE_NAMES):
    return {
        "modelVersion": "rain-nowcast-spatial-logistic-v0.1",
        "trainedAt": T0.isoformat(),
        "featureNames": names,
        "horizons": {"1": {"coefficients": [0.0] * len(names), "intercept": 0.0}},
    }


def test_promoted_horizons_add_spatial_forecasts():
    out = run_nowcast(nowcast_request(spec()))
    spatial = [f for f in out.points[0].forecasts if f.method == "spatial_logistic"]
    assert [(f.horizon_hours, f.probability) for f in spatial] == [(1, 0.5)]
    assert out.model_versions["spatial"] == "rain-nowcast-spatial-logistic-v0.1"


def test_model_with_other_features_is_not_applied():
    out = run_nowcast(nowcast_request(spec(names=["x"])))
    assert all(f.method != "spatial_logistic" for f in out.points[0].forecasts)
    assert "differ" in out.spatial_model_note


def test_train_endpoint_round_trip_and_token():
    body = request(2, minTestPositives=10).model_dump(by_alias=True, mode="json")
    res = client.post("/train-rain-nowcast-spatial", json=body, headers=HEADERS)
    assert res.status_code == 200
    data = res.json()
    assert data["modelVersion"] == "rain-nowcast-spatial-logistic-v0.1"
    assert data["horizons"][0]["promoted"] is False
    body["featureNames"] = ["x"]
    assert client.post("/train-rain-nowcast-spatial", json=body, headers=HEADERS).status_code == 422
    assert client.post("/train-rain-nowcast-spatial", json=body).status_code == 422
    bad = {"X-Internal-Token": "wrong"}
    assert client.post("/train-rain-nowcast-spatial", json=request(1).model_dump(by_alias=True, mode="json"), headers=bad).status_code == 401
