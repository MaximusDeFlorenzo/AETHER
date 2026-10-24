from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

client = TestClient(app)
HEADERS = {"X-Internal-Token": get_settings().internal_service_token}
ISSUED = datetime(2026, 9, 20, 6, 0, tzinfo=timezone.utc)


def spread_payload(observed_at):
    return {
        "issuedAt": ISSUED.isoformat(),
        "horizonsHours": [1],
        "hotspots": [{"latitude": -2.2, "longitude": 113.9, "observedAt": observed_at.isoformat()}],
        "weather": [
            {"time": (ISSUED + timedelta(hours=i - 2)).isoformat(), "windSpeedKmh": 10, "windFromDeg": 90}
            for i in range(6)
        ],
    }


def test_spread_requires_internal_token():
    response = client.post("/predict-fire-spread", json=spread_payload(ISSUED - timedelta(hours=1)))
    assert response.status_code == 422  # missing header
    response = client.post(
        "/predict-fire-spread",
        json=spread_payload(ISSUED - timedelta(hours=1)),
        headers={"X-Internal-Token": "wrong"},
    )
    assert response.status_code == 401


def test_spread_ok_and_camel_case():
    response = client.post("/predict-fire-spread", json=spread_payload(ISSUED - timedelta(hours=1)), headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["modelVersion"].startswith("karhutla-spread")
    assert body["horizons"][0]["envelope"]["type"] == "Polygon"


def test_conflicting_observation_time_is_422():
    response = client.post("/predict-fire-spread", json=spread_payload(ISSUED + timedelta(hours=3)), headers=HEADERS)
    assert response.status_code == 422


def test_smoke_rejects_observation_after_issue():
    payload = {
        "issuedAt": ISSUED.isoformat(),
        "horizonsHours": [1],
        "source": {
            "latitude": -2.2,
            "longitude": 113.9,
            "latestObservationAt": (ISSUED + timedelta(hours=1)).isoformat(),
            "hotspotCount": 1,
        },
        "atmosphere": [
            {
                "latitude": -2.2,
                "longitude": 113.9,
                "hours": [
                    {"time": ISSUED.isoformat(), "levels": [{"heightAglM": 10, "windSpeedKmh": 5, "windFromDeg": 0}]}
                ],
            }
        ],
    }
    response = client.post("/predict-smoke-transport", json=payload, headers=HEADERS)
    assert response.status_code == 422
