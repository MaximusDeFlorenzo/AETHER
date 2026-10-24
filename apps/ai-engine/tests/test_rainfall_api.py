from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.ml.rainfall.grid import encode_grid

client = TestClient(app)
HEADERS = {"X-Internal-Token": get_settings().internal_service_token}
T = datetime(2026, 10, 6, 14, 0, tzinfo=timezone.utc)
GRID = {"westLon": 104.05, "northLat": -0.05, "resolutionDeg": 0.1, "nx": 100, "ny": 100}


def blob(line: int, col: int) -> np.ndarray:
    ys, xs = np.mgrid[0:100, 0:100]
    field = 20 * np.exp(-((ys - line) ** 2 + (xs - col) ** 2) / 18.0)
    field[field < 0.05] = 0
    return field


def payload(**overrides):
    body = {
        "issuedAt": (T + timedelta(minutes=10)).isoformat(),
        "grid": GRID,
        "previous": {"validTime": (T - timedelta(hours=1)).isoformat(), "dataB64": encode_grid(blob(49, 45))},
        "current": {"validTime": T.isoformat(), "dataB64": encode_grid(blob(49, 47))},
        "points": [
            {
                "id": "d1",
                "latitude": -5.0,
                "longitude": 109.0,
                "steeringWind": {"speedKmh": 20, "fromDeg": 270, "validTime": T.isoformat()},
            },
            {"id": "d2", "latitude": -5.0, "longitude": 105.0},
        ],
        "horizonsHours": [1, 2, 3],
    }
    body.update(overrides)
    return body


def test_requires_internal_token():
    assert client.post("/predict-rain-nowcast", json=payload()).status_code == 422
    assert (
        client.post("/predict-rain-nowcast", json=payload(), headers={"X-Internal-Token": "x"}).status_code == 401
    )


def test_nowcast_shape_and_motion():
    response = client.post("/predict-rain-nowcast", json=payload(), headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["modelVersions"] == {
        "motion": "rain-motion-blockmatch-v0.1",
        "nowcast": "rain-nowcast-baselines-v0.1",
    }
    assert body["calibrated"] is False
    d1 = body["points"][0]
    assert d1["movement"]["status"] == "ok"
    assert d1["movement"]["towardDeg"] == 90.0  # moved 2 cells east
    assert d1["movement"]["confidence"] == "low"
    assert len(d1["forecasts"]) == 9  # 3 methods × 3 horizons
    for forecast in d1["forecasts"]:
        assert forecast["status"] == "ok"
        assert 0 <= forecast["probability"] <= 1
    # d2 has no steering wind → that method is unavailable, others still run.
    d2 = body["points"][1]
    steering = [f for f in d2["forecasts"] if f["method"] == "steering_wind_advection"]
    assert {f["status"] for f in steering} == {"insufficient_data"}


def test_without_previous_frame_motion_is_unavailable():
    body = payload()
    del body["previous"]
    response = client.post("/predict-rain-nowcast", json=body, headers=HEADERS)
    assert response.status_code == 200
    movement = response.json()["points"][0]["movement"]
    assert movement == {**movement, "status": "no_previous_frame", "confidence": "very_low"}


def test_rejects_bad_grid_size_and_inconsistent_times():
    bad = payload(current={"validTime": T.isoformat(), "dataB64": encode_grid(np.zeros((5, 5)))})
    assert client.post("/predict-rain-nowcast", json=bad, headers=HEADERS).status_code == 422
    future = payload(issuedAt=(T - timedelta(hours=1)).isoformat())
    assert client.post("/predict-rain-nowcast", json=future, headers=HEADERS).status_code == 422
    gap = payload(previous={"validTime": (T - timedelta(hours=6)).isoformat(), "dataB64": encode_grid(blob(1, 1))})
    assert client.post("/predict-rain-nowcast", json=gap, headers=HEADERS).status_code == 422
    dupes = payload(horizonsHours=[1, 1])
    assert client.post("/predict-rain-nowcast", json=dupes, headers=HEADERS).status_code == 422
